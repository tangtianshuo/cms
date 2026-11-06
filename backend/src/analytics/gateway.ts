import { resolveGatewayPublishConfig } from '../site-provisioning/config';
import { gatewayManagementRequest, validateConfig } from '../presets/gateway-client';
import type { AnalyticsSummary } from './model';

export async function listGatewayAnalytics(siteId: string, days: number, fetcher: typeof fetch = fetch): Promise<AnalyticsSummary | null> {
  const config = await resolveGatewayPublishConfig();
  if (!config.gatewayBaseUrl || !config.serviceSecret || config.cmsSiteId !== siteId) return null;
  const { base } = validateConfig(config);
  const value = await gatewayManagementRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/events?days=${days}`, config) as AnalyticsSummary;
  if (!value || !value.totals || !Array.isArray(value.pages)) throw new Error('Gateway returned invalid analytics');
  return value;
}
