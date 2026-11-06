// Local B4 source/browser evidence. No public template record, OCI identity or lock.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function inventory(root, relative = '') {
    const files = [];
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) files.push(...await inventory(root, name));
        else if (entry.isFile()) { const bytes = await readFile(path.join(root, name)); files.push({ path: name, size: bytes.length, checksum: hash(bytes).slice(7) }); }
        else throw new Error('Local preview bundle cannot contain symlinks');
    }
    return files;
}
export async function localSectionBundles({ templatesRoot, runRoot, root }) {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: templatesRoot }).toString().trim();
    if (execFileSync('git', ['status', '--porcelain'], { cwd: templatesRoot }).length) throw new Error('Commit Templates sources before building B4 fixtures');
    const records = [];
    for (const [id, version] of [['aeroframe', '1.0.4'], ['fireguard', '1.0.1']]) {
        const template = path.join(templatesRoot, 'templates', id, version);
        const manifest = JSON.parse(await readFile(path.join(template, 'template.json'), 'utf8'));
        const canonical = execFileSync(process.execPath, ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', '-e', 'const fs=require("fs"),r=require("./backend/src/presets/registry");process.stdout.write(r.canonicalJson(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))))', path.join(template, 'template.json')], { cwd: root, env: { ...process.env, TS_NODE_PROJECT: 'backend/tsconfig.json', TS_NODE_TRANSPILE_ONLY: '1' } });
        const destination = path.join(runRoot, 'preview/bundles', id, version);
        await mkdir(destination, { recursive: true });
        await cp(path.join(template, 'storefront/.output/public'), destination, { recursive: true });
        const html = await readFile(path.join(destination, 'index.html'), 'utf8');
        if (!html.includes('Waiting for a private CMS preview.')) throw new Error('Build the actual preview root entry before local B4 evidence');
        const files = await inventory(destination);
        const bundleDigest = hash(JSON.stringify(files));
        await writeFile(path.join(destination, 'preview-bundle.json'), JSON.stringify({ templateId: id, templateVersion: version, protocolVersion: 1, bundleDigest, files }));
        const archive = path.join(runRoot, `preview/${id}-${version}.local.tar`);
        execFileSync('tar', ['-cf', archive, '-C', destination, '.']);
        records.push({ id, version, manifestChecksum: hash(canonical), sourceCommit, bundleDigest, artifactDigest: hash(await readFile(archive)), bundlePath: `templates/${id}/${version}`, adapterVersion: '1', protocolVersion: 1, status: 'available' });
        await writeFile(path.join(runRoot, `b4-${id}-manifest.json`), JSON.stringify(manifest));
    }
    await writeFile(path.join(runRoot, 'preview/index.json'), JSON.stringify({ schemaVersion: 1, records }));
    const evidence = path.join(root, '.e2e/b4-built-preview', sourceCommit);
    await mkdir(evidence, { recursive: true });
    await cp(path.join(runRoot, 'preview'), evidence, { recursive: true });
    await writeFile(path.join(runRoot, 'b4-local-bundles.json'), JSON.stringify({ evidenceType: 'local-source-preview-bundles-not-public-acceptance', templatesRoot, records, bundleDigestMeaning: 'sha256 of sorted path/size/file-checksum inventory', artifactDigestMeaning: 'actual local tar archive bytes; not an OCI manifest digest', cmsPublishedTemplateRecord: 'absent' }, null, 2));
}
export async function provisionSectionSite({ templatesRoot, root, runRoot, db, site, workspace, api, token, selector, cms }) {
    const id = process.env.E2E_SECTION_TEMPLATE || 'aeroframe';
    if (!['aeroframe', 'fireguard'].includes(id)) throw new Error('Unsupported B4 local template');
    const version = id === 'aeroframe' ? '1.0.4' : '1.0.1';
    const manifestPath = path.join(templatesRoot, 'templates', id, version, 'template.json');
    // The projection only consumes id/version from this identity argument. No registry record is made.
    const normalized = JSON.parse(execFileSync(process.execPath, ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', '-e', 'const fs=require("fs"),r=require("./backend/src/presets/registry");const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(r.normalizePublicManifest(raw,{id:raw.id,version:raw.version})))', manifestPath], { cwd: root, env: { ...process.env, TS_NODE_PROJECT: 'backend/tsconfig.json', TS_NODE_TRANSPILE_ONLY: '1' } }));
    const pages = normalized.pages.map(page => ({ ...page, enabled: true, navigation: !page.path.includes(':'), sections: normalized.editor.pages.find(item => item.pageKey === page.key).sections }));
    const home = pages.find(page => page.key === 'home');
    home.layoutDocument = { version: 1, mode: 'template', root: home.sections.map((type, index) => ({ id: `section-${type}-${index + 1}`, kind: 'section', type, enabled: true, props: type === 'hero' ? { title: normalized.demo.hero.title, showButton: true, buttonHref: '/collections' } : { eyebrow: normalized.showcase.eyebrow }, children: [] })) };
    await db.collection('bcms_site_installations').updateOne({ _id: site._id }, { $set: { name: `Local B4 ${id}`, presetId: id, presetVersion: version, presetManifestSnapshot: JSON.stringify(normalized), theme: normalized.theme, pages }, $unset: { publishedTemplateRecord: '' } });
    // Upload through the actual selected-site permission/provenance boundary.
    async function upload(selection, name) {
        const result = await api('/media/request/upload-token', undefined, token, selection);
        const form = new FormData();
        form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), name);
        const response = await fetch(`${cms}/api/v4/media/create/file?token=${result.token}`, { method: 'POST', body: form });
        if (!response.ok) throw new Error(`Local fixture image upload failed (${response.status})`);
        return (await response.json()).item._id;
    }
    const ownMedia = await upload(selector, 'B4 own image.png');
    const foreign = await api('/workspaces/current/sites', { name: 'B4 foreign-media control' }, token, { 'x-bcms-workspace': workspace._id });
    const foreignMedia = await upload({ ...selector, 'x-bcms-site': foreign._id }, 'B4 foreign image.png');
    const viewerEmail = `viewer-${randomBytes(8).toString('hex')}@acceptance.invalid`;
    const viewerPassword = randomBytes(24).toString('hex');
    const viewer = await api('/user/create', { email: viewerEmail, password: viewerPassword, firstName: 'Readonly', lastName: 'Fixture', role: 'USER' }, token);
    const installed = await db.collection('bcms_site_installations').findOne({ _id: site._id });
    const permissions = { get: true, post: false, put: false, delete: false };
    const granted = await fetch(`${cms}/api/v4/user/update`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ _id: viewer.item._id, customPool: { policy: { media: permissions, templates: installed.models.map(model => ({ _id: model.templateId, ...permissions })) } } }) });
    if (!granted.ok) throw new Error(`Local viewer read grant failed (${granted.status})`);
    await db.collection('bcms_workspaces').updateOne({ _id: workspace._id }, { $push: { members: { userId: viewer.item._id, role: 'viewer' } } });
    await writeFile(path.join(runRoot, 'b4-site-provenance.json'), JSON.stringify({ evidenceType: 'local-normalized-manifest-site-not-public-installation', templateId: id, templateVersion: version, publishedTemplateRecord: 'absent', manifestSnapshot: 'actual production normalizePublicManifest projection', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: templatesRoot }).toString().trim() }, null, 2));
    return { STOREFRONT_E2E_OWN_MEDIA: ownMedia, STOREFRONT_E2E_FOREIGN_MEDIA: foreignMedia, STOREFRONT_E2E_VIEWER_EMAIL: viewerEmail, STOREFRONT_E2E_VIEWER_PASSWORD: viewerPassword };
}
