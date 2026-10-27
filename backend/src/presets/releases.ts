import { ownerWorkspace } from '../workspaces/context';
import { randomUUID } from 'node:crypto';
import type { MongoDBEntry } from '../_server/modules/mongodb';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import { PropType } from '../prop/models/main';
import type { Template } from '../template/models/main';
import { previewPresetPage, type PresetPagePreview } from '../storefront/preset-preview';
import { resolveInstalledPreset } from './installed';
import { pageDraft, updatePageDraft } from './pages';
import type { SiteInstallation } from './site-model';

export interface ReleaseLink { label: string; path: string }
export interface ReleaseItem extends ReleaseLink { image: string; description: string; price: string }
export interface PublishedContent extends PresetPagePreview { items?: ReleaseItem[] }
export interface ReleasePage {
    path: string;
    pageKey: string;
    entryId: string;
    content: PublishedContent;
}
export interface ReleaseSnapshot {
    schemaVersion: 1;
    workspaceId?: string;
    siteId: string;
    language: string;
    pages: ReleasePage[];
    navigation: ReleaseLink[];
    redirects: Array<{ from: string; to: string }>;
}
export interface ReleaseRecord extends MongoDBEntry {
    workspaceId?: string;
    siteId: string;
    createdBy: string;
    previousReleaseId: string;
    payload: string;
}
export interface ReleaseAudit extends MongoDBEntry {
    workspaceId?: string;
    siteId: string;
    actorId: string;
    operation: 'publish' | 'rollback';
    releaseId: string;
    error: string;
}
export interface ReleaseInput {
    site: SiteInstallation;
    templates: Template[];
    entries: Entry[];
    media: Media[];
    language: string;
    mediaOrigin: string;
    currency: string;
    previous?: ReleaseSnapshot;
}
export interface ReleaseSource {
    findSite(): Promise<SiteInstallation | null>;
    loadContent(site: SiteInstallation): Promise<Omit<ReleaseInput, 'site'>>;
    findRelease(id: string): Promise<ReleaseRecord | null>;
    insertRelease(record: ReleaseRecord): Promise<void>;
    activate(site: SiteInstallation, releaseId: string): Promise<boolean>;
    audit(event: ReleaseAudit): Promise<void>;
}

export interface BuildReleaseOptions {
    preserveMediaCapabilities?: boolean;
}

function fieldValues(input: ReleaseInput, entry: Entry, key: string): unknown[] {
    const model = input.site.models.find((item) => item.templateId === entry.templateId);
    const field = model?.fields.find((item) => item.key === key);
    return entry.meta.find((meta) => meta.lng === input.language)?.props
        .find((prop) => prop.id === field?.propId)?.data as unknown[] || [];
}

function entryText(input: ReleaseInput, entry: Entry, key: string): string {
    const value = fieldValues(input, entry, key)[0];
    return typeof value === 'string' ? value.trim() : '';
}

export function buildRelease(input: ReleaseInput, options: BuildReleaseOptions = {}): ReleaseSnapshot {
    // Public snapshots always contain stable URLs; editor capabilities must never be serialized.
    if (!options.preserveMediaCapabilities) {
        input = { ...input, media: input.media.map(({ accessToken: _accessToken, accessTokenExpiresAt: _expiresAt, ...media }) => media) };
    }
    const { site, language } = input;
    if (site.status !== 'ready') throw new Error('Site import is not ready');
    const preset = resolveInstalledPreset(site);
    if (!site.pages.some((page) => page.layout === 'home' && page.enabled !== false)) {
        throw new Error('Home page is required');
    }
    for (const token of ['background', 'foreground', 'accent', 'muted'] as const) {
        if (!/^#[a-f0-9]{6}$/i.test(site.theme[token])) throw new Error('Invalid theme color');
    }
    if (site.theme.font !== preset.theme.font) throw new Error('Unsupported theme font');
    const scopedEntries = input.entries.filter((entry) => site.models.some((model) => model.templateId === entry.templateId));
    const availableEntries = scopedEntries.filter((entry) => entry.meta.some((meta) => meta.lng === language));
    // Validate only content contributing to enabled pages and shared settings.
    const selectedIds = new Set<string>();
    for (const model of site.models) {
        const activePages = site.pages.filter((page) => page.modelKey === model.key && page.enabled !== false);
        const candidates = availableEntries.filter((entry) => entry.templateId === model.templateId);
        for (const entry of candidates) {
            if (model.key === 'site-settings' || activePages.some((page) => !page.entryId || page.entryId === entry._id)) {
                selectedIds.add(entry._id);
            }
        }
    }
    const pending = availableEntries.filter((entry) => selectedIds.has(entry._id));
    for (let index = 0; index < pending.length; index++) {
        const entry = pending[index];
        const model = site.models.find((item) => item.templateId === entry.templateId)!;
        const definition = preset.models.find((item) => item.key === model.key)!;
        for (const field of definition.fields.filter((item) => item.type === PropType.ENTRY_POINTER)) {
            const values = fieldValues(input, entry, field.key);
            if (!Array.isArray(values)) continue;
            for (const value of values) {
                const pointer = value as { eid?: string; tid?: string } | null;
                const related = availableEntries.find((item) => item._id === pointer?.eid && item.templateId === pointer?.tid);
                if (related && !selectedIds.has(related._id)) {
                    selectedIds.add(related._id);
                    pending.push(related);
                }
            }
        }
    }
    const entries = availableEntries.filter((entry) => selectedIds.has(entry._id));
    for (const definition of preset.models) {
        const model = site.models.find((item) => item.key === definition.key);
        const template = input.templates.find((item) => item._id === model?.templateId);
        if (!model || !template) throw new Error(`Missing model binding: ${definition.key}`);
        for (const field of definition.fields) {
            const mapping = model.fields.find((item) => item.key === field.key);
            const prop = template.props.find((item) => item.id === mapping?.propId);
            if (!prop || prop.type !== field.type || prop.array !== field.array) {
                throw new Error(`Invalid field binding: ${definition.key}.${field.key}`);
            }
        }
        const modelEntries = entries.filter((entry) => entry.templateId === model.templateId);
        if (definition.singleEntry && modelEntries.length !== 1) {
            throw new Error(`Exactly one ${definition.key} Entry is required for language ${language}`);
        }
        for (const entry of modelEntries) {
            for (const field of definition.fields) {
                const values = fieldValues(input, entry, field.key);
                if (!Array.isArray(values) || (!field.array && values.length > 1) ||
                    (field.required && (!values.length || values.some((value) =>
                        value === null || value === undefined || typeof value === 'string' && !value.trim())))) {
                    throw new Error(`Invalid required field ${definition.key}.${field.key} (${entry._id})`);
                }
                for (const value of values) {
                    if (field.type === PropType.STRING && typeof value !== 'string' ||
                        field.type === PropType.NUMBER && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
                        throw new Error(`Invalid value ${definition.key}.${field.key}`);
                    }
                    if (field.type === PropType.MEDIA) {
                        const id = (value as { _id?: string } | null)?._id;
                        if (!input.media.some((media) => media._id === id && media.mimetype.startsWith('image/'))) {
                            throw new Error(`Missing image media: ${definition.key}.${field.key}`);
                        }
                    }
                    if (field.type === PropType.ENTRY_POINTER) {
                        const pointer = value as { tid?: string; eid?: string } | null;
                        const target = site.models.find((item) => item.key === field.referenceModel);
                        if (!pointer || pointer.tid !== target?.templateId ||
                            !entries.some((item) => item._id === pointer.eid && item.templateId === pointer.tid)) {
                            throw new Error(`Invalid related Entry: ${definition.key}.${field.key}`);
                        }
                    }
                }
            }
        }
    }
    const pages: ReleasePage[] = [];
    for (const sourcePage of site.pages) {
        const page = pageDraft(site, sourcePage.key)!;
        const model = site.models.find((item) => item.key === page.modelKey);
        const bound = entries.find((entry) => entry._id === page.entryId);
        updatePageDraft(site, page.key, page, bound);
        if (page.enabled === false) continue;
        if (!page.seoTitle.trim()) throw new Error(`SEO title is required: ${page.title}`);
        const candidates = entries.filter((entry) => entry.templateId === model?.templateId &&
            (!page.entryId || entry._id === page.entryId));
        if (!candidates.length) throw new Error(`Missing content for ${page.title} in language ${language}`);
        for (const entry of page.path.includes(':slug') ? candidates : candidates.slice(0, 1)) {
            const slug = entryText(input, entry, 'slug');
            if (page.path.includes(':slug') && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
                throw new Error(`Invalid slug: ${entry._id}`);
            }
            const path = page.path.replace(':slug', slug);
            if (pages.some((item) => item.path === path)) throw new Error(`Duplicate page path: ${path}`);
            const content: PublishedContent = previewPresetPage({
                ...input, site, pageKey: page.key, entry, availableLanguages: [language], relatedEntries: entries,
            });
            if (page.layout === 'collection-list' && !page.blueprintKey) {
                content.preset.demo.collection = { title: page.title, description: '', image: '' };
            }
            pages.push({ path, pageKey: page.key, entryId: entry._id, content });
        }
    }
    const pageForEntry = (id: string) => pages.find((page) => page.entryId === id && page.path !== '/collections');
    const card = (entry: Entry): ReleaseItem | null => {
        const target = pageForEntry(entry._id);
        if (!target) return null;
        const demo = target.content.preset.demo;
        const data = target.content.view === 'product' ? demo.product : demo.page;
        return { label: data.title, path: target.path, image: data.image,
            description: 'description' in data ? data.description : data.body,
            price: 'price' in data ? data.price : '' };
    };
    for (const page of pages) {
        const entry = entries.find((item) => item._id === page.entryId)!;
        let targets: Entry[] = [];
        if (page.content.view === 'collection') {
            const collectionModel = site.models.find((item) => item.key === 'collection');
            const collections = site.pages.find((item) => item.key === page.pageKey)?.blueprintKey
                ? [entry] : entries.filter((item) => item.templateId === collectionModel?.templateId);
            const ids = collections.flatMap((item) => fieldValues(input, item, 'products')
                .map((value) => (value as { eid: string }).eid));
            targets = entries.filter((item) => ids.includes(item._id));
        } else if (page.content.view === 'home') {
            const ids = fieldValues(input, entry, 'featuredProducts').map((value) => (value as { eid: string }).eid);
            targets = entries.filter((item) => ids.includes(item._id));
        }
        page.content.items = targets.map((item) => {
            const result = card(item);
            if (!result) throw new Error(`Related Entry has no published page: ${item._id}`);
            return result;
        });
    }
    const navigation: ReleaseLink[] = pages.filter((page) => {
        const draft = pageDraft(site, page.pageKey)!;
        return draft.navigation && !draft.path.includes(':');
    }).map((page) => ({ path: page.path, label: site.pages.find((item) => item.key === page.pageKey)!.title }));
    const settings = entries.find((entry) => entry.templateId === site.models.find((model) => model.key === 'site-settings')?.templateId)!;
    for (const value of fieldValues(input, settings, 'navigationPages')) {
        const id = (value as { eid: string }).eid;
        const target = pageForEntry(id);
        if (!target) throw new Error(`Navigation Entry has no published page: ${id}`);
        if (!navigation.some((link) => link.path === target.path)) {
            navigation.push({ label: entryText(input, entries.find((entry) => entry._id === id)!, 'title'), path: target.path });
        }
    }
    const redirects = new Map<string, string>();
    const destination = (old: ReleasePage) => pages.find((page) =>
        page.pageKey === old.pageKey && (page.entryId === old.entryId || !site.pages.find((draft) => draft.key === page.pageKey)?.path.includes(':')));
    for (const redirect of input.previous?.redirects || []) {
        const old = input.previous?.pages.find((page) => page.path === redirect.to);
        const target = old && destination(old);
        if (target && target.path !== redirect.from && !pages.some((page) => page.path === redirect.from)) {
            redirects.set(redirect.from, target.path);
        }
    }
    for (const old of input.previous?.pages || []) {
        const target = destination(old);
        if (target && target.path !== old.path && !pages.some((page) => page.path === old.path)) redirects.set(old.path, target.path);
    }
    const validateLinks = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(validateLinks); return; }
        if (!value || typeof value !== 'object') return;
        const object = value as Record<string, unknown>;
        if (typeof object.href === 'string' && object.href.startsWith('/') && !object.href.startsWith('//')) {
            const path = object.href.split(/[?#]/)[0];
            if (!pages.some((page) => page.path === path) && !redirects.has(path)) throw new Error(`Broken internal link: ${path}`);
        }
        Object.values(object).forEach(validateLinks);
    };
    entries.forEach((entry) => validateLinks(entry.meta.find((meta) => meta.lng === language)?.props));
    return structuredClone({ schemaVersion: 1, workspaceId: ownerWorkspace(site), siteId: site._id, language, pages, navigation,
        redirects: [...redirects].map(([from, to]) => ({ from, to })) });
}

export function releaseDiff(previous: ReleaseSnapshot | undefined, next: ReleaseSnapshot) {
    const old = new Map(previous?.pages.map((page) => [page.path, JSON.stringify(page.content)]));
    return {
        added: next.pages.filter((page) => !old.has(page.path)).map((page) => page.path),
        changed: next.pages.filter((page) => old.has(page.path) && old.get(page.path) !== JSON.stringify(page.content)).map((page) => page.path),
        removed: (previous?.pages || []).filter((page) => !next.pages.some((item) => item.path === page.path)).map((page) => page.path),
        navigationChanged: JSON.stringify(previous?.navigation) !== JSON.stringify(next.navigation),
        redirects: next.redirects,
    };
}

async function currentSite(source: ReleaseSource, expectedReleaseId: string) {
    const site = await source.findSite();
    if (!site || site.status !== 'ready') throw new Error('Site is not ready');
    if ((site.currentReleaseId || '') !== expectedReleaseId) throw new Error('Published site changed; refresh before continuing');
    return site;
}

async function recordAudit(source: ReleaseSource, event: ReleaseAudit): Promise<void> {
    try { await source.audit(event); }
    catch (cause) { console.error('Storefront release audit failed', cause); }
}

export async function publishRelease(source: ReleaseSource, actorId: string, expectedReleaseId: string): Promise<ReleaseRecord> {
    const site = await currentSite(source, expectedReleaseId);
    const now = Date.now();
    const releaseId = randomUUID();
    try {
        const previous = site.currentReleaseId ? await source.findRelease(site.currentReleaseId) : null;
        if (previous && (previous.siteId !== site._id || ownerWorkspace(previous) !== ownerWorkspace(site))) throw new Error('Release belongs to another site');
        const prior = previous ? JSON.parse(previous.payload) as ReleaseSnapshot : undefined;
        if (prior && (prior.siteId !== site._id || ownerWorkspace(prior) !== ownerWorkspace(site))) throw new Error('Release snapshot belongs to another site');
        const snapshot = buildRelease({ ...await source.loadContent(site), site, previous: prior });
        const record: ReleaseRecord = { _id: releaseId, workspaceId: ownerWorkspace(site), siteId: site._id, createdAt: now, updatedAt: now,
            createdBy: actorId, previousReleaseId: site.currentReleaseId || '', payload: JSON.stringify(snapshot) };
        await source.insertRelease(record);
        if (!await source.activate(site, releaseId)) throw new Error('Site changed during publication; refresh and retry');
        await recordAudit(source, { _id: randomUUID(), createdAt: now, updatedAt: now,
            workspaceId: ownerWorkspace(site), siteId: site._id, actorId, operation: 'publish', releaseId, error: '' });
        return record;
    } catch (cause) {
        await recordAudit(source, { _id: randomUUID(), createdAt: now, updatedAt: now,
            workspaceId: ownerWorkspace(site), siteId: site._id, actorId, operation: 'publish', releaseId,
            error: cause instanceof Error ? cause.message : 'Publication failed' });
        throw cause;
    }
}

export async function rollbackRelease(source: ReleaseSource, actorId: string, releaseId: string, expectedReleaseId: string): Promise<void> {
    const site = await currentSite(source, expectedReleaseId);
    const now = Date.now();
    try {
        const target = await source.findRelease(releaseId);
        if (!target || (target.siteId !== site._id || ownerWorkspace(target) !== ownerWorkspace(site))) throw new Error('Release does not belong to this site');
        if (!(site.publishedReleaseIds || [site.currentReleaseId]).includes(releaseId)) throw new Error('Release was never published');
        const snapshot = JSON.parse(target.payload) as ReleaseSnapshot;
        if (snapshot.schemaVersion !== 1 || (snapshot.siteId !== site._id || ownerWorkspace(snapshot) !== ownerWorkspace(site))) throw new Error('Unsupported release snapshot');
        if (!await source.activate(site, target._id)) throw new Error('Site changed during rollback; refresh and retry');
        await recordAudit(source, { _id: randomUUID(), createdAt: now, updatedAt: now,
            workspaceId: ownerWorkspace(site), siteId: site._id, actorId, operation: 'rollback', releaseId, error: '' });
    } catch (cause) {
        await recordAudit(source, { _id: randomUUID(), createdAt: now, updatedAt: now,
            workspaceId: ownerWorkspace(site), siteId: site._id, actorId, operation: 'rollback', releaseId,
            error: cause instanceof Error ? cause.message : 'Rollback failed' });
        throw cause;
    }
}
