import { resolveGatewayPublishConfig } from '../site-provisioning/config';
import { gatewayManagementRequest, validateConfig, type GatewayPublishConfig } from '../presets/gateway-client';
import type { Lead, LeadStatus } from './model';

type GatewayLead = {
    id: string;
    siteId: string;
    source: string;
    schemaVersion: number;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    message?: string | null;
    fields?: Record<string, string>;
    status: LeadStatus;
    assignedTo?: string | null;
    notes?: string | null;
    notificationStatus: Lead['notificationStatus'];
    notificationError?: string | null;
    createdAt: string;
    updatedAt: string;
};

export interface GatewayLeadFilter { status?: LeadStatus; search?: string; limit?: number; skip?: number }

async function configFor(siteId: string): Promise<GatewayPublishConfig | null> {
    const config = await resolveGatewayPublishConfig();
    if (!config.gatewayBaseUrl || !config.serviceSecret || !config.siteId || config.cmsSiteId !== siteId) return null;
    validateConfig(config);
    return config;
}

function mapLead(value: GatewayLead, cmsSiteId: string): Lead {
    return {
        _id: value.id,
        createdAt: Date.parse(value.createdAt),
        updatedAt: Date.parse(value.updatedAt),
        siteId: cmsSiteId,
        source: value.source,
        schemaVersion: value.schemaVersion,
        ...(value.name ? { name: value.name } : {}),
        ...(value.email ? { email: value.email } : {}),
        ...(value.phone ? { phone: value.phone } : {}),
        ...(value.message ? { message: value.message } : {}),
        fields: value.fields || {},
        status: value.status,
        ...(value.assignedTo ? { assignedTo: value.assignedTo } : {}),
        ...(value.notes ? { notes: value.notes } : {}),
        notificationStatus: value.notificationStatus,
        ...(value.notificationError ? { notificationError: value.notificationError } : {}),
    };
}

export async function gatewayLeadsConfigured(siteId: string): Promise<boolean> { return !!await configFor(siteId); }

export async function listGatewayLeads(siteId: string, filter: GatewayLeadFilter = {}, fetcher: typeof fetch = fetch): Promise<Lead[] | null> {
    const config = await configFor(siteId); if (!config) return null;
    const { base } = validateConfig(config);
    const query = new URLSearchParams();
    if (filter.status) query.set('status', filter.status);
    if (filter.search) query.set('search', filter.search);
    if (filter.limit !== undefined) query.set('limit', String(filter.limit));
    if (filter.skip !== undefined) query.set('skip', String(filter.skip));
    const body = await gatewayManagementRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/leads?${query.toString()}`, config) as { items?: GatewayLead[] };
    if (!Array.isArray(body.items)) throw new Error('Gateway returned invalid leads');
    return body.items.map(item => mapLead(item, siteId));
}

export async function updateGatewayLead(siteId: string, id: string, patch: { status?: LeadStatus; assignedTo?: string; notes?: string }, fetcher: typeof fetch = fetch): Promise<Lead | null> {
    const config = await configFor(siteId); if (!config) return null;
    const { base } = validateConfig(config);
    const body = await gatewayManagementRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/leads?id=${encodeURIComponent(id)}`, config, { method: 'PATCH', body: JSON.stringify(patch) }) as { item?: GatewayLead };
    return body.item ? mapLead(body.item, siteId) : null;
}
