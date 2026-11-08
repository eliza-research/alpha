import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const {managedServiceRequest}=await import('../apps/app/src/runtime/managed-service-routes.ts');

const module=readFileSync(new URL('../apps/app/src/runtime/native-connection.ts',import.meta.url),'utf8');
const source=module.slice(module.indexOf('const mapsRequestIdentity='),module.indexOf('let browserConnection:'));
// Refusals run with route admission open (test mocks) so only the header rule can refuse them.
const browserConnection=(testMocksEnabled=false)=>{
 const sent=[];
 const sandbox={testMocksEnabled,managedServiceRequest,ownerRouteAllowed:()=>false,URL,Headers,AbortController,webDevelopmentHttp:false,allowedHeaders:new Set(['accept','content-type','authorization'])};
 vm.runInNewContext(stripTypeScriptTypes(source.replaceAll('export ',''))+';globalThis.factory=createBrowserConnection;',sandbox);
 let id=0;
 const connection=sandbox.factory({fetch:async(url,init)=>{sent.push({url,headers:init.headers});return new Response('{}',{status:200});}});
 const request=(path,method,headers)=>connection.request({requestId:`r${++id}`,url:'https://api.eliza.app'+path,method,headers,...(method==='POST'?{body:'{}'}:{})});
 return {sent,request};
};
const uuid='3f2b8c1e-9a4d-4b7e-8c21-5d6f0a1b2c3d';

test('the browser transport sends the Maps request identity on the exact Maps POST routes',async()=>{
 for(const route of ['geocode','reverse','places/search','places/details','routes']){
  const {sent,request}=browserConnection();
  assert.equal(managedServiceRequest('https://api.eliza.app/api/v1/maps/'+route,'POST',true),true,route);
  await request('/api/v1/maps/'+route,'POST',{'Content-Type':'application/json','Idempotency-Key':uuid});
  assert.equal(sent.length,1,route);
  assert.equal(sent[0].headers.get('idempotency-key'),uuid,route);
 }
});

test('the browser transport refuses the Maps request identity anywhere else',async()=>{
 const cases=[
  ['/api/v1/maps/capabilities','GET',uuid],
  ['/api/v1/maps/routes','GET',uuid],
  ['/api/v1/maps/routes/','POST',uuid],
  ['/api/v1/subscription/redeem','POST',uuid],
  ['/api/v1/maps/routes','POST','bad id'],
  ['/api/v1/maps/routes','POST',''],
  ['/api/v1/maps/routes','POST','x'.repeat(129)],
  ['/api/v1/maps/routes','POST','line\r\nbreak'],
 ];
 for(const [path,method,value] of cases){
  const {sent,request}=browserConnection(true);
  await assert.rejects(request(path,method,{'Idempotency-Key':value}),/Connection request failed/,`${method} ${path} ${JSON.stringify(value)}`);
  assert.equal(sent.length,0,`${method} ${path}`);
 }
 // The route rule admits only this one header; it does not open the global allow set.
 const {sent,request}=browserConnection();
 await assert.rejects(request('/api/v1/maps/routes','POST',{'X-Eliza-Device-Key':uuid}),/Connection request failed/);
 assert.equal(sent.length,0);
});
