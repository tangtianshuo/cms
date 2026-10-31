import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../storefront/package.json',import.meta.url));
const {h,createSSRApp}=require('vue');
const {renderToString}=require('@vue/server-renderer');

test('desktop and mobile navigation groups have native keyboard-operable disclosure controls',async()=>{
 const server=await createServer({configFile:false,root:new URL('../../storefront',import.meta.url).pathname,plugins:[vue()],server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {default:NavigationMenu}=await server.ssrLoadModule('/app/components/NavigationMenu.vue');
  for(const mobile of [false,true]){
   const app=createSSRApp({render:()=>h(NavigationMenu,{nodes:[{label:'客户服务',children:[{label:'配送说明',href:'/delivery'}]}],mobile})});app.component('NavigationMenu',NavigationMenu);
   const html=await renderToString(app);
   assert.match(html,/<details[^>]*>/,'groups expose native disclosure for keyboard and touch');assert.match(html,/<summary>客户服务<\/summary>/);assert.match(html,/href="\/delivery"/);
  }
 }finally{await server.close();}
});
