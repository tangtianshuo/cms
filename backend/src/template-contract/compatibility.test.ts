import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTemplateCompatibility, createLegacyEditorAdapter, createMigrationPlan, type TemplateInstallation } from './compatibility';
import { readTemplateContract } from './registry';

const editor = {
    schemaVersion: 1 as const,
    models: [{ modelKey: 'article', fields: [{ key: 'title', label: 'Title', control: 'text' as const }] }],
    pages: [{ pageKey: 'home', modelKey: 'article', pathRule: { type: 'fixed' as const, value: '/' }, allowNavigation: true, sections: ['hero'] }],
    sections: [{ type: 'hero', label: 'Hero', allowedPages: ['home'], singleton: true, required: true, props: {} }],
    operations: { canCreatePages: true, canEditNavigation: true, canPublish: true },
};
const renderer = { contractVersion: 1 as const, templateId: 'custom', templateVersion: '1.1.0', preview: { protocolVersion: 1 as const, capabilities: ['draft'] }, assets: { mode: 'published' as const, basePath: '/_assets/' } };
const compatibility = { cmsSchema: 1 as const, releaseSchema: 1 as const, migrations: [{ from: 'custom@1.0.0', to: 'custom@1.1.0', steps: [{ op: 'rename-field', from: 'headline', to: 'title' }] }] };

function manifest(extra: Record<string, unknown> = {}) {
    return { id: 'custom', version: '1.1.0', editor, renderer, compatibility, ...extra };
}

test('installs a template contract only when editor and renderer identities are complete', () => {
    const installed = readTemplateContract(manifest(), { id: 'custom', version: '1.1.0', manifestChecksum: 'sha256:manifest', sourceCommit: 'a'.repeat(40) });
    assert.equal(installed.renderer.templateId, 'custom');
    assert.equal(installed.renderer.templateVersion, '1.1.0');
});

test('rejects a contract missing renderer identity', () => {
    assert.throws(() => readTemplateContract(manifest({ renderer: undefined }), { id: 'custom', version: '1.1.0', manifestChecksum: 'sha256:manifest', sourceCommit: 'a'.repeat(40) }), /renderer contract/i);
});

test('classifies same-version, migration and incompatible template changes', () => {
    const current: TemplateInstallation = { id: 'custom', version: '1.0.0' };
    assert.equal(classifyTemplateCompatibility(current, { id: 'custom', version: '1.0.0' }), 'data-compatible');
    assert.equal(classifyTemplateCompatibility(current, { id: 'custom', version: '1.1.0', compatibility }), 'migration-required');
    assert.equal(classifyTemplateCompatibility(current, { id: 'other', version: '1.0.0' }), 'incompatible');
});

test('creates a migration plan without mutating the installed site', () => {
    const current = { id: 'custom', version: '1.0.0', siteConfig: { theme: 'dark' } };
    const requested = { id: 'custom', version: '1.1.0', compatibility };
    const plan = createMigrationPlan(current, requested);
    assert.deepEqual(plan, { from: 'custom@1.0.0', to: 'custom@1.1.0', steps: [{ op: 'rename-field', from: 'headline', to: 'title' }] });
    assert.deepEqual(current.siteConfig, { theme: 'dark' });
});

test('generates a legacy editor adapter and records its source', () => {
    const result = createLegacyEditorAdapter({ id: 'legacy', version: '1.0.0', models: [{ key: 'article', label: 'Article', fields: [{ key: 'title', label: 'Title', type: 'STRING', required: true, array: false }] }], pages: [] });
    assert.equal(result.source, 'legacy-model-fields');
    assert.equal(result.contract.schemaVersion, 1);
    assert.equal(result.contract.models[0].fields[0].key, 'title');
});
