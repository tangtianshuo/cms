import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import { type PresetManifest } from '../presets/catalog';
import { resolveInstalledPreset } from '../presets/installed';
import { pageDraft } from '../presets/pages';
import type { SiteInstallation } from '../presets/site-model';

export interface PresetPagePreview {
    kind: 'preset-page';
    view: 'home' | 'collection' | 'product' | 'page';
    preset: Pick<PresetManifest, 'id' | 'version' | 'name' | 'description' | 'theme' | 'demo' | 'showcase'>;
    sections: string[];
    seo: { title: string; description: string };
}

export interface PresetPagePreviewInput {
    site: SiteInstallation;
    pageKey: string;
    entry: Entry;
    language: string;
    availableLanguages: string[];
    relatedEntries: Entry[];
    media: Media[];
    mediaOrigin: string;
    currency: string;
}

function fieldData(site: SiteInstallation, modelKey: string, entry: Entry | undefined,
    language: string, fieldKey: string): unknown[] {
    if (!entry) return [];
    const mapping = site.models.find((model) => model.key === modelKey);
    const field = mapping?.fields.find((item) => item.key === fieldKey);
    if (!mapping || !field || entry.templateId !== mapping.templateId) {
        throw new Error(`Invalid ${fieldKey} binding`);
    }
    const meta = entry.meta.find((item) => item.lng === language);
    if (!meta) throw new Error('Entry has no data for selected language');
    const value = meta.props.find((item) => item.id === field.propId);
    const preset = resolveInstalledPreset(site);
    const required = preset?.models.find((model) => model.key === modelKey)?.fields
        .find((item) => item.key === fieldKey)?.required;
    if (!value && required) throw new Error(`Missing bound field ${fieldKey}`);
    return Array.isArray(value?.data) ? value.data as unknown[] : [];
}

function text(site: SiteInstallation, modelKey: string, entry: Entry | undefined,
    language: string, fieldKey: string): string {
    const value = fieldData(site, modelKey, entry, language, fieldKey)[0];
    return typeof value === 'string' ? value.trim() : '';
}

function richText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(richText).filter(Boolean).join(' ');
    if (value && typeof value === 'object') {
        const node = value as { text?: unknown; content?: unknown; nodes?: unknown };
        if (typeof node.text === 'string') return node.text;
        return richText(node.content ?? node.nodes);
    }
    return '';
}

function image(site: SiteInstallation, modelKey: string, entry: Entry | undefined,
    language: string, fieldKey: string, media: Media[], mediaOrigin: string): string {
    const value = fieldData(site, modelKey, entry, language, fieldKey)[0];
    if (!value || typeof value !== 'object' || !('_id' in value) || typeof value._id !== 'string') return '';
    const found = media.find((item) => item._id === value._id && item.mimetype.startsWith('image/'));
    if (!found) return '';
    return `${new URL(mediaOrigin).origin}/api/v4/media/${encodeURIComponent(found._id)}/bin/image${found.accessToken ? '?cap=' + encodeURIComponent(found.accessToken) : ''}`;
}

function pointer(site: SiteInstallation, modelKey: string, entry: Entry | undefined,
    language: string, fieldKey: string, targetKey: string, relatedEntries: Entry[]): Entry | undefined {
    const value = fieldData(site, modelKey, entry, language, fieldKey)[0];
    const target = site.models.find((model) => model.key === targetKey);
    if (!target || !value || typeof value !== 'object' ||
        !('tid' in value) || !('eid' in value) || value.tid !== target.templateId ||
        typeof value.eid !== 'string') return undefined;
    return relatedEntries.find((item) => item._id === value.eid && item.templateId === target.templateId);
}

export function previewPresetPage(input: PresetPagePreviewInput): PresetPagePreview {
    const { site, entry, language } = input;
    if (site.status !== 'ready') throw new Error('Site import is not ready');
    const manifest = resolveInstalledPreset(site);
    const page = pageDraft(site, input.pageKey);
    if (!page) throw new Error('Unknown preset page');
    if (!input.availableLanguages.includes(language)) throw new Error('Invalid preview language');
    const selectedModel = site.models.find((model) => model.templateId === entry.templateId);
    if (!selectedModel || (selectedModel.key !== page.modelKey && selectedModel.key !== 'site-settings')) {
        throw new Error('Entry template does not match the selected page');
    }
    const pageModel = site.models.find((model) => model.key === page.modelKey);
    const pageEntry = selectedModel.key === page.modelKey ? entry :
        input.relatedEntries.find((item) => item.templateId === pageModel?.templateId &&
            (!page.entryId || item._id === page.entryId));
    const settingsModel = site.models.find((model) => model.key === 'site-settings');
    const settingsEntry = selectedModel.key === 'site-settings' ? entry :
        input.relatedEntries.find((item) => item.templateId === settingsModel?.templateId);
    const brand = settingsEntry
        ? text(site, 'site-settings', settingsEntry, language, 'brandName') || site.name : site.name;
    const demo: PresetManifest['demo'] = {
        brand,
        contactEmail: settingsEntry ? text(site, 'site-settings', settingsEntry, language, 'contactEmail') : manifest.demo.contactEmail,
        hero: { title: '', subtitle: '', image: '' },
        product: { title: '', price: '', image: '', description: '' },
        collection: { title: '', description: '', image: '' },
        page: { title: '', body: '', image: '' },
    };
    const view = page.layout === 'collection-list' ? 'collection' :
        page.layout === 'product-detail' ? 'product' :
        page.layout === 'content-page' ? 'page' : 'home';
    if (view === 'home') {
        demo.hero = {
            title: text(site, 'home', pageEntry, language, 'headline'),
            subtitle: text(site, 'home', pageEntry, language, 'intro'),
            image: image(site, 'home', pageEntry, language, 'heroImage', input.media, input.mediaOrigin),
        };
        const collection = pointer(site, 'home', pageEntry, language, 'featuredCollections',
            'collection', input.relatedEntries);
        if (collection) demo.collection = {
            title: text(site, 'collection', collection, language, 'title'),
            description: text(site, 'collection', collection, language, 'description'),
            image: image(site, 'collection', collection, language, 'cover', input.media, input.mediaOrigin),
        };
    } else if (view === 'collection') {
        demo.collection = {
            title: text(site, 'collection', pageEntry, language, 'title'),
            description: text(site, 'collection', pageEntry, language, 'description'),
            image: image(site, 'collection', pageEntry, language, 'cover', input.media, input.mediaOrigin),
        };
        const product = pointer(site, 'collection', pageEntry, language, 'products',
            'product', input.relatedEntries);
        if (product) demo.product = {
            title: text(site, 'product', product, language, 'title'),
            price: '', description: text(site, 'product', product, language, 'description'),
            image: image(site, 'product', product, language, 'images', input.media, input.mediaOrigin),
        };
    } else if (view === 'product') {
        const price = fieldData(site, 'product', pageEntry, language, 'price')[0];
        demo.product = {
            title: text(site, 'product', pageEntry, language, 'title'),
            description: text(site, 'product', pageEntry, language, 'description'),
            image: image(site, 'product', pageEntry, language, 'images', input.media, input.mediaOrigin),
            price: typeof price === 'number' && Number.isFinite(price)
                ? new Intl.NumberFormat(language, { style: 'currency', currency: input.currency }).format(price) : '',
        };
    } else {
        const body = fieldData(site, 'content-page', pageEntry, language, 'body')[0];
        demo.page = {
            title: text(site, 'content-page', pageEntry, language, 'title'),
            body: richText(body) || text(site, 'content-page', pageEntry, language, 'summary'),
            image: image(site, 'content-page', pageEntry, language, 'cover', input.media, input.mediaOrigin),
        };
    }
    const seoDescription = page.seoDescription || (view === 'page'
        ? text(site, 'content-page', pageEntry, language, 'seoDescription') : '');
    return {
        kind: 'preset-page', view,
        preset: { id: manifest.id, version: manifest.version, name: site.name, description: '',
            theme: site.theme, demo, showcase: manifest.showcase ? structuredClone(manifest.showcase) : undefined },
        sections: page.sections,
        seo: { title: page.seoTitle || (view === 'page' ? demo.page.title : site.name), description: seoDescription },
    };
}
