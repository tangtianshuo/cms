import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import type { SiteInstallation } from '../presets/site-model';
import type { ReleaseInput } from '../presets/releases';
import type { Template } from '../template/models/main';
import { PropType } from '../prop/models/main';
import {
    authorizedMigrationMediaIds,
    toMigrationDocument,
} from './migration-document';
import { previewMigration } from './migration-preview';

const site: SiteInstallation = {
    _id: 'site-1',
    createdAt: 1,
    updatedAt: 2,
    workspaceId: 'workspace-1',
    slot: 'default',
    name: 'Services',
    presetId: 'service-studio',
    presetVersion: '1.0.0',
    status: 'ready',
    importError: '',
    includeDemo: false,
    demoSeeded: false,
    language: 'en',
    theme: {
        background: '#ffffff',
        foreground: '#111111',
        accent: '#0066cc',
        muted: '#eeeeee',
        font: 'Arial',
    },
    models: [
        {
            key: 'service',
            templateId: 'template-service',
            fields: [
                { key: 'title', propId: 'prop-title' },
                { key: 'enabled', propId: 'prop-enabled' },
                { key: 'rank', propId: 'prop-rank' },
                { key: 'cover', propId: 'prop-cover' },
                {
                    key: 'related',
                    propId: 'prop-related',
                },
            ],
        },
    ],
    pages: [
        {
            key: 'services',
            title: 'Services',
            path: '/services',
            modelKey: 'service',
            layout: 'services',
            status: 'draft',
            enabled: true,
            sectionConfigs: [
                {
                    type: 'faq',
                    enabled: true,
                    data: { title: 'Everything we do' },
                },
            ],
        },
    ],
};

const entry: Entry = {
    _id: 'entry-1',
    createdAt: 1,
    updatedAt: 2,
    workspaceId: 'workspace-1',
    siteId: 'site-1',
    groupId: 'site-1',
    templateId: 'template-service',
    userId: 'user-1',
    statuses: [],
    meta: [
        {
            lng: 'en',
            props: [
                { id: 'prop-title', data: ['Consulting'] as never },
                { id: 'prop-enabled', data: [false] as never },
                { id: 'prop-rank', data: [0] as never },
                { id: 'prop-cover', data: [{ _id: 'media-1' }] as never },
                {
                    id: 'prop-related',
                    data: [
                        { tid: 'template-service', eid: 'entry-2' },
                    ] as never,
                },
            ],
        },
    ],
    content: [{ lng: 'en', nodes: [], plainText: '' }],
};

const template: Template = {
    _id: 'template-service',
    createdAt: 1,
    updatedAt: 1,
    workspaceId: 'workspace-1',
    siteId: 'site-1',
    name: 'site-service',
    label: 'Services',
    desc: '',
    userId: '__preset',
    singleEntry: false,
    props: [
        {
            id: 'prop-title',
            name: 'title',
            label: 'Title',
            type: PropType.STRING,
            required: true,
            array: false,
            data: {},
        },
        {
            id: 'prop-enabled',
            name: 'enabled',
            label: 'Enabled',
            type: PropType.BOOLEAN,
            required: false,
            array: false,
            data: {},
        },
        {
            id: 'prop-rank',
            name: 'rank',
            label: 'Rank',
            type: PropType.NUMBER,
            required: false,
            array: false,
            data: {},
        },
        {
            id: 'prop-cover',
            name: 'cover',
            label: 'Cover',
            type: PropType.MEDIA,
            required: false,
            array: false,
            data: {},
        },
        {
            id: 'prop-related',
            name: 'related',
            label: 'Related',
            type: PropType.ENTRY_POINTER,
            required: false,
            array: true,
            data: {},
        },
    ],
};

const media: Media = {
    _id: 'media-1',
    createdAt: 1,
    updatedAt: 1,
    workspaceId: 'workspace-1',
    siteId: 'site-1',
    userId: 'user-1',
    mimetype: 'image/png',
    size: 1,
    name: 'cover.png',
    type: 'IMG',
} as Media;

const input: ReleaseInput = {
    site,
    templates: [template],
    entries: [
        entry,
        {
            ...entry,
            _id: 'entry-2',
            meta: [
                {
                    lng: 'en',
                    props: [
                        { id: 'prop-title', data: ['Engineering'] as never },
                    ],
                },
            ],
        },
    ],
    media: [media],
    language: 'en',
    mediaOrigin: 'https://cms.example',
    currency: 'USD',
};

test('projects installed prop IDs to stable model field keys without mutating input', () => {
    const beforeSite = structuredClone(site);
    const beforeInput = structuredClone(input);
    const document = toMigrationDocument(site, input);
    assert.deepEqual(document.models.service[0], {
        id: 'entry-1',
        fields: {
            title: 'Consulting',
            enabled: false,
            rank: 0,
            cover: { _id: 'media-1' },
            related: [{ tid: 'template-service', eid: 'entry-2' }],
        },
    });
    assert.equal(document.models.service[1].id, 'entry-2');
    assert.equal(document.pages[0].id, 'services');
    assert.equal(document.pages[0].sections[0].id, 'services:section:0:faq');
    assert.equal(document.pages[0].sections[0].type, 'faq');
    assert.deepEqual(document.pages[0].sections[0].props, {
        title: 'Everything we do',
    });
    assert.deepEqual(site, beforeSite);
    assert.deepEqual(input, beforeInput);
});

test('uses the requested language and keeps layout node IDs authoritative', () => {
    const layoutSite: SiteInstallation = {
        ...site,
        pages: [
            {
                ...site.pages[0],
                layoutDocument: {
                    version: 1,
                    mode: 'template',
                    root: [
                        {
                            id: 'layout-node-1',
                            kind: 'section',
                            type: 'faq',
                            enabled: true,
                            props: { title: 'Layout title' },
                            children: [],
                        },
                    ],
                },
            },
        ],
    };
    const document = toMigrationDocument(layoutSite, {
        ...input,
        site: layoutSite,
    });
    assert.equal(document.pages[0].sections[0].id, 'layout-node-1');
    assert.deepEqual(document.pages[0].sections[0].props, {
        title: 'Layout title',
    });
    const french = toMigrationDocument(layoutSite, {
        ...input,
        language: 'fr',
        entries: [
            {
                ...entry,
                meta: [
                    ...entry.meta,
                    {
                        lng: 'fr',
                        props: [
                            { id: 'prop-title', data: ['Conseil'] as never },
                        ],
                    },
                ],
            },
        ],
    });
    assert.deepEqual(french.models.service[0].fields, {
        title: 'Conseil',
    });
});

test('media authorization excludes same-workspace media bound to another site', () => {
    const foreign = {
        ...media,
        _id: 'media-foreign-site',
        siteId: 'site-2',
    } as Media;
    assert.deepEqual(authorizedMigrationMediaIds(site, [media, foreign]), [
        'media-1',
    ]);
    const target = {
        models: {
            service: {
                fields: [
                    {
                        key: 'cover',
                        type: 'MEDIA',
                        required: false,
                        array: false,
                    },
                ],
            },
        },
        pages: [],
        sections: [],
        availableMediaIds: authorizedMigrationMediaIds(site, [media, foreign]),
    };
    const own = previewMigration(
        {
            models: {
                service: [{ id: 'own', fields: { cover: { _id: 'media-1' } } }],
            },
            pages: [],
        },
        [],
        target,
    );
    const otherSite = previewMigration(
        {
            models: {
                service: [
                    {
                        id: 'foreign',
                        fields: { cover: { _id: 'media-foreign-site' } },
                    },
                ],
            },
            pages: [],
        },
        [],
        target,
    );
    assert.deepEqual(own.issues, []);
    assert.ok(otherSite.issues.some((issue) => issue.code === 'media_missing'));
});
