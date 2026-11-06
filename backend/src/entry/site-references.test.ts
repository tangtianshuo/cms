import assert from 'node:assert/strict';
import test from 'node:test';
import { PropType, type Prop, type PropValue } from '../prop/models/main';
import type { Entry } from './models/main';
import { validateEntrySiteReferences, type EntrySiteReferenceSource } from './site-references';

const prop = (id: string, type: PropType, data: Prop['data'] = {}): Prop => ({ id, type, data, name: id, label: id, required: false, array: false });
const mediaProp = prop('media', PropType.MEDIA);
const pointerProp = prop('pointer', PropType.ENTRY_POINTER, { propEntryPointer: ['own', 'other', 'legacy'].map(templateId => ({ templateId, entryIds: [], displayProp: 'title' })) });
const template = { _id: 'own', workspaceId: 'w', siteId: 's', props: [mediaProp, pointerProp] };
const entry = (values: PropValue[] = []): Entry => ({ _id: 'editing', workspaceId: 'w', siteId: 's', templateId: 'own', userId: 'u', groupId: 'site-content', createdAt: 1, updatedAt: 1, statuses: [], meta: [{ lng: 'en', props: values }], content: [{ lng: 'en', nodes: [], plainText: '' }] });
function fixture() {
    const records: Record<string, Record<string, any>> = {
        siteInstallation: { s: { _id: 's', workspaceId: 'w', contentGroupId: 'site-content' } },
        media: { own: { _id: 'own', workspaceId: 'w', siteId: 's', mimetype: 'application/pdf' }, other: { _id: 'other', workspaceId: 'w', siteId: 'other-site' }, legacy: { _id: 'legacy', workspaceId: 'w' }, foreign: { _id: 'foreign', workspaceId: 'foreign-workspace', siteId: 's' } },
        template: { own: template, other: { ...template, _id: 'other', siteId: 'other-site' }, legacy: { ...template, _id: 'legacy', siteId: undefined } },
        entry: { own: { _id: 'own', workspaceId: 'w', siteId: 's', templateId: 'own' }, other: { _id: 'other', workspaceId: 'w', siteId: 'other-site', templateId: 'other' }, legacy: { _id: 'legacy', workspaceId: 'w', templateId: 'legacy' }, disguised: { _id: 'disguised', workspaceId: 'w', siteId: 'other-site', templateId: 'own' } },
        widget: {}, group: {}, entryGroup: {},
    };
    const source = Object.fromEntries(Object.keys(records).map(kind => [kind, { findById: async (id: string) => records[kind][id] || null }])) as unknown as EntrySiteReferenceSource;
    return { source, records };
}
const forbidden = (error: any) => error.status === 403;

test('site-bound media keeps current-site files of any MIME and rejects other provenance', async () => {
    const { source } = fixture();
    await validateEntrySiteReferences(entry([{ id: 'media', data: [{ _id: 'own' }, { _id: '' }] }]), template, source);
    for (const id of ['other', 'legacy', 'foreign', 'missing']) await assert.rejects(validateEntrySiteReferences(entry([{ id: 'media', data: [{ _id: id }] }]), template, source), forbidden);
});

test('default workspace keeps lawful unbound legacy media', async () => {
    const { source, records } = fixture();
    delete records.siteInstallation.s.workspaceId;delete records.media.legacy.workspaceId;
    const legacyTemplate = { ...template, workspaceId: undefined };
    await validateEntrySiteReferences(entry([{ id: 'media', data: [{ _id: 'legacy' }] }]), legacyTemplate, source);
    records.media.legacy.siteId = 'another';
    await assert.rejects(validateEntrySiteReferences(entry([{ id: 'media', data: [{ _id: 'legacy' }] }]), legacyTemplate, source), forbidden);
});

test('Entry pointers require both template and Entry ownership, retaining unbound same-workspace references', async () => {
    const { source } = fixture();
    for (const [tid, eid] of [['own', 'own'], ['legacy', 'legacy']]) await validateEntrySiteReferences(entry([{ id: 'pointer', data: [{ tid, eid }] }]), template, source);
    for (const [tid, eid] of [['other', 'other'], ['own', 'disguised'], ['own', 'legacy'], ['own', 'missing']]) await assert.rejects(validateEntrySiteReferences(entry([{ id: 'pointer', data: [{ tid, eid }] }]), template, source), forbidden);
});

test('site validation follows Group, Widget, rich text and child content nodes', async () => {
    const { source, records } = fixture();
    records.group.group = { _id: 'group', workspaceId: 'w', props: [prop('widget', PropType.WIDGET, { propWidget: { _id: 'outer' } })] };
    records.widget.outer = { _id: 'outer', workspaceId: 'w', props: [prop('rich', PropType.RICH_TEXT)] };
    records.widget.inner = { _id: 'inner', workspaceId: 'w', props: [mediaProp, pointerProp] };
    const nestedTemplate = { ...template, props: [prop('group', PropType.GROUP_POINTER, { propGroupPointer: { _id: 'group' } })] };
    const innerValues = [{ id: 'media', data: [{ _id: 'own' }] }, { id: 'pointer', data: [{ tid: 'own', eid: 'own' }] }];
    const draft = entry([{ id: 'group', data: { _id: 'group', items: [{ props: [{ id: 'widget', data: { _id: 'outer', props: [{ id: 'rich', data: [{ nodes: [{ type: 'paragraph', content: [{ type: 'widget', attrs: { data: { _id: 'inner', props: innerValues } } }] }] }] }] } }] }] } } as PropValue]);
    await validateEntrySiteReferences(draft, nestedTemplate, source);
    innerValues[0].data = [{ _id: 'other' }];
    await assert.rejects(validateEntrySiteReferences(draft, nestedTemplate, source), forbidden);
    innerValues[0].data = [{ _id: 'own' }];innerValues[1].data = [{ tid: 'other', eid: 'other' }];
    await assert.rejects(validateEntrySiteReferences(draft, nestedTemplate, source), forbidden);
});

test('bound update validates its changed language without modifying another translation', async () => {
    const { source, records } = fixture();records.widget.inner = { _id: 'inner', workspaceId: 'w', props: [mediaProp] };
    const draft = entry([{ id: 'media', data: [{ _id: 'own' }] }]);
    draft.meta.push({ lng: 'fr', props: [{ id: 'media', data: [{ _id: 'other' }] }] });
    draft.content.push({ lng: 'fr', plainText: '', nodes: [{ type: 'widget' as never, attrs: { data: { _id: 'inner', props: [{ id: 'media', data: [{ _id: 'other' }] }] } } } as never] });
    const before = structuredClone(draft);
    await validateEntrySiteReferences(draft, template, source, 'en');
    assert.deepEqual(draft, before);
    await assert.rejects(validateEntrySiteReferences(draft, template, source), forbidden);
});

test('unbound historical writes retain repository workspace semantics', async () => {
    const { source } = fixture();source.siteInstallation.findById = async () => { throw new Error('Unbound content must not resolve a selected site'); };
    await validateEntrySiteReferences({ ...entry([{ id: 'media', data: [{ _id: 'other' }] }]), siteId: undefined }, { ...template, siteId: undefined }, source);
});

test('bound content rejects another site group but accepts a lawful unbound content group', async () => {
    const { source, records } = fixture();records.entryGroup.shared = { _id: 'shared', workspaceId: 'w' };records.entryGroup.other = { _id: 'other', workspaceId: 'w', siteId: 'another' };
    await validateEntrySiteReferences({ ...entry(), groupId: 'shared' }, template, source);
    await assert.rejects(validateEntrySiteReferences({ ...entry(), groupId: 'other' }, template, source), forbidden);
});

test('rich internal media and Entry link marks follow the same site provenance', async () => {
    const { source } = fixture();
    const linked = (href: string) => { const draft = entry(); draft.content[0].nodes = [{ type: 'paragraph' as never, content: [{ type: 'text' as never, text: 'Link', marks: [{ type: 'link' as never, attrs: { href, target: '_self' } }] }] }]; return draft; };
    for (const href of ['media:own@*_@*_:media', 'entry:own@*_own:entry', 'https://example.com', '/contact']) await validateEntrySiteReferences(linked(href), template, source);
    for (const href of ['media:other@*_@*_:media', 'entry:disguised@*_own:entry', 'entry:own@*_other:entry', 'media:other:media', 'entry:own:entry', 'MEDIA:other@*_@*_:media', 'ENTRY:disguised@*_own:entry']) await assert.rejects(validateEntrySiteReferences(linked(href), template, source), forbidden);
});
