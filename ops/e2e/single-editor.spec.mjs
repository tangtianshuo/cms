import { test, expect } from './browser-fixture.mjs';
async function identity(page) { return page.evaluate(async()=>{ const sdk=window.bcms.sdk; await sdk.ensureContext(); const state=await sdk.studio.getSite(); const model=state.models.find(m=>m.key==='product'); return {workspaceId:sdk.context.context.workspaceId,siteId:state.site.id,templateId:model.templateId,modelKey:model.key,entryId:model.entries[0].id,language:state.site.language}; }); }
async function showCanvas(page,info){if(info.project.name==='mobile')await page.getByRole('tab',{name:'查看画布',exact:true}).click();}
async function showProperties(page,info){if(info.project.name==='mobile')await page.getByRole('tab',{name:'编辑内容',exact:true}).click();}
const workspace=page=>page.getByRole('region',{name:'内容编辑工作区',exact:true});
test('legacy entry and page bookmarks converge, preserve focus and survive history and refresh',async({page,installation},info)=>{
 const id=await identity(page);
 await page.goto(`/d/template/${id.templateId}/entry/${id.entryId}?language=${id.language}&field=title`);
 await expect(page).toHaveURL(/\/d\/studio\?/);
 await expect(workspace(page)).toHaveCount(1);
 await expect(page.locator('#studio-field-title')).toBeFocused();
 await page.reload(); await expect(workspace(page)).toHaveCount(1);await showCanvas(page,info);await expect(page.frameLocator('.studio-visual-preview iframe').locator('[data-section-type]').first()).toBeVisible();
 await showProperties(page,info);await page.goto('/d/studio?section=pages&pageKey=home'); await expect(workspace(page)).toHaveCount(1);
 await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);
 await page.getByRole('tab',{name:/页面内容/}).click();
 await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);
 await page.goBack(); await expect(workspace(page)).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('single-workspace.png'),mask:[page.getByText(process.env.STOREFRONT_E2E_EMAIL,{exact:false})]});
});
test('untrusted query identities and missing targets fail closed',async({page,installation})=>{
 const id=await identity(page);
 for(const patch of [{siteId:'other-site'},{workspaceId:'other-workspace'},{entryId:'missing-entry'},{language:'missing-language'},{templateId:'other-model'}]){
  await page.goto('/d/studio?'+new URLSearchParams({section:'content',...id,...patch}));
  await expect(page.getByRole('alert')).toBeVisible(); await expect(workspace(page)).toHaveCount(0);
 }
});
test('workbench, sidebar, content lists, page list and onboarding all enter the workspace',async({page,installation})=>{
 await page.goto('/d/studio'); await page.getByRole('button',{name:'编辑首页',exact:false}).click(); await expect(workspace(page)).toHaveCount(1);
 await page.goto('/d/studio?section=content&modelKey=product'); await page.locator('.studio-row-action').first().click(); await expect(workspace(page)).toHaveCount(1);
 await page.goto('/d/studio?section=pages'); await page.getByRole('button',{name:'编辑页面',exact:true}).first().click(); await expect(workspace(page)).toHaveCount(1);
 await page.goto('/d/site-setup'); await page.locator('a[href*="modelKey=home"]').first().click(); await expect(workspace(page)).toHaveCount(1);
 await page.goto('/d/studio?section=content&modelKey=product'); await page.getByRole('button',{name:/新增商品/}).first().click(); await expect(workspace(page)).toHaveCount(1); await expect(page).toHaveURL(/entryId=create/);
});

test('brand, navigation and legacy list actions enter the sole authorized workspace',async({page,installation})=>{
 const id=await identity(page);await page.goto('/d/studio?section=settings');await page.getByRole('button',{name:'编辑品牌与联系资料 →',exact:true}).click();await expect(workspace(page)).toHaveCount(1);await expect(page).toHaveURL(/modelKey=site-settings/);
 await page.goto('/d/studio?section=settings');await page.getByRole('button',{name:'编辑网站导航 →',exact:true}).click();await expect(workspace(page)).toHaveCount(1);await expect(page.getByLabel('页面名称',{exact:true})).toBeVisible();
 await page.goto(`/d/template/${id.templateId}/entry`);const row=page.locator('.cms-table-row[href*="entryId="]').first();await expect(row).toBeVisible();expect(await row.getAttribute('href')).toContain('/d/studio?');await row.click();await expect(workspace(page)).toHaveCount(1);await expect(page.getByLabel('内容语言',{exact:true})).toHaveValue(id.language);
 await page.goto(`/d/template/${id.templateId}/entry`);await page.getByRole('button',{name:'新建条目',exact:true}).click();await expect(workspace(page)).toHaveCount(1);await expect(page).toHaveURL(/entryId=create/);
});

test('generic entry API enforces selected site, capabilities and atomic two-client versions',async({page,installation})=>{
 const result=await page.evaluate(async()=>{
  const sdk=window.bcms.sdk; const state=await sdk.studio.getSite(); const model=state.models.find(m=>m.key==='product');
  const original=await sdk.entry.get({templateId:model.templateId,entryId:model.entries[0].id,skipCache:true});
  const body=entry=>({_id:entry._id,templateId:entry.templateId,expectedUpdatedAt:entry.updatedAt,lng:state.site.language,meta:entry.meta.find(m=>m.lng===state.site.language),content:entry.content.find(m=>m.lng===state.site.language)});
  const status=async fn=>{try{await fn();return 200;}catch(e){return e.response?.status||e.status||0;}};
  const first=await sdk.entry.update(body(original));
  const stale=await status(()=>sdk.entry.update(body(original)));
  const fresh=await sdk.entry.get({templateId:model.templateId,entryId:original._id,skipCache:true});
  const other=await sdk.send({url:'/api/v4/workspaces/current/sites',method:'POST',data:{name:'B5 second site'}});
  const selector={workspaceId:sdk.context.context.workspaceId,siteId:other._id};
  const installed=await sdk.send({url:'/api/v4/presets/import',method:'POST',data:{presetId:'aeroframe',siteName:'B5 second site',includeDemo:true},selectorOverride:selector});
  const otherState=await sdk.send({url:'/api/v4/studio/site',selectorOverride:selector});
  const otherModel=otherState.models.find(m=>m.key==='product');
  const otherEntry=(await sdk.send({url:`/api/v4/template/${otherModel.templateId}/entry/${otherModel.entries[0].id}`,selectorOverride:selector})).item;
  const cross=await Promise.all([
   status(()=>sdk.send({url:`/api/v4/template/${otherModel.templateId}/entry/${otherEntry._id}`})),
   status(()=>sdk.send({url:`/api/v4/template/${otherModel.templateId}/entry/all/lite`})),
   status(()=>sdk.send({url:`/api/v4/template/${otherModel.templateId}/entry/update`,method:'PUT',data:body(otherEntry)})),
   status(()=>sdk.send({url:`/api/v4/template/${otherModel.templateId}/entry/create`,method:'POST',data:{statuses:[],meta:otherEntry.meta,content:otherEntry.content}})),
  ]);
  const after=(await sdk.send({url:`/api/v4/template/${otherModel.templateId}/entry/${otherEntry._id}`,selectorOverride:selector})).item;
  const afterState=await sdk.send({url:'/api/v4/studio/site',selectorOverride:selector});
  const templates=await sdk.send({url:'/api/v4/template/all'});
  return {stale,monotonic:first.updatedAt>original.updatedAt,unchanged:fresh.updatedAt===first.updatedAt,cross,otherUnchanged:after.updatedAt===otherEntry.updatedAt,otherCount:afterState.models.find(m=>m.key==='product').entries.length===otherModel.entries.length,filtered:!templates.items.some(t=>t.siteId===other._id)};
 });
 expect(result).toEqual({stale:409,monotonic:true,unchanged:true,cross:[403,403,403,403],otherUnchanged:true,otherCount:true,filtered:true});
});

test('full new-page payload preserves all content and retries once while rejecting changed operation payloads',async({page,installation})=>{
 const result=await page.evaluate(async()=>{
  const sdk=window.bcms.sdk; const state=await sdk.studio.getSite(); const model=state.models.find(m=>m.key==='content-page');
  const raw=await sdk.entry.get({templateId:model.templateId,entryId:model.entries[0].id,skipCache:true});
  const template=await sdk.template.get({templateId:model.templateId});
  const draft=structuredClone(raw); const lang=state.site.language; const statuses=await sdk.entryStatus.getAll(); if (statuses[0]) draft.statuses=[{lng:lang,id:statuses[0]._id}]; const meta=draft.meta.find(m=>m.lng===lang);
  const title=template.props.find(p=>p.name==='title'); const slug=template.props.find(p=>p.name==='slug');
  meta.props.find(p=>p.id===title.id).data=['B5 full page '+crypto.randomUUID().slice(0,6)]; meta.props.find(p=>p.id===slug.id).data=['b5-full-'+crypto.randomUUID().slice(0,6)];
  // Each created translation needs its own unique title/slug within the original group.
  for (const localized of draft.meta.filter(meta=>meta.lng!==lang)) {
    localized.props.find(prop=>prop.id===title.id).data=['B5 full translation '+crypto.randomUUID()];
    localized.props.find(prop=>prop.id===slug.id).data=['b5-translation-'+crypto.randomUUID()];
  }
  draft.content.find(c=>c.lng===lang).nodes=[{type:'paragraph',content:[{type:'text',text:'B5 formatted body',marks:[{type:'bold'}]}]}];
  const data={operationId:crypto.randomUUID(),expectedUpdatedAt:state.site.updatedAt,blueprintKey:state.site.blueprints.find(b=>b.modelKey===model.key).key,title:meta.props.find(p=>p.id===title.id).data[0],path:state.site.pages.find(p=>p.key===state.site.blueprints.find(b=>b.modelKey===model.key).key).path.replace(/:[a-zA-Z0-9_]+/g,'b5-'+crypto.randomUUID().slice(0,8)),entry:{meta:draft.meta,content:draft.content,statuses:draft.statuses,groupId:raw.groupId}};
  const status=async fn=>{try{await fn();return 200;}catch(e){return e.response?.status||e.status||0;}};
  const both=await status(()=>sdk.studio.createPage({...data,fields:{}}));
  let page; try { page=await sdk.studio.createPage(data); } catch(e) { return {creationStatus:e.response?.status||e.status||0,message:e.message}; } const retry=await sdk.studio.createPage(data);
  const saved=await sdk.entry.get({templateId:model.templateId,entryId:page.entryId,skipCache:true});
  const changed=structuredClone(data);changed.entry.content.find(c=>c.lng===lang).nodes=[];
  const conflict=await status(()=>sdk.studio.createPage(changed));
  const stale=await status(()=>sdk.studio.createPage({...data,operationId:crypto.randomUUID(),path:data.path+'-stale'}));
  const after=await sdk.studio.getSite();
  const preview=await status(()=>sdk.send({url:'/api/v4/storefront/site-preview'}));
  return {preview,both,same:page.key===retry.key,meta:JSON.stringify(saved.meta)===JSON.stringify(draft.meta),body:JSON.stringify(saved.content.find(c=>c.lng===lang).nodes)===JSON.stringify(draft.content.find(c=>c.lng===lang).nodes),status:JSON.stringify(saved.statuses)===JSON.stringify(draft.statuses),group:saved.groupId===raw.groupId,conflict,stale,otherLanguages:JSON.stringify(saved.meta.filter(m=>m.lng!==lang))===JSON.stringify(draft.meta.filter(m=>m.lng!==lang)),one:after.site.pages.filter(p=>p.path===data.path).length===1};
 });
 expect(result).toEqual({preview:200,both:400,same:true,meta:true,body:true,status:true,group:true,conflict:409,stale:409,otherLanguages:true,one:true});
});

test('uninstalled historical models stay editable with language, status, group and legacy focus',async({page,installation})=>{
 const history=await page.evaluate(async()=>{
  const sdk=window.bcms.sdk; const template=await sdk.template.create({label:'B5 historical '+crypto.randomUUID().slice(0,8),desc:'Uninstalled history',singleEntry:false});
  const language=(await sdk.studio.getSite()).site.language;
  const values=template.props.map((p,i)=>({id:p.id,data:[i===0?'Historical content':i===1?'historical-'+crypto.randomUUID().slice(0,8):'']}));
  const groups=await sdk.send({url:'/api/v4/entry-groups/'});
  const entry=await sdk.entry.create({templateId:template._id,data:{groupId:groups.defaultGroupId,statuses:[],meta:[{lng:language,props:values}],content:[{lng:language,nodes:[],plainText:''}]}});
  return {templateId:template._id,entryId:entry._id,language,group:entry.groupId};
 });
 await page.goto(`/d/template/${history.templateId}/entry/${history.entryId}?language=${history.language}&group=${history.group}&field=title`);
 await expect(workspace(page)).toHaveCount(1); await expect(page.getByText('此内容尚未关联网站页面',{exact:true})).toBeVisible();
 await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(0); await expect(page.locator('#studio-field-title')).toBeFocused();
 await expect(page.getByLabel('内容分组',{exact:true})).toHaveValue(history.group); await expect(page.getByLabel('内容语言',{exact:true})).toHaveValue(history.language);
 await page.locator('#studio-field-title').fill('Historical edited '+history.entryId);
 const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname.endsWith('/entry/update'));
 await page.getByRole('button',{name:'保存草稿',exact:true}).focus();await page.keyboard.press('Enter');expect((await saved).status()).toBe(200);
 await page.reload(); await expect(page.locator('#studio-field-title')).toHaveText('Historical edited '+history.entryId);
 const destination=`/d/template/${history.templateId}/entry/${history.entryId}?language=${history.language}&field=title`;
 const changed=page.waitForURL(url=>url.pathname==='/d/studio'&&url.searchParams.get('entryId')===history.entryId&&!url.searchParams.has('siteId'));
 await page.evaluate(destination=>{void window.bcms.sdk.selectContext({workspaceId:window.bcms.sdk.context.context.workspaceId},destination);},destination);await changed;
 await expect(page.locator('#studio-field-title')).toHaveText('Historical edited '+history.entryId);
 await page.locator('#studio-field-title').fill('Unbound edited '+history.entryId);
 const unboundSaved=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname.endsWith('/entry/update'));
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await unboundSaved).status()).toBe(200);
 await page.reload();await expect(page.locator('#studio-field-title')).toHaveText('Unbound edited '+history.entryId);
});

test('page-only targets keep one canvas and no accidental create form',async({page,installation})=>{
 await page.goto('/d/studio?section=pages&pageKey=collections'); await expect(workspace(page)).toHaveCount(1);
 await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1); await expect(page.locator('.studio-workspace-content')).toContainText('此页面尚未绑定可编辑内容');
 await page.getByRole('tab',{name:'页面信息',exact:true}).click(); await expect(page.getByLabel('页面名称',{exact:true})).toBeVisible();
 await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1); await expect(page).not.toHaveURL(/entryId=create/);
});

test('conflicting full-entry save preserves the local field and server winner',async({page,installation})=>{
 const id=await identity(page);await page.goto('/d/studio?'+new URLSearchParams({section:'content',...id,field:'title'}));await expect(page.locator('#studio-field-title')).toBeFocused();
 await page.locator('#studio-field-title').fill('Local conflict draft');
 const winner=await page.evaluate(async id=>{const sdk=window.bcms.sdk;const entry=await sdk.entry.get({templateId:id.templateId,entryId:id.entryId,skipCache:true});entry.meta.find(m=>m.lng===id.language).props[0].data=['Server conflict winner'];const saved=await sdk.entry.update({_id:entry._id,templateId:entry.templateId,expectedUpdatedAt:entry.updatedAt,lng:id.language,meta:entry.meta.find(m=>m.lng===id.language),content:entry.content.find(m=>m.lng===id.language)});return saved.updatedAt;},id);
 const failed=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/studio/entries/'));
 await page.getByRole('button',{name:'保存草稿',exact:true}).click(); expect((await failed).status()).toBe(409);
 await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('#studio-field-title')).toHaveText('Local conflict draft');
 expect(await page.evaluate(async({id,winner})=>{const e=await window.bcms.sdk.entry.get({templateId:id.templateId,entryId:id.entryId,skipCache:true});return e.updatedAt===winner&&e.meta.find(m=>m.lng===id.language).props[0].data[0]==='Server conflict winner';},{id,winner})).toBe(true);
});

test('new-page wizard initializes the same draft, shows its canvas and creates full content once',async({page,installation},info)=>{
 await page.goto('/d/studio?section=pages'); await page.getByRole('button',{name:'新增页面',exact:true}).click();
 await page.locator('.studio-page-blueprints button').first().click(); await expect(workspace(page)).toHaveCount(1);await expect(page).toHaveURL(/entryId=create/);
 await page.getByRole('tab',{name:'页面信息',exact:true}).click();
 const name=`B5 wizard ${info.project.name}`; await page.getByLabel('页面名称',{exact:true}).fill(name);
 await page.getByLabel(/^访问路径/).fill(`/pages/b5-wizard-${info.project.name}`);
 await page.getByRole('tab',{name:'页面内容',exact:true}).click();
 const title=page.locator('.studio-workspace-content [contenteditable="true"]').first();await title.fill(name);await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);
 const created=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v4/studio/pages');
 await page.getByRole('button',{name:'保存草稿',exact:true}).focus();await page.keyboard.press('Enter');expect((await created).status()).toBe(200);
 await expect(page).not.toHaveURL(/entryId=create/); await expect(workspace(page)).toHaveCount(1);await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);
 await page.reload();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await showCanvas(page,info);await expect(page.frameLocator('.studio-visual-preview iframe').locator('[data-section-type]').first()).toBeVisible();
 await showProperties(page,info);await page.getByRole('tab',{name:'页面内容',exact:true}).click();
 const draftTitle=page.locator('.studio-workspace-content [contenteditable="true"]').first();await draftTitle.fill(name+' local draft');
 const frame=await page.locator('.studio-visual-preview iframe').elementHandle();
 for(const tab of ['页面信息','区块','页面内容']){await page.getByRole('tab',{name:tab,exact:true}).click();expect(await frame.evaluate(el=>el.isConnected)).toBe(true);await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);}
 await expect(draftTitle).toHaveText(name+' local draft');
 const picker=page.getByLabel('查看页面',{exact:true});const alternate=await picker.locator('option').evaluateAll(options=>options.find(option=>!option.selected)?.value);
 expect(alternate).toBeTruthy();await picker.selectOption(alternate);await expect(draftTitle).toHaveText(name+' local draft');await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);
});

test('media and Entry pickers keep the same local draft and canvas across tabs',async({page,installation},info)=>{
 const fixture=await page.evaluate(async()=>{const sdk=window.bcms.sdk;const state=await sdk.studio.getSite();const model=state.models.find(m=>m.key==='home');const template=await sdk.template.get({templateId:model.templateId});const raw=await sdk.entry.get({templateId:model.templateId,entryId:model.entries[0].id,skipCache:true});const languages=await sdk.language.getAll();const prefix=`entry.meta.${languages.findIndex(l=>l.code===state.site.language)}.props.`;const reference=template.props.find(p=>p.name==='featuredProducts');const selected=raw.meta.find(m=>m.lng===state.site.language).props.find(p=>p.id===reference.id)?.data[0]?.eid;const productModel=state.models.find(m=>m.key==='product');let product=productModel.entries.find(e=>e.id!==selected);if(!product){const template=await sdk.template.get({templateId:productModel.templateId});const original=await sdk.entry.get({templateId:template._id,entryId:productModel.entries[0].id,skipCache:true});const meta=structuredClone(original.meta);const name='B5 picker target '+crypto.randomUUID().slice(0,8);for(const m of meta){m.props.find(p=>p.id===template.props.find(p=>p.name==='title').id).data=[name];m.props.find(p=>p.id===template.props.find(p=>p.name==='slug').id).data=['b5-picker-'+crypto.randomUUID().slice(0,8)];}const created=await sdk.entry.create({templateId:template._id,data:{meta,content:original.content,statuses:[],groupId:original.groupId}});product={id:created._id,fields:{title:[name]}};}return {id:{workspaceId:sdk.context.context.workspaceId,siteId:state.site.id,modelKey:'home',templateId:model.templateId,entryId:raw._id,language:state.site.language},mediaPath:prefix+template.props.findIndex(p=>p.name==='heroImage'),referencePath:prefix+template.props.indexOf(reference),mediaProp:template.props.find(p=>p.name==='heroImage').id,referenceProp:reference.id,productId:product.id,productTitle:product.fields.title[0],version:raw.updatedAt};});
 await page.goto('/d/studio?'+new URLSearchParams({section:'content',...fixture.id,field:'title'}));
 const title=page.locator('#studio-field-title');await expect(title).toBeFocused();const name=`B5 picker ${info.project.name}`;await title.fill(name);
 const frame=await page.locator('.studio-visual-preview iframe').elementHandle();const writes=[];page.on('request',request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname.endsWith('/entry/update'))writes.push(request.url());});
 const media=page.locator(`[data-bcms-prop-input-wrapper][id="${fixture.mediaPath}"]`);await media.locator('button').first().click();
 const dialog=page.getByRole('dialog',{name:'媒体选择器',exact:true});await expect(dialog.locator('.cms-modal-panel')).toBeVisible();
 await expect(dialog.locator('[bcms-media-data]').filter({has:page.locator('img[alt="B4 foreign image.png"]')})).toHaveCount(0);
 expect(await page.evaluate(async({ownMedia,site})=>{const handler=window.bcms.modalService.handlers.mediaSelect;handler._onOpen({data:{mediaId:ownMedia,site,isCurrent:()=>false}});return (await handler._onDone())[0];},{ownMedia:process.env.STOREFRONT_E2E_OWN_MEDIA,site:{_id:fixture.id.siteId,workspaceId:fixture.id.workspaceId}})).toBe(false);
 expect(await page.evaluate(async({foreignMedia,site})=>{const handler=window.bcms.modalService.handlers.mediaSelect;handler._onOpen({data:{mediaId:foreignMedia,site}});return (await handler._onDone())[0];},{foreignMedia:process.env.STOREFRONT_E2E_FOREIGN_MEDIA,site:{_id:fixture.id.siteId,workspaceId:fixture.id.workspaceId}})).toBe(false);
 await dialog.locator('[bcms-media-data]').filter({has:page.locator('img[alt="B4 own image.png"]')}).first().locator('..').click();
 await dialog.getByRole('button',{name:'完成',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(media).toContainText('B4 own image.png');await expect(title).toHaveText(name);
 const reference=page.locator(`[data-bcms-prop-input-wrapper][id="${fixture.referencePath}"]`);if(!await reference.locator('.cms-select-trigger').count())await reference.getByRole('button',{name:/添加新项/}).click();
 await reference.locator('.cms-select-trigger').first().click();await page.getByRole('option').filter({hasText:fixture.productTitle}).click();await expect(reference.locator('.cms-select-trigger').first()).toContainText(fixture.productTitle);
 for(const tab of ['页面信息','区块','页面内容']){await page.getByRole('tab',{name:tab,exact:true}).click();expect(await frame.evaluate(el=>el.isConnected)).toBe(true);await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);}
 await expect(title).toHaveText(name);await expect(media).toContainText('B4 own image.png');await expect(reference.locator('.cms-select-trigger').first()).toContainText(fixture.productTitle);expect(writes).toHaveLength(0);
 const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/studio/entries/'));await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await saved).status()).toBe(200);
 expect(await page.evaluate(async({fixture,ownMediaId})=>{const saved=await window.bcms.sdk.entry.get({templateId:fixture.id.templateId,entryId:fixture.id.entryId,skipCache:true});const props=saved.meta.find(m=>m.lng===fixture.id.language).props;return props.find(p=>p.id===fixture.mediaProp).data[0]._id===ownMediaId&&props.find(p=>p.id===fixture.referenceProp).data[0].eid===fixture.productId;},{fixture,ownMediaId:process.env.STOREFRONT_E2E_OWN_MEDIA})).toBe(true);
 await page.reload();await expect(title).toHaveText(name);await expect(media).toContainText('B4 own image.png');await expect(reference.locator('.cms-select-trigger').first()).toContainText(fixture.productTitle);
 await page.goto('/d/studio');await page.getByRole('button',{name:'编辑首页',exact:false}).click();await expect(media).toContainText('B4 own image.png');await media.locator('button').first().click();await expect(dialog.locator('.cms-modal-panel')).toBeVisible();
 await page.goBack();await expect(page.getByRole('heading',{name:'工作台',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'编辑首页',exact:false}).click();await expect(page.locator('.studio-workspace-content [contenteditable="true"]').first()).toHaveText(name);
});

test('historical unbound media picker keeps workspace choices with and without a selected site',async({page,installation},info)=>{
 const fixture=await page.evaluate(async foreignMedia=>{const sdk=window.bcms.sdk;let template=await sdk.template.create({label:'B5 historic picker '+crypto.randomUUID().slice(0,8),desc:'',singleEntry:false});template=await sdk.template.update({_id:template._id,propChanges:[{add:{label:'History media',type:'MEDIA',required:false,array:false,data:{}}}]});const language=(await sdk.studio.getSite()).site.language;const values=template.props.map((p,i)=>({id:p.id,data:p.type==='MEDIA'?[{_id:foreignMedia}]:[i===0?'History media draft':'history-media-'+crypto.randomUUID().slice(0,8)]}));const entry=await sdk.entry.create({templateId:template._id,data:{statuses:[],meta:[{lng:language,props:values}],content:[{lng:language,nodes:[]}]}});const languages=await sdk.language.getAll();return {templateId:template._id,entryId:entry._id,language,mediaPath:`entry.meta.${languages.findIndex(l=>l.code===language)}.props.${template.props.findIndex(p=>p.type==='MEDIA')}`,workspaceId:sdk.context.context.workspaceId};},process.env.STOREFRONT_E2E_FOREIGN_MEDIA);
 const url=`/d/template/${fixture.templateId}/entry/${fixture.entryId}?language=${fixture.language}&field=title`;await page.goto(url);
 for(const noSite of [false,true]){
  if(noSite){const changed=page.waitForURL(url=>url.pathname==='/d/studio'&&!url.searchParams.has('siteId'));await page.evaluate(({fixture,url})=>{void window.bcms.sdk.selectContext({workspaceId:fixture.workspaceId},url);},{fixture,url});await changed;}
  const title=page.locator('#studio-field-title');await expect(title).toBeFocused();const name=`Historical picker ${info.project.name} ${noSite}`;await title.fill(name);
  const media=page.locator(`[data-bcms-prop-input-wrapper][id="${fixture.mediaPath}"]`);await media.locator('button').first().click();const dialog=page.getByRole('dialog',{name:'媒体选择器',exact:true});await expect(dialog.locator('.cms-modal-panel')).toBeVisible();await expect(dialog.locator('[bcms-media-data]').filter({has:page.locator('img[alt="B4 foreign image.png"]')})).toHaveCount(2);
  await dialog.getByRole('button',{name:'完成',exact:true}).click();await expect(title).toHaveText(name);await expect(media).toContainText('B4 foreign image.png');const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname.endsWith('/entry/update'));await page.getByRole('button',{name:'保存草稿',exact:true}).focus();await page.keyboard.press('Enter');expect((await saved).status()).toBe(200);await page.reload();await expect(title).toHaveText(name);await expect(media).toContainText('B4 foreign image.png');
 }
});

test('bound default-workspace media picker accepts an authorized unbound legacy file',async({page,installation},info)=>{
 const fixture=await page.evaluate(async()=>{const sdk=window.bcms.sdk;const selection={workspaceId:'default'};const site=await sdk.send({url:'/api/v4/workspaces/current/sites',method:'POST',data:{name:'B5 legacy media site'},selectorOverride:selection});const chosen={...selection,siteId:site._id};await sdk.send({url:'/api/v4/presets/import',method:'POST',data:{presetId:'aeroframe',siteName:'B5 legacy media site',includeDemo:true},selectorOverride:chosen});const upload=await sdk.send({url:'/api/v4/media/request/upload-token',selectorOverride:selection});const form=new FormData();form.append('file',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),'B5 legacy unbound.png');const response=await fetch(`/api/v4/media/create/file?token=${upload.token}`,{method:'POST',body:form});const media=(await response.json()).item;const state=await sdk.send({url:'/api/v4/studio/site',selectorOverride:chosen});const model=state.models.find(m=>m.key==='content-page');return {selection:chosen,templateId:model.templateId,entryId:model.entries[0].id,language:state.site.language,mediaId:media._id,unbound:!media.siteId};});expect(fixture.unbound).toBe(true);
 const destination='/d/studio?'+new URLSearchParams({section:'content',templateId:fixture.templateId,entryId:fixture.entryId,language:fixture.language,field:'title'});const changed=page.waitForURL(url=>url.pathname==='/d/studio'&&url.searchParams.get('entryId')===fixture.entryId);await page.evaluate(({fixture,destination})=>{void window.bcms.sdk.selectContext(fixture.selection,destination);},{fixture,destination});await changed;
 const title=page.locator('#studio-field-title');await expect(title).toBeFocused();await title.fill(`B5 legacy picker ${info.project.name}`);const media=page.locator('[data-bcms-prop-input-wrapper]').filter({hasText:'Cover'}).first();await media.locator('button').first().click();const dialog=page.getByRole('dialog',{name:'媒体选择器',exact:true});await expect(dialog.locator('.cms-modal-panel')).toBeVisible();await dialog.locator('[bcms-media-data]').filter({has:page.locator('img[alt="B5 legacy unbound.png"]')}).first().locator('..').click();await dialog.getByRole('button',{name:'完成',exact:true}).click();const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/studio/entries/'));await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await saved).status()).toBe(200);await page.reload();await expect(media).toContainText('B5 legacy unbound.png');
});

test('sidebar navigation, forward history and legacy create retain the authorized workspace',async({page,installation},info)=>{
 const id=await identity(page);
 if(info.project.name==='mobile') await page.getByRole('button',{name:'展开导航',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'网站内容',exact:true}).click();
 await page.locator('.studio-row-action').first().click();await expect(workspace(page)).toHaveCount(1);
 await expect(page.getByText('草稿已保存',{exact:true})).toBeVisible();await page.goBack();await expect(page.locator('.studio-row-action').first()).toBeVisible();
 await page.goForward();await expect(workspace(page)).toHaveCount(1);
 await page.goto('/d/studio');
 if(info.project.name==='mobile') await page.getByRole('button',{name:'展开导航',exact:true}).click();
 const models=page.getByRole('navigation',{name:'网站内容模型',exact:true});
 await page.locator('summary:visible').filter({hasText:'网站内容分类'}).click();await models.locator(`a[href*="${id.templateId}"]`).click();
 await page.locator('.studio-row-action').first().click();await expect(workspace(page)).toHaveCount(1);
 await page.goto(`/d/template/${id.templateId}/entry/create?language=${id.language}&field=title`);
 await expect(workspace(page)).toHaveCount(1);await expect(page.locator('#studio-field-title')).toBeFocused();
 await expect(page.getByLabel('内容语言',{exact:true})).toHaveValue(id.language);await expect(page).toHaveURL(/entryId=create/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('an existing entry with no selected translation remains read-only',async({page,installation},info)=>{
 const id=await identity(page);const code=info.project.name==='desktop'?'fr':'de';
 await page.evaluate(async code=>{const sdk=window.bcms.sdk;if(!(await sdk.language.getAll()).some(l=>l.code===code))await sdk.language.create({code,name:code,nativeName:code});},code);
 await page.goto('/d/studio?'+new URLSearchParams({section:'content',...id,language:code,field:'title'}));
 await expect(workspace(page)).toHaveCount(1);await expect(page.getByText(/当前内容没有此语言版本/)).toBeVisible();
 await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
 expect(await page.locator('#studio-field-title').evaluate(el=>Boolean(el.closest('[inert]')))).toBe(true);
 await page.getByLabel('内容语言',{exact:true}).selectOption(id.language);await expect(page.getByText(/当前内容没有此语言版本/)).toHaveCount(0);
});

test('full page content rejects nested foreign workspace and site resources while current-site references succeed',async({page,installation})=>{
 const result=await page.evaluate(async ({ownMediaId,foreignSiteMedia})=>{
  const sdk=window.bcms.sdk;const before=await sdk.studio.getSite();const model=before.models.find(m=>m.key==='content-page');
  let raw=await sdk.entry.get({templateId:model.templateId,entryId:model.entries[0].id,skipCache:true});
  const editLanguage=raw.meta[0].lng;const untouchedLanguage=editLanguage==='fr'?'de':'fr';
  if(!(await sdk.language.getAll()).some(l=>l.code===untouchedLanguage))await sdk.language.create({code:untouchedLanguage,name:untouchedLanguage,nativeName:untouchedLanguage});
  await sdk.entry.update({_id:raw._id,templateId:raw.templateId,expectedUpdatedAt:raw.updatedAt,lng:untouchedLanguage,meta:{...structuredClone(raw.meta[0]),lng:untouchedLanguage},content:{lng:untouchedLanguage,nodes:[{type:'paragraph',content:[{type:'text',text:'Untouched translation'}]}]}});
  raw=await sdk.entry.get({templateId:raw.templateId,entryId:raw._id,skipCache:true});
  const currentTemplate=await sdk.template.get({templateId:model.templateId});
  const otherSite=await sdk.send({url:'/api/v4/workspaces/current/sites',method:'POST',data:{name:'B5 reference site'}});const otherSelection={workspaceId:sdk.context.context.workspaceId,siteId:otherSite._id};
  await sdk.send({url:'/api/v4/presets/import',method:'POST',data:{presetId:'aeroframe',siteName:'B5 reference site',includeDemo:true},selectorOverride:otherSelection});
  const otherState=await sdk.send({url:'/api/v4/studio/site',selectorOverride:otherSelection});const otherModel=otherState.models.find(m=>m.key==='content-page');
  const foreign=await sdk.send({url:'/api/v4/workspaces',method:'POST',data:{name:'B5 foreign resources '+crypto.randomUUID()}});const selection={workspaceId:foreign._id};
  const upload=await sdk.send({url:'/api/v4/media/request/upload-token',selectorOverride:selection});
  const form=new FormData();form.append('file',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),'b5-foreign.png');
  const uploaded=await fetch(`/api/v4/media/create/file?token=${upload.token}`,{method:'POST',body:form});const media=(await uploaded.json()).item;
  const foreignTemplate=(await sdk.send({url:'/api/v4/template/create',method:'POST',data:{label:'B5 foreign template',desc:'',singleEntry:false},selectorOverride:selection})).item;
  await sdk.send({url:'/api/v4/language/create',method:'POST',data:{code:'en',name:'English',nativeName:'English'},selectorOverride:selection});
  const foreignEntry=(await sdk.send({url:`/api/v4/template/${foreignTemplate._id}/entry/create`,method:'POST',selectorOverride:selection,data:{statuses:[],meta:[{lng:'en',props:foreignTemplate.props.map((p,i)=>({id:p.id,data:[i===0?'Foreign entry':'foreign-entry']}))}],content:[{lng:'en',nodes:[]}]}})).item;
  let widget=await sdk.widget.create({label:'B5 nested '+crypto.randomUUID().slice(0,8),desc:''});
  widget=await sdk.widget.update({_id:widget._id,propChanges:[{add:{label:'Image',type:'MEDIA',required:false,array:false,data:{}}},{add:{label:'Related',type:'ENTRY_POINTER',required:false,array:false,data:{propEntryPointer:[model.templateId,otherModel.templateId].map(templateId=>({templateId,entryIds:[],displayProp:'title'}))}}}]});
  if(!ownMediaId||!foreignSiteMedia||!media?._id||!foreignEntry?._id||!otherModel?.entries[0]?.id)throw new Error('Nested resource fixture setup is incomplete');
  const imageId=widget.props.find(p=>p.type==='MEDIA').id;const pointerId=widget.props.find(p=>p.type==='ENTRY_POINTER').id;
  const body=(mediaId,tid,eid)=>{const unique=crypto.randomUUID().slice(0,8);const meta=structuredClone(raw.meta);for(const m of meta){m.props.find(p=>p.id===currentTemplate.props.find(p=>p.name==='title').id).data=['B5 references '+unique];m.props.find(p=>p.id===currentTemplate.props.find(p=>p.name==='slug').id).data=['b5-reference-'+unique];}return {operationId:crypto.randomUUID(),expectedUpdatedAt:before.site.updatedAt,blueprintKey:before.site.blueprints.find(b=>b.modelKey===model.key).key,title:'B5 references '+unique,path:'/pages/b5-reference-'+unique,entry:{meta,statuses:raw.statuses,groupId:raw.groupId,content:raw.content.map(c=>({...c,nodes:[{type:'widget',attrs:{data:{_id:widget._id,props:[{id:imageId,data:[{_id:mediaId}]},{id:pointerId,data:[{tid,eid}]}]}}}]}))}};};
  const status=async fn=>{try{await fn();return 200;}catch(e){return e.response?.status||e.status||0;}};
  const getRaw=()=>sdk.entry.get({templateId:raw.templateId,entryId:raw._id,skipCache:true});
  const boundUpdate=async(mediaId,tid,eid)=>{const latest=await getRaw();const payload=body(mediaId,tid,eid).entry;return sdk.entry.update({_id:raw._id,templateId:raw.templateId,expectedUpdatedAt:latest.updatedAt,lng:editLanguage,meta:raw.meta.find(m=>m.lng===editLanguage),content:payload.content.find(c=>c.lng===editLanguage)});};
  const boundCreate=(mediaId,tid,eid)=>sdk.entry.create({templateId:model.templateId,data:body(mediaId,tid,eid).entry});
  const lite=await sdk.entry.getAllLite({skipCache:true});const liteFiltered=lite.some(e=>e._id===raw._id)&&!lite.some(e=>e.templateId===otherModel.templateId);
  const badSite=[[foreignSiteMedia,model.templateId,raw._id],[ownMediaId,otherModel.templateId,otherModel.entries[0].id]];
  const updates=[];const creates=[];for(const args of badSite){updates.push(await status(()=>boundUpdate(...args)));creates.push(await status(()=>boundCreate(...args)));}
  const afterBound=await getRaw();const boundUnchanged=JSON.stringify(afterBound)===JSON.stringify(raw);
  const pageWrite=async(...args)=>{const payload=body(...args);payload.expectedUpdatedAt=(await sdk.studio.getSite()).site.updatedAt;return sdk.studio.createPage(payload);};
  const denied=[];for(const args of [[media._id,model.templateId,raw._id],[ownMediaId,foreignTemplate._id,foreignEntry._id],...badSite])denied.push(await status(()=>pageWrite(...args)));
  const after=await sdk.studio.getSite();const unchanged=before.site.updatedAt===after.site.updatedAt&&before.site.pages.length===after.site.pages.length&&model.entries.length===after.models.find(m=>m.key===model.key).entries.length;
  const currentUpdate=await status(()=>boundUpdate(ownMediaId,model.templateId,raw._id));const saved=await getRaw();
  const otherLanguages=entry=>({meta:entry.meta.filter(m=>m.lng!==editLanguage),content:entry.content.filter(c=>c.lng!==editLanguage),statuses:entry.statuses,groupId:entry.groupId});
  const translationsPreserved=JSON.stringify(otherLanguages(saved))===JSON.stringify(otherLanguages(raw));
  const currentCreate=await status(()=>boundCreate(ownMediaId,model.templateId,raw._id));
  const current=await status(()=>pageWrite(ownMediaId,model.templateId,raw._id));return {upload:uploaded.status,liteFiltered,denied,unchanged,updates,creates,boundUnchanged,currentUpdate,translationsPreserved,currentCreate,current};
 },{ownMediaId:process.env.STOREFRONT_E2E_OWN_MEDIA,foreignSiteMedia:process.env.STOREFRONT_E2E_FOREIGN_MEDIA});
 expect(result).toEqual({upload:200,liteFiltered:true,denied:[403,403,403,403],unchanged:true,updates:[403,403],creates:[403,403],boundUnchanged:true,currentUpdate:200,translationsPreserved:true,currentCreate:200,current:200});
});

test('a real viewer cannot create or update generic Entry content',async({browser})=>{
 const context=await browser.newContext({locale:'zh-CN',baseURL:process.env.STOREFRONT_E2E_CMS});
 try{
  const page=await context.newPage();await page.goto(process.env.STOREFRONT_E2E_CMS);
  await page.evaluate(async selection=>window.bcms.sdk.storage.set('selection',selection),{workspaceId:process.env.STOREFRONT_E2E_WORKSPACE_ID,siteId:process.env.STOREFRONT_E2E_SITE_ID});
  expect(await page.evaluate(async credentials=>{try{await window.bcms.sdk.auth.login(credentials);return true;}catch{return false;}},{email:process.env.STOREFRONT_E2E_VIEWER_EMAIL,password:process.env.STOREFRONT_E2E_VIEWER_PASSWORD})).toBe(true);
  const selected=page.waitForURL('**/d/studio',{waitUntil:'domcontentloaded'});await page.evaluate(async selection=>window.bcms.sdk.selectContext(selection,'/d/studio'),{workspaceId:process.env.STOREFRONT_E2E_WORKSPACE_ID,siteId:process.env.STOREFRONT_E2E_SITE_ID});await selected;
  const id=await identity(page);await page.goto('/d/studio?'+new URLSearchParams({section:'content',...id}));await expect(workspace(page)).toHaveCount(1);await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
  const result=await page.evaluate(async id=>{const sdk=window.bcms.sdk;const raw=await sdk.entry.get({templateId:id.templateId,entryId:id.entryId,skipCache:true});const status=async fn=>{try{await fn();return 200;}catch(e){return e.response?.status||e.status||0;}};return Promise.all([status(()=>sdk.entry.update({_id:raw._id,templateId:raw.templateId,expectedUpdatedAt:raw.updatedAt,lng:id.language,meta:raw.meta.find(m=>m.lng===id.language),content:raw.content.find(c=>c.lng===id.language)})),status(()=>sdk.entry.create({templateId:raw.templateId,data:{statuses:[],meta:raw.meta,content:raw.content}}))]);},id);
  expect(result).toEqual([403,403]);
 }finally{await context.close().catch(()=>{});}
});
