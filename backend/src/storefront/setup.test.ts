import assert from 'node:assert/strict';
import test from 'node:test';
import type { Template } from '../template/models/main';
import { ensureProductTemplate } from './setup';

test('product template setup is opt-in and idempotent', async () => {
    let template: Template | null = null;
    let additions = 0;
    const source = {
        findByName: async () => template,
        add: async (value: Template) => {
            additions++;
            template = value;
            return value;
        },
    };
    assert.equal(await ensureProductTemplate(false, source), null);
    assert.equal(additions, 0);
    const created = await ensureProductTemplate(true, source);
    assert.equal(created?.name, 'product');
    assert.deepEqual(created?.props.map((prop) => prop.name), [
        'title', 'slug', 'price', 'description', 'images',
    ]);
    assert.equal((await ensureProductTemplate(true, source))?._id, created?._id);
    assert.equal(additions, 1);
});
