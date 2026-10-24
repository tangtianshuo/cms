import { timingSafeEqual } from 'node:crypto';
import { normalizeHostname } from './service';
export function trustedStorefrontHost(headers: Record<string, string | string[] | undefined>, config: { secret: string; localHost: string; production: boolean }): string | null {
    const host = headers['x-storefront-host'];
    const key = headers['x-storefront-key'];
    if (typeof host !== 'string') return null;
    if (!config.production && host === config.localHost && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return host;
    if (!config.secret || typeof key !== 'string' || Buffer.byteLength(key) !== Buffer.byteLength(config.secret) ||
        !timingSafeEqual(Buffer.from(key), Buffer.from(config.secret))) return null;
    try { return normalizeHostname(host); } catch { return null; }
}
