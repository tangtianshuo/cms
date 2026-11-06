import { PropType, type Prop, type PropValue } from '../prop/models/main';
import { ownerWorkspace } from '../workspaces/context';
import { mediaReferenceAllowedForSite } from '../_utils/site-media';
import { ContentScopeError } from '../workspaces/scoped-collection';
import type { Entry } from './models/main';
import type { EntryContentNode } from './models/content';

type OwnedReference = { _id: string; workspaceId?: string; siteId?: string };
type Structure = OwnedReference & { props: Prop[] };
type Lookup<T> = { findById(id: string): Promise<T | null | undefined> };
export interface EntrySiteReferenceSource {
    siteInstallation: Lookup<OwnedReference & { contentGroupId?: string }>;
    template: Lookup<Structure>;
    entry: Lookup<OwnedReference & { templateId: string }>;
    media: Lookup<OwnedReference>;
    widget: Lookup<Structure>;
    group: Lookup<Structure>;
    entryGroup: Lookup<OwnedReference>;
}

/** Additional provenance checks for adopted site-bound writes. The repository
 * continues to own ordinary workspace/schema authorization and historical writes. */
export async function validateEntrySiteReferences(
    entry: Pick<Entry, 'siteId' | 'templateId' | 'groupId' | 'meta' | 'content'>,
    template: Structure,
    source: EntrySiteReferenceSource,
    language?: string,
): Promise<void> {
    const siteId = entry.siteId || template.siteId;
    if (!siteId) return;
    const denied = (kind: string) => new ContentScopeError(`${kind} reference not found or not permitted in selected site`);
    const site = await source.siteInstallation.findById(siteId);
    if (!site) throw denied('Site');
    const authorized = <T extends OwnedReference>(resource: T | null | undefined, kind: string, media = false): T => {
        if (!resource || ownerWorkspace(resource) !== ownerWorkspace(site) ||
            (resource.siteId && resource.siteId !== site._id) ||
            (media && !mediaReferenceAllowedForSite(resource, site))) throw denied(kind);
        return resource;
    };
    authorized(template, 'Template');
    if (entry.templateId !== template._id) throw denied('Template');
    if (entry.groupId && ![`default:${ownerWorkspace(site)}`, site.contentGroupId || site._id].includes(entry.groupId)) {
        authorized(await source.entryGroup.findById(entry.groupId), 'Entry group');
    }
    const content = async (nodes: EntryContentNode[]) => {
        for (const node of nodes || []) {
            if (node.type === 'widget') {
                const data = (node.attrs as { data?: { _id: string; props: PropValue[] } })?.data;
                if (!data?._id) throw denied('Widget');
                const widget = authorized(await source.widget.findById(data._id), 'Widget');
                await values(widget.props, data.props);
            }
            await content(node.content || []);
        }
    };
    const values = async (props: Prop[], items: PropValue[]) => {
        for (const value of items || []) {
            const definition = props.find(prop => prop.id === value.id);
            if (!definition) throw denied('Property');
            const data = value.data as any;
            if (definition.type === PropType.MEDIA) for (const media of data || []) {
                if (media._id) authorized(await source.media.findById(media._id), 'Media', true);
            }
            if (definition.type === PropType.ENTRY_POINTER) for (const pointer of data || []) {
                const targetTemplate = authorized(pointer.tid ? await source.template.findById(pointer.tid) : null, 'Template');
                if (pointer.eid) {
                    const target = authorized(await source.entry.findById(pointer.eid), 'Entry');
                    if (target.templateId !== targetTemplate._id) throw denied('Entry');
                }
                if (!definition.data?.propEntryPointer?.some(rule => rule.templateId === pointer.tid && (!rule.entryIds?.length || rule.entryIds.includes(pointer.eid)))) throw denied('Entry');
            }
            if (definition.type === PropType.WIDGET) {
                const widget = authorized(data?._id ? await source.widget.findById(data._id) : null, 'Widget');
                if (definition.data?.propWidget?._id !== widget._id) throw denied('Widget');
                await values(widget.props, data.props);
            }
            if (definition.type === PropType.GROUP_POINTER && data?._id) {
                const group = authorized(await source.group.findById(data._id), 'Group');
                if (definition.data?.propGroupPointer?._id !== group._id) throw denied('Group');
                for (const item of data.items || []) await values(group.props, item.props);
            }
            if (definition.type === PropType.RICH_TEXT) for (const item of data || []) await content(item.nodes || []);
        }
    };
    for (const meta of entry.meta || []) if (!language || meta.lng === language) await values(template.props, meta.props);
    for (const item of entry.content || []) if (!language || item.lng === language) await content(item.nodes);
}
