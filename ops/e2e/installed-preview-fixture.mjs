// Local B3 artifact path. Uses the production builder, archive verifier and installer.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
    mkdir,
    readFile,
    writeFile,
    cp,
    lstat,
    readlink,
    rm,
} from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const hash = (bytes) =>
    'sha256:' + createHash('sha256').update(bytes).digest('hex');
export async function installPreviewFixtures({
    templatesRoot,
    previewRoot,
    runRoot,
    root,
    cms,
    build,
}) {
    const git = (args) =>
        execFileSync('git', args, {
            cwd: templatesRoot,
            encoding: 'utf8',
        }).trim();
    const sourceCommit = git(['rev-parse', 'HEAD']);
    if (git(['status', '--porcelain']))
        throw new Error(
            'Templates must be committed before local artifact builds',
        );
    const { buildPreviewBundle } = await import(
        pathToFileURL(path.join(templatesRoot, 'scripts/preview-bundle.mjs'))
    );
    const { canonicalChecksum } = await import(
        pathToFileURL(path.join(templatesRoot, 'scripts/validate.mjs'))
    );
    const { extractBundleArchive, installBundle } = await import(
        pathToFileURL(path.join(previewRoot, 'ops/install-bundle.mjs'))
    );
    const evidence = path.join(
        root,
        '.e2e/b3-artifacts',
        sourceCommit,
        randomUUID(),
    );
    await mkdir(evidence, { recursive: true });
    const records = [];
    for (const [id, version] of [
        ['aeroframe', '1.0.4'],
        ['fireguard', '1.0.1'],
    ]) {
        const base = path.join(runRoot, 'preview-artifacts', id, version),
            storefront = path.join(
                templatesRoot,
                'templates',
                id,
                version,
                'storefront',
            );
        await mkdir(base, { recursive: true });
        try {
            await build(id, storefront, {
                ...process.env,
                PREVIEW_APP_BASE_URL: `/preview/${id}/${version}/`,
                NUXT_PUBLIC_PREVIEW_ADMIN_ORIGIN: cms,
            });
        } finally {
            const dist = path.join(storefront, 'dist');
            const info = await lstat(dist).catch(() => null);
            if (
                info?.isSymbolicLink() &&
                (await readlink(dist)) ===
                    path.join(storefront, '.output/public')
            )
                await rm(dist);
        }
        const raw = JSON.parse(
            await readFile(path.join(storefront, '../template.json'), 'utf8'),
        );
        const manifestChecksum = 'sha256:' + canonicalChecksum(raw);
        const bundle = await buildPreviewBundle({
            publicDir: path.join(storefront, '.output/public'),
            outputDir: path.join(base, 'bundle'),
            templateId: id,
            templateVersion: version,
            manifestChecksum,
            sourceCommit,
        });
        const archivePath = path.join(base, 'preview-bundle.tar.gz');
        execFileSync('tar', [
            '--format',
            'ustar',
            '-czf',
            archivePath,
            '-C',
            path.join(base, 'bundle'),
            '.',
        ]);
        const archive = await readFile(archivePath);
        const blobs = path.join(base, 'oci-layout/blobs/sha256');
        await mkdir(blobs, { recursive: true });
        async function put(bytes, mediaType) {
            const digest = hash(bytes);
            await writeFile(path.join(blobs, digest.slice(7)), bytes);
            return { mediaType, digest, size: bytes.length };
        }
        const config = await put(
            Buffer.from('{}'),
            'application/vnd.oci.empty.v1+json',
        );
        const layer = await put(
            archive,
            'application/vnd.bcms.preview.bundle.v1.tar+gzip',
        );
        layer.annotations = {
            'org.opencontainers.image.title': 'preview-bundle.tar.gz',
        };
        const manifest = {
            schemaVersion: 2,
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            artifactType: 'application/vnd.bcms.preview.bundle.v1',
            config,
            layers: [layer],
            annotations: {
                'org.opencontainers.image.revision': sourceCommit,
                'io.bcms.scope': 'LOCAL_ONLY_NOT_PUBLISHED',
            },
        };
        const descriptor = await put(
            Buffer.from(JSON.stringify(manifest)),
            'application/vnd.oci.image.manifest.v1+json',
        );
        descriptor.annotations = {
            'org.opencontainers.image.ref.name': 'local-b3',
        };
        await writeFile(
            path.join(base, 'oci-layout/index.json'),
            JSON.stringify({ schemaVersion: 2, manifests: [descriptor] }),
        );
        await writeFile(
            path.join(base, 'oci-layout/oci-layout'),
            JSON.stringify({ imageLayoutVersion: '1.0.0' }),
        );
        const record = {
            id,
            version,
            manifestChecksum,
            sourceCommit,
            bundleDigest: bundle.bundleDigest,
            artifactDigest: descriptor.digest,
            bundlePath: `templates/${id}/${version}`,
            adapterVersion: '1',
            protocolVersion: 1,
            status: 'available',
        };
        const stagingDir = path.join(base, 'staging');
        await mkdir(stagingDir);
        await extractBundleArchive({ archivePath, stagingDir });
        await installBundle({
            stagingDir,
            bundlesRoot: path.join(runRoot, 'preview/bundles'),
            registryPath: path.join(runRoot, 'preview/index.json'),
            record,
        });
        records.push({
            ...record,
            compiledAdminOrigin: cms,
            artifactScope: 'LOCAL_OCI_LAYOUT_NOT_PUBLIC',
            archiveDigest: hash(archive),
            files: bundle.files.length,
            evidencePath: path.join(evidence, id, version),
        });
        await cp(base, path.join(evidence, id, version), { recursive: true });
    }
    await writeFile(
        path.join(evidence, 'provenance.json'),
        JSON.stringify(
            { scope: 'local-b3-new-artifacts-not-final-lock', records },
            null,
            2,
        ),
    );
    await writeFile(
        path.join(runRoot, 'b3-installed-records.json'),
        JSON.stringify(records, null, 2),
    );
    return records;
}
