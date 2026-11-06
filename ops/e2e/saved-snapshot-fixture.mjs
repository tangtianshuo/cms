import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
// Production contract projection + media rewrite, without a Gateway activation claim.
export async function savedContractFixture(snapshot, { root, cms }) {
    const urls = new Map();
    function visit(value) {
        if (typeof value === 'string') {
            for (const match of value.matchAll(
                /https?:\/\/[^\s'"<>]+\/api\/v4\/media\/([^/?]+)\/bin\/image(?:\?cap=[^\s'"<>]+)?/g,
            ))
                urls.set(decodeURIComponent(match[1]), match[0]);
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object')
            Object.values(value).forEach(visit);
    }
    visit(snapshot);
    const assets = [];
    for (const [mediaId, url] of urls) {
        const parsed = new URL(url);
        const response = await fetch(cms + parsed.pathname + parsed.search);
        if (!response.ok)
            throw new Error('Saved fixture media capability failed');
        const bytes = Buffer.from(await response.arrayBuffer());
        const assetPath = `media/${mediaId}.png`;
        assets.push({
            path: assetPath,
            mediaId,
            mimeType: response.headers.get('content-type') || 'image/png',
            checksum:
                'sha256:' + createHash('sha256').update(bytes).digest('hex'),
            contentBase64: bytes.toString('base64'),
            url: '/_assets/' + assetPath,
        });
    }
    const script =
        'const fs=require("node:fs"),p=require("./backend/src/release-contract/snapshot");const {snapshot,assets}=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(p.toContractSnapshot(p.rewriteContractMediaUrls(snapshot,assets),assets)));';
    return JSON.parse(
        execFileSync(
            process.execPath,
            [
                '-r',
                'ts-node/register',
                '-r',
                'tsconfig-paths/register',
                '-e',
                script,
            ],
            {
                cwd: root,
                input: JSON.stringify({ snapshot, assets }),
                env: {
                    ...process.env,
                    TS_NODE_PROJECT: path.join(root, 'backend/tsconfig.json'),
                    TS_NODE_TRANSPILE_ONLY: '1',
                },
                maxBuffer: 8 * 1024 * 1024,
            },
        ),
    );
}
