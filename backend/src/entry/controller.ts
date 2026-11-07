import {
    createController,
    createControllerMethod,
    HttpStatus,
} from '@bcms/selfhosted-backend/_server';
import {
    RP,
    type RPApiKeyJwtBodyCheckResult,
    type RPApiKeyJwtCheckResult,
    type RPJwtCheckResult,
} from '@bcms/selfhosted-backend/security/route-protection/main';
import type {
    ControllerItemResponse,
    ControllerItemsResponse,
} from '@bcms/selfhosted-backend/util/controller';
import type {
    Entry,
    EntryLite,
    EntryParsed,
} from '@bcms/selfhosted-backend/entry/models/main';
import {
    controllerItemResponseDefinitionForRef,
    controllerItemsResponseDefinitionForRef,
    openApiGetModelRef,
} from '@bcms/selfhosted-backend/open-api/schema';
import { Repo } from '@bcms/selfhosted-backend/repo';
import { EntryFactory } from '@bcms/selfhosted-backend/entry/factory';
import { parseEntry } from '@bcms/selfhosted-backend/entry/parser';
import {
    type EntryCreateBody,
    EntryCreateBodySchema,
    type EntryUpdateBody,
    EntryUpdateBodySchema,
} from '@bcms/selfhosted-backend/entry/models/controller';
import { SocketManager } from '@bcms/selfhosted-backend/socket/manager';
import {
    validateStructuredFields,
    validateStructuredNodes,
} from '../studio/structured-content';
import { entryContentNodeToHtml } from '@bcms/selfhosted-backend/entry/content';
import { EventManager } from '@bcms/selfhosted-backend/event/manager';
import { assertSiteCapability } from '../authorization/site-access';
import { workspaceContext } from '../workspaces/context';
import { prepareEntryCreate } from '@bcms/selfhosted-backend/entry/create';
import { validateEntrySiteReferences } from './site-references';
import {
    SiteMutationConflict,
    withSiteMutation,
} from '../template-contract/site-mutation';

async function writableTemplateSite(templateId: string): Promise<string> {
    const selectedSiteId = workspaceContext()?.siteId;
    if (selectedSiteId) return selectedSiteId;
    const template = await Repo.template.findById(templateId);
    if (!template) {
        throw Object.assign(
            new Error(`Template with ID "${templateId}" does not exist`),
            { status: 404 },
        );
    }
    if (!template.siteId) {
        throw Object.assign(new Error('Selected site is required'), {
            status: 400,
        });
    }
    return template.siteId;
}

async function assertEntrySite(
    templateId: string,
    entry?: Entry,
    write = false,
) {
    const context = workspaceContext();
    assertSiteCapability(context, write ? 'content.write' : 'content.read');
    const template = await Repo.template.findById(templateId);
    if (
        !template ||
        (template.siteId && template.siteId !== context.siteId) ||
        (entry?.siteId && entry.siteId !== context.siteId)
    ) {
        throw Object.assign(
            new Error('Content not found or not permitted in selected site'),
            { status: 403 },
        );
    }
    if (write && context.siteId) {
        const site = await Repo.siteInstallation.methods.findFresh(
            context.siteId,
        );
        if (
            site?.models.length &&
            !site.models.some((model) => model.templateId === templateId)
        ) {
            throw new SiteMutationConflict(
                'Site content changed; refresh before saving',
            );
        }
    }
    return template;
}

export const EntryController = createController({
    name: 'Entry',
    path: '/api/v4/template',
    methods({ controllerName }) {
        return {
            getAllLite: createControllerMethod<
                RPJwtCheckResult,
                ControllerItemsResponse<EntryLite>
            >({
                path: '/entry/all/lite',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary:
                        'Get lite model of all entries for specified template',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemsResponseDefinitionForRef(
                                        'EntryLite',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createJwtCheck(),
                async handler() {
                    const context = workspaceContext();
                    assertSiteCapability(context, 'content.read');
                    const templates = (await Repo.template.findAll()).filter(
                        (template) =>
                            !template.siteId ||
                            template.siteId === context.siteId,
                    );
                    const entries = (await Repo.entry.findAll()).filter(
                        (entry) =>
                            !entry.siteId || entry.siteId === context.siteId,
                    );
                    const entriesLite: EntryLite[] = [];
                    const groups = await Repo.group.findAll();
                    for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];
                        const template = templates.find(
                            (e) => e._id === entry.templateId,
                        );
                        if (template) {
                            entriesLite.push(
                                EntryFactory.toLite(entry, template, groups),
                            );
                        }
                    }
                    return {
                        items: entriesLite,
                        limit: entriesLite.length,
                        total: entriesLite.length,
                        offset: 0,
                    };
                },
            }),

            getAllLiteByTemplateId: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemsResponse<EntryLite>
            >({
                path: '/:templateId/entry/all/lite',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                        {
                            apiKey: [],
                        },
                    ],
                    summary:
                        'Get lite model of all entries for specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemsResponseDefinitionForRef(
                                        'EntryLite',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request, errorHandler }) {
                    const params = request.params as {
                        templateId: string;
                    };
                    const template = await Repo.template.findById(
                        params.templateId,
                    );
                    if (!template) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Template with ID "${params.templateId}" does not exist`,
                        );
                    }
                    await assertEntrySite(params.templateId);
                    const entries = (
                        await Repo.entry.methods.findAllByTemplateId(
                            params.templateId,
                        )
                    ).filter(
                        (entry) =>
                            !entry.siteId ||
                            entry.siteId === workspaceContext()?.siteId,
                    );
                    const groups = await Repo.group.findAll();
                    return {
                        items: entries.map((e) =>
                            EntryFactory.toLite(e, template, groups),
                        ),
                        limit: entries.length,
                        total: entries.length,
                        offset: 0,
                    };
                },
            }),

            getAllParsed: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemsResponse<EntryParsed>
            >({
                path: '/:templateId/entry/all/parsed',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Get all entries parsed for specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'array',
                                        items: {},
                                    },
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request }) {
                    const params = request.params as {
                        orgId: string;
                        instanceId: string;
                        templateId: string;
                    };
                    const allEntries = await Repo.entry.findAll();
                    const entries = allEntries.filter(
                        (e) => e.templateId === params.templateId,
                    );
                    const templates = await Repo.template.findAll();
                    const groups = await Repo.group.findAll();
                    const widgets = await Repo.widget.findAll();
                    const medias = await Repo.media.findAll();
                    const languages = await Repo.language.findAll();
                    const items: EntryParsed[] = [];
                    for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];
                        items.push(
                            parseEntry(
                                entry,
                                templates,
                                groups,
                                widgets,
                                medias,
                                allEntries,
                                languages,
                                5,
                                0,
                            ),
                        );
                    }
                    return {
                        items,
                        limit: items.length,
                        total: items.length,
                        offset: 0,
                    };
                },
            }),

            getAll: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemsResponse<Entry>
            >({
                path: '/:templateId/entry/all',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Get all entries for specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemsResponseDefinitionForRef(
                                        'Entry',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request }) {
                    const params = request.params as {
                        templateId: string;
                    };
                    await assertEntrySite(params.templateId);
                    const entries = (
                        await Repo.entry.methods.findAllByTemplateId(
                            params.templateId,
                        )
                    ).filter(
                        (entry) =>
                            !entry.siteId ||
                            entry.siteId === workspaceContext()?.siteId,
                    );
                    return {
                        items: entries,
                        limit: entries.length,
                        total: entries.length,
                        offset: 0,
                    };
                },
            }),

            getByIdLite: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemResponse<EntryLite>
            >({
                path: '/:templateId/entry/:entryId/lite',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary:
                        'Get lite model of an entries from specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'path',
                            name: 'entryId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemResponseDefinitionForRef(
                                        'EntryLite',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request, errorHandler }) {
                    const params = request.params as {
                        orgId: string;
                        instanceId: string;
                        templateId: string;
                        entryId: string;
                    };
                    const template = await Repo.template.findById(
                        params.templateId,
                    );
                    if (!template) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Template with ID "${params.templateId}" does not exist`,
                        );
                    }
                    const entry = await Repo.entry.findById(params.entryId);
                    if (!entry || entry.templateId !== params.templateId) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Entry with ID "${params.entryId}" does not exist`,
                        );
                    }
                    await assertEntrySite(params.templateId, entry);
                    const groups = await Repo.group.findAll();
                    return {
                        item: EntryFactory.toLite(entry, template, groups),
                    };
                },
            }),

            getById: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemResponse<Entry>
            >({
                path: '/:templateId/entry/:entryId',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Get an entry from specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'path',
                            name: 'entryId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemResponseDefinitionForRef(
                                        'Entry',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request, errorHandler }) {
                    const params = request.params as {
                        templateId: string;
                        entryId: string;
                    };
                    const entry = await Repo.entry.findById(params.entryId);
                    if (!entry || entry.templateId !== params.templateId) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Entry with ID "${params.entryId}" does not exist`,
                        );
                    }
                    await assertEntrySite(params.templateId, entry);
                    return { item: entry };
                },
            }),

            getByIdParsed: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemResponse<EntryParsed>
            >({
                path: '/:templateId/entry/:entryId/parse',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Get an entry parsed from specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'path',
                            name: 'entryId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {},
                                    },
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request, errorHandler }) {
                    const params = request.params as {
                        templateId: string;
                        entryId: string;
                    };
                    const entry = await Repo.entry.findById(params.entryId);
                    if (!entry || entry.templateId !== params.templateId) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Entry with ID "${params.entryId}" does not exist`,
                        );
                    }
                    const allEntries = await Repo.entry.findAll();
                    const templates = await Repo.template.findAll();
                    const groups = await Repo.group.findAll();
                    const widgets = await Repo.widget.findAll();
                    const medias = await Repo.media.findAll();
                    const languages = await Repo.language.findAll();
                    return {
                        item: parseEntry(
                            entry,
                            templates,
                            groups,
                            widgets,
                            medias,
                            allEntries,
                            languages,
                            5,
                            0,
                        ),
                    };
                },
            }),

            create: createControllerMethod<
                RPApiKeyJwtBodyCheckResult<EntryCreateBody>,
                ControllerItemResponse<Entry>
            >({
                path: '/:templateId/entry/create',
                type: 'post',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Create new entry for specified template',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: openApiGetModelRef('EntryCreateBody'),
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemResponseDefinitionForRef(
                                        'Entry',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtBodyCheck(
                    EntryCreateBodySchema,
                ),
                async handler({ request, token, errorHandler, body, apiKey }) {
                    const params = request.params as {
                        templateId: string;
                    };
                    const siteId = await writableTemplateSite(
                        params.templateId,
                    );
                    return withSiteMutation(siteId, async () => {
                        const templates = await Repo.template.findAll();
                        const template = templates.find(
                            (e) => e._id === params.templateId,
                        );
                        if (!template) {
                            throw errorHandler(
                                HttpStatus.NotFound,
                                `Template with ID "${params.templateId}" does not exist`,
                            );
                        }
                        await assertEntrySite(
                            params.templateId,
                            undefined,
                            true,
                        );
                        let prepared: EntryCreateBody;
                        try {
                            const [
                                languages,
                                statuses,
                                widgets,
                                groups,
                                medias,
                            ] = await Promise.all([
                                Repo.language.findAll(),
                                Repo.entryStatus.findAll(),
                                Repo.widget.findAll(),
                                Repo.group.findAll(),
                                Repo.media.findAll(),
                            ]);
                            prepared = prepareEntryCreate(
                                body,
                                template.props,
                                languages.map((lng) => lng.code),
                                statuses.map((status) => status._id),
                                widgets,
                                groups,
                                templates,
                                medias,
                            );
                        } catch (cause) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                cause instanceof Error
                                    ? cause.message
                                    : 'Invalid entry content',
                            );
                        }
                        let entry = EntryFactory.create({
                            templateId: template._id,
                            userId: token
                                ? token.payload.userId
                                : apiKey
                                  ? apiKey.userId
                                  : '__unknown',
                            ...prepared,
                            groupId: body.groupId,
                        });
                        if (template.siteId) entry.siteId = template.siteId;
                        await validateEntrySiteReferences(
                            entry,
                            template,
                            Repo,
                        );
                        entry = await Repo.entry.add(entry);
                        SocketManager.channelEmit(
                            ['global'],
                            'entry',
                            {
                                type: 'update',
                                templateId: params.templateId,
                                entryId: entry._id,
                            },
                            token ? [token.payload.userId] : undefined,
                        );
                        EventManager.trigger('add', 'entry', entry).catch(
                            (err) => console.error(err),
                        );
                        return { item: entry };
                    });
                },
            }),

            update: createControllerMethod<
                RPApiKeyJwtBodyCheckResult<EntryUpdateBody>,
                ControllerItemResponse<Entry>
            >({
                path: '/:templateId/entry/update',
                type: 'put',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Update exiting entry',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: openApiGetModelRef('EntryUpdateBody'),
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemResponseDefinitionForRef(
                                        'Entry',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtBodyCheck(
                    EntryUpdateBodySchema,
                ),
                async handler({ request, body, token, errorHandler }) {
                    const params = request.params as {
                        templateId: string;
                    };
                    const siteId = await writableTemplateSite(
                        params.templateId,
                    );
                    return withSiteMutation(siteId, async () => {
                        const templates = await Repo.template.findAll();
                        const template = templates.find(
                            (e) => e._id === params.templateId,
                        );
                        if (!template) {
                            throw errorHandler(
                                HttpStatus.NotFound,
                                `Template with ID "${params.templateId}" does not exist`,
                            );
                        }
                        let entry = await Repo.entry.findById(body._id);
                        if (!entry || entry.templateId !== params.templateId) {
                            throw errorHandler(
                                HttpStatus.NotFound,
                                `Entry with ID "${body._id}" does not exist`,
                            );
                        }
                        await assertEntrySite(params.templateId, entry, true);
                        if (
                            body.expectedUpdatedAt !== undefined &&
                            (!Number.isSafeInteger(body.expectedUpdatedAt) ||
                                body.expectedUpdatedAt < 0)
                        )
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                'Invalid content version',
                            );
                        if (body.status) {
                            const status = await Repo.entryStatus.findById(
                                body.status,
                            );
                            if (!status) {
                                throw errorHandler(
                                    HttpStatus.BadRequest,
                                    `Status with ID "${body.status}" does not exist`,
                                );
                            }
                        }
                        const lngs = await Repo.language.findAll();
                        const widgets = await Repo.widget.findAll();
                        const groups = await Repo.group.findAll();
                        const medias = await Repo.media.findAll();
                        const lng = lngs.find((e) => e.code === body.lng);
                        if (!lng) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                `Provided language is not available`,
                            );
                        }
                        if (body.status) {
                            let statusFound = false;
                            for (let i = 0; i < entry.statuses.length; i++) {
                                if (entry.statuses[i].lng === lng.code) {
                                    statusFound = true;
                                    entry.statuses[i].id = body.status;
                                }
                            }
                            if (!statusFound) {
                                entry.statuses.push({
                                    lng: lng.code,
                                    id: body.status,
                                });
                            }
                        }
                        try {
                            const resources = {
                                widgets,
                                groups,
                                templates,
                                medias,
                            };
                            validateStructuredFields(
                                template,
                                body.meta.props,
                                resources,
                            );
                            validateStructuredNodes(
                                body.content.nodes,
                                resources,
                                'body.content.nodes',
                            );
                        } catch (cause) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                cause instanceof Error
                                    ? cause.message
                                    : 'Invalid structured content',
                            );
                        }
                        let metaFound = false;
                        for (let i = 0; i < entry.meta.length; i++) {
                            if (entry.meta[i].lng === lng.code) {
                                metaFound = true;
                                entry.meta[i] = {
                                    lng: lng.code,
                                    props: body.meta.props,
                                };
                                break;
                            }
                        }
                        if (!metaFound) {
                            entry.meta.push({
                                lng: lng.code,
                                props: body.meta.props,
                            });
                        }
                        let contentFound = false;
                        for (let i = 0; i < entry.content.length; i++) {
                            if (entry.content[i].lng === lng.code) {
                                contentFound = true;
                                entry.content[i] = {
                                    lng: lng.code,
                                    nodes: body.content.nodes,
                                    plainText: body.content.nodes
                                        .map((node) =>
                                            entryContentNodeToHtml(node),
                                        )
                                        .join('\n'),
                                };
                                break;
                            }
                        }
                        if (!contentFound) {
                            entry.content.push({
                                lng: lng.code,
                                nodes: body.content.nodes,
                                plainText: body.content.nodes
                                    .map((node) => entryContentNodeToHtml(node))
                                    .join('\n'),
                            });
                        }
                        if (body.groupId !== undefined)
                            entry.groupId = body.groupId;
                        await validateEntrySiteReferences(
                            entry,
                            template,
                            Repo,
                            lng.code,
                        );
                        const entrySiteId =
                            entry.siteId ||
                            template.siteId ||
                            workspaceContext()?.siteId;
                        if (!entrySiteId)
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                'Selected site is required',
                            );
                        entry = await Repo.entry.update(
                            entry!,
                            false,
                            body.expectedUpdatedAt,
                        );
                        SocketManager.channelEmit(
                            ['global'],
                            'entry',
                            {
                                type: 'update',
                                templateId: params.templateId,
                                entryId: entry._id,
                            },
                            token ? [token.payload.userId] : undefined,
                        );
                        EventManager.trigger('update', 'entry', entry).catch(
                            (err) => console.error(err),
                        );
                        return { item: entry };
                    });
                },
            }),

            deleteById: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemResponse<Entry>
            >({
                path: '/:templateId/entry/:entryId',
                type: 'delete',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Delete entry by its ID',
                    parameters: [
                        {
                            in: 'path',
                            name: 'templateId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'path',
                            name: 'entryId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemResponseDefinitionForRef(
                                        'Entry',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createJwtCheck(),
                async handler({ request, errorHandler, token }) {
                    const params = request.params as {
                        templateId: string;
                        entryId: string;
                    };
                    const entry = await Repo.entry.findById(params.entryId);
                    if (!entry || entry.templateId !== params.templateId) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Entry with ID "${params.entryId}" does not exist`,
                        );
                    }
                    const siteId = entry.siteId || workspaceContext()?.siteId;
                    if (!siteId)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Selected site is required',
                        );
                    await withSiteMutation(siteId, () =>
                        Repo.entry.deleteById(entry._id),
                    );
                    SocketManager.channelEmit(
                        ['global'],
                        'entry',
                        {
                            type: 'delete',
                            templateId: params.templateId,
                            entryId: entry._id,
                        },
                        token ? [token.payload.userId] : undefined,
                    );
                    EventManager.trigger('delete', 'entry', entry).catch(
                        (err) => console.error(err),
                    );
                    return { item: entry };
                },
            }),
        };
    },
});
