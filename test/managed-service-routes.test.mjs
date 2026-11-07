import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const {managedServiceRequest:allowed}=await import('../apps/app/src/runtime/managed-service-routes.ts');
test('managed service admission preserves owned service APIs and refuses agent hosts, paths and mutation variants',()=>{
 for(const path of ['/api/v1/user','/api/v1/billing/limits','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys','/api/v1/eliza/google/accounts?side=owner','/api/v1/eliza/google/gmail/inbox-v1/thread?grantId=owner'])assert.equal(allowed('https://api.eliza.app'+path,'GET'),true,path);
 for(const url of ['https://agent.cloud.eliza.app/api/v1/user','https://api.eliza.app.evil.test/api/v1/user','https://api.eliza.app:444/api/v1/user','http://api.eliza.app/api/v1/user','https://owner@api.eliza.app/api/v1/user','https://api.eliza.app/api/v1/user#x'])assert.equal(allowed(url,'GET'),false,url);
 for(const path of ['/api/auth/pair','/api/agents','/api/conversations','/api/v1/eliza/agents','/api/v1/eliza/personal','/api/v1/eliza/agents/id/api/conversations','/api/v1/%65liza/google/status','/api/v1/eliza/google/status/'])for(const method of ['GET','POST'])assert.equal(allowed('https://api.eliza.app'+path,method),false,path);
 assert.equal(allowed('https://api.eliza.app/api/v1/user','POST',true),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/user','GET',true),false);
 // Subscription entitlement (P-26) is read-only: no write, body or neighbouring path is admitted.
 for(const [path,method,body] of [['/api/v1/subscription/entitlement','POST',true],['/api/v1/subscription/entitlement','GET',true],['/api/v1/subscription','GET',false],['/api/v1/subscription/entitlement/','GET',false],['/api/v1/subscription/checkout','GET',false]])assert.equal(allowed('https://api.eliza.app'+path,method,body),false,path);
 // Subscription code redemption (#410): exactly one POST route with a JSON body; nothing else under it.
 assert.equal(allowed('https://api.eliza.app/api/v1/subscription/redeem','POST',true),true);
 for(const [url,method,body] of [['https://api.eliza.app/api/v1/subscription/redeem','POST',false],['https://api.eliza.app/api/v1/subscription/redeem','GET',false],['https://api.eliza.app/api/v1/subscription/redeem?code=x','POST',true],['https://api.eliza.app/api/v1/subscription/redeem/','POST',true],['https://api.eliza.app/api/v1/subscription/redeem','DELETE',false],['https://api-staging.eliza.app/api/v1/subscription/redeem','POST',true],['https://api.eliza.app/api/v1/billing/limits','POST',true],['https://api.eliza.app/api/v1/billing/limits?x=1','POST',true]])assert.equal(allowed(url,method,body),false,`${method} ${url}`);
 // The credit balance check is retired with the subscription plan gate.
 assert.equal(allowed('https://api.eliza.app/api/v1/credits/balance','GET'),false);
 const sync='https://api.eliza.app/api/v1/eliza/google/calendar/sync-v1/event';
 for(const method of ['POST','PATCH']){assert.equal(allowed(sync,method,true),true);assert.equal(allowed(sync,method,false),false);assert.equal(allowed(sync+'?grantId=owned',method,true),false);}
 for(const method of ['GET','DELETE']){assert.equal(allowed(sync+'?grantId=owned',method,false),true);assert.equal(allowed(sync,method,false),false);assert.equal(allowed(sync+'?grantId=owned',method,true),false);}
 assert.equal(allowed(sync+'/', 'PATCH',true),false);
 assert.equal(allowed(sync, 'PUT',true),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/api-keys/current','DELETE'),true);
 assert.equal(allowed('https://api.eliza.app/api/v1/api-keys/current?other=owner','DELETE'),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/eliza/google/gmail/inbox-v1/operations/owner-request/dispatch','POST',true),true);
});

test('compiled test-mocks transports retain development hosts while flag-off transports reject them before dispatch',async()=>{
 const {default:vm}=await import('node:vm');
 const module=readFileSync(new URL('../apps/app/src/runtime/native-connection.ts',import.meta.url),'utf8');
 const factory=module.slice(module.indexOf('export function createBrowserConnection('),module.indexOf('let browserConnection:'));
 const transport=module.slice(module.indexOf('export const nativeCloudRequest:'),module.indexOf('export const nativeRemoteRequest:'));
 for(const testMocksEnabled of [false,true]){
  const calls=[];
  const sandbox={testMocksEnabled,devSurfacesEnabled:false,managedServiceRequest:allowed,browserCloudManagedServiceAllowed:allowed,URL,Headers,AbortController,DOMException,setTimeout,clearTimeout,crypto:globalThis.crypto,webDevelopmentHttp:false,allowedHeaders:new Set(['accept','content-type','authorization']),native:{request:async input=>{calls.push(input.url);return {status:200,data:{}};},cancel:async()=>{}}};
  vm.runInNewContext(stripTypeScriptTypes((factory+transport).replaceAll('export ',''))+';globalThis.factory=createBrowserConnection;globalThis.request=nativeCloudRequest;',sandbox);
  const url='https://agent.example.test/api/agents';
  const native=sandbox.request({url,method:'GET',headers:{},signal:new AbortController().signal,timeoutMs:1000});
  if(testMocksEnabled)await native;else await assert.rejects(native,/managed Cloud services/);
  const browser=sandbox.factory({fetch:async input=>{calls.push(input);return new Response('{}',{status:200});}}).request({requestId:'fixture',url,method:'GET',headers:{}});
  if(testMocksEnabled)await browser;else await assert.rejects(browser,/managed Cloud services/);
  assert.equal(calls.length,testMocksEnabled?2:0);
 }
});


test('Google Calendar admission is confined to body-free reads of the reviewed service routes',()=>{
 for(const path of ['/api/v1/eliza/google/calendar/calendars','/api/v1/eliza/google/calendar/feed']){
  const url='https://api.eliza.app'+path;
  assert.equal(allowed(url+'?grantId=owned','GET'),true);
  assert.equal(allowed(url,'GET',true),false);
  for(const method of ['POST','DELETE','PUT','PATCH'])assert.equal(allowed(url,method,true),false);
  assert.equal(allowed(url+'/','GET'),false);
  assert.equal(allowed(url.replace('api.eliza.app','agent.cloud.eliza.app'),'GET'),false);
 }
 assert.equal(allowed('https://api.eliza.app/api/v1/eliza/google/calendar/events','GET'),false);
});

test('Google Calendar writes admit exactly create, change and delete of one event',()=>{
 const events='https://api.eliza.app/api/v1/eliza/google/calendar/events',one=events+'/abc123_20261013T150000Z';
 assert.equal(allowed(events,'POST',true),true);
 assert.equal(allowed(one,'PATCH',true),true);
 assert.equal(allowed(one+'?side=owner&grantId=g&calendarId=primary','DELETE',false),true);
 for(const [url,method,body] of [
  [events,'POST',false],[events+'?side=owner','POST',true],[events+'/','POST',true],[events,'GET',false],[events,'PATCH',true],[events,'DELETE',false],[events,'PUT',true],
  [one,'PATCH',false],[one+'?side=owner','PATCH',true],[one,'DELETE',false],[one+'?side=owner','DELETE',true],[one,'PUT',true],[one+'?side=owner','GET',false],[one,'POST',true],
  [one+'/','PATCH',true],[one+'/instances','PATCH',true],[events+'/a%2Fb','PATCH',true],[events+'/a-b','PATCH',true],[events+'/'+'a'.repeat(1025),'PATCH',true],
  [one.replace('api.eliza.app','agent.cloud.eliza.app'),'PATCH',true],[one.replace('api.eliza.app','api-staging.eliza.app'),'PATCH',true],
 ])assert.equal(allowed(url,method,body),false,`${method} ${url} body=${body}`);
});

test('Eliza Cloud Maps admission is the exact reviewed routes with location data only in a POST body',()=>{
 const base='https://api.eliza.app/api/v1/maps/';
 assert.equal(allowed(base+'capabilities','GET'),true);
 for(const [url,method,body] of [[base+'capabilities?region=x','GET',false],[base+'capabilities','GET',true],[base+'capabilities','POST',true],[base+'capabilities/','GET',false]])assert.equal(allowed(url,method,body),false,`${method} ${url}`);
 for(const route of ['geocode','reverse','places/search','places/details','routes']){
  assert.equal(allowed(base+route,'POST',true),true,route);
  for(const [url,method,body] of [[base+route,'POST',false],[base+route+'?lat=1','POST',true],[base+route+'?q=x','GET',false],[base+route,'GET',false],[base+route+'/','POST',true],[base.replace('api.eliza.app','api-staging.eliza.app')+route,'POST',true],[base.replace('api.eliza.app','agent.cloud.eliza.app')+route,'POST',true]])assert.equal(allowed(url,method,body),false,`${method} ${url}`);
 }
 for(const path of ['/api/v1/maps','/api/v1/maps/tiles/1/2/3','/api/v1/maps/places','/api/v1/maps/navigation','/api/v1/maps/%72outes','/api/v1/maps//routes'])for(const method of ['GET','POST'])assert.equal(allowed('https://api.eliza.app'+path,method,method==='POST'),false,path);
});
