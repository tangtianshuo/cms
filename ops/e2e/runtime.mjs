import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
export const cmsRoot = fileURLToPath(new URL('../../', import.meta.url));
export const runtimeDir = path.resolve(
    process.env.E2E_RUNTIME_DIR ||
        path.join(cmsRoot, '.superpowers/sdd/docker-e2e-20261028'),
);
export const gatewayRoot = path.resolve(
    process.env.E2E_GATEWAY_ROOT ||
        path.join(cmsRoot, '../Independent-Website-Gateway'),
);
export async function readEnv() {
    return Object.fromEntries(
        (await readFile(path.join(runtimeDir, 'runtime.env'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => {
                const at = line.indexOf('=');
                return [line.slice(0, at), line.slice(at + 1)];
            }),
    );
}
export async function saveEnv(values) {
    await writeFile(
        path.join(runtimeDir, 'runtime.env'),
        Object.entries(values)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n') + '\n',
        { mode: 0o600 },
    );
}
export function compose(...args) {
    const r = spawnSync(
        'docker',
        [
            'compose',
            '--env-file',
            path.join(runtimeDir, 'runtime.env'),
            '-f',
            path.join(cmsRoot, 'ops/e2e/compose.yml'),
            ...args,
        ],
        { cwd: cmsRoot, stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error(`Compose failed (${r.status})`);
}
export function workerEnv(e) {
    return {
        ...process.env,
        DATABASE_URL: `postgresql://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
        GATEWAY_CONTROL_URL: 'http://host.docker.internal:18183',
        DOCKER_SOCKET_PATH:
            process.env.DOCKER_SOCKET_PATH ||
            path.join(process.env.HOME, '.docker/run/docker.sock'),
        GATEWAY_DOCKER_PLATFORM:
            process.env.GATEWAY_DOCKER_PLATFORM || 'linux/amd64',
        GATEWAY_PROXY_PORT: '18090',
        GATEWAY_ROUTE_STATE_PATH: path.join(runtimeDir, 'gateway-routes.json'),
    };
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const command = process.argv[2];
    if (command === 'init') {
        await mkdir(runtimeDir, { recursive: true });
        try {
            await readEnv();
            console.log('Existing disposable runtime retained');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const secret = () => randomBytes(24).toString('hex');
            await saveEnv({
                E2E_DB_PASSWORD: secret(),
                E2E_JWT_SECRET: secret(),
                E2E_STOREFRONT_SECRET: secret(),
                E2E_DOMAIN_SECRET: secret(),
                E2E_SERVICE_SECRET: secret(),
                E2E_GATEWAY_WORKSPACE: randomUUID(),
                E2E_GATEWAY_SITE: randomUUID(),
                E2E_CMS_WORKSPACE: '',
                E2E_CMS_SITE: '',
                E2E_EMAIL: 'docker-e2e@acceptance.invalid',
                E2E_PASSWORD: secret(),
            });
            console.log(
                'Disposable runtime created; credentials kept in ignored mode-0600 file',
            );
        }
    } else if (command === 'up') compose('up', '-d');
    else if (command === 'status') compose('ps');
    else if (command === 'migrate') {
        const e = await readEnv();
        const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
            cwd: gatewayRoot,
            stdio: 'inherit',
            env: {
                ...process.env,
                DATABASE_URL: `postgresql://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
            },
        });
        if (r.status !== 0) throw new Error('Migration failed');
    } else if (command === 'worker') {
        const e = await readEnv();
        const child = spawn(
            process.execPath,
            [path.join(gatewayRoot, 'packages/worker/dist/index.js')],
            { cwd: gatewayRoot, env: workerEnv(e), stdio: 'inherit' },
        );
        await writeFile(path.join(runtimeDir, 'worker.pid'), String(child.pid));
        for (const signal of ['SIGINT', 'SIGTERM'])
            process.on(signal, () => child.kill(signal));
        child.on('exit', (code) => (process.exitCode = code || 0));
    } else
        throw new Error(
            'Usage: node ops/e2e/runtime.mjs init|up|status|migrate|worker',
        );
}
