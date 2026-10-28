import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioPage } from './page-create';
import { getPreset } from '../presets/catalog';
import type { SiteInstallation } from '../presets/site-model';
import type { Entry } from '../entry/models/main';
import { pageOperationIds } from './business';
const preset = getPreset('aeroframe', '1.0.0')!;
const site = { _id: 'site', presetId: preset.id, presetVersion: preset.version, updatedAt: 1, models: [{ key: 'content-page', templateId: 'content' }], pages: preset.pages.map(page => ({ ...page, status: 'draft' })) } as SiteInstallation;
const input = { title: 'Policy', path: '/policy', blueprintKey: 'content' };
const entry = { _id: pageOperationIds('site', 'op').entryId, templateId: 'content', meta: [] } as unknown as Entry;
test('route conflict fails before content write', async () => {
    let adds = 0;
    await assert.rejects(() => createStudioPage(site, 'op', entry, { ...input, path: '/collections' }, { findEntry: async () => null, addEntry: async e => { adds++; return e; }, saveSite: async () => true, findSite: async () => site }), /conflicts/);
    assert.equal(adds, 0);
});
test('lost response retry returns same page with one Entry', async () => {
    let current = site; let saved: Entry | null = null; let adds = 0;
    const source = { findEntry: async () => saved, addEntry: async (e: Entry) => { saved = e; adds++; return e; }, saveSite: async (s: SiteInstallation) => { current = s; return true; }, findSite: async () => current };
    const first = await createStudioPage(current, 'op', entry, input, source);
    const retry = await createStudioPage(current, 'op', entry, input, source);
    assert.equal(retry.key, first.key); assert.equal(adds, 1); assert.equal(current.pages.length, site.pages.length + 1);
});
test('CAS failure reports saved Entry and permits retry binding', async () => {
    let saved: Entry | null = null; let succeed = false;
    const source = { findEntry: async () => saved, addEntry: async (e: Entry) => saved = e, saveSite: async () => succeed, findSite: async () => site };
    await assert.rejects(() => createStudioPage(site, 'op', entry, input, source), /content saved as Entry/);
    succeed = true;
    assert.equal((await createStudioPage(site, 'op', entry, input, source)).entryId, entry._id);
});
