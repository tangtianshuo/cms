import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/views/dashboard/leads-state.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('builds status and search filters for the CMS API', () => {
    assert.equal(helpers.buildLeadsQuery('new', ' Alice '), 'status=new&search=Alice');
    assert.equal(helpers.buildLeadsQuery('', ''), '');
});

test('keeps lead update payload explicit', () => {
    assert.deepEqual(helpers.leadUpdatePayload({ status: 'contacted', notes: undefined }), { status: 'contacted' });
});

test('distinguishes loading, error, empty and ready states', () => {
    assert.equal(helpers.leadViewState({ loading: true, error: '', count: 0 }), 'loading');
    assert.equal(helpers.leadViewState({ loading: false, error: 'down', count: 0 }), 'error');
    assert.equal(helpers.leadViewState({ loading: false, error: '', count: 0 }), 'empty');
    assert.equal(helpers.leadViewState({ loading: false, error: '', count: 1 }), 'ready');
});
