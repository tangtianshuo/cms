import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gatewayRoot, cmsRoot, readEnv } from './runtime.mjs';

// Every run owns a fresh database and child processes; no shared service is stopped.
const env = await readEnv();
const templatesRoot = path.resolve(
    process.env.E2E_TEMPLATES_ROOT ||
        path.join(cmsRoot, '../Independent-Website-Templates'),
);
const { Pool } = createRequire(path.join(gatewayRoot, 'package.json'))('pg');
const database = `gateway_intake_${randomUUID().replaceAll('-', '')}`;
const dbUrl = new URL(
    `postgresql://e2e:${env.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
);
const admin = new Pool({ connectionString: dbUrl.href });
const directory = await mkdtemp(path.join(tmpdir(), 'independent-intake-'));
const children = [];
const evidence = { database, services: [], checks: [] };
let pool;
let created = false;
async function port() {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const value = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return value;
}
async function start(service, cwd, args, values, probe, probeOptions = {}) {
    const child = spawn(process.execPath, args, {
        cwd,
        env: { ...process.env, NODE_ENV: 'production', ...values },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let logs = '';
    child.stdout.on('data', (data) => (logs += data));
    child.stderr.on('data', (data) => (logs += data));
    evidence.services.push({
        service,
        pid: child.pid,
        port: Number(values.PORT),
        entrypoint: args[0],
    });
    for (let i = 0; i < 200; i++) {
        if (child.exitCode !== null)
            throw Error(`${service} exited before readiness`);
        try {
            if ((await fetch(probe, probeOptions)).ok) return child;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error(`${service} readiness timed out`);
}
async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
        child.kill('SIGTERM');
    });
}
async function call(origin, url, body, headers = {}) {
    return fetch(url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}
try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    dbUrl.pathname = `/${database}`;
    const run = spawnSync(
        process.execPath,
        ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
        {
            cwd: gatewayRoot,
            env: { ...process.env, DATABASE_URL: dbUrl.href },
            encoding: 'utf8',
        },
    );
    assert.equal(run.status, 0, 'disposable database migrations must succeed');
    pool = new Pool({ connectionString: dbUrl.href });
    const workspaceId = randomUUID(),
        siteA = randomUUID(),
        siteB = randomUUID();
    await pool.query(
        'INSERT INTO "Workspace" ("id","name","updatedAt") VALUES ($1,$2,now())',
        [workspaceId, 'independent intake acceptance'],
    );
    await pool.query(
        'INSERT INTO "Site" ("id","workspaceId","updatedAt") VALUES ($1,$3,now()),($2,$3,now())',
        [siteA, siteB, workspaceId],
    );
    await pool.query(
        'INSERT INTO "Domain" ("id","siteId","hostname","status","enabled","updatedAt") VALUES ($1,$2,$3,$4,true,now())',
        [randomUUID(), siteA, 'owned.example', 'active'],
    );
    const controlPort = await port(),
        ingestPort = await port(),
        aeroPort = await port(),
        firePort = await port();
    const control = `http://127.0.0.1:${controlPort}`,
        ingest = `http://127.0.0.1:${ingestPort}`;
    const origins = [
        `http://127.0.0.1:${aeroPort}`,
        `http://127.0.0.1:${firePort}`,
    ];
    const serviceSecret = randomUUID();
    const controlProcess = await start(
        'gateway-control',
        path.join(gatewayRoot, 'apps/control'),
        [
            path.join(gatewayRoot, 'node_modules/next/dist/bin/next'),
            'start',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(controlPort),
        ],
        {
            DATABASE_URL: dbUrl.href,
            CMS_SERVICE_SECRET: serviceSecret,
            PORT: String(controlPort),
        },
        control + '/api/v1/health/live',
    );
    const ingestProcess = await start(
        'gateway-ingest',
        gatewayRoot,
        ['apps/ingest/dist/server.js'],
        {
            DATABASE_URL: dbUrl.href,
            HOST: '127.0.0.1',
            PORT: String(ingestPort),
            INGEST_LOCAL_ORIGINS: origins.join(','),
            INGEST_TRUSTED_PROXY_IPS: '',
        },
        `${ingest}/api/v1/sites/${siteA}/events`,
        {
            method: 'OPTIONS',
            headers: {
                origin: origins[0],
                'access-control-request-method': 'POST',
            },
        },
    );
    const { contractFixture } = await import(
        pathToFileURL(path.join(templatesRoot, 'test/contract-fixture.mjs'))
    );
    const rendered = [];
    for (const [index, id, version, siteId, runtimePort] of [
        [0, 'aeroframe', '1.0.4', siteA, aeroPort],
        [1, 'fireguard', '1.0.1', siteB, firePort],
    ]) {
        const root = path.join(templatesRoot, 'templates', id, version);
        const manifest = JSON.parse(
            await readFile(path.join(root, 'template.json'), 'utf8'),
        );
        const snapshot = contractFixture();
        snapshot.workspaceId = workspaceId;
        snapshot.siteId = siteId;
        snapshot.template = { id, version };
        snapshot.operations.contactFormEnabled = true;
        const content = snapshot.pages[0].content;
        content.preset = {
            id,
            version,
            name: manifest.name,
            description: manifest.description,
            ...manifest.presentation,
        };
        content.sections = ['hero', 'feature'];
        content.seo.title = `Independent ${id}`;
        const artifact = path.join(directory, `${id}.json`);
        await writeFile(artifact, JSON.stringify(snapshot));
        await start(
            `${id}-${version}-public`,
            path.join(root, 'storefront'),
            ['.output/server/index.mjs'],
            {
                HOST: '127.0.0.1',
                PORT: String(runtimePort),
                PUBLISHED_SNAPSHOT_PATH: artifact,
                NUXT_PUBLISHED_SNAPSHOT_PATH: artifact,
                NUXT_WORKSPACE_ID: workspaceId,
                NUXT_SITE_ID: siteId,
                NUXT_PUBLIC_INGEST_ORIGIN: ingest,
                NUXT_GATEWAY_URL: control,
                NUXT_SITE_CREDENTIAL: 'control-must-not-be-used',
            },
            origins[index] + '/healthz',
        );
        const response = await fetch(origins[index] + '/');
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(
            html.includes('id="contact-form"'),
            `${id}: enabled form must render with the public intake origin`,
        );
        assert.ok(html.includes(ingest));
        assert.ok(!html.includes('control-must-not-be-used'));
        rendered.push({ origin: origins[index], siteId, html });
    }
    for (const [siteId, route] of [
        [siteA, '/a'],
        [siteA, '/a'],
        [siteB, '/b'],
    ]) {
        const index = siteId === siteA ? 0 : 1;
        const event = {
            eventId: randomUUID(),
            path: route,
            visitorId: `${siteId}-visitor`,
        };
        assert.equal(
            (
                await call(
                    origins[index],
                    `${ingest}/api/v1/sites/${siteId}/events`,
                    event,
                )
            ).status,
            202,
        );
        assert.equal(
            (
                await call(
                    origins[index],
                    `${ingest}/api/v1/sites/${siteId}/events`,
                    event,
                )
            ).status,
            200,
        );
    }
    const headers = { authorization: `Bearer ${serviceSecret}` };
    for (const [siteId, views, route] of [
        [siteA, 2, '/a'],
        [siteB, 1, '/b'],
    ]) {
        const response = await fetch(
            `${control}/api/v1/sites/${siteId}/events?days=7`,
            { headers },
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.totals.views, views);
        assert.equal(body.pages[0].path, route);
    }
    evidence.checks.push(
        'independent event writes, idempotency and control management site isolation',
    );
    const leadUrl = `${ingest}/api/v1/sites/${siteA}/leads`;
    const lead = {
        source: 'contact',
        email: 'visitor@example.test',
        message: 'Process acceptance',
    };
    assert.equal(
        (await call('https://foreign.example', leadUrl, lead)).status,
        403,
    );
    assert.equal(
        (
            await fetch(leadUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(lead),
            })
        ).status,
        403,
    );
    assert.equal(
        (await call(origins[0], leadUrl, { message: 'x'.repeat(65536) }))
            .status,
        413,
    );
    const accepted = await call(origins[0], leadUrl, lead, {
        'x-lead-idempotency-key': 'process-proof',
    });
    assert.equal(accepted.status, 202);
    const { id } = await accepted.json();
    assert.equal(
        (
            await call(origins[0], leadUrl, lead, {
                'x-lead-idempotency-key': 'process-proof',
            })
        ).status,
        200,
    );
    assert.equal(
        (await fetch(`${control}/api/v1/sites/${siteA}/leads`)).status,
        401,
    );
    const managed = await fetch(`${control}/api/v1/sites/${siteA}/leads`, {
        headers,
    });
    assert.equal(managed.status, 200);
    assert.equal((await managed.json()).items.length, 1);
    const patch = await fetch(
        `${control}/api/v1/sites/${siteA}/leads?id=${id}`,
        {
            method: 'PATCH',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({
                status: 'contacted',
                notes: 'Verified independent intake',
            }),
        },
    );
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).item.status, 'contacted');
    for (const endpoint of ['leads', 'events'])
        assert.equal(
            (
                await call(
                    origins[0],
                    `${control}/api/v1/sites/${siteA}/${endpoint}`,
                    lead,
                )
            ).status,
            405,
        );
    const preflight = await fetch(leadUrl, {
        method: 'OPTIONS',
        headers: {
            origin: origins[0],
            'access-control-request-method': 'POST',
            'access-control-request-headers':
                'content-type,x-lead-idempotency-key',
        },
    });
    assert.equal(preflight.status, 204);
    evidence.checks.push(
        'origin enforcement, 64KiB limit, lead retry, authorized GET/PATCH, control public POST disabled, allowed preflight',
    );
    await stop(controlProcess);
    evidence.controlStopped = {
        pid: controlProcess.pid,
        exitCode: controlProcess.exitCode,
        signal: controlProcess.signalCode,
    };
    await assert.rejects(fetch(control + '/api/v1/health/live'));
    for (const { origin, siteId } of rendered) {
        assert.equal(
            (
                await call(origin, `${ingest}/api/v1/sites/${siteId}/leads`, {
                    ...lead,
                    message: `control stopped ${siteId}`,
                })
            ).status,
            202,
        );
        assert.equal(
            (
                await call(origin, `${ingest}/api/v1/sites/${siteId}/events`, {
                    eventId: randomUUID(),
                    path: '/control-stopped',
                })
            ).status,
            202,
        );
    }
    evidence.checks.push(
        'control stopped: both real public template origins still receive lead and event 202',
    );
    await stop(ingestProcess);
    evidence.ingestStopped = {
        pid: ingestProcess.pid,
        exitCode: ingestProcess.exitCode,
        signal: ingestProcess.signalCode,
    };
    await assert.rejects(fetch(leadUrl));
    evidence.publicPages = [];
    for (const { origin, siteId, html } of rendered) {
        const response = await fetch(origin + '/');
        assert.equal(response.status, 200);
        const after = await response.text();
        assert.equal(after, html);
        evidence.publicPages.push({
            siteId,
            origin,
            status: response.status,
            sha256: createHash('sha256').update(after).digest('hex'),
            unchanged: true,
        });
    }
    evidence.checks.push(
        'intake and control stopped: both same built public pages remain 200 with identical HTML',
    );
    console.log(JSON.stringify(evidence, null, 2));
    console.log('analytics-isolation: PASS');
} finally {
    await Promise.all(children.map(stop));
    if (pool) await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
}
