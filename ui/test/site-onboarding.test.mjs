import test from 'node:test';
import assert from 'node:assert/strict';
import * as onboarding from '../src/views/dashboard/site-onboarding-state.ts';

const template = {
    id: 'market',
    version: '1.0.0',
    name: 'Market',
    description: 'Shop',
    heroImage: '/cover.jpg',
    theme: {
        background: '#fff',
        foreground: '#111',
        accent: '#2563eb',
        muted: '#666',
        font: 'sans-serif',
    },
};
const empty = (id = 'site-a') => ({
    _id: id,
    name: 'My shop',
    status: 'empty',
    presetId: '',
    presetVersion: '',
    includeDemo: false,
    updatedAt: 1,
    models: [],
    pages: [],
});
const installation = (status = 'importing') => ({
    ...empty(),
    status,
    presetId: 'market',
    presetVersion: '1.0.0',
    name: 'Saved name',
    includeDemo: true,
    updatedAt: 100,
});
const storage = () => {
    const data = new Map();
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key),
    };
};
function harness(options = {}) {
    const requests = [],
        selections = [];
    let current = options.site ?? empty(options.scope?.siteId || 'site-a');
    let sites = options.sites ?? [];
    const store = options.storage ?? storage();
    const scope = {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        siteId: 'site-a',
        admin: true,
        ...options.scope,
    };
    const sdk = {
        async send(request) {
            requests.push(request);
            if (options.send) {
                const result = await options.send(request);
                if (result !== undefined) return result;
            }
            if (request.url === '/api/v4/presets/catalog')
                return { items: [template] };
            if (request.url === '/api/v4/presets/site')
                return { site: current, checklist: [], pageOptions: {} };
            if (request.url.startsWith('/api/v4/presets/plan/'))
                return {
                    plan: {
                        presetId: 'market',
                        version: '1.0.0',
                        models: [],
                        pages: [],
                    },
                    installedSite: current,
                };
            if (
                request.url === '/api/v4/workspaces/current/sites' &&
                request.method === 'POST'
            ) {
                const site = empty('new-site');
                sites.push(site);
                return site;
            }
            if (request.url === '/api/v4/workspaces/current/sites')
                return { items: sites };
            if (request.url === '/api/v4/presets/import') {
                current = {
                    ...installation(),
                    _id: request.selectorOverride.siteId,
                };
                return current;
            }
            throw new Error(`Unexpected request ${request.url}`);
        },
        async selectContext(selection, destination) {
            selections.push({ selection, destination });
        },
    };
    assert.equal(
        typeof onboarding.createSiteOnboarding,
        'function',
        'a real onboarding controller must exist',
    );
    const controller = onboarding.createSiteOnboarding({
        sdk,
        storage: store,
        scope,
        now: () => 1000,
    });
    return {
        controller,
        requests,
        selections,
        storage: store,
        setSite: (value) => {
            current = value;
        },
    };
}
async function content(h) {
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'My shop', includeDemo: true });
    await h.controller.next();
}

test('steps require a chosen template and a trimmed nonempty site name before import', async () => {
    const h = harness();
    await h.controller.load();
    assert.equal(h.controller.state.step, 'template');
    assert.equal(await h.controller.next(), false);
    h.controller.chooseTemplate(template);
    assert.equal(await h.controller.next(), true);
    h.controller.update({ siteName: '   ' });
    assert.equal(await h.controller.next(), false);
    assert.equal(h.controller.state.step, 'identity');
    h.controller.update({ siteName: ' New shop ' });
    assert.equal(await h.controller.next(), true);
    assert.equal(h.controller.state.step, 'content');
    assert.equal(
        await h.controller.next(),
        false,
        'preview requires a completed import',
    );
    assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
});

test('selection and options resume only for the same user, workspace and site', async () => {
    const h = harness();
    await content(h);
    const resumed = harness({ storage: h.storage });
    await resumed.controller.load();
    assert.equal(resumed.controller.state.step, 'content');
    assert.equal(resumed.controller.state.presetId, 'market');
    assert.equal(resumed.controller.state.includeDemo, true);
    for (const scope of [
        { userId: 'other' },
        { workspaceId: 'other' },
        { siteId: 'other' },
    ]) {
        const isolated = harness({ storage: h.storage, scope });
        await isolated.controller.load();
        assert.equal(isolated.controller.state.step, 'template');
        assert.equal(isolated.controller.state.presetId, '');
    }
});

test('an importing response is persisted and refresh polls the same site without another import', async () => {
    const h = harness();
    await content(h);
    await h.controller.importSite();
    assert.equal(h.controller.site.status, 'importing');
    const resumed = harness({ storage: h.storage, site: installation() });
    await resumed.controller.load();
    assert.equal(resumed.controller.state.includeDemo, true);
    assert.equal(resumed.controller.state.siteName, 'Saved name');
    assert.equal(resumed.controller.state.step, 'content');
    await resumed.controller.importSite();
    assert.equal(resumed.requests.filter((r) => r.method === 'POST').length, 0);
    resumed.setSite(installation('ready'));
    await resumed.controller.refresh();
    assert.equal(resumed.controller.state.step, 'content');
    assert.equal(await resumed.controller.next(), true);
    assert.equal(resumed.controller.state.step, 'preview');
    assert.equal(await resumed.controller.next(), true);
    assert.equal(resumed.controller.state.step, 'publish');
});

test('a lost import response remains pending even if a subsequent read still sees the empty site', async () => {
    const h = harness({
        send: async (r) => {
            if (r.url === '/api/v4/presets/import')
                throw new Error('response lost');
        },
    });
    await content(h);
    await assert.rejects(h.controller.importSite(), /response lost/);
    assert.equal(h.controller.state.importRequested, true);
    const resumed = harness({ storage: h.storage });
    await resumed.controller.load();
    await resumed.controller.importSite();
    assert.equal(resumed.requests.filter((r) => r.method === 'POST').length, 0);
    resumed.setSite(installation('ready'));
    await resumed.controller.refresh();
    assert.equal(resumed.controller.site.status, 'ready');
});

test('ready sites are never imported, adopted or renamed by opening or navigating the wizard', async () => {
    const h = harness({ site: installation('ready') });
    await h.controller.load();
    assert.equal(h.controller.state.step, 'content');
    h.controller.chooseTemplate({ ...template, id: 'other' });
    h.controller.update({ siteName: 'Overwrite', includeDemo: false });
    h.controller.back();
    await h.controller.importSite();
    assert.equal(h.controller.state.presetId, 'market');
    assert.equal(h.controller.state.siteName, 'Saved name');
    assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
    assert.equal(h.controller.state.step, 'content');
});

test('without a selected site the wizard creates an empty site, persists progress and selects it before import', async () => {
    const h = harness({ scope: { siteId: undefined }, site: null });
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'My shop' });
    await h.controller.next();
    assert.deepEqual(h.selections, [
        {
            selection: { workspaceId: 'workspace-a', siteId: 'new-site' },
            destination: '/d/site-setup',
        },
    ]);
    assert.equal(
        h.requests.filter((r) => r.url === '/api/v4/presets/import').length,
        0,
    );
    const post = h.requests.find((r) => r.method === 'POST');
    assert.deepEqual(post.selectorOverride, { workspaceId: 'workspace-a' });
    const resumed = harness({
        storage: h.storage,
        scope: { siteId: 'new-site' },
        site: empty('new-site'),
    });
    await resumed.controller.load();
    assert.equal(resumed.controller.state.step, 'content');
    assert.equal(resumed.controller.state.presetId, 'market');
    await resumed.controller.importSite();
    assert.deepEqual(
        resumed.requests.find((r) => r.url === '/api/v4/presets/import')
            .selectorOverride,
        { workspaceId: 'workspace-a', siteId: 'new-site' },
    );
});

test('lost site creation responses reconcile a new matching site instead of posting another site', async () => {
    const store = storage();
    const h = harness({
        storage: store,
        scope: { siteId: undefined },
        sites: [empty('old')],
        send: async (r) => {
            if (
                r.url === '/api/v4/workspaces/current/sites' &&
                r.method === 'POST'
            )
                throw new Error('response lost');
        },
    });
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'My shop' });
    await assert.rejects(h.controller.next(), /response lost/);
    const resumed = harness({
        storage: store,
        scope: { siteId: undefined },
        sites: [empty('old'), empty('created')],
    });
    await resumed.controller.load();
    await resumed.controller.next();
    assert.equal(resumed.requests.filter((r) => r.method === 'POST').length, 0);
    assert.equal(
        resumed.selections.length,
        0,
        'matching names require an explicit recovery choice',
    );
    assert.equal(resumed.controller.creationCandidates[0]._id, 'created');
    await resumed.controller.recoverCreation('created');
    assert.equal(resumed.selections[0].selection.siteId, 'created');
});

test('uncertain creation stays recoverable without a second POST or accidentally using an old site', async () => {
    const h = harness({
        scope: { siteId: undefined },
        sites: [empty('old')],
        send: async (r) => {
            if (
                r.url === '/api/v4/workspaces/current/sites' &&
                r.method === 'POST'
            )
                throw new Error('response lost');
        },
    });
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'My shop' });
    await assert.rejects(h.controller.next());
    const resumed = harness({
        storage: h.storage,
        scope: { siteId: undefined },
        sites: [empty('old')],
    });
    await resumed.controller.load();
    await resumed.controller.next();
    await resumed.controller.next();
    assert.equal(resumed.requests.filter((r) => r.method === 'POST').length, 0);
    assert.equal(resumed.selections.length, 0);
    assert.ok(resumed.controller.state.creation);
});

test('public import pins the verified version/checksum and rejects conflicts or changed installed identity', async () => {
    const h = harness({
        send: async (r) =>
            r.url.startsWith('/api/v4/presets/plan/')
                ? {
                      plan: {
                          presetId: 'market',
                          version: '2.0.0',
                          models: [],
                          pages: [],
                      },
                  }
                : undefined,
    });
    await h.controller.load();
    h.controller.chooseTemplate({
        ...template,
        sourceCommit: 'abc',
        version: '2.0.0',
        manifestChecksum: 'sha256:verified',
    });
    await h.controller.next();
    h.controller.update({ siteName: 'Shop' });
    await h.controller.next();
    await h.controller.importSite();
    assert.deepEqual(
        h.requests.find((r) => r.url === '/api/v4/presets/import').data,
        {
            presetId: 'market',
            siteName: 'Shop',
            includeDemo: false,
            mode: 'import',
            presetVersion: '2.0.0',
            manifestChecksum: 'sha256:verified',
        },
    );
    const changed = harness();
    await content(changed);
    changed.setSite({ ...installation(), presetId: 'other' });
    await changed.controller.importSite();
    assert.equal(changed.requests.filter((r) => r.method === 'POST').length, 0);
    const conflicting = harness({
        send: async (r) =>
            r.url.startsWith('/api/v4/presets/plan/')
                ? {
                      plan: {
                          presetId: 'market',
                          version: '1.0.0',
                          models: [{ action: 'conflict' }],
                          pages: [],
                      },
                  }
                : undefined,
    });
    await content(conflicting);
    await conflicting.controller.importSite();
    assert.equal(
        conflicting.requests.filter((r) => r.method === 'POST').length,
        0,
    );
});

test('non administrators cannot create or import even if local saved state is populated', async () => {
    const h = harness({ scope: { admin: false, siteId: undefined } });
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'Shop' });
    await h.controller.next();
    await h.controller.importSite();
    assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
    assert.equal(
        h.requests.filter((r) => r.url === '/api/v4/presets/site').length,
        0,
    );
});

test('overlapping submits create/import once and unreadable storage does not initiate unsafe mutations', async () => {
    const h = harness();
    await content(h);
    await Promise.all([h.controller.importSite(), h.controller.importSite()]);
    assert.equal(
        h.requests.filter((r) => r.url === '/api/v4/presets/import').length,
        1,
    );
    const broken = harness({
        storage: {
            getItem: () => null,
            setItem: () => {
                throw new Error('storage unavailable');
            },
            removeItem() {},
        },
    });
    await broken.controller.load();
    broken.controller.chooseTemplate(template);
    await broken.controller.next();
    broken.controller.update({ siteName: 'Shop' });
    await broken.controller.next();
    await assert.rejects(broken.controller.importSite(), /本地存储/);
    assert.equal(broken.requests.filter((r) => r.method === 'POST').length, 0);
});

test('definite validation rejection unlocks an empty site while a lost response stays pending', async () => {
    const h = harness({
        send: async (r) => {
            if (r.url === '/api/v4/presets/import')
                throw { status: 400, message: 'Invalid import request' };
        },
    });
    await content(h);
    await assert.rejects(h.controller.importSite());
    assert.equal(h.controller.state.importRequested, false);
    assert.equal(h.controller.optionsLocked, false);
    h.controller.back();
    assert.equal(h.controller.state.step, 'identity');
});
test('unreadable saved progress fails closed before any create or import', async () => {
    const h = harness({
        storage: {
            getItem: () => {
                throw new Error('access denied');
            },
            setItem() {},
            removeItem() {},
        },
    });
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'Shop' });
    await h.controller.next();
    await assert.rejects(h.controller.importSite(), /本地存储/);
    assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
});

test('a second already-open wizard sees the persisted creation intent and never posts a second site', async () => {
    const store = storage();
    const first = harness({ storage: store, scope: { siteId: undefined } });
    const second = harness({ storage: store, scope: { siteId: undefined } });
    await first.controller.load();
    await second.controller.load();
    for (const h of [first, second]) {
        h.controller.chooseTemplate(template);
        await h.controller.next();
        h.controller.update({ siteName: 'My shop' });
    }
    await first.controller.next();
    // Simulate the saved selection still pending in another tab: selectContext navigation does not transfer that tab.
    // The original pending intent must survive until the destination opens successfully.
    await second.controller.next();
    assert.equal(second.requests.filter((r) => r.method === 'POST').length, 0);
});

test('a stale or mismatched import plan cannot install a different public version', async () => {
    const h = harness({
        send: async (r) =>
            r.url.startsWith('/api/v4/presets/plan/')
                ? {
                      plan: {
                          presetId: 'other',
                          version: '9.0.0',
                          models: [],
                          pages: [],
                      },
                  }
                : undefined,
    });
    await h.controller.load();
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'My shop' });
    await assert.rejects(h.controller.next(), /版本/);
    assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
});

test('failed and stale imports resume with the installed identity and locked demo choice', async () => {
    for (const status of ['failed', 'importing']) {
        const installed = { ...installation(status), updatedAt: 1 };
        const h = harness({ site: installed });
        // Lease expiration is controlled by the controller clock, never a real wait.
        const controller = onboarding.createSiteOnboarding({
            sdk: {
                send: async (request) => {
                    h.requests.push(request);
                    if (request.url === '/api/v4/presets/catalog')
                        return { items: [template] };
                    if (request.url === '/api/v4/presets/site')
                        return { site: installed, checklist: [] };
                    if (request.url.startsWith('/api/v4/presets/plan/'))
                        return {
                            plan: {
                                presetId: 'market',
                                version: '1.0.0',
                                models: [],
                                pages: [],
                            },
                        };
                    if (request.url === '/api/v4/presets/import')
                        return installed;
                },
                selectContext: async () => {},
            },
            storage: storage(),
            scope: {
                userId: 'a',
                workspaceId: 'a',
                siteId: 'site-a',
                admin: true,
            },
            now: () => 120001,
        });
        await controller.load();
        assert.equal(controller.canResume, true);
        controller.update({ includeDemo: false, siteName: 'Changed' });
        await controller.importSite();
        assert.equal(
            h.requests.find((r) => r.url === '/api/v4/presets/import').data
                .includeDemo,
            true,
        );
        assert.equal(
            h.requests.find((r) => r.url === '/api/v4/presets/import').data
                .siteName,
            'Saved name',
        );
    }
});

test('corrupted saved state cannot erase pending-operation safeguards or open the publish step', async () => {
    const store = storage();
    store.setItem(
        onboarding.onboardingStorageKey({
            userId: 'user-a',
            workspaceId: 'workspace-a',
            siteId: 'site-a',
        }),
        JSON.stringify({ step: 'publish', creation: true }),
    );
    const h = harness({ storage: store });
    await h.controller.load();
    assert.equal(h.controller.storageError, true);
    assert.equal(h.controller.state.step, 'template');
    h.controller.chooseTemplate(template);
    await h.controller.next();
    h.controller.update({ siteName: 'My shop' });
    await h.controller.next();
    await assert.rejects(h.controller.importSite(), /本地存储/);
    assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
});

test('an explicit pending-empty retry recovers a request that never reached the server with the original pinned options', async () => {
    const pinned = {
        ...template,
        sourceCommit: 'abc123',
        version: '2.0.0',
        manifestChecksum: 'sha256:pinned',
    };
    let serverSite = empty(),
        attempts = 0;
    const send = async (request) => {
        if (request.url === '/api/v4/presets/catalog')
            return { items: [pinned] };
        if (request.url.startsWith('/api/v4/presets/plan/'))
            return {
                plan: {
                    presetId: 'market',
                    version: '2.0.0',
                    models: [],
                    pages: [],
                },
            };
        if (request.url === '/api/v4/presets/site')
            return { site: serverSite, checklist: [] };
        if (request.url === '/api/v4/presets/import') {
            if (++attempts === 1) throw new Error('response lost');
            serverSite = {
                ...installation('ready'),
                name: 'Original shop',
                presetVersion: '2.0.0',
                publishedTemplateRecord: JSON.stringify({
                    sourceCommit: 'abc123',
                    manifestChecksum: 'sha256:pinned',
                }),
            };
            return serverSite;
        }
    };
    const first = harness({ send });
    await first.controller.load();
    first.controller.chooseTemplate(pinned);
    await first.controller.next();
    first.controller.update({ siteName: 'Original shop', includeDemo: true });
    await first.controller.next();
    await assert.rejects(first.controller.importSite(), /response lost/);
    const resumed = harness({ storage: first.storage, send });
    await resumed.controller.load();
    assert.equal(
        resumed.requests.filter((r) => r.method === 'POST').length,
        0,
        'loading never resubmits',
    );
    resumed.controller.update({ siteName: 'Changed', includeDemo: false });
    resumed.controller.chooseTemplate({ ...template, id: 'other' });
    const start = resumed.requests.length;
    await resumed.controller.retryPendingImport();
    assert.equal(
        resumed.requests[start].url,
        '/api/v4/presets/site',
        'an explicit retry first reads fresh selected-site status',
    );
    assert.deepEqual(resumed.requests.find((r) => r.method === 'POST').data, {
        presetId: 'market',
        presetVersion: '2.0.0',
        manifestChecksum: 'sha256:pinned',
        siteName: 'Original shop',
        includeDemo: true,
        mode: 'import',
    });
    assert.equal(resumed.controller.site.status, 'ready');
});

test('explicit pending-empty recovery discovers importing or ready sites before deciding whether to send', async () => {
    for (const status of ['importing', 'ready']) {
        const first = harness({
            send: async (r) => {
                if (r.url === '/api/v4/presets/import')
                    throw new Error('response lost');
            },
        });
        await content(first);
        await assert.rejects(first.controller.importSite());
        const resumed = harness({ storage: first.storage });
        await resumed.controller.load();
        resumed.setSite(installation(status));
        await resumed.controller.retryPendingImport();
        assert.equal(
            resumed.requests.filter((r) => r.method === 'POST').length,
            0,
        );
        assert.equal(resumed.controller.site.status, status);
    }
});
