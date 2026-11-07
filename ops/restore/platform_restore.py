#!/usr/bin/env python3
"""Restore verified backups into fresh, isolated resources. Never overwrite."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ops.backup.manifest import verify_backup
from ops.backup.platform_backup import DockerDatabases, command, copy_private


def prepare_target(root):
    root = Path(root)
    if root.exists() or root.is_symlink():
        raise ValueError('restore_target_exists')
    root.mkdir(mode=0o700)


def restore_platform(backup, target, config, *, allow_local=False):
    os.umask(0o077)
    backup, target = Path(backup), Path(target)
    if target.resolve().is_relative_to(backup.resolve()):
        raise ValueError('unsafe_restore_target')
    manifest = json.loads((backup / 'manifest.json').read_text())
    verify_backup(backup, manifest)
    if manifest.get('evidenceType') == 'source-only-local':
        if not allow_local:
            raise ValueError('source_only_backup_not_formal')
    elif manifest.get('evidenceType') == 'platform-lock-bound':
        command(['node', str(Path(__file__).resolve().parents[1] / 'release/platform-lock.mjs'), 'verify', str(backup / 'platform-lock.json')])
    else:
        raise ValueError('backup_evidence_type_unknown')
    for required in ['databases/postgres.dump', 'databases/mongo.archive', 'databases/source.json', 'routes.json', 'domains.json']:
        if required not in {entry['path'] for entry in manifest['files']}:
            raise ValueError('incomplete_platform_backup')
    prepare_target(target)
    name = 'platform_restore_' + uuid.uuid4().hex[:24]
    source = json.loads((backup / 'databases/source.json').read_text())
    admin = DockerDatabases(config)
    if admin.pg("SELECT count(*) FROM pg_database WHERE datname='" + name + "'") != '0':
        raise ValueError('restore_database_exists')
    if admin.mongo('print(d.getSiblingDB("admin").adminCommand({listDatabases:1,nameOnly:true}).databases.some(x=>x.name===' + json.dumps(name) + '));') != 'false':
        raise ValueError('restore_database_exists')
    receipt = dict(schemaVersion=1, backupId=manifest['backupId'], lockChecksum=manifest['lockChecksum'], evidenceType=manifest['evidenceType'], postgresDatabase=name, mongoDatabase=name, status='restoring')
    (target / 'restore-private.json').write_text(json.dumps(receipt))
    try:
        for label in ('artifacts', 'uploads', 'domains.json', 'platform-lock.json'):
            copy_private(backup / label, target / label)
        # The old physical routes are recovery input only, never the serving path.
        copy_private(backup / 'routes.json', target / 'saved-routes.json')
        admin.pg('CREATE DATABASE "' + name + '"')
        restored = DockerDatabases({**config, 'postgresDatabase': name, 'mongoDatabase': name})
        with (backup / 'databases/postgres.dump').open('rb') as file:
            result = subprocess.run(['docker', 'exec', '-i', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE', config['postgresContainer'], 'pg_restore', '--no-owner', '--no-acl', '--exit-on-error', '--dbname=' + name], stdin=file, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=restored.env, timeout=300)
        if result.returncode:
            raise RuntimeError('postgres_restore_failed')
        restored.mongo_tool('mongorestore', backup / 'databases/mongo.archive', restore=True, source_database=source['mongoDatabase'])
        # Preserve request keys, attempts, bindings and pending intent; expire only authority.
        restored.pg('UPDATE "PublishOperation" SET "leaseOwner"=NULL,"leaseUntil"=NULL,"candidateCredentialHash"=NULL,"attempts"="attempts"+1 WHERE "leaseOwner" IS NOT NULL OR "candidateCredentialHash" IS NOT NULL')
        restored.mongo('for(const c of d.getCollectionNames()) d.getCollection(c).updateMany({"provisioning.status":"running"},{$set:{"provisioning.status":"pending","provisioning.nextAttemptAt":0},$unset:{"provisioning.leaseToken":"","provisioning.leaseUntil":""}}); print("fenced");')
        receipt['status'] = 'databases-restored'
        (target / 'restore-private.json').write_text(json.dumps(receipt))
        return receipt
    except Exception:
        # Never delete on an ambiguous failure. Exact owned DB identities survive privately.
        receipt['status'] = 'failed'
        (target / 'restore-private.json').write_text(json.dumps(receipt))
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', required=True)
    parser.add_argument('--target', choices=['isolated', 'production'], default='isolated')
    parser.add_argument('--directory')
    args = parser.parse_args()
    if args.target == 'production':
        raise ValueError('production_restore_requires_reviewed_runbook')
    config = json.loads(Path(os.environ['PLATFORM_BACKUP_CONFIG']).read_text())
    root = Path(args.directory or ('platform-restore-' + uuid.uuid4().hex)) .resolve()
    receipt = restore_platform(Path(args.backup), root, config['databases'])
    env = dict(os.environ)
    from urllib.parse import urlsplit, urlunsplit
    uri = urlsplit(env['DATABASE_URL'])
    env['DATABASE_URL'] = urlunsplit(uri._replace(path='/' + receipt['postgresDatabase']))
    command(['node', str(Path(config['gatewayRoot']) / 'packages/worker/dist/restore-deployments.js'), str(root)], env=env)
    print(json.dumps({'backupId': receipt['backupId'], 'directory': str(root), 'status': 'ready'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ': restore_failed (private operator diagnostics required)', file=sys.stderr)
        sys.exit(1)
