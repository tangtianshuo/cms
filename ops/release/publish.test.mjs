import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nextVersion, parsePublishArgs, publishProjects } from './publish.mjs';

const git = (cwd, ...args) =>
    execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

async function repository(
    root,
    name,
    { defaultBranch = 'master', releasedAt = 'initial' } = {},
) {
    const remote = join(root, `${name}.git`);
    const work = join(root, name);
    execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], {
        stdio: 'ignore',
    });
    execFileSync('git', ['init', '--initial-branch', defaultBranch, work], {
        stdio: 'ignore',
    });
    git(work, 'config', 'user.name', 'Release Test');
    git(work, 'config', 'user.email', 'release-test@example.invalid');
    await writeFile(join(work, 'README.md'), '# fixture\n');
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'initial');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'push', '-u', 'origin', defaultBranch);
    if (releasedAt) {
        git(work, 'branch', `release/v${releasedAt}`);
        git(work, 'push', 'origin', `release/v${releasedAt}`);
    }
    return { remote, work };
}

async function advance(root, repo, name) {
    await writeFile(join(repo.work, `${name}.txt`), `${name}\n`);
    git(repo.work, 'add', '.');
    git(repo.work, 'commit', '-m', `${name} update`);
    git(repo.work, 'push', 'origin', 'HEAD');
}

async function remoteBranches(remote) {
    return git(
        remote,
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads/',
    )
        .split('\n')
        .filter(Boolean);
}

test('release arguments default to all projects and accept a focused project', () => {
    assert.deepEqual(parsePublishArgs([]).projects, [
        'cms',
        'gateway',
        'templates',
        'preview',
    ]);
    assert.equal(parsePublishArgs([]).execute, false);
    assert.deepEqual(parsePublishArgs(['gateway', '--execute']).projects, [
        'gateway',
    ]);
    assert.equal(parsePublishArgs(['gateway', '--execute']).execute, true);
    assert.deepEqual(parsePublishArgs(['template']).projects, ['templates']);
    assert.throws(() => parsePublishArgs(['unknown']), /unknown project/i);
    assert.throws(
        () => parsePublishArgs(['cms', 'gateway', '--version', '2.0.0']),
        /one project/i,
    );
});

test('release versions advance from the highest published version', () => {
    assert.equal(nextVersion('1.4.9', 'patch'), '1.4.10');
    assert.equal(nextVersion('1.4.9', 'minor'), '1.5.0');
    assert.equal(nextVersion('1.4.9', 'major'), '2.0.0');
    assert.equal(nextVersion(undefined, 'patch'), '1.0.0');
});

test('publishing skips unchanged projects and pushes only selected updates', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'cms-release-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cms = await repository(root, 'cms', { releasedAt: '1.2.1' });
    const gateway = await repository(root, 'gateway', { releasedAt: '1.1.0' });
    await advance(root, gateway, 'gateway-change');

    const untouched = await publishProjects({
        projects: ['cms'],
        roots: { cms: cms.work },
    });
    assert.equal(untouched[0].status, 'unchanged');
    assert.deepEqual(await remoteBranches(cms.remote), [
        'master',
        'release/v1.2.1',
    ]);

    const published = await publishProjects({
        projects: ['gateway'],
        roots: { gateway: gateway.work },
        execute: true,
    });
    assert.equal(published[0].status, 'published');
    assert.equal(published[0].version, '1.1.1');
    assert.ok(
        (await remoteBranches(gateway.remote)).includes('release/v1.1.1'),
    );
});

test('publishing refuses local default-branch changes that are not pushed', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'cms-release-dirty-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cms = await repository(root, 'cms', { releasedAt: '1.2.1' });
    await writeFile(join(cms.work, 'local-only.txt'), 'local\n');
    git(cms.work, 'add', '.');
    git(cms.work, 'commit', '-m', 'local only');

    const result = await publishProjects({
        projects: ['cms'],
        roots: { cms: cms.work },
        execute: true,
    });
    assert.equal(result[0].status, 'blocked');
    assert.match(result[0].reason, /not pushed|synchronized/i);
    assert.deepEqual(await remoteBranches(cms.remote), [
        'master',
        'release/v1.2.1',
    ]);
});

test('template updates create a new immutable template version before publishing', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'cms-template-release-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const templates = await repository(root, 'templates', { releasedAt: null });
    const versionRoot = join(templates.work, 'templates/aeroframe/1.0.0');
    const storefront = join(versionRoot, 'storefront');
    await mkdir(join(storefront, 'pages'), { recursive: true });
    await mkdir(join(storefront, 'shared'), { recursive: true });
    await mkdir(join(storefront, 'test'), { recursive: true });
    await writeFile(
        join(versionRoot, 'template.json'),
        `${JSON.stringify(
            {
                id: 'aeroframe',
                version: '1.0.0',
                renderer: { templateId: 'aeroframe', templateVersion: '1.0.0' },
            },
            null,
            2,
        )}\n`,
    );
    await writeFile(
        join(versionRoot, 'ADOPTION.md'),
        '# aeroframe 1.0.0 adoption\n',
    );
    await writeFile(
        join(storefront, 'package.json'),
        `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
    );
    await writeFile(
        join(storefront, 'package-lock.json'),
        `${JSON.stringify(
            {
                name: 'fixture',
                version: '1.0.0',
                packages: { '': { name: 'fixture', version: '1.0.0' } },
            },
            null,
            2,
        )}\n`,
    );
    await writeFile(
        join(storefront, 'pages/preview.vue'),
        "const version = '1.0.0';\n",
    );
    await writeFile(
        join(storefront, 'shared/snapshot.mjs'),
        "export const expected = '1.0.0';\n",
    );
    await writeFile(
        join(storefront, 'test/preview.test.mjs'),
        "assert.equal(version, '1.0.0');\n",
    );
    await writeFile(
        join(templates.work, 'release-target.json'),
        `${JSON.stringify({ id: 'aeroframe', version: '1.0.0' })}\n`,
    );
    await writeFile(
        join(templates.work, 'package.json'),
        `${JSON.stringify(
            {
                name: 'templates',
                scripts: {
                    validate:
                        'node scripts/validate.mjs templates/aeroframe/1.0.0/template.json',
                },
            },
            null,
            2,
        )}\n`,
    );
    await mkdir(join(templates.work, 'test'), { recursive: true });
    await writeFile(
        join(templates.work, 'test/intake-client.test.mjs'),
        "const templates = [['aeroframe', '1.0.0']];\n",
    );
    await writeFile(
        join(templates.work, 'test/validate.test.mjs'),
        "const manifests = [\n  '../templates/aeroframe/1.0.0/template.json',\n];\n",
    );
    git(templates.work, 'add', '.');
    git(templates.work, 'commit', '-m', 'add template baseline');
    git(templates.work, 'push', 'origin', 'master');
    git(templates.work, 'branch', 'release/v1.0.0');
    git(templates.work, 'push', 'origin', 'release/v1.0.0');

    await writeFile(
        join(versionRoot, 'ADOPTION.md'),
        '# aeroframe 1.0.0 adoption\n\nChanged renderer behavior.\n',
    );
    git(templates.work, 'add', '.');
    git(templates.work, 'commit', '-m', 'change template renderer');
    git(templates.work, 'push', 'origin', 'master');

    const baselineHead = git(templates.work, 'rev-parse', 'HEAD');
    const [plan] = await publishProjects({
        projects: ['templates'],
        roots: { templates: templates.work },
    });
    assert.equal(plan.status, 'update-available');
    assert.equal(plan.version, '1.0.1');
    assert.equal(git(templates.work, 'rev-parse', 'HEAD'), baselineHead);

    const [result] = await publishProjects({
        projects: ['templates'],
        roots: { templates: templates.work },
        execute: true,
    });
    assert.equal(result.status, 'published');
    assert.equal(result.version, '1.0.1');
    assert.ok(
        (await remoteBranches(templates.remote)).includes('release/v1.0.1'),
    );
    assert.deepEqual(
        JSON.parse(
            await readFile(join(templates.work, 'release-target.json'), 'utf8'),
        ),
        { id: 'aeroframe', version: '1.0.1' },
    );
    const nextManifest = JSON.parse(
        await readFile(
            join(templates.work, 'templates/aeroframe/1.0.1/template.json'),
            'utf8',
        ),
    );
    assert.equal(nextManifest.version, '1.0.1');
    assert.equal(nextManifest.renderer.templateVersion, '1.0.1');
    assert.match(
        await readFile(
            join(templates.work, 'templates/aeroframe/1.0.0/ADOPTION.md'),
            'utf8',
        ),
        /Changed renderer behavior/,
    );
});
