#!/usr/bin/python3
"""Root-owned, fixed-component SSH deployment entry point for Nova releases."""
import dataclasses
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

import yaml

REPOSITORIES = {
    "cms": "ghcr.io/tangtianshuo/cms",
    "gateway": "ghcr.io/tangtianshuo/independent-website-gateway",
    "templates": "ghcr.io/tangtianshuo/independent-website-templates/aeroframe",
}
VERSION = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"


@dataclasses.dataclass(frozen=True)
class Request:
    component: str
    digest: str
    commit: str
    version: str
    run_number: int

    @property
    def image(self):
        return REPOSITORIES[self.component] + "@" + self.digest


def parse_request(component, original):
    if component not in REPOSITORIES:
        raise ValueError("component is not allowed")
    fields = shlex.split(original)
    if len(fields) != 5 or fields[0] != "deploy":
        raise ValueError("expected deploy DIGEST COMMIT VERSION RUN_NUMBER")
    _, digest, commit, version, number = fields
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("invalid digest")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("invalid source commit")
    if not re.fullmatch(VERSION, version):
        raise ValueError("invalid release version")
    if not re.fullmatch(r"[1-9][0-9]{0,11}", number):
        raise ValueError("invalid workflow run number")
    return Request(component, digest, commit, version, int(number))


def updated_compose(original, request):
    config = yaml.safe_load(original)
    services = ["cms"] if request.component == "cms" else ["control", "worker"]
    for service in services:
        config["services"][service]["image"] = request.image
    return yaml.safe_dump(config, sort_keys=False).encode()


def validate_labels(request, labels):
    if not labels or labels.get("org.opencontainers.image.revision") != request.commit:
        raise ValueError("image source revision does not match the release commit")
    if labels.get("org.opencontainers.image.version") != request.version:
        raise ValueError("image version does not match release version")


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=".release-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Deployer:
    def __init__(self, root=Path("/opt/novaintelligent/deploy"), backups=Path("/opt/novaintelligent/backups")):
        self.root = root
        self.backups = backups
        self.state = root / "releases"

    def run(self, args, capture=False, input_data=None, output=None, timeout=600):
        result = subprocess.run(args, cwd=self.root, check=True, input=input_data,
                                stdout=output if output is not None else subprocess.PIPE if capture else None,
                                stderr=None, timeout=timeout)
        return result.stdout.decode().strip() if capture else ""

    def compose(self, *args, **kwargs):
        return self.run(["docker", "compose", "-f", str(self.root / "compose.yaml"), *args], **kwargs)

    def current_path(self, component):
        return self.state / (component + ".current.json")

    def pull(self, request, token):
        print("Pulling verified image", request.image, flush=True)
        with tempfile.TemporaryDirectory(prefix="nova-registry-") as directory:
            docker = ["docker", "--config", directory]
            self.run([*docker, "login", "ghcr.io", "--username", "tangtianshuo", "--password-stdin"],
                     input_data=token.encode(), capture=True)
            self.run([*docker, "pull", request.image], timeout=600)
        labels = json.loads(self.run(["docker", "image", "inspect", request.image,
                                     "--format", "{{json .Config.Labels}}"], capture=True))
        validate_labels(request, labels)

    def backup(self, request):
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        destination = self.backups / ("release-" + request.component + "-" + timestamp)
        destination.mkdir(parents=True, mode=0o700)
        for name in ["compose.yaml", ".env", ".admin.json"]:
            source = self.root / name
            if source.exists():
                shutil.copyfile(source, destination / name)
                os.chmod(destination / name, 0o600)
        if (self.root / "state").exists():
            shutil.copytree(self.root / "state", destination / "state")
        database = "mongo" if request.component == "cms" else "postgres"
        container = self.compose("ps", "-q", database, capture=True)
        if not container:
            raise RuntimeError("database container is unavailable for backup")
        if request.component == "cms":
            command = 'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip'
            filename = "mongo.archive.gz"
        else:
            command = 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'
            filename = "postgres.dump"
        with (destination / filename).open("wb") as archive:
            self.run(["docker", "exec", container, "sh", "-c", command], output=archive)
        if not (destination / filename).stat().st_size:
            raise RuntimeError("database backup was empty")
        print("Backup saved", destination, flush=True)
        return destination

    def up(self, *services):
        self.compose("up", "-d", "--no-deps", "--wait", "--wait-timeout", "180", *services)

    def start_services(self, request):
        if request.component == "cms":
            # This sidecar shares the CMS network namespace and must follow its replacement.
            self.compose("stop", "cms-gateway-proxy")
            self.compose("rm", "-f", "cms-gateway-proxy")
            self.up("cms")
            self.up("cms-gateway-proxy")
        else:
            self.up("control", "worker")

    def apply(self, request):
        original = (self.root / "compose.yaml").read_bytes()
        atomic_write(self.root / "compose.yaml", updated_compose(original, request))
        self.compose("config", "--quiet")
        if request.component == "gateway":
            self.compose("stop", "worker")
            # Release migrations must remain backward compatible with the previous image.
            self.compose("run", "--rm", "--no-deps", "control", "npx", "prisma", "migrate", "deploy")
        self.start_services(request)

    def restore(self, request, original):
        atomic_write(self.root / "compose.yaml", original)
        self.start_services(request)

    def verify(self):
        for url in ["https://cms.novaintelligent.cn/", "https://shop.novaintelligent.cn/",
                    "https://shop.novaintelligent.cn/collections",
                    "https://shop.novaintelligent.cn/products/featured-product",
                    "https://shop.novaintelligent.cn/pages/about"]:
            self.run(["curl", "--fail", "--silent", "--show-error", "--retry", "3", "--retry-delay", "2",
                      "--max-time", "20", "--output", "/dev/null", url], timeout=100)

    def deploy(self, request, token):
        current = self.current_path(request.component)
        previous = json.loads(current.read_text()) if current.exists() else None
        if previous and request.run_number < previous["run_number"]:
            raise ValueError("stale workflow run cannot replace a newer deployment")
        self.pull(request, token)
        record = dataclasses.asdict(request)
        record["image"] = request.image
        record["time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if request.component != "templates":
            original = (self.root / "compose.yaml").read_bytes()
            backup = self.backup(request)
            record["backup"] = str(backup)
            try:
                self.apply(request)
                self.verify()
            except Exception as failure:
                print("Application deployment failed; restoring previous images", flush=True)
                try:
                    self.restore(request, original)
                    self.verify()
                except Exception as rollback:
                    raise RuntimeError("deployment failed and rollback requires operator attention: " + str(rollback)) from failure
                raise
        else:
            print("Template image synchronized; active site remains on its adopted version", flush=True)
        encoded = (json.dumps(record, indent=2) + "\n").encode()
        atomic_write(self.state / (request.component + "-" + str(request.run_number) + ".json"), encoded)
        atomic_write(current, encoded)
        print("Release delivered", request.component, request.version, request.commit, flush=True)


def main():
    if len(sys.argv) != 2:
        raise ValueError("fixed component argument required")
    request = parse_request(sys.argv[1], os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    token = sys.stdin.buffer.read(8193).decode().strip()
    if not token or len(token) > 8192 or any(char.isspace() for char in token):
        raise ValueError("registry token must be supplied over stdin")
    os.umask(0o077)
    worker = Deployer()
    descriptor = os.open(worker.root / ".release.lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        worker.deploy(request, token)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Release deployment failed:", str(error), file=sys.stderr)
        sys.exit(1)
