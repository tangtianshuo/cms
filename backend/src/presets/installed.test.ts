import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { getPreset } from './catalog';
import { resolveInstalledPreset } from './installed';
import { canonicalJson } from './registry';
import type { SiteInstallation } from './site-model';

function site(changes: Partial<SiteInstallation> = {}): SiteInstallation {
    const preset = getPreset('atelier', '1.0.0')!;
    return { _id: 'site', createdAt: 1, updatedAt: 1, slot: 'default', name: 'Site', presetId: 'atelier',
        presetVersion: '1.0.0', status: 'ready', importError: '', includeDemo: false, demoSeeded: false,
        theme: preset.theme, models: [], pages: [], ...changes };
}

test('installed public snapshots remain authoritative after builtin catalog versions change', () => {
    const snapshot = { ...getPreset('atelier', '1.0.0')!, name: 'Persisted template name' };
    const result = resolveInstalledPreset(site({ presetManifestSnapshot: JSON.stringify(snapshot) }));
    assert.equal(result.name, 'Persisted template name');
});

test('Mongo null metadata on a builtin installation uses its catalog version', () => {
    const result = resolveInstalledPreset(site({
        presetManifestSnapshot: null as never,
        publishedTemplateRecord: null as never,
    }));
    assert.equal(result.id, 'atelier');
    assert.equal(result.version, '1.0.0');
});

test('a missing or mismatched imported snapshot fails closed', () => {
    const publicRecord = { schemaVersion: 1, id: 'aeroframe', version: '1.0.1', manifestChecksum: `sha256:${'a'.repeat(64)}`,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe', imageDigest: `sha256:${'b'.repeat(64)}`,
        sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.1/template.json', status: 'available' };
    const installed = site({ presetId: 'aeroframe', presetVersion: '1.0.1', publishedTemplateRecord: JSON.stringify(publicRecord) });
    assert.throws(() => resolveInstalledPreset(installed), /snapshot is missing/i);
    assert.throws(() => resolveInstalledPreset({ ...installed, presetManifestSnapshot: null as never }), /snapshot is missing/i);
    assert.throws(() => resolveInstalledPreset({ ...installed, presetManifestSnapshot: 'invalid-json' }), /snapshot is invalid/i);
    assert.throws(() => resolveInstalledPreset({ ...installed, presetManifestSnapshot: JSON.stringify({
        ...getPreset('aeroframe', '1.0.0')!, version: '1.0.0',
    }) }), /does not match/i);
});

test('a public snapshot with a valid shape but changed content fails checksum validation', () => {
    const original = getPreset('aeroframe', '1.0.0')!;
    const snapshot = JSON.parse(JSON.stringify(original));
    const checksum = `sha256:${createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex')}`;
    const record = { schemaVersion: 1, id: 'aeroframe', version: '1.0.0', manifestChecksum: checksum,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe', imageDigest: `sha256:${'b'.repeat(64)}`,
        sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.0/template.json', status: 'available' as const };
    const tampered = { ...snapshot, description: `${snapshot.description} changed` };
    assert.throws(() => resolveInstalledPreset(site({ presetId: 'aeroframe', presetVersion: '1.0.0', theme: original.theme,
        presetManifestSnapshot: JSON.stringify(tampered), publishedTemplateRecord: JSON.stringify(record) })), /checksum/i);
});
