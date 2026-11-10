#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cmsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectsRoot = dirname(cmsRoot);
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const defaultProjects = ['cms', 'gateway', 'templates', 'preview'];
const aliases = new Map([
    ['cms', 'cms'],
    ['gateway', 'gateway'],
    ['template', 'templates'],
    ['templates', 'templates'],
    ['preview', 'preview'],
]);

function git(root, args, { allowFailure = false } = {}) {
    try {
        return execFileSync('git', ['-C', root, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    } catch (error) {
        if (allowFailure) return '';
        const detail = error.stderr?.toString().trim();
        throw new Error(
            `git ${args.join(' ')} failed in ${root}${detail ? `: ${detail}` : ''}`,
        );
    }
}

function normalizeProject(value) {
    const project = aliases.get(String(value).toLowerCase());
    if (!project) throw new Error(`Unknown project: ${value}`);
    return project;
}

export function parsePublishArgs(argv) {
    const projects = [];
    let execute = false;
    let dryRun = false;
    let json = false;
    let bump = 'patch';
    let version;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--execute') execute = true;
        else if (argument === '--dry-run') dryRun = true;
        else if (argument === '--json') json = true;
        else if (argument === '--help' || argument === '-h') {
            return { help: true };
        } else if (argument === '--bump' || argument.startsWith('--bump=')) {
            bump = argument.includes('=')
                ? argument.slice(argument.indexOf('=') + 1)
                : argv[++index];
            if (!['patch', 'minor', 'major'].includes(bump)) {
                throw new Error('--bump must be patch, minor, or major');
            }
        } else if (
            argument === '--version' ||
            argument.startsWith('--version=')
        ) {
            version = argument.includes('=')
                ? argument.slice(argument.indexOf('=') + 1)
                : argv[++index];
            if (!semver.test(version || '')) {
                throw new Error('--version must be a semantic version');
            }
        } else if (argument.startsWith('-')) {
            throw new Error(`Unknown option: ${argument}`);
        } else {
            for (const item of argument.split(',')) {
                if (item.trim()) projects.push(normalizeProject(item.trim()));
            }
        }
    }
    if (execute && dryRun) {
        throw new Error('--execute and --dry-run cannot be used together');
    }
    const selected = [...new Set(projects.length ? projects : defaultProjects)];
    if (version && selected.length !== 1) {
        throw new Error('--version can only target one project');
    }
    return { projects: selected, execute, dryRun, json, bump, version };
}

function parseVersion(value) {
    const match = semver.exec(value || '');
    return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
}

export function nextVersion(current, bump = 'patch') {
    const parsed = current ? parseVersion(current) : [1, 0, 0];
    if (!parsed) throw new Error(`Invalid release version: ${current}`);
    if (!current) return '1.0.0';
    if (bump === 'major') return `${parsed[0] + 1}.0.0`;
    if (bump === 'minor') return `${parsed[0]}.${parsed[1] + 1}.0`;
    if (bump === 'patch') return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`;
    throw new Error(`Unknown version bump: ${bump}`);
}

function projectDefinitions(overrides = {}) {
    return {
        cms: {
            label: 'CMS',
            root: resolve(
                overrides.cms || process.env.CMS_RELEASE_ROOT || cmsRoot,
            ),
            defaultBranch: 'master',
        },
        gateway: {
            label: 'Gateway',
            root: resolve(
                overrides.gateway ||
                    process.env.GATEWAY_RELEASE_ROOT ||
                    join(projectsRoot, 'Independent-Website-Gateway'),
            ),
            defaultBranch: 'master',
        },
        templates: {
            label: 'Templates',
            root: resolve(
                overrides.templates ||
                    process.env.TEMPLATES_RELEASE_ROOT ||
                    join(projectsRoot, 'Independent-Website-Templates'),
            ),
            defaultBranch: 'master',
        },
        preview: {
            label: 'Preview',
            root: resolve(
                overrides.preview ||
                    process.env.PREVIEW_RELEASE_ROOT ||
                    join(projectsRoot, 'Independent-Website-Preview'),
            ),
            defaultBranch: 'main',
        },
    };
}

function remoteWebUrl(root) {
    const remote = git(root, ['remote', 'get-url', 'origin'], {
        allowFailure: true,
    });
    const match =
        /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remote) ||
        /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
    return match ? `https://github.com/${match[1]}/${match[2]}` : '';
}

function releaseBranches(root) {
    return git(
        root,
        [
            'for-each-ref',
            '--format=%(refname:short)',
            'refs/remotes/origin/release/v*',
        ],
        { allowFailure: true },
    )
        .split('\n')
        .filter(Boolean)
        .flatMap((ref) => {
            const version = ref.replace(/^origin\/release\/v/, '');
            return semver.test(version) ? [{ ref, version }] : [];
        })
        .sort((left, right) =>
            compareVersions(
                parseVersion(left.version),
                parseVersion(right.version),
            ),
        );
}

function remoteBranch(root, branch) {
    return git(root, ['rev-parse', `refs/remotes/origin/${branch}`], {
        allowFailure: true,
    });
}

async function walkFiles(root, current = root) {
    const result = [];
    for (const entry of await readdir(current, { withFileTypes: true })) {
        if (
            entry.name === 'node_modules' ||
            entry.name === '.nuxt' ||
            entry.name === '.output'
        )
            continue;
        const absolute = join(current, entry.name);
        if (entry.isDirectory())
            result.push(...(await walkFiles(root, absolute)));
        else if (entry.isFile()) result.push(relative(root, absolute));
    }
    return result;
}

async function planTemplateVersion(root, { bump, version }) {
    const target = JSON.parse(
        await readFile(join(root, 'release-target.json'), 'utf8'),
    );
    if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.id || '') ||
        !semver.test(target.version || '')
    ) {
        throw new Error('release-target.json has an invalid template identity');
    }
    if (version) return version;
    if (!remoteBranch(root, `release/v${target.version}`)) {
        return target.version;
    }
    return nextVersion(target.version, bump);
}

async function bumpTemplate(root, { bump, version }) {
    const targetPath = join(root, 'release-target.json');
    const target = JSON.parse(await readFile(targetPath, 'utf8'));
    if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.id || '') ||
        !semver.test(target.version || '')
    ) {
        throw new Error('release-target.json has an invalid template identity');
    }
    let next = version;
    if (!next) {
        if (!remoteBranch(root, `release/v${target.version}`)) {
            return { id: target.id, version: target.version, changed: false };
        }
        next = nextVersion(target.version, bump);
    }
    if (next === target.version) {
        return { id: target.id, version: next, changed: false };
    }
    const source = join(root, 'templates', target.id, target.version);
    const destination = join(root, 'templates', target.id, next);
    if (!existsSync(source)) {
        throw new Error(`Template source does not exist: ${source}`);
    }
    if (existsSync(destination)) {
        throw new Error(`Template destination already exists: ${destination}`);
    }
    await cp(source, destination, {
        recursive: true,
        filter: (path) =>
            !['node_modules', '.nuxt', '.output'].includes(
                path.split('/').at(-1),
            ),
    });

    const textExtensions = new Set([
        '.md',
        '.mjs',
        '.js',
        '.ts',
        '.vue',
        '.css',
        '.html',
    ]);
    for (const file of await walkFiles(destination)) {
        const absolute = join(destination, file);
        const extension = extname(file);
        if (file === 'template.json') {
            const manifest = JSON.parse(await readFile(absolute, 'utf8'));
            manifest.version = next;
            if (manifest.renderer?.templateVersion === target.version) {
                manifest.renderer.templateVersion = next;
            }
            await writeFile(absolute, `${JSON.stringify(manifest, null, 2)}\n`);
        } else if (file === 'storefront/package.json') {
            const packageJson = JSON.parse(await readFile(absolute, 'utf8'));
            packageJson.version = next;
            await writeFile(
                absolute,
                `${JSON.stringify(packageJson, null, 2)}\n`,
            );
        } else if (file === 'storefront/package-lock.json') {
            const lock = JSON.parse(await readFile(absolute, 'utf8'));
            lock.version = next;
            if (lock.packages?.['']) lock.packages[''].version = next;
            await writeFile(absolute, `${JSON.stringify(lock, null, 2)}\n`);
        } else if (textExtensions.has(extension)) {
            const content = await readFile(absolute, 'utf8');
            const rewritten = content.replaceAll(target.version, next);
            if (rewritten !== content) await writeFile(absolute, rewritten);
        }
    }

    await writeFile(
        targetPath,
        `${JSON.stringify({ ...target, version: next }, null, 2)}\n`,
    );
    const packagePath = join(root, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    packageJson.scripts ||= {};
    packageJson.scripts.validate = `node scripts/validate.mjs templates/${target.id}/${next}/template.json`;
    packageJson.scripts[`validate:${target.id}:${next}`] =
        `node scripts/validate.mjs templates/${target.id}/${next}/template.json`;
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const intakePath = join(root, 'test/intake-client.test.mjs');
    if (existsSync(intakePath)) {
        const intake = await readFile(intakePath, 'utf8');
        const nextIntake = intake.replace(
            new RegExp(
                `(['"])${target.id}\\1,\\s*(['"])${target.version.replaceAll('.', '\\.')}\\2`,
            ),
            `$1${target.id}$1, $2${next}$2`,
        );
        if (nextIntake !== intake) await writeFile(intakePath, nextIntake);
    }
    const validatePath = join(root, 'test/validate.test.mjs');
    if (existsSync(validatePath)) {
        const validate = await readFile(validatePath, 'utf8');
        const line = `../templates/${target.id}/${target.version}/template.json`;
        const nextLine = `../templates/${target.id}/${next}/template.json`;
        if (validate.includes(line) && !validate.includes(nextLine)) {
            const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = new RegExp(`^(\\s*)'${escaped}',?$`, 'm').exec(
                validate,
            );
            if (match) {
                const nextValidate = validate.replace(
                    match[0],
                    `${match[1]}'${line}',\n${match[1]}'${nextLine}',`,
                );
                await writeFile(validatePath, nextValidate);
            }
        }
    }
    git(root, ['add', '--', 'release-target.json', 'package.json', 'test']);
    git(root, ['add', '--', `templates/${target.id}/${next}`]);
    git(root, ['commit', '-m', `release: add ${target.id} ${next} candidate`]);
    git(root, ['push', 'origin', 'HEAD']);
    return {
        id: target.id,
        version: next,
        changed: true,
        commit: git(root, ['rev-parse', 'HEAD']),
    };
}

export async function publishProjects({
    projects = defaultProjects,
    roots = {},
    execute = false,
    bump = 'patch',
    version,
} = {}) {
    const definitions = projectDefinitions(roots);
    const results = [];
    for (const name of projects) {
        const project = definitions[name];
        try {
            if (!project?.root || !existsSync(project.root)) {
                throw new Error('Repository path does not exist');
            }
            git(project.root, ['fetch', 'origin', '--prune', '--tags']);
            const currentBranch = git(project.root, [
                'branch',
                '--show-current',
            ]);
            if (currentBranch !== project.defaultBranch) {
                throw new Error(
                    `Worktree must be on ${project.defaultBranch}, currently ${currentBranch || 'detached HEAD'}`,
                );
            }
            const dirty = git(project.root, [
                'status',
                '--porcelain',
                '--untracked-files=no',
            ]);
            if (dirty) throw new Error('Worktree has uncommitted changes');
            const local = git(project.root, ['rev-parse', 'HEAD']);
            const remote = git(project.root, [
                'rev-parse',
                `refs/remotes/origin/${project.defaultBranch}`,
            ]);
            if (local !== remote) {
                throw new Error(
                    `Local ${project.defaultBranch} is not synchronized with origin; push or fast-forward first`,
                );
            }
            const releases = releaseBranches(project.root);
            const latest = releases.at(-1);
            const changed = latest
                ? Number(
                      git(project.root, [
                          'rev-list',
                          '--count',
                          `${latest.ref}..refs/remotes/origin/${project.defaultBranch}`,
                      ]),
                  ) > 0
                : Number(
                      git(project.root, [
                          'rev-list',
                          '--count',
                          `refs/remotes/origin/${project.defaultBranch}`,
                      ]),
                  ) > 0;
            if (!changed) {
                results.push({
                    project: name,
                    label: project.label,
                    status: 'unchanged',
                    currentVersion: latest?.version || null,
                });
                continue;
            }
            let targetVersion;
            let commit = local;
            if (name === 'templates') {
                if (execute) {
                    const candidate = await bumpTemplate(project.root, {
                        bump,
                        version,
                    });
                    targetVersion = candidate.version;
                    commit = candidate.commit || commit;
                } else {
                    targetVersion = await planTemplateVersion(project.root, {
                        bump,
                        version,
                    });
                }
            } else {
                targetVersion = version || nextVersion(latest?.version, bump);
            }
            const branch = `release/v${targetVersion}`;
            const remoteBranch = `refs/remotes/origin/${branch}`;
            const existing = git(project.root, ['rev-parse', remoteBranch], {
                allowFailure: true,
            });
            if (existing && existing !== commit) {
                throw new Error(`${branch} already exists for another commit`);
            }
            if (!execute) {
                results.push({
                    project: name,
                    label: project.label,
                    status: 'update-available',
                    currentVersion: latest?.version || null,
                    version: targetVersion,
                    branch,
                    commit,
                    actionUrl: remoteWebUrl(project.root),
                });
                continue;
            }
            if (existing === commit) {
                results.push({
                    project: name,
                    label: project.label,
                    status: 'already-published',
                    currentVersion: latest?.version || null,
                    version: targetVersion,
                    branch,
                    commit,
                    actionUrl: remoteWebUrl(project.root),
                });
                continue;
            }
            git(project.root, [
                'push',
                'origin',
                `${commit}:refs/heads/${branch}`,
            ]);
            results.push({
                project: name,
                label: project.label,
                status: 'published',
                currentVersion: latest?.version || null,
                version: targetVersion,
                branch,
                commit,
                actionUrl: `${remoteWebUrl(project.root)}/actions?query=branch%3A${encodeURIComponent(branch)}`,
            });
        } catch (cause) {
            results.push({
                project: name,
                label: project?.label || name,
                status: 'blocked',
                reason: cause instanceof Error ? cause.message : String(cause),
            });
        }
    }
    return results;
}

function printHelp() {
    console.log(`Usage:
  node ops/release/publish.mjs [projects] [options]

Projects: cms, gateway, template|templates, preview (default: all)
Options:
  --execute         Create and push release branches
  --dry-run         Explicitly only inspect updates (default)
  --bump patch      Version bump: patch (default), minor, major
  --version X.Y.Z   Exact version for one selected project
  --json            Print machine-readable results
  --help            Show this help`);
}

function printResults(results, json) {
    if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }
    for (const result of results) {
        if (result.status === 'unchanged') {
            console.log(
                `${result.label}: no updates since ${result.currentVersion || 'no release'}`,
            );
        } else if (result.status === 'update-available') {
            console.log(
                `${result.label}: ${result.currentVersion || 'no release'} -> v${result.version} (${result.branch})`,
            );
        } else if (result.status === 'published') {
            console.log(
                `${result.label}: published v${result.version} to ${result.branch}`,
            );
            if (result.actionUrl) console.log(`  Actions: ${result.actionUrl}`);
        } else if (result.status === 'already-published') {
            console.log(
                `${result.label}: ${result.branch} already points to ${result.commit}`,
            );
        } else {
            console.log(`${result.label}: blocked - ${result.reason}`);
        }
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const options = parsePublishArgs(process.argv.slice(2));
        if (options.help) {
            printHelp();
        } else {
            const results = await publishProjects(options);
            printResults(results, options.json);
            if (results.some((result) => result.status === 'blocked')) {
                process.exitCode = 1;
            }
        }
    } catch (cause) {
        console.error(cause instanceof Error ? cause.message : String(cause));
        process.exitCode = 1;
    }
}
