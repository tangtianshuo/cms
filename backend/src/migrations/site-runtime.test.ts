import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import { getPreset } from '../presets/catalog';
import type { ReleaseInput } from '../presets/releases';
import { prepareMigrationOperation } from '../template-contract/migration-service';
import {
    candidateLayoutTransform,
    planLegacySiteMigration,
} from './site-runtime';

function legacyFixture(): ReleaseInput {
    const preset = getPreset('atelier')!;
    const values: Record<string, Record<string, unknown[]>> = {
        home: {
            title: ['Home'],
            slug: ['home'],
            headline: ['Legacy headline'],
        },
        product: { title: ['Bag'], slug: ['bag'], price: [45] },
        collection: {
            title: ['Shop'],
            slug: ['shop'],
            products: [{ tid: 'product', eid: 'product-entry' }],
        },
        'content-page': {
            title: ['About'],
            slug: ['about'],
            summary: ['Story'],
        },
        'site-settings': {
            title: ['Settings'],
            slug: ['settings'],
            brandName: ['Legacy brand'],
            navigationPages: [
                { tid: 'content-page', eid: 'content-page-entry' },
            ],
        },
    };
    return {
        site: {
            _id: 'legacy-site',
            workspaceId: 'default',
            createdAt: 1,
            updatedAt: 1,
            slot: 'default',
            name: 'Legacy',
            presetId: preset.id,
            presetVersion: preset.version,
            runtimeMode: 'legacy',
            status: 'ready',
            importError: '',
            includeDemo: false,
            demoSeeded: false,
            theme: { ...preset.theme },
            models: preset.models.map((model) => ({
                key: model.key,
                templateId: model.key,
                fields: model.fields.map((field) => ({
                    key: field.key,
                    propId: field.key,
                })),
            })),
            pages: preset.pages.map((page) => {
                const types: Record<string, string[]> = {
                    home: ['hero-carousel'],
                    collections: ['info-grid'],
                    product: [
                        'product-gallery',
                        'product-information',
                        'product-description',
                    ],
                    content: ['info-grid'],
                };
                return {
                    ...page,
                    status: 'draft',
                    sectionConfigs: types[page.key].map((type) => ({
                        type: type as never,
                        enabled: false,
                        data: {},
                    })),
                };
            }),
        },
        templates: preset.models.map(
            (model) =>
                ({
                    _id: model.key,
                    props: model.fields.map((field) => ({
                        id: field.key,
                        name: field.key,
                        type: field.type,
                        array: field.array,
                        required: field.required,
                    })),
                }) as Template,
        ),
        entries: preset.models.map(
            (model) =>
                ({
                    _id: `${model.key}-entry`,
                    templateId: model.key,
                    meta: [
                        {
                            lng: 'en',
                            props: Object.entries(values[model.key]).map(
                                ([id, data]) => ({ id, data }),
                            ),
                        },
                    ],
                    content: [],
                }) as unknown as Entry,
        ),
        media: [],
        language: 'en',
        mediaOrigin: 'https://cms.test',
        currency: 'USD',
    };
}

test('legacy planning is deterministic and does not mutate the source site', () => {
    const input = legacyFixture();
    const before = JSON.stringify(input.site);
    const first = planLegacySiteMigration(input.site, input);
    const second = planLegacySiteMigration(input.site, input);
    assert.deepEqual(first, second);
    assert.deepEqual(first.issues, []);
    assert.equal(input.site.runtimeMode, 'legacy');
    assert.equal(JSON.stringify(input.site), before);
    assert.equal(first.candidateSite.runtimeMode, 'artifact');
    assert.equal(first.candidateSite.pages[0].layoutDocument?.mode, 'template');
    assert.deepEqual(first.candidateSite, second.candidateSite);
});

test('legacy planning reports missing media without changing source', () => {
    const input = legacyFixture();
    input.site.pages[0].sectionConfigs = [
        {
            type: 'hero-carousel',
            enabled: true,
            data: {
                slides: [
                    {
                        image: { _id: 'missing-media' },
                        title: 'Missing',
                        order: 0,
                    },
                ],
            },
        },
    ];
    const result = planLegacySiteMigration(input.site, input);
    assert.ok(result.issues.some((issue) => issue.code === 'media_missing'));
    assert.equal(input.site.runtimeMode, 'legacy');
    assert.equal(input.site.pages[0].layoutDocument, undefined);
});

test('legacy planning returns structured issues for an incompatible installed snapshot', () => {
    const input = legacyFixture();
    input.site.presetManifestSnapshot = '{"id":"other","version":"9.9.9"}';
    const before = JSON.stringify(input.site);
    const result = planLegacySiteMigration(input.site, input);
    assert.deepEqual(result.issues, [
        {
            code: 'template_snapshot_incompatible',
            path: 'template',
        },
    ]);
    assert.equal(JSON.stringify(input.site), before);
    assert.equal(result.candidateSite.runtimeMode, 'legacy');
});

test('staged migration applies legacy layouts only to the candidate', () => {
    const input = legacyFixture();
    const preset = getPreset('atelier')!;
    const operation = prepareMigrationOperation({
        site: input.site,
        requestKey: '33333333-3333-4333-8333-333333333333',
        expectedUpdatedAt: input.site.updatedAt,
        actorId: 'admin',
        targetManifest: preset,
        targetRecord: {
            schemaVersion: 1,
            id: preset.id,
            version: preset.version,
            manifestChecksum: `sha256:${'b'.repeat(64)}`,
            imageRepository: `ghcr.io/tangtianshuo/independent-website-templates/${preset.id}`,
            imageDigest: `sha256:${'c'.repeat(64)}`,
            sourceCommit: 'd'.repeat(40),
            manifestPath: `templates/${preset.id}/${preset.version}/template.json`,
            status: 'available',
        },
        input,
        steps: [],
        candidateTransform: candidateLayoutTransform(preset),
        candidateValidation: 'runtime-layout',
    });
    assert.equal(operation.previousSite.runtimeMode, 'legacy');
    assert.equal(operation.candidateSite.runtimeMode, 'artifact');
    assert.ok(
        operation.candidateSite.pages.every(
            (page) => page.layoutDocument?.mode === 'template',
        ),
    );
    assert.equal(operation.previousSite.pages[0].layoutDocument, undefined);
});
