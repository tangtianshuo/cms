import { createHash } from 'node:crypto';
import { PropType } from '../prop/models/main';
import { getPreset, type PresetManifest } from './catalog';

const OWNER = 'tangtianshuo';
const REPOSITORY = 'Independent-Website-Templates';
const IMAGE_PREFIX = 'ghcr.io/tangtianshuo/independent-website-templates/';
const MAX_BYTES = 1_000_000;
const HEX = /^[a-f0-9]{64}$/;
const DEFAULT_FETCH = fetch;

export interface PublicTemplateRecord {
    schemaVersion: 1;
    id: string;
    version: string;
    manifestChecksum: string;
    imageRepository: string;
    imageDigest: string;
    sourceCommit: string;
    manifestPath: string;
    status: 'available';
}

export interface VerifiedPublicTemplate extends PublicTemplateRecord {
    manifest: PresetManifest;
}

let registryCache: { until: number; value: Awaited<ReturnType<typeof readPublicRegistry>> } | undefined;

export function canonicalJson(value: unknown): string {
    const sorted = (item: unknown): unknown => {
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (Array.isArray(item)) return item.map(sorted);
        if (object(item)) return Object.fromEntries(Object.keys(item).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
            .map((key) => [key, sorted(item[key])]));
        throw new Error('Manifest contains a non-JSON value');
    };
    return JSON.stringify(sorted(value));
}

function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function validRecord(value: unknown): value is PublicTemplateRecord {
    if (!object(value)) return false;
    return value.schemaVersion === 1 && typeof value.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) &&
        typeof value.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version) &&
        typeof value.manifestChecksum === 'string' && value.manifestChecksum.startsWith('sha256:') && HEX.test(value.manifestChecksum.slice(7)) &&
        value.imageRepository === `${IMAGE_PREFIX}${value.id}` && typeof value.imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.imageDigest) &&
        typeof value.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(value.sourceCommit) &&
        value.manifestPath === `templates/${value.id}/${value.version}/template.json` && value.status === 'available' &&
        hasOnlyKeys(value, ['schemaVersion', 'id', 'version', 'manifestChecksum', 'imageRepository', 'imageDigest', 'sourceCommit', 'manifestPath', 'status']);
}

function normalizeManifest(value: unknown, record: PublicTemplateRecord): PresetManifest {
    if (record.id !== 'aeroframe') throw new Error('Only the AeroFrame renderer profile is supported');
    if (!object(value) || value.schemaVersion !== 1 || value.id !== record.id || value.version !== record.version ||
        !object(value.compatibility) || value.compatibility.cmsSchema !== 1 || value.compatibility.releaseSchema !== 1 ||
        !object(value.presentation) || !object(value.presentation.theme) || !object(value.presentation.demo) ||
        !Array.isArray(value.models) || !Array.isArray(value.pages) || typeof value.name !== 'string' || typeof value.description !== 'string') {
        throw new Error('Public template manifest has an unsupported shape');
    }
    if (!hasOnlyKeys(value, ['schemaVersion', 'id', 'version', 'name', 'description', 'compatibility', 'models', 'pages', 'presentation', 'assets']) ||
        !hasOnlyKeys(value.compatibility, ['cmsSchema', 'releaseSchema']) || !hasOnlyKeys(value.presentation, ['theme', 'demo', 'showcase']) ||
        !hasOnlyKeys(value.presentation.theme, ['background', 'foreground', 'accent', 'muted', 'font']) ||
        !hasOnlyKeys(value.presentation.demo, ['brand', 'contactEmail', 'hero', 'product', 'collection', 'page']) ||
        !object(value.presentation.demo.hero) || !hasOnlyKeys(value.presentation.demo.hero, ['title', 'subtitle', 'image']) ||
        !object(value.presentation.demo.product) || !hasOnlyKeys(value.presentation.demo.product, ['title', 'price', 'image', 'description']) ||
        !object(value.presentation.demo.collection) || !hasOnlyKeys(value.presentation.demo.collection, ['title', 'description', 'image']) ||
        !object(value.presentation.demo.page) || !hasOnlyKeys(value.presentation.demo.page, ['title', 'body', 'image'])) {
        throw new Error('Public template manifest contains unsupported fields');
    }
    const theme = value.presentation.theme;
    const demo = value.presentation.demo;
    if (!['background', 'foreground', 'accent', 'muted'].every((key) => typeof theme[key] === 'string' && /^#[a-f0-9]{6}$/i.test(theme[key] as string)) ||
        typeof theme.font !== 'string' || theme.font !== getPreset('aeroframe', '1.0.0')?.theme.font ||
        !object(demo.hero) || !object(demo.product) || !object(demo.collection) || !object(demo.page) || typeof demo.brand !== 'string') {
        throw new Error('Public template presentation is invalid');
    }
    const textFields: Array<[Record<string, unknown>, string[]]> = [
        [demo, ['brand']], [demo.hero, ['title', 'subtitle', 'image']],
        [demo.product, ['title', 'price', 'image', 'description']],
        [demo.collection, ['title', 'description', 'image']], [demo.page, ['title', 'body', 'image']],
    ];
    for (const [group, keys] of textFields) for (const key of keys) {
        if (typeof group[key] !== 'string' || !(group[key] as string).trim() || (group[key] as string).length > 4000) {
            throw new Error('Public template demo presentation is invalid');
        }
    }
    for (const item of [demo.hero, demo.product, demo.collection, demo.page]) {
        try {
            const image = new URL(String(item.image));
            if (image.protocol !== 'https:' || image.username || image.password) throw new Error();
        } catch { throw new Error('Public template demo image URL is invalid'); }
    }
    const models = value.models as unknown[];
    const modelKeys = new Set<string>();
    for (const item of models) {
        if (!object(item) || !hasOnlyKeys(item, ['key', 'label', 'description', 'singleEntry', 'fields']) ||
            typeof item.key !== 'string' || modelKeys.has(item.key) || !Array.isArray(item.fields)) throw new Error('Public template model is invalid');
        modelKeys.add(item.key);
        const fields = new Set<string>();
        for (const field of item.fields) {
            if (!object(field) || !hasOnlyKeys(field, ['key', 'label', 'type', 'required', 'array', 'referenceModel']) ||
                typeof field.key !== 'string' || fields.has(field.key) || !Object.values(PropType).includes(field.type as PropType) ||
                typeof field.required !== 'boolean' || typeof field.array !== 'boolean' || typeof field.label !== 'string') throw new Error('Public template field is invalid');
            fields.add(field.key);
            if (field.type === PropType.ENTRY_POINTER && typeof field.referenceModel !== 'string') throw new Error('Public template reference field is invalid');
        }
        if (typeof item.singleEntry !== 'boolean' || typeof item.label !== 'string' || typeof item.description !== 'string' || !fields.has('title')) {
            throw new Error('Public template model is incompatible');
        }
    }
    const builtin = getPreset('aeroframe', '1.0.0');
    if (!builtin || modelKeys.size !== builtin.models.length) throw new Error('Public template model profile is incompatible');
    for (const expected of builtin.models) {
        const found = models.find((item) => (item as Record<string, unknown>).key === expected.key) as Record<string, unknown> | undefined;
        if (!found || found.singleEntry !== expected.singleEntry) throw new Error(`Public template model ${expected.key} is incompatible`);
        const fields = found.fields as Array<Record<string, unknown>>;
        if (fields.length !== expected.fields.length) throw new Error(`Public template model ${expected.key} has unsupported fields`);
        for (const field of expected.fields) {
            const match = fields.find((item) => item.key === field.key);
            if (!match || match.type !== field.type || match.array !== field.array || match.required !== field.required ||
                (field.referenceModel && match.referenceModel !== field.referenceModel)) {
                throw new Error(`Public template field ${expected.key}.${field.key} is incompatible`);
            }
        }
    }
    const pageKeys = new Set<string>();
    const pagePaths = new Set<string>();
    const requiredRoutes: Record<string, [string, string, string]> = {
        home: ['/', 'home', 'home'],
        collections: ['/collections', 'collection', 'collection-list'],
        product: ['/products/:slug', 'product', 'product-detail'],
        content: ['/pages/:slug', 'content-page', 'content-page'],
    };
    for (const item of value.pages) {
        if (!object(item) || !hasOnlyKeys(item, ['key', 'title', 'path', 'modelKey', 'layout']) ||
            typeof item.key !== 'string' || pageKeys.has(item.key) || typeof item.modelKey !== 'string' ||
            !modelKeys.has(item.modelKey) || !['home', 'collection-list', 'product-detail', 'content-page'].includes(String(item.layout)) ||
            typeof item.title !== 'string' || typeof item.path !== 'string') throw new Error('Public template page is incompatible');
        pageKeys.add(item.key);
        const path = String(item.path);
        const route = item.layout === 'home' && path === '/' || item.layout === 'collection-list' && path === '/collections' ||
            item.layout === 'product-detail' && path === '/products/:slug' || item.layout === 'content-page' &&
            (path === '/pages/:slug' || /^\/(?!api(?:\/|$)|preview(?:\/|$)|presets(?:\/|$)|products(?:\/|$)|collections(?:\/|$))[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(path));
        if (!route) throw new Error('Public template page route is incompatible');
        if (pagePaths.has(String(item.path))) throw new Error('Public template page paths conflict');
        pagePaths.add(String(item.path));
        const expected = requiredRoutes[String(item.key)];
        if (expected && (item.path !== expected[0] || item.modelKey !== expected[1] || item.layout !== expected[2])) {
            throw new Error('Public template page mapping is incompatible');
        }
    }
    for (const page of ['home', 'collections', 'product', 'content']) if (!pageKeys.has(page)) throw new Error(`Public template is missing page ${page}`);
    if (Array.isArray(value.assets)) for (const asset of value.assets) {
        if (!object(asset) || !hasOnlyKeys(asset, ['path', 'checksum', 'mimeType']) ||
            typeof asset.path !== 'string' || asset.path.startsWith('/') || asset.path.includes('\\') ||
            asset.path.split('/').some((part) => !part || part === '.' || part === '..') ||
            typeof asset.checksum !== 'string' || !HEX.test(asset.checksum) ||
            !['image/png', 'image/jpeg', 'image/webp'].includes(String(asset.mimeType))) {
            throw new Error('Public template asset declaration is invalid');
        }
    }
    if (value.presentation.showcase !== undefined) {
        const showcase = value.presentation.showcase;
        if (!object(showcase) || typeof showcase.eyebrow !== 'string' || typeof showcase.heroLabel !== 'string' ||
            !Array.isArray(showcase.stats) || !Array.isArray(showcase.products) || !Array.isArray(showcase.solutions) || !Array.isArray(showcase.faq)) {
            throw new Error('Public template showcase is invalid');
        }
        const stringRecords = (items: unknown[], keys: string[]) => items.every((item) => object(item) &&
            keys.every((key) => typeof item[key] === 'string' && (item[key] as string).length <= 4000));
        if (!stringRecords(showcase.stats, ['value', 'label']) || !stringRecords(showcase.products, ['title', 'price', 'image', 'description']) ||
            !stringRecords(showcase.solutions, ['title', 'description', 'image']) || !stringRecords(showcase.faq, ['question', 'answer'])) {
            throw new Error('Public template showcase is invalid');
        }
        for (const item of [...showcase.products, ...showcase.solutions]) {
            try { if (new URL(String(item.image)).protocol !== 'https:') throw new Error(); }
            catch { throw new Error('Public template showcase image URL is invalid'); }
        }
    }
    const { showcase } = value.presentation;
    return {
        id: record.id, version: record.version, name: value.name, description: value.description,
        theme: theme as PresetManifest['theme'], demo: demo as PresetManifest['demo'],
        ...(showcase ? { showcase: showcase as PresetManifest['showcase'] } : {}),
        models: models as PresetManifest['models'], pages: value.pages as PresetManifest['pages'],
    };
}

async function readJson(fetcher: typeof fetch, url: string): Promise<unknown> {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'BCMS-CMS-public-template-reader' } });
    if (!response.ok || response.status > 299) throw new Error(`Public template registry request failed (${response.status})`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new Error('Public template registry response is too large');
    if (!response.body) throw new Error('Public template registry response is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
            await reader.cancel();
            throw new Error('Public template registry response is too large');
        }
        chunks.push(value);
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    try { return JSON.parse(text); } catch { throw new Error('Public template registry returned invalid JSON'); }
}

export async function readPublicRegistry(fetcher: typeof fetch = fetch): Promise<{ commit: string; records: VerifiedPublicTemplate[] }> {
    const branch = await readJson(fetcher, `https://api.github.com/repos/${OWNER}/${REPOSITORY}/commits/registry`);
    if (!object(branch) || typeof branch.sha !== 'string' || !/^[a-f0-9]{40}$/.test(branch.sha)) throw new Error('Registry branch commit is invalid');
    const commit = branch.sha;
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPOSITORY}/${commit}`;
    const index = await readJson(fetcher, `${base}/registry/index.json`);
    if (!object(index) || !hasOnlyKeys(index, ['schemaVersion', 'records']) || index.schemaVersion !== 1 || !Array.isArray(index.records)) throw new Error('Public template index is invalid');
    const seen = new Set<string>();
    const records: VerifiedPublicTemplate[] = [];
    for (const candidate of index.records) {
        if (!validRecord(candidate)) throw new Error('Public template record is invalid');
        const record = candidate;
        const key = `${record.id}@${record.version}`;
        if (seen.has(key)) throw new Error('Duplicate public template version');
        seen.add(key);
        const manifestValue = await readJson(fetcher, `${base}/${record.sourceCommit}/${record.manifestPath}`);
        const checksum = `sha256:${createHash('sha256').update(canonicalJson(manifestValue), 'utf8').digest('hex')}`;
        if (checksum !== record.manifestChecksum) throw new Error('Public template manifest checksum mismatch');
        records.push({ ...record, manifest: normalizeManifest(manifestValue, record) });
    }
    return { commit, records };
}

export async function getPublicRegistry(fetcher: typeof fetch = DEFAULT_FETCH) {
    if (fetcher === DEFAULT_FETCH && registryCache && registryCache.until > Date.now()) return registryCache.value;
    const value = await readPublicRegistry(fetcher);
    if (fetcher === DEFAULT_FETCH) registryCache = { value, until: Date.now() + 30000 };
    return value;
}

export async function getPublicTemplate(id: string, version: string, fetcher: typeof fetch = DEFAULT_FETCH) {
    const result = await getPublicRegistry(fetcher);
    return result.records.find((item) => item.id === id && item.version === version) || null;
}
