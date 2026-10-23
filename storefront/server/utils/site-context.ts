import type { H3Event } from 'h3';
import { trustedGatewayHost } from './release.mjs';
export function siteContext(event: H3Event): string {
    const config = useRuntimeConfig(event);
    const host = trustedGatewayHost({ host: getHeader(event, 'host'),
        forwardedHost: getHeader(event, 'x-storefront-host'), key: getHeader(event, 'x-storefront-key'),
        secret: config.gatewaySecret, expectedHost: config.public.siteHost, production: config.domainProduction });
    if (!host) throw createError({ statusCode: 404, statusMessage: 'Site not found' });
    return host;
}
