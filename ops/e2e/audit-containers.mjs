// Audit/prune only stateless containers created for this disposable Gateway site.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runtimeDir, readEnv } from './runtime.mjs';
const e = await readEnv();
const routes = JSON.parse(
    await readFile(path.join(runtimeDir, 'gateway-routes.json'), 'utf8'),
);
const protectedIds = new Set(
    [...routes.routes, ...(routes.previous || [])]
        .map((item) => item.containerId)
        .filter(Boolean),
);
const ids = execFileSync(
    'docker',
    ['ps', '-aq', '--filter', `label=gateway.site-id=${e.E2E_GATEWAY_SITE}`],
    { encoding: 'utf8' },
)
    .trim()
    .split('\n')
    .filter(Boolean);
const records = [];
for (const id of ids) {
    const parsed = JSON.parse(
        execFileSync('docker', ['inspect', '--format', '{{json .}}', id], {
            encoding: 'utf8',
        }),
    );
    const info = Array.isArray(parsed) ? parsed[0] : parsed;
    const safe =
        info.Config?.Labels?.['gateway.site-id'] === e.E2E_GATEWAY_SITE &&
        info.Config?.User === '10001:10001' &&
        info.HostConfig?.ReadonlyRootfs === true &&
        info.HostConfig?.NetworkMode === 'gateway-sites' &&
        (!info.Mounts || info.Mounts.length === 0);
    records.push({
        id: info.Id,
        name: info.Name,
        running: info.State?.Running === true,
        protected: protectedIds.has(info.Id),
        safeToPrune: safe && !protectedIds.has(info.Id),
    });
}
const audit = {
    siteId: e.E2E_GATEWAY_SITE,
    total: records.length,
    unreferenced: records.filter((r) => r.safeToPrune).length,
    records,
};
await writeFile(
    path.join(runtimeDir, 'container-audit.json'),
    JSON.stringify(audit, null, 2),
);
console.log(
    JSON.stringify({
        total: audit.total,
        unreferenced: audit.unreferenced,
        protected: records.filter((r) => r.protected).length,
    }),
);
if (process.argv.includes('--prune')) {
    if (!protectedIds.size || !records.some((item) => item.protected))
        throw new Error('Cannot prune without a protected active route');
    for (const item of records.filter((r) => r.safeToPrune))
        execFileSync('docker', ['rm', '-f', item.id], { stdio: 'ignore' });
    console.log(
        `Removed ${audit.unreferenced} unreferenced, read-only test containers; protected routes retained.`,
    );
}
