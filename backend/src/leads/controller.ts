import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { RP } from '../security/route-protection/main';
import { Repo } from '../repo';
import { listGatewayLeads, updateGatewayLead } from './gateway';
import { GatewayRequestError } from '../presets/gateway-client';

const state = z.object({ status: z.enum(['new', 'contacted', 'qualified', 'closed', 'spam']).optional(), assignedTo: z.string().trim().max(120).optional(), notes: z.string().max(2000).optional() }).strict();

async function selectedSite(errorHandler: (status: number, message: string) => unknown) {
    const site = await Repo.siteInstallation.methods.findSelected();
    if (!site || site.status !== 'ready') throw errorHandler(HttpStatus.NotFound, 'No installed site');
    return site;
}

export const LeadsController = createController({
    name: 'Leads', path: '/api/v4/leads', methods() { return {
        list: createControllerMethod({ path: '', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'), async handler({ request, errorHandler }) {
            const site = await selectedSite(errorHandler);
            const query = request.query as { status?: string; search?: string; limit?: string; skip?: string };
            const parsed = z.object({ status: z.enum(['new', 'contacted', 'qualified', 'closed', 'spam']).optional(), search: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), skip: z.coerce.number().int().min(0).optional() }).safeParse(query || {});
            if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid lead query');
            const gatewayItems = await listGatewayLeads(site._id, parsed.data);
            return { items: gatewayItems || await Repo.lead.methods.list(site._id, parsed.data) };
        } }),
        update: createControllerMethod({ path: '/:id', type: 'post', preRequestHandler: RP.createSiteCapabilityCheck('operations.manage'), async handler({ request, errorHandler }) {
            const site = await selectedSite(errorHandler); const parsed = state.safeParse(request.body);
            if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid lead update');
            const id = (request.params as { id: string }).id;
            let item;
            try { item = await updateGatewayLead(site._id, id, parsed.data) || await Repo.lead.methods.updateState(id, site._id, parsed.data); }
            catch (cause) { if (cause instanceof GatewayRequestError && cause.status === 404) throw errorHandler(HttpStatus.NotFound, 'Lead not found'); throw cause; }
            if (!item) throw errorHandler(HttpStatus.NotFound, 'Lead not found');
            return { item };
        } }),
        export: createControllerMethod({ path: '/export', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'), async handler({ reply, errorHandler }) {
            const site = await selectedSite(errorHandler); const items = (await listGatewayLeads(site._id, { limit: 200 })) || await Repo.lead.methods.list(site._id, { limit: 200 });
            const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""').replaceAll(/\r?\n/g, ' ')}"`;
            const csv = ['createdAt,status,source,name,email,phone,message,notes', ...items.map(item => [new Date(item.createdAt).toISOString(), item.status, item.source, item.name, item.email, item.phone, item.message, item.notes].map(cell).join(','))].join('\n');
            reply.header('Content-Disposition', 'attachment; filename="leads.csv"').type('text/csv; charset=utf-8'); return reply.send(csv);
        } }),
    }; },
});
