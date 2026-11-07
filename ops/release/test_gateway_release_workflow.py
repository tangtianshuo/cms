import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import yaml


class GatewayCandidateWorkflowTests(unittest.TestCase):
    def test_gateway_candidate_condition_consumes_real_release_output(self):
        gateway = Path(os.environ['E2E_GATEWAY_ROOT'])
        workflow = yaml.safe_load((gateway / '.github/workflows/release.yml').read_text())
        job = workflow['jobs']['candidate']
        condition = re.fullmatch(r"needs\.([\w-]+)\.outputs\.([\w-]+) == 'true'", job['if'])
        self.assertIsNotNone(condition, 'candidate condition must consume a verification output')
        producer_id, output_id = condition.groups()
        needs = job['needs'] if isinstance(job['needs'], list) else [job['needs']]
        self.assertIn(producer_id, needs)
        producer = workflow['jobs'][producer_id]
        self.assertIn(output_id, producer['outputs'], 'candidate condition references an unexported output')
        binding = re.fullmatch(r'\$\{\{ steps\.([\w-]+)\.outputs\.([\w-]+) \}\}', producer['outputs'][output_id])
        self.assertIsNotNone(binding)
        step_id, step_output = binding.groups()
        release = next(step for step in producer['steps'] if step.get('id') == step_id)
        # Execute the real metadata producer and follow the workflow's output
        # mapping, so a renamed export cannot silently disable valid candidates.
        for ref, event, expected in [
            ('refs/heads/release/v1.2.3', 'push', True),
            ('refs/heads/master', 'push', False),
            ('refs/pull/3/merge', 'pull_request', False),
            ('refs/heads/release/v1.2.3', 'workflow_dispatch', False),
        ]:
            with self.subTest(ref=ref, event=event), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'outputs'
                env = dict(os.environ, GITHUB_REF=ref, GITHUB_EVENT_NAME=event, GITHUB_OUTPUT=str(output))
                result = subprocess.run(['bash', '-e', '-c', release['run']], cwd=gateway, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                values = dict(line.split('=', 1) for line in output.read_text().splitlines())
                self.assertIn(step_output, values)
                self.assertEqual(values[step_output] == 'true', expected)
