import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/storefront/gateway-publication.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizePublishStatus } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('normalizes gateway operation states into the CMS publish lifecycle', () => {
    assert.equal(normalizePublishStatus('pending'), 'publishing');
    assert.equal(normalizePublishStatus('ready'), 'ready');
    assert.equal(normalizePublishStatus('failed'), 'failed');
    assert.equal(normalizePublishStatus('ready', 'rollback'), 'rolled-back');
    assert.equal(normalizePublishStatus('unknown'), 'draft');
});
