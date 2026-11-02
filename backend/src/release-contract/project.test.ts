import assert from 'node:assert/strict';
import test from 'node:test';
import { projectReleaseSnapshot } from './project';
import { validateReleaseContract } from './validator';

const release = {
    schemaVersion: 1 as const, workspaceId: 'workspace', siteId: 'site', language: 'en',
    pages: [{ path: '/', pageKey: 'home', entryId: 'entry', content: { kind: 'preset-page', view: 'home', preset: { id: 'custom', version: '1.0.0', name: 'Custom', description: '', theme: { background: '#000000', foreground: '#ffffff', accent: '#ff0000', muted: '#111111', font: 'Arial' }, demo: { brand: 'Custom' } }, sections: ['hero'], seo: { title: 'Home', description: '' } } }],
    navigation: [], redirects: [], operations: { seoTitle: 'Custom', seoDescription: '', contactFormEnabled: false },
};

test('projects a release with deterministic checksum and request key', () => {
    const result = projectReleaseSnapshot(release as never);
    assert.equal(result.snapshot.contractVersion, 1);
    assert.match(result.checksum, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.requestKey, /^site:site:release:/);
    assert.doesNotThrow(() => validateReleaseContract(result.snapshot));
});

test('validator rejects mixed template identities and malformed assets', () => {
    const result = projectReleaseSnapshot(release as never);
    const mixed = structuredClone(result.snapshot) as any;
    mixed.pages.push({ ...mixed.pages[0], content: { ...mixed.pages[0].content, preset: { ...mixed.pages[0].content.preset, version: '2.0.0' } } });
    assert.throws(() => validateReleaseContract(mixed), /template identity/i);
    const badAsset = structuredClone(result.snapshot) as any;
    badAsset.assets = [{ path: '../secret', checksum: 'bad', mimeType: 'text/plain' }];
    assert.throws(() => validateReleaseContract(badAsset), /asset/i);
});
