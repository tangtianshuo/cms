"""Source-only drill bridge. Lifecycle belongs to the task-owned Node fixture."""
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ops.backup.platform_backup import DockerDatabases, backup_platform, copy_private
from ops.restore.platform_restore import restore_platform

config = json.loads(Path(sys.argv[2]).read_text())
if sys.argv[1] == 'backup':
    class PausedOwnedProcesses:
        def inventory(self):
            for pid in config['stoppedPids']:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    continue
                raise ValueError('owned_writer_still_alive')
            return set()
        def pause(self, names): self.inventory()
        def assert_paused(self): self.inventory()
        def resume(self, names): pass  # Node fixture finally restores only its original set.
    def capture(root):
        for name, source in config['paths'].items():
            copy_private(source, root / name)
    database = DockerDatabases(config['databases'])
    manifest = backup_platform(Path(config['backup']), PausedOwnedProcesses(), database, capture, database.sites, 'source-only-local')
    print(json.dumps({'backupId': manifest['backupId']}))
elif sys.argv[1] == 'restore':
    receipt = restore_platform(Path(config['backup']), Path(config['restore']), config['databases'], allow_local=True)
    print(json.dumps(receipt))
else:
    raise ValueError('unknown_drill_phase')
