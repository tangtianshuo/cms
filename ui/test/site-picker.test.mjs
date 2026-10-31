import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSiteChoices, selectSiteAfterNavigation } from '../src/layouts/dashboard/site-picker.ts';

test('site choices use an explicit workspace selector without inheriting the current site', async () => {
    const requests = [];
    const result = await loadSiteChoices({ async send(request) {
        requests.push(request);
        if (request.url === '/api/v4/workspaces') return { items: [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B' }] };
        return { items: [{ _id: `${request.selectorOverride.workspaceId}-site`, name: 'Shop' }] };
    } });
    assert.deepEqual(requests.map(request => request.selectorOverride), [{ workspaceId: 'default' }, { workspaceId: 'a' }, { workspaceId: 'b' }]);
    assert.equal(result[1].sites[0]._id, 'b-site');
});
test('an inaccessible workspace does not hide other available sites', async () => {
    const result = await loadSiteChoices({ async send(request) {
        if (request.url === '/api/v4/workspaces') return { items: [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B' }] };
        if (request.selectorOverride.workspaceId === 'a') throw new Error('Access denied');
        return { items: [{ _id: 'b-site', name: 'Shop' }] };
    } });
    assert.equal(result[0].unavailable, true);
    assert.deepEqual(result[0].sites, []);
    assert.equal(result[1].sites[0]._id, 'b-site');
});
test('cancelled navigation never changes the SDK selection', async () => {
    let changed = false;
    const result = await selectSiteAfterNavigation(async () => new Error('Navigation aborted'), async () => { changed = true; });
    assert.equal(result, false);
    assert.equal(changed, false);
});
test('selection validation starts only after navigation guards accept leaving', async () => {
    const events = [];
    assert.equal(await selectSiteAfterNavigation(async () => { events.push('leave'); }, async () => { events.push('select'); }), true);
    assert.deepEqual(events, ['leave', 'select']);
});
