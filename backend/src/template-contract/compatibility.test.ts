import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyTemplateCompatibility,
    createLegacyEditorAdapter,
    createMigrationPlan,
    type TemplateInstallation,
} from './compatibility';
import {
    compareTemplateStructures,
    type TemplateEditorContract,
} from './model';
import { readTemplateContract } from './registry';

const editor: TemplateEditorContract = {
    schemaVersion: 1 as const,
    models: [
        {
            modelKey: 'article',
            fields: [
                { key: 'title', label: 'Title', control: 'text' as const },
            ],
        },
    ],
    pages: [
        {
            pageKey: 'home',
            modelKey: 'article',
            pathRule: { type: 'fixed' as const, value: '/' },
            allowNavigation: true,
            sections: ['hero'],
        },
    ],
    sections: [
        {
            type: 'hero',
            label: 'Hero',
            allowedPages: ['home'],
            singleton: true,
            required: true,
            props: {},
        },
    ],
    operations: {
        canCreatePages: true,
        canEditNavigation: true,
        canPublish: true,
    },
};
const renderer = {
    contractVersion: 1 as const,
    templateId: 'custom',
    templateVersion: '1.1.0',
    preview: { protocolVersion: 1 as const, capabilities: ['draft'] },
    assets: { mode: 'published' as const, basePath: '/_assets/' },
};
const compatibility = {
    cmsSchema: 1 as const,
    releaseSchema: 1 as const,
    migrations: [
        {
            from: 'custom@1.0.0',
            to: 'custom@1.1.0',
            steps: [{ op: 'rename-field', from: 'headline', to: 'title' }],
        },
    ],
};

function manifest(extra: Record<string, unknown> = {}) {
    return {
        id: 'custom',
        version: '1.1.0',
        editor,
        renderer,
        compatibility,
        ...extra,
    };
}

test('installs a template contract only when editor and renderer identities are complete', () => {
    const installed = readTemplateContract(manifest(), {
        id: 'custom',
        version: '1.1.0',
        manifestChecksum: 'sha256:manifest',
        sourceCommit: 'a'.repeat(40),
    });
    assert.equal(installed.renderer.templateId, 'custom');
    assert.equal(installed.renderer.templateVersion, '1.1.0');
});

test('rejects a contract missing renderer identity', () => {
    assert.throws(
        () =>
            readTemplateContract(manifest({ renderer: undefined }), {
                id: 'custom',
                version: '1.1.0',
                manifestChecksum: 'sha256:manifest',
                sourceCommit: 'a'.repeat(40),
            }),
        /renderer contract/i,
    );
});

test('classifies same-version, migration and incompatible template changes', () => {
    const current: TemplateInstallation = { id: 'custom', version: '1.0.0' };
    assert.equal(
        classifyTemplateCompatibility(current, {
            id: 'custom',
            version: '1.0.0',
        }),
        'data-compatible',
    );
    assert.equal(
        classifyTemplateCompatibility(current, {
            id: 'custom',
            version: '1.1.0',
            compatibility,
        }),
        'migration-required',
    );
    assert.equal(
        classifyTemplateCompatibility(current, {
            id: 'custom',
            version: '1.1.0',
        }),
        'incompatible',
    );
    assert.equal(
        classifyTemplateCompatibility(current, {
            id: 'other',
            version: '1.0.0',
        }),
        'incompatible',
    );
});

test('structural comparison detects model, page, section and renderer-breaking changes', () => {
    const nextEditor = structuredClone(editor);
    nextEditor.models[0].fields = [
        { key: 'headline', label: 'Headline', control: 'text', required: true },
    ];
    nextEditor.pages[0].pathRule.value = '/home';
    nextEditor.sections[0].props = {
        title: { control: 'text', label: 'Title' },
    };
    const result = compareTemplateStructures(editor, nextEditor, renderer, {
        ...renderer,
        preview: { protocolVersion: 1, capabilities: [] },
        assets: { mode: 'embedded', basePath: '/assets/' },
    });
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has('field_removed'));
    assert.ok(codes.has('required_field_added'));
    assert.ok(codes.has('page_definition_changed'));
    assert.ok(codes.has('section_definition_changed'));
    assert.ok(codes.has('renderer_capability_removed'));
    assert.ok(codes.has('renderer_assets_changed'));
    assert.ok(result.changes.length >= 6);
});

test('creates a migration plan without mutating the installed site', () => {
    const current = {
        id: 'custom',
        version: '1.0.0',
        siteConfig: { theme: 'dark' },
    };
    const requested = { id: 'custom', version: '1.1.0', compatibility };
    const plan = createMigrationPlan(current, requested);
    assert.deepEqual(plan, {
        from: 'custom@1.0.0',
        to: 'custom@1.1.0',
        steps: [{ op: 'rename-field', from: 'headline', to: 'title' }],
    });
    assert.deepEqual(current.siteConfig, { theme: 'dark' });
});

test('generates a legacy editor adapter and records its source', () => {
    const result = createLegacyEditorAdapter({
        id: 'legacy',
        version: '1.0.0',
        models: [
            {
                key: 'article',
                label: 'Article',
                fields: [
                    {
                        key: 'title',
                        label: 'Title',
                        type: 'STRING',
                        required: true,
                        array: false,
                    },
                ],
            },
        ],
        pages: [],
    });
    assert.equal(result.source, 'legacy-model-fields');
    assert.equal(result.contract.schemaVersion, 1);
    assert.equal(result.contract.models[0].fields[0].key, 'title');
});

test('section number constraint declarations require finite numeric minimum and boolean integer on number controls', () => {
    const validate = (prop: Record<string, unknown>) =>
        readTemplateContract(
            manifest({
                editor: {
                    ...editor,
                    sections: [
                        { ...editor.sections[0], props: { count: prop } },
                    ],
                },
            }),
            {
                id: 'custom',
                version: '1.1.0',
                manifestChecksum: 'sha256:manifest',
                sourceCommit: 'a'.repeat(40),
            },
        );
    assert.doesNotThrow(() =>
        validate({ control: 'number', minimum: 1, integer: true }),
    );
    assert.doesNotThrow(() =>
        validate({ control: 'number', minimum: -2.5, integer: false }),
    );
    for (const prop of [
        { control: 'number', minimum: '1' },
        { control: 'number', minimum: Infinity },
        { control: 'number', integer: 1 },
        { control: 'text', minimum: 1 },
        { control: 'text', integer: false },
    ])
        assert.throws(() => validate(prop), /section property/i);
});
