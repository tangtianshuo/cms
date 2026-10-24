import { propsValidationTestInfiniteLoop } from '../prop/validate';
import type { Group } from '../group/models/main';
import { randomUUID } from 'node:crypto';
import { Repo } from '../repo';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import type { Template } from '../template/models/main';
import type { Prop, PropValue } from '../prop/models/main';
import { PropType } from '../prop/models/main';
import { canWriteContent, workspaceContext, workspaceId } from '../workspaces/context';
import { ContentScopeError } from '../workspaces/scoped-collection';
import { copyRepository, withCopyOverlay } from './visibility';
import type { ResourceShare, ShareKind, SharedResource } from './repo';

export interface CopySelection {
    shareId: string;
    /** Only Widget/Group may reuse an explicitly selected target structure. */
    targetId?: string;
    templateId?: string;
    groupId?: string;
    /** Complete source property ID -> target property ID mapping. */
    fieldMap?: Record<string, string>;
}
export interface CopyItem { kind: ShareKind; document: SharedResource; share: ResourceShare; reused: boolean }
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };

function validateValueShape(prop: Prop, data: any) {
    if ([PropType.WIDGET, PropType.GROUP_POINTER].includes(prop.type)) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data._id !== 'string') fail(`Malformed structure value: ${prop.name}`);
        if (prop.type === PropType.WIDGET && !Array.isArray(data.props)) fail(`Malformed Widget props: ${prop.name}`);
        if (prop.type === PropType.GROUP_POINTER && (!Array.isArray(data.items) || (prop.required && !data.items.length))) fail(`Malformed Group items: ${prop.name}`);
        return;
    }
    if (!Array.isArray(data) || (!prop.array && data.length > 1) || (prop.required && !data.length)) fail(`Invalid value cardinality: ${prop.name}`);
    for (const value of data) {
        if (prop.type === PropType.STRING && (typeof value !== 'string' || (prop.required && !value))) fail(`Invalid string: ${prop.name}`);
        if (prop.type === PropType.NUMBER && (typeof value !== 'number' || !Number.isFinite(value))) fail(`Invalid number: ${prop.name}`);
        if (prop.type === PropType.BOOLEAN && typeof value !== 'boolean') fail(`Invalid boolean: ${prop.name}`);
        if (prop.type === PropType.DATE && (!value || !Number.isFinite(value.timestamp) || !Number.isFinite(value.timezoneOffset))) fail(`Invalid date: ${prop.name}`);
        if (prop.type === PropType.ENUMERATION && (typeof value !== 'string' || !prop.data.propEnum?.items.includes(value))) fail(`Invalid enum: ${prop.name}`);
        if (prop.type === PropType.MEDIA && (!value || typeof value._id !== 'string' || (prop.required && !value._id))) fail(`Invalid media: ${prop.name}`);
        if (prop.type === PropType.ENTRY_POINTER && (!value || typeof value.tid !== 'string' || typeof value.eid !== 'string' || (prop.required && !value.eid))) fail(`Invalid Entry pointer: ${prop.name}`);
        if (prop.type === PropType.RICH_TEXT && (!value || !Array.isArray(value.nodes))) fail(`Invalid rich text: ${prop.name}`);
    }
}

/** Build only from immutable, explicitly authorized snapshots. No source repo reads. */
export async function buildCopyGraph(shares: ResourceShare[], selections: CopySelection[], batchId: string): Promise<CopyItem[]> {
    const byResource = new Map<string, ResourceShare>();
    const items = new Map<string, CopyItem>();
    const targets = new Map<string, Template>();
    const selection = new Map(selections.map(item => [item.shareId, item]));
    const templateMap = new Map<string, string>();
    for (const share of shares) {
        const key = `${share.resourceType}:${share.resourceId}`;
        if (byResource.has(key)) fail('Select exactly one version of each resource');
        byResource.set(key, share);
        const choice = selection.get(share._id)!;
        const reused = Boolean(choice.targetId);
        if (reused && !['Widget', 'Group'].includes(share.resourceType)) fail('Only Widget/Group structures can be mapped to existing target resources');
        const existing = reused ? await (share.resourceType === 'Widget' ? Repo.widget : Repo.group).findById(choice.targetId!) : undefined;
        if (reused && !existing) fail('Target structure not found');
        const document = existing || structuredClone(share.snapshot);
        if (!reused) {
            document._id = randomUUID(); document.workspaceId = workspaceId();
            document.createdAt = document.updatedAt = Date.now();
            document.copyBatchId = batchId;
            document.provenance = { shareId: share._id, ownerWorkspaceId: share.ownerWorkspaceId, resourceId: share.resourceId, version: share.version, copiedAt: Date.now(), actorId: workspaceContext()!.actorId };
            if (share.resourceType === 'Widget' || share.resourceType === 'Group') {
                const structure = document as { name: string; label: string };
                structure.name = `${structure.name}-copy-${document._id}`;
                structure.label = `${structure.label} (copy ${document._id.slice(0, 8)})`;
            }

        }
        if (share.resourceType === 'Entry') {
            if (!choice.templateId || !choice.groupId || !choice.fieldMap) fail('Each Entry requires target templateId, groupId and complete fieldMap');
            const template = await Repo.template.findById(choice.templateId!);
            if (!template || !canWriteContent('Entry', { templateId: template._id }, 'post')) throw new ContentScopeError('Target Template creation denied');
            if (template.singleEntry) fail('Copy into singleton Templates is not supported');
            if (!await Repo.entryGroup.findById(choice.groupId!)) fail('Target EntryGroup not found; create it before copying');
            const sourceTemplate = (share.snapshot as Entry).templateId;
            if (templateMap.has(sourceTemplate) && templateMap.get(sourceTemplate) !== template._id) fail('A source Template must have one target mapping within a copy');
            templateMap.set(sourceTemplate, template._id); targets.set(share._id, template);
            const entry = document as Entry;
            entry.templateId = template._id; entry.groupId = choice.groupId;
            entry.siteId = template.siteId; entry.userId = workspaceContext()!.actorId;
            // Workflow status IDs are workspace-owned. A new copy starts as a draft.
            entry.statuses = [];
            delete entry.titleKeys;
        }
        if (share.resourceType === 'Media') {
            if (!canWriteContent('Media', document, 'post')) throw new ContentScopeError('Media creation denied');
            const media = document as Media;
            if (media.type === 'DIR') fail('Share individual media files; directories are not copyable');
            media.parentId = ''; media.isInRoot = true; media.hasChildren = false;
            media.userId = workspaceContext()!.actorId;
            const dot = media.name.lastIndexOf('.');
            media.name = dot > 0 ? `${media.name.slice(0, dot)}-copy-${media._id}${media.name.slice(dot)}` : `${media.name}-copy-${media._id}`;
            delete media.accessToken; delete media.accessTokenExpiresAt;
        }
        items.set(share._id, { kind: share.resourceType, document, share, reused });
    }
    const resolve = (kind: ShareKind, id: string) => {
        const share = byResource.get(`${kind}:${id}`);
        if (!share) { const mapped = [...items.values()].find(item => item.kind === kind && item.document._id === id); if (mapped) return mapped; }
        if (!share) return fail(`Missing explicit ${kind} dependency grant for ${id}`);
        return items.get(share._id)!;
    };
    const templateId = (id: string) => templateMap.get(id) || fail(`Missing target Template mapping for ${id}; include an authorized Entry from that Template`);
    const propsOf = (item: CopyItem) => (item.document as { props: Prop[] }).props;
    const sourceProps = (item: CopyItem) => item.kind === 'Entry' ? item.share.entryProps! : (item.share.snapshot as { props: Prop[] }).props;
    const targetProps = (item: CopyItem) => item.kind === 'Entry' ? targets.get(item.share._id)!.props : propsOf(item);
    const mappedProp = (item: CopyItem, prop: Prop) => {
        const mapping = selection.get(item.share._id)!.fieldMap;
        const id = item.reused || item.kind === 'Entry' ? mapping?.[prop.id] : prop.id;
        return targetProps(item).find(value => value.id === id) || fail(`Missing field mapping for ${prop.name}`);
    };
    const mediaUrl = (value: string) => value.replace(/\/api\/v4\/media\/([^/]+)\/bin\//g, (_all, encoded) => `/api/v4/media/${encodeURIComponent(resolve('Media', decodeURIComponent(encoded)).document._id)}/bin/`);
    const nodes = (value: any[]): any[] => (value || []).map(node => {
        const output = structuredClone(node);
        if (node.type === 'widget') {
            const dependency = resolve('Widget', node.attrs?.data?._id);
            output.attrs.data = { ...node.attrs.data, _id: dependency.document._id, props: values(dependency, node.attrs.data.props) };
        }
        if (output.content) output.content = nodes(output.content);
        if (output.attrs?.href) output.attrs.href = mediaUrl(output.attrs.href);
        for (const mark of output.marks || []) if (mark.attrs?.href) mark.attrs.href = mediaUrl(mark.attrs.href);
        return output;
    });
    const values = (item: CopyItem, input: PropValue[]): PropValue[] => {
        if (!Array.isArray(input) || input.length !== sourceProps(item).length) fail('Provide one value for every source property');
        const seen = new Set<string>();
        const output = input.map(value => {
            const prop = sourceProps(item).find(prop => prop.id === value.id) || fail('Unknown source property');
            if (seen.has(value.id)) fail('Duplicate property value'); seen.add(value.id);
            const target = mappedProp(item, prop);
            validateValueShape(prop, value.data);
            const data: any = structuredClone(value.data);
            let next = data;
            if (prop.type === PropType.MEDIA) next = data.map((media: any) => ({ ...media, _id: media._id ? resolve('Media', media._id).document._id : '' }));
            if (prop.type === PropType.ENTRY_POINTER) next = data.map((pointer: any) => ({ tid: templateId(pointer.tid), eid: pointer.eid ? resolve('Entry', pointer.eid).document._id : '' }));
            if (prop.type === PropType.WIDGET) {
                const dependency = resolve('Widget', data._id);
                if (prop.data.propWidget?._id !== data._id) fail('Widget value disagrees with its definition');
                next = { _id: dependency.document._id, props: values(dependency, data.props) };
            }
            if (prop.type === PropType.GROUP_POINTER) {
                const dependency = resolve('Group', data._id);
                if (prop.data.propGroupPointer?._id !== data._id) fail('Group value disagrees with its definition');
                next = { _id: dependency.document._id, items: data.items.map((child: any) => ({ props: values(dependency, child.props) })) };
            }
            if (prop.type === PropType.RICH_TEXT) next = data.map((child: any) => ({ nodes: nodes(child.nodes) }));
            return { id: target.id, data: next };
        });
        for (const prop of sourceProps(item)) if (prop.required && !seen.has(prop.id)) fail(`Required property missing: ${prop.name}`);
        return output;
    };
    const rewriteDefinition = (prop: Prop): Prop => {
        const result = structuredClone(prop);
        if (prop.type === PropType.WIDGET) result.data.propWidget = { _id: resolve('Widget', prop.data.propWidget!._id).document._id };
        if (prop.type === PropType.GROUP_POINTER) result.data.propGroupPointer = { _id: resolve('Group', prop.data.propGroupPointer!._id).document._id };
        if (prop.type === PropType.ENTRY_POINTER) result.data.propEntryPointer = (prop.data.propEntryPointer || []).map(rule => {
            const sourceEntry = [...items.values()].find(item => item.kind === 'Entry' && (item.share.snapshot as Entry).templateId === rule.templateId);
            const displayProp = sourceEntry ? selection.get(sourceEntry.share._id)!.fieldMap?.[rule.displayProp] : undefined;
            if (!displayProp) fail('Entry pointer display property requires a field mapping');
            return { ...rule, templateId: templateId(rule.templateId), entryIds: rule.entryIds.map(id => resolve('Entry', id).document._id), displayProp: displayProp! };
        });
        if (prop.data.propRichText) result.data.propRichText = prop.data.propRichText.map(value => ({ nodes: nodes(value.nodes) }));
        return result;
    };
    // First rewrite copied definitions, so later comparisons see the entire target graph.
    for (const item of items.values()) if (['Widget', 'Group'].includes(item.kind) && !item.reused) (item.document as { props: Prop[] }).props = sourceProps(item).map(rewriteDefinition);
    for (const item of items.values()) {
        if (item.kind === 'Media') continue;
        const source = sourceProps(item); const target = targetProps(item);
        if (!Array.isArray(source) || source.length !== target.length) fail('Source and target structures must have a complete one-to-one field mapping');
        const seen = new Set<string>();
        for (const prop of source) {
            const mapped = mappedProp(item, prop);
            if (seen.has(mapped.id)) fail('Field mapping must be one-to-one'); seen.add(mapped.id);
            if (prop.type !== mapped.type || prop.array !== mapped.array || prop.required !== mapped.required) fail(`Incompatible target field: ${mapped.name}`);
            const rewritten = rewriteDefinition(prop);
            for (const key of ['propWidget', 'propGroupPointer', 'propEntryPointer', 'propEnum', 'propMedia'] as const) {
                if (JSON.stringify(rewritten.data[key]) !== JSON.stringify(mapped.data[key])) fail(`Incompatible target field constraints: ${mapped.name}`);
            }
        }
        if (item.kind === 'Entry') {
            const entry = item.document as Entry;
            entry.meta = (item.share.snapshot as Entry).meta.map(meta => ({ ...meta, props: values(item, meta.props) }));
            entry.content = (item.share.snapshot as Entry).content.map(content => ({ ...content, nodes: nodes(content.nodes) }));
        }
    }
    // References embedded in URL strings must also use copied, explicitly granted media.
    const rewriteUrls = (value: any): any => {
        if (typeof value === 'string') return mediaUrl(value);
        if (Array.isArray(value)) return value.map(rewriteUrls);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteUrls(child)]));
        return value;
    };
    for (const item of items.values()) if (!item.reused) item.document = rewriteUrls(item.document);
    const output = [...items.values()];
    const groups = output.filter(item => item.kind === 'Group').map(item => item.document as Group);
    for (const item of output) if (item.kind === 'Widget' || item.kind === 'Group') {
        const loopError = propsValidationTestInfiniteLoop((item.document as { props: Prop[] }).props, { group: [] }, item.kind, groups);
        if (loopError) fail(loopError.message);
    }
    // Existing reference/name validators see only this authorized in-memory graph.
    await withCopyOverlay(output.map(item => ({ kind: item.kind, document: item.document })), async () => {
        for (const item of output) if (!item.reused) await copyRepository(item.kind).prepare?.(item.document);
    });
    return output;
}
