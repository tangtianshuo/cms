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
    const source = { findEntry: async () => saved, addEntry: async (e: Entry) => { saved = e; adds++; return e; }, saveSite: async (s: SiteInstallation) => { s.pages.find(candidate => candidate.entryId === entry._id)!.creationReceipt!.siteUpdatedAt = s.updatedAt; current = s; return true; }, findSite: async () => current };
    const first = await createStudioPage(current, 'op', entry, input, source, 1);
    const retry = await createStudioPage(current, 'op', entry, input, source, 1);
    assert.equal(retry.key, first.key); assert.equal(adds, 1); assert.equal(current.pages.length, site.pages.length + 1);
});
test('CAS failure reports saved Entry and permits retry binding', async () => {
    let saved: Entry | null = null; let succeed = false;
    const source = { findEntry: async () => saved, addEntry: async (e: Entry) => saved = e, saveSite: async () => succeed, findSite: async () => site };
    await assert.rejects(() => createStudioPage(site, 'op', entry, input, source), /content saved as Entry/);
    succeed = true;
    assert.equal((await createStudioPage(site, 'op', entry, input, source)).entryId, entry._id);
});

test('content page instances accept concrete paths from both supported UAT forms', async () => {
    for (const path of ['/uat-acceptance', '/pages/uat-acceptance']) {
        const operationId = `op-${path.includes('/pages/') ? 'prefixed' : 'root'}`;
        const id = pageOperationIds('site', operationId);
        const contentEntry = { ...entry, _id: id.entryId } as Entry;
        let saved: Entry | null = null;
        const source = {
            findEntry: async () => saved,
            addEntry: async (value: Entry) => { saved = value; return value; },
            saveSite: async () => true,
            findSite: async () => site,
        };
        const created = await createStudioPage(site, operationId, contentEntry, { ...input, path }, source);
        assert.equal(created.path, path);
        assert.equal(created.blueprintKey, 'content');
    }
});

test('same operation rejects changed full content, status and group after a lost response', async () => {
    let current = site; let saved: Entry | null = null; let adds = 0;
    const full = { ...entry, groupId: 'general', statuses: [{ lng: 'en', id: 'draft' }], content: [{ lng: 'en', nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }], plainText: '<p>Original body</p>' }] } as Entry;
    const source = { findEntry: async () => saved, addEntry: async (value: Entry) => { adds++; saved = value; return value; }, saveSite: async (value: SiteInstallation) => { value.pages.find(page => page.entryId === entry._id)!.creationReceipt!.siteUpdatedAt = value.updatedAt; current = value; return true; }, findSite: async () => current };
    const created = await createStudioPage(current, 'op', full, input, source);
    assert.equal((await createStudioPage(current, 'op', structuredClone(full), input, source, 1)).key, created.key);
    for (const patch of [{ groupId: 'changed' }, { statuses: [{ lng: 'en', id: 'other' }] }, { content: [{ lng: 'en', nodes: [], plainText: '' }] }]) {
        await assert.rejects(() => createStudioPage(current, 'op', { ...full, ...patch } as Entry, input, source), /changed/);
    }
    assert.equal(adds, 1);
});

test('creation returns the exact CAS receipt and rejects replay after another site edit', async () => {
    let current = structuredClone(site); let saved: Entry | null = null;
    const source = { findEntry: async () => saved, addEntry: async (e: Entry) => saved = e,
        saveSite: async (s: SiteInstallation) => { s.updatedAt = 42; const page = s.pages.find(page => page.entryId === entry._id)!; page.creationReceipt = { expectedUpdatedAt: 1, siteUpdatedAt: 42 }; s.pages.find(candidate => candidate.entryId === entry._id)!.creationReceipt!.siteUpdatedAt = s.updatedAt; current = s; return true; }, findSite: async () => current };
    const first = await createStudioPage(current, 'op', entry, input, source, 1);
    assert.equal(first.siteUpdatedAt, 42);
    assert.equal('creationReceipt' in first, false);
    assert.equal((await createStudioPage(current, 'op', entry, input, source, 1)).siteUpdatedAt, 42);
    current = { ...current, updatedAt: 43 };
    await assert.rejects(() => createStudioPage(current, 'op', entry, input, source, 1), (cause:any) => cause.status === 409);
});
test('a concurrent CAS loser never adopts another writer site version as its receipt', async () => {
    let saved: Entry | null = null; let latest=site;
    const source = { findEntry:async()=>saved, addEntry:async(e:Entry)=>saved=e, saveSite:async(s:SiteInstallation)=>{latest={...s,updatedAt:99};return false;}, findSite:async()=>latest };
    await assert.rejects(()=>createStudioPage(site,'op',entry,input,source,1),(cause:any)=>cause.status===409);
});
test('first creation confirms complete writable page semantics and rejects any changed replay', async () => {
    let current = structuredClone(site); let saved: Entry | null = null;
    const source = { findEntry: async () => saved, addEntry: async (value: Entry) => saved = value, saveSite: async (value: SiteInstallation) => { value.pages.find(page => page.entryId === entry._id)!.creationReceipt!.siteUpdatedAt = value.updatedAt; current = value; return true; }, findSite: async () => current };
    const page = { seoTitle: 'Search policy', seoDescription: 'Policy description', sections: ['info-grid'], sectionConfigs: [{ type: 'info-grid', enabled: true, data: { items: [{ title: 'First section' }] } }], enabled: false, navigation: false };
    const first = await createStudioPage(current, 'op', entry, { ...input, page }, source, 1);
    assert.equal(first.seoTitle, page.seoTitle); assert.equal(first.seoDescription, page.seoDescription); assert.equal(first.enabled, false); assert.equal(first.navigation, false);
    assert.equal((await createStudioPage(current, 'op', entry, { ...input, page }, source, 1)).key, first.key);
    for (const patch of [{ seoTitle: 'Changed' }, { seoDescription: 'Changed' }, { enabled: true }, { navigation: true }, { sectionConfigs: [{ type: 'info-grid', enabled: true, data: { items: [{ title: 'Changed' }] } }] }]) await assert.rejects(() => createStudioPage(current, 'op', entry, { ...input, page: { ...page, ...patch } }, source, 1), (error: any) => error.status === 409);
});
