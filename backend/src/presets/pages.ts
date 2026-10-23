import type { Entry } from '../entry/models/main';
import { getPreset } from './catalog';
import type { SiteInstallation, SitePage } from './site-model';

const sectionOptions: Record<string, { allowed: string[]; required: string }> = {
    home: { allowed: ['hero', 'feature'], required: 'hero' },
    'collection-list': { allowed: ['heading', 'grid'], required: 'heading' },
    'product-detail': { allowed: ['gallery', 'information', 'description'], required: 'information' },
    'content-page': { allowed: ['story'], required: 'story' },
};

const reservedPathSegments = new Set(['api', 'preview', 'presets', 'products', '_nuxt', '__nuxt', 'sitemap.xml', 'robots.txt']);

export function pageSectionOptions(layout: string): { allowed: string[]; required: string } | null {
    const options = sectionOptions[layout];
    return options ? { allowed: [...options.allowed], required: options.required } : null;
}

export type PageDraft = SitePage & {
    seoTitle: string;
    seoDescription: string;
    sections: string[];
    entryId: string;
    enabled?: boolean;
    navigation?: boolean;
};

export interface PageDraftUpdate {
    enabled?: boolean;
    navigation?: boolean;
    title: string;
    path: string;
    seoTitle: string;
    seoDescription: string;
    sections: string[];
    entryId: string;
}

export function pageDraft(site: SiteInstallation, key: string): PageDraft | null {
    const page = site.pages.find((item) => item.key === key);
    if (!page) return null;
    const options = sectionOptions[page.layout];
    if (!options) throw new Error(`Unsupported page layout ${page.layout}`);
    return {
        ...page,
        seoTitle: page.seoTitle ?? page.title,
        seoDescription: page.seoDescription ?? '',
        sections: [...(page.sections ?? options.allowed)],
        entryId: page.entryId ?? '',
        enabled: page.enabled ?? true,
        navigation: page.navigation ?? !page.path.includes(':'),
    };
}

function patternMatches(pattern: string, path: string): boolean {
    const lhs = pattern.split('/');
    const rhs = path.split('/');
    return lhs.length === rhs.length && lhs.every((part, index) => part === rhs[index] || part.startsWith(':'));
}

export function updatePageDraft(
    site: SiteInstallation, key: string, input: PageDraftUpdate, boundEntry?: Entry | null,
): SiteInstallation {
    const page = pageDraft(site, key);
    if (!page) throw new Error('Page not found');
    const preset = getPreset(site.presetId, site.presetVersion);
    if (!preset || !preset.pages.some((item) => item.key === (page.blueprintKey || key) &&
        item.layout === page.layout && item.modelKey === page.modelKey)) {
        throw new Error('Unsupported preset page');
    }
    const options = sectionOptions[page.layout];
    const title = input.title.trim();
    const seoTitle = input.seoTitle.trim();
    const seoDescription = input.seoDescription.trim();
    if (!title || title.length > 120 || seoTitle.length > 120 || seoDescription.length > 320) {
        throw new Error('Invalid title or SEO text');
    }
    const path = input.path.trim();
    if ((page.path === '/' || page.path.includes(':')) && path !== page.path) {
        throw new Error('This page path is fixed');
    }
    if (!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(path)) {
        if (path !== page.path) throw new Error('Invalid page path');
    }
    if (reservedPathSegments.has(path.split('/')[1]) &&
        !(page.path === '/products/:slug' && path === page.path && !page.blueprintKey)) {
        throw new Error('Page path is reserved');
    }
    if (site.pages.some((other) => other.key !== key &&
        (patternMatches(other.path, path) || patternMatches(path, other.path)))) {
        throw new Error('Page path conflicts with another blueprint');
    }
    if (input.sections.length === 0 || !input.sections.includes(options.required) ||
        new Set(input.sections).size !== input.sections.length ||
        input.sections.some((section) => !options.allowed.includes(section))) {
        throw new Error('Invalid page sections');
    }
    const enabled = input.enabled ?? page.enabled;
    if (input.entryId && enabled !== false) {
        const model = site.models.find((item) => item.key === page.modelKey);
        if ((page.layout !== 'home' && !page.blueprintKey) || !model || !boundEntry ||
            boundEntry._id !== input.entryId || boundEntry.templateId !== model.templateId) {
            throw new Error('Invalid page Entry binding');
        }
    }
    const updated: PageDraft = {
        ...page, title, path, seoTitle, seoDescription,
        sections: [...input.sections], entryId: input.entryId,
        enabled: input.enabled ?? page.enabled,
        navigation: input.navigation ?? page.navigation,
    };
    if (page.layout === 'home' && updated.enabled === false) throw new Error('Home page is required');
    if (page.blueprintKey && enabled !== false && !input.entryId) throw new Error('A new page requires an Entry binding');
    return {
        ...site,
        updatedAt: Date.now(),
        pages: site.pages.map((item) => item.key === key ? updated : item),
    };
}

export function createPageDraft(site: SiteInstallation, key: string,
    input: PageDraftUpdate & { blueprintKey: string }, boundEntry?: Entry | null): SiteInstallation {
    if (!/^[a-z0-9-]{1,80}$/.test(key) || site.pages.some((page) => page.key === key)) {
        throw new Error('Invalid or duplicate page key');
    }
    const preset = getPreset(site.presetId, site.presetVersion);
    const blueprint = preset?.pages.find((page) => page.key === input.blueprintKey);
    if (!blueprint || blueprint.layout === 'home') throw new Error('Unsupported page blueprint');
    if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(input.path)) {
        if (reservedPathSegments.has(input.path.split('/')[1])) throw new Error('Page path is reserved');
        throw new Error('Invalid page path');
    }
    const candidate: SiteInstallation = { ...site, pages: [...site.pages, {
        ...blueprint, key, blueprintKey: blueprint.key, path: input.path, status: 'draft',
    }] };
    return updatePageDraft(candidate, key, input, boundEntry);
}
