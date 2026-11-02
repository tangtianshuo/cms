// Run only against this harness's disposable database. DNS/TLS rows below are fixtures.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
    cmsRoot,
    gatewayRoot,
    runtimeDir,
    readEnv,
    saveEnv,
} from './runtime.mjs';
const e = await readEnv();
async function api(route, body, scope = {}) {
    const response = await fetch(`http://127.0.0.1:18080/api/v4/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...scope,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
        throw new Error(
            `${route}: ${response.status} ${await response.text()}`,
        );
    return response.json();
}
let token = '';
if ((await api('auth/should-signup')).yes) {
    const logs = execFileSync('docker', ['logs', 'cms-e2e-20261028-cms-1'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const serverToken = /Server token: ([a-f0-9]{128})/.exec(logs)?.[1];
    if (!serverToken) throw new Error('Fresh administrator token unavailable');
    await api('auth/signup-admin', {
        serverToken,
        email: e.E2E_EMAIL,
        password: e.E2E_PASSWORD,
        firstName: 'Docker',
        lastName: 'E2E',
    });
}
token = (
    await api('auth/login', { email: e.E2E_EMAIL, password: e.E2E_PASSWORD })
).accessToken;
const { MongoClient } = createRequire(
    path.join(cmsRoot, 'backend/package.json'),
)('mongodb');
const mongo = await MongoClient.connect(
    `mongodb://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:27029/cms_docker_e2e?authSource=admin`,
);
try {
    const site = await api('presets/import', {
        presetId: 'atelier',
        siteName: 'Docker Phase C Store',
        includeDemo: true,
    });
    await writeFile(
        path.join(runtimeDir, 'builtin-site.json'),
        JSON.stringify(site),
    );
    const now = Date.now(),
        id = 'docker-e2e-builtin-domain';
    await mongo
        .db()
        .collection('bcms_site_domains')
        .updateOne(
            { _id: id },
            {
                $set: {
                    workspaceId: 'default',
                    siteId: site._id,
                    hostname: 'builtin.localhost',
                    enabled: true,
                    ownershipStatus: 'verified',
                    connectionStatus: 'ready',
                    verificationTokenHash: 'test-only-no-public-dns',
                    verificationExpiresAt: now + 86400000,
                    verifiedAt: now,
                    lastCheckedAt: now,
                    lastSuccessAt: now,
                    dnsReady: true,
                    lastError: '',
                    createdAt: now,
                    updatedAt: now,
                },
            },
            { upsert: true },
        );
    await mongo
        .db()
        .collection('bcms_site_installations')
        .updateOne(
            { _id: site._id },
            { $set: { primaryDomainId: id, domainRevision: 1 } },
        );
    if (!e.E2E_CMS_WORKSPACE) {
        const workspace = await api('workspaces', {
                name: 'Docker Gateway E2E',
            }),
            scope = { 'x-bcms-workspace': workspace._id };
        const site = await api(
            'workspaces/current/sites',
            { name: 'Docker Gateway Store' },
            scope,
        );
        scope['x-bcms-site'] = site._id;
        const catalog = await api('presets/catalog');
        const requestedVersion = process.env.E2E_PUBLIC_TEMPLATE_VERSION;
        const records = catalog.items
            .filter((item) => item.id === 'aeroframe' && item.manifestChecksum)
            .sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));
        let record = records.find((item) => !requestedVersion || item.version === requestedVersion);
        let localRegistryFallback = false;
        let fallbackManifest;
        if (!record?.manifestChecksum) {
            let cachedSite;
            try { cachedSite = JSON.parse(await readFile(path.join(runtimeDir, 'gateway-site.json'), 'utf8')); }
            catch { cachedSite = null; }
            const cached = cachedSite?.publishedTemplateRecord ? JSON.parse(cachedSite.publishedTemplateRecord) : JSON.parse(await readFile(path.join(runtimeDir, 'public-template.json'), 'utf8'));
            if (cachedSite?.presetManifestSnapshot) fallbackManifest = JSON.parse(cachedSite.presetManifestSnapshot);
            if (!cached?.id || !cached?.version || !cached?.manifestChecksum || !cached?.sourceCommit || !cached?.imageDigest || !cached?.imageRepository) {
                throw new Error(`No verified public AeroFrame version available${requestedVersion ? ` for ${requestedVersion}` : ''}`);
            }
            record = {
                schemaVersion: 1,
                id: cached.id,
                version: cached.version,
                manifestChecksum: cached.manifestChecksum,
                imageRepository: cached.imageRepository,
                imageDigest: cached.imageDigest,
                sourceCommit: cached.sourceCommit,
                manifestPath: `templates/${cached.id}/${cached.version}/template.json`,
                status: 'available',
            };
            localRegistryFallback = true;
        }
        const installed = await api(
            'presets/import',
            {
                presetId: 'aeroframe',
                ...(localRegistryFallback ? {} : { presetVersion: record.version, manifestChecksum: record.manifestChecksum }),
                siteName: 'Docker Gateway Store',
                includeDemo: true,
            },
            scope,
        );
        if (localRegistryFallback) {
            const manifest = fallbackManifest;
            if (!manifest) throw new Error('Public manifest fallback cache is missing');
            await mongo.db().collection('bcms_site_installations').updateOne(
                { _id: site._id, workspaceId: workspace._id },
                { $set: {
                    presetVersion: record.version,
                    presetManifestSnapshot: JSON.stringify(manifest),
                    publishedTemplateRecord: JSON.stringify(record),
                    theme: manifest.presentation.theme,
                    updatedAt: Date.now(),
                } },
            );
        }
        await writeFile(
            path.join(runtimeDir, 'gateway-site.json'),
            JSON.stringify(installed),
        );
        await writeFile(
            path.join(runtimeDir, 'public-template.json'),
            JSON.stringify(record),
        );
        e.E2E_CMS_WORKSPACE = workspace._id;
        e.E2E_CMS_SITE = site._id;
        await saveEnv(e);
    }
} finally {
    await mongo.close();
}
const { Pool } = createRequire(
    path.join(gatewayRoot, 'packages/worker/package.json'),
)('pg');
const pool = new Pool({
    connectionString: `postgresql://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
});
try {
    await pool.query(
        'INSERT INTO "Workspace" (id,name,"updatedAt") VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
        [e.E2E_GATEWAY_WORKSPACE, 'Docker E2E'],
    );
    await pool.query(
        'INSERT INTO "Site" (id,"workspaceId","updatedAt") VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
        [e.E2E_GATEWAY_SITE, e.E2E_GATEWAY_WORKSPACE],
    );
    await pool.query(
        'INSERT INTO "Domain" (id,"siteId",hostname,status,"certificateStatus","updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,$4,NOW()) ON CONFLICT DO NOTHING',
        [e.E2E_GATEWAY_SITE, 'shop.localhost', 'verified', 'pending'],
    );
} finally {
    await pool.end();
}
console.log(
    'Disposable identities and domain fixtures ready. Recreate CMS/control to apply binding; no public DNS/ACME verification performed.',
);
