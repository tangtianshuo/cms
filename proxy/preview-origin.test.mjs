import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('CMS deployment renders an exact configured origin and rejects injected origins', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'b3-edge-'));
    try {
        for (const template of ['nginx.conf', 'nginx.prod.conf']) {
            const output = path.join(dir, template);
            const result = spawnSync('sh', ['proxy/19-preview-origin.sh'], {
                env: {
                    ...process.env,
                    STOREFRONT_PREVIEW_PUBLIC_ORIGIN:
                        'https://preview.example.com',
                    CMS_NGINX_TEMPLATE: path.resolve('proxy', template),
                    CMS_NGINX_OUTPUT: output,
                },
                encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr);
            const text = await readFile(output, 'utf8');
            assert.ok(
                text.includes("frame-src 'self' https://preview.example.com;"),
            );
            assert.equal(text.includes('localhost:3000'), false);
            assert.equal(
                text.includes('${STOREFRONT_PREVIEW_PUBLIC_ORIGIN}'),
                false,
            );
        }
        for (const value of [
            '',
            'https://preview.example.com:443',
            'http://preview.example.com:80',
            'https://preview.example.com/path',
            'https://u:p@preview.example.com',
            'https://*.example.com',
            'https://preview.example.com; frame-src *',
            'https://preview.example.com\nadd_header Evil yes;',
        ]) {
            const result = spawnSync('sh', ['proxy/19-preview-origin.sh'], {
                env: {
                    ...process.env,
                    STOREFRONT_PREVIEW_PUBLIC_ORIGIN: value,
                    STOREFRONT_PREVIEW_SERVICE_URL: 'http://preview:4300',
                    CMS_NGINX_TEMPLATE: path.resolve('proxy/nginx.conf'),
                    CMS_NGINX_OUTPUT: path.join(dir, 'bad'),
                },
                encoding: 'utf8',
            });
            assert.notEqual(result.status, 0);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('optional preview remains disabled unless configured and configured service requires an exact origin', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'b3-optional-edge-'));
    try {
        const env = {
            ...process.env,
            STOREFRONT_PREVIEW_PUBLIC_ORIGIN: '',
            STOREFRONT_PREVIEW_SERVICE_URL: '',
            CMS_NGINX_TEMPLATE: path.resolve('proxy/nginx.prod.conf'),
            CMS_NGINX_OUTPUT: path.join(dir, 'nginx.conf'),
        };
        const absent = spawnSync('sh', ['proxy/19-preview-origin.sh'], {
            env,
            encoding: 'utf8',
        });
        assert.equal(absent.status, 0, absent.stderr);
        assert.ok(
            (await readFile(env.CMS_NGINX_OUTPUT, 'utf8')).includes(
                "frame-src 'self';",
            ),
        );
        const required = spawnSync('sh', ['proxy/19-preview-origin.sh'], {
            env: {
                ...env,
                STOREFRONT_PREVIEW_SERVICE_URL: 'http://preview:4300',
            },
            encoding: 'utf8',
        });
        assert.notEqual(required.status, 0);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test(
    'stock nginx startup renders optional/exact CSP and rejects missing configured origin',
    { skip: process.env.B3_EDGE_DOCKER !== '1', timeout: 30000 },
    async () => {
        const { execFileSync } = await import('node:child_process');
        const { randomUUID } = await import('node:crypto');
        const { setTimeout: delay } = await import('node:timers/promises');
        const docker = (args) =>
            execFileSync('docker', args, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }).trim();
        for (const origin of ['', 'https://preview.example.com']) {
            const name = 'b3-cms-proxy-' + randomUUID().slice(0, 10);
            let id;
            try {
                id = docker([
                    'run',
                    '--pull=never',
                    '-d',
                    '--name',
                    name,
                    '--add-host',
                    'backend:127.0.0.1',
                    '-p',
                    '127.0.0.1:18094:80',
                    '-e',
                    'STOREFRONT_PREVIEW_PUBLIC_ORIGIN=' + origin,
                    '-v',
                    path.resolve('proxy/nginx.prod.conf') +
                        ':/etc/nginx/nginx.conf.template:ro',
                    '-v',
                    path.resolve('proxy/19-preview-origin.sh') +
                        ':/docker-entrypoint.d/19-preview-origin.sh:ro',
                    'nginx:latest',
                ]);
                let response;
                for (let i = 0; i < 40; i++) {
                    try {
                        response = await fetch('http://127.0.0.1:18094/', {
                            headers: {
                                'x-forwarded-host': 'untrusted.invalid',
                            },
                        });
                        break;
                    } catch {
                        await delay(100);
                    }
                }
                assert.ok(response, 'stock nginx failed startup');
                assert.equal(response.status, 502);
                assert.ok(
                    response.headers
                        .get('content-security-policy')
                        .includes(
                            "frame-src 'self'" +
                                (origin ? ' ' + origin : '') +
                                ';',
                        ),
                );
                assert.equal(
                    response.headers
                        .get('content-security-policy')
                        .includes('untrusted.invalid'),
                    false,
                );
                docker(['exec', id, 'nginx', '-t']);
            } finally {
                if (id) docker(['rm', '-f', id]);
            }
        }
        const name = 'b3-cms-proxy-' + randomUUID().slice(0, 10);
        let id;
        try {
            id = docker([
                'run',
                '--pull=never',
                '-d',
                '--name',
                name,
                '--add-host',
                'backend:127.0.0.1',
                '-e',
                'STOREFRONT_PREVIEW_SERVICE_URL=http://preview:4300',
                '-v',
                path.resolve('proxy/nginx.prod.conf') +
                    ':/etc/nginx/nginx.conf.template:ro',
                '-v',
                path.resolve('proxy/19-preview-origin.sh') +
                    ':/docker-entrypoint.d/19-preview-origin.sh:ro',
                'nginx:latest',
            ]);
            for (let i = 0; i < 40; i++) {
                const state = JSON.parse(docker(['inspect', id]))[0].State;
                if (!state.Running) {
                    assert.notEqual(state.ExitCode, 0);
                    return;
                }
                await delay(100);
            }
            assert.fail('missing configured origin did not fail closed');
        } finally {
            if (id) docker(['rm', '-f', id]);
        }
    },
);
