import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import * as runtime from './runtime.mjs';

test('retained runtime checks certificate expiry and fails with fresh-directory instructions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'a4-certificate-'));
    const script = fileURLToPath(new URL('./runtime.mjs', import.meta.url));
    const env = { ...process.env, E2E_RUNTIME_DIR: directory };
    try {
        execFileSync(process.execPath, [script, 'init'], {
            env,
            stdio: 'pipe',
        });
        const originalEnv = await readFile(path.join(directory, 'runtime.env'));
        const certificateBytes = await readFile(
            path.join(directory, 'tls/cert.pem'),
        );
        const certificate = new X509Certificate(certificateBytes);
        await runtime.assertRuntimeCertificateValid(directory);
        await assert.rejects(
            runtime.assertRuntimeCertificateValid(
                directory,
                Date.parse(certificate.validTo) + 1,
            ),
            /certificate.*expired.*E2E_RUNTIME_DIR.*unused/i,
        );
        execFileSync(process.execPath, [script, 'init'], {
            env,
            stdio: 'pipe',
        });
        assert.deepEqual(
            await readFile(path.join(directory, 'tls/cert.pem')),
            certificateBytes,
        );
        await unlink(path.join(directory, 'tls/cert.pem'));
        const result = spawnSync(process.execPath, [script, 'init'], {
            env,
            encoding: 'utf8',
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /E2E_RUNTIME_DIR.*unused/i);
        assert.deepEqual(
            await readFile(path.join(directory, 'runtime.env')),
            originalEnv,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
