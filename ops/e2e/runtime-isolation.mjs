import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { cmsRoot, compose, readEnv, runtimeDir } from './runtime.mjs';

const e = await readEnv();
const artifactRoot = path.join(runtimeDir, 'runtime-artifact-isolation-check');
const release = JSON.parse(await readFile(path.join(artifactRoot, 'release.json'), 'utf8'));
const container = 'cms-e2e-runtime-isolation';
const artifactPort = 13002;

function docker(args, options = {}) {
    return execFileSync('docker', args, { cwd: cmsRoot, encoding: 'utf8', stdio: options.stdio || ['ignore', 'pipe', 'pipe'] });
}

function removeContainer() {
    try { docker(['rm', '-f', container]); } catch { /* already absent */ }
}

async function waitFor(url, options = {}) {
    const deadline = Date.now() + (options.timeout || 30000);
    let last;
    while (Date.now() < deadline) {
        try {
            const status = Number(execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}',
                '-H', 'Host: builtin.localhost', '-H', `x-storefront-key: ${e.E2E_STOREFRONT_SECRET}`, url], { encoding: 'utf8' }).trim());
            if (status > 0) return status;
        } catch (error) { last = error; }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${url}: ${last instanceof Error ? last.message : 'no response'}`);
}

async function artifactRequest(pathname, status = 200) {
    const raw = execFileSync('curl', ['-sS', '-D', '-', '-H', 'Host: builtin.localhost',
        '-H', 'x-storefront-host: builtin.localhost', '-H', `x-storefront-key: ${e.E2E_STOREFRONT_SECRET}`,
        `http://127.0.0.1:${artifactPort}${pathname}`], { encoding: 'utf8' });
    const separator = raw.indexOf('\r\n\r\n');
    const headerText = separator >= 0 ? raw.slice(0, separator) : raw;
    const body = separator >= 0 ? raw.slice(separator + 4) : '';
    const statusCode = Number(/^HTTP\/\S+\s+(\d+)/m.exec(headerText)?.[1] || 0);
    const headers = new Headers();
    for (const line of headerText.split(/\r?\n/).slice(1)) {
        const index = line.indexOf(':');
        if (index > 0) headers.set(line.slice(0, index), line.slice(index + 1).trim());
    }
    assert.equal(statusCode, status, pathname);
    return { status: statusCode, headers, text: async () => body };
}

async function cmsApi(pathname, token, body, status = 200) {
    const response = await fetch(`http://127.0.0.1:18080${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-bcms-workspace': e.E2E_CMS_WORKSPACE,
            'x-bcms-site': e.E2E_CMS_SITE, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, status, `${pathname}: ${await response.clone().text()}`);
    return response;
}

async function loginCms() {
    const deadline = Date.now() + 30000;
    let last = '';
    while (Date.now() < deadline) {
        const response = await fetch('http://127.0.0.1:18080/api/v4/auth/login', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: e.E2E_EMAIL, password: e.E2E_PASSWORD }),
        });
        if (response.status === 200) return response.json();
        last = `${response.status} ${await response.text()}`;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`CMS did not become ready: ${last}`);
}

await access(path.join(artifactRoot, 'assets/media/logo.txt'));
removeContainer();
let cmsStopped = false;
let controlStopped = false;
try {
    docker(['run', '-d', '--name', container, '--network', 'bridge', '-p', `${artifactPort}:3000`,
        '-e', 'NODE_ENV=production', '-e', 'NUXT_DOMAIN_PRODUCTION=false',
        '-e', 'NUXT_RUNTIME_ARTIFACT_ROOT=/var/lib/runtime',
        '-e', `NUXT_RUNTIME_RELEASE_ID=${release.releaseId}`,
        '-e', 'NUXT_LEGACY_CMS_PUBLIC_READ=false',
        '-e', 'NUXT_PUBLIC_SITE_HOST=builtin.localhost',
        '-e', `NUXT_GATEWAY_SECRET=${e.E2E_STOREFRONT_SECRET}`,
        '-e', `NUXT_DOMAIN_SECRET=${e.E2E_DOMAIN_SECRET}`,
        '-v', `${artifactRoot}:/var/lib/runtime:ro`, 'local/cms-storefront-e2e:20261028']);
    await waitFor(`http://127.0.0.1:${artifactPort}/`);

    const baseline = [
        ['/', 200], ['/api/published?path=/', 200], ['/_assets/media/logo.txt', 200],
        ['/sitemap.xml', 200], ['/api/published?path=/legacy-home', 200],
    ];
    for (const [pathname, status] of baseline) await artifactRequest(pathname, status);
    const legacy = await artifactRequest('/api/published?path=/legacy-home');
    assert.equal(JSON.parse(await legacy.text()).redirect, '/');

    const beforeCmsStop = docker(['logs', 'cms-e2e-20261028-cms-1']);
    compose('stop', 'cms');
    cmsStopped = true;
    for (const [pathname, status] of baseline) await artifactRequest(pathname, status);
    const afterCmsStop = docker(['logs', 'cms-e2e-20261028-cms-1']);
    assert.equal(afterCmsStop.slice(beforeCmsStop.length).includes('/api/v4/storefront/published'), false,
        'artifact requests must not call the CMS public read endpoint');

    compose('start', 'cms');
    cmsStopped = false;
    await waitFor('http://127.0.0.1:18080/api/v4/health-check');
    compose('stop', 'gateway-control');
    controlStopped = true;
    for (const [pathname, status] of baseline) await artifactRequest(pathname, status);

    const token = (await loginCms()).accessToken;
    const gatewayStateResponse = await cmsApi('/api/v4/presets/releases/gateway', token);
    assert.equal(gatewayStateResponse.status, 200);
    const gatewayState = await gatewayStateResponse.json();
    assert.equal(gatewayState.configured, true, JSON.stringify(gatewayState));
    assert.equal(gatewayState.bound, true, JSON.stringify(gatewayState));
    let pending = gatewayState.publishStatus;
    if (!pending || pending.status !== 'pending') {
        const history = await (await cmsApi('/api/v4/presets/releases/', token)).json();
        const publish = await cmsApi('/api/v4/presets/releases/publish', token, {
            target: 'gateway', requestKey: randomUUID(), expectedReleaseId: history.currentReleaseId || '',
        });
        assert.equal(publish.status, 200, JSON.stringify(publish));
        const body = await publish.json();
        assert.equal(body.status, 'pending', JSON.stringify(body));
        assert.equal(body.failureCode, 'gateway_unavailable', JSON.stringify(body));
        pending = body;
    }
    assert.equal(pending.status, 'pending', JSON.stringify(pending));

    compose('start', 'gateway-control');
    controlStopped = false;
    console.log('runtime-isolation: PASS');
} finally {
    if (controlStopped) { try { compose('start', 'gateway-control'); } catch { /* report below */ } }
    if (cmsStopped) { try { compose('start', 'cms'); } catch { /* report below */ } }
    removeContainer();
}
