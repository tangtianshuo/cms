import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
test('published link uses the selected domain and avoids a shared origin for unbound sites',async()=>{
 const server=await createServer({root:new URL('..',import.meta.url).pathname,server:{middlewareMode:true,hmr:false},appType:'custom'});
 try {
  const {publishedSiteUrl}=await server.ssrLoadModule('/src/components/storefront/published-site-url.ts');
  assert.equal(publishedSiteUrl({bound:false,siteUrl:'https://other-site.test',publicHostname:'shop.example.test',defaultHost:'builtin.localhost'},'http://127.0.0.1:13001'),'https://shop.example.test/');
  assert.equal(publishedSiteUrl({bound:false,siteUrl:'https://other-site.test'},'http://127.0.0.1:13001'),'');
  assert.equal(publishedSiteUrl({bound:false,siteUrl:'',publicHostname:'builtin.localhost',defaultHost:'builtin.localhost'},'http://127.0.0.1:13001'),'http://127.0.0.1:13001/');
  assert.equal(publishedSiteUrl({bound:true,siteUrl:'https://gateway-site.test'},'http://127.0.0.1:13001'),'https://gateway-site.test/');
 }finally{await server.close();}
});
