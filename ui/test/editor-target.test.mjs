import test from 'node:test';
import assert from 'node:assert/strict';
import { contentEditorLocation, resolveEditorTarget } from '../src/components/studio/editor-target.ts';
const context = { workspaceId:'w1', siteId:'s1', language:'zh', languages:['zh','en'], models:[{ key:'product', templateId:'t1', entries:[{ id:'e1', hasLanguage:true }], singleEntry:false }], pages:[{ key:'contact', modelKey:'product', entryId:'e1' },{ key:'blank', modelKey:'product', entryId:'' }] };
test('old and new entry links carry the same editing identity', () => {
 const target={ intent:'edit', workspaceId:'w1', siteId:'s1', templateId:'t1', modelKey:'product', entryId:'e1', language:'zh', groupId:'g1' };
 const route=contentEditorLocation(target);
 assert.deepEqual(route,{path:'/d/studio',query:{section:'content',intent:'edit',workspaceId:'w1',templateId:'t1',language:'zh',entryId:'e1',siteId:'s1',modelKey:'product',group:'g1'}});
 assert.equal(contentEditorLocation({...target,intent:'create',entryId:null}).query.entryId,'create');
 assert.equal(contentEditorLocation({...target,intent:'page',pageKey:'contact',entryId:null}).query.entryId,undefined);
});
test('resolve only identities inside already authorized context',()=>{
 const base={modelKey:'product',entryId:'e1'};
 assert.equal(resolveEditorTarget(base,context).entryId,'e1');
 for(const patch of [{workspaceId:'other'},{siteId:'other'},{templateId:'other'},{entryId:'missing'},{language:'xx'},{pageKey:'missing'},{intent:'create'},{pageKey:'blank'}]) assert.throws(()=>resolveEditorTarget({...base,...patch},context));
 assert.throws(()=>resolveEditorTarget({...base,modelKey:['product']},context));
});
test('create, page-only, language and legacy page target stay distinct',()=>{
 assert.equal(resolveEditorTarget({modelKey:'product',entryId:'create',group:'g1'},context).intent,'create');
 assert.equal(resolveEditorTarget({pageKey:'blank'},context).intent,'page');
 assert.equal(resolveEditorTarget({pageKey:'contact'},context).entryId,'e1');
 assert.equal(resolveEditorTarget({modelKey:'product',entryId:'e1',language:'en'},context).language,'en');
 assert.throws(()=>resolveEditorTarget({intent:'edit',modelKey:'product'},context));
 assert.throws(()=>resolveEditorTarget({intent:'page',modelKey:'product',entryId:'create'},context));
});
test('page identity cannot be combined with a different or missing model',()=>{
 const multiple={...context,models:[...context.models,{key:'other',templateId:'t2',singleEntry:false,entries:[]}]};
 for(const query of [{pageKey:'contact',templateId:'t2',intent:'page'},{pageKey:'contact',templateId:'missing',intent:'page'}]) assert.throws(()=>resolveEditorTarget(query,multiple));
});
