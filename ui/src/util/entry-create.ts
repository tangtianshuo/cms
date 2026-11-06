import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import type { EntryCreateBody } from '@bcms/selfhosted-backend/entry/models/controller';
import type { PropValue } from '@bcms/selfhosted-backend/prop/models/main';
import type {
    EntryContentNode,
    EntryContentNodeWidgetAttr,
} from '@bcms/selfhosted-backend/entry/models/content';

/** Normalize only declared content envelopes; ordinary media/reference data stays intact. */
export function entryPropValuesForSave(values: PropValue[]): PropValue[] {
    return values.map((value) => {
        const data = value.data;
        if (Array.isArray(data))
            return {
                ...value,
                data: data.map((item) =>
                    item &&
                    typeof item === 'object' &&
                    'nodes' in item &&
                    Array.isArray(item.nodes)
                        ? {
                              ...item,
                              nodes: entryContentNodesForSave(item.nodes),
                          }
                        : item,
                ) as PropValue['data'],
            };
        if (data && 'props' in data)
            return {
                ...value,
                data: { ...data, props: entryPropValuesForSave(data.props) },
            };
        if (data && 'items' in data)
            return {
                ...value,
                data: {
                    ...data,
                    items: data.items.map((item) => ({
                        ...item,
                        props: entryPropValuesForSave(item.props),
                    })),
                },
            };
        return value;
    });
}

export function entryContentNodesForSave(
    nodes: EntryContentNode[],
): EntryContentNode[] {
    return nodes.map((node) => {
        const copy = {
            ...node,
            ...(node.content
                ? { content: entryContentNodesForSave(node.content) }
                : {}),
        };
        if (node.type === 'widget' && node.attrs) {
            const attrs = { ...node.attrs } as EntryContentNodeWidgetAttr;
            const data =
                typeof attrs.data === 'string'
                    ? JSON.parse(attrs.data)
                    : attrs.data;
            attrs.data = { ...data, props: entryPropValuesForSave(data.props) };
            delete (attrs as any).widgetId;
            copy.attrs = attrs;
        }
        return copy;
    });
}

export function buildEntryCreateBody(
    entry: Pick<Entry, 'statuses' | 'meta' | 'content'>,
): EntryCreateBody {
    const meta = entry.meta.filter((item) => {
        const title = item.props[0]?.data as string[] | undefined;
        const slug = item.props[1]?.data as string[] | undefined;
        return !!title?.[0]?.trim() && !!slug?.[0]?.trim();
    });
    const languages = new Set(meta.map((item) => item.lng));
    return {
        statuses: entry.statuses.filter((item) => languages.has(item.lng)),
        meta: meta.map((item) => ({
            ...item,
            props: entryPropValuesForSave(item.props),
        })),
        content: entry.content
            .filter((item) => languages.has(item.lng))
            .map((item) => ({
                ...item,
                nodes: entryContentNodesForSave(item.nodes),
            })),
    };
}
