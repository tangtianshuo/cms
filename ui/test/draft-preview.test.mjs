import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPreview, createDraftPreview, draftValidation } from '../src/components/studio/draft-preview.ts';
const key = { sessionId:'a', revision:2, workspaceId:'w1', siteId:'s1', language:'zh' };
test('only the latest preview in the current site session is accepted', () => {
  for (const field of Object.keys(key)) assert.equal(acceptPreview(key, { ...key, [field]:field === 'revision' ? 1 : 'old' }), false);
  assert.equal(acceptPreview(key, { ...key }), true);
});
test('debounces composition, aborts retired requests and retains last valid canvas on failure', async () => {
  const replies = []; const received = []; const errors = [];
  const preview = createDraftPreview({ key:()=>key, debounceMs:5, request:(body, signal)=>new Promise((resolve,reject)=>replies.push({body,signal,resolve,reject})), accept:value=>received.push(value), fail:error=>errors.push(error) });
  preview.update({entry:{fields:{headline:'one'}}}, true);
  await new Promise(r=>setTimeout(r,15)); assert.equal(replies.length,0);
  preview.update({entry:{fields:{headline:'two'}}});
  await new Promise(r=>setTimeout(r,15)); assert.equal(replies.length,1);
  key.revision++; preview.update({});
  assert.equal(replies[0].signal.aborted,true);
  await new Promise(r=>setTimeout(r,15));
  replies[0].resolve({...key,revision:key.revision-1,payload:'stale'});
  replies[1].resolve({...key,payload:'valid'});
  await new Promise(r=>setTimeout(r,0)); assert.deepEqual(received,['valid']);
  key.revision++; preview.update({}); await new Promise(r=>setTimeout(r,15)); replies[2].reject(new Error('unavailable'));
  await new Promise(r=>setTimeout(r,0)); assert.deepEqual(received,['valid']); assert.equal(errors[0].message,'unavailable');
  key.revision++; preview.update({}); preview.dispose(); await new Promise(r=>setTimeout(r,15)); assert.equal(replies.length,3);
});
test('validation failures retain the authorized field identity and translate only the reason', () => {
 const cause={status:400, message:'body: Broken internal link: /missing', code:'studio-validation:'+JSON.stringify({field:'body',entryId:'e',modelKey:'content-page',pageKey:'about'})};
 const result=draftValidation(cause);
 assert.equal(result.field,'body');assert.equal(result.entryId,'e');assert.equal(result.pageKey,'about');assert.equal(result.cause.message,'Broken internal link: /missing');
 assert.equal(draftValidation({status:503,message:'unavailable'}).field,undefined);
});
test('language and site retirement abort transport and reject even identity-forged obsolete completions',async()=>{
 let current={sessionId:'first',revision:1,workspaceId:'w',siteId:'s',language:'en'};const pending=[];const accepted=[];
 const preview=createDraftPreview({key:()=>current,debounceMs:1,request:(body,signal)=>new Promise(resolve=>pending.push({body,signal,resolve})),accept:payload=>accepted.push(payload),fail:()=>assert.fail('retired failure')});
 preview.update({});await new Promise(resolve=>setTimeout(resolve,8));current={...current,sessionId:'second',language:'fr'};preview.update({});await new Promise(resolve=>setTimeout(resolve,8));assert.equal(pending[0].signal.aborted,true);pending[0].resolve({...current,payload:'forged old'});pending[1].resolve({...current,payload:'current'});await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(accepted,['current']);
 current={...current,sessionId:'third',siteId:'other'};preview.update({});await new Promise(resolve=>setTimeout(resolve,8));preview.dispose();pending[2].resolve({...current,payload:'retired'});await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(accepted,['current']);
});
test('a scheduled request preserves the exact overlay revision even if caller data changes',async()=>{
 const received=[];const preview=createDraftPreview({key:()=>key,debounceMs:1,request:async body=>{received.push(body);return {...key,payload:'ok'};},accept:()=>{},fail:error=>assert.fail(String(error))});
 const overlay={entry:{fields:{headline:['Scheduled']}}};preview.update(overlay);overlay.entry.fields.headline[0]='Later';await new Promise(resolve=>setTimeout(resolve,8));assert.equal(received[0].overlay.entry.fields.headline[0],'Scheduled');preview.dispose();
});

test('only explicit missing-translation diagnostics allow the pre-save check to continue',()=>{
 const issue={code:'missing-translation',entryId:'e',modelKey:'home',language:'fr'};
 const error=value=>({status:400,code:'studio-validation:'+JSON.stringify(value),message:'Missing translation'});
 assert.equal(draftValidation(error({missingTranslations:[issue],saveAllowed:true})).saveAllowed,true);
 assert.equal(draftValidation(error({missingTranslations:[issue]})).saveAllowed,false);
 assert.equal(draftValidation(error({missingTranslations:[{...issue,code:'model-binding'}],saveAllowed:true})).saveAllowed,undefined);
});
