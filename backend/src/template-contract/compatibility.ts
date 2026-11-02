import type { TemplateCompatibility, TemplateEditorContract } from './model';

export type TemplateCompatibilityStatus = 'display-compatible' | 'data-compatible' | 'migration-required' | 'incompatible';
export interface TemplateInstallation { id: string; version: string; siteConfig?: Record<string, unknown>; }
export interface TemplateRequest { id: string; version: string; compatibility?: TemplateCompatibility; }

export function classifyTemplateCompatibility(current: TemplateInstallation, next: TemplateRequest): TemplateCompatibilityStatus {
    if (current.id !== next.id) return 'incompatible';
    if (current.version === next.version) return 'data-compatible';
    const target = `${next.id}@${next.version}`;
    const source = `${current.id}@${current.version}`;
    const migration = next.compatibility?.migrations?.some((item) => item.from === source && item.to === target);
    return migration ? 'migration-required' : 'display-compatible';
}

export function createMigrationPlan(current: TemplateInstallation, next: TemplateRequest): { from: string; to: string; steps: Array<Record<string, unknown>> } {
    const from = `${current.id}@${current.version}`;
    const to = `${next.id}@${next.version}`;
    if (current.id !== next.id) throw new Error('Template migration requires the same template id');
    const migration = next.compatibility?.migrations?.find((item) => item.from === from && item.to === to);
    if (!migration) throw new Error(`No migration is declared from ${from} to ${to}`);
    return { from, to, steps: migration.steps.map((step) => ({ ...step })) };
}

function controlFor(type: unknown): TemplateEditorContract['models'][number]['fields'][number]['control'] {
    const value = String(type || '').toLowerCase();
    if (value.includes('number')) return 'number';
    if (value.includes('bool')) return 'boolean';
    if (value.includes('date')) return 'date';
    if (value.includes('media') || value.includes('image')) return 'media';
    if (value.includes('rich')) return 'rich-text';
    if (value.includes('enum')) return 'enum';
    if (value.includes('reference') || value.includes('pointer')) return 'reference';
    return 'text';
}

export function createLegacyEditorAdapter(manifest: { id: string; version: string; models?: Array<{ key: string; label?: string; fields?: Array<{ key: string; label?: string; type?: unknown; required?: boolean; array?: boolean }> }>; pages?: Array<{ key: string; modelKey?: string; path?: string; layout?: string | string[] }> }): { contract: TemplateEditorContract; source: 'legacy-model-fields' } {
    const models = (manifest.models || []).map((model) => ({
        modelKey: model.key,
        fields: (model.fields || []).map((field) => ({ key: field.key, label: field.label || field.key, control: controlFor(field.type), required: Boolean(field.required), ...(field.array ? { group: 'array' } : {}) })),
    }));
    const pages = (manifest.pages || []).map((page) => ({
        pageKey: page.key,
        modelKey: page.modelKey || page.key,
        pathRule: { type: 'fixed' as const, value: page.path || '/' },
        allowNavigation: true,
        sections: Array.isArray(page.layout) ? page.layout : page.layout ? [page.layout] : [],
    }));
    const sectionNames = [...new Set(pages.flatMap((page) => page.sections))];
    const sections = sectionNames.map((type) => ({ type, label: type, allowedPages: pages.filter((page) => page.sections.includes(type)).map((page) => page.pageKey), singleton: false, required: false, props: {} }));
    return {
        source: 'legacy-model-fields',
        contract: { schemaVersion: 1, models, pages, sections, operations: { canCreatePages: true, canEditNavigation: true, canPublish: true } },
    };
}
