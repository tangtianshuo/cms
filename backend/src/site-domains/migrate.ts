import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Config } from '../config';
import { Repo } from '../repo';
import { domainService } from './source';
import { migrateConfiguredDomain } from './migration';

async function main() {
    const hostname = process.env.STOREFRONT_MIGRATE_HOST;
    const expectedSiteId = process.env.STOREFRONT_MIGRATE_SITE_ID;
    const cleanup = process.argv.includes('--cleanup-expired');
    if (!cleanup && (!hostname || !expectedSiteId || process.env.STOREFRONT_MIGRATE_CONFIRM !== 'externally-provisioned')) throw new Error('Set STOREFRONT_MIGRATE_HOST, STOREFRONT_MIGRATE_SITE_ID and STOREFRONT_MIGRATE_CONFIRM=externally-provisioned');
    if (!Config.storefrontGatewaySecret || !Config.storefrontDomainSecret) throw new Error('Configure storefront gateway and domain secrets first');
    const fastify = Fastify();
    await fastify.register(fastifyMongo, { url: Config.dbUrl, forceClose: true });
    try {
        for (const repo of [Repo.siteInstallation, Repo.siteDomain, Repo.siteDomainAudit]) await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify, next: (error?: Error) => error ? reject(error) : resolve() } as never));
        if (cleanup) console.log(`Removed ${await Repo.siteDomain.methods.cleanupExpired()} expired pending bindings`);
        else {
            const service = domainService();
            const site = await service.site();
            if (site._id !== expectedSiteId) throw new Error('Configured site ID does not match the current site');
            const domain = await migrateConfiguredDomain(service, hostname!, 'operator-migration');
            console.log(`Bound ${domain.hostname} to site ${domain.siteId}; Release unchanged`);
        }
    } finally { await fastify.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
