#!/usr/bin/env python3
"""Consistent Compose deployment backup. Credentials are environment-only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ops.backup.manifest import create_manifest, verify_backup


def command(argv, *, data=None, output=None, env=None):
    result = subprocess.run(argv, input=data, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=300)
    if result.returncode:
        # Tool stderr may contain URLs, passwords or route tokens.
        raise RuntimeError('platform_command_failed:' + Path(argv[0]).name)
    return result.stdout


class ComposeSupervisor:
    """Only declared Compose writer containers are stopped; never database/traffic."""
    def __init__(self, config):
        self.config = config
        roles = {'cms', 'provisioning', 'control', 'domain-probes', 'worker', 'reconciliation', 'domain-retry', 'ingest'}
        declared = {role for values in config['writers'].values() for role in values}
        if not roles.issubset(declared) or not {'traffic', 'preview', 'database'}.issubset(set(config['protected'].values())) or config.get('protectRuntimeContainers') is not True or config.get('exclusiveWriters') is not True:
            raise ValueError('writer_inventory_incomplete')
        if set(config['writers']) & set(config['protected']):
            raise ValueError('writer_inventory_overlap')
        if not config.get('maintenanceProbes') or not config.get('publicProbes'):
            raise ValueError('maintenance_probes_required')
        self.owned = {}
        self.protected_state = None
        self.maintenance = Path(config['maintenanceFile'])
        if self.maintenance.exists():
            raise ValueError('maintenance_already_active')

    def inventory(self):
        ids = command(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + self.config['project']]).decode().split()
        rows = json.loads(command(['docker', 'inspect', *ids])) if ids else []
        found, running, protected = set(), set(), {}
        for row in rows:
            service = row['Config']['Labels'].get('com.docker.compose.service')
            if service not in self.config['writers'] and service not in self.config['protected']:
                raise ValueError('unknown_writer_service')
            found.add(service)
            if service in self.config['protected']:
                protected[row['Id']] = row['State']['Running']
            if service in self.config['writers']:
                self.owned[row['Id']] = service
                if row['State']['Running']:
                    running.add(row['Id'])
        if not (set(self.config['writers']) | set(self.config['protected'])).issubset(found):
            raise ValueError('writer_service_missing')
        if self.protected_state is None:
            self.protected_state = protected
        elif protected != self.protected_state:
            raise ValueError('protected_service_changed')
        return running

    def probes(self):
        for urls, expected in [(self.config['maintenanceProbes'], 503), (self.config['publicProbes'], 200)]:
            for url in urls:
                parsed = urlsplit(url)
                if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
                    raise ValueError('invalid_probe_url')
                try:
                    with urlopen(url, timeout=10) as response: status = response.status
                except HTTPError as error: status = error.code
                if status != expected: raise ValueError('maintenance_or_public_probe_failed')

    def pause(self, names):
        self.maintenance.write_text('Content maintenance and inquiries temporarily unavailable')
        self.probes()
        if names:
            command(['docker', 'stop', '--time', '180', *sorted(names)])

    def resume(self, names):
        if names:
            command(['docker', 'start', *sorted(names)])
        self.maintenance.unlink(missing_ok=True)

    def assert_paused(self):
        if self.inventory():
            raise ValueError('writer_still_running')
        self.probes()


class DockerDatabases:
    """Existing PostgreSQL/Mongo containers; only selected DBs are read/written."""
    def __init__(self, config):
        self.config = config
        for key in ('postgresDatabase', 'mongoDatabase'):
            if not re.fullmatch('[a-zA-Z][a-zA-Z0-9_]{0,62}', config[key]):
                raise ValueError('invalid_database_name')
        self.env = dict(os.environ)
        self.env.update(PGUSER=os.environ['PLATFORM_PG_USER'], PGPASSWORD=os.environ['PLATFORM_PG_PASSWORD'], PGDATABASE=config['postgresDatabase'])
        self.env['MONGODB_URI'] = os.environ['PLATFORM_MONGO_URI']

    def pg(self, sql):
        return command(['docker', 'exec', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE', self.config['postgresContainer'], 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], env=self.env).decode().strip()

    def mongo(self, expression):
        script = 'const d=connect(process.env.MONGODB_URI).getSiblingDB(' + json.dumps(self.config['mongoDatabase']) + ');' + expression
        return command(['docker', 'exec', '-e', 'MONGODB_URI', self.config['mongoContainer'], 'mongosh', '--nodb', '--quiet', '--eval', script], env=self.env).decode().strip()

    def stable_state(self):
        # Other SQL connections, even idle, are unknown potential writers.
        if self.pg("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()") != '0':
            raise ValueError('unknown_database_writer')
        live = self.pg('SELECT count(*) FROM "PublishOperation" WHERE "leaseOwner" IS NOT NULL AND "leaseUntil">now()')
        if live != '0':
            raise ValueError('active_worker_lease')
        mongo = json.loads(self.mongo('print(JSON.stringify({ops:d.getSiblingDB("admin").currentOp({active:true}).inprog.filter(x=>typeof x.ns === "string" && String(x.ns).indexOf(d.getName()+".") === 0).length,leases:d.getCollectionNames().reduce((n,c)=>n+d.getCollection(c).countDocuments({"provisioning.status":"running","provisioning.leaseUntil":{$gt:Date.now()}}),0),state:d.runCommand({dbHash:1}).md5}));'))
        if mongo['ops'] or mongo['leases']:
            raise ValueError('active_mongo_writer')
        sql = self.pg('SELECT json_build_object(\'operations\',(SELECT json_agg(t) FROM (SELECT * FROM "PublishOperation" ORDER BY id) t),\'domains\',(SELECT json_agg(t) FROM (SELECT * FROM "DomainChange" ORDER BY "siteId") t),\'active\',(SELECT json_agg(t) FROM (SELECT * FROM "ActiveDeployment" ORDER BY id) t))')
        return hashlib.sha256((sql + json.dumps(mongo['state'], sort_keys=True)).encode()).hexdigest()

    def wait_quiescent(self):
        deadline = time.monotonic() + self.config.get('quiescenceTimeout', 190)
        last = None
        while time.monotonic() < deadline:
            try:
                current = self.stable_state()
                if current == last:
                    return
                last = current
            except ValueError as error:
                if str(error) == 'unknown_database_writer':
                    raise
                last = None
            time.sleep(1)
        raise ValueError('writers_not_quiescent')

    def mongo_tool(self, tool, archive, restore=False, source_database=None):
        # Password travels on stdin into a private, uniquely named container file.
        key = '/tmp/platform-backup-' + uuid.uuid4().hex
        container = self.config['mongoContainer']
        command(['docker', 'exec', '-i', container, 'sh', '-c', 'umask 077; cat > "$1"', 'sh', key], data=json.dumps({'uri': urlunsplit(urlsplit(self.env['MONGODB_URI'])._replace(path='/'))}).encode())
        try:
            if restore:
                command(['docker', 'cp', str(archive), container + ':' + key + '.archive'])
                command(['docker', 'exec', container, tool, '--config=' + key, '--archive=' + key + '.archive', '--nsFrom=' + source_database + '.*', '--nsTo=' + self.config['mongoDatabase'] + '.*'])
            else:
                with archive.open('wb') as output:
                    command(['docker', 'exec', container, tool, '--config=' + key, '--db=' + self.config['mongoDatabase'], '--archive'], output=output)
        finally:
            command(['docker', 'exec', container, 'rm', '-f', key, key + '.archive'])

    def dump(self, root):
        (root / 'databases').mkdir()
        with (root / 'databases/postgres.dump').open('wb') as output:
            command(['docker', 'exec', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE', self.config['postgresContainer'], 'pg_dump', '--format=custom', '--no-owner', '--no-acl'], output=output, env=self.env)
        self.mongo_tool('mongodump', root / 'databases/mongo.archive')
        (root / 'databases/source.json').write_text(json.dumps({k: self.config[k] for k in ('postgresDatabase', 'mongoDatabase')}))

    def sites(self):
        return json.loads(self.pg('SELECT COALESCE(json_agg(t),\'[]\') FROM (SELECT b."cmsSiteId",a."siteId" AS "gatewaySiteId",a."releaseId",a."routeRevision" FROM "ActiveDeployment" a JOIN "SourceSiteBinding" b ON b."siteId"=a."siteId" ORDER BY a."siteId") t'))


def copy_private(source, destination):
    source = Path(source)
    if destination.resolve().is_relative_to(source.resolve()):
        raise ValueError('unsafe_backup_destination')
    if source.is_symlink():
        raise ValueError('unsafe_backup_path')
    if source.is_dir():
        destination.mkdir(mode=0o700)
        for child in source.iterdir():
            copy_private(child, destination / child.name)
    elif source.is_file():
        shutil.copyfile(source, destination)
        destination.chmod(0o600)
    else:
        raise ValueError('backup_missing_file')


def backup_platform(output, supervisor, database, capture, sites, evidence_type='source-only-local'):
    os.umask(0o077)
    output = Path(output)
    output.mkdir(mode=0o700)  # Refuse overwrite, including empty previous attempt.
    running = supervisor.inventory()
    try:
        supervisor.pause(running)
        supervisor.assert_paused()
        database.wait_quiescent()
        before = database.stable_state() if hasattr(database, "stable_state") else None
        database.dump(output)
        capture(output)
        supervisor.assert_paused()
        database.wait_quiescent()
        if before is not None and before != database.stable_state():
            raise ValueError("backup_state_changed")
        manifest = create_manifest(output, uuid.uuid4().hex, sites() if callable(sites) else sites, evidence_type)
        verify_backup(output, manifest)
    finally:
        supervisor.resume(running)
    temporary = output / 'manifest.tmp'
    with temporary.open('x') as file:
        json.dump(manifest, file, indent=2)
        file.flush(); os.fsync(file.fileno())
    temporary.replace(output / 'manifest.json')
    descriptor = os.open(output, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
    return manifest



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    config = json.loads(Path(os.environ['PLATFORM_BACKUP_CONFIG']).read_text())
    lock = Path(config['lock'])
    command(['node', str(Path(__file__).resolve().parents[1] / 'release/platform-lock.mjs'), 'verify', str(lock)])
    supervisor = ComposeSupervisor(config['supervisor'])
    databases = DockerDatabases(config['databases'])
    def capture(root):
        for name in ('artifacts', 'uploads', 'routes.json', 'domains.json'):
            copy_private(config['paths'][name], root / name)
        copy_private(lock, root / 'platform-lock.json')
    manifest = backup_platform(Path(args.output), supervisor, databases, capture, databases.sites, 'platform-lock-bound')
    print(json.dumps({'backupId': manifest['backupId'], 'files': len(manifest['files'])}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ': backup_failed (private operator diagnostics required)', file=sys.stderr)
        sys.exit(1)
