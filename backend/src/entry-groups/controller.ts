import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import { assertContentWrite } from '../workspaces/scoped-collection';
import { defaultEntryGroupId } from './repo';

const nameBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const EntryGroupController = createController({
    name: 'EntryGroups', path: '/api/v4/entry-groups',
    methods() { return {
        list: createControllerMethod({ path: '', type: 'get', preRequestHandler: RP.createApiKeyJwtCheck(),
            async handler() { return { items: await Repo.entryGroup.findAll(), defaultGroupId: defaultEntryGroupId() }; } }),
        create: createControllerMethod({ path: '', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(),
            async handler({ request, errorHandler }) {
                const body = nameBody.safeParse(request.body);
                if (!body.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid entry group name');
                return Repo.entryGroup.methods.ensure(randomUUID(), undefined, body.data.name);
            } }),
        rename: createControllerMethod({ path: '/:groupId', type: 'put', preRequestHandler: RP.createWorkspaceAdminCheck(),
            async handler({ request, errorHandler }) {
                const body = nameBody.safeParse(request.body);
                if (!body.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid entry group name');
                const group = await Repo.entryGroup.findById((request.params as { groupId: string }).groupId);
                if (!group) throw errorHandler(HttpStatus.NotFound, 'Entry group not found');
                await Repo.entryGroup.methods.rename(group._id, body.data.name); return Repo.entryGroup.findById(group._id);
            } }),
        remove: createControllerMethod({ path: '/:groupId', type: 'delete', preRequestHandler: RP.createWorkspaceAdminCheck(),
            async handler({ request }) {
                const id = (request.params as { groupId: string }).groupId;
                return { removed: await Repo.entryGroup.methods.removeEmpty(id, () => Repo.entry.hasOwnedForLifecycle({ groupId: id })) };
            } }),
        move: createControllerMethod({ path: '/:groupId/entries/:entryId', type: 'put', preRequestHandler: RP.createApiKeyJwtCheck(),
            async handler({ request, errorHandler }) {
                assertContentWrite();
                const { groupId, entryId } = request.params as { groupId: string; entryId: string };
                if (groupId === defaultEntryGroupId()) await Repo.entryGroup.methods.ensure();
                if (!await Repo.entryGroup.findById(groupId)) throw errorHandler(HttpStatus.NotFound, 'Entry group not found');
                const entry = await Repo.entry.findById(entryId);
                if (!entry) throw errorHandler(HttpStatus.NotFound, 'Entry not found');
                return { item: await Repo.entry.update({ ...entry, groupId }) };
            } }),
    }; },
});
