import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { legacyContentRouteRecords } from '../src/legacy-content-routes.ts';

async function target(path) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            ...legacyContentRouteRecords,
            { path: '/d/studio', component: { render: () => null } },
        ],
    });
    await router.push(path);
    await router.isReady();
    return router.currentRoute.value;
}

test('all legacy template editors redirect into the unified content workspace', async () => {
    assert.deepEqual(
        {
            path: (await target('/d/template')).path,
            section: (await target('/d/template')).query.section,
        },
        { path: '/d/studio', section: 'content' },
    );
    const model = await target('/d/template/template-1');
    assert.equal(model.path, '/d/studio');
    assert.equal(model.query.section, 'content');
    assert.equal(model.query.templateId, 'template-1');
});

test('legacy Entry bookmarks preserve authorized target and create intent', async () => {
    const edit = await target(
        '/d/template/template-1/entry/entry-1?language=fr&field=title',
    );
    assert.equal(edit.path, '/d/studio');
    assert.equal(edit.query.section, 'content');
    assert.equal(edit.query.templateId, 'template-1');
    assert.equal(edit.query.entryId, 'entry-1');
    assert.equal(edit.query.intent, 'edit');
    assert.equal(edit.query.language, 'fr');
    assert.equal(edit.query.field, 'title');

    const create = await target('/d/template/template-1/entry/create');
    assert.equal(create.query.entryId, 'create');
    assert.equal(create.query.intent, 'create');
});
