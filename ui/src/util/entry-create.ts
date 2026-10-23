import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import type { EntryCreateBody } from '@bcms/selfhosted-backend/entry/models/controller';
import type { EntryContentNodeWidgetAttr } from '@bcms/selfhosted-backend/entry/models/content';

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
        meta,
        content: entry.content
            .filter((item) => languages.has(item.lng))
            .map((item) => ({
                ...item,
                nodes: item.nodes.map((node) => {
                    if (node.type !== 'widget') return node;
                    const copy = JSON.parse(JSON.stringify(node));
                    const attrs = copy.attrs as EntryContentNodeWidgetAttr;
                    attrs.data =
                        typeof attrs.data === 'string'
                            ? JSON.parse(attrs.data)
                            : attrs.data;
                    delete (attrs as any).widgetId;
                    return copy;
                }),
            })),
    };
}
