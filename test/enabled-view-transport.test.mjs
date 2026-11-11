import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// The bridge now loads the real Cloud protocol, whose TypeScript requires the normal tsx loader.
const {createLocalAgentDevHandler}=await import('../scripts/local-agent-dev-bridge.ts');

test('authenticated DEV bridge forwards profile GET/conditional POST using existing device headers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'alpha-view-transport-')),tokenFile=join(dir,'token');
 const root='a'.repeat(64),owner='profile-owner',token='synthetic-owner-session';
 await writeFile(tokenFile,root,{mode:0o600});const calls=[];
 const request=async(url,options={})=>{
  const path=new URL(url).pathname;const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  if(path==='/api/auth/status')return response({authenticated:true,instanceId:'fixture-instance'});
  if(path==='/api/auth/pair-code')return response({code:'fixture-pair-code'});
  if(path==='/api/auth/pair')return response({access:'owner',token,identityId:owner,instanceId:'fixture-instance'});
  if(path==='/api/auth/me')return response({identity:{id:owner},access:{role:'OWNER'},session:{id:token,expiresAt:Date.now()+60000}});
  assert.equal(path,'/api/client-devices/view-profile');calls.push({method:options.method,headers:options.headers,body:options.body});
  return response({version:1,profile:null,supportedViews:['notes']});
 };
 const handler=createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile,request});const server=createServer(handler);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const headers={'X-Eliza-Device-Id':'11111111-1111-4111-8111-111111111111','X-Eliza-Device-Key':'a'.repeat(64),'X-Eliza-Device-Capabilities':'calendar.local-event.v1,notes.local-record.v1,reminders.local-record.v2,reminders.create.v1,maps.selected-read.v1,clock.handoff.v1'};
  for(const method of ['GET','POST']){
   const input={path:'/api/client-devices/view-profile',method,ownerId:owner,headers,...(method==='POST'?{body:JSON.stringify({version:1,views:['notes'],expectedRevision:null})}:{})};
   const response=await fetch(origin,{method:'POST',headers:{Origin:origin,'X-Alpha-Local-Agent':'1','Content-Type':'application/json'},body:JSON.stringify(input)});
   assert.equal(response.status,200);assert.equal((await response.json()).status,200);
  }
  assert.equal(calls.length,2);
  for(const call of calls){const sent=new Headers(call.headers);assert.equal(sent.get('authorization'),`Bearer ${token}`);for(const [key,value] of Object.entries(headers))assert.equal(sent.get(key),value);}
  assert.equal(calls[0].method,'GET');assert.equal(calls[0].body,undefined);
  assert.deepEqual(JSON.parse(calls[1].body),{version:1,views:['notes'],expectedRevision:null});
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
