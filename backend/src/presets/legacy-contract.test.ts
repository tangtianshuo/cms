import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { SiteDomain } from '../site-domains/model';
import { DomainService, normalizeHostname, type DomainSource } from '../site-domains/service';
import type { Template } from '../template/models/main';
import { ObjectUtility } from '../_utils/object-utility';
import { getPreset } from './catalog';
import { buildRelease, type ReleaseInput } from './releases';
import { SiteInstallationSchema, type SiteInstallation } from './site-model';

const preset = getPreset('aeroframe', '1.0.0')!;

test('aeroframe 1.0.0 exposes the legacy models and page blueprints', () => {
    assert.equal(preset.id, 'aeroframe');
    assert.equal(preset.version, '1.0.0');
    assert.deepEqual(preset.models.map(({ key, singleEntry }) => ({ key, singleEntry })), [
        { key: 'product', singleEntry: false },
        { key: 'collection', singleEntry: false },
        { key: 'home', singleEntry: true },
        { key: 'content-page', singleEntry: false },
        { key: 'site-settings', singleEntry: true },
    ]);
    assert.deepEqual(preset.pages.map(({ key, path, modelKey }) => ({ key, path, modelKey })), [
        { key: 'home', path: '/', modelKey: 'home' },
        { key: 'collections', path: '/collections', modelKey: 'collection' },
        { key: 'product', path: '/products/:slug', modelKey: 'product' },
        { key: 'content', path: '/pages/:slug', modelKey: 'content-page' },
    ]);
});

function legacyInput(): ReleaseInput {
    const values: Record<string, Record<string, unknown[]>> = {
        home: { title: ['Home'], slug: ['home'], headline: ['Mission ready'] },
        product: { title: ['Aero X8'], slug: ['aero-x8'], price: [8490] },
        collection: { title: ['Aircraft'], slug: ['aircraft'], products: [{ tid: 'product', eid: 'product-entry' }] },
        'content-page': { title: ['About'], slug: ['about'] },
        'site-settings': { title: ['Settings'], slug: ['settings'], brandName: ['AEROWORKS'],
            navigationPages: [{ tid: 'content-page', eid: 'content-page-entry' }] },
    };
    const site: SiteInstallation = {
        _id: 'legacy-site', createdAt: 1, updatedAt: 1, slot: 'default', name: 'Legacy AeroFrame',
        presetId: preset.id, presetVersion: preset.version, currentReleaseId: 'existing-release',
        status: 'ready', importError: '', includeDemo: false, demoSeeded: false, theme: { ...preset.theme },
        models: preset.models.map((model) => ({ key: model.key, templateId: model.key,
            fields: model.fields.map((field) => ({ key: field.key, propId: field.key })) })),
        pages: preset.pages.map((page) => ({ ...page, status: 'draft', seoDescription: 'Site information' })),
    };
    return {
        site,
        templates: preset.models.map((model) => ({ _id: model.key, props: model.fields.map((field) => ({
            id: field.key, name: field.key, type: field.type, array: field.array, required: field.required,
        })) } as Template)),
        entries: preset.models.map((model) => ({ _id: `${model.key}-entry`, templateId: model.key,
            meta: [{ lng: 'en', props: Object.entries(values[model.key]).map(([id, data]) => ({ id, data })) }],
        } as Entry)),
        media: [], language: 'en', mediaOrigin: 'https://cms.test', currency: 'USD',
    };
}

test('legacy installation conforms to the site schema with preset pins and optional release pin', () => {
    const { site } = legacyInput();
    assert.equal(ObjectUtility.compareWithSchema(site, SiteInstallationSchema), undefined);
    assert.equal(site.presetId, 'aeroframe');
    assert.equal(site.presetVersion, '1.0.0');
    assert.equal(site.currentReleaseId, 'existing-release');
    assert.equal('imageDigest' in site, false);
    assert.equal('templatePin' in site, false);
    assert.equal(ObjectUtility.compareWithSchema({ ...site, presetVersion: undefined }, SiteInstallationSchema)?.errorCode, 'e3');
    assert.equal(ObjectUtility.compareWithSchema({ ...site, currentReleaseId: undefined }, SiteInstallationSchema), undefined);
});

test('legacy buildRelease writes a version 1 snapshot with concrete pages for its site', () => {
    const snapshot = buildRelease(legacyInput());
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.siteId, 'legacy-site');
    assert.equal(snapshot.pages.find((page) => page.pageKey === 'home')?.content.preset.demo.hero.title, 'Mission ready');
    assert.deepEqual(snapshot.pages.map(({ pageKey, path }) => ({ pageKey, path })), [
        { pageKey: 'home', path: '/' },
        { pageKey: 'collections', path: '/collections' },
        { pageKey: 'product', path: '/products/aero-x8' },
        { pageKey: 'content', path: '/pages/about' },
    ]);
});

test('legacy domain resolves for its site only after ownership verification and a successful connection timestamp', async () => {
    const site = { _id: legacyInput().site._id, primaryDomainId: 'domain', domainRevision: 2 };
    const domain: SiteDomain = {
        _id: 'domain', createdAt: 1, updatedAt: 1, siteId: site._id,
        hostname: normalizeHostname('SHOP.Example.COM.'), enabled: true, ownershipStatus: 'pending', connectionStatus: 'unchecked',
        verificationTokenHash: '', verificationExpiresAt: 0, verifiedAt: 0,
        lastCheckedAt: 0, lastSuccessAt: 0, dnsReady: false, lastError: '',
    };
    const source = {
        findHost: async (host: string) => host === domain.hostname ? domain : null,
        findSiteById: async (id: string) => id === site._id ? site : null,
        findId: async (id: string) => id === domain._id ? domain : null,
    } as DomainSource;
    const service = new DomainService(source, { secret: '', entryHost: '', entryIp: '', localHost: '' });
    assert.equal(await service.resolve('SHOP.Example.COM.'), null);
    domain.ownershipStatus = 'verified';
    assert.equal(await service.resolve(domain.hostname), null);
    domain.lastSuccessAt = 1;
    assert.deepEqual(await service.resolve('SHOP.Example.COM.'), {
        workspaceId: 'default', siteId: site._id, hostname: 'shop.example.com',
        primaryHostname: domain.hostname, bindingRevision: 2,
    });
    assert.equal(await service.resolve('https://shop.example.com'), null);
    domain.enabled = false;
    assert.equal(await service.resolve(domain.hostname), null);
    domain.enabled = true;
    domain.siteId = 'another-site';
    assert.equal(await service.resolve(domain.hostname), null);
});
