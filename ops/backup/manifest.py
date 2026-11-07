"""Private backup manifest: exact files, no symlinks, lock-byte binding."""
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path


def safe_file(root: Path, name: str) -> Path:
    relative = Path(name)
    if not isinstance(name, str) or relative.is_absolute() or '..' in relative.parts or relative.as_posix() != name or name in ('', '.'):
        raise ValueError('unsafe_backup_path')
    root = root.resolve()
    candidate = root / relative
    for ancestor in [candidate, *candidate.parents]:
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise ValueError('unsafe_backup_path')
    if not candidate.resolve().is_relative_to(root):
        raise ValueError('unsafe_backup_path')
    if not candidate.exists():
        raise ValueError('backup_missing_file')
    if not candidate.is_file():
        raise ValueError('unsafe_backup_path')
    return candidate


def file_identity(path: Path):
    checksum, size = hashlib.sha256(), 0
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            checksum.update(block)
            size += len(block)
    return checksum.hexdigest(), size


def create_manifest(root: Path, backup_id: str, sites: list, evidence_type: str) -> dict:
    files = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('unsafe_backup_path')
        if path.is_dir():
            continue
        checksum, size = file_identity(safe_file(root, path.relative_to(root).as_posix()))
        files.append(dict(path=path.relative_to(root).as_posix(), sha256=checksum, size=size))
    return dict(schemaVersion=1, backupId=backup_id, createdAt=datetime.now(timezone.utc).isoformat(),
                lockChecksum='sha256:' + hashlib.sha256((root / 'platform-lock.json').read_bytes()).hexdigest(),
                evidenceType=evidence_type, files=files, sites=sites)


def verify_backup(root: Path, manifest: dict) -> None:
    if root.is_symlink() or not root.is_dir():
        raise ValueError('unsafe_backup_path')
    if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'), list) or not isinstance(manifest.get('sites'), list):
        raise ValueError('invalid_backup_manifest')
    seen = set()
    for item in manifest['files']:
        name = item['path']
        if name in seen:
            raise ValueError('duplicate_backup_path')
        seen.add(name)
        checksum, size = file_identity(safe_file(root, name))
        if not isinstance(item['size'], int) or item['size'] < 0 or not re.fullmatch('[a-f0-9]{64}', item['sha256']):
            raise ValueError('invalid_backup_manifest')
        if size != item['size'] or checksum != item['sha256']:
            raise ValueError('backup_checksum_mismatch')
    actual = set()
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError('unsafe_backup_path')
        if not path.is_dir() and path != root / 'manifest.json':
            actual.add(path.relative_to(root).as_posix())
    if actual != seen:
        raise ValueError('unlisted_backup_file')
    lock = safe_file(root, 'platform-lock.json').read_bytes()
    if 'platform-lock.json' not in seen or manifest.get('lockChecksum') != 'sha256:' + hashlib.sha256(lock).hexdigest():
        raise ValueError('lock_checksum_mismatch')
