import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import {
    randomBytes,
    randomUUID,
    X509Certificate,
    createPrivateKey,
} from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync, spawn, execFileSync } from 'node:child_process';
export const cmsRoot = fileURLToPath(new URL('../../', import.meta.url));
export const runtimeDir = path.resolve(
    process.env.E2E_RUNTIME_DIR ||
        path.join(cmsRoot, '.superpowers/sdd/platform-a4-runtime'),
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
export async function assertRuntimeCertificateValid(
    directory,
    now = Date.now(),
) {
    try {
        const certificate = new X509Certificate(
            await readFile(path.join(directory, 'tls/cert.pem')),
        );
        if (now >= Date.parse(certificate.validTo))
            throw new Error('certificate expired');
        if (now < Date.parse(certificate.validFrom))
            throw new Error('certificate not yet valid');
        const key = createPrivateKey(
            await readFile(path.join(directory, 'tls/key.pem')),
        );
        if (!certificate.checkPrivateKey(key))
            throw new Error('certificate key mismatch');
        if (!certificate.checkHost('gateway-tls'))
            throw new Error('certificate host mismatch');
    } catch (error) {
        throw new Error(
            `Disposable runtime TLS certificate unavailable or invalid (${error.message}). Set E2E_RUNTIME_DIR to a new unused directory and run node ops/e2e/runtime.mjs init, then build and start that runtime. Existing runtime retained.`,
            { cause: error },
        );
    }
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
            process.env.GATEWAY_DOCKER_PLATFORM ||
            (process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64'),
        GATEWAY_APPROVED_IMAGE_DIGEST:
            process.env.GATEWAY_APPROVED_IMAGE_DIGEST || '',
        NUXT_PUBLIC_INGEST_ORIGIN: 'http://127.0.0.1:18184',
        GATEWAY_PROXY_PORT: '18090',
        GATEWAY_ROUTE_STATE_PATH: path.join(runtimeDir, 'gateway-routes.json'),
        GATEWAY_SNAPSHOT_HOST_DIR: path.join(runtimeDir, 'gateway-snapshots'),
    };
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const command = process.argv[2];
    if (command === 'init') {
        await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
        await chmod(runtimeDir, 0o700);
        try {
            await readEnv();
            await assertRuntimeCertificateValid(runtimeDir);
            console.log('Existing disposable runtime retained');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const secret = () => randomBytes(24).toString('hex');
            const project = `platform-a4-${randomBytes(5).toString('hex')}`;
            await saveEnv({
                COMPOSE_PROJECT_NAME: project,
                E2E_RUNTIME_DIR: runtimeDir,
                E2E_CMS_IMAGE: `local/${project}-cms:source`,
                E2E_GATEWAY_IMAGE: `local/${project}-gateway:source`,
                E2E_TEMPLATES: JSON.stringify(
                    (
                        process.env.E2E_TEMPLATE_MATRIX ||
                        'aeroframe@1.0.4,fireguard@1.0.1'
                    )
                        .split(',')
                        .map((identity) => {
                            const [id, version] = identity.split('@');
                            if (
                                !/^[a-z][a-z0-9-]*$/.test(id) ||
                                !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
                                    version,
                                )
                            )
                                throw new Error(
                                    'Invalid template matrix identity',
                                );
                            return {
                                id,
                                version,
                                image: `local/${project}-${id}:${version}`,
                            };
                        }),
                ),
                E2E_DB_PASSWORD: secret(),
                E2E_JWT_SECRET: secret(),
                E2E_STOREFRONT_SECRET: secret(),
                E2E_DOMAIN_SECRET: secret(),
                E2E_SERVICE_SECRET: secret(),
                E2E_GATEWAY_WORKSPACE: randomUUID(),
                E2E_GATEWAY_SITE: randomUUID(),
                E2E_CMS_WORKSPACE: '',
                E2E_CMS_SITE: '',
                E2E_SNAPSHOT_HOST_DIR: path.join(
                    runtimeDir,
                    'gateway-snapshots',
                ),
                E2E_EMAIL: 'docker-e2e@acceptance.invalid',
                E2E_PASSWORD: secret(),
            });
            await mkdir(path.join(runtimeDir, 'gateway-snapshots'), {
                mode: 0o700,
            });
            await mkdir(path.join(runtimeDir, 'tls'), { mode: 0o700 });
            execFileSync(
                'openssl',
                [
                    'req',
                    '-x509',
                    '-newkey',
                    'rsa:2048',
                    '-nodes',
                    '-days',
                    '3',
                    '-subj',
                    '/CN=gateway-tls',
                    '-addext',
                    'subjectAltName=DNS:gateway-tls',
                    '-keyout',
                    path.join(runtimeDir, 'tls/key.pem'),
                    '-out',
                    path.join(runtimeDir, 'tls/cert.pem'),
                ],
                { stdio: 'ignore' },
            );
            await chmod(path.join(runtimeDir, 'tls/key.pem'), 0o600);
            console.log(
                'Disposable runtime created; credentials kept in ignored mode-0600 file',
            );
        }
    } else if (command === 'up') compose('up', '-d', '--wait');
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
    } else if (command === 'worker' || command === 'traffic') {
        const e = await readEnv();
        const child = spawn(
            process.execPath,
            [path.join(gatewayRoot, `packages/${command}/dist/index.js`)],
            { cwd: gatewayRoot, env: workerEnv(e), stdio: 'inherit' },
        );
        await writeFile(
            path.join(runtimeDir, `${command}.pid`),
            String(child.pid),
        );
        for (const signal of ['SIGINT', 'SIGTERM'])
            process.on(signal, () => child.kill(signal));
        child.on('exit', (code) => (process.exitCode = code || 0));
    } else
        throw new Error(
            'Usage: node ops/e2e/runtime.mjs init|up|status|migrate|worker|traffic',
        );
}
