import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { probePublishedSite } from './public-probes.mjs';

function html(body, status = 200, headers = {}) {
    return new Response(body, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    });
}

async function runProbeCli(args, env = process.env) {
    const child = spawn(
        process.execPath,
        [new URL('./public-probes.mjs', import.meta.url).pathname, ...args],
        {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const status = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
    });
    return {
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
    };
}

test('does not accept the old site homepage as the new site', async () => {
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/'],
        fetcher: async () => html('<h1>old site</h1>'),
    });
    assert.equal(result[0].status, 200);
    assert.equal(result[0].markerPresent, false);
    assert.equal(result[0].ok, false);
    assert.equal(result[0].reason, 'marker_missing');
});

test('accepts only the configured marker and sends credential-free strict requests', async () => {
    let request;
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/'],
        fetcher: async (url, options) => {
            request = { url: String(url), options };
            return html('<main>new-site-marker</main>');
        },
    });
    assert.equal(result[0].ok, true);
    assert.equal(result[0].markerPresent, true);
    assert.equal(request.options.redirect, 'manual');
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(request.options.headers.authorization, undefined);
    assert.equal(request.options.headers.cookie, undefined);
});

test('keeps challenge redirects visible and rejects them', async () => {
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/'],
        fetcher: async () =>
            new Response(null, {
                status: 302,
                headers: {
                    location: '/cdn-cgi/challenge-platform/h/b/orchestrate',
                },
            }),
    });
    assert.equal(result[0].status, 302);
    assert.equal(
        result[0].redirectedTo,
        '/cdn-cgi/challenge-platform/h/b/orchestrate',
    );
    assert.equal(result[0].reason, 'challenge_redirect');
    assert.equal(result[0].ok, false);
});

test('reports product 404 separately from a wrong homepage', async () => {
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/products/missing'],
        fetcher: async () => new Response('', { status: 404 }),
    });
    assert.equal(result[0].status, 404);
    assert.equal(result[0].reason, 'product_not_found');
    assert.equal(result[0].ok, false);
});

test('rejects an image served with the wrong content type', async () => {
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/images/hero.png'],
        fetcher: async () =>
            new Response('not an image', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
    });
    assert.equal(result[0].status, 200);
    assert.equal(result[0].expectedContentType, 'image/png');
    assert.equal(result[0].contentType, 'text/html');
    assert.equal(result[0].reason, 'content_type_mismatch');
    assert.equal(result[0].ok, false);
});

test('bounds page body consumption and classifies stalled bodies as timeout', async () => {
    const started = performance.now();
    const fetcher = async () =>
        new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('<main>'));
                },
                cancel() {},
            }),
            {
                status: 200,
                headers: { 'content-type': 'text/html' },
            },
        );
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/'],
        timeoutMs: 50,
        fetcher,
    });
    assert.ok(performance.now() - started < 2_000);
    assert.equal(result[0].status, 0);
    assert.equal(result[0].reason, 'timeout');
    assert.equal(result[0].ok, false);
});

test('separates connection and untrusted TLS failures', async () => {
    const result = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/'],
        fetcher: async (_url, options) => {
            assert.ok(options.signal instanceof AbortSignal);
            throw Object.assign(new Error('self-signed certificate'), {
                cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
            });
        },
    });
    assert.equal(result[0].status, 0);
    assert.equal(result[0].reason, 'tls_untrusted');

    const connection = await probePublishedSite({
        origin: 'https://site.example',
        marker: 'new-site-marker',
        paths: ['/'],
        fetcher: async () => {
            throw Object.assign(new Error('connection refused'), {
                cause: { code: 'ECONNREFUSED' },
            });
        },
    });
    assert.equal(connection[0].reason, 'connection_failed');
});

test('rejects credentials in origins before fetching', async () => {
    let calls = 0;
    await assert.rejects(
        probePublishedSite({
            origin: 'https://user:secret@site.example',
            marker: 'marker',
            paths: ['/'],
            fetcher: async () => {
                calls += 1;
                return html('marker');
            },
        }),
        /credential-free HTTPS origin/,
    );
    assert.equal(calls, 0);
});

test('probes an actual strict local HTTPS endpoint and rejects its untrusted certificate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd2-public-probes-'));
    const keyPath = join(directory, 'key.pem');
    const certificatePath = join(directory, 'certificate.pem');
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            keyPath,
            '-out',
            certificatePath,
            '-days',
            '1',
            '-subj',
            '/CN=localhost',
            '-addext',
            'subjectAltName=DNS:localhost,IP:127.0.0.1',
        ],
        { stdio: 'ignore' },
    );
    const [key, certificate] = await Promise.all([
        readFile(keyPath),
        readFile(certificatePath),
    ]);
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0VQAAAAASUVORK5CYII=',
        'base64',
    );
    const server = createServer(
        { key, cert: certificate },
        (request, response) => {
            if (request.url === '/') {
                response.writeHead(200, {
                    'content-type': 'text/html; charset=utf-8',
                });
                response.end('<main>d2-local-marker</main>');
                return;
            }
            if (request.url === '/hero.png') {
                response.writeHead(200, { 'content-type': 'image/png' });
                response.end(png);
                return;
            }
            if (request.url === '/old') {
                response.writeHead(200, {
                    'content-type': 'text/html; charset=utf-8',
                });
                response.end('<main>previous site</main>');
                return;
            }
            response.writeHead(404, { 'content-type': 'text/html' });
            response.end('<h1>not found</h1>');
        },
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const { port } = server.address();
        const origin = `https://localhost:${port}`;
        const untrusted = await probePublishedSite({
            origin,
            marker: 'd2-local-marker',
            paths: ['/'],
        });
        assert.equal(untrusted[0].status, 0);
        assert.equal(untrusted[0].reason, 'tls_untrusted');

        const childEnvironment = {
            ...process.env,
            NODE_EXTRA_CA_CERTS: certificatePath,
        };
        const success = await runProbeCli(
            [
                '--origin',
                origin,
                '--marker',
                'd2-local-marker',
                '--path',
                '/',
                '--path',
                '/hero.png',
            ],
            childEnvironment,
        );
        assert.equal(success.status, 0, success.stderr || success.stdout);
        const output = JSON.parse(success.stdout);
        assert.equal(output.passed, true);
        assert.equal(output.probes.length, 2);
        assert.equal(output.probes[0].markerPresent, true);
        assert.equal(output.probes[1].contentType, 'image/png');

        const failure = await runProbeCli(
            [
                '--origin',
                origin,
                '--marker',
                'd2-local-marker',
                '--path',
                '/old',
            ],
            childEnvironment,
        );
        assert.equal(failure.status, 1);
        const failedOutput = JSON.parse(failure.stdout);
        assert.equal(failedOutput.passed, false);
        assert.equal(failedOutput.probes[0].status, 200);
        assert.equal(failedOutput.probes[0].reason, 'marker_missing');
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(directory, { recursive: true, force: true });
    }
});
