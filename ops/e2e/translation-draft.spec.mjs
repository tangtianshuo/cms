import { test, expect } from './browser-fixture.mjs';

test('a first translation saves independently while preview stays strict and recovers after completion', async ({page,installation}, info) => {
 const language=info.project.name==='desktop'?'it':'pt';
 const initial=await page.evaluate(async language=>{
  const sdk=window.bcms.sdk;const state=await sdk.studio.getSite();
  if(!(await sdk.language.getAll()).some(item=>item.code===language))await sdk.language.create({code:language,name:language,nativeName:language});
  const entries=[];for(const model of state.models)for(const entry of model.entries)entries.push(await sdk.entry.get({templateId:model.templateId,entryId:entry.id,skipCache:true}));
  const model=state.models.find(model=>model.key==='content-page');return {model,entries,workspaceId:sdk.context.context.workspaceId,siteId:state.site.id,entryId:model.entries[0].id};
 },language);
 await page.goto('/d/studio?'+new URLSearchParams({section:'content',field:'title',panel:'content',modelKey:initial.model.key,templateId:initial.model.templateId,entryId:initial.entryId,workspaceId:initial.workspaceId,siteId:initial.siteId,language}));
 await expect(page.getByText(/当前内容没有此语言版本/)).toBeVisible();
 await page.getByRole('button',{name:'创建此语言版本',exact:true}).click();
 const title='B7 '+language+' '+crypto.randomUUID().slice(0,8);
 await page.locator('#studio-field-title').fill(title);
 const receipt=page.waitForResponse(response=>response.url().includes('/studio/entries/content-page')&&response.request().method()==='POST',{timeout:10000});
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 expect((await receipt).status()).toBe(200);
 await expect(page.getByText('草稿已保存',{exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('#studio-field-title')).toHaveText(title);
 await expect(page.getByText('以下内容缺少翻译，当前草稿可以保存。补齐后可查看当前语言预览。',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('translation-incomplete.png'),mask:[page.getByText(process.env.STOREFRONT_E2E_EMAIL,{exact:false})]});
 const result=await page.evaluate(async ({language,initial,foreignMedia})=>{
  const sdk=window.bcms.sdk;const state=await sdk.studio.getSite();
  const status=async fn=>{try{return {status:200,value:await fn()};}catch(error){return {status:error.status||error.response?.status||0,code:error.code};}};
  let raw=await sdk.entry.get({templateId:initial.model.templateId,entryId:initial.entryId,skipCache:true});
  const others=[];for(const model of state.models)for(const entry of model.entries)if(entry.id!==raw._id)others.push(await sdk.entry.get({templateId:model.templateId,entryId:entry.id,skipCache:true}));
  const before=initial.entries.find(entry=>entry._id===raw._id);
  const preserved=['meta','content','statuses'].every(key=>JSON.stringify(raw[key].filter(item=>item.lng!==language))===JSON.stringify(before[key].filter(item=>item.lng!==language)));
  const othersUnchanged=JSON.stringify(others)===JSON.stringify(initial.entries.filter(entry=>entry._id!==raw._id));
  const preview=await status(()=>sdk.studio.preview({sessionId:'translation',revision:1,language,overlay:{}}));
  const missing=JSON.parse(preview.code.slice('studio-validation:'.length));
  const entry={groupId:raw.groupId,meta:raw.meta,content:raw.content,statuses:raw.statuses};
  const save=()=>sdk.studio.saveEntry(initial.model.key,{entryId:raw._id,expectedUpdatedAt:raw.updatedAt,operationId:crypto.randomUUID(),language,entry});
  const setLink=href=>{entry.content=entry.content.filter(item=>item.lng!==language);entry.content.push({lng:language,plainText:'Link',nodes:[{type:'paragraph',content:[{type:'text',text:'Link',marks:[{type:'link',attrs:{href,target:'_self'}}]}]}]});};
  const home=state.site.pages.find(page=>page.layout==='home');const layoutDocument=structuredClone(home.layoutDocument);layoutDocument.root.find(node=>node.type==='hero').props.buttonHref='/missing-translation-section';
  const invalidLayout=await status(()=>sdk.studio.saveEntry(initial.model.key,{entryId:raw._id,expectedUpdatedAt:raw.updatedAt,operationId:crypto.randomUUID(),language,entry,overlay:{page:{key:home.key,title:home.title,path:home.path,seoTitle:home.seoTitle,seoDescription:home.seoDescription,sections:home.sections,layoutDocument,entryId:home.entryId,enabled:true,navigation:true}}}));
  const layoutUnchanged=(await sdk.studio.getSite()).site.updatedAt===state.site.updatedAt;
  setLink('/');const valid=await status(save);raw=await sdk.entry.get({templateId:raw.templateId,entryId:raw._id,skipCache:true});
  setLink('/missing-translation-route');const invalid=await status(save);
  setLink(`media:${foreignMedia}@*_@*_:media`);const foreign=await status(save);
  const afterInvalid=await sdk.entry.get({templateId:raw.templateId,entryId:raw._id,skipCache:true});
  // Fixture authors each missing translation explicitly; product code never copies another language.
  for(const model of [...state.models].sort((a,b)=>(a.key==='product'?-1:0)-(b.key==='product'?-1:0))) {
   const template=await sdk.template.get({templateId:model.templateId});
   for(const candidate of model.entries){
    const current=await sdk.entry.get({templateId:model.templateId,entryId:candidate.id,skipCache:true});if(current.meta.some(meta=>meta.lng===language))continue;
    const meta=structuredClone(current.meta[0]);meta.lng=language;
    for(const prop of meta.props){const definition=template.props.find(item=>item.id===prop.id);if(definition?.name==='title')prop.data=[`B7 ${language} ${crypto.randomUUID()}`];if(definition?.name==='slug')prop.data=[`b7-${language}-${crypto.randomUUID()}`];if(definition?.type==='RICH_TEXT')prop.data=prop.data.map(()=>({nodes:[]}));}
    await sdk.studio.saveEntry(model.key,{entryId:current._id,expectedUpdatedAt:current.updatedAt,operationId:crypto.randomUUID(),language,entry:{groupId:current.groupId,meta:[meta],content:[{lng:language,nodes:[],plainText:''}],statuses:[]}});
   }
  }
  const recovered=await status(()=>sdk.studio.preview({sessionId:'translation',revision:2,language,overlay:{}}));
  return {preserved,othersUnchanged,preview:preview.status,saveAllowed:missing.saveAllowed,missingModels:missing.missingTranslations.map(issue=>issue.modelKey),invalidLayout:invalidLayout.status,layoutUnchanged,valid:valid.status,invalid:invalid.status,foreign:foreign.status,unchanged:JSON.stringify(raw)===JSON.stringify(afterInvalid),recovered:recovered.status};
 },{language,initial,foreignMedia:process.env.STOREFRONT_E2E_FOREIGN_MEDIA});
 expect(result).toMatchObject({preserved:true,othersUnchanged:true,preview:400,saveAllowed:true,invalidLayout:400,layoutUnchanged:true,valid:200,invalid:400,foreign:403,unchanged:true,recovered:200});
 expect(result.missingModels).toContain('home');expect(result.missingModels).toContain('site-settings');
 await page.reload();await expect(page.getByText('以下内容缺少翻译，当前草稿可以保存。补齐后可查看当前语言预览。',{exact:true})).toHaveCount(0);
 if(info.project.name==='mobile')await page.getByRole('tab',{name:'查看画布',exact:true}).click();
 await expect(page.frameLocator('.studio-visual-preview iframe').locator('[data-section-type]').first()).toBeVisible();
 await page.locator('.studio-visual-preview iframe').screenshot({path:info.outputPath('translation-recovered.png')});
});
