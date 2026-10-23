import { createHmac } from 'node:crypto';
import { siteContext } from '../../utils/site-context';
export default defineEventHandler((event) => {
    const host = siteContext(event);
    const nonce = getQuery(event).nonce;
    const config = useRuntimeConfig(event);
    setHeader(event, 'Cache-Control', 'no-store');
    if (!config.domainSecret || typeof nonce !== 'string' || !/^[a-f0-9]{48}$/.test(nonce)) throw createError({ statusCode: 404 });
    setHeader(event, 'Content-Type', 'text/plain');
    return createHmac('sha256', config.domainSecret).update(`cms-domain-v1:${host}:${nonce}`).digest('hex');
});
