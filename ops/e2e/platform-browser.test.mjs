import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    ownedHttpsPort,
    verifyOwnedUi,
    ownedPreviewMatrix,
} from './platform-browser.mjs';
test('owned HTTPS routing only intercepts explicitly registered fixture hosts', () => {
    const routes = new Map([
        ['cms.test.invalid', 1234],
        ['preview.test.invalid', 5678],
    ]);
    assert.equal(ownedHttpsPort('cms.test.invalid', routes, 9012), 1234);
    assert.equal(ownedHttpsPort('preview.test.invalid', routes, 9012), 5678);
    assert.equal(ownedHttpsPort('site.test.invalid', routes, 9012), 9012);
    assert.equal(ownedHttpsPort('cms.test.invalid.evil', routes, 9012), 9012);
    assert.equal(ownedHttpsPort('cms.test.invalid', undefined, 9012), 9012);
    assert.throws(() =>
        ownedHttpsPort(
            'cms.test.invalid',
            new Map([['cms.test.invalid', 0]]),
            9012,
        ),
    );
});
test('actual served UI HTML and asset bytes must match the owned locked-source build', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'f1-ui-'));
    let corrupt = '';
    const files = {
        '/d': '<html><script src="/assets/main.js"></script><link href="/assets/main.css"></html>',
        '/assets/main.js': 'console.log("owned")',
        '/assets/main.css': 'body{color:red}',
    };
    const server = createServer((req, res) => {
        res.end(
            req.url === corrupt ? 'foreign build' : files[req.url] || 'absent',
        );
    });
    try {
        await mkdir(path.join(root, 'assets'));
        await writeFile(path.join(root, 'index.html'), files['/d']);
        await writeFile(
            path.join(root, 'assets/main.js'),
            files['/assets/main.js'],
        );
        await writeFile(
            path.join(root, 'assets/main.css'),
            files['/assets/main.css'],
        );
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const origin = 'http://127.0.0.1:' + server.address().port;
        assert.equal(Object.keys(await verifyOwnedUi(origin, root)).length, 3);
        corrupt = '/d';
        await assert.rejects(verifyOwnedUi(origin, root), /owned UI bytes/);
        corrupt = '/assets/main.js';
        await assert.rejects(verifyOwnedUi(origin, root), /owned UI bytes/);
    } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
        await rm(root, { recursive: true, force: true });
    }
});
test('B3 matrix derives exact current owned sites and authority, rejects foreign release state', () => {
    const sites = ['aeroframe', 'fireguard'].map((id, i) => ({
        target: { id, version: i ? '1.0.1' : '1.0.4' },
        siteId: 'gateway-' + i,
        cmsSiteId: 'cms-' + i,
        cmsWorkspaceId: 'workspace-' + i,
        host: id + '.test.invalid',
        marker: 'current-run-' + id,
    }));
    const active = sites.map((s, i) => ({
        siteId: s.siteId,
        releaseId: 'release-' + i,
        routeRevision: 4 + i,
    }));
    const context = {
        sites,
        active,
        cmsOrigin: 'https://cms.test.invalid',
        previewOrigin: 'https://preview.test.invalid',
    };
    const matrix = ownedPreviewMatrix(context);
    assert.equal(matrix.length, 2);
    assert.equal(matrix[0].expectedReleaseId, 'release-0');
    assert.equal(matrix[0].workspaceId, 'workspace-0');
    assert.equal(matrix[0].publishedMarker, sites[0].marker);
    assert.throws(
        () => ownedPreviewMatrix({ ...context, active: active.slice(1) }),
        /owned active/,
    );
    assert.throws(
        () =>
            ownedPreviewMatrix({
                ...context,
                cmsOrigin: 'http://cms.test.invalid',
            }),
        /HTTPS/,
    );
});
