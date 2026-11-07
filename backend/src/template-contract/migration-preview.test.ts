import assert from 'node:assert/strict';
import test from 'node:test';
import {
    previewMigration,
    type MigrationDocument,
    type MigrationStep,
    type MigrationTarget,
} from './migration-preview';

const target: MigrationTarget = {
    models: {
        service: {
            fields: [
                { key: 'title', type: 'STRING', required: true, array: false },
                {
                    key: 'enabled',
                    type: 'BOOLEAN',
                    required: false,
                    array: false,
                },
                { key: 'rank', type: 'NUMBER', required: false, array: false },
                {
                    key: 'summary',
                    type: 'STRING',
                    required: false,
                    array: false,
                },
                { key: 'cover', type: 'MEDIA', required: false, array: false },
                {
                    key: 'related',
                    type: 'ENTRY_POINTER',
                    required: false,
                    array: true,
                    referenceModel: 'service',
                },
            ],
        },
    },
    pages: [
        {
            key: 'services',
            path: '/services',
            sections: ['hero', 'service-list'],
        },
    ],
    sections: [
        { type: 'hero', allowedPages: ['services'] },
        { type: 'service-list', allowedPages: ['services'] },
    ],
    availableMediaIds: ['media-1'],
};

const source: MigrationDocument = {
    models: {
        service: [
            {
                id: 'entry-1',
                fields: {
                    headline: 'A',
                    enabled: false,
                    rank: 0,
                    summary: '',
                    cover: [{ _id: 'media-1' }],
                    related: [{ tid: 'service-template', eid: 'entry-1' }],
                },
            },
        ],
    },
    pages: [
        {
            id: 'services',
            path: '/services',
            sections: [
                {
                    id: 'section-stable',
                    type: 'intro',
                    props: { headline: 'A' },
                },
            ],
        },
    ],
};

test('renames a field without mutating the source or overwriting a target', () => {
    const steps: MigrationStep[] = [
        { op: 'rename-field', model: 'service', from: 'headline', to: 'title' },
        { op: 'rename-section', from: 'intro', to: 'hero' },
    ];
    const result = previewMigration(source, steps, target);
    assert.deepEqual(result.document.models.service[0].fields, {
        title: 'A',
        enabled: false,
        rank: 0,
        summary: '',
        cover: [{ _id: 'media-1' }],
        related: [{ tid: 'service-template', eid: 'entry-1' }],
    });
    assert.deepEqual(source.models.service[0].fields.headline, 'A');
    assert.equal(result.document.pages[0].sections[0].id, 'section-stable');
    assert.equal(result.document.pages[0].sections[0].type, 'hero');
    assert.deepEqual(
        result.changes.map((change) => change.kind),
        ['field', 'section'],
    );
    assert.deepEqual(result.issues, []);
});

test('rejects a rename collision and keeps the source values intact', () => {
    const collision = previewMigration(
        {
            models: {
                service: [
                    { id: 'entry-1', fields: { headline: 'A', title: 'B' } },
                ],
            },
            pages: [],
        },
        [
            {
                op: 'rename-field',
                model: 'service',
                from: 'headline',
                to: 'title',
            },
        ],
    );
    assert.equal(collision.issues[0].code, 'target_exists');
    assert.deepEqual(collision.document.models.service[0].fields, {
        headline: 'A',
        title: 'B',
    });
});

test('set-default writes only an absent property and preserves false, zero and empty values', () => {
    const except = previewMigration(source, [
        {
            op: 'set-default',
            model: 'service',
            field: 'title',
            value: 'Fallback',
        },
    ]);
    assert.equal(except.document.models.service[0].fields.title, 'Fallback');
    assert.equal(except.document.models.service[0].fields.enabled, false);
    assert.equal(except.document.models.service[0].fields.rank, 0);
    assert.equal(except.document.models.service[0].fields.summary, '');
    const present = previewMigration(except.document, [
        {
            op: 'set-default',
            model: 'service',
            field: 'title',
            value: 'Changed',
        },
    ]);
    assert.equal(present.document.models.service[0].fields.title, 'Fallback');
    assert.deepEqual(present.document.models.service[0].fields.cover, [
        { _id: 'media-1' },
    ]);
});

test('returns explicit issues for unsupported operations, unknown models and forbidden keys', () => {
    const unknownOperation = previewMigration(source, [
        {
            op: 'delete-field',
            model: 'service',
            field: 'summary',
        } as unknown as MigrationStep,
    ]);
    assert.equal(unknownOperation.issues[0].code, 'unsupported_operation');
    const unknownModel = previewMigration(source, [
        { op: 'rename-field', model: 'missing', from: 'a', to: 'b' },
    ]);
    assert.equal(unknownModel.issues[0].code, 'unknown_model');
    const polluted = JSON.parse(
        '{"models":{"service":[{"id":"unsafe","fields":{"__proto__":{"polluted":true},"title":"A"}}]},"pages":[]}',
    ) as MigrationDocument;
    const rejected = previewMigration(polluted, []);
    assert.ok(rejected.issues.some((issue) => issue.code === 'unsafe_key'));
    const unsafeDefault = previewMigration(source, [
        {
            op: 'set-default',
            model: 'service',
            field: 'title',
            value: JSON.parse('{"__proto__":{"polluted":true}}'),
        },
    ]);
    assert.ok(
        unsafeDefault.issues.some((issue) => issue.code === 'unsafe_key'),
    );
});

test('repeated execution is deterministic and an already-migrated rename is idempotent', () => {
    const steps: MigrationStep[] = [
        { op: 'rename-field', model: 'service', from: 'headline', to: 'title' },
        { op: 'rename-section', from: 'intro', to: 'hero' },
    ];
    const first = previewMigration(source, steps, target);
    const second = previewMigration(source, steps, target);
    assert.deepEqual(second, first);
    const repeated = previewMigration(first.document, steps, target);
    assert.deepEqual(repeated.document, first.document);
    assert.deepEqual(repeated.changes, []);
    assert.deepEqual(repeated.issues, []);
});

test('target validation reports required, type, media, reference and page-section errors', () => {
    const invalid: MigrationDocument = {
        models: {
            service: [
                {
                    id: 'entry-1',
                    fields: {
                        title: 'A',
                        rank: 'zero',
                        cover: [{ _id: 'missing' }],
                        related: [{ tid: 'wrong', eid: 'missing' }],
                    },
                },
            ],
        },
        pages: [
            {
                id: 'wrong-page',
                path: '/wrong',
                sections: [{ id: 'bad', type: 'unknown', props: {} }],
            },
        ],
    };
    const result = previewMigration(invalid, [], target);
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has('field_value'));
    assert.ok(codes.has('media_missing'));
    assert.ok(codes.has('entry_reference'));
    assert.ok(codes.has('missing_page'));
    assert.ok(codes.has('unknown_section'));
});
