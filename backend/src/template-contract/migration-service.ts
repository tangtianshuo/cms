import { createHash, randomUUID } from 'node:crypto';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import type { PresetManifest } from '../presets/catalog';
import type { GatewayReleaseSource } from '../presets/gateway-publish';
import {
    publishGatewayRelease,
} from '../presets/gateway-publish';
import { resolveGatewayPublishConfig } from '../site-provisioning/config';
import { isGatewayUnavailable } from '../presets/gateway-client';
import type { GatewayState } from '../presets/gateway-state';
import { readGatewayState } from '../presets/gateway-state';
import type { ReleaseInput } from '../presets/releases';
import type { SiteInstallation, SitePage } from '../presets/site-model';
import type { Template } from '../template/models/main';
import { PropFactory } from '../prop/factory';
import { PropType } from '../prop/models/main';
import { ownerWorkspace } from '../workspaces/context';
import type { PublicTemplateRecord } from '../presets/registry';
import { Repo } from '../repo';
import { Config } from '../config';
import { releaseSource } from '../presets/release-source';
import {
    createMemoryMigrationRepository,
    type MigrationOperation,
    type MigrationRepository,
} from './migration-repo';
import {
    previewMigration,
    type MigrationDocument,
    type MigrationStep,
} from './migration-preview';
import {
    migrationTargetForManifest,
    toMigrationDocument,
} from './migration-document';
import { withSiteMutation, SiteMutationConflict } from './site-mutation';
import { createMigrationReleaseSource } from './migration-source';
import { mediaAuthorizedForSite } from '../storefront/section-schema';

function digest(value: unknown): string {
    const plain = JSON.parse(JSON.stringify(value));
    return `sha256:${createHash('sha256')
        .update(JSON.stringify(plain))
        .digest('hex')}`;
}

function stableId(operationId: string, kind: string, id: string): string {
    return createHash('sha256')
        .update(`${operationId}:${kind}:${id}`)
        .digest('hex')
        .slice(0, 24);
}

function uuidFrom(value: string): string {
    const hash = createHash('sha256').update(value).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(
        13,
        16,
    )}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

export function migrationSourceChecksum(
    site: SiteInstallation,
    templates: Template[],
    entries: Entry[],
    media: Media[] = [],
): string {
    return digest({
        site: {
            _id: site._id,
            workspaceId: ownerWorkspace(site),
            updatedAt: site.updatedAt,
            presetId: site.presetId,
            presetVersion: site.presetVersion,
            models: site.models,
            pages: site.pages,
            navigation: site.navigation,
        },
        templates: templates.map((template) => ({
            _id: template._id,
            updatedAt: template.updatedAt,
            props: template.props,
        })),
        entries: entries.map((entry) => ({
            _id: entry._id,
            updatedAt: entry.updatedAt,
            templateId: entry.templateId,
            meta: entry.meta,
            content: entry.content,
        })),
        media: media.map((item) => ({
            _id: item._id,
            updatedAt: item.updatedAt,
            mimetype: item.mimetype,
            size: item.size,
        })),
    });
}

function rewritePointers(
    value: unknown,
    templateIds: Map<string, string>,
    entryIds: Map<string, string>,
): unknown {
    if (Array.isArray(value)) {
        return value.map((item) =>
            rewritePointers(item, templateIds, entryIds),
        );
    }
    if (!value || typeof value !== 'object') return value;
    const objectValue = value as Record<string, unknown>;
    if (
        typeof objectValue.tid === 'string' &&
        typeof objectValue.eid === 'string'
    ) {
        return {
            ...objectValue,
            tid: templateIds.get(objectValue.tid) || objectValue.tid,
            eid: entryIds.get(objectValue.eid) || objectValue.eid,
        };
    }
    return Object.fromEntries(
        Object.entries(objectValue).map(([key, child]) => [
            key,
            rewritePointers(child, templateIds, entryIds),
        ]),
    );
}

function sectionRename(
    type: string,
    steps: MigrationStep[],
): string {
    let result = type;
    for (const step of steps) {
        if (step.op === 'rename-section' && result === step.from) {
            result = step.to;
        }
    }
    return result;
}

function migratePage(
    page: SitePage,
    steps: MigrationStep[],
    templateIds: Map<string, string>,
    entryIds: Map<string, string>,
): SitePage {
    const next = clone(page);
    next.entryId = entryIds.get(page.entryId || '') || page.entryId;
    next.sections = page.sections?.map((type) =>
        sectionRename(type, steps),
    );
    next.sectionConfigs = page.sectionConfigs?.map((section) => ({
        ...section,
        type: sectionRename(section.type, steps) as typeof section.type,
        data: rewritePointers(
            section.data,
            templateIds,
            entryIds,
        ) as Record<string, unknown>,
    }));
    const patchLayout = (nodes: unknown): unknown => {
        if (Array.isArray(nodes)) return nodes.map(patchLayout);
        if (!nodes || typeof nodes !== 'object') return nodes;
        const node = nodes as Record<string, unknown>;
        return {
            ...node,
            ...(typeof node.type === 'string'
                ? { type: sectionRename(node.type, steps) }
                : {}),
            ...(node.props
                ? {
                      props: rewritePointers(
                          node.props,
                          templateIds,
                          entryIds,
                      ),
                  }
                : {}),
            ...(node.children
                ? { children: patchLayout(node.children) }
                : {}),
        };
    };
    if (next.layoutDocument) {
        next.layoutDocument = patchLayout(
            next.layoutDocument,
        ) as SiteInstallation['pages'][number]['layoutDocument'];
    }
    return next;
}

export interface PrepareMigrationInput {
    site: SiteInstallation;
    requestKey: string;
    expectedUpdatedAt: number;
    actorId: string;
    targetManifest: PresetManifest;
    targetRecord: PublicTemplateRecord;
    input: ReleaseInput;
    steps?: MigrationStep[];
}

export function prepareMigrationOperation(
    input: PrepareMigrationInput,
): MigrationOperation {
    const {
        site,
        requestKey,
        expectedUpdatedAt,
        actorId,
        targetManifest,
        targetRecord,
        input: releaseInput,
        steps = [],
    } = input;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestKey)) {
        throw new TypeError('A stable requestKey UUID is required');
    }
    if (site.status !== 'ready' || site.updatedAt !== expectedUpdatedAt) {
        throw new SiteMutationConflict('Site changed; refresh before upgrading');
    }
    if (
        targetRecord.id !== targetManifest.id ||
        targetRecord.version !== targetManifest.version ||
        targetRecord.schemaVersion !== 1 ||
        targetRecord.status !== 'available' ||
        !/^sha256:[a-f0-9]{64}$/.test(targetRecord.manifestChecksum) ||
        !/^sha256:[a-f0-9]{64}$/.test(targetRecord.imageDigest) ||
        !/^[a-f0-9]{40}$/.test(targetRecord.sourceCommit) ||
        targetRecord.imageRepository !==
            `ghcr.io/tangtianshuo/independent-website-templates/${targetRecord.id}` ||
        targetRecord.manifestPath !==
            `templates/${targetRecord.id}/${targetRecord.version}/template.json`
    ) {
        throw new Error('Target template identity mismatch');
    }
    const operationId = randomUUID();
    const sourceChecksum = migrationSourceChecksum(
        site,
        releaseInput.templates,
        releaseInput.entries,
        releaseInput.media,
    );
    const document = toMigrationDocument(site, releaseInput);
    const target = migrationTargetForManifest(
        targetManifest,
        site,
        releaseInput.media
            .filter(
                (item) =>
                    ownerWorkspace(item) === ownerWorkspace(site) &&
                    (!item.siteId || item.siteId === site._id),
            )
            .map((item) => item._id),
    );
    const preview = previewMigration(document, steps);
    if (preview.issues.length) {
        throw new Error(
            `Migration validation failed: ${preview.issues
                .slice(0, 3)
                .map((item) => item.code)
                .join(',')}`,
        );
    }
    const namespace = `${site.templateNamespace || site._id}-migration-${operationId}`;
    const oldTemplates = new Map(
        site.models.map((model) => [
            model.key,
            releaseInput.templates.find(
                (template) => template._id === model.templateId,
            ),
        ]),
    );
    const oldModel = new Map(site.models.map((model) => [model.key, model]));
    const candidateTemplates: Template[] = [];
    const modelTemplates = new Map<string, Template>();
    for (const model of targetManifest.models) {
        const templateId = stableId(operationId, 'template', model.key);
        const previous = oldTemplates.get(model.key);
        const props = model.fields.map((field) => {
            const prop =
                previous?.props.find((item) => item.name === field.key) ||
                PropFactory.create(field.type, field.array);
            if (!prop) throw new Error(`Unsupported field type ${field.type}`);
            return {
                ...structuredClone(prop),
                id: stableId(operationId, `prop:${model.key}`, field.key),
                name: field.key,
                label: field.label,
                type: field.type,
                required: field.required,
                array: field.array,
                data:
                    field.type === PropType.ENTRY_POINTER &&
                    field.referenceModel
                        ? {
                              propEntryPointer: [
                                  {
                                      templateId: stableId(
                                          operationId,
                                          'template',
                                          field.referenceModel,
                                      ),
                                      entryIds: [],
                                      displayProp:
                                          modelTemplates
                                              .get(field.referenceModel)
                                              ?.props.find(
                                                  (item) =>
                                                      item.name === 'title',
                                              )?.id ||
                                          stableId(
                                              operationId,
                                              `prop:${field.referenceModel}`,
                                              'title',
                                          ),
                                  },
                              ],
                          }
                        : (structuredClone(prop.data) as typeof prop.data),
            } as Template['props'][number];
        });
        const template: Template = {
            _id: templateId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            workspaceId: ownerWorkspace(site),
            siteId: site._id,
            name: `${namespace}-${model.key}`,
            label: model.label,
            desc: model.description,
            userId: '__migration',
            singleEntry: model.singleEntry,
            props,
        };
        candidateTemplates.push(template);
        modelTemplates.set(model.key, template);
    }
    const templateIds = new Map<string, string>();
    for (const model of targetManifest.models) {
        const old = site.models.find((item) => item.key === model.key);
        if (old) {
            templateIds.set(
                old.templateId,
                stableId(operationId, 'template', model.key),
            );
        }
    }
    const entryIds = new Map<string, string>();
    for (const modelEntries of Object.values(preview.document.models)) {
        for (const entry of modelEntries) {
            entryIds.set(
                entry.id,
                stableId(operationId, 'entry', entry.id),
            );
        }
    }
    const entryById = new Map(
        releaseInput.entries.map((entry) => [entry._id, entry]),
    );
    const candidateEntries: Entry[] = [];
    for (const [modelKey, entries] of Object.entries(
        preview.document.models,
    )) {
        const candidateTemplate = modelTemplates.get(modelKey);
        if (!candidateTemplate) continue;
        for (const row of entries) {
            const prior = entryById.get(row.id);
            if (!prior) continue;
            const meta = prior.meta.map((languageMeta) => {
                const fields =
                    languageMeta.lng === releaseInput.language
                        ? row.fields
                        : Object.fromEntries(
                              Object.entries(row.fields).map(
                                  ([key, value]) => [key, value],
                              ),
                          );
                return {
                    ...structuredClone(languageMeta),
                    props: candidateTemplate.props.flatMap((prop) => {
                        if (!Object.prototype.hasOwnProperty.call(fields, prop.name)) {
                            return [];
                        }
                        const value = rewritePointers(
                            fields[prop.name],
                            templateIds,
                            entryIds,
                        );
                        return [
                            {
                                id: prop.id,
                                data: (prop.array
                                    ? value
                                    : [value]) as typeof languageMeta.props[number]['data'],
                            },
                        ];
                    }),
                };
            });
            candidateEntries.push({
                ...structuredClone(prior),
                _id: entryIds.get(prior._id)!,
                templateId: candidateTemplate._id,
                groupId: `${site.contentGroupId || site._id}-migration-${operationId}`,
                meta,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
    }
    const candidateSite: SiteInstallation = {
        ...structuredClone(site),
        presetId: targetManifest.id,
        presetVersion: targetManifest.version,
        presetManifestSnapshot: JSON.stringify(targetManifest),
        publishedTemplateRecord: JSON.stringify(targetRecord),
        templateNamespace: namespace,
        contentGroupId: `${site.contentGroupId || site._id}-migration-${operationId}`,
        models: targetManifest.models.map((model) => ({
            key: model.key,
            templateId: modelTemplates.get(model.key)!._id,
            fields: model.fields.map((field) => ({
                key: field.key,
                propId: modelTemplates
                    .get(model.key)!
                    .props.find((prop) => prop.name === field.key)!.id,
            })),
        })),
        pages: site.pages.map((page) => ({
            ...migratePage(page, steps, templateIds, entryIds),
            modelKey: targetManifest.models.some(
                (model) => model.key === page.modelKey,
            )
                ? page.modelKey
                : oldModel.get(page.modelKey)?.key || page.modelKey,
        })),
        status: 'ready',
        updatedAt: Math.max(Date.now(), site.updatedAt + 1),
    };
    for (const requiredPage of targetManifest.pages) {
        if (
            candidateSite.pages.some(
                (page) =>
                    page.key === requiredPage.key ||
                    page.blueprintKey === requiredPage.key ||
                    page.path === requiredPage.path,
            )
        ) {
            continue;
        }
        const candidateTemplate = modelTemplates.get(requiredPage.modelKey);
        const firstEntry = candidateEntries.find(
            (entry) => entry.templateId === candidateTemplate?._id,
        );
        candidateSite.pages.push({
            key: requiredPage.key,
            title: requiredPage.title,
            path: requiredPage.path,
            modelKey: requiredPage.modelKey,
            layout: requiredPage.layout,
            status: 'draft',
            ...(firstEntry ? { entryId: firstEntry._id } : {}),
            sections:
                targetManifest.editor?.pages.find(
                    (page) => page.pageKey === requiredPage.key,
                )?.sections || [],
            enabled: true,
            navigation: !requiredPage.path.includes(':'),
        });
    }
    const targetPreview = previewMigration(
        {
            models: Object.fromEntries(
                targetManifest.models.map((model) => [
                    model.key,
                    candidateEntries
                        .filter(
                            (entry) =>
                                entry.templateId ===
                                modelTemplates.get(model.key)?._id,
                        )
                        .map((entry) => ({
                            id: entry._id,
                            fields: Object.fromEntries(
                                candidateSite.models
                                    .find(
                                        (mapping) =>
                                            mapping.templateId ===
                                            entry.templateId,
                                    )!
                                    .fields.map((field) => {
                                        const propId = field.propId;
                                        const value =
                                            entry.meta
                                                .find(
                                                    (meta) =>
                                                        meta.lng ===
                                                        releaseInput.language,
                                                )
                                                ?.props.find(
                                                    (prop) =>
                                                        prop.id === propId,
                                                )?.data;
                                        const prop =
                                            candidateTemplates
                                                .find(
                                                    (template) =>
                                                        template._id ===
                                                        entry.templateId,
                                                )
                                                ?.props.find(
                                                    (item) =>
                                                        item.id === propId,
                                                );
                                        return [
                                            field.key,
                                            prop?.array
                                                ? value || []
                                                : Array.isArray(value)
                                                  ? value[0]
                                                  : value,
                                        ];
                                    }),
                            ),
                        })),
                ]),
            ),
            pages: candidateSite.pages.map((page) => ({
                id: page.key,
                path: page.path,
                sections: (page.sectionConfigs || []).map(
                    (section, index) => ({
                        id: `${page.key}:${index}:${section.type}`,
                        type: section.type,
                        props: section.data,
                    }),
                ),
            })),
        },
        [],
    );
    if (targetPreview.issues.length) {
        throw new Error(
            `Candidate validation failed: ${targetPreview.issues
                .slice(0, 3)
                .map((item) => item.code)
                .join(',')}`,
        );
    }
    return {
        id: operationId,
        cmsWorkspaceId: ownerWorkspace(site),
        cmsSiteId: site._id,
        requestKey,
        expectedUpdatedAt,
        sourceChecksum,
        targetManifestChecksum: targetRecord.manifestChecksum,
        status: 'staged',
        previousSite: structuredClone(site),
        candidateSite,
        previousReleaseId: site.gatewayCurrentReleaseId || '',
        actorId,
        steps: clone(steps),
        previousTemplates: clone(releaseInput.templates),
        candidateTemplates,
        previousEntries: clone(releaseInput.entries),
        candidateEntries,
        media: clone(
            releaseInput.media.filter((item) =>
                target.availableMediaIds?.includes(item._id),
            ),
        ),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function canFinalizeMigration(
    targetReleaseId: string,
    targetRouteRevision: number,
    state: GatewayState,
): boolean {
    return !!state.active &&
        state.active.releaseId === targetReleaseId &&
        state.active.routeRevision === targetRouteRevision;
}

export interface MigrationGatewayRuntime {
    publish(
        source: GatewayReleaseSource,
        operation: MigrationOperation,
    ): Promise<{
        state: GatewayState;
        targetReleaseId: string;
        targetRouteRevision: number;
    }>;
    readState(operation: MigrationOperation): Promise<GatewayState>;
    rollback(
        source: GatewayReleaseSource,
        operation: MigrationOperation,
    ): Promise<GatewayState>;
}

export interface MigrationRuntime {
    repository: MigrationRepository;
    findSite(siteId: string): Promise<SiteInstallation | null>;
    sourceChecksum(
        operation: MigrationOperation,
    ): Promise<string>;
    source(operation: MigrationOperation): GatewayReleaseSource;
    persistCandidate(operation: MigrationOperation): Promise<void>;
    finalize(
        operation: MigrationOperation,
        expectedUpdatedAt: number,
    ): Promise<boolean>;
    restore(
        operation: MigrationOperation,
        expectedUpdatedAt: number,
        previous: SiteInstallation,
    ): Promise<boolean>;
    settle(
        operation: MigrationOperation,
        status: 'active' | 'failed' | 'rolled-back',
    ): Promise<boolean>;
    gateway: MigrationGatewayRuntime;
}

export class MigrationService {
    constructor(private readonly runtime: MigrationRuntime) {}

    async stage(input: PrepareMigrationInput): Promise<MigrationOperation> {
        const existing = await this.runtime.repository.findByRequestKey(
            ownerWorkspace(input.site),
            input.site._id,
            input.requestKey,
        );
        if (existing) {
            if (
                existing.targetManifestChecksum !==
                input.targetRecord.manifestChecksum
            ) {
                throw new SiteMutationConflict(
                    'This request belongs to a different migration',
                );
            }
            return existing;
        }
        const operation = prepareMigrationOperation(input);
        try {
            await this.runtime.repository.save(operation);
        } catch (cause) {
            const concurrent =
                await this.runtime.repository.findByRequestKey(
                    ownerWorkspace(input.site),
                    input.site._id,
                    input.requestKey,
                );
            if (
                !concurrent ||
                concurrent.targetManifestChecksum !==
                    input.targetRecord.manifestChecksum
            ) {
                throw cause;
            }
            return concurrent;
        }
        return operation;
    }

    async adopt(
        operationId: string,
        expectedSourceChecksum: string,
        actorId: string,
    ): Promise<MigrationOperation> {
        let operation = await this.requireOperation(operationId);
        if (operation.status === 'active') return operation;
        if (operation.status === 'rolled-back') {
            throw new Error('Migration operation was already rolled back');
        }
        if (operation.sourceChecksum !== expectedSourceChecksum) {
            throw new SiteMutationConflict('Migration source changed');
        }
        return withSiteMutation(
            operation.cmsSiteId,
            async () => {
                const site = await this.runtime.findSite(
                    operation.cmsSiteId,
                );
                if (
                    !site ||
                    site.updatedAt !== operation.expectedUpdatedAt ||
                    ownerWorkspace(site) !== operation.cmsWorkspaceId
                ) {
                    throw new SiteMutationConflict(
                        'Site changed; refresh before upgrading',
                    );
                }
                const currentChecksum =
                    await this.runtime.sourceChecksum(operation);
                if (currentChecksum !== expectedSourceChecksum) {
                    throw new SiteMutationConflict(
                        'Migration source changed; review it again',
                    );
                }
                operation = {
                    ...operation,
                    status: 'publishing',
                    actorId,
                    errorCode: undefined,
                    updatedAt: Date.now(),
                };
                await this.runtime.repository.save(operation);
                try {
                    const result = await this.runtime.gateway.publish(
                        this.runtime.source(operation),
                        operation,
                    );
                    operation = {
                        ...operation,
                        targetReleaseId: result.targetReleaseId,
                        targetRouteRevision: result.targetRouteRevision,
                        updatedAt: Date.now(),
                    };
                    if (
                        canFinalizeMigration(
                            result.targetReleaseId,
                            result.targetRouteRevision,
                            result.state,
                        )
                    ) {
                        return await this.finalize(operation, site);
                    }
                    await this.runtime.repository.save(operation);
                    return operation;
                } catch (cause) {
                    if (isGatewayUnavailable(cause)) {
                        await this.runtime.repository.save(operation);
                        throw cause;
                    }
                    const failed: MigrationOperation = {
                        ...operation,
                        status: 'failed',
                        errorCode:
                            cause instanceof Error
                                ? cause.message.slice(0, 160)
                                : 'migration_failed',
                        updatedAt: Date.now(),
                    };
                    await this.runtime.repository.save(failed);
                    await this.runtime.settle(failed, 'failed');
                    throw cause;
                }
            },
            { mode: 'migration', operationId },
        );
    }

    async reconcile(operationId: string): Promise<MigrationOperation> {
        let operation = await this.requireOperation(operationId);
        if (operation.status !== 'publishing') return operation;
        if (
            !operation.targetReleaseId ||
            operation.targetRouteRevision === undefined
        ) {
            return this.adopt(
                operation.id,
                operation.sourceChecksum,
                operation.actorId || 'migration-recovery',
            );
        }
        return withSiteMutation(
            operation.cmsSiteId,
            async () => {
                const site = await this.runtime.findSite(
                    operation.cmsSiteId,
                );
                if (!site) return operation;
                const state =
                    await this.runtime.gateway.readState(operation);
                if (
                    canFinalizeMigration(
                        operation.targetReleaseId!,
                        operation.targetRouteRevision!,
                        state,
                    )
                ) {
                    return this.finalize(operation, site);
                }
                if (
                    state.active &&
                    state.active.releaseId ===
                        operation.previousReleaseId &&
                    state.active.routeRevision ===
                        operation.expectedUpdatedAt
                ) {
                    operation = {
                        ...operation,
                        status: 'failed',
                        errorCode: 'gateway_rolled_back',
                        updatedAt: Date.now(),
                    };
                    await this.runtime.repository.save(operation);
                    await this.runtime.restore(
                        operation,
                        site.updatedAt,
                        operation.previousSite,
                    );
                }
                return operation;
            },
            { mode: 'migration', operationId },
        );
    }

    async rollback(
        operationId: string,
        actorId: string,
    ): Promise<MigrationOperation> {
        let operation = await this.requireOperation(operationId);
        if (operation.status !== 'active') {
            throw new Error('Only an active migration can be rolled back');
        }
        return withSiteMutation(
            operation.cmsSiteId,
            async () => {
                let site = await this.runtime.findSite(
                    operation.cmsSiteId,
                );
                if (!site) throw new Error('Site not found');
                if (
                    site.updatedAt !== operation.candidateSite.updatedAt &&
                    !operation.laterDraftSite
                ) {
                    operation = {
                        ...operation,
                        laterDraftSite: structuredClone(site),
                        updatedAt: Date.now(),
                    };
                    await this.runtime.repository.save(operation);
                }
                const state = await this.runtime.gateway.rollback(
                    this.runtime.source(operation),
                    operation,
                );
                if (
                    !state.active ||
                    state.active.releaseId !==
                        operation.previousReleaseId
                ) {
                    throw new Error(
                        'Gateway did not confirm the previous release',
                    );
                }
                site = (await this.runtime.findSite(
                    operation.cmsSiteId,
                ))!;
                if (
                    !(await this.runtime.restore(
                        operation,
                        site.updatedAt,
                        operation.previousSite,
                    ))
                ) {
                    throw new SiteMutationConflict(
                        'Site changed during rollback',
                    );
                }
                operation = {
                    ...operation,
                    status: 'rolled-back',
                    actorId,
                    updatedAt: Date.now(),
                };
                await this.runtime.repository.save(operation);
                return operation;
            },
            { mode: 'migration', operationId },
        );
    }

    private async finalize(
        operation: MigrationOperation,
        site: SiteInstallation,
    ): Promise<MigrationOperation> {
        await this.runtime.persistCandidate(operation);
        if (
            !(await this.runtime.finalize(operation, site.updatedAt))
        ) {
            throw new SiteMutationConflict(
                'Site changed before migration finalization',
            );
        }
        const active: MigrationOperation = {
            ...operation,
            status: 'active',
            updatedAt: Date.now(),
        };
        await this.runtime.repository.save(active);
        return active;
    }

    private async requireOperation(
        id: string,
    ): Promise<MigrationOperation> {
        const operation = await this.runtime.repository.find(id);
        if (!operation) throw new Error('Migration operation not found');
        return operation;
    }
}

let defaultService: MigrationService | null = null;

export function configureMigrationService(service: MigrationService): void {
    defaultService = service;
}

function requireDefault(): MigrationService {
    return ensureDefaultMigrationService();
}

export function adoptMigration(
    operationId: string,
    expectedSourceChecksum: string,
    actorId: string,
): Promise<MigrationOperation> {
    return requireDefault().adopt(
        operationId,
        expectedSourceChecksum,
        actorId,
    );
}

export function reconcileMigration(
    operationId: string,
): Promise<MigrationOperation> {
    return requireDefault().reconcile(operationId);
}

export function stageMigration(
    input: PrepareMigrationInput,
): Promise<MigrationOperation> {
    return requireDefault().stage(input);
}

export function rollbackMigration(
    operationId: string,
    actorId: string,
): Promise<MigrationOperation> {
    return requireDefault().rollback(operationId, actorId);
}

export const inMemoryMigrationRepository =
    createMemoryMigrationRepository;

export type { MigrationDocument };

function defaultRuntime(): MigrationRuntime {
    const repository = Repo.migrationOperation;
    const source = (operation: MigrationOperation) =>
        createMigrationReleaseSource(operation, {
            base: releaseSource(),
            language: Config.storefrontLanguage,
            mediaOrigin: Config.storefrontMediaOrigin,
            currency: Config.storefrontCurrency,
            update: async (next) => {
                await repository.save(next);
            },
        });
    return {
        repository,
        findSite: (siteId) =>
            Repo.siteInstallation.methods.findFresh(siteId),
        async sourceChecksum(operation) {
            const site = await Repo.siteInstallation.methods.findFresh(
                operation.cmsSiteId,
            );
            if (!site) throw new Error('Site not found');
            const content = await releaseSource().loadContent(site);
            return migrationSourceChecksum(
                site,
                content.templates,
                content.entries,
                content.media.filter((item) =>
                    mediaAuthorizedForSite(item, site),
                ),
            );
        },
        source,
        async persistCandidate(operation) {
            await Repo.entryGroup.methods.ensure(
                operation.candidateSite.contentGroupId ||
                    `${operation.cmsSiteId}-migration-${operation.id}`,
                operation.cmsSiteId,
                'Migration candidate',
            );
            for (const template of operation.candidateTemplates || []) {
                const existing = await Repo.template.findById(template._id);
                if (!existing) await Repo.template.add(template, true);
                else if (
                    JSON.stringify(existing) !== JSON.stringify(template)
                ) {
                    throw new Error(
                        'Migration candidate template identity conflict',
                    );
                }
            }
            for (const entry of operation.candidateEntries || []) {
                const existing = await Repo.entry.findById(entry._id);
                if (!existing) await Repo.entry.add(entry, true);
                else if (JSON.stringify(existing) !== JSON.stringify(entry)) {
                    throw new Error(
                        'Migration candidate Entry identity conflict',
                    );
                }
            }
        },
        finalize: (operation, expectedUpdatedAt) =>
            Repo.siteInstallation.methods.finalizeMigration(
                operation.cmsSiteId,
                operation.id,
                expectedUpdatedAt,
                operation.candidateSite,
            ),
        restore: (operation, expectedUpdatedAt, previous) =>
            Repo.siteInstallation.methods.restoreMigrationSite(
                operation.cmsSiteId,
                operation.id,
                expectedUpdatedAt,
                previous,
            ),
        settle: (operation, status) =>
            Repo.siteInstallation.methods.settleMigrationState(
                operation.cmsSiteId,
                operation.id,
                status,
            ),
        gateway: {
            async publish(migrationSource, operation) {
                const config = await resolveGatewayPublishConfig();
                await publishGatewayRelease(
                    migrationSource,
                    operation.actorId || 'migration',
                    operation.previousReleaseId,
                    operation.requestKey,
                    config,
                );
                const candidate =
                    await migrationSource.findSite();
                const intent = candidate?.gatewayPublishIntent
                    ? (JSON.parse(
                          candidate.gatewayPublishIntent,
                      ) as { releaseId?: string; revision?: number })
                    : null;
                if (!intent?.releaseId) {
                    throw new Error(
                        'Gateway publication did not persist a release identity',
                    );
                }
                const state = await readGatewayState(candidate!, config);
                return {
                    state,
                    targetReleaseId: intent.releaseId,
                    targetRouteRevision:
                        intent.revision ??
                        (state.revision + 1),
                };
            },
            async readState(operation) {
                const latest = await repository.find(operation.id);
                if (!latest) throw new Error('Migration operation missing');
                const config = await resolveGatewayPublishConfig();
                return readGatewayState(latest.candidateSite, config);
            },
            async rollback(migrationSource, operation) {
                const config = await resolveGatewayPublishConfig();
                const latestSite = await Repo.siteInstallation.methods.findFresh(
                    operation.cmsSiteId,
                );
                const rollbackSource = {
                    ...migrationSource,
                    findSite: async () => latestSite,
                };
                await publishGatewayRelease(
                    rollbackSource,
                    operation.actorId || 'migration',
                    operation.targetReleaseId || '',
                    uuidFrom(`${operation.requestKey}:rollback`),
                    config,
                    fetch,
                    undefined,
                    { restoreReleaseId: operation.previousReleaseId },
                );
                return readGatewayState(latestSite!, config);
            },
        },
    };
}

export function ensureDefaultMigrationService(): MigrationService {
    if (!defaultService) {
        defaultService = new MigrationService(defaultRuntime());
    }
    return defaultService;
}
