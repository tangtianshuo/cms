import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

MODULE = pathlib.Path(__file__).parents[1] / "nova_release_deploy.py"
spec = importlib.util.spec_from_file_location("nova_release_deploy", MODULE)
deploy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deploy
spec.loader.exec_module(deploy)

DIGEST = "sha256:" + "a" * 64
COMMIT = "b" * 40


class ReleaseTests(unittest.TestCase):
    def request(self, component="cms", number=1):
        return deploy.parse_request(component, f"deploy {DIGEST} {COMMIT} 1.0.0 {number}")

    def test_strict_fixed_repository_and_input_validation(self):
        self.assertEqual(self.request().image, "ghcr.io/tangtianshuo/cms@" + DIGEST)
        for command in ["sh", f"deploy {DIGEST};id {COMMIT} 1.0.0 1", f"deploy {DIGEST} {COMMIT} ../etc 1", f"deploy {DIGEST} {COMMIT} 01.0.0 1", f"deploy {DIGEST} {COMMIT} 1.0.0 -1"]:
            with self.assertRaises(ValueError):
                deploy.parse_request("cms", command)
        with self.assertRaises(ValueError):
            self.request("arbitrary")

    def test_compose_changes_only_selected_images(self):
        original = b"name: nova-cms-validation\nservices:\n  cms: {image: old-cms}\n  control: {image: old-gateway}\n  worker: {image: old-gateway}\n  mongo: {image: 'mongo:7'}\nvolumes: {mongo: {}}\n"
        import yaml
        for component, selected in [("cms", ["cms"]), ("gateway", ["control", "worker"])]:
            request = self.request(component)
            actual = yaml.safe_load(deploy.updated_compose(original, request))
            before = yaml.safe_load(original)
            for service in selected:
                before["services"][service]["image"] = request.image
            self.assertEqual(actual, before)

    def test_image_source_identity_is_enforced(self):
        request = self.request()
        deploy.validate_labels(request, {"org.opencontainers.image.revision": COMMIT, "org.opencontainers.image.version": "1.0.0"})
        with self.assertRaises(ValueError):
            deploy.validate_labels(request, {"org.opencontainers.image.revision": "c" * 40, "org.opencontainers.image.version": "1.0.0"})

    def harness(self, root, fail=False):
        outer = self
        class Harness(deploy.Deployer):
            def pull(self, request, token):
                self.actions.append("pull")
            def backup(self, request):
                self.actions.append("backup")
                return self.root / "backup"
            def apply(self, request):
                self.actions.append("apply")
                self.root.joinpath("compose.yaml").write_bytes(deploy.updated_compose(self.original, request))
            def verify(self):
                self.actions.append("verify")
                if fail and self.actions.count("verify") == 1:
                    raise RuntimeError("unhealthy candidate")
            def restore(self, request, original):
                self.actions.append("restore")
                self.root.joinpath("compose.yaml").write_bytes(original)
        result = Harness(pathlib.Path(root), pathlib.Path(root) / "backups")
        result.actions = []
        result.original = b"name: nova-cms-validation\nservices:\n  cms: {image: old-cms}\n  control: {image: old-gateway}\n  worker: {image: old-gateway}\n"
        result.root.joinpath("compose.yaml").write_bytes(result.original)
        return result

    def test_template_sync_does_not_replace_active_site_or_back_up_databases(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.harness(root)
            worker.deploy(self.request("templates"), "test-token")
            self.assertEqual(worker.actions, ["pull"])
            self.assertEqual(worker.root.joinpath("compose.yaml").read_bytes(), worker.original)
            self.assertEqual(json.loads(worker.current_path("templates").read_text())["digest"], DIGEST)

    def test_failed_candidate_restores_old_compose_before_reporting_failure(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.harness(root, fail=True)
            with self.assertRaisesRegex(RuntimeError, "unhealthy candidate"):
                worker.deploy(self.request(), "test-token")
            self.assertEqual(worker.actions, ["pull", "backup", "apply", "verify", "restore", "verify"])
            self.assertEqual(worker.root.joinpath("compose.yaml").read_bytes(), worker.original)
            self.assertFalse(worker.current_path("cms").exists())

    def test_stale_run_rejected_before_mutating_server(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.harness(root)
            worker.deploy(self.request(number=3), "test-token")
            worker.actions.clear()
            with self.assertRaisesRegex(ValueError, "stale"):
                worker.deploy(self.request(number=2), "test-token")
            self.assertEqual(worker.actions, [])

    def test_cms_recreates_network_namespace_sidecar(self):
        with tempfile.TemporaryDirectory() as root:
            worker = deploy.Deployer(pathlib.Path(root), pathlib.Path(root) / "backups")
            worker.root.joinpath("compose.yaml").write_text("services:\n  cms: {image: old}\n")
            commands = []
            worker.run = lambda args, **kwargs: commands.append(args) or ""
            worker.apply(self.request())
            remove = next(i for i, cmd in enumerate(commands) if "rm" in cmd and "cms-gateway-proxy" in cmd)
            up_cms = next(i for i, cmd in enumerate(commands) if "up" in cmd and cmd[-1] == "cms")
            up_proxy = next(i for i, cmd in enumerate(commands) if "up" in cmd and cmd[-1] == "cms-gateway-proxy")
            self.assertLess(remove, up_cms)
            self.assertLess(up_cms, up_proxy)


if __name__ == "__main__":
    unittest.main()
