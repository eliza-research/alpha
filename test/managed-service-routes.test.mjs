import test from 'node:test';
import assert from 'node:assert/strict';
const {managedServiceRequest:allowed,mapsRequestIdentity}=await import('../apps/app/src/runtime/managed-service-routes.ts');
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
 // The Cloud sign-in hand-off is not a product route (product sign-in is the native in-app host).
 assert.equal(allowed('https://api.eliza.app/api/auth/cli-session','POST',true),false);
 assert.equal(allowed('https://api.eliza.app/api/auth/cli-session','POST',false),false);
 assert.equal(allowed('https://api.eliza.app/api/auth/cli-session/b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d','GET'),false);
 const sync='https://api.eliza.app/api/v1/eliza/google/calendar/sync-v1/event';
 for(const method of ['POST','PATCH']){assert.equal(allowed(sync,method,true),true);assert.equal(allowed(sync,method,false),false);assert.equal(allowed(sync+'?grantId=owned',method,true),false);}
 for(const method of ['GET','DELETE']){assert.equal(allowed(sync+'?grantId=owned',method,false),true);assert.equal(allowed(sync,method,false),false);assert.equal(allowed(sync+'?grantId=owned',method,true),false);}
 assert.equal(allowed(sync+'/', 'PATCH',true),false);
 assert.equal(allowed(sync, 'PUT',true),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/api-keys/current','DELETE'),true);
 assert.equal(allowed('https://api.eliza.app/api/v1/api-keys/current?other=owner','DELETE'),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/eliza/google/gmail/inbox-v1/operations/owner-request/dispatch','POST',true),true);
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

test('Cloud tile admission accepts only in-grid body-free reads and scoped request identities',()=>{
 const base='https://api.eliza.app',path='/api/v1/maps/tiles/2/1/3';
 assert.equal(allowed(base+path,'GET'),true);
 assert.equal(mapsRequestIdentity('Idempotency-Key','owned_1',path,'GET'),true);
 for(const bad of ['/api/v1/maps/tiles/23/0/0','/api/v1/maps/tiles/2/4/0','/api/v1/maps/tiles/02/1/1',path+'/',path+'?key=x'])assert.equal(allowed(base+bad,'GET'),false,bad);
 for(const [method,body] of [['POST',true],['GET',true],['DELETE',false]])assert.equal(allowed(base+path,method,body),false);
 assert.equal(mapsRequestIdentity('Idempotency-Key','owned_1','/api/v1/user','GET'),false);
 assert.equal(mapsRequestIdentity('Authorization','owned_1',path,'GET'),false);
 assert.equal(allowed(base+'/api/v1/maps/tiles/viewport','POST',true),true);
});
