import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { gatewayRoot, cmsRoot, readEnv } from './runtime.mjs';

const env = await readEnv();
const gatewayPackageRoot = process.env.E2E_GATEWAY_ROOT || (await access(`${gatewayRoot}/node_modules/pg`).then(() => gatewayRoot).catch(() => path.resolve(cmsRoot, '../../gateway-contract-runtime')));
const { Pool } = createRequire(`${gatewayPackageRoot}/package.json`)('pg');
const pool = new Pool({ connectionString: `postgresql://e2e:${env.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e` });
const workspaceId = randomUUID(); const siteA = randomUUID(); const siteB = randomUUID();
const control = 'http://127.0.0.1:18183';
async function call(path, init) { const response = await fetch(`${control}${path}`, init); const body = await response.json(); assert.ok(response.ok, `${path}: ${JSON.stringify(body)}`); return body; }
try {
  await pool.query('INSERT INTO "Workspace" ("id","name","updatedAt") VALUES ($1,$2,now())', [workspaceId, 'analytics isolation']);
  await pool.query('INSERT INTO "Site" ("id","workspaceId","updatedAt") VALUES ($1,$3,now()),($2,$3,now())', [siteA, siteB, workspaceId]);
  for (const [siteId, path] of [[siteA, '/a'], [siteA, '/a'], [siteB, '/b']]) await call(`/api/v1/sites/${siteId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: randomUUID(), path, visitorId: `${siteId}-visitor` }) });
  const headers = { authorization: `Bearer ${env.E2E_SERVICE_SECRET}` };
  const a = await call(`/api/v1/sites/${siteA}/events?days=7`, { headers });
  const b = await call(`/api/v1/sites/${siteB}/events?days=7`, { headers });
  assert.equal(a.totals.views, 2); assert.equal(a.pages[0].path, '/a');
  assert.equal(b.totals.views, 1); assert.equal(b.pages[0].path, '/b');
  console.log('analytics-isolation: PASS');
} finally {
  await pool.query('DELETE FROM "AnalyticsEvent" WHERE "siteId" IN ($1,$2)', [siteA, siteB]);
  await pool.query('DELETE FROM "Site" WHERE "id" IN ($1,$2)', [siteA, siteB]);
  await pool.query('DELETE FROM "Workspace" WHERE "id" = $1', [workspaceId]);
  await pool.end();
}
