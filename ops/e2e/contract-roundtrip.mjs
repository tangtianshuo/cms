import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { toContractSnapshot } from '../../backend/dist/release-contract/snapshot.js';

export async function runContractRoundtrip() {
const cmsRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const gatewayRoot = path.resolve(process.env.E2E_GATEWAY_ROOT || path.join(cmsRoot, '../Independent-Website-Gateway'));
const templatesRoot = path.resolve(process.env.E2E_TEMPLATES_ROOT || path.join(cmsRoot, '../Independent-Website-Templates'));

const preset = { id: 'aeroframe', version: '1.0.3', name: 'Demo', description: '', theme: { background: '#010203', foreground: '#ffffff', accent: '#ff3300', muted: '#112233', font: 'Arial, sans-serif' }, demo: { brand: 'Demo' } };
const snapshot = toContractSnapshot({ schemaVersion: 1, workspaceId: 'workspace', siteId: 'site', language: 'en', pages: [
  { path: '/', pageKey: 'home', entryId: 'home-entry', content: { kind: 'preset-page', view: 'home', preset, sections: ['hero'], seo: { title: 'Home', description: '' }, items: [] } },
  { path: '/about', pageKey: 'about', entryId: 'about-entry', content: { kind: 'preset-page', view: 'page', preset, sections: ['story'], seo: { title: 'About', description: '' }, items: [] } },
], navigation: [{ id: 'home', label: 'Home', href: '/', path: '/', children: [], enabled: true }], redirects: [], operations: { seoTitle: 'Demo', seoDescription: '', contactFormEnabled: false } });

const temp = await mkdtemp(path.join(os.tmpdir(), 'cms-contract-'));
const input = path.join(temp, 'snapshot.json');
await writeFile(input, JSON.stringify(snapshot));
const gatewayScript = path.join(temp, 'gateway-check.mjs');
await writeFile(gatewayScript, `import { readFile } from 'node:fs/promises';\nimport { validateContractSnapshotV1 } from ${JSON.stringify(path.join(gatewayRoot, 'packages/contracts/src/release.ts'))};\nconst value = JSON.parse(await readFile(process.argv[2], 'utf8'));\nvalidateContractSnapshotV1(value);\nconsole.log('gateway: valid');\n`);
const gateway = spawnSync(path.join(gatewayRoot, 'node_modules/.bin/vite-node'), [gatewayScript, input], { cwd: gatewayRoot, encoding: 'utf8' });
if (gateway.status !== 0) throw new Error(`gateway contract invalid: status=${gateway.status} error=${gateway.error?.message || ''} stderr=${gateway.stderr || ''} stdout=${gateway.stdout || ''}`);
const templateScript = path.join(temp, 'template-check.mjs');
await writeFile(templateScript, `import { readFile } from 'node:fs/promises';\nimport Ajv from ${JSON.stringify(path.join(templatesRoot, 'node_modules/ajv/dist/ajv.js'))};\nimport addFormats from ${JSON.stringify(path.join(templatesRoot, 'node_modules/ajv-formats/dist/index.js'))};\nimport schema from ${JSON.stringify(path.join(templatesRoot, 'contracts/schema-v1/contract-snapshot.schema.json'))} with { type: 'json' };\nconst value = JSON.parse(await readFile(process.argv[2], 'utf8'));\nconst ajv = new Ajv({ allErrors: true }); addFormats(ajv); const validate = ajv.compile(schema);\nif (!validate(value)) throw new Error(ajv.errorsText(validate.errors));\nconsole.log('templates: valid');\n`);
const templates = spawnSync(process.execPath, [templateScript, input], { cwd: templatesRoot, encoding: 'utf8' });
if (templates.status !== 0) throw new Error(`template contract invalid: ${templates.stderr || templates.stdout}`);
assert.equal(snapshot.template.id, 'aeroframe');
assert.equal(snapshot.pages[1].path, '/about');
console.log('contract roundtrip: CMS -> Gateway -> Templates valid');

}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await runContractRoundtrip();
