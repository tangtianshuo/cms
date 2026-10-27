import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const code = ts.transpileModule(await readFile(new URL('../src/components/storefront/gateway-publication.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createPublicationAction } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
test('lost publish response survives component reload and keeps the same request identity', () => {
 const saved=storage(); let sequence=0;
 const first=createPublicationAction(saved, 'workspace/site', () => `request-${++sequence}`);
 const request=first.request();
 const reloaded=createPublicationAction(saved, 'workspace/site', () => `request-${++sequence}`);
 assert.equal(reloaded.request(),request);
 assert.equal(sequence,1);
 reloaded.complete('pending',request);
 assert.equal(reloaded.request(),request);
 reloaded.complete('ready',request);
 assert.notEqual(reloaded.request(),request);
});
test('publishing another site cannot reuse or clear the first site request', () => {
 const saved=storage(); let sequence=0; const uuid=()=>`request-${++sequence}`;
 const first=createPublicationAction(saved,'workspace/site-a',uuid);
 const second=createPublicationAction(saved,'workspace/site-b',uuid);
 const a=first.request(),b=second.request(); assert.notEqual(a,b);
 second.complete('failed',b); assert.equal(first.request(),a); assert.notEqual(second.request(),b);
});

test('a prior completed operation cannot clear a newer uncertain publish request', () => {
 const saved=storage(); let seq=0;
 const action=createPublicationAction(saved,'site',()=>`request-${++seq}`);
 const current=action.request(); action.complete('ready','older-request');
 assert.equal(action.request(),current);
});
