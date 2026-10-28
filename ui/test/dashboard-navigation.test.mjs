import test from 'node:test';
import assert from 'node:assert/strict';
import { studioSection, isDashboardLinkActive } from '../src/layouts/dashboard/navigation.ts';

test('canonical sections handle old content links and invalid query values', () => {
  assert.equal(studioSection(undefined), 'overview');
  assert.equal(studioSection('content'), 'products');
  assert.equal(studioSection('release'), 'release');
  assert.equal(studioSection(['pages', 'release']), 'overview');
  assert.equal(studioSection('unknown'), 'overview');
});
test('sidebar distinguishes Studio sections and honors model and entry deep links', () => {
  const route = { path: '/d/studio', query: { section: 'content', modelKey: 'product', entryId: '123' } };
  assert.equal(isDashboardLinkActive(route, '/d/studio?section=products'), true);
  assert.equal(isDashboardLinkActive(route, '/d/studio?section=overview'), false);
  assert.equal(isDashboardLinkActive({ path: '/d/studio', query: {} }, '/d/studio?section=overview'), true);
});
test('administration matches nested routes on segment boundaries only', () => {
  assert.equal(isDashboardLinkActive({ path: '/d/template/123/entry/456', query: {} }, '/d/template'), true);
  assert.equal(isDashboardLinkActive({ path: '/d/template-other', query: {} }, '/d/template'), false);
  assert.equal(isDashboardLinkActive({ path: '/d/api-key/123', query: {} }, '/d/api-key'), true);
  assert.equal(isDashboardLinkActive({ path: '/d/media', query: {} }, '/d/studio?section=media'), false);
});
