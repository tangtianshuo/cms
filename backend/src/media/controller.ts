import { withMediaAccess, capabilityMedia, retainedPublicMedia } from './access';
import { workspaceContext, verifiedWorkspace, canWriteContent, type WorkspaceContext } from '../workspaces/context';
import { revalidateWorkspace } from '../workspaces/revalidate';
import { withWorkspaceCreation } from '../workspaces/lifecycle';
import crypto from 'crypto';
import {
    createController,
    createControllerMethod,
    HttpStatus,
} from '@bcms/selfhosted-backend/_server';
import {
    RP,
    type RPApiKeyJwtCheckResult,
    type RPJwtBodyCheckResult,
    type RPJwtCheckResult,
} from '@bcms/selfhosted-backend/security/route-protection/main';
import type {
    ControllerItemResponse,
    ControllerItemsResponse,
} from '@bcms/selfhosted-backend/util/controller';
import {
    type Media,
    MediaType,
} from '@bcms/selfhosted-backend/media/models/main';
import {
    controllerItemResponseDefinitionForRef,
    controllerItemsResponseDefinitionForRef,
    openApiGetModelRef,
} from '@bcms/selfhosted-backend/open-api/schema';
import { Repo } from '@bcms/selfhosted-backend/repo';
import {
    type MediaCreateDirBody,
    MediaCreateDirBodySchema,
    type MediaDeleteBody,
    MediaDeleteBodySchema,
    type MediaGetBinBody,
    MediaGetBinBodySchema,
    type MediaRequestUploadTokenResult,
    type MediaUpdateBody,
    MediaUpdateBodySchema,
} from '@bcms/selfhosted-backend/media/models/controller';
import {
    ObjectUtility,
    ObjectUtilityError,
} from '@bcms/selfhosted-utils/object-utility';
import { MediaStorage } from '@bcms/selfhosted-backend/media/storage';
import { keyValueStore } from '@bcms/selfhosted-backend/key-value-store';
import { MediaFactory } from '@bcms/selfhosted-backend/media/factory';
import { mimetypeToMediaType } from '@bcms/selfhosted-backend/media/mimetype';
import { SocketManager } from '@bcms/selfhosted-backend/socket/manager';
import { EventManager } from '@bcms/selfhosted-backend/event/manager';

export const MediaController = createController({
    name: 'Media',
    path: '/api/v4/media',
    methods({ controllerName }) {
        return {
            getAll: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemsResponse<Media>
            >({
                path: '/all',
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
                    summary: 'Get all media files metadata',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemsResponseDefinitionForRef(
                                        'Media',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler() {
                    const items = await Repo.media.findAll();
                    return {
                        items: items.map(withMediaAccess),
                        limit: items.length,
                        total: items.length,
                        offset: 0,
                    };
                },
            }),

            getById: createControllerMethod<
                RPApiKeyJwtCheckResult,
                ControllerItemResponse<Media>
            >({
                path: '/:mediaId',
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
                    parameters: [
                        {
                            in: 'path',
                            name: 'mediaId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    summary: 'Get media file metadata by its ID',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: controllerItemResponseDefinitionForRef(
                                        'Media',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createApiKeyJwtCheck(),
                async handler({ request, errorHandler }) {
                    const params = request.params as {
                        mediaId: string;
                    };
                    const media = await Repo.media.findById(params.mediaId);
                    if (!media) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Media with ID "${params.mediaId}" does not exist`,
                        );
                    }
                    return {
                        item: withMediaAccess(media),
                    };
                },
            }),

            bin: createControllerMethod<RPApiKeyJwtCheckResult, void>({
                path: '/:mediaId/bin/:filename',
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
                    parameters: [
                        {
                            in: 'path',
                            name: 'mediaId',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'path',
                            name: 'filename',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'query',
                            name: 'data',
                            required: false,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    summary: 'Get binary data for specified media',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'file:*/*': {
                                    schema: {
                                        type: 'string',
                                        format: 'binary',
                                    },
                                },
                            },
                        },
                    },
                },
                preRequestHandler: async (data) => {
                    if (data.request.headers.authorization || (data.request.query as { apiKey?: string }).apiKey) return RP.createApiKeyJwtCheck()(data);
                    return {};
                },
                async handler({ errorHandler, reply, request }) {
                    const params = request.params as {
                        mediaId: string;
                        filename: string;
                    };
                    const query = request.query as {
                        data?: string;
                        cap?: string;
                    };
                    let data: MediaGetBinBody = {
                        thumbnail: false,
                    };
                    if (query.data) {
                        try {
                            data = JSON.parse(
                                Buffer.from(query.data, 'hex').toString(),
                            );
                        } catch (err) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                'Invalid data query format',
                            );
                        }
                    }
                    const dataCheck = ObjectUtility.compareWithSchema(
                        data,
                        MediaGetBinBodySchema,
                        'query.data',
                    );
                    if (dataCheck instanceof ObjectUtilityError) {
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            dataCheck.message,
                        );
                    }
                    const privateRequest = !!workspaceContext() || !!query.cap;
                    const media = workspaceContext() ? await Repo.media.findById(params.mediaId) : query.cap ? await capabilityMedia(params.mediaId, query.cap) : await retainedPublicMedia(params.mediaId);
                    if (!media) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Media with ID "${params.mediaId}" does not exist`,
                        );
                    }
                    if (media.type === MediaType.DIR) {
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Directories do not have binary information',
                        );
                    }
                    if (data.image) {
                        const res = await MediaStorage.imageProcessOrGet(
                            media,
                            data.image,
                        );
                        reply.header('Content-Type', res.mimetype);
                        reply.header('Cache-Control', privateRequest ? 'private, no-store' : 'public, max-age=300');
                        // reply.header('Content-Length', res.buffer.length);
                        // reply.header(
                        //     'Content-Disposition',
                        //     `${
                        //         data.view ? 'inline' : 'attachment'
                        //     }; filename="${encodeURIComponent(media.name)}"`,
                        // );
                        return reply.send(res.buffer);
                    } else {
                        const stream = await MediaStorage.readStream(media, {
                            thumbnail: data.thumbnail,
                        });
                        if (!stream) {
                            throw errorHandler(
                                HttpStatus.InternalServerError,
                                `Failed to find binary data for this media`,
                            );
                        }
                        reply.header('Content-Type', media.mimetype);
                        reply.header('Cache-Control', privateRequest ? 'private, no-store' : 'public, max-age=300');
                        // reply.header('Content-Length', media.size);
                        // reply.header(
                        //     'Content-Disposition',
                        //     `${
                        //         data.view ? 'inline' : 'attachment'
                        //     }; filename="${encodeURIComponent(media.name)}"`,
                        // );
                        // reply.header(
                        //     'Content-Disposition',
                        //     `${
                        //         data.view ? 'inline' : 'attachment'
                        //     }; filename="${media.name}"`,
                        // );
                        return reply.send(stream);
                    }
                },
            }),

            requestUploadToken: createControllerMethod<
                RPJwtCheckResult,
                MediaRequestUploadTokenResult
            >({
                path: '/request/upload-token',
                type: 'get',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Get media upload token',
                    description:
                        'This token is required to successfully upload binary file.',
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: openApiGetModelRef(
                                            'MediaRequestUploadTokenResult',
                                        ),
                                    },
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createJwtCheck(),
                async handler() {
                    if (!canWriteContent('Media', {}, 'post')) throw new Error('Media creation denied');
                    const uploadToken = crypto.randomBytes(32).toString('hex');
                    keyValueStore.set(`media_upload_token.${uploadToken}`, JSON.stringify({ context: workspaceContext(), expiresAt: Date.now() + 900000 }), { expIn: 900 });
                    return { token: uploadToken };
                },
            }),

            createDir: createControllerMethod<
                RPJwtBodyCheckResult<MediaCreateDirBody>,
                ControllerItemResponse<Media>
            >({
                path: '/create/dir',
                type: 'post',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Create media of type DIR',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: openApiGetModelRef(
                                        'MediaCreateDirBody',
                                    ),
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
                                        'Media',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createJwtBodyCheck(
                    MediaCreateDirBodySchema,
                ),
                async handler({ token, body, errorHandler }) {
                    if (body.parentId) {
                        if (
                            await Repo.media.methods.findByParentIdAndName(
                                body.parentId,
                                body.name,
                            )
                        ) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                `Media with name "${body.name}" already exist`,
                            );
                        }
                        if (!(await Repo.media.findById(body.parentId))) {
                            throw errorHandler(
                                HttpStatus.NotFound,
                                `Parent media with ID "${body.parentId}" does not exist`,
                            );
                        }
                    } else {
                        if (
                            await Repo.media.methods.findInRootByName(body.name)
                        ) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                `Media with name "${body.name}" already exist`,
                            );
                        }
                    }
                    const media = await Repo.media.add(
                        MediaFactory.create({
                            type: MediaType.DIR,
                            isInRoot: !body.parentId,
                            parentId: body.parentId || '',
                            name: body.name,
                            altText: '',
                            caption: '',
                            hasChildren: true,
                            height: -1,
                            width: -1,
                            mimetype: 'dir',
                            size: 4096,
                            userId: token.payload.userId,
                        }),
                    );
                    EventManager.trigger('add', 'media', media).catch((err) =>
                        console.error(err),
                    );
                    return {
                        item: withMediaAccess(media),
                    };
                },
            }),

            createFile: createControllerMethod<
                { uploadActorId: string },
                ControllerItemResponse<Media>
            >({
                path: '/create/file',
                type: 'post',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Upload media file',
                    parameters: [
                        {
                            in: 'query',
                            name: 'parentId',
                            required: false,
                            schema: {
                                type: 'string',
                            },
                        },
                        {
                            in: 'query',
                            name: 'token',
                            description: 'Media upload token',
                            required: true,
                            schema: {
                                type: 'string',
                            },
                        },
                    ],
                    requestBody: {
                        content: {
                            'multipart/form-data': {
                                schema: {
                                    type: 'object',
                                    required: ['file'],
                                    properties: {
                                        file: {
                                            type: 'string',
                                            format: 'binary',
                                        },
                                    },
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
                                        'Media',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: async ({ request, errorHandler }) => {
                    const token = (request.query as { token?: string }).token;
                    const saved = typeof token === 'string' ? keyValueStore.getDel(`media_upload_token.${token}`) : null;
                    if (!saved) throw errorHandler(HttpStatus.Unauthorized, 'Invalid upload token');
                    try {
                        const upload = JSON.parse(saved) as { context: WorkspaceContext; expiresAt: number };
                        if (upload.expiresAt <= Date.now()) throw new Error('Upload token expired');
                        const context = await revalidateWorkspace(upload.context);
                        if (context.role === 'viewer' || (context.mediaPermissions && !context.mediaPermissions.post)) throw new Error('Media creation denied');
                        return { [verifiedWorkspace]: context, uploadActorId: context.actorId };
                    } catch { throw errorHandler(HttpStatus.Forbidden, 'Upload access revoked'); }
                },
                async handler({ request, errorHandler, uploadActorId }) {
                    const query = request.query as {
                        parentId?: string;
                        token?: string;
                    };
                    const userId = uploadActorId;
                    const file = await request.file({
                        limits: {
                            // Limit file size to 100MB
                            fileSize: 104857600,
                        },
                    });
                    if (!file) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            'Missing upload file',
                        );
                    }
                    const fileBuffer = await file.toBuffer();
                    let media = MediaFactory.create({
                        width: -1,
                        height: -1,
                        size: fileBuffer.length,
                        userId,
                        caption: '',
                        altText: '',
                        mimetype: file.mimetype,
                        hasChildren: false,
                        name: file.filename,
                        parentId: query.parentId ? query.parentId : '',
                        isInRoot: !query.parentId,
                        type: mimetypeToMediaType(file.mimetype),
                    });
                    if (
                        await Repo.media.methods.findByParentIdAndName(
                            media.parentId,
                            media.name,
                        )
                    ) {
                        const nameParts = media.name.split('.');
                        const hash = crypto.randomBytes(8).toString('hex');
                        if (nameParts.length > 1) {
                            media.name =
                                nameParts[0] +
                                '-' +
                                hash +
                                '.' +
                                nameParts.slice(1, nameParts.length).join('.');
                        } else {
                            media.name = media.name + '-' + hash;
                        }
                    }
                    if (media.parentId && (await Repo.media.findById(media.parentId))?.type !== MediaType.DIR) throw errorHandler(HttpStatus.Forbidden, 'Media parent not found in workspace');
                    media = await withWorkspaceCreation({ kind: 'media-file', resourceId: media._id }, async () => {
                        await MediaStorage.save(media, fileBuffer);
                        return Repo.media.add(media);
                    });
                    SocketManager.channelEmit(
                        ['global'],
                        'media',
                        {
                            type: 'update',
                            mediaId: media._id,
                        },
                        [userId],
                    );
                    EventManager.trigger('add', 'media', media).catch((err) =>
                        console.error(err),
                    );
                    return {
                        item: withMediaAccess(media),
                    };
                },
            }),

            update: createControllerMethod<
                RPJwtBodyCheckResult<MediaUpdateBody>,
                ControllerItemResponse<Media>
            >({
                path: '/update',
                type: 'put',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Update existing media metadata',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: openApiGetModelRef('MediaUpdateBody'),
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
                                        'Media',
                                    ),
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createJwtBodyCheck(MediaUpdateBodySchema),
                async handler({ errorHandler, body, token }) {
                    let media = await Repo.media.findById(body._id);
                    if (!media) {
                        throw errorHandler(
                            HttpStatus.NotFound,
                            `Media with ID "${body._id}" does not exist`,
                        );
                    }
                    let shouldUpdate = false;
                    let checkNameChange = false;
                    if (body.name && body.name !== media.name) {
                        shouldUpdate = true;
                        checkNameChange = true;
                        media.name = body.name;
                    }
                    if (
                        typeof body.parentId === 'string' &&
                        body.parentId !== media.parentId
                    ) {
                        shouldUpdate = true;
                        checkNameChange = true;
                        media.parentId = body.parentId;
                        media.isInRoot = !media.parentId;
                    }
                    if (
                        typeof body.altText === 'string' &&
                        body.altText !== media.altText
                    ) {
                        shouldUpdate = true;
                        media.altText = body.altText;
                    }
                    if (
                        typeof body.caption === 'string' &&
                        body.caption !== media.caption
                    ) {
                        shouldUpdate = true;
                        media.caption = body.caption;
                    }
                    if (checkNameChange) {
                        if (
                            await Repo.media.methods.findByParentIdAndName(
                                media.parentId,
                                media.name,
                            )
                        ) {
                            throw errorHandler(
                                HttpStatus.BadRequest,
                                `Media with name "${media.name}" already exist`,
                            );
                        }
                    }
                    if (shouldUpdate) {
                        media = await Repo.media.update(media);
                        SocketManager.channelEmit(
                            ['global'],
                            'media',
                            {
                                type: 'update',
                                mediaId: media._id,
                            },
                            [token.payload.userId],
                        );
                        EventManager.trigger('update', 'media', media).catch(
                            (err) => console.error(err),
                        );
                    }
                    return {
                        item: withMediaAccess(media),
                    };
                },
            }),

            deleteByIds: createControllerMethod<
                RPJwtBodyCheckResult<MediaDeleteBody>,
                { ok: boolean }
            >({
                path: '/delete',
                type: 'delete',
                openApi: {
                    tags: [controllerName],
                    security: [
                        {
                            accessToken: [],
                        },
                    ],
                    summary: 'Delete 1 or more media files by there IDs',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: openApiGetModelRef('MediaDeleteBody'),
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'OK',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['ok'],
                                        properties: {
                                            ok: {
                                                type: 'boolean',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                preRequestHandler: RP.createJwtBodyCheck(MediaDeleteBodySchema),
                async handler({ body, errorHandler }) {
                    if (!canWriteContent('Media', {}, 'delete')) throw errorHandler(HttpStatus.Forbidden, 'Media deletion denied');
                    const allMedia = await Repo.media.findAll();
                    const mediaToDelete: {
                        [mediaId: string]: Media;
                    } = {};
                    for (let i = 0; i < body.mediaIds.length; i++) {
                        const media = allMedia.find(
                            (e) => e._id === body.mediaIds[i],
                        );
                        if (media) {
                            mediaToDelete[media._id] = media;
                            if (media.type === MediaType.DIR) {
                                let children = allMedia.filter(
                                    (e) => e.parentId === media._id,
                                );
                                while (children.length > 0) {
                                    const child = children.pop() as Media;
                                    mediaToDelete[child._id] = child;
                                    if (child.type === MediaType.DIR) {
                                        children = [
                                            ...children,
                                            ...allMedia.filter(
                                                (e) => e.parentId === child._id,
                                            ),
                                        ];
                                    }
                                }
                            }
                        }
                    }
                    const deletePaths: string[] = [];
                    const medias: Media[] = [];
                    for (const mediaId in mediaToDelete) {
                        medias.push(mediaToDelete[mediaId]);
                        if (
                            [
                                MediaType.GIF,
                                MediaType.IMG,
                                MediaType.VID,
                            ].includes(mediaToDelete[mediaId].type)
                        ) {
                            deletePaths.push(
                                MediaStorage.resolveCloudPath(
                                    mediaToDelete[mediaId],
                                    {
                                        thumbnail: true,
                                    },
                                ),
                            );
                        }
                        console.log({ mediaId, mediaToDelete });
                        deletePaths.push(
                            MediaStorage.resolveCloudPath(
                                mediaToDelete[mediaId],
                            ),
                        );
                    }
                    await Repo.media.methods.deleteManyById(
                        medias.map((e) => e._id),
                    );
                    SocketManager.channelEmit(['global'], 'media', {
                        type: 'delete',
                        mediaId: 'many',
                    });
                    await MediaStorage.removeMany(deletePaths);
                    for (let i = 0; i < medias.length; i++) {
                        EventManager.trigger(
                            'delete',
                            'media',
                            medias[i],
                        ).catch((err) => console.error(err));
                    }
                    return {
                        ok: true,
                    };
                },
            }),
        };
    },
});
