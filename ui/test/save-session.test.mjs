import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSession } from '../src/components/studio/save-session.ts';
test('a page conflict preserves acknowledged content and stops settings; retry does not recreate content', async () => {
 const calls=[]; const parts=[
 {key:'content',confirms:['content'],run:async c=>{calls.push('content');return {...c,entryId:'e1',entryUpdatedAt:2};}},
 {key:'page',confirms:['page'],run:async()=>{calls.push('page');throw Object.assign(new Error('conflict'),{status:409});}},
 {key:'settings',confirms:['settings'],run:async c=>{calls.push('settings');return c;}}];
 const result=await saveSession(parts,{siteUpdatedAt:1}); assert.deepEqual(calls,['content','page']); assert.deepEqual(result.completed,['content']); assert.equal(result.context.entryUpdatedAt,2); assert.equal(result.failed.key,'page');
 const retried=await saveSession([{...parts[1],run:async c=>({...c,siteUpdatedAt:3})},parts[2]],result.context); assert.equal(retried.context.siteUpdatedAt,3); assert.deepEqual(calls,['content','page','settings']);
});
test('new page confirms content/page in one request then passes exact receipt to settings',async()=>{
 const result=await saveSession([{key:'page',confirms:['content','page'],run:async c=>({...c,entryId:'new',siteUpdatedAt:6})},{key:'settings',confirms:['settings'],run:async c=>{assert.equal(c.siteUpdatedAt,6);return {...c,siteUpdatedAt:7};}}],{siteUpdatedAt:1});
 assert.deepEqual(result.completed,['content','page','settings']);assert.equal(result.context.siteUpdatedAt,7);assert.equal(result.failed,undefined);
});
