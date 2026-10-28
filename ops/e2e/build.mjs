// Snapshot source without environment files, generated data, or installed dependencies.
import { mkdir, copyFile, lstat, open } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { cmsRoot, gatewayRoot, runtimeDir } from './runtime.mjs';
const templatesRoot = path.resolve(
    process.env.E2E_TEMPLATES_ROOT ||
        path.join(cmsRoot, '../Independent-Website-Templates'),
);
const runDir = path.join(runtimeDir, `build-${Date.now()}`);
async function snapshot(root, name) {
    const out = path.join(runDir, name);
    await mkdir(out, { recursive: true });
    const files = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: root, encoding: 'utf8' },
    )
        .split('\0')
        .filter(Boolean);
    for (const file of new Set(files)) {
        if (
            /(^|\/)(\.env[^/]*|\.npmrc|\.DS_Store|node_modules|\.git)(\/|$)|\.(pem|key)$|(^|\/)(id_rsa|id_ed25519)/.test(
                file,
            ) ||
            /^(db|uploads|backups|deliverables|manual-assets|\.superpowers|backend\/(uploads|backups|dist)|ui\/dist|storefront\/(\.nuxt|\.output))\//.test(
                file,
            )
        )
            continue;
        let info;
        try {
            info = await lstat(path.join(root, file));
        } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
        }
        if (!info.isFile()) continue;
        await mkdir(path.dirname(path.join(out, file)), { recursive: true });
        await copyFile(path.join(root, file), path.join(out, file));
    }
    return out;
}
const contexts = {
    cms: await snapshot(cmsRoot, 'cms'),
    gateway: await snapshot(gatewayRoot, 'gateway'),
    templates: await snapshot(templatesRoot, 'templates'),
};
for (const [name, args] of [
    [
        'cms',
        [
            '-t',
            'local/cms-e2e:20261028',
            '--build-arg',
            'VITE_STOREFRONT_ORIGIN=http://127.0.0.1:13001',
            '--build-arg',
            'VITE_TEMPLATE_PREVIEW_ORIGIN=http://127.0.0.1:18081',
            contexts.cms,
        ],
    ],
    [
        'storefront',
        [
            '-t',
            'local/cms-storefront-e2e:20261028',
            '-f',
            path.join(contexts.cms, 'Dockerfile.storefront'),
            contexts.cms,
        ],
    ],
    ['gateway', ['-t', 'local/gateway-e2e:20261028', contexts.gateway]],
    [
        'template',
        [
            '-t',
            'local/aeroframe:1.0.3',
            '--build-arg',
            'RELEASE_VERSION=1.0.3',
            path.join(contexts.templates, 'templates/aeroframe/1.0.3'),
        ],
    ],
]) {
    console.log(`Building ${name}; log: ${path.join(runDir, name + '.log')}`);
    const log = await open(path.join(runDir, name + '.log'), 'w');
    const run = spawnSync('docker', ['build', ...args], {
        cwd: cmsRoot,
        stdio: ['ignore', log.fd, log.fd],
    });
    await log.close();
    if (run.status !== 0)
        throw new Error(`${name} image build failed (${run.status})`);
}
console.log('All four local images built. No remote image was published.');
