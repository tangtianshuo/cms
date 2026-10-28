import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
const dir = process.env.E2E_RUNTIME_DIR;
test(
    'Docker CMS → Gateway → approved image: draft isolation, publish, idempotency, stale rejection and rollback',
    { skip: !dir, timeout: 300000 },
    async () => {
        const env = Object.fromEntries(
            (await readFile(`${dir}/runtime.env`, 'utf8'))
                .trim()
                .split('\n')
                .map((s) => s.split('=')),
        );
        const login = await fetch('http://127.0.0.1:18080/api/v4/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email: env.E2E_EMAIL,
                password: env.E2E_PASSWORD,
            }),
        }).then((r) => r.json());
        const headers = {
            'content-type': 'application/json',
            authorization: `Bearer ${login.accessToken}`,
            'x-bcms-workspace': env.E2E_CMS_WORKSPACE,
            'x-bcms-site': env.E2E_CMS_SITE,
        };
        async function api(path, body, status = 200) {
            const r = await fetch(`http://127.0.0.1:18080/api/v4/${path}`, {
                headers,
                method: body === undefined ? 'GET' : 'POST',
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            assert.equal(r.status, status, await r.clone().text());
            return r.json();
        }
        async function publicHome() {
            return new Promise((resolve, reject) => {
                http.get(
                    'http://127.0.0.1:18090/',
                    { headers: { host: 'shop.localhost' } },
                    (r) => {
                        let body = '';
                        r.setEncoding('utf8');
                        r.on('data', (chunk) => (body += chunk));
                        r.on('end', () => {
                            try {
                                assert.equal(r.statusCode, 200, body);
                                resolve(body);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    },
                ).on('error', reject);
            });
        }
        async function ready(op) {
            for (let i = 0; i < 120; i++) {
                const s = await api(
                    `presets/releases/gateway/operations/${op.operationId}`,
                );
                if (s.status === 'ready') return s;
                assert.notEqual(s.status, 'failed', JSON.stringify(s));
                await new Promise((r) => setTimeout(r, 1000));
            }
            assert.fail('Gateway operation timed out');
        }
        async function boundedContainers() {
            let count = 0;
            for (let n = 0; n < 60; n++) {
                count = execFileSync('docker', ['ps', '-aq', '--filter', `label=gateway.site-id=${env.E2E_GATEWAY_SITE}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
                if (count <= 2) return;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            assert.ok(count <= 2, `automatic retirement must retain at most current + previous containers, got ${count}`);
        }
        async function publish(expected) {
            const check = await api('presets/releases/check', {});
            assert.equal(check.valid, true, JSON.stringify(check));
            const body = {
                target: 'gateway',
                requestKey: randomUUID(),
                expectedReleaseId: expected,
                snapshotHash: check.snapshotHash,
            };
            const op = await api('presets/releases/publish', body);
            const repeat = await api('presets/releases/publish', body);
            assert.equal(repeat.releaseId, op.releaseId);
            await ready(op);
            await boundedContainers();
            return op;
        }
        const baseline = await api('presets/releases/');
        const draftHeadline = `Gateway Docker saved draft ${randomUUID()}`;
        const first = await publish(baseline.currentReleaseId);
        const initial = await publicHome();
        assert.ok(initial.includes('Docker Gateway Store'));
        const studio = await api('studio/site');
        const home = studio.models.find((m) => m.key === 'home').entries[0];
        await api('studio/entries/home', {
            entryId: home.id,
            expectedUpdatedAt: home.updatedAt,
            operationId: randomUUID(),
            fields: { headline: draftHeadline },
        });
        assert.ok(!(await publicHome()).includes(draftHeadline));
        const second = await publish(first.releaseId);
        assert.ok((await publicHome()).includes(draftHeadline));
        await api(
            'presets/releases/publish',
            {
                target: 'gateway',
                requestKey: randomUUID(),
                expectedReleaseId: first.releaseId,
            },
            400,
        );
        const restored = await api('presets/releases/rollback', {
            target: 'gateway',
            releaseId: first.releaseId,
            requestKey: randomUUID(),
            expectedReleaseId: second.releaseId,
        });
        await ready(restored);
        await boundedContainers();
        assert.ok(!(await publicHome()).includes(draftHeadline));
        const history = await api('presets/releases/');
        assert.equal(history.currentReleaseId, restored.releaseId);
        assert.equal(history.items.length, baseline.items.length + 3);
        const denied = await fetch(
            'http://127.0.0.1:18183/api/v1/sites/' + env.E2E_GATEWAY_SITE,
        );
        assert.ok([401, 403].includes(denied.status));
        await writeFile(
            `${dir}/gateway-flow-result.json`,
            JSON.stringify(
                { first, second, restored, historyCount: history.items.length },
                null,
                2,
            ),
        );
    },
);
