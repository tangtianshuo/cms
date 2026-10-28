import { createHash } from 'node:crypto';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import { PropType, type PropValue } from '../prop/models/main';
import type { SiteInstallation } from '../presets/site-model';
import { canWriteContent, workspaceContext, workspaceId } from '../workspaces/context';

export type StudioValue = string | number | boolean | Array<{ _id: string; alt_text?: string; caption?: string }> | Array<{ tid: string; eid: string }>;
export interface StudioField { key: string; label: string; type: PropType; array: boolean; required: boolean; editable: boolean; referenceTemplateIds: string[] }
export function assertStudioWrite(templateId: string, operation: 'post' | 'put') {
    if (!workspaceContext() || !canWriteContent('Entry', { templateId }, operation)) throw Object.assign(new Error('Content write denied'), { status: 403 });
}
export function fieldDescriptors(site: SiteInstallation, template: Template, modelKey: string): StudioField[] {
    const model = site.models.find(item => item.key === modelKey && item.templateId === template._id);
    if (!model) throw new Error('Installed model is unavailable');
    return model.fields.flatMap(field => {
        const prop = template.props.find(item => item.id === field.propId);
        return prop ? [{ key: field.key, label: prop.label, type: prop.type, array: prop.array, required: prop.required,
            editable: ([PropType.STRING, PropType.NUMBER, PropType.BOOLEAN, PropType.MEDIA, PropType.ENTRY_POINTER].includes(prop.type) &&
                (!prop.array || [PropType.MEDIA, PropType.ENTRY_POINTER].includes(prop.type))),
            referenceTemplateIds: prop.data?.propEntryPointer?.map(pointer => pointer.templateId) || [] }] : [];
    });
}
export function entryValues(site: SiteInstallation, modelKey: string, entry: Entry): Record<string, unknown> {
    const meta = entry.meta.find(item => item.lng === (site.language || 'en'));
    return Object.fromEntries((site.models.find(item => item.key === modelKey)?.fields || []).map(field => {
        const data = meta?.props.find(item => item.id === field.propId)?.data;
        return [field.key, data];
    }));
}
export function patchEntry(site: SiteInstallation, template: Template, modelKey: string, previous: Entry | null,
    changes: Record<string, StudioValue>, actorId = '', id = ''): Entry {
    const descriptors = fieldDescriptors(site, template, modelKey);
    const mapping = site.models.find(item => item.key === modelKey)!;
    const lng = site.language || 'en';
    if (previous && previous.templateId !== template._id) throw new Error('Entry does not belong to installed model');
    if (previous?.siteId && previous.siteId !== site._id) throw new Error('Entry belongs to another site');
    const entry: Entry = previous ? structuredClone(previous) : { _id: id, createdAt: Date.now(), updatedAt: Date.now(),
        userId: actorId, templateId: template._id, workspaceId: workspaceId(), siteId: site._id,
        groupId: site.contentGroupId || site._id, statuses: [], content: [{ lng, nodes: [], plainText: '' }],
        meta: [{ lng, props: template.props.map(prop => ({ id: prop.id, data: [] })) }] };
    const meta = entry.meta.find(item => item.lng === lng);
    if (!meta) throw new Error(`Entry has no ${lng} translation; use the advanced editor`);
    for (const [key, value] of Object.entries(changes)) {
        const field = descriptors.find(item => item.key === key);
        if (!field) throw new Error(`Unknown installed field ${key}`);
        let data: PropValue['data'];
        if (field.type === PropType.RICH_TEXT && !previous && typeof value === 'string') {
            data = [{ nodes: value.split('\n').map(text => ({ type: 'paragraph' as const, content: text ? [{ type: 'text' as const, text }] : [] })) }] as unknown as PropValue['data'];
        } else {
            if (!field.editable) throw new Error(`${field.label} requires the advanced editor`);
            if (field.type === PropType.STRING) {
                if (typeof value !== 'string' || value.length > 30000) throw new Error(`Invalid ${field.label}`);
                if (key === 'slug' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error('Slug must use lowercase letters, numbers and hyphens');
                if (field.required && !value.trim()) throw new Error(`${field.label} is required`);
                data = [value];
            } else if (field.type === PropType.NUMBER) {
                if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'price' && value < 0)) throw new Error(`Invalid ${field.label}`);
                data = [value];
            } else if (field.type === PropType.BOOLEAN) {
                if (typeof value !== 'boolean') throw new Error(`Invalid ${field.label}`);
                data = [value];
            } else {
                if (!Array.isArray(value) || (!field.array && value.length > 1) || value.length > 200) throw new Error(`Invalid ${field.label}`);
                for (const item of value) {
                    if (field.type === PropType.MEDIA && (!('_id' in item) || !item._id || Object.keys(item).some(k => !['_id', 'alt_text', 'caption'].includes(k)) || ('alt_text' in item && typeof item.alt_text !== 'string') || ('caption' in item && typeof item.caption !== 'string'))) throw new Error(`Invalid ${field.label}`);
                    if (field.type === PropType.ENTRY_POINTER && (!('tid' in item) || !field.referenceTemplateIds.includes(item.tid) || !item.eid || Object.keys(item).some(k => !['tid', 'eid'].includes(k)))) throw new Error(`Invalid ${field.label}`);
                }
                data = value;
            }
        }
        const propId = mapping.fields.find(item => item.key === key)!.propId;
        const existing = meta.props.find(item => item.id === propId);
        if (existing) existing.data = structuredClone(data);
        else meta.props.push({ id: propId, data });
    }
    if (!previous) for (const prop of template.props) {
        if (prop.required && !(meta.props.find(item => item.id === prop.id)?.data as unknown[])?.length) throw new Error(`${prop.label} is required; use the advanced editor if unsupported`);
    }
    return entry;
}
export function pageOperationIds(siteId: string, operationId: string) {
    const hash = createHash('sha256').update(`${siteId}:studio-page:${operationId}`).digest('hex');
    return { entryId: hash.slice(0, 24), pageKey: `studio-${hash.slice(0, 32)}` };
}
