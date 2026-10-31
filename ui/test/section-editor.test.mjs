import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createRenderer, nextTick, ssrContextKey, ref, h } from 'vue';
const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer({
 createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
 setText: (target, text) => { target.text = text; }, setElementText: (target, text) => { target.text = text; target.children = []; }, patchProp: (target, key, _old, value) => { target.props[key] = value; },
 insert(target, parent, anchor) { if(target.parent) target.parent.children.splice(target.parent.children.indexOf(target),1); target.parent=parent; const at=parent.children.indexOf(anchor); parent.children.splice(at<0?parent.children.length:at,0,target); },
 remove(target) { if(target.parent) target.parent.children.splice(target.parent.children.indexOf(target),1); }, parentNode: target=>target.parent, nextSibling: target=>target.parent?.children[target.parent.children.indexOf(target)+1]||null,
});
const all=root=>[root,...root.children.flatMap(all)];
const textOf=root=>`${root.text}${root.children.map(textOf).join('')}`;
const button=(root,label)=>all(root).find(n=>n.type==='button'&&(n.props['aria-label']===label||textOf(n)===label));
let server;
test.before(async()=>{server=await createServer({root:new URL('..',import.meta.url).pathname,server:{middlewareMode:true,hmr:false},appType:'custom'});});
test.after(async()=>{await server.close();});
async function mount(initial,extra={}){
 const {SectionEditor}=await server.ssrLoadModule('/src/components/studio/section-editor.tsx');
 const state=ref(initial), root=node('root');
 const app=renderer.createApp({setup:()=>()=>h(SectionEditor,{modelValue:state.value,allowed:['hero-carousel','info-grid','faq'],...extra,'onUpdate:modelValue':v=>state.value=v})});
 app.provide(ssrContextKey,{modules:new Set()});app.mount(root);await nextTick();return{state,root,app};
}
test('controlled reactive parent supports consecutive add, toggle and reorder events',async()=>{
 const {root,state,app}=await mount([{type:'hero-carousel',enabled:false,data:{slides:[]}}]);
 button(root,'添加信息卡片').props.onClick();await nextTick();
 const checkbox=all(root).find(n=>n.type==='input'&&n.props.type==='checkbox');
 checkbox.props.onChange({target:{checked:true}});await nextTick();
 button(root,'添加常见问题').props.onClick();await nextTick();
 button(root,'上移 常见问题').props.onClick();await nextTick();
 assert.deepEqual(state.value.map(s=>s.type),['hero-carousel','faq','info-grid']);
 assert.equal(state.value[0].enabled,true);app.unmount();
});
test('carousel edits real media refs and copy, normalizes order, and keeps required section',async()=>{
 const {root,state,app}=await mount([{type:'hero-carousel',enabled:true,data:{slides:[]}}],{media:[{_id:'image-a',name:'Banner',mimetype:'image/png'}],required:['hero-carousel']});
 button(root,'添加轮播图片').props.onClick();await nextTick();
 const image=all(root).find(n=>n.type==='select'&&n.props['aria-label']==='轮播 1 图片');assert.ok(image,'image picker is available');
 image.props.onChange({target:{value:'image-a'}});await nextTick();
 all(root).find(n=>n.props['aria-label']==='轮播 1 标题').props.onInput({target:{value:'新产品'}});await nextTick();
 button(root,'添加轮播图片').props.onClick();await nextTick();
 button(root,'上移 轮播 2').props.onClick();await nextTick();
 assert.deepEqual(state.value[0].data.slides.map(s=>s.order),[0,1]);
 assert.equal(state.value[0].data.slides[1].image._id,'image-a');
 assert.equal(state.value[0].data.slides[1].title,'新产品');
 assert.equal(button(root,'移除 首页轮播').props.disabled,true);app.unmount();
});
test('FAQ and information cards have editable content',async()=>{
 const {root,state,app}=await mount([{type:'faq',enabled:true,data:{items:[]}},{type:'info-grid',enabled:true,data:{items:[]}}]);
 button(root,'添加问答').props.onClick();await nextTick();
 all(root).find(n=>n.props['aria-label']==='问题 1').props.onInput({target:{value:'如何发货？'}});await nextTick();
 all(root).find(n=>n.props['aria-label']==='回答 1').props.onInput({target:{value:'三个工作日内。'}});await nextTick();
 button(root,'添加信息卡片内容').props.onClick();await nextTick();
 all(root).find(n=>n.props['aria-label']==='卡片 1 标题').props.onInput({target:{value:'安心售后'}});await nextTick();
 assert.equal(state.value[0].data.items[0].answer,'三个工作日内。');assert.equal(state.value[1].data.items[0].title,'安心售后');app.unmount();
});
test('settings request keeps operations outside the strict theme contract',async()=>{
 const {settingsRequest}=await server.ssrLoadModule('/src/components/studio/settings-request.ts');
 const {StudioHandler}=await server.ssrLoadModule('/src/sdk/handlers/studio.ts');
 const calls=[];const handler=new StudioHandler({send:request=>{calls.push(request);return Promise.resolve(request.data);}});
 await handler.saveSettings(settingsRequest(123,{name:'Store',background:'#ffffff',foreground:'#111111',accent:'#222222',muted:'#eeeeee',navigation:[],operations:{seoTitle:'Search',seoDescription:'Description',contactFormEnabled:false}}));
 assert.deepEqual(Object.keys(calls[0].data.theme).sort(),['accent','background','foreground','muted']);
 assert.equal(calls[0].data.operations.seoTitle,'Search');assert.equal(calls[0].data.expectedUpdatedAt,123);
});

test('empty carousel image prompt selects the first slide and clearing a CTA removes it',async()=>{
 const {root,state,app}=await mount([{type:'hero-carousel',enabled:true,data:{slides:[]}}],{media:[{_id:'image-a',name:'Banner',mimetype:'image/png'}]});
 all(root).find(n=>n.props['aria-label']==='轮播图片').props.onChange({target:{value:'image-a'}});await nextTick();
 assert.equal(state.value[0].data.slides[0]?.image._id,'image-a');
 const cta=()=>all(root).find(n=>n.props['aria-label']==='轮播 1 按钮文字');
 cta().props.onInput({target:{value:'查看'}});await nextTick();
 assert.equal(all(root).find(n=>n.props['aria-label']==='轮播 1 跳转地址').props.required,true);
 cta().props.onInput({target:{value:''}});await nextTick();
 assert.equal(state.value[0].data.slides[0].cta,undefined);app.unmount();
});

test('site image choices exclude legacy unbound and other-site media',async()=>{
 const {siteImageOptions}=await server.ssrLoadModule('/src/components/studio/media-options.ts');
 const media=[{_id:'own',siteId:'a',mimetype:'image/png'},{_id:'legacy',mimetype:'image/png'},{_id:'foreign',siteId:'b',mimetype:'image/png'},{_id:'document',siteId:'a',mimetype:'application/pdf'}];
 assert.deepEqual(siteImageOptions(media,'a').map(m=>m._id),['own']);
 assert.deepEqual(siteImageOptions(media,undefined),[]);
});
