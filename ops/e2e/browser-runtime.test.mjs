import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import {
    mkdtemp,
    readFile,
    writeFile,
    mkdir,
    rm,
    access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const enabled = Boolean(
    process.env.E2E_DATABASE_ENV_FILE && process.env.E2E_PREVIEW_ROOT,
);
const root = process.cwd();
const runtime = path.join(root, 'ops/e2e/browser-runtime.mjs');
const npm = path.join(path.dirname(process.execPath), 'npm');
function running(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}
async function until(check, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(50);
    }
    throw new Error('Owned lifecycle probe timed out');
}
async function probe({ phase, mode, startup = false, browser = false }) {
    const directory = await mkdtemp(path.join(tmpdir(), 'b3-process-tree-'));
    const leafPath = path.join(directory, 'grandchild.pid');
    const marker = path.join(directory, 'startup-interruption');
    const control = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        { stdio: 'ignore' },
    );
    let child;
    let leaf;
    let leafGroup;
    let observed = [];
    let observedGroups = [];
    let exited;
    let output = '';
    try {
        await writeFile(
            path.join(directory, 'leaf.mjs'),
            `import {writeFileSync} from 'node:fs';\nprocess.on('SIGTERM', () => {});\nwriteFileSync(${JSON.stringify(leafPath)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
        );
        await writeFile(
            path.join(directory, 'wrapper.mjs'),
            `import {spawn} from 'node:child_process';\nimport {existsSync} from 'node:fs';\nconst child = spawn(process.execPath, [${JSON.stringify(path.join(directory, 'leaf.mjs'))}], {stdio:'ignore'});\nchild.unref();\nconst timer=setInterval(() => {if (existsSync(${JSON.stringify(leafPath)})) {clearInterval(timer); ${mode === 'failure' ? 'process.exit(9);' : 'setInterval(() => {}, 1000);'}}}, 10);\n`,
        );
        await writeFile(
            path.join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                scripts: {
                    'build-only': 'node wrapper.mjs',
                    probe: 'node wrapper.mjs',
                },
            }),
        );
        const env = { ...process.env };
        const args = [];
        if (startup) {
            const preload = path.join(directory, 'interrupt.mjs');
            await writeFile(
                preload,
                `import fs from 'node:fs/promises';\nimport {syncBuiltinESMExports} from 'node:module';\nconst original=fs.writeFile;\nfs.writeFile=async function(file,...args){const value=await original.call(this,file,...args);if(String(file).endsWith('/source-baseline.json')){await original(${JSON.stringify(marker)},'sent');process.kill(process.pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,100));}return value;};\nsyncBuiltinESMExports();\n`,
            );
            args.push('--import', preload, runtime, 'serve');
        } else if (browser) {
            const config = path.join(directory, 'playwright.config.mjs');
            await writeFile(
                config,
                `process.env.PLAYWRIGHT_NO_COPY_PROMPT='1';\nexport default {testDir:${JSON.stringify(directory)},testMatch:'active.spec.mjs',workers:1,timeout:0,reporter:'line',outputDir:${JSON.stringify(path.join(directory, 'results'))},use:{browserName:'chromium',baseURL:process.env.STOREFRONT_E2E_CMS,trace:'off',video:'off',screenshot:'off'}};\n`,
            );
            await writeFile(
                path.join(directory, 'active.spec.mjs'),
                `import {test} from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};\nimport {writeFile} from 'node:fs/promises';\ntest('owned active Chromium',async ({page})=>{await page.goto('/');await writeFile(${JSON.stringify(leafPath)},String(process.pid));await new Promise(()=>{});});\n`,
            );
            await writeFile(
                path.join(directory, 'roundtrip.mjs'),
                `import {spawnSync} from 'node:child_process';\nconst result=spawnSync(process.execPath,[${JSON.stringify(path.join(path.dirname(process.execPath), 'npx'))},'playwright','test','--config',${JSON.stringify(config)}],{stdio:'inherit'});process.exit(result.status??1);\n`,
            );
            args.push(
                runtime,
                'run',
                '--',
                process.execPath,
                path.join(directory, 'roundtrip.mjs'),
            );
        } else if (phase === 'build') {
            const bin = path.join(directory, 'bin');
            await mkdir(bin);
            await writeFile(
                path.join(bin, 'npm'),
                `#!${process.execPath}\nimport {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,[${JSON.stringify(npm)},'--prefix',${JSON.stringify(directory)},'run','build-only'],{stdio:'inherit'});\nchild.on('exit',code=>process.exit(code??1));\n`,
                { mode: 0o700 },
            );
            // The shim delegates to real npm in a disposable test project. It exercises
            // the helper's build launch, without changing the CMS package scripts.
            env.PATH = `${bin}${path.delimiter}${env.PATH}`;
            args.push(runtime, 'serve');
        } else {
            args.push(
                runtime,
                'run',
                '--',
                npm,
                '--prefix',
                directory,
                'run',
                'probe',
            );
        }
        child = spawn(process.execPath, args, {
            cwd: root,
            env,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', (data) => {
            output += data;
        });
        child.stderr.on('data', (data) => {
            output += data;
        });
        exited = new Promise((resolve) =>
            child.once('exit', (code) => resolve(code)),
        );
        await until(async () => {
            try {
                await access(startup ? marker : leafPath);
                return true;
            } catch {
                return false;
            }
        });
        const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], {
            encoding: 'utf8',
        })
            .trim()
            .split('\n')
            .map((row) => row.trim().split(/\s+/).map(Number));
        const owned = new Set([child.pid]);
        let previous;
        do {
            previous = owned.size;
            for (const [pid, parent] of rows)
                if (owned.has(parent)) owned.add(pid);
        } while (owned.size !== previous);
        observed = [...owned];
        observedGroups = [
            ...new Set(
                rows
                    .filter(([pid]) => owned.has(pid))
                    .map(([, , group]) => group),
            ),
        ];
        if (browser)
            assert.ok(
                observedGroups.length >= 5,
                'active Chromium must have its own observed group beyond helper/services/runner',
            );
        if (!startup) {
            leaf = Number(await readFile(leafPath, 'utf8'));
            leafGroup = Number(
                execFileSync('ps', ['-o', 'pgid=', '-p', String(leaf)], {
                    encoding: 'utf8',
                }).trim(),
            );
            assert.equal(
                running(leaf),
                true,
                'grandchild must be alive before shutdown',
            );
            if (mode === 'signal') child.kill('SIGTERM');
        }
        const completed = await Promise.race([
            exited.then((code) => ({ code })),
            delay(8000).then(() => null),
        ]);
        if (!completed) {
            // Old startup code needs a second signal. Always clean our exact probe
            // handle before reporting the failed regression.
            child.kill('SIGTERM');
            await Promise.race([exited, delay(5000)]);
        }
        assert.notEqual(
            completed,
            null,
            'one signal must finish shutdown without a second signal',
        );
        assert.equal(
            completed.code,
            startup || mode === 'signal' ? 0 : phase === 'run' ? 9 : 1,
            'runtime must preserve failure or graceful interruption status',
        );
        if (!startup)
            await until(() => !running(leaf), 3000).catch(() =>
                assert.fail(
                    'owned grandchild remained alive after runtime shutdown',
                ),
            );
        for (const pid of observed) await until(() => !running(pid), 3000);
        assert.equal(
            running(control.pid),
            true,
            'unrelated control process must survive',
        );
        for (const entry of [
            'lease',
            'runtime.env',
            'backend',
            'ui',
            'private',
            'preview',
        ])
            await assert.rejects(
                access(path.join(root, '.e2e/runtime', entry)),
            );
        for (const port of [18088, 18089])
            await assert.rejects(
                fetch(`http://127.0.0.1:${port}/health-check`, {
                    signal: AbortSignal.timeout(500),
                }),
            );
        assert.equal(output.includes('Owned browser processes'), true);
        console.log(
            `lifecycle ${startup ? 'startup/provisioning signal' : `${browser ? 'active-Chromium' : phase}/${mode}`}: helper exited, owned descendants gone, unrelated control alive, private resources/lease removed${browser ? `; ${observed.length} observed owned processes gone` : ''}`,
        );
    } catch (error) {
        // Runtime emits fixed diagnostics; retain only error headings, never env/logs.
        console.log(
            `runtime diagnostic: ${output
                .split('\n')
                .filter((line) =>
                    /^Error:|^Owned browser|^Current-source CMS/.test(line),
                )
                .join(' | ')}`,
        );
        throw error;
    } finally {
        if (child && child.exitCode === null && !child.signalCode) {
            child.kill('SIGTERM');
            await Promise.race([exited, delay(5000)]);
        }
        for (const group of [leafGroup, child?.pid, ...observedGroups])
            if (group) {
                try {
                    process.kill(-group, 'SIGKILL');
                } catch (error) {
                    if (error.code !== 'ESRCH') throw error;
                }
            }
        if (leaf && running(leaf)) process.kill(leaf, 'SIGKILL');
        control.kill('SIGKILL');
        await rm(directory, { recursive: true, force: true });
    }
}

test(
    'run cleanup kills a grandchild after its npm wrapper exits with failure',
    { skip: !enabled, timeout: 60000 },
    () => probe({ phase: 'run', mode: 'failure' }),
);
test(
    'SIGTERM during an active run kills its command descendants and preserves an unrelated process',
    { skip: !enabled, timeout: 60000 },
    () => probe({ phase: 'run', mode: 'signal' }),
);
test(
    'build cleanup kills a grandchild after the npm build wrapper exits with failure',
    { skip: !enabled, timeout: 60000 },
    () => probe({ phase: 'build', mode: 'failure' }),
);
test(
    'SIGTERM during an active npm build kills its descendants and preserves an unrelated process',
    { skip: !enabled, timeout: 60000 },
    () => probe({ phase: 'build', mode: 'signal' }),
);
test(
    'a provisioning signal received before the serve waiter completes shutdown once',
    { skip: !enabled, timeout: 60000 },
    () => probe({ startup: true }),
);

test(
    'SIGTERM during an active roundtrip/npx/Chromium chain removes every observed owned process',
    { skip: !enabled, timeout: 60000 },
    () => probe({ phase: 'run', mode: 'signal', browser: true }),
);
