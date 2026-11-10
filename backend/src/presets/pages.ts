import type { Entry } from '../entry/models/main';
import { resolveInstalledPreset } from './installed';
import type { SiteInstallation, SitePage } from './site-model';
import {
    normalizeSectionConfigs,
    type SectionConfig,
} from '../storefront/section-schema';
import { ownerWorkspace } from '../workspaces/context';
import {
    layoutFromSectionConfigs,
    normalizeLayoutDocument,
    sectionConfigsFromLayout,
    type LayoutContract,
    type LayoutDocument,
} from '../storefront/layout-document';
import { withSiteMutation } from '../template-contract/site-mutation';

export function withPageMutation<T>(
    siteId: string,
    action: () => Promise<T>,
): Promise<T> {
    return withSiteMutation(siteId, action);
}

const sectionOptions: Record<
    string,
    { allowed: string[]; required: string[] }
> = {
    home: {
        allowed: ['hero-carousel', 'info-grid', 'faq'],
        required: ['hero-carousel'],
    },
    'collection-list': { allowed: ['info-grid', 'faq'], required: [] },
    'product-detail': {
        allowed: [
            'product-gallery',
            'product-information',
            'product-description',
            'faq',
        ],
        required: [
            'product-gallery',
            'product-information',
            'product-description',
        ],
    },
    'content-page': { allowed: ['info-grid', 'faq'], required: [] },
};

const reservedPathSegments = new Set([
    'api',
    'preview',
    'presets',
    'products',
    '_nuxt',
    '__nuxt',
    'sitemap.xml',
    'robots.txt',
]);

export interface PageSectionOptions {
    allowed: string[];
    required: string;
    requiredSections: string[];
    labels: Record<string, string>;
    visual: boolean;
}

const defaultLabels: Record<string, string> = {
    'hero-carousel': '首页轮播',
    'info-grid': '信息卡片',
    faq: '常见问题',
    'product-gallery': '商品图片',
    'product-information': '商品信息',
    'product-description': '商品详情',
};

function sectionOptionsResult(
    allowed: string[],
    required: string[],
    labels: Record<string, string> = {},
    visual = false,
): PageSectionOptions {
    return {
        allowed: [...allowed],
        required: required[0] || '',
        requiredSections: [...required],
        labels: Object.fromEntries(
            allowed.map((type) => [
                type,
                labels[type] || defaultLabels[type] || type,
            ]),
        ),
        visual,
    };
}

export function pageSectionOptions(layout: string): PageSectionOptions | null {
    const options = sectionOptions[layout];
    return options
        ? sectionOptionsResult(options.allowed, options.required)
        : null;
}

export function pageSectionOptionsForPage(
    site: SiteInstallation,
    pageKey: string,
): PageSectionOptions | null {
    const page = site.pages.find((item) => item.key === pageKey);
    if (!page) return null;
    const contract = contractForPage(resolveInstalledPreset(site), page);
    if (contract) {
        const definitions = resolveInstalledPreset(site).editor?.sections || [];
        const labels = Object.fromEntries(
            definitions.map((section) => [section.type, section.label]),
        );
        return sectionOptionsResult(
            contract.allowed,
            contract.required,
            labels,
            true,
        );
    }
    return pageSectionOptions(page.layout);
}

export interface PageSectionContract {
    allowed: string[];
    required: string[];
    singleton: string[];
    props: Record<string, Record<string, unknown>>;
    pathRule?: { type: 'fixed' | 'pattern'; value: string };
    allowNavigation?: boolean;
}

function legacySectionConfig(type: string): SectionConfig {
    const aliases: Record<string, SectionConfig['type']> = {
        hero: 'hero-carousel',
        feature: 'info-grid',
        heading: 'info-grid',
        grid: 'info-grid',
        gallery: 'product-gallery',
        information: 'product-information',
        description: 'product-description',
        story: 'info-grid',
    };
    const resolved = aliases[type] || type;
    return { type: resolved as SectionConfig['type'], enabled: true, data: {} };
}

function contractForPage(
    preset: ReturnType<typeof resolveInstalledPreset>,
    page: SitePage,
): PageSectionContract | null {
    const editorPage = preset.editor?.pages.find(
        (item) => item.pageKey === (page.blueprintKey || page.key),
    );
    if (!editorPage) return null;
    const sections = preset.editor?.sections || [];
    const allowed = [
        ...new Set(
            editorPage.sections.length
                ? editorPage.sections
                : sections
                      .filter((section) =>
                          section.allowedPages.includes(editorPage.pageKey),
                      )
                      .map((section) => section.type),
        ),
    ];
    // Legacy public manifests create an editor adapter for model fields and
    // routes, but do not declare editable page sections. They must continue to
    // use the renderer's established section contract.
    if (allowed.length === 0) return null;
    const definitions = new Map(
        sections.map((section) => [section.type, section]),
    );
    const required = allowed.filter((type) =>
        Boolean(definitions.get(type)?.required),
    );
    return {
        allowed,
        required,
        singleton: allowed.filter((type) =>
            Boolean(definitions.get(type)?.singleton),
        ),
        props: Object.fromEntries(
            allowed.map((type) => [type, definitions.get(type)?.props || {}]),
        ),
        pathRule: editorPage.pathRule,
        allowNavigation: editorPage.allowNavigation,
    };
}

function layoutContract(
    contract: PageSectionContract | null,
    includeProps = true,
): LayoutContract | undefined {
    return contract
        ? {
              sections: contract.allowed.map((type) => ({
                  type,
                  singleton: contract.singleton.includes(type),
                  required: contract.required.includes(type),
                  props: includeProps ? contract.props[type] || {} : {},
              })),
          }
        : undefined;
}

export type PageDraft = Omit<SitePage, 'creationReceipt'> & {
    seoTitle: string;
    seoDescription: string;
    sections: string[];
    sectionConfigs?: SectionConfig[];
    entryId: string;
    enabled?: boolean;
    navigation?: boolean;
    layoutDocument?: unknown;
};

export interface PageDraftUpdate {
    enabled?: boolean;
    navigation?: boolean;
    title: string;
    path: string;
    seoTitle: string;
    seoDescription: string;
    sections: string[];
    sectionConfigs?: Array<{
        type: string;
        enabled: boolean;
        data: Record<string, unknown>;
    }>;
    entryId: string;
    layoutDocument?: unknown;
}

export function pageDraft(
    site: SiteInstallation,
    key: string,
): PageDraft | null {
    const page = site.pages.find((item) => item.key === key);
    if (!page) return null;
    const options = sectionOptions[page.layout];
    const preset = resolveInstalledPreset(site);
    const pageContract = contractForPage(preset, page);
    if (!options && !pageContract)
        throw new Error(`Unsupported page layout ${page.layout}`);
    const contract = layoutContract(pageContract, Boolean(page.layoutDocument));
    const declaredSections =
        page.sections || pageContract?.allowed || options?.allowed || [];
    const configuredLegacy =
        !pageContract && Boolean(page.sectionConfigs || page.layoutDocument);
    const sectionConfigs = pageContract
        ? page.sectionConfigs
            ? (structuredClone(page.sectionConfigs) as SectionConfig[])
            : declaredSections.map((type) => ({
                  type: type as SectionConfig['type'],
                  enabled: true,
                  data: {},
              }))
        : configuredLegacy
          ? page.sectionConfigs
              ? (structuredClone(page.sectionConfigs) as SectionConfig[])
              : (sectionConfigsFromLayout(
                    normalizeLayoutDocument(
                        structuredClone(page.layoutDocument!),
                        contract,
                    ),
                ) as SectionConfig[])
          : undefined;
    const layoutDocument = page.layoutDocument
        ? normalizeLayoutDocument(
              structuredClone(page.layoutDocument),
              contract,
          )
        : pageContract
          ? normalizeLayoutDocument(
                layoutFromSectionConfigs(sectionConfigs!),
                contract,
            )
          : undefined;
    const { creationReceipt: _receipt, ...editable } = page;
    return {
        ...editable,
        seoTitle: page.seoTitle ?? page.title,
        seoDescription: page.seoDescription ?? '',
        sections: [...declaredSections],
        sectionConfigs,
        layoutDocument,
        entryId: page.entryId ?? '',
        enabled: page.enabled ?? true,
        navigation: page.navigation ?? !page.path.includes(':'),
    };
}

function patternMatches(pattern: string, path: string): boolean {
    const lhs = pattern.split('/');
    const rhs = path.split('/');
    return (
        lhs.length === rhs.length &&
        lhs.every((part, index) => part === rhs[index] || part.startsWith(':'))
    );
}

function pathRuleMatches(
    rule: { type: 'fixed' | 'pattern'; value: string },
    path: string,
): boolean {
    if (rule.type === 'fixed') return path === rule.value;
    const parts = rule.value.split('/').filter(Boolean);
    const actual = path.split('/').filter(Boolean);
    return (
        parts.length === actual.length &&
        parts.every((part, index) =>
            part.startsWith(':')
                ? /^[a-z0-9-]+$/.test(actual[index])
                : part === actual[index],
        )
    );
}

export function updatePageDraft(
    site: SiteInstallation,
    key: string,
    input: PageDraftUpdate,
    boundEntry?: Entry | null,
): SiteInstallation {
    const page = pageDraft(site, key);
    if (!page) throw new Error('Page not found');
    const preset = resolveInstalledPreset(site);
    if (
        !preset.pages.some(
            (item) =>
                item.key === (page.blueprintKey || key) &&
                item.layout === page.layout &&
                item.modelKey === page.modelKey,
        )
    ) {
        throw new Error('Unsupported preset page');
    }
    const options = sectionOptions[page.layout];
    const pageContract = contractForPage(preset, page);
    if (!options && !pageContract)
        throw new Error(`Unsupported page layout ${page.layout}`);
    const layoutSchema = layoutContract(pageContract);
    const title = input.title.trim();
    const seoTitle = input.seoTitle.trim();
    const seoDescription = input.seoDescription.trim();
    if (
        !title ||
        title.length > 120 ||
        seoTitle.length > 120 ||
        seoDescription.length > 320
    ) {
        throw new Error('Invalid title or SEO text');
    }
    const path = input.path.trim();
    if (
        pageContract?.pathRule?.type === 'fixed' &&
        path !== pageContract.pathRule.value
    ) {
        throw new Error('This page path is fixed');
    }
    // Keep the untouched parameterized blueprint valid while concrete pages
    // must satisfy its declared pattern.
    const patternBlueprint =
        pageContract?.pathRule?.type === 'pattern' &&
        !page.blueprintKey &&
        path === page.path &&
        path === pageContract.pathRule.value;
    if (
        pageContract?.pathRule?.type === 'pattern' &&
        !patternBlueprint &&
        !pathRuleMatches(pageContract.pathRule, path)
    ) {
        throw new Error('Invalid page path');
    }
    const customContentPage = Boolean(
        page.blueprintKey && page.layout === 'content-page',
    );
    // Only the installed product contract may occupy the reserved product prefix.
    const contractProductPage =
        page.layout === 'product-detail' &&
        page.modelKey === 'product' &&
        pageContract?.pathRule?.type === 'pattern' &&
        pageContract.pathRule.value === '/products/:slug' &&
        pathRuleMatches(pageContract.pathRule, path);
    const contractPatternPage =
        pageContract?.pathRule?.type === 'pattern' &&
        pathRuleMatches(pageContract.pathRule, path);
    if (
        !customContentPage &&
        (page.path === '/' || page.path.includes(':')) &&
        !pageContract?.pathRule &&
        path !== page.path
    ) {
        throw new Error('This page path is fixed');
    }
    if (!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(path)) {
        if (path !== page.path) throw new Error('Invalid page path');
    }
    if (
        reservedPathSegments.has(path.split('/')[1]) &&
        !(
            page.path === '/products/:slug' &&
            path === page.path &&
            !page.blueprintKey
        ) &&
        !contractProductPage
    ) {
        throw new Error('Page path is reserved');
    }
    if (
        site.pages.some(
            (other) =>
                other.key !== key &&
                !(
                    (customContentPage ||
                        contractPatternPage ||
                        contractProductPage) &&
                    other.key === page.blueprintKey &&
                    !other.blueprintKey &&
                    other.layout === page.layout
                ) &&
                !(
                    path === page.path &&
                    path.includes(':') &&
                    !page.blueprintKey &&
                    other.blueprintKey === page.key &&
                    other.layout === page.layout &&
                    other.modelKey === page.modelKey
                ) &&
                (patternMatches(other.path, path) ||
                    patternMatches(path, other.path)),
        )
    ) {
        throw new Error('Page path conflicts with another blueprint');
    }
    const allowedSections = pageContract?.allowed || options!.allowed;
    const requiredSections = pageContract?.required || options!.required;
    if (
        input.sections.length === 0 ||
        requiredSections.some((section) => !input.sections.includes(section)) ||
        new Set(input.sections).size !== input.sections.length ||
        input.sections.some((section) => !allowedSections.includes(section))
    ) {
        throw new Error('Invalid page sections');
    }
    const enabled = input.enabled ?? page.enabled;
    if (input.entryId && enabled !== false) {
        const model = site.models.find((item) => item.key === page.modelKey);
        if (
            (page.layout !== 'home' && !page.blueprintKey) ||
            !model ||
            !boundEntry ||
            boundEntry._id !== input.entryId ||
            boundEntry.templateId !== model.templateId ||
            ownerWorkspace(boundEntry) !== ownerWorkspace(site) ||
            Boolean(boundEntry.siteId && boundEntry.siteId !== site._id)
        ) {
            throw new Error('Invalid page Entry binding');
        }
    }
    const publishedPaths = new Set(
        site.pages
            .filter(
                (item) => item.enabled !== false && !item.path.includes(':'),
            )
            .map((item) => item.path),
    );
    const hasExplicitLayout =
        input.layoutDocument !== undefined ||
        input.sectionConfigs !== undefined;
    const hasStoredLayout =
        page.layoutDocument !== undefined || page.sectionConfigs !== undefined;
    let layoutDocument: LayoutDocument | undefined;
    let sectionConfigs: SectionConfig[] | undefined;
    if (pageContract) {
        const incomingLayout =
            input.layoutDocument !== undefined
                ? normalizeLayoutDocument(
                      structuredClone(input.layoutDocument) as LayoutDocument,
                      layoutSchema,
                  )
                : page.layoutDocument
                  ? normalizeLayoutDocument(
                        structuredClone(page.layoutDocument),
                        layoutSchema,
                    )
                  : undefined;
        layoutDocument =
            incomingLayout ||
            normalizeLayoutDocument(
                layoutFromSectionConfigs(
                    input.sectionConfigs ||
                        (input.sections || []).map(legacySectionConfig),
                ),
                layoutSchema,
            );
        sectionConfigs = sectionConfigsFromLayout(
            layoutDocument,
            layoutSchema,
        ) as SectionConfig[];
    } else if (hasExplicitLayout || hasStoredLayout) {
        if (input.sectionConfigs) {
            sectionConfigs = normalizeSectionConfigs(
                page.layout,
                input.sectionConfigs as SectionConfig[],
                { publishedPaths },
            );
        } else {
            const incomingLayout = input.layoutDocument !== undefined
                ? normalizeLayoutDocument(
                      structuredClone(input.layoutDocument) as LayoutDocument,
                  )
                : page.layoutDocument
                    ? normalizeLayoutDocument(
                          structuredClone(page.layoutDocument),
                      )
                    : undefined;
            if (incomingLayout) {
                layoutDocument = incomingLayout;
                sectionConfigs = normalizeSectionConfigs(
                    page.layout,
                    sectionConfigsFromLayout(incomingLayout) as SectionConfig[],
                    { publishedPaths },
                );
            } else if (page.sectionConfigs) {
                sectionConfigs = normalizeSectionConfigs(
                    page.layout,
                    page.sectionConfigs,
                    { publishedPaths },
                );
            }
        }
    }
    const updated: PageDraft = {
        ...page,
        title,
        path,
        seoTitle,
        seoDescription,
        sections: [...input.sections],
        entryId: input.entryId,
        sectionConfigs,
        layoutDocument,
        enabled: input.enabled ?? page.enabled,
        navigation: input.navigation ?? page.navigation,
    };
    if (page.layout === 'home' && updated.enabled === false)
        throw new Error('Home page is required');
    if (page.blueprintKey && enabled !== false && !input.entryId)
        throw new Error('A new page requires an Entry binding');
    return {
        ...site,
        updatedAt: Date.now(),
        pages: site.pages.map((item) =>
            item.key === key
                ? {
                      ...updated,
                      ...(item.creationReceipt
                          ? { creationReceipt: item.creationReceipt }
                          : {}),
                  }
                : item,
        ),
    };
}

export function createPageDraft(
    site: SiteInstallation,
    key: string,
    input: PageDraftUpdate & { blueprintKey: string },
    boundEntry?: Entry | null,
): SiteInstallation {
    if (
        !/^[a-z0-9-]{1,80}$/.test(key) ||
        site.pages.some((page) => page.key === key)
    ) {
        throw new Error('Invalid or duplicate page key');
    }
    const preset = resolveInstalledPreset(site);
    const blueprint = preset.pages.find(
        (page) => page.key === input.blueprintKey,
    );
    if (!blueprint || blueprint.layout === 'home')
        throw new Error('Unsupported page blueprint');
    if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(input.path)) {
        if (reservedPathSegments.has(input.path.split('/')[1]))
            throw new Error('Page path is reserved');
        throw new Error('Invalid page path');
    }
    const candidate: SiteInstallation = {
        ...site,
        pages: [
            ...site.pages,
            {
                ...blueprint,
                key,
                blueprintKey: blueprint.key,
                path: input.path,
                status: 'draft',
            },
        ],
    };
    return updatePageDraft(candidate, key, input, boundEntry);
}
