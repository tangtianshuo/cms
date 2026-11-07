import { Config } from '../config';
import { withMediaAccess } from '../media/access';
import { SocketManager } from '../socket/manager';
import { EventManager } from '../event/manager';
import { assertSiteCapability } from '../authorization/site-access';
import {
    buildStudioDraftPreview,
    validateStudioDraft,
    mergeStudioEntry,
    studioEntryId,
    type StudioDraftOverlay,
} from './draft-preview';
import type { ReleaseInput } from '../presets/releases';
import type { Template } from '../template/models/main';
import type { Entry } from '../entry/models/main';
import type { EntryContentNode } from '../entry/models/content';
import { prepareEntryCreate } from '../entry/create';
import { validateEntrySiteReferences } from '../entry/site-references';
import { EntryFactory } from '../entry/factory';
import {
    EntryCreateBodySchema,
    type EntryCreateBody,
} from '../entry/models/controller';
import { ObjectUtility } from '../_utils/object-utility';
import { z } from 'zod';
import {
    createController,
    createControllerMethod,
    HttpStatus,
} from '../_server';
import { RP } from '../security/route-protection/main';
import { Repo } from '../repo';
import {
    canReadContent,
    canWriteContent,
    workspaceContext,
} from '../workspaces/context';
import { resolveInstalledPreset } from '../presets/installed';
import {
    pageDraft,
    pageSectionOptionsForPage,
    updatePageDraft,
    type PageDraft,
} from '../presets/pages';
import type { SiteInstallation } from '../presets/site-model';
import {
    assertStudioWrite,
    entryValues,
    fieldDescriptors,
    pageOperationIds,
    patchEntry,
    type StudioValue,
} from './business';
import {
    validateStructuredFields,
    validateStructuredNodes,
} from './structured-content';
import { ownerWorkspace } from '../workspaces/context';
import { mediaReferenceAllowedForSite } from '../_utils/site-media';
import { createStudioPage } from './page-create';
import {
    normalizeNavigation,
    type NavigationNode,
} from '../presets/navigation';
import { normalizeSiteOperations } from '../presets/operations';
import {
    validateDeclaredSectionProperties,
    validateSectionMediaReferences,
    mediaAuthorizedForSite,
} from '../storefront/section-schema';
import { editorSchemaForSite } from '../template-contract/editor-schema';
import {
    buildContentForm,
    validateContentValues,
} from '../content-editor/schema-form';
import { withSiteMutation } from '../template-contract/site-mutation';

const structuredValueSchema = z
    .object({
        kind: z.literal('prop-data'),
        data: z.union([
            z.array(z.unknown()),
            z
                .object({
                    _id: z.string().min(1),
                    props: z.array(z.unknown()).optional(),
                    items: z.array(z.unknown()).optional(),
                })
                .strict(),
        ]),
    })
    .strict();
const studioValueSchema = z.union([
    structuredValueSchema,
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(
        z
            .object({
                _id: z.string().min(1),
                alt_text: z.string().optional(),
                caption: z.string().optional(),
            })
            .strict(),
    ),
    z.array(
        z.object({ tid: z.string().min(1), eid: z.string().min(1) }).strict(),
    ),
]);
const entryBody = z
    .object({
        language: z.string().optional(),
        entry: z.unknown().optional(),
        overlay: z.unknown().optional(),
        entryId: z.string().min(1).optional(),
        operationId: z.string().uuid(),
        expectedUpdatedAt: z.number().int().nonnegative().optional(),
        fields: z.record(studioValueSchema).optional(),
    })
    .strict()
    .refine(
        (body) => (body.fields !== undefined) !== (body.entry !== undefined),
    );
const sectionConfigBody = z
    .object({
        type: z.string().trim().min(1).max(120),
        enabled: z.boolean(),
        data: z.record(z.unknown()),
    })
    .strict();
const pageBody = z
    .object({
        expectedUpdatedAt: z.number().int().nonnegative(),
        title: z.string().trim().min(1).max(120),
        path: z.string().min(1).max(160),
        seoTitle: z.string().max(120),
        seoDescription: z.string().max(320),
        sections: z.array(z.string()).min(1),
        sectionConfigs: z.array(sectionConfigBody).optional(),
        layoutDocument: z.unknown().optional(),
        entryId: z.string(),
        enabled: z.boolean(),
        navigation: z.boolean(),
    })
    .strict();
const navigationBody: z.ZodType<NavigationNode> = z.lazy(() =>
    z
        .object({
            id: z.string().min(1).max(160),
            label: z.string().trim().min(1).max(120),
            href: z.string().trim().max(500).optional(),
            children: z.array(navigationBody),
            enabled: z.boolean(),
        })
        .strict(),
);
const operationsBody = z
    .object({
        seoTitle: z.string().max(120),
        seoDescription: z.string().max(320),
        socialImage: z
            .object({ _id: z.string().min(1) })
            .nullish()
            .transform((value) => value ?? undefined),
        favicon: z
            .object({ _id: z.string().min(1) })
            .nullish()
            .transform((value) => value ?? undefined),
        analyticsId: z.string().optional(),
        contactFormEnabled: z.boolean(),
    })
    .strict();
const settingsBody = z
    .object({
        expectedUpdatedAt: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(80),
        theme: z
            .object({
                background: z.string().regex(/^#[a-f0-9]{6}$/i),
                foreground: z.string().regex(/^#[a-f0-9]{6}$/i),
                accent: z.string().regex(/^#[a-f0-9]{6}$/i),
                muted: z.string().regex(/^#[a-f0-9]{6}$/i),
            })
            .strict(),
        navigation: z.array(navigationBody).optional(),
        operations: operationsBody.optional(),
    })
    .strict();
const overlayBody = z
    .object({
        entry: z
            .object({
                modelKey: z.string().min(1),
                entryId: z.string().optional(),
                operationId: z.string().uuid(),
                fields: z.record(studioValueSchema).optional(),
                entry: z.unknown().optional(),
            })
            .strict()
            .refine(
                (body) =>
                    (body.fields !== undefined) !== (body.entry !== undefined),
            )
            .optional(),
        page: pageBody
            .omit({ expectedUpdatedAt: true })
            .extend({ key: z.string(), blueprintKey: z.string().optional() })
            .strict()
            .optional(),
        settings: settingsBody.optional(),
    })
    .strict();
async function releaseInput(
    site: SiteInstallation,
    language = site.language || 'en',
): Promise<ReleaseInput> {
    const templates = [];
    const entries = [];
    for (const model of site.models) {
        const template = await installedModel(site, model.key);
        templates.push(template);
        entries.push(
            ...(
                await Repo.entry.methods.findAllByTemplateId(template._id)
            ).filter(
                (entry) =>
                    (!entry.siteId || entry.siteId === site._id) &&
                    canReadContent('Entry', entry),
            ),
        );
    }
    return {
        site: { ...site, language },
        templates,
        entries,
        media: (await Repo.media.findAll()).map(withMediaAccess),
        language,
        currency: Config.storefrontCurrency,
        mediaOrigin: Config.storefrontMediaOrigin,
    };
}
async function fullEntry(
    site: SiteInstallation,
    template: Template,
    value: unknown,
    previous: Entry | null,
    language: string,
): Promise<EntryCreateBody> {
    if (ObjectUtility.compareWithSchema(value, EntryCreateBodySchema, 'entry'))
        throw new Error('Invalid full Entry content');
    const raw = value as EntryCreateBody;
    const body = previous
        ? {
              ...raw,
              meta: raw.meta.filter((item) => item.lng === language),
              content: raw.content.filter((item) => item.lng === language),
              statuses: raw.statuses.filter((item) => item.lng === language),
          }
        : raw;
    await validateEntrySiteReferences(
        {
            siteId: site._id,
            templateId: template._id,
            groupId:
                raw.groupId ||
                previous?.groupId ||
                site.contentGroupId ||
                site._id,
            meta: body.meta,
            content: body.content,
        },
        template,
        Repo,
    );
    const [languages, statuses, resources] = await Promise.all([
        Repo.language.findAll(),
        Repo.entryStatus.findAll(),
        structuredResources(site),
    ]);
    const prepared = prepareEntryCreate(
        body,
        template.props,
        languages.map((item) => item.code),
        statuses.map((item) => item._id),
        resources.widgets,
        resources.groups,
        resources.templates,
        resources.medias,
    );
    return {
        ...prepared,
        ...(raw.groupId !== undefined ? { groupId: raw.groupId } : {}),
    };
}
async function validatePage(
    site: SiteInstallation,
    candidatePage: PageDraft,
    input: ReleaseInput,
) {
    const definitions = resolveInstalledPreset(site).editor?.sections || [];
    const resources = await structuredResources(site);
    if (candidatePage.layoutDocument && definitions.length) {
        const nodes = (
            candidatePage.layoutDocument as {
                root: Array<{
                    id: string;
                    type: string;
                    enabled: boolean;
                    props: Record<string, unknown>;
                }>;
            }
        ).root;
        validateDeclaredSectionProperties(
            nodes.map((node) => ({
                type: node.type,
                enabled: node.enabled,
                data: node.props,
            })),
            definitions,
            {
                media: input.media,
                site,
                referenceIds: new Set(input.entries.map((entry) => entry._id)),
            },
        );
        for (const node of nodes)
            for (const [key, field] of Object.entries(
                definitions.find((definition) => definition.type === node.type)
                    ?.props || {},
            )) {
                if (
                    field.control === 'rich-text' &&
                    node.props[key] != null &&
                    typeof node.props[key] !== 'string'
                ) {
                    const value = node.props[key] as {
                        nodes: EntryContentNode[];
                    };
                    validateStructuredNodes(
                        value.nodes,
                        resources,
                        `section.${node.id}.${key}`,
                    );
                    const model = await installedModel(
                        site,
                        candidatePage.modelKey,
                    );
                    await validateEntrySiteReferences(
                        {
                            siteId: site._id,
                            templateId: model._id,
                            groupId: site.contentGroupId || site._id,
                            meta: [],
                            content: [
                                {
                                    lng: input.language,
                                    nodes: value.nodes,
                                    plainText: '',
                                },
                            ],
                        },
                        model,
                        Repo,
                    );
                }
            }
    } else if (candidatePage.sectionConfigs)
        validateSectionMediaReferences(
            candidatePage.layout,
            candidatePage.sectionConfigs,
            {
                media: input.media,
                site,
                publishedPaths: new Set(
                    site.pages
                        .filter(
                            (page) =>
                                page.enabled !== false &&
                                !page.path.includes(':'),
                        )
                        .map((page) => page.path),
                ),
            },
        );
}
async function validatedOverlay(
    site: SiteInstallation,
    raw: unknown,
    language = site.language || 'en',
    mode: 'preview' | 'save' = 'preview',
) {
    const overlay = overlayBody.parse(raw) as StudioDraftOverlay;
    if (!(await Repo.language.findAll()).some((item) => item.code === language))
        throw new Error('Language unavailable');
    const input = await releaseInput(site, language);
    if (overlay.entry) {
        const value = overlay.entry;
        const template = await installedModel(site, value.modelKey);
        assertStudioWrite(template._id, value.entryId ? 'put' : 'post');
        const previous = value.entryId
            ? input.entries.find((entry) => entry._id === value.entryId)
            : undefined;
        if (
            value.entryId &&
            (!previous || previous.templateId !== template._id)
        )
            throw Object.assign(new Error('Entry not found in selected site'), {
                status: 403,
            });
        if (value.entry)
            value.entry = await fullEntry(
                site,
                template,
                value.entry,
                previous || null,
                language,
            );
        else await validateSelectedMedia(site, value.modelKey, value.fields!);
        const candidate = value.entry
            ? previous
                ? mergeStudioEntry(previous, value.entry, language)
                : {
                      ...EntryFactory.create({
                          templateId: template._id,
                          workspaceId: ownerWorkspace(site),
                          siteId: site._id,
                          userId: workspaceContext()!.actorId,
                          groupId:
                              value.entry.groupId ||
                              site.contentGroupId ||
                              site._id,
                          ...value.entry,
                      }),
                      _id: 'preview',
                  }
            : patchEntry(
                  { ...site, language },
                  template,
                  value.modelKey,
                  previous || null,
                  value.fields!,
                  workspaceContext()!.actorId,
                  'preview',
              );
        await validateStudioEntry(
            { ...site, language },
            template,
            candidate,
            !previous,
        );
        const fields = entryValues(
            { ...site, language },
            value.modelKey,
            candidate,
        );
        const errors = validateContentValues(
            buildContentForm(resolveInstalledPreset(site), value.modelKey),
            Object.fromEntries(
                Object.entries(fields).map(([key, data]) => [
                    key,
                    Array.isArray(data) && data.length === 1 ? data[0] : data,
                ]),
            ),
        );
        if (Object.keys(errors).length)
            throw new Error(
                Object.entries(errors)
                    .map(([field, message]) => `${field}: ${message}`)
                    .join('; '),
            );
    }
    if (overlay.page || overlay.settings)
        assertSiteCapability(workspaceContext(), 'pages.manage');
    if (overlay.page) {
        const value = overlay.page;
        // Identity fields are reconstructed from the installed blueprint; only writable fields survived the strict schema.
        const existing = pageDraft(site, value.key);
        const blueprint =
            value.blueprintKey && pageDraft(site, value.blueprintKey);
        if (!existing && !blueprint) throw new Error('Page not found');
        const candidate = { ...(existing || blueprint), ...value } as PageDraft;
        await validatePage(site, candidate, input);
    }
    if (overlay.settings?.operations) {
        const mediaIds = new Set(
            input.media
                .filter(
                    (item) =>
                        ['IMG', 'SVG', 'GIF'].includes(item.type) &&
                        mediaAuthorizedForSite(item, site, {
                            requireSiteBinding: true,
                        }),
                )
                .map((item) => item._id),
        );
        overlay.settings.operations = normalizeSiteOperations(
            overlay.settings.operations,
            mediaIds,
            {
                contactDeliveryConfigured: Boolean(
                    process.env.GATEWAY_BASE_URL &&
                        process.env.CMS_SERVICE_SECRET,
                ),
            },
        );
    }
    return mode === 'save'
        ? { overlay, validation: validateStudioDraft(input, overlay) }
        : { overlay, payload: buildStudioDraftPreview(input, overlay) };
}
function validationMessage(cause: unknown) {
    const issues = (
        cause as {
            issues?: Array<{
                entryId?: string;
                field?: string;
                message?: string;
            }>;
        }
    )?.issues;
    return issues?.[0]?.message
        ? `${issues[0].field || 'content'}: ${issues[0].message}`
        : cause instanceof Error
          ? cause.message
          : 'Draft validation failed';
}
function validationFailure(cause: unknown) {
    const issue = (
        cause as {
            issues?: Array<{
                field?: string;
                entryId?: string;
                modelKey?: string;
                pageKey?: string;
                code?: string;
                language?: string;
                message?: string;
            }>;
        }
    )?.issues?.[0];
    const issues = (
        cause as {
            issues?: Array<{
                code?: string;
                message?: string;
                modelKey?: string;
                entryId?: string;
                pageKey?: string;
                language?: string;
            }>;
        }
    )?.issues;
    return {
        message: validationMessage(cause),
        ...(issue
            ? {
                  code: `studio-validation:${JSON.stringify({ field: issue.field, entryId: issue.entryId, modelKey: issue.modelKey, pageKey: issue.pageKey, missingTranslations: issues?.filter((item) => item.code === 'missing-translation'), saveAllowed: Boolean(issues?.length && issues.every((item) => item.code === 'missing-translation')) })}`,
              }
            : {}),
    };
}
async function selectedSite() {
    const site = await Repo.siteInstallation.methods.findSelected();
    if (!site || site.status !== 'ready')
        throw Object.assign(
            new Error('Select a site with an installed, ready template'),
            { status: 404 },
        );
    resolveInstalledPreset(site);
    return site;
}
async function installedModel(site: SiteInstallation, key: string) {
    const mapping = site.models.find((item) => item.key === key);
    const template =
        mapping && (await Repo.template.findById(mapping.templateId));
    if (!mapping || !template || !canReadContent('Template', template))
        throw Object.assign(
            new Error('Installed model not found or not permitted'),
            { status: 403 },
        );
    return template;
}
async function validateSelectedMedia(
    site: SiteInstallation,
    modelKey: string,
    fields: Record<string, StudioValue>,
) {
    const template = await installedModel(site, modelKey);
    for (const field of fieldDescriptors(site, template, modelKey).filter(
        (item) => item.type === 'MEDIA',
    )) {
        const values = fields[field.key];
        if (!Array.isArray(values)) continue;
        for (const value of values)
            if ('_id' in value) {
                const media = await Repo.media.findById(value._id);
                if (!media || !['IMG', 'SVG', 'GIF'].includes(media.type))
                    throw new Error(
                        `${field.label}: select an accessible image`,
                    );
            }
    }
}
async function structuredResources(site: SiteInstallation) {
    const [widgets, groups, templates, medias] = await Promise.all([
        Repo.widget.findAll(),
        Repo.group.findAll(),
        Repo.template.findAll(),
        Repo.media.findAll(),
    ]);
    const allowed = (item: { workspaceId?: string; siteId?: string }) =>
        ownerWorkspace(item) === ownerWorkspace(site) &&
        (!item.siteId || item.siteId === site._id);
    return {
        widgets: widgets.filter(allowed),
        groups: groups.filter(allowed),
        templates: templates.filter(
            (item) => allowed(item) && canReadContent('Template', item),
        ),
        medias: medias.filter((item) =>
            mediaReferenceAllowedForSite(item, site),
        ),
    };
}
async function validateStudioEntry(
    site: SiteInstallation,
    template: Template,
    entry: Entry,
    allLanguages = false,
) {
    const resources = await structuredResources(site);
    const meta = entry.meta.find(
        (item) => item.lng === (site.language || 'en'),
    );
    if (!meta)
        throw new Error('Create this translation in the content workspace');
    validateStructuredFields(template, meta.props, resources);
    await validateEntrySiteReferences(
        entry,
        template,
        Repo,
        allLanguages ? undefined : site.language || 'en',
    );
}
function conflict() {
    return Object.assign(new Error('Site changed; refresh before saving'), {
        status: 409,
    });
}
export function assertStudioPageEntryBinding(
    siteId: string,
    entryId: string,
    boundEntry: { _id: string; siteId?: string } | null,
): void {
    if (
        !boundEntry ||
        boundEntry._id !== entryId ||
        boundEntry.siteId !== siteId
    )
        throw new Error('Invalid page Entry binding');
}
export const StudioController = createController({
    name: 'Studio',
    path: '/api/v4/studio',
    methods() {
        return {
            site: createControllerMethod({
                path: '/site',
                type: 'get',
                preRequestHandler: RP.createSiteCapabilityCheck('content.read'),
                async handler({ errorHandler }) {
                    const site =
                        await Repo.siteInstallation.methods.findSelected();
                    if (!site || site.status !== 'ready')
                        return {
                            site: null,
                            status: site?.status || 'empty',
                            models: [],
                        };
                    const preset = resolveInstalledPreset(site);
                    const editorSchema = editorSchemaForSite(preset);
                    const models = [];
                    for (const mapping of site.models) {
                        if (
                            !canReadContent('Template', {
                                _id: mapping.templateId,
                            })
                        )
                            continue;
                        const template = await Repo.template.findById(
                            mapping.templateId,
                        );
                        if (!template) continue;
                        const entries = (
                            await Repo.entry.methods.findAllByTemplateId(
                                template._id,
                            )
                        ).filter(
                            (entry) =>
                                !entry.siteId || entry.siteId === site._id,
                        );
                        models.push({
                            key: mapping.key,
                            label: template.label,
                            templateId: template._id,
                            singleEntry: template.singleEntry,
                            canCreate: canWriteContent(
                                'Entry',
                                { templateId: template._id },
                                'post',
                            ),
                            canEdit: canWriteContent(
                                'Entry',
                                { templateId: template._id },
                                'put',
                            ),
                            fields: fieldDescriptors(
                                site,
                                template,
                                mapping.key,
                            ),
                            editorFields:
                                editorSchema.models[mapping.key] || [],
                            entries: entries.map((entry) => ({
                                id: entry._id,
                                updatedAt: entry.updatedAt,
                                fields: entryValues(site, mapping.key, entry),
                                hasLanguage: entry.meta.some(
                                    (meta) =>
                                        meta.lng === (site.language || 'en'),
                                ),
                            })),
                        });
                    }
                    if (!workspaceContext())
                        throw errorHandler(
                            HttpStatus.Forbidden,
                            'Workspace context required',
                        );
                    return {
                        site: {
                            id: site._id,
                            name: site.name,
                            updatedAt: site.updatedAt,
                            language: site.language || 'en',
                            presetId: site.presetId,
                            presetVersion: site.presetVersion,
                            publicTemplate: Boolean(
                                site.publishedTemplateRecord,
                            ),
                            theme: site.theme,
                            pages: site.pages.map((page) =>
                                pageDraft(site, page.key),
                            ),
                            navigation: site.navigation,
                            operations: normalizeSiteOperations(
                                site.operations,
                                undefined,
                                { contactDeliveryConfigured: true },
                            ),
                            contactDeliveryConfigured: Boolean(
                                process.env.GATEWAY_BASE_URL &&
                                    process.env.CMS_SERVICE_SECRET,
                            ),
                            pageOptions: Object.fromEntries(
                                site.pages.map((page) => [
                                    page.key,
                                    pageSectionOptionsForPage(site, page.key),
                                ]),
                            ),
                            blueprints: preset.pages.filter(
                                (page) => page.layout === 'content-page',
                            ),
                            editorContract: preset.editor || null,
                            canManage: Boolean(workspaceContext()?.admin),
                        },
                        models,
                    };
                },
            }),
            preview: createControllerMethod({
                path: '/preview',
                type: 'post',
                preRequestHandler: RP.createSiteCapabilityCheck(
                    'content.read',
                    { readOnlyPost: true },
                ),
                async handler({ request, reply, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    reply.header('X-Robots-Tag', 'noindex, nofollow');
                    const parsed = z
                        .object({
                            sessionId: z.string().min(1).max(160),
                            revision: z.number().int().nonnegative(),
                            language: z.string().min(1).max(40),
                            overlay: z.unknown(),
                        })
                        .strict()
                        .safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid preview request',
                        );
                    try {
                        const site = await selectedSite();
                        const result = await validatedOverlay(
                            site,
                            parsed.data.overlay,
                            parsed.data.language,
                        );
                        return {
                            sessionId: parsed.data.sessionId,
                            revision: parsed.data.revision,
                            language: parsed.data.language,
                            workspaceId: ownerWorkspace(site),
                            siteId: site._id,
                            payload: {
                                kind: 'preset-site',
                                siteName:
                                    result.overlay.settings?.name || site.name,
                                ...result.payload,
                            },
                        };
                    } catch (cause) {
                        throw errorHandler(
                            (cause as { status?: number }).status ||
                                HttpStatus.BadRequest,
                            validationFailure(cause),
                        );
                    }
                },
            }),
            entry: createControllerMethod({
                path: '/entries/:modelKey',
                type: 'post',
                preRequestHandler:
                    RP.createSiteCapabilityCheck('content.write'),
                async handler({ request, errorHandler }) {
                    const parsed = entryBody.safeParse(request.body);
                    if (
                        !parsed.success ||
                        (parsed.data.entryId &&
                            parsed.data.expectedUpdatedAt === undefined)
                    )
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid Studio content request',
                        );
                    try {
                        const site = await selectedSite();
                        return await withSiteMutation(site._id, async () => {
                            const key = (request.params as { modelKey: string })
                                .modelKey;
                            const template = await installedModel(site, key);
                            assertStudioWrite(
                                template._id,
                                parsed.data.entryId ? 'put' : 'post',
                            );
                            const previous = parsed.data.entryId
                                ? await Repo.entry.findById(parsed.data.entryId)
                                : null;
                            if (parsed.data.entryId && !previous)
                                throw new Error('Entry not found');
                            if (
                                previous &&
                                previous.updatedAt !==
                                    parsed.data.expectedUpdatedAt
                            )
                                throw conflict();
                            const language =
                                parsed.data.language || site.language || 'en';
                            const overlay = overlayBody.parse(
                                parsed.data.overlay || {},
                            ) as StudioDraftOverlay;
                            if (overlay.entry)
                                throw new Error('Duplicate content overlay');
                            const prepared = await validatedOverlay(
                                site,
                                {
                                    ...overlay,
                                    entry: {
                                        modelKey: key,
                                        entryId: parsed.data.entryId,
                                        operationId: parsed.data.operationId,
                                        ...(parsed.data.entry !== undefined
                                            ? { entry: parsed.data.entry }
                                            : { fields: parsed.data.fields }),
                                    },
                                },
                                language,
                                'save',
                            );
                            const id = studioEntryId(
                                site._id,
                                key,
                                parsed.data.operationId,
                                template.singleEntry,
                            );
                            if (
                                !previous &&
                                template.singleEntry &&
                                (
                                    await Repo.entry.methods.findAllByTemplateId(
                                        template._id,
                                    )
                                ).some((entry) => entry._id !== id)
                            )
                                throw new Error(
                                    'This model already has content; refresh and edit it',
                                );
                            const value = prepared.overlay.entry!;
                            const updated = value.entry
                                ? previous
                                    ? mergeStudioEntry(
                                          previous,
                                          value.entry,
                                          language,
                                      )
                                    : {
                                          ...EntryFactory.create({
                                              templateId: template._id,
                                              workspaceId: ownerWorkspace(site),
                                              siteId: site._id,
                                              userId: workspaceContext()!
                                                  .actorId,
                                              groupId:
                                                  value.entry.groupId ||
                                                  site.contentGroupId ||
                                                  site._id,
                                              ...value.entry,
                                          }),
                                          _id: id,
                                      }
                                : patchEntry(
                                      { ...site, language },
                                      template,
                                      key,
                                      previous,
                                      value.fields!,
                                      workspaceContext()!.actorId,
                                      id,
                                  );
                            const same = (existing: Entry) =>
                                existing.templateId === updated.templateId &&
                                existing.groupId === updated.groupId &&
                                JSON.stringify(existing.meta) ===
                                    JSON.stringify(updated.meta) &&
                                JSON.stringify(existing.content) ===
                                    JSON.stringify(updated.content) &&
                                JSON.stringify(existing.statuses) ===
                                    JSON.stringify(updated.statuses);
                            let saved;
                            let changed = true;
                            if (previous)
                                saved = await Repo.entry.update(
                                    updated,
                                    false,
                                    parsed.data.expectedUpdatedAt,
                                );
                            else {
                                const existing = await Repo.entry.findById(id);
                                if (existing) {
                                    if (!same(existing)) throw conflict();
                                    saved = existing;
                                    changed = false;
                                } else {
                                    try {
                                        saved = await Repo.entry.add(updated);
                                    } catch (cause) {
                                        const retry =
                                            await Repo.entry.findById(id);
                                        if (!retry || !same(retry)) throw cause;
                                        saved = retry;
                                        changed = false;
                                    }
                                }
                            }
                            if (changed) {
                                SocketManager.channelEmit(
                                    ['global'],
                                    'entry',
                                    {
                                        type: 'update',
                                        templateId: template._id,
                                        entryId: saved._id,
                                    },
                                    [workspaceContext()!.actorId],
                                );
                                EventManager.trigger(
                                    previous ? 'update' : 'add',
                                    'entry',
                                    saved,
                                ).catch((cause) => console.error(cause));
                            }
                            return {
                                id: saved._id,
                                updatedAt: saved.updatedAt,
                            };
                        });
                    } catch (cause) {
                        throw errorHandler(
                            (cause as { status?: number }).status ||
                                HttpStatus.BadRequest,
                            validationFailure(cause),
                        );
                    }
                },
            }),
            addPage: createControllerMethod({
                path: '/pages',
                type: 'post',
                preRequestHandler: RP.createSiteCapabilityCheck('pages.manage'),
                async handler({ request, errorHandler }) {
                    const parsed = z
                        .object({
                            operationId: z.string().uuid(),
                            expectedUpdatedAt: z.number().int().nonnegative(),
                            title: z.string().trim().min(1).max(120),
                            path: z.string().max(160),
                            blueprintKey: z.string(),
                            page: pageBody
                                .omit({
                                    expectedUpdatedAt: true,
                                    title: true,
                                    path: true,
                                    entryId: true,
                                })
                                .optional(),
                            fields: z.record(studioValueSchema).optional(),
                            entry: z.unknown().optional(),
                        })
                        .strict()
                        .refine(
                            (body) =>
                                (body.fields !== undefined) !==
                                (body.entry !== undefined),
                        )
                        .safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid new page',
                        );
                    try {
                        const initialSite = await selectedSite();
                        return await withSiteMutation(
                            initialSite._id,
                            async () => {
                                const site = await selectedSite();
                                const context = workspaceContext();
                                if (!context)
                                    throw new Error(
                                        'Selected workspace is required',
                                    );
                                const blueprint = site.pages.find(
                                    (page) =>
                                        page.key === parsed.data.blueprintKey &&
                                        !page.blueprintKey &&
                                        page.layout === 'content-page',
                                );
                                if (!blueprint)
                                    throw new Error(
                                        'Content page blueprint is unavailable',
                                    );
                                const template = await installedModel(
                                    site,
                                    blueprint.modelKey,
                                );
                                assertStudioWrite(template._id, 'post');
                                const ids = pageOperationIds(
                                    site._id,
                                    parsed.data.operationId,
                                );
                                if (
                                    site.updatedAt !==
                                        parsed.data.expectedUpdatedAt &&
                                    !pageDraft(site, ids.pageKey)
                                )
                                    throw conflict();
                                let entry;
                                if (parsed.data.entry !== undefined) {
                                    const invalid =
                                        ObjectUtility.compareWithSchema(
                                            parsed.data.entry,
                                            EntryCreateBodySchema,
                                            'entry',
                                        );
                                    if (invalid)
                                        throw new Error('Invalid page content');
                                    const body = parsed.data
                                        .entry as EntryCreateBody;
                                    await validateEntrySiteReferences(
                                        {
                                            siteId: site._id,
                                            templateId: template._id,
                                            groupId:
                                                body.groupId ||
                                                site.contentGroupId ||
                                                site._id,
                                            meta: body.meta,
                                            content: body.content,
                                        },
                                        template,
                                        Repo,
                                    );
                                    const [
                                        languages,
                                        statuses,
                                        widgets,
                                        groups,
                                        medias,
                                        templates,
                                    ] = await Promise.all([
                                        Repo.language.findAll(),
                                        Repo.entryStatus.findAll(),
                                        Repo.widget.findAll(),
                                        Repo.group.findAll(),
                                        Repo.media.findAll(),
                                        Repo.template.findAll(),
                                    ]);
                                    const prepared = prepareEntryCreate(
                                        body,
                                        template.props,
                                        languages.map((item) => item.code),
                                        statuses.map((item) => item._id),
                                        widgets,
                                        groups,
                                        templates,
                                        medias,
                                    );
                                    entry = {
                                        ...EntryFactory.create({
                                            templateId: template._id,
                                            workspaceId: context.workspaceId,
                                            siteId: site._id,
                                            userId: context.actorId,
                                            groupId:
                                                body.groupId ||
                                                site.contentGroupId ||
                                                site._id,
                                            ...prepared,
                                        }),
                                        _id: ids.entryId,
                                    };
                                } else {
                                    const fields = parsed.data.fields as
                                        | Record<string, StudioValue>
                                        | undefined;
                                    if (!fields)
                                        throw new Error('Invalid page content');
                                    await validateSelectedMedia(
                                        site,
                                        blueprint.modelKey,
                                        fields,
                                    );
                                    entry = patchEntry(
                                        site,
                                        template,
                                        blueprint.modelKey,
                                        null,
                                        fields,
                                        context.actorId,
                                        ids.entryId,
                                    );
                                }
                                await validateStudioEntry(
                                    site,
                                    template,
                                    entry,
                                    true,
                                );
                                const blueprintDraft = pageDraft(
                                    site,
                                    blueprint.key,
                                )!;
                                await validatedOverlay(
                                    site,
                                    {
                                        entry: {
                                            modelKey: blueprint.modelKey,
                                            operationId:
                                                parsed.data.operationId,
                                            ...(pageDraft(site, ids.pageKey)
                                                ? { entryId: ids.entryId }
                                                : {}),
                                            entry: {
                                                meta: entry.meta,
                                                content: entry.content,
                                                statuses: entry.statuses,
                                                groupId: entry.groupId,
                                            },
                                        },
                                        page: {
                                            key: pageDraft(site, ids.pageKey)
                                                ? ids.pageKey
                                                : 'new-page',
                                            blueprintKey: blueprint.key,
                                            title: parsed.data.title,
                                            path: parsed.data.path,
                                            seoTitle: parsed.data.title,
                                            seoDescription: '',
                                            sections: blueprintDraft.sections,
                                            sectionConfigs:
                                                blueprintDraft.sectionConfigs,
                                            layoutDocument:
                                                blueprintDraft.layoutDocument,
                                            enabled: true,
                                            navigation: true,
                                            ...parsed.data.page,
                                            entryId: pageDraft(
                                                site,
                                                ids.pageKey,
                                            )
                                                ? ids.entryId
                                                : '',
                                        },
                                    },
                                    site.language || 'en',
                                    'save',
                                );
                                return await createStudioPage(
                                    site,
                                    parsed.data.operationId,
                                    entry,
                                    parsed.data,
                                    {
                                        findEntry: (id) =>
                                            Repo.entry.findById(id),
                                        addEntry: (createdEntry) =>
                                            Repo.entry.add(createdEntry),
                                        saveSite: (updated, expected) =>
                                            Repo.siteInstallation.methods.saveDraft(
                                                updated,
                                                expected,
                                            ),
                                        findSite: () =>
                                            Repo.siteInstallation.methods.findSelected(),
                                    },
                                    parsed.data.expectedUpdatedAt,
                                );
                            },
                        );
                    } catch (cause) {
                        throw errorHandler(
                            (cause as { status?: number }).status ||
                                HttpStatus.BadRequest,
                            validationFailure(cause),
                        );
                    }
                },
            }),
            page: createControllerMethod({
                path: '/pages/:pageKey',
                type: 'post',
                preRequestHandler: RP.createSiteCapabilityCheck('pages.manage'),
                async handler({ request, errorHandler }) {
                    const parsed = pageBody
                        .extend({ overlay: z.unknown().optional() })
                        .safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid page draft',
                        );
                    try {
                        const initialSite = await selectedSite();
                        return await withSiteMutation(
                            initialSite._id,
                            async () => {
                                const site = await selectedSite();
                                if (
                                    site.updatedAt !==
                                    parsed.data.expectedUpdatedAt
                                )
                                    throw conflict();
                                const key = (
                                    request.params as { pageKey: string }
                                ).pageKey;
                                const bound = parsed.data.entryId
                                    ? await Repo.entry.findById(
                                          parsed.data.entryId,
                                      )
                                    : null;
                                if (parsed.data.entryId)
                                    assertStudioPageEntryBinding(
                                        site._id,
                                        parsed.data.entryId,
                                        bound,
                                    );
                                if (parsed.data.sectionConfigs) {
                                    const draft = pageDraft(site, key);
                                    const preset = resolveInstalledPreset(site);
                                    const contractPage = Boolean(
                                        draft &&
                                            preset.editor?.pages.some(
                                                (item) =>
                                                    item.pageKey ===
                                                    (draft.blueprintKey || key),
                                            ),
                                    );
                                    if (!contractPage) {
                                        const media =
                                            await Repo.media.findAll();
                                        validateSectionMediaReferences(
                                            draft?.layout || '',
                                            parsed.data.sectionConfigs as never,
                                            {
                                                media,
                                                site,
                                                publishedPaths: new Set(
                                                    site.pages
                                                        .filter(
                                                            (page) =>
                                                                page.enabled !==
                                                                    false &&
                                                                !page.path.includes(
                                                                    ':',
                                                                ),
                                                        )
                                                        .map(
                                                            (page) => page.path,
                                                        ),
                                                ),
                                            },
                                        );
                                    }
                                }
                                const updated = updatePageDraft(
                                    site,
                                    key,
                                    parsed.data,
                                    bound,
                                );
                                // Validate the normalized winning layout, never the duplicate client sectionConfigs.
                                const savedPage = pageDraft(updated, key);
                                if (!savedPage)
                                    throw new Error('Page not found');
                                const definitions =
                                    resolveInstalledPreset(site).editor
                                        ?.sections || [];
                                if (
                                    savedPage.layoutDocument &&
                                    definitions.length
                                ) {
                                    const media = await Repo.media.findAll();
                                    const references = (
                                        await Promise.all(
                                            site.models.map((model) =>
                                                Repo.entry.methods.findAllByTemplateId(
                                                    model.templateId,
                                                ),
                                            ),
                                        )
                                    )
                                        .flat()
                                        .filter(
                                            (entry) =>
                                                entry.siteId === site._id &&
                                                canReadContent('Entry', entry),
                                        );
                                    validateDeclaredSectionProperties(
                                        (
                                            savedPage.layoutDocument as {
                                                root: Array<{
                                                    type: string;
                                                    enabled: boolean;
                                                    props: Record<
                                                        string,
                                                        unknown
                                                    >;
                                                }>;
                                            }
                                        ).root.map((node) => ({
                                            type: node.type,
                                            enabled: node.enabled,
                                            data: node.props,
                                        })),
                                        definitions,
                                        {
                                            media,
                                            site,
                                            referenceIds: new Set(
                                                references.map(
                                                    (entry) => entry._id,
                                                ),
                                            ),
                                        },
                                    );
                                    const resources =
                                        await structuredResources(site);
                                    for (const node of (
                                        savedPage.layoutDocument as {
                                            root: Array<{
                                                type: string;
                                                props: Record<string, unknown>;
                                            }>;
                                        }
                                    ).root) {
                                        const declared =
                                            definitions.find(
                                                (item) =>
                                                    item.type === node.type,
                                            )?.props || {};
                                        for (const [
                                            fieldKey,
                                            field,
                                        ] of Object.entries(declared))
                                            if (
                                                field.control === 'rich-text' &&
                                                node.props[fieldKey] !==
                                                    undefined &&
                                                node.props[fieldKey] !== null
                                            ) {
                                                const value = node.props[
                                                    fieldKey
                                                ] as { nodes?: unknown };
                                                validateStructuredNodes(
                                                    value?.nodes,
                                                    resources,
                                                    `section.${node.type}.${fieldKey}`,
                                                );
                                                // Only the content view is synthetic. Site and model identities are resolved above.
                                                const model =
                                                    await installedModel(
                                                        site,
                                                        savedPage.modelKey,
                                                    );
                                                await validateEntrySiteReferences(
                                                    {
                                                        siteId: site._id,
                                                        templateId: model._id,
                                                        groupId:
                                                            site.contentGroupId ||
                                                            site._id,
                                                        meta: [],
                                                        content: [
                                                            {
                                                                lng:
                                                                    site.language ||
                                                                    'en',
                                                                nodes: value.nodes as never,
                                                                plainText: '',
                                                            },
                                                        ],
                                                    },
                                                    model,
                                                    Repo,
                                                );
                                            }
                                    }
                                }
                                await validatedOverlay(
                                    updated,
                                    parsed.data.overlay || {},
                                    site.language || 'en',
                                    'save',
                                );
                                if (
                                    !(await Repo.siteInstallation.methods.saveDraft(
                                        updated,
                                        site.updatedAt,
                                    ))
                                )
                                    throw conflict();
                                return {
                                    ...pageDraft(updated, key)!,
                                    siteUpdatedAt: updated.updatedAt,
                                };
                            },
                        );
                    } catch (cause) {
                        throw errorHandler(
                            (cause as { status?: number }).status ||
                                HttpStatus.BadRequest,
                            validationFailure(cause),
                        );
                    }
                },
            }),
            settings: createControllerMethod({
                path: '/settings',
                type: 'post',
                preRequestHandler: RP.createSiteCapabilityCheck('pages.manage'),
                async handler({ request, errorHandler }) {
                    const parsed = settingsBody.safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Name and four six-digit theme colors are required',
                        );
                    const initialSite = await selectedSite();
                    return withSiteMutation(initialSite._id, async () => {
                        const site = await selectedSite();
                        if (site.updatedAt !== parsed.data.expectedUpdatedAt)
                            throw errorHandler(
                                HttpStatus.Conflict,
                                'Site changed; refresh before saving',
                            );
                        let navigation = site.navigation;
                        if (parsed.data.navigation !== undefined) {
                            try {
                                navigation = normalizeNavigation(
                                    parsed.data.navigation,
                                    {
                                        publishedPaths: site.pages
                                            .filter(
                                                (page) =>
                                                    page.enabled !== false &&
                                                    !page.path.includes(':'),
                                            )
                                            .map((page) => page.path),
                                    },
                                );
                            } catch (cause) {
                                throw errorHandler(
                                    HttpStatus.BadRequest,
                                    cause instanceof Error
                                        ? cause.message
                                        : 'Invalid navigation',
                                );
                            }
                        }
                        let operations =
                            site.operations ||
                            normalizeSiteOperations({
                                contactFormEnabled: false,
                            });
                        if (parsed.data.operations !== undefined) {
                            const availableMedia = await Repo.media.findAll();
                            const mediaIds = new Set(
                                availableMedia
                                    .filter(
                                        (item) =>
                                            ['IMG', 'SVG', 'GIF'].includes(
                                                item.type,
                                            ) &&
                                            mediaAuthorizedForSite(item, site, {
                                                requireSiteBinding: true,
                                            }),
                                    )
                                    .map((item) => item._id),
                            );
                            try {
                                operations = normalizeSiteOperations(
                                    parsed.data.operations,
                                    mediaIds,
                                    {
                                        contactDeliveryConfigured: Boolean(
                                            process.env.GATEWAY_BASE_URL &&
                                                process.env.CMS_SERVICE_SECRET,
                                        ),
                                    },
                                );
                            } catch (cause) {
                                throw errorHandler(
                                    HttpStatus.BadRequest,
                                    cause instanceof Error
                                        ? cause.message
                                        : 'Invalid website operations',
                                );
                            }
                        }
                        const updated = {
                            ...site,
                            name: parsed.data.name,
                            theme: { ...site.theme, ...parsed.data.theme },
                            navigation,
                            operations,
                        };
                        try {
                            validateStudioDraft(
                                await releaseInput(updated),
                                {},
                            );
                        } catch (cause) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                validationFailure(cause),
                            );
                        }
                        if (
                            !(await Repo.siteInstallation.methods.saveDraft(
                                updated,
                                site.updatedAt,
                            ))
                        )
                            throw errorHandler(
                                HttpStatus.Conflict,
                                'Site changed; refresh before saving',
                            );
                        return { updatedAt: updated.updatedAt };
                    });
                },
            }),
        };
    },
});
