import type { Group } from '../group/models/main';
import type { Media } from '../media/models/main';
import type { Prop } from '../prop/models/main';
import { propsValueCheck } from '../prop/values';
import type { Template } from '../template/models/main';
import type { Widget } from '../widget/models/main';
import { entryContentNodeToHtml } from './content';
import type { EntryCreateBody } from './models/controller';

export function prepareEntryCreate(
    body: EntryCreateBody,
    props: Prop[],
    languages: string[],
    statusIds: string[],
    widgets: Widget[],
    groups: Group[],
    templates: Template[],
    medias: Media[],
): EntryCreateBody {
    const metaLanguages = new Set<string>();
    for (const meta of body.meta) {
        if (!languages.includes(meta.lng) || metaLanguages.has(meta.lng)) {
            throw new Error(`Invalid or duplicate language ${meta.lng}`);
        }
        metaLanguages.add(meta.lng);
        const invalid = propsValueCheck(props, meta.props, `body.meta.${meta.lng}.props`,
            widgets, groups, templates, medias);
        if (invalid instanceof Error) throw invalid;
    }
    const contentLanguages = new Set<string>();
    const content = body.content.map((item) => {
        if (!metaLanguages.has(item.lng) || contentLanguages.has(item.lng) || !Array.isArray(item.nodes)) {
            throw new Error(`Content needs matching metadata for language ${item.lng}`);
        }
        contentLanguages.add(item.lng);
        return {
            lng: item.lng,
            nodes: item.nodes,
            plainText: item.nodes.map((node) => entryContentNodeToHtml(node)).join('\n'),
        };
    });
    if (contentLanguages.size !== metaLanguages.size) {
        throw new Error('Content needs matching metadata for every language');
    }
    const statusLanguages = new Set<string>();
    for (const status of body.statuses) {
        if (!languages.includes(status.lng) || !statusIds.includes(status.id) ||
            statusLanguages.has(status.lng) || !metaLanguages.has(status.lng)) {
            throw new Error(`Invalid status for language ${status.lng}`);
        }
        statusLanguages.add(status.lng);
    }
    return { statuses: body.statuses, meta: body.meta, content };
}
