import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { RP } from '../security/route-protection/main';
import { Config } from '../config';
import { domainService } from './source';
import { checkDomain } from './verification';

export const SiteDomainController = createController({
    name: 'SiteDomains', path: '/api/v4',
    methods() {
        const action = (type: 'get' | 'post' | 'delete', path: string,
            execute: (id: string, actor: string, body: unknown) => Promise<unknown>) => createControllerMethod({
                type, path: `/site-domains${path}`, preRequestHandler: async (args) => { args.reply.header('Cache-Control', 'no-store'); return RP.createWorkspaceAdminCheck()(args); },
                async handler({ request, reply, token, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    try { return await execute((request.params as { id?: string }).id || '', token.payload.userId, request.body); }
                    catch (error) {
                        const message = (error as Error).message;
                        throw errorHandler(message.includes('not found') ? HttpStatus.NotFound : /changed|already bound/.test(message) ? HttpStatus.Conflict : /rate limited/.test(message) ? HttpStatus.TooManyRequests : HttpStatus.BadRequest, message);
                    }
                },
            });
        return {
            list: action('get', '', async () => domainService().list()),
            add: action('post', '', async (_id, actor, body) => {
                const parsed = z.object({ hostname: z.string().min(1).max(254) }).strict().parse(body);
                return domainService().add(parsed.hostname, actor);
            }),
            check: action('post', '/:id/check', async (id, actor) => {
                const record = await domainService().check(id, actor, (domain) => checkDomain(domain, { secret: Config.storefrontDomainSecret }));
                const { verificationTokenHash, ...publicRecord } = record; return publicRecord;
            }),
            primary: action('post', '/:id/primary', async (id, actor) => { await domainService().primary(id, actor); return { ok: true }; }),
            state: action('post', '/:id/state', async (id, actor, body) => {
                const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(body);
                await domainService().state(id, enabled, actor); return { ok: true };
            }),
            remove: action('delete', '/:id', async (id, actor) => { await domainService().remove(id, actor); return { ok: true }; }),
        };
    },
});
