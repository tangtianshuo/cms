import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReleaseInput } from '../presets/releases';
import type { Template } from '../template/models/main';
import type { Entry } from '../entry/models/main';
import { getPreset } from '../presets/catalog';
import { createPageDraft, pageDraft } from '../presets/pages';
import { buildStudioDraftPreview, mergeStudioEntry } from './draft-preview';
function fixture(): ReleaseInput {
    const preset = getPreset('atelier')!;
    const values: Record<string, Record<string, unknown[]>> = {
        home: { title: ['Home'], slug: ['home'], headline: ['Original headline'] },
        product: { title: ['Bag'], slug: ['bag'], price: [45] },
        collection: { title: ['Shop'], slug: ['shop'], products: [{ tid: 'product', eid: 'product-entry' }] },
        'content-page': { title: ['About'], slug: ['about'], summary: ['Our story'] },
        'site-settings': { title: ['Settings'], slug: ['settings'], brandName: ['My brand'],
            navigationPages: [{ tid: 'content-page', eid: 'content-page-entry' }] },
    };
    return {
        site: { _id: 'site', createdAt: 1, updatedAt: 1, slot: 'default', name: 'My Store',
            presetId: preset.id, presetVersion: preset.version, status: 'ready', importError: '',
            includeDemo: false, demoSeeded: false, theme: { ...preset.theme },
            models: preset.models.map((model) => ({ key: model.key, templateId: model.key,
                fields: model.fields.map((field) => ({ key: field.key, propId: field.key })) })),
            pages: preset.pages.map((page) => ({ ...page, status: 'draft', seoDescription: 'Store information' })),
        },
        templates: preset.models.map((model) => ({ _id: model.key, props: model.fields.map((field) => ({
            id: field.key, name: field.key, type: field.type, array: field.array, required: field.required,
        })) } as Template)),
        entries: preset.models.map((model) => ({ _id: `${model.key}-entry`, templateId: model.key,
            meta: [{ lng: 'en', props: Object.entries(values[model.key]).map(([id, data]) => ({ id, data })) }],
        } as Entry)),
        media: [], language: 'en', mediaOrigin: 'https://cms.test', currency: 'USD',
    };
}

function freeze(value: any): any { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
test('full-site preview clones frozen input and updates shared referenced content without storage', () => {
 const input=fixture(); const before=JSON.stringify(input); freeze(input);
 const result=buildStudioDraftPreview(input,{entry:{modelKey:'product',entryId:'product-entry',operationId:'op',fields:{title:'LIVE',price:67}}});
 assert.equal(result.pages.find(page=>page.path==='/products/bag')!.content.preset.demo.product.title,'LIVE');
 assert.equal(result.pages.find(page=>page.path==='/collections')!.content.items![0].label,'LIVE');
 assert.equal(JSON.stringify(input),before);
});
test('preview cannot inject foreign entry or page identity',()=>{
 const input=fixture();
 assert.throws(()=>buildStudioDraftPreview(input,{entry:{modelKey:'product',entryId:'foreign',operationId:'op',fields:{title:'bad'}}}),/Entry|entry/);
 assert.throws(()=>buildStudioDraftPreview(input,{page:{...input.site.pages[0],key:'foreign'} as any}),/Page|page/);
});
test('route authority validates full overlay and returns a field location without changing saved input',()=>{
 const input=fixture(); const entry=input.entries.find(entry=>entry.templateId==='content-page')!;
 const body={kind:'prop-data' as const,data:[{nodes:[{type:'paragraph',content:[{type:'text',text:'Contact',marks:[{type:'link',attrs:{href:'/missing'}}]}]}]}]};
 assert.throws(()=>buildStudioDraftPreview(input,{entry:{modelKey:'content-page',entryId:entry._id,operationId:'op',fields:{body:body as any}}}), (error:any)=>{ assert.ok(error.issues?.some((issue:any)=>issue.entryId===entry._id && issue.field==='body'));return true; });
 body.data[0].nodes[0].content[0].marks[0].attrs.href='/';
 assert.ok(buildStudioDraftPreview(input,{entry:{modelKey:'content-page',entryId:entry._id,operationId:'op',fields:{body:body as any}}}).pages.length);
});
test('full Entry merge keeps server identity, unknown selected values and other language content', () => {
 const previous={_id:'server',workspaceId:'w',siteId:'s',templateId:'t',updatedAt:4,groupId:'g',meta:[{lng:'en',props:[{id:'unknown',data:[{opaque:true}]}]},{lng:'fr',props:[{id:'title',data:['Serveur']}]}],content:[{lng:'en',nodes:[],plainText:''},{lng:'fr',nodes:[{type:'paragraph',content:[{type:'text',text:'French body'}]}],plainText:'French body'}],statuses:[{lng:'en',id:'draft'},{lng:'fr',id:'published'}]} as Entry;
 const body={meta:[{lng:'en',props:[{id:'unknown',data:[{opaque:true}]},{id:'title',data:['Local']}]}],content:[{lng:'en',nodes:[{type:'horizontalRule'}],plainText:'<hr/>'}],statuses:[{lng:'en',id:'review'}],groupId:'new'};
 const before=structuredClone(previous);freeze(previous);const merged=mergeStudioEntry(previous,body as any,'en');
 assert.equal(merged._id,'server');assert.equal(merged.updatedAt,4);assert.equal(merged.groupId,'new');assert.deepEqual(merged.meta.find(value=>value.lng==='fr'),before.meta[1]);assert.deepEqual(merged.content.find(value=>value.lng==='fr'),before.content[1]);assert.deepEqual(merged.statuses.find(value=>value.lng==='fr'),before.statuses[1]);assert.deepEqual(merged.meta.find(value=>value.lng==='en')?.props[0],body.meta[0].props[0]);assert.deepEqual(previous,before);
});
test('content links use the final same-session page path and related page removals reject', () => {
 const input=fixture();const source=input.entries.find(entry=>entry.templateId==='content-page')!;
 input.site=createPageDraft(input.site,'related-page',{...pageDraft(input.site,'content')!,blueprintKey:'content',title:'Related',path:'/pages/about',entryId:source._id},source);input.site.pages.find(page=>page.key==='content')!.enabled=false;
 const fields={body:{kind:'prop-data',data:[{nodes:[{type:'paragraph',content:[{type:'text',text:'Final route',marks:[{type:'link',attrs:{href:'/pages/final'}}]}]}]}]}};
 const overlay={entry:{modelKey:'content-page',entryId:source._id,operationId:'op',fields},page:{...pageDraft(input.site,'related-page')!,path:'/pages/final'}} as any;
 assert.ok(buildStudioDraftPreview(input,overlay).pages.some(page=>page.path==='/pages/final'));
 assert.throws(()=>buildStudioDraftPreview(input,{entry:overlay.entry}),/Broken internal link/);
 input.entries.find(entry=>entry.templateId==='home')!.content=[{lng:'en',nodes:[{type:'paragraph',content:[{type:'text',text:'Related',marks:[{type:'link',attrs:{href:'/pages/about'}}]}]}],plainText:''}] as any;
 assert.throws(()=>buildStudioDraftPreview(input,{page:overlay.page}), (cause:any)=>cause.issues?.some((issue:any)=>issue.field==='content' && issue.entryId==='home-entry'));
});
