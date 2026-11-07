import tempfile
import unittest
from pathlib import Path
from ops.restore.platform_restore import prepare_target


class RestoreSafetyTest(unittest.TestCase):
    def test_existing_target_is_rejected_and_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'content').write_text('keep')
            with self.assertRaisesRegex(ValueError, 'restore_target_exists'):
                prepare_target(root)
            self.assertEqual((root / 'content').read_text(), 'keep')

    def test_new_private_target(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / 'new'
            prepare_target(root)
            self.assertEqual(root.stat().st_mode & 0o777, 0o700)

class RestoreIntegrityTest(unittest.TestCase):
    def test_every_class_of_corruption_fails_before_target_or_database(self):
        import json
        from ops.backup.manifest import create_manifest
        from ops.restore.platform_restore import restore_platform
        from unittest.mock import patch
        for name in ['databases/postgres.dump','databases/mongo.archive','artifacts/release.snapshot','uploads/image.png','routes.json','domains.json']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                root=Path(d)/'backup';root.mkdir();target=Path(d)/'restored'
                for file in ['platform-lock.json',name]:
                    path=root/file;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'original')
                manifest=create_manifest(root,'test',[],'source-only-local')
                (root/'manifest.json').write_text(json.dumps(manifest))
                (root/name).write_bytes(b'corrupt')
                with patch('ops.restore.platform_restore.DockerDatabases') as database:
                    with self.assertRaisesRegex(ValueError,'backup_checksum_mismatch'):
                        restore_platform(root,target,{},allow_local=True)
                    database.assert_not_called()
                self.assertFalse(target.exists())

    def test_restore_cannot_mutate_backup_directory(self):
        import json
        from ops.backup.manifest import create_manifest
        from ops.restore.platform_restore import restore_platform
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for name in ['platform-lock.json','databases/postgres.dump','databases/mongo.archive','databases/source.json','routes.json','domains.json']:
                file=root/name;file.parent.mkdir(exist_ok=True);file.write_text('{}')
            (root/'manifest.json').write_text(json.dumps(create_manifest(root,'test',[],'source-only-local')))
            with self.assertRaisesRegex(ValueError,'unsafe_restore_target'):
                restore_platform(root,root/'child',{},allow_local=True)
            self.assertFalse((root/'child').exists())
