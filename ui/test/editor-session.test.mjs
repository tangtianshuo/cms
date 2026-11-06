import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorSession, sessionDirty, acknowledgeSession } from '../src/components/studio/editor-session.ts';
test('one session retains full Entry and independent baselines after partial saves',()=>{
 const entry={_id:'new',meta:[{lng:'zh',props:[{id:'unknown',data:[{opaque:true}]}]}],content:[{lng:'zh',nodes:[{type:'paragraph'}]}],statuses:[{lng:'zh',id:'draft'}],groupId:'group'};
 const session=createEditorSession({workspaceId:'w',siteId:'s',language:'zh',intent:'edit'},{entry,page:{title:'old'},settings:{name:'old'}},'session');
 session.draft.entry.content[0].nodes.push({type:'horizontalRule'});session.draft.page.title='new';session.draft.settings.name='new';
 assert.deepEqual(sessionDirty(session),{content:true,page:true,settings:true});
 acknowledgeSession(session,['content']);assert.deepEqual(sessionDirty(session),{content:false,page:true,settings:true});
 assert.deepEqual(session.draft.entry.meta,entry.meta);assert.equal(entry.content[0].nodes.length,1);
 acknowledgeSession(session,['page','settings']);assert.deepEqual(sessionDirty(session),{content:false,page:false,settings:false});
});
