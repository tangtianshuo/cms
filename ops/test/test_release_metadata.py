import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("metadata", Path(__file__).parents[2] / ".github/scripts/release.py")
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)


class MetadataTests(unittest.TestCase):
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
