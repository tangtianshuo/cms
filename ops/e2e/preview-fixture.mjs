// Deliberate local-only fixture: 1.0.3 has no approved public release record.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cmsRoot, runtimeDir, readEnv } from './runtime.mjs';
const e = await readEnv();
const login = await fetch('http://127.0.0.1:18080/api/v4/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: e.E2E_EMAIL, password: e.E2E_PASSWORD }),
}).then((r) => r.json());
const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${login.accessToken}`,
    'x-bcms-workspace': e.E2E_CMS_WORKSPACE,
};
async function api(route, body) {
    const r = await fetch(`http://127.0.0.1:18080/api/v4/${route}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${route}: ${r.status} ${await r.text()}`);
    return r.json();
}
let site;
try {
    site = JSON.parse(
        await readFile(path.join(runtimeDir, 'preview-site.json'), 'utf8'),
    );
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    site = await api('workspaces/current/sites', {
        name: 'Docker 1.0.3 Private Preview',
    });
    headers['x-bcms-site'] = site._id;
    const record = JSON.parse(
        await readFile(path.join(runtimeDir, 'public-template.json'), 'utf8'),
    );
    await api('presets/import', {
        presetId: 'aeroframe',
        presetVersion: '1.0.2',
        manifestChecksum: record.manifestChecksum,
        siteName: 'Docker 1.0.3 Private Preview',
        includeDemo: true,
    });
}
const raw = JSON.parse(
    await readFile(
        path.join(
            process.env.E2E_TEMPLATES_ROOT ||
                path.join(cmsRoot, '../Independent-Website-Templates'),
            'templates/aeroframe/1.0.3/template.json',
        ),
        'utf8',
    ),
);
const normalized = {
    id: raw.id,
    version: raw.version,
    name: raw.name,
    description: raw.description,
    ...raw.presentation,
    models: raw.models,
    pages: raw.pages,
};
const { MongoClient } = createRequire(
    path.join(cmsRoot, 'backend/package.json'),
)('mongodb');
const client = await MongoClient.connect(
    `mongodb://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:27029/cms_docker_e2e?authSource=admin`,
);
try {
    await client
        .db()
        .collection('bcms_site_installations')
        .updateOne(
            { _id: site._id, workspaceId: e.E2E_CMS_WORKSPACE },
            {
                $set: {
                    presetVersion: '1.0.3',
                    presetManifestSnapshot: JSON.stringify(normalized),
                    theme: normalized.theme,
                },
                $unset: { publishedTemplateRecord: '' },
            },
        );
} finally {
    await client.close();
}
await writeFile(
    path.join(runtimeDir, 'preview-site.json'),
    JSON.stringify(site),
);
console.log(
    'Local-only private preview fixture ready. No public approval or Gateway publish claim.',
);
