import type { MongoDBEntry } from '../_server/modules/mongodb';
import type { ObjectSchema } from '../_utils/object-utility';

export interface SiteInstallation extends MongoDBEntry {
    slot: 'default';
    name: string;
    presetId: string;
    presetVersion: string;
    status: 'importing' | 'ready' | 'failed';
    importError: string;
    includeDemo: boolean;
    demoSeeded: boolean;
    theme: {
        background: string;
        foreground: string;
        accent: string;
        muted: string;
        font: string;
    };
    models: Array<{
        key: string;
        templateId: string;
        fields: Array<{ key: string; propId: string }>;
    }>;
    pages: SitePage[];
    currentReleaseId?: string;
    publishedReleaseIds?: string[];
}

export interface SitePage {
    key: string;
    title: string;
    path: string;
    modelKey: string;
    layout: string;
    status: 'draft';
    seoTitle?: string;
    seoDescription?: string;
    sections?: string[];
    entryId?: string;
    blueprintKey?: string;
    enabled?: boolean;
    navigation?: boolean;
}

export const SiteInstallationSchema: ObjectSchema = {
    _id: { __type: 'string', __required: true },
    createdAt: { __type: 'number', __required: true },
    updatedAt: { __type: 'number', __required: true },
    slot: { __type: 'string', __required: true },
    name: { __type: 'string', __required: true },
    presetId: { __type: 'string', __required: true },
    presetVersion: { __type: 'string', __required: true },
    status: { __type: 'string', __required: true },
    importError: { __type: 'string', __required: true },
    includeDemo: { __type: 'boolean', __required: true },
    demoSeeded: { __type: 'boolean', __required: true },
    currentReleaseId: { __type: 'string', __required: false },
    publishedReleaseIds: { __type: 'array', __required: false, __child: { __type: 'string' } },
    theme: {
        __type: 'object', __required: true,
        __child: {
            background: { __type: 'string', __required: true },
            foreground: { __type: 'string', __required: true },
            accent: { __type: 'string', __required: true },
            muted: { __type: 'string', __required: true },
            font: { __type: 'string', __required: true },
        },
    },
    models: {
        __type: 'array', __required: true,
        __child: {
            __type: 'object',
            __content: {
                key: { __type: 'string', __required: true },
                templateId: { __type: 'string', __required: true },
                fields: {
                    __type: 'array', __required: true,
                    __child: {
                        __type: 'object',
                        __content: {
                            key: { __type: 'string', __required: true },
                            propId: { __type: 'string', __required: true },
                        },
                    },
                },
            },
        },
    },
    pages: {
        __type: 'array', __required: true,
        __child: {
            __type: 'object',
            __content: {
                key: { __type: 'string', __required: true },
                title: { __type: 'string', __required: true },
                path: { __type: 'string', __required: true },
                modelKey: { __type: 'string', __required: true },
                layout: { __type: 'string', __required: true },
                status: { __type: 'string', __required: true },
                seoTitle: { __type: 'string', __required: false },
                seoDescription: { __type: 'string', __required: false },
                sections: { __type: 'array', __required: false, __child: { __type: 'string' } },
                entryId: { __type: 'string', __required: false },
                blueprintKey: { __type: 'string', __required: false },
                enabled: { __type: 'boolean', __required: false },
                navigation: { __type: 'boolean', __required: false },
            },
        },
    },
};
