import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createProvisioner,
    ProvisioningError,
    runProvisioningTick,
    type ProvisioningStore,
    type ProvisionInput,
} from './service';

function memory(attempts = 0) {
    const state = {
        requestKey: 'original-key',
        status: 'pending',
        attempts,
        nextAttemptAt: 0,
        leaseToken: 'lease-1',
    };
    const calls: unknown[] = [];
    const store: ProvisioningStore = {
        async claim(now) {
            calls.push(['claim', now]);
            return {
                cmsWorkspaceId: 'workspace',
                cmsSiteId: 'site',
                name: 'Name',
                state: {
                    ...state,
                    status: 'running',
                    attempts: state.attempts + 1,
                } as never,
            };
        },
        async complete(...args) {
            calls.push(['complete', ...args]);
            return true;
        },
        async defer(...args) {
            calls.push(['defer', ...args]);
            return true;
        },
    };
    return { store, calls };
}
const binding = {
    cmsWorkspaceId: 'workspace',
    cmsSiteId: 'site',
    workspaceId: 'a24cc816-ed2f-4c47-8ffb-dd45e441c4d4',
    siteId: '6124b020-c8ed-4160-9385-81101ae5b4cf',
    siteUrl: 'https://s.example.test',
};
test('tick retains the original key and records immutable identity before ready', async () => {
    const { store, calls } = memory();
    let input: ProvisionInput | undefined;
    await runProvisioningTick(
        store,
        async (value) => {
            input = value;
            return binding;
        },
        100,
    );
    assert.equal(input?.requestKey, 'original-key');
    assert.deepEqual(calls[1], [
        'complete',
        'site',
        'lease-1',
        { ...binding, source: 'provisioned' },
    ]);
});
test('transient failure follows 5/15/60/300 second backoff and stops after eight attempts', async () => {
    for (let attempts = 0; attempts < 8; attempts++) {
        const { store, calls } = memory(attempts);
        await runProvisioningTick(
            store,
            async () => {
                throw new Error('private http://internal.example');
            },
            100,
        );
        assert.deepEqual(calls[1], [
            'defer',
            'site',
            'lease-1',
            100 + [5000, 15000, 60000, 300000][Math.min(attempts, 3)],
            'gateway_unavailable',
        ]);
    }
});
test('permanent failure codes remain classified without private diagnostics', async () => {
    for (const code of [
        'gateway_unauthorized',
        'binding_conflict',
        'configuration_missing',
    ] as const) {
        const { store, calls } = memory();
        await runProvisioningTick(
            store,
            async () => {
                throw new ProvisioningError(code);
            },
            100,
        );
        assert.deepEqual(calls[1], ['defer', 'site', 'lease-1', 5100, code]);
    }
});
test('provision HTTP enforces timeout, auth, exact body, source identity and safe failure codes', async () => {
    const input = {
        cmsWorkspaceId: 'workspace',
        cmsSiteId: 'site',
        name: 'Name',
        requestKey: 'original-key',
    };
    const env = {
        GATEWAY_BASE_URL: 'http://127.0.0.1:5678',
        CMS_SERVICE_SECRET: 'secret',
    };
    let signal: AbortSignal | null | undefined;
    const provision = createProvisioner(env, (async (url, init) => {
        assert.equal(url, `${env.GATEWAY_BASE_URL}/api/v1/site-provisioning`);
        assert.equal(
            new Headers(init?.headers).get('Authorization'),
            'Bearer secret',
        );
        assert.deepEqual(JSON.parse(String(init?.body)), input);
        signal = init?.signal;
        return Response.json({ ...binding, status: 'provisioned' });
    }) as typeof fetch);
    assert.deepEqual(await provision(input), binding);
    assert.ok(signal instanceof AbortSignal);
    for (const [status, code] of [
        [401, 'gateway_unauthorized'],
        [403, 'gateway_unauthorized'],
        [409, 'binding_conflict'],
        [503, 'gateway_unavailable'],
    ] as const) {
        await assert.rejects(
            createProvisioner(env, (async () =>
                Response.json(
                    { error: 'secret' },
                    { status },
                )) as typeof fetch)(input),
            (error: unknown) =>
                error instanceof ProvisioningError && error.code === code,
        );
    }
    await assert.rejects(createProvisioner({})(input), /configuration_missing/);
    await assert.rejects(
        createProvisioner(env, (async () =>
            Response.json({
                ...binding,
                cmsSiteId: 'foreign',
            })) as typeof fetch)(input),
        /binding_conflict/,
    );
});

test('provisioning rejects unsafe or noncanonical Gateway origins before sending credentials', async () => {
    const input = {
        cmsWorkspaceId: 'workspace',
        cmsSiteId: 'site',
        name: 'Name',
        requestKey: 'original-key',
    };
    let calls = 0;
    for (const gatewayBaseUrl of [
        'http://gateway.example',
        'https://gateway.example/private',
        'https://gateway.example?token=private',
        'https://user:secret@gateway.example',
    ]) {
        await assert.rejects(
            createProvisioner(
                {
                    GATEWAY_BASE_URL: gatewayBaseUrl,
                    CMS_SERVICE_SECRET: 'private-secret',
                },
                (async () => {
                    calls += 1;
                    return Response.json(binding);
                }) as typeof fetch,
            )(input),
            (error: unknown) =>
                error instanceof ProvisioningError &&
                error.code === 'configuration_missing',
        );
    }
    assert.equal(calls, 0);
});

test('provisioning refuses redirects so the bearer token never reaches the redirect target', async (context) => {
    const { createServer } = await import('node:http');
    let redirectedCalls = 0;
    let redirectedAuthorization = '';
    const target = createServer((request, response) => {
        redirectedCalls += 1;
        redirectedAuthorization = String(request.headers.authorization || '');
        response.end('{}');
    });
    const redirect = createServer((_request, response) => {
        const address = target.address();
        if (!address || typeof address === 'string')
            throw new Error('target unavailable');
        response.writeHead(302, {
            location: `http://127.0.0.1:${address.port}/capture`,
        });
        response.end();
    });
    context.after(async () => {
        redirect.closeAllConnections();
        target.closeAllConnections();
        await Promise.all([
            new Promise<void>((resolve) => redirect.close(() => resolve())),
            new Promise<void>((resolve) => target.close(() => resolve())),
        ]);
    });
    await new Promise<void>((resolve) =>
        redirect.listen(0, '127.0.0.1', resolve),
    );
    await new Promise<void>((resolve) =>
        target.listen(0, '127.0.0.1', resolve),
    );
    const address = redirect.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(
        createProvisioner({
            GATEWAY_BASE_URL: `http://127.0.0.1:${address.port}`,
            CMS_SERVICE_SECRET: 'private-secret',
        })({
            cmsWorkspaceId: 'workspace',
            cmsSiteId: 'site',
            name: 'Name',
            requestKey: 'original-key',
        }),
        (error: unknown) =>
            error instanceof ProvisioningError &&
            error.code === 'gateway_unavailable',
    );
    assert.equal(redirectedCalls, 0);
    assert.equal(redirectedAuthorization, '');
});

test(
    'the real HTTP request timeout also bounds a stalled response body at fifteen seconds',
    { timeout: 25000 },
    async (context) => {
        const { createServer } = await import('node:http');
        const server = createServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.write('{"cmsWorkspaceId":');
        });
        context.after(async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        });
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const start = Date.now();
        await assert.rejects(
            createProvisioner({
                GATEWAY_BASE_URL: `http://127.0.0.1:${address.port}`,
                CMS_SERVICE_SECRET: 'test',
            })({
                cmsWorkspaceId: 'workspace',
                cmsSiteId: 'site',
                name: 'Name',
                requestKey: 'original-key',
            }),
            (cause: unknown) =>
                cause instanceof ProvisioningError &&
                cause.code === 'gateway_unavailable',
        );
        assert.ok(Date.now() - start >= 14500);
        assert.ok(Date.now() - start < 23000);
    },
);
