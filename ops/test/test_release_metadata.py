import importlib.util
from pathlib import Path
import unittest
import yaml

spec = importlib.util.spec_from_file_location("metadata", Path(__file__).parents[2] / ".github/scripts/release.py")
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)


class MetadataTests(unittest.TestCase):
    def test_release_image_receives_explicit_preview_origins(self):
        workflow = yaml.safe_load((Path(__file__).parents[2] / ".github/workflows/release.yml").read_text())
        steps = workflow["jobs"]["candidate"]["steps"]
        build = next(step for step in steps if step.get("id") == "build")
        args = build["with"]["build-args"]
        for name in ("VITE_STOREFRONT_ORIGIN", "VITE_TEMPLATE_PREVIEW_ORIGIN"):
            self.assertIn(f"{name}=${{{{ vars.{name} }}}}", args)

    def test_only_explicit_version_refs_publish(self):
        self.assertEqual(metadata.resolve("refs/heads/release/v1.2.3"), ("1.2.3", "true"))
        self.assertEqual(metadata.resolve("refs/tags/aeroframe-v1.0.1"), ("1.0.1", "true"))
        self.assertEqual(metadata.resolve("refs/heads/master"), ("", "false"))
        self.assertEqual(metadata.resolve("refs/pull/3/merge"), ("", "false"))

    def test_bad_versions_fail_before_publication(self):
        for value in ["refs/heads/release/v01.2.3", "refs/heads/release/v1.2", "refs/heads/release/v1.2.3/evil", "refs/heads/release/v1.2.3;id"]:
            with self.assertRaises(ValueError):
                metadata.resolve(value)

    def test_manual_verification_on_release_branch_cannot_deploy(self):
        self.assertEqual(metadata.resolve("refs/heads/release/v1.2.3", "workflow_dispatch"), ("1.2.3", "false"))


class PlatformGateWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).parents[2]
        self.workflow = yaml.safe_load((self.root / '.github/workflows/platform-gate.yml').read_text())

    def test_cross_repository_candidate_regression_is_required_after_exact_checkout(self):
        job = self.workflow['jobs']['platform-gate']
        steps = job['steps']
        command = 'python3 -m unittest ops.release.test_gateway_release_workflow -v'
        matches = [i for i, step in enumerate(steps) if step.get('run') == command]
        self.assertEqual(len(matches), 1, 'central gate must run the cross-repository regression')
        index = matches[0]
        regression = steps[index]
        self.assertEqual(regression['working-directory'], 'cms')
        self.assertEqual(regression.get('env', {}).get('PYTHONDONTWRITEBYTECODE'), '1')
        self.assertNotIn('if', regression)
        self.assertNotIn('continue-on-error', regression)
        self.assertNotIn('continue-on-error', job)
        self.assertEqual(job['env']['E2E_GATEWAY_ROOT'], '${{ github.workspace }}/gateway')
        checkouts = [(i, step) for i, step in enumerate(steps) if step.get('uses', '').startswith('actions/checkout@')]
        self.assertEqual(len(checkouts), 4)
        self.assertTrue(all(i < index for i, _ in checkouts))
        gateway = next(step for _, step in checkouts if step['with']['path'] == 'gateway')
        self.assertEqual(gateway['with']['ref'], '${{ needs.resolve.outputs.gateway }}')
        dependency = next(i for i, step in enumerate(steps) if step.get('run') == 'python3 -m pip install PyYAML==6.0.3')
        self.assertLess(dependency, index)
        build = next(i for i, step in enumerate(steps) if step.get('name') == 'Install and build locked CMS and Gateway')
        self.assertLess(index, build)

    def test_deployment_only_follows_gate_and_uses_its_exact_digests(self):
        job = self.workflow['jobs']['deploy']
        self.assertEqual(job['needs'], 'platform-gate')
        self.assertNotIn('continue-on-error', job)
        self.assertIn('needs.platform-gate.outputs.deployments', job['strategy']['matrix']['target'])
        steps = job['steps']
        deploy = next(s for s in steps if s.get('name') == 'Deploy the exact verified candidate digest')
        self.assertEqual(deploy['env']['IMAGE_DIGEST'], '${{ matrix.target.digest }}')
        self.assertEqual(deploy['env']['LOCKED_COMMIT'], '${{ matrix.target.commit }}')
        self.assertNotIn('build-push-action', str(job))
        self.assertNotIn(':latest', str(job))
        self.assertIn('sha256sum -c', str(job))
        self.assertIn('gh attestation verify', str(job))
        release = yaml.safe_load((self.root / '.github/workflows/release.yml').read_text())
        self.assertNotIn('bash .github/scripts/deploy.sh', str(release))

    def test_gate_checks_out_four_complete_shas_and_runs_owned_acceptance(self):
        job = self.workflow['jobs']['platform-gate']
        checkouts = [s for s in job['steps'] if s.get('uses', '').startswith('actions/checkout@')]
        self.assertEqual(len(checkouts), 4)
        for key, step in zip(['cms', 'gateway', 'templates', 'preview'], checkouts):
            self.assertEqual(step['with']['ref'], '${{ needs.resolve.outputs.' + key + ' }}')
        self.assertIn('node ops/e2e/test.mjs platform-gate', str(job))
        self.assertNotIn('continue-on-error', str(job))
        self.assertNotIn('/Users/', str(job))
        upload = next(s for s in job['steps'] if s.get('uses', '').startswith('actions/upload-artifact@'))
        self.assertTrue(upload['with']['path'].endswith('/launch/platform-gate-receipt.json'))
        self.assertNotIn('**', upload['with']['path'])
