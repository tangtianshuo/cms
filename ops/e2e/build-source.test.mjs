import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { snapshotCommit } from './build.mjs';
test('build context contains committed bytes only, with exact source identity', async () => {
    const dir = await mkdtemp(
        path.join(process.cwd(), '.superpowers/build-test-'),
    );
    const git = (args) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    try {
        git(['init', '-q']);
        git(['config', 'user.email', 'test@invalid']);
        git(['config', 'user.name', 'Test']);
        await writeFile(path.join(dir, 'source'), 'committed');
        git(['add', 'source']);
        git(['commit', '-qm', 'fixture']);
        const sha = git(['rev-parse', 'HEAD']);
        await writeFile(path.join(dir, 'source'), 'dirty');
        await writeFile(path.join(dir, '.env'), 'secret');
        const out = path.join(dir, 'context');
        const identity = await snapshotCommit(dir, out);
        assert.equal(identity.commit, sha);
        assert.equal(
            await readFile(path.join(out, 'source'), 'utf8'),
            'committed',
        );
        await assert.rejects(readFile(path.join(out, '.env')), {
            code: 'ENOENT',
        });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
