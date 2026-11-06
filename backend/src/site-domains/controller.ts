import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { RP } from '../security/route-protection/main';
import { GatewayRevisionConflict, isGatewayUnavailable } from '../presets/gateway-client';
import { Config } from '../config';
import { domainService } from './source';
import { checkDomain } from './verification';
import { readGatewayDomainState, readDynamicDomainList, gatewayDomainMutation } from './gateway';

async function dynamicMutation(id: string, operation: 'add' | 'check' | 'primary' | 'state' | 'remove', body?: unknown) {
    const site = await domainService().site();
    const result = await gatewayDomainMutation(site._id, id, operation, body);
    if (result === null && site.provisioning) throw new Error('Site preparation is not complete');
    return result;
}

export const SiteDomainController = createController({
    name: 'SiteDomains', path: '/api/v4',
    methods() {
        const action = (type: 'get' | 'post' | 'delete', path: string,
            execute: (id: string, actor: string, body: unknown) => Promise<unknown>) => createControllerMethod({
                type, path: `/site-domains${path}`, preRequestHandler: async (args) => { args.reply.header('Cache-Control', 'no-store'); return RP.createSiteCapabilityCheck('domains.manage')(args); },
                async handler({ request, reply, token, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    try { return await execute((request.params as { id?: string }).id || '', token.payload.userId, request.body); }
                    catch (error) {
                        const message = (error as Error).message;
                        throw errorHandler(isGatewayUnavailable(error) ? HttpStatus.ServiceUnavailable : message.includes('not found') || message.includes('(404)') ? HttpStatus.NotFound : error instanceof GatewayRevisionConflict || /changed|already bound/.test(message) ? HttpStatus.Conflict : /rate limited/.test(message) ? HttpStatus.TooManyRequests : HttpStatus.BadRequest, message);
                    }
                },
            });
        return {
            list: action('get', '', async () => {
                const service = domainService();
                const site = await service.site();
                const dynamic = await readDynamicDomainList(site._id);
                if (dynamic) return dynamic;
                if (site.provisioning) throw new Error('Site preparation is not complete');
                const listed = await service.list();
                let gateway: Awaited<ReturnType<typeof readGatewayDomainState>> | { status: 'unavailable' };
                try { gateway = await readGatewayDomainState((await service.site())._id); }
                catch { gateway = { status: 'unavailable' }; }
                return { ...listed, gateway };
            }),
            add: action('post', '', async (_id, actor, body) => {
                const parsed = z.object({ hostname: z.string().min(1).max(254) }).strict().parse(body);
                return await dynamicMutation('', 'add', parsed) ?? domainService().add(parsed.hostname, actor);
            }),
            check: action('post', '/:id/check', async (id, actor) => {
                const dynamic = await dynamicMutation(id, 'check');
                if (dynamic !== null) return dynamic;
                const record = await domainService().check(id, actor, (domain) => checkDomain(domain, { secret: Config.storefrontDomainSecret }));
                const { verificationTokenHash, ...publicRecord } = record; return publicRecord;
            }),
            primary: action('post', '/:id/primary', async (id, actor) => { const dynamic = await dynamicMutation(id, 'primary'); if (dynamic !== null) return dynamic; await domainService().primary(id, actor); return { ok: true }; }),
            state: action('post', '/:id/state', async (id, actor, body) => {
                const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(body);
                const dynamic = await dynamicMutation(id, 'state', { enabled }); if (dynamic !== null) return dynamic;
                await domainService().state(id, enabled, actor); return { ok: true };
            }),
            remove: action('delete', '/:id', async (id, actor) => { const dynamic = await dynamicMutation(id, 'remove'); if (dynamic !== null) return dynamic; await domainService().remove(id, actor); return { ok: true }; }),
        };
    },
});
