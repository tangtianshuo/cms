import type { DomainPrimaryAudit } from '../site-domains/model';
import type { MongoDBEntry } from '../_server/modules/mongodb';
import type { ObjectSchema } from '../_utils/object-utility';
import type { NavigationNode } from './navigation';
import type { SectionConfig } from '../storefront/section-schema';
import type { SiteOperations } from './operations';

export interface SiteInstallation extends MongoDBEntry {
    workspaceId?: string;
    contentGroupId?: string;
    templateNamespace?: string;
    slot: string;
    name: string;
    presetId: string;
    presetVersion: string;
    language?: string;
    presetManifestSnapshot?: string;
    publishedTemplateRecord?: string;
    gatewayPublishIntent?: string;
    gatewayPinnedTemplateRecord?: string;
    gatewayCurrentReleaseId?: string;
    gatewayPublishedReleaseIds?: string[];
    gatewayActiveRevision?: number;
    status: 'empty' | 'importing' | 'ready' | 'failed';
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
    operations?: SiteOperations;
    models: Array<{
        key: string;
        templateId: string;
        fields: Array<{ key: string; propId: string }>;
    }>;
    pages: SitePage[];
    navigation?: NavigationNode[];
    domainAuditOutbox?: DomainPrimaryAudit[];
    primaryDomainId?: string;
    domainRevision?: number;
    domainMutationToken?: string;
    domainMutationUntil?: number;
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
    sectionConfigs?: SectionConfig[];
    entryId?: string;
    blueprintKey?: string;
    enabled?: boolean;
    navigation?: boolean;
}

export const SiteInstallationSchema: ObjectSchema = {
    _id: { __type: 'string', __required: true },
    createdAt: { __type: 'number', __required: true },
    updatedAt: { __type: 'number', __required: true },
    workspaceId: { __type: 'string', __required: false },
    contentGroupId: { __type: 'string', __required: false },
    templateNamespace: { __type: 'string', __required: false },
    slot: { __type: 'string', __required: true },
    name: { __type: 'string', __required: true },
    presetId: { __type: 'string', __required: true },
    presetVersion: { __type: 'string', __required: true },
    language: { __type: 'string', __required: false },
    presetManifestSnapshot: { __type: 'string', __required: false },
    publishedTemplateRecord: { __type: 'string', __required: false },
    gatewayPublishIntent: { __type: 'string', __required: false },
    gatewayPinnedTemplateRecord: { __type: 'string', __required: false },
    gatewayCurrentReleaseId: { __type: 'string', __required: false },
    gatewayPublishedReleaseIds: { __type: 'array', __required: false, __child: { __type: 'string' } },
    gatewayActiveRevision: { __type: 'number', __required: false },
    status: { __type: 'string', __required: true },
    importError: { __type: 'string', __required: true },
    includeDemo: { __type: 'boolean', __required: true },
    demoSeeded: { __type: 'boolean', __required: true },
    domainAuditOutbox: { __type: 'array', __required: false, __child: { __type: 'object', __content: {
        _id: { __type: 'string', __required: true }, createdAt: { __type: 'number', __required: true }, updatedAt: { __type: 'number', __required: true },
        siteId: { __type: 'string', __required: true }, domainId: { __type: 'string', __required: true }, actorId: { __type: 'string', __required: true },
        operation: { __type: 'string', __required: true }, outcome: { __type: 'string', __required: true }, error: { __type: 'string', __required: true }, bindingRevision: { __type: 'number', __required: true },
    } } },
    primaryDomainId: { __type: 'string', __required: false },
    domainRevision: { __type: 'number', __required: false },
    domainMutationToken: { __type: 'string', __required: false },
    domainMutationUntil: { __type: 'number', __required: false },
    currentReleaseId: { __type: 'string', __required: false },
    publishedReleaseIds: { __type: 'array', __required: false, __child: { __type: 'string' } },
    operations: { __type: 'object', __required: false, __child: {
        seoTitle: { __type: 'string', __required: true }, seoDescription: { __type: 'string', __required: true },
        socialImage: { __type: 'object', __required: false, __child: { _id: { __type: 'string', __required: true } } },
        favicon: { __type: 'object', __required: false, __child: { _id: { __type: 'string', __required: true } } },
        analyticsId: { __type: 'string', __required: false }, contactFormEnabled: { __type: 'boolean', __required: true },
    } },
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
                sectionConfigs: { __type: 'array', __required: false, __child: { __type: 'object', __content: {
                    type: { __type: 'string', __required: true }, enabled: { __type: 'boolean', __required: true }, data: { __type: 'object', __required: true },
                } } },
                entryId: { __type: 'string', __required: false },
                blueprintKey: { __type: 'string', __required: false },
                enabled: { __type: 'boolean', __required: false },
                navigation: { __type: 'boolean', __required: false },
            },
        },
    },
    navigation: { __type: 'array', __required: false, __child: { __type: 'object', __content: {
        id: { __type: 'string', __required: true },
        label: { __type: 'string', __required: true },
        href: { __type: 'string', __required: false },
        enabled: { __type: 'boolean', __required: true },
        children: { __type: 'array', __required: true, __child: { __type: 'object', __content: {} } },
    } } },
};
