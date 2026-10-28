"""Check the real CMS response policy: CMS_CACHE_TEST_ORIGIN=http://... ."""
import os
import re
import unittest
import urllib.error
import urllib.request
from html.parser import HTMLParser


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        path = attrs.get("src") if tag == "script" else attrs.get("href") if tag == "link" else None
        if path and re.fullmatch(r"/assets/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)", path):
            self.paths.append(path)


@unittest.skipUnless(os.environ.get("CMS_CACHE_TEST_ORIGIN"), "set CMS_CACHE_TEST_ORIGIN for live HTTP checks")
class StaticCacheTests(unittest.TestCase):
    def request(self, path, method="GET", data=None):
        request = urllib.request.Request(
            os.environ["CMS_CACHE_TEST_ORIGIN"].rstrip("/") + path,
            headers={"Host": "cms.novaintelligent.cn", "Content-Type": "application/json"},
            method=method, data=data,
        )
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_hashed_javascript_and_css_are_public_and_immutable(self):
        status, _, html = self.request("/")
        self.assertEqual(status, 200)
        assets = Assets()
        assets.feed(html.decode())
        self.assertTrue(any(path.endswith(".js") for path in assets.paths))
        self.assertTrue(any(path.endswith(".css") for path in assets.paths))
        for path in assets.paths:
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                self.assertEqual(status, 200)
                self.assertTrue(body)
                self.assertIn(headers.get_content_type(), ["application/javascript", "text/javascript", "text/css"])
                self.assertEqual(headers.get_all("Cache-Control"), ["public, max-age=31536000, immutable"])

    def test_html_entrypoints_are_never_stored(self):
        for path in ["/", "/d/presets"]:
            with self.subTest(path=path):
                status, headers, _ = self.request(path)
                self.assertEqual(status, 200)
                self.assertEqual(headers.get_content_type(), "text/html")
                self.assertEqual(headers.get_all("Cache-Control"), ["no-store"])

    def test_missing_hashed_asset_does_not_cache_spa_fallback(self):
        _, headers, _ = self.request("/assets/cache-policy-missing-deadbeef.js")
        self.assertEqual(headers.get_all("Cache-Control"), ["no-store"])

    def test_preview_and_health_responses_are_never_stored(self):
        for path, method, data in [
            ("/api/v4/health-check", "HEAD", None),
            ("/api/v4/storefront/page-preview", "POST", b"{}"),
        ]:
            with self.subTest(path=path):
                status, headers, _ = self.request(path, method, data)
                self.assertIn(status, [200, 400, 401, 403])
                self.assertEqual(headers.get_all("Cache-Control"), ["no-store"])


if __name__ == "__main__":
    unittest.main()
