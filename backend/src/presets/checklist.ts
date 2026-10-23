import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import type { SiteInstallation } from './site-model';

export interface ChecklistStep {
    key: 'theme' | 'brand' | 'product' | 'collection' | 'home' | 'content' | 'publish';
    complete: boolean;
    available: boolean;
    count: number;
    href: string;
}

function hasRequiredValues(entry: Entry, template: Template): boolean {
    return entry.meta.some((language) => template.props.every((prop) => {
        if (!prop.required) return true;
        const value = language.props.find((item) => item.id === prop.id)?.data;
        if (!Array.isArray(value) || value.length === 0) return false;
        return value.some((item) => item !== null && item !== undefined &&
            (typeof item !== 'string' || item.trim().length > 0));
    }));
}

export function buildChecklist(
    site: SiteInstallation,
    templates: Record<string, Template | undefined>,
    entries: Record<string, Entry[] | undefined>,
): ChecklistStep[] {
    const steps: ChecklistStep[] = [{
        key: 'theme', complete: site.status === 'ready', available: true, count: site.status === 'ready' ? 1 : 0,
        href: '/d/presets',
    }];
    const modelSteps = [
        ['brand', 'site-settings'], ['product', 'product'], ['collection', 'collection'],
        ['home', 'home'], ['content', 'content-page'],
    ] as const;
    for (const [key, modelKey] of modelSteps) {
        const model = site.models.find((item) => item.key === modelKey);
        const template = templates[modelKey];
        const validEntries = template ? (entries[modelKey] || []).filter((entry) => hasRequiredValues(entry, template)) : [];
        const count = validEntries.length;
        steps.push({
            key, complete: count > 0, available: !!model, count,
            href: model ? `/d/template/${model.templateId}/entry/${validEntries[0]?._id || 'create'}` : '',
        });
    }
    steps.push({ key: 'publish', complete: false, available: false, count: 0, href: '' });
    return steps;
}
