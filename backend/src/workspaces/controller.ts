import { defaultEntryGroupId } from '../entry-groups/repo';
import { withWorkspaceCreation } from './lifecycle';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
    createController,
    createControllerMethod,
    HttpStatus,
} from '../_server';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import {
    DEFAULT_WORKSPACE,
    workspaceContext,
    workspaceId,
} from './context';
import type { SiteInstallation } from '../presets/site-model';
const nameBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const WorkspaceController = createController({
    name: 'Workspaces',
    path: '/api/v4',
    methods() {
        return {
            list: createControllerMethod({
                path: '/workspaces',
                type: 'get',
                preRequestHandler: RP.createJwtCheck(['USER']),
                async handler({ token }) {
                    return {
                        items: await Repo.workspace.methods.list(
                            token.payload.userId,
                            !!workspaceContext()?.instanceAdmin,
                        ),
                        selectedWorkspaceId: workspaceId(),
                        selectedSiteId: workspaceContext()?.siteId || '',
                    };
                },
            }),
            create: createControllerMethod({
                path: '/workspaces',
                type: 'post',
                preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ request, token, errorHandler }) {
                    const parsed = nameBody.safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid workspace name',
                        );
                    return Repo.workspace.add({
                        _id: randomUUID(),
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        name: parsed.data.name,
                        members: [
                            { userId: token.payload.userId, role: 'admin' },
                        ],
                    });
                },
            }),
            current: createControllerMethod({
                path: '/workspaces/current',
                type: 'get',
                preRequestHandler: RP.createJwtCheck(['USER']),
                async handler() {
                    const workspace = await Repo.workspace.methods.fresh(
                        workspaceId(),
                    );
                    return { workspace, context: workspaceContext() };
                },
            }),
            rename: createControllerMethod({
                path: '/workspaces/current',
                type: 'put',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const parsed = nameBody.safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid workspace name',
                        );
                    await Repo.workspace.methods.rename(
                        workspaceId(),
                        parsed.data.name,
                    );
                    return { ok: true };
                },
            }),
            remove: createControllerMethod({
                path: '/workspaces/current',
                type: 'delete',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ errorHandler }) {
                    if (workspaceId() === DEFAULT_WORKSPACE)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Default workspace cannot be deleted',
                        );
                    const workspace = await Repo.workspace.methods.fresh(
                        workspaceId(),
                    );
                    if (!workspace || workspace.pendingCreations?.length)
                        throw errorHandler(
                            HttpStatus.Conflict,
                            'Workspace has pending creation operations',
                        );
                    if (
                        (
                            await Repo.siteInstallation.methods.listWorkspace(
                                workspaceId(),
                            )
                        ).length
                    )
                        throw errorHandler(
                            HttpStatus.Conflict,
                            'Workspace contains sites',
                        );
                    const resources = await Promise.all(
                        [
                            Repo.template,
                            Repo.entry,
                            Repo.entryGroup,
                            Repo.media,
                            Repo.widget,
                            Repo.group,
                            Repo.language,
                            Repo.entryStatus,
                            Repo.templateOrganizer,
                            Repo.apiKey,
                        ].map((repo) => repo.hasOwnedForLifecycle(repo === Repo.entryGroup ? { _id: { $ne: defaultEntryGroupId() } } : {})),
                    );
                    if (resources.some(Boolean)) {
                        throw errorHandler(
                            HttpStatus.Conflict,
                            'Workspace contains resources',
                        );
                    }
                    await Repo.entryGroup.methods.removeEmpty(defaultEntryGroupId(), () => Repo.entry.hasOwnedForLifecycle({ groupId: defaultEntryGroupId() }), true);
                    if (
                        !(await Repo.workspace.methods.deleteIfIdle(
                            workspaceId(),
                            workspace.lifecycleRevision || 0,
                        ))
                    ) {
                        throw errorHandler(
                            HttpStatus.Conflict,
                            'Workspace changed during deletion; refresh',
                        );
                    }
                    return { ok: true };
                },
            }),
            member: createControllerMethod({
                path: '/workspaces/current/members/:userId',
                type: 'put',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const parsed = z
                        .object({ role: z.enum(['admin', 'editor', 'viewer']) })
                        .strict()
                        .safeParse(request.body);
                    const userId = (request.params as { userId: string })
                        .userId;
                    if (!parsed.success || !(await Repo.user.findById(userId)))
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid member',
                        );
                    if (
                        userId === workspaceContext()?.actorId &&
                        !workspaceContext()?.instanceAdmin
                    )
                        throw errorHandler(
                            HttpStatus.Forbidden,
                            'Cannot change your own administrator role',
                        );
                    await Repo.workspace.methods.member(
                        workspaceId(),
                        userId,
                        parsed.data.role,
                    );
                    return { ok: true };
                },
            }),
            removeMember: createControllerMethod({
                path: '/workspaces/current/members/:userId',
                type: 'delete',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const userId = (request.params as { userId: string })
                        .userId;
                    if (
                        userId === workspaceContext()?.actorId &&
                        !workspaceContext()?.instanceAdmin
                    )
                        throw errorHandler(
                            HttpStatus.Forbidden,
                            'Cannot remove your own administrator membership',
                        );
                    await Repo.workspace.methods.member(
                        workspaceId(),
                        userId,
                        null,
                    );
                    return { ok: true };
                },
            }),
            sites: createControllerMethod({
                path: '/workspaces/current/sites',
                type: 'get',
                preRequestHandler: RP.createJwtCheck(['USER']),
                async handler() {
                    return {
                        items: await Repo.siteInstallation.methods.listWorkspace(
                            workspaceId(),
                        ),
                        selectedSiteId: workspaceContext()?.siteId || '',
                    };
                },
            }),
            createSite: createControllerMethod({
                path: '/workspaces/current/sites',
                type: 'post',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const parsed = nameBody.safeParse(request.body);
                    if (!parsed.success)
                        throw errorHandler(
                            HttpStatus.BadRequest,
                            'Invalid site name',
                        );
                    const id = randomUUID();
                    const site: SiteInstallation = {
                        _id: id,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        workspaceId: workspaceId(),
                        slot: id,
                        templateNamespace: id,
                        contentGroupId: id,
                        name: parsed.data.name,
                        presetId: '',
                        presetVersion: '',
                        status: 'empty',
                        importError: '',
                        includeDemo: false,
                        demoSeeded: false,
                        models: [],
                        pages: [],
                        theme: {
                            background: '',
                            foreground: '',
                            accent: '',
                            muted: '',
                            font: '',
                        },
                    };
                    return withWorkspaceCreation(
                        { kind: 'site', resourceId: id },
                        () => Repo.siteInstallation.add(site),
                    );
                },
            }),
        };
    },
});
