import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { RP } from '../security/route-protection/main';
import { createShare, listShares, previewShare, revokeShare, copyShares, readSharedMedia } from './service';

const id = z.string().min(1).max(100);
const grantBody = z.object({ resourceType: z.enum(['Entry', 'Media', 'Widget', 'Group']), resourceId: id, targetWorkspaceId: id }).strict();
const copyBody = z.object({ resources: z.array(z.object({ shareId: id, targetId: id.optional(), templateId: id.optional(), groupId: id.optional(), fieldMap: z.record(z.string(), id).optional() }).strict()).min(1).max(100) }).strict();
export const ResourceShareController = createController({
    name: 'ResourceShares', path: '/api/v4/resource-shares',
    methods() { return {
        incoming: createControllerMethod({ path: '/incoming', type: 'get', preRequestHandler: RP.createApiKeyJwtCheck(), async handler() { return { items: await listShares('incoming') }; } }),
        outgoing: createControllerMethod({ path: '/outgoing', type: 'get', preRequestHandler: RP.createWorkspaceAdminCheck(), async handler() { return { items: await listShares('outgoing') }; } }),
        grant: createControllerMethod({ path: '', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(), async handler({ request, errorHandler }) {
            const parsed = grantBody.safeParse(request.body); if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid share grant');
            return { item: await createShare(parsed.data) };
        } }),
        preview: createControllerMethod({ path: '/:shareId', type: 'get', preRequestHandler: RP.createApiKeyJwtCheck(), async handler({ request }) { return previewShare((request.params as { shareId: string }).shareId); } }),
        media: createControllerMethod({ path: '/:shareId/media', type: 'get', preRequestHandler: RP.createApiKeyJwtCheck(), async handler({ request, reply }) {
            const { data, media } = await readSharedMedia((request.params as { shareId: string }).shareId);
            reply.header('Cache-Control', 'private, no-store').type(media.mimetype); return reply.send(data);
        } }),
        revoke: createControllerMethod({ path: '/:shareId', type: 'delete', preRequestHandler: RP.createWorkspaceAdminCheck(), async handler({ request }) { return revokeShare((request.params as { shareId: string }).shareId); } }),
        copy: createControllerMethod({ path: '/:shareId/copy', type: 'post', preRequestHandler: RP.createApiKeyJwtCheck(), async handler({ request, errorHandler }) {
            const parsed = copyBody.safeParse(request.body); if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid copy selections');
            return copyShares((request.params as { shareId: string }).shareId, parsed.data.resources);
        } }),
    }; },
});
