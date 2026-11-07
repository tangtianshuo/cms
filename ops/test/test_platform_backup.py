import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from ops.backup.manifest import verify_backup, create_manifest
from ops.backup.platform_backup import backup_platform


class BackupIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'platform-lock.json').write_text('{}')
        (self.root / 'snapshot.json').write_bytes(b'original')
        self.manifest = create_manifest(self.root, 'test-1', [], 'source-only-local')

    def test_actual_content(self):
        verify_backup(self.root, self.manifest)
        self.assertEqual((self.root / 'snapshot.json').read_bytes(), b'original')

    def test_corrupt_file_is_rejected(self):
        (self.root / 'snapshot.json').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'backup_checksum_mismatch'):
            verify_backup(self.root, self.manifest)

    def test_missing_file(self):
        (self.root / 'snapshot.json').unlink()
        with self.assertRaisesRegex(ValueError, 'backup_missing_file'):
            verify_backup(self.root, self.manifest)

    def test_paths(self):
        for bad in ['../secret', '/etc/passwd', 'a/../snapshot.json', './snapshot.json']:
            with self.subTest(bad=bad):
                manifest = copy.deepcopy(self.manifest)
                manifest['files'][0]['path'] = bad
                with self.assertRaisesRegex(ValueError, 'unsafe_backup_path'):
                    verify_backup(self.root, manifest)

    def test_symlink(self):
        (self.root / 'snapshot.json').unlink()
        (self.root / 'snapshot.json').symlink_to(self.root / 'platform-lock.json')
        with self.assertRaisesRegex(ValueError, 'unsafe_backup_path'):
            verify_backup(self.root, self.manifest)

    def test_duplicate_and_unlisted(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['files'].append(manifest['files'][0])
        with self.assertRaisesRegex(ValueError, 'duplicate_backup_path'):
            verify_backup(self.root, manifest)
        (self.root / 'unlisted').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'unlisted_backup_file'):
            verify_backup(self.root, self.manifest)

    def test_nested_manifest_is_checked(self):
        (self.root / 'artifact').mkdir()
        (self.root / 'artifact/manifest.json').write_text('real metadata')
        manifest = create_manifest(self.root, 'nested', [], 'source-only-local')
        verify_backup(self.root, manifest)
        (self.root / 'artifact/manifest.json').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'backup_checksum_mismatch'):
            verify_backup(self.root, manifest)

    def test_unlisted_nested_manifest_is_rejected(self):
        (self.root / 'artifact').mkdir()
        (self.root / 'artifact/manifest.json').write_text('unlisted')
        with self.assertRaisesRegex(ValueError, 'unlisted_backup_file'):
            verify_backup(self.root, self.manifest)

    def test_lock_checksum(self):
        self.manifest['lockChecksum'] = 'sha256:' + 'a' * 64
        with self.assertRaisesRegex(ValueError, 'lock_checksum_mismatch'):
            verify_backup(self.root, self.manifest)


class BackupLifecycleTest(unittest.TestCase):
    def test_failure_resumes_only_original_running_writers_without_manifest(self):
        class Supervisor:
            def __init__(self): self.running = {'cms', 'worker'}; self.resumed = []
            def inventory(self): return set(self.running)
            def pause(self, names): self.running -= names
            def resume(self, names): self.resumed.extend(names); self.running |= names
            def assert_paused(self): assert not self.running
        class Database:
            def wait_quiescent(self): pass
            def dump(self, root): raise RuntimeError('dump_failed')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            supervisor = Supervisor()
            with self.assertRaisesRegex(RuntimeError, 'dump_failed'):
                backup_platform(root / 'backup', supervisor, Database(), lambda output: None, [])
            self.assertEqual(set(supervisor.resumed), {'cms', 'worker'})
            self.assertFalse((root / 'backup/manifest.json').exists())

class ConcreteSupervisorTest(unittest.TestCase):
    def config(self, root):
        return {'project': 'owned', 'exclusiveWriters': True, 'protectRuntimeContainers': True, 'maintenanceProbes':['https://maintenance.invalid'], 'publicProbes':['https://public.invalid'], 'maintenanceFile': str(root / 'maintenance'),
                'writers': {'cms': ['cms', 'provisioning'], 'control': ['control', 'domain-probes'], 'worker': ['worker', 'reconciliation', 'domain-retry'], 'ingest': ['ingest']},
                'protected': {'traffic': 'traffic', 'preview': 'preview', 'database': 'database', 'runtime': 'runtime'}}

    def test_unknown_writer_and_stopped_writer(self):
        from unittest.mock import patch
        from ops.backup.platform_backup import ComposeSupervisor
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); config = self.config(root)
            rows = [{'Id': name, 'Config': {'Labels': {'com.docker.compose.service': name}}, 'State': {'Running': name in ('cms', 'worker')}} for name in [*config['writers'],*config['protected']]]
            def command(argv, **kwargs):
                return b'containers' if argv[1:3] == ['ps', '-aq'] else json.dumps(rows).encode()
            with patch('ops.backup.platform_backup.command', side_effect=command):
                supervisor = ComposeSupervisor(config)
                self.assertEqual(supervisor.inventory(), {'cms', 'worker'})
                rows.append({'Id': 'rogue', 'Config': {'Labels': {'com.docker.compose.service': 'cron'}}, 'State': {'Running': True}})
                with self.assertRaisesRegex(ValueError, 'unknown_writer_service'):
                    supervisor.inventory()

    def test_explicit_maintenance_and_only_original_set(self):
        from unittest.mock import patch
        from ops.backup.platform_backup import ComposeSupervisor
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); supervisor=ComposeSupervisor(self.config(root))
            calls=[]
            with patch('ops.backup.platform_backup.command', side_effect=lambda argv: calls.append(argv)), patch.object(supervisor, 'probes'):
                supervisor.pause({'cms-id', 'worker-id'})
                self.assertIn('temporarily unavailable', (root/'maintenance').read_text())
                supervisor.resume({'cms-id', 'worker-id'})
                self.assertFalse((root/'maintenance').exists())
            self.assertEqual(calls, [['docker','stop','--time','180','cms-id','worker-id'],['docker','start','cms-id','worker-id']])

    def test_declared_writer_exclusivity_required(self):
        from ops.backup.platform_backup import ComposeSupervisor
        with tempfile.TemporaryDirectory() as d:
            config=self.config(Path(d)); config['exclusiveWriters']=False
            with self.assertRaisesRegex(ValueError,'writer_inventory_incomplete'):
                ComposeSupervisor(config)

class ConsistencyTest(unittest.TestCase):
    def test_changes_during_dump_refuse_completion(self):
        class Supervisor:
            def inventory(self): return {'original'}
            def pause(self,names): pass
            def assert_paused(self): pass
            def resume(self,names): self.resumed=names
        class Database:
            version='before'
            def wait_quiescent(self): pass
            def stable_state(self): return self.version
            def dump(self,root): self.version='after'
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'backup'; supervisor=Supervisor()
            with self.assertRaisesRegex(ValueError,'backup_state_changed'):
                backup_platform(root,supervisor,Database(),lambda root:None,[])
            self.assertFalse((root/'manifest.json').exists())
            self.assertEqual(supervisor.resumed,{'original'})

class CompletionTest(unittest.TestCase):
    def test_resume_failure_does_not_publish_completion(self):
        class Supervisor:
            def inventory(self): return {'cms'}
            def pause(self,names): pass
            def assert_paused(self): pass
            def resume(self,names): raise RuntimeError('resume_failed')
        class Database:
            def wait_quiescent(self): pass
            def dump(self,root): (root/'platform-lock.json').write_text('{}')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'backup'
            with self.assertRaisesRegex(RuntimeError,'resume_failed'):
                backup_platform(root,Supervisor(),Database(),lambda root:None,[])
            self.assertFalse((root/'manifest.json').exists())

class ComposeNativeSmoke(unittest.TestCase):
    @unittest.skipUnless(__import__('os').environ.get('PLATFORM_COMPOSE_TEST') == '1', 'explicit disposable Docker smoke only')
    def test_real_owned_containers_original_set_unknown_service_and_public_availability(self):
        import http.server
        import threading
        import uuid
        from ops.backup.platform_backup import ComposeSupervisor, command
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); project='platform-f2-smoke-'+uuid.uuid4().hex[:12]
            config={'project':project,'exclusiveWriters':True,'protectRuntimeContainers':True,
                    'maintenanceFile':str(root/'maintenance'),
                    'writers':{'writer':['cms','provisioning','control','domain-probes','worker','reconciliation','domain-retry','ingest'],'stopped':['scheduled-writer']},
                    'protected':{'traffic':'traffic','preview':'preview','database':'database'}}
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(503 if self.path=='/maintenance' and (root/'maintenance').exists() else 200)
                    self.end_headers(); self.wfile.write(b'public content remains available')
                def log_message(self, *_): pass
            server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            config['maintenanceProbes']=['http://127.0.0.1:'+str(server.server_port)+'/maintenance']
            config['publicProbes']=['http://127.0.0.1:'+str(server.server_port)+'/']
            containers=[]; ids={}
            try:
                for service in [*config['writers'],*config['protected']]:
                    cid=command(['docker','create','--label','com.docker.compose.project='+project,'--label','com.docker.compose.service='+service,'node:22-bookworm','node','-e',"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]).decode().strip()
                    containers.append(cid);ids[service]=cid
                    if service!='stopped': command(['docker','start',cid])
                supervisor=ComposeSupervisor(config);running=supervisor.inventory()
                self.assertEqual(running,{ids['writer']})
                supervisor.pause(running);supervisor.assert_paused()
                states=json.loads(command(['docker','inspect',*containers]))
                self.assertTrue(all(row['State']['Running'] for row in states if row['Id'] in [ids[k] for k in config['protected']]))
                supervisor.resume(running)
                self.assertEqual(supervisor.inventory(),running)
                self.assertFalse(json.loads(command(['docker','inspect',ids['stopped']]))[0]['State']['Running'])
                rogue=command(['docker','create','--label','com.docker.compose.project='+project,'--label','com.docker.compose.service=unknown-cron','node:22-bookworm','node','-e',"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]).decode().strip();containers.append(rogue)
                with self.assertRaisesRegex(ValueError,'unknown_writer_service'):supervisor.inventory()
                self.assertFalse((root/'maintenance').exists())
            finally:
                if containers: command(['docker','rm','-f',*containers])
                server.shutdown();server.server_close();thread.join()
