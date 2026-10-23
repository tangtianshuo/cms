import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntryCreateBody } from '../src/util/entry-create.ts';

test('new editor state produces persisted metadata and content', () => {
    const entry = {
        statuses: [{ lng: 'en', id: 'draft' }],
        meta: [
            { lng: 'en', props: [{ id: 'title', data: ['Example'] }, { id: 'slug', data: ['example'] }] },
            { lng: 'fr', props: [{ id: 'title', data: [] }, { id: 'slug', data: [] }] },
        ],
        content: [
            { lng: 'en', nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }], plainText: '' },
            { lng: 'fr', nodes: [], plainText: '' },
        ],
    };
    assert.deepEqual(buildEntryCreateBody(entry), {
        statuses: [{ lng: 'en', id: 'draft' }],
        meta: [entry.meta[0]],
        content: [entry.content[0]],
    });
});
