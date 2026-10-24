import { Repo } from '../repo';
import type { Entry } from '../entry/models/main';
import type { Prop, PropValue } from '../prop/models/main';
import { PropType } from '../prop/models/main';
import type { EntryContentNode } from '../entry/models/content';
import { defaultEntryGroupId } from '../entry-groups/repo';
import { entryTitleKeys } from '../entry-groups/names';
import { workspaceId } from './context';
import { ContentScopeError } from './scoped-collection';

const denied = (kind: string) => new ContentScopeError(`${kind} reference not found or not permitted in workspace`);
export async function validatePropDefinitions(props: Prop[]) {
    for (const prop of props || []) {
        if (prop.type === PropType.GROUP_POINTER && prop.data?.propGroupPointer) {
            if (!await Repo.group.findById(prop.data?.propGroupPointer._id)) throw denied('Group');
        }
        if (prop.type === PropType.WIDGET && prop.data?.propWidget) {
            if (!await Repo.widget.findById(prop.data?.propWidget._id)) throw denied('Widget');
        }
        if (prop.type === PropType.ENTRY_POINTER) for (const pointer of prop.data?.propEntryPointer || []) {
            if (!await Repo.template.findById(pointer.templateId)) throw denied('Template');
            for (const id of pointer.entryIds || []) {
                const entry = await Repo.entry.findById(id);
                if (!entry || entry.templateId !== pointer.templateId) throw denied('Entry');
            }
        }
    }
}
export async function validateContentNodes(nodes: EntryContentNode[]) {
    for (const node of nodes || []) {
        if (node.type === 'widget') {
            const data = (node.attrs as any)?.data;
            const widget = data?._id && await Repo.widget.findById(data._id);
            if (!widget) throw denied('Widget');
            await validatePropValues(widget.props, data.props);
        }
        await validateContentNodes(node.content || []);
    }
}
export async function validatePropValues(props: Prop[], values: PropValue[]) {
    for (const value of values || []) {
        const prop = props.find(prop => prop.id === value.id);
        if (!prop) throw new ContentScopeError('Unknown property');
        const data = value.data as any;
        if (prop.type === PropType.MEDIA) for (const media of data || []) {
            if (media._id && !await Repo.media.findById(media._id)) throw denied('Media');
        }
        if (prop.type === PropType.ENTRY_POINTER) for (const pointer of data || []) {
            const template = pointer.tid && await Repo.template.findById(pointer.tid);
            const entry = pointer.eid && await Repo.entry.findById(pointer.eid);
            if (!template || (pointer.eid && (!entry || entry.templateId !== template._id))) throw denied('Entry');
            if (!prop.data?.propEntryPointer?.some(rule => rule.templateId === pointer.tid && (!rule.entryIds?.length || rule.entryIds.includes(pointer.eid)))) throw denied('Entry');
        }
        if (prop.type === PropType.WIDGET) for (const item of data || []) {
            const widget = await Repo.widget.findById(item._id);
            if (!widget || prop.data?.propWidget?._id !== item._id) throw denied('Widget');
            await validatePropValues(widget.props, item.props);
        }
        if (prop.type === PropType.GROUP_POINTER && data?._id) {
            const group = await Repo.group.findById(data._id);
            if (!group || prop.data?.propGroupPointer?._id !== data._id) throw denied('Group');
            for (const item of data.items || []) await validatePropValues(group.props, item.props);
        }
        if (prop.type === PropType.RICH_TEXT) for (const item of data || []) await validateContentNodes(item.nodes || []);
    }
}
export async function prepareEntryWrite(entry: Entry) {
    const template = await Repo.template.findById(entry.templateId);
    if (!template) throw denied('Template');
    if (entry.siteId) {
        const site = await Repo.siteInstallation.findById(entry.siteId);
        if (!site) throw denied('Site');
    }
    entry.groupId ||= defaultEntryGroupId();
    const implicit = entry.groupId === defaultEntryGroupId() || entry.siteId && entry.groupId === ((await Repo.siteInstallation.findById(entry.siteId))?.contentGroupId || entry.siteId);
    if (implicit) await Repo.entryGroup.methods.ensure(entry.groupId, entry.siteId, entry.siteId ? 'Site content' : 'General');
    else if (!await Repo.entryGroup.findById(entry.groupId)) throw denied('Entry group');
    entry.workspaceId = workspaceId();
    const keys = entryTitleKeys(entry, template);
    if (keys.length) entry.titleKeys = keys;
    else delete entry.titleKeys;
    for (const meta of entry.meta || []) await validatePropValues(template.props, meta.props);
    for (const content of entry.content || []) await validateContentNodes(content.nodes);
    for (const status of entry.statuses || []) if (status.id && !await Repo.entryStatus.findById(status.id)) throw denied('Entry status');
}
