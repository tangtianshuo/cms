import assert from 'node:assert/strict';
import test from 'node:test';
import { toContractSnapshot } from '../dist/release-contract/snapshot.js';

const page = (id, version, path = '/') => ({
  path, pageKey: path === '/' ? 'home' : 'about', entryId: `${path}-entry`,
  content: { kind: 'preset-page', view: path === '/' ? 'home' : 'page', preset: { id, version, name: 'Demo', theme: {}, demo: {} }, sections: [], seo: { title: 'Page', description: '' } },
});

test('projects a CMS release into contract snapshot v1 without dropping renderer data', () => {
  const result = toContractSnapshot({ schemaVersion: 1, workspaceId: 'workspace', siteId: 'site', language: 'en', pages: [page('aeroframe', '1.0.3'), page('aeroframe', '1.0.3', '/about')], navigation: [], redirects: [], operations: { seoTitle: 'Demo' } });
  assert.equal(result.contractVersion, 1);
  assert.deepEqual(result.template, { id: 'aeroframe', version: '1.0.3' });
  assert.equal(result.pages[0].content.preset.name, 'Demo');
  assert.deepEqual(result.assets, []);
});

test('rejects a release with mixed template identities', () => {
  assert.throws(() => toContractSnapshot({ schemaVersion: 1, workspaceId: 'workspace', siteId: 'site', language: 'en', pages: [page('aeroframe', '1.0.3'), page('fireguard', '1.0.0', '/about')], navigation: [], redirects: [] }), /template identity/i);
});
