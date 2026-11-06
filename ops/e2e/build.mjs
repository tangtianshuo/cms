// Reproducible source contexts are extracted from exact Git commits, never dirty files.
import { mkdir, open, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { cmsRoot, gatewayRoot, runtimeDir, readEnv } from './runtime.mjs';
export async function snapshotCommit(root, out) {
    const git = (args) =>
        execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 128 * 1024 * 1024,
        }).trim();
    const commit = git(['rev-parse', 'HEAD']);
    await mkdir(out, { recursive: true });
    const archive = execFileSync('git', ['archive', '--format=tar', commit], {
        cwd: root,
        maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync('tar', ['-xf', '-', '-C', out], { input: archive });
    let repository;
    try {
        repository = git(['remote', 'get-url', 'origin']);
    } catch {
        repository = root;
    }
    return { repository, commit };
}
export async function build() {
    const e = await readEnv();
    const templates = JSON.parse(e.E2E_TEMPLATES);
    const roots = {
        cms: cmsRoot,
        gateway: gatewayRoot,
        templates: path.resolve(
            process.env.E2E_TEMPLATES_ROOT ||
                path.join(cmsRoot, '../Independent-Website-Templates'),
        ),
        preview: path.resolve(
            process.env.E2E_PREVIEW_ROOT ||
                path.join(cmsRoot, '../Independent-Website-Preview'),
        ),
    };
    const runDir = path.join(runtimeDir, `build-${Date.now()}`);
    const repositories = {};
    for (const [name, root] of Object.entries(roots))
        repositories[name] = await snapshotCommit(
            root,
            path.join(runDir, name),
        );
    const context = (name) => path.join(runDir, name);
    const images = {};
    const jobs = [
        [
            'cms',
            e.E2E_CMS_IMAGE,
            [
                '--build-arg',
                'VITE_STOREFRONT_ORIGIN=http://127.0.0.1:13001',
                '--build-arg',
                'VITE_TEMPLATE_PREVIEW_ORIGIN=http://127.0.0.1:18081',
                context('cms'),
            ],
            'cms',
        ],
        ['gateway', e.E2E_GATEWAY_IMAGE, [context('gateway')], 'gateway'],
        [
            'preview',
            e.E2E_PREVIEW_IMAGE ||
                `local/${e.COMPOSE_PROJECT_NAME}-preview:source`,
            [context('preview')],
            'preview',
        ],
        ...templates.map((t) => [
            `${t.id}-${t.version}`,
            t.image,
            [
                '--build-arg',
                `RELEASE_VERSION=${t.version}`,
                path.join(context('templates'), 'templates', t.id, t.version),
            ],
            'templates',
        ]),
    ];
    for (const [name, tag, args, repo] of jobs) {
        const logPath = path.join(runDir, `${name}.log`);
        console.log(
            `Building ${name} from ${repositories[repo].commit}; log: ${logPath}`,
        );
        const log = await open(logPath, 'w');
        const run = spawnSync(
            'docker',
            [
                'build',
                '--build-arg',
                `SOURCE_COMMIT=${repositories[repo].commit}`,
                '-t',
                tag,
                ...args,
            ],
            { cwd: cmsRoot, stdio: ['ignore', log.fd, log.fd] },
        );
        await log.close();
        if (run.status !== 0)
            throw new Error(
                `${name} clean image build failed (${run.status}); ${logPath}`,
            );
        const image = JSON.parse(
            execFileSync('docker', ['image', 'inspect', tag], {
                encoding: 'utf8',
            }),
        )[0];
        images[name] = {
            tag,
            identityType: 'docker-engine-image-id',
            imageId: image.Id,
            sourceCommit: repositories[repo].commit,
            imageRevisionLabel:
                image.Config.Labels?.['org.opencontainers.image.revision'] ||
                null,
        };
    }
    const preview = spawnSync(
        process.execPath,
        [
            '--test',
            ...execFileSync('rg', ['--files', 'test', '-g', '*.test.mjs'], {
                cwd: context('preview'),
                encoding: 'utf8',
            })
                .trim()
                .split('\n'),
        ],
        { cwd: context('preview'), encoding: 'utf8' },
    );
    await writeFile(
        path.join(runDir, 'preview-tests.log'),
        `${preview.stdout}\n${preview.stderr}`,
    );
    if (preview.status !== 0)
        throw new Error('Clean preview source tests failed');
    const result = {
        schemaVersion: 1,
        evidenceType: 'source-and-local-images-only',
        formalLockAccepted: false,
        pending: 'B2 public OCI and preview digests',
        runDir,
        repositories,
        images,
    };
    await writeFile(
        path.join(runtimeDir, 'build-evidence.json'),
        `${JSON.stringify(result, null, 2)}\n`,
    );
    console.log(
        'Clean four-repository verification complete; local images are not registry publication.',
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    await build();
