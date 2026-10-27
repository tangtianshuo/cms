import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { getPreset } from './catalog';
import { canonicalJson, readPublicRegistry, type PublicTemplateRecord } from './registry';

const sha = (value: unknown) => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
const sourceCommit = 'a'.repeat(40);
const record: PublicTemplateRecord = {
    schemaVersion: 1, id: 'aeroframe', version: '1.0.1', manifestChecksum: '',
    imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
    imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit,
    manifestPath: 'templates/aeroframe/1.0.1/template.json', status: 'available',
};
const builtin = getPreset('aeroframe', '1.0.0')!;
const manifest = JSON.parse(JSON.stringify({
    schemaVersion: 1, id: 'aeroframe', version: '1.0.1', name: 'AeroFrame', description: 'Aero',
    compatibility: { cmsSchema: 1, releaseSchema: 1 },
    presentation: { theme: { background: '#080d14', foreground: '#f3f6fa', accent: '#4f7dff', muted: '#182432', font: 'Arial, sans-serif' },
    demo: { brand: 'AEROWORKS', hero: { title: 'A', subtitle: 'B', image: 'https://example.com/a.png' },
        product: { title: 'P', price: '$4', image: 'https://example.com/p.png', description: 'P' },
        collection: { title: 'C', description: 'C', image: 'https://example.com/c.png' },
        page: { title: 'Page', body: 'Body', image: 'https://example.com/d.png' } } },
    models: builtin.models, pages: builtin.pages,
}));

test('canonical JSON uses binary key ordering and preserves arrays', () => {
    assert.equal(canonicalJson({ a: 1, B: 2 }), '{"B":2,"a":1}');
    const vector = { b: [2, 1], a: { z: '中', a: 1 } };
    assert.equal(createHash('sha256').update(canonicalJson(vector)).digest('hex'),
        'c379fb1bf53ba9e0b99beeed25efea9acc845223c3f5140055c19f12657f6322');
});

test('registry resolves branch commit, fetches index and verifies immutable manifest checksum', async () => {
    const pinned = { ...record, manifestChecksum: sha(manifest) };
    const requests: string[] = [];
    const registryCommit = 'b'.repeat(40);
    const rawRoot = 'https://raw.githubusercontent.com/tangtianshuo/Independent-Website-Templates';
    const fetcher = async (input: string | URL | Request) => {
        const url = String(input); requests.push(url);
        if (url.includes('/commits/registry')) return Response.json({ sha: registryCommit });
        if (url === `${rawRoot}/${registryCommit}/registry/index.json`) return Response.json({ schemaVersion: 1, records: [pinned] });
        if (url === `${rawRoot}/${sourceCommit}/${record.manifestPath}`) return Response.json(manifest);
        throw new Error(`Unexpected URL ${url}`);
    };
    const result = await readPublicRegistry(fetcher);
    assert.equal(result.records[0].version, '1.0.1');
    assert.equal(result.records[0].manifest.theme.accent, '#4f7dff');
    assert.deepEqual(requests, [
        'https://api.github.com/repos/tangtianshuo/Independent-Website-Templates/commits/registry',
        `${rawRoot}/${registryCommit}/registry/index.json`,
        `${rawRoot}/${sourceCommit}/${record.manifestPath}`,
    ]);
});

test('registry rejects tampered manifest and invalid source locations', async () => {
    const pinned = { ...record, manifestChecksum: sha(manifest) };
    const fetcher = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/commits/registry')) return Response.json({ sha: sourceCommit });
        if (url.endsWith('/registry/index.json')) return Response.json({ schemaVersion: 1, records: [{ ...pinned, manifestPath: '../x' }] });
        return Response.json(manifest);
    };
    await assert.rejects(() => readPublicRegistry(fetcher), /record is invalid/i);
});

test('registry verifies presentation as part of the pinned canonical manifest checksum', async () => {
    const pinned = { ...record, manifestChecksum: sha(manifest) };
    const fetcher = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/commits/registry')) return Response.json({ sha: sourceCommit });
        if (url.endsWith('/registry/index.json')) return Response.json({ schemaVersion: 1, records: [pinned] });
        return Response.json({ ...manifest, presentation: { ...manifest.presentation,
            theme: { ...manifest.presentation.theme, accent: '#abcdef' } } });
    };
    await assert.rejects(() => readPublicRegistry(fetcher), /checksum mismatch/i);
});

test('registry streams and rejects responses over the byte limit', async () => {
    const fetcher = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(1_000_001)); controller.close(); },
    }));
    await assert.rejects(() => readPublicRegistry(fetcher), /too large/i);
});
