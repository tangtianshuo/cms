import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { RP } from '../security/route-protection/main';
import { Repo } from '../repo';
import { listGatewayAnalytics } from './gateway';

export const AnalyticsController = createController({ name: 'Analytics', path: '/api/v4/analytics', methods() { return {
  summary: createControllerMethod({ path: '', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'), async handler({ request, errorHandler }) {
    const site = await Repo.siteInstallation.methods.findSelected(); if (!site || site.status !== 'ready') throw errorHandler(HttpStatus.NotFound, 'No installed site');
    const parsed = z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).safeParse(request.query || {}); if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid analytics query');
    const days = parsed.data.days || 7;
    const summary = await listGatewayAnalytics(site._id, days);
    return summary
      ? { status: 'ready' as const, ...summary }
      : { status: 'unconfigured' as const, days,
          message: 'Gateway analytics is not configured for this site' };
  } }),
}; } });
