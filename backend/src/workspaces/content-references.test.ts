import assert from 'node:assert/strict';
import test from 'node:test';
import { Repo } from '../repo';
import { validateContentNodes } from './content-references';

test('unbound rich internal links always resolve through the scoped repositories and match the target template', async (t) => {
    const calls: string[] = [];
    t.mock.method(Repo.media, 'findById', async (id: string) => {
        calls.push('media:' + id);
        return id === 'own' ? { _id: id } : null;
    });
    t.mock.method(Repo.template, 'findById', async (id: string) => {
        calls.push('template:' + id);
        return id === 'own-template' ? { _id: id } : null;
    });
    t.mock.method(Repo.entry, 'findById', async (id: string) => {
        calls.push('entry:' + id);
        return id === 'own'
            ? { _id: id, templateId: 'own-template' }
            : id === 'forged'
              ? { _id: id, templateId: 'other-template' }
              : null;
    });
    const nodes = (href: string) =>
        [
            {
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: 'Link',
                        marks: [
                            { type: 'link', attrs: { href, target: '_self' } },
                        ],
                    },
                ],
            },
        ] as never;
    for (const href of [
        'media:foreign@*_@*_:media',
        'entry:foreign@*_own-template:entry',
        'entry:own@*_foreign-template:entry',
        'entry:forged@*_own-template:entry',
    ])
        await assert.rejects(
            validateContentNodes(nodes(href)),
            /not found or not permitted/,
        );
    await validateContentNodes(nodes('media:own@*_@*_:media'));
    await validateContentNodes(nodes('entry:own@*_own-template:entry'));
    assert.ok(calls.length >= 8);
});
