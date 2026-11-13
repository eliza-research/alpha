// The phone's Google host enforces the owner's Settings switches from the file AlphaLocalAgentPlugin writes,
// read before every agent write, and fails closed. Synthetic Cloud transport only; the file writer runs on the
// host JVM, not Android, so this is not device or Settings evidence.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {nativeSource,fixture,runJvm}=await import('./fixtures/jvm-tools.mjs');
const {startNativeGoogleAgentHost,savedGoogleAgentAccess}=await import('./support/managed-google-agent.mjs');
const {createNativeGoogleCloudPort}=await import('./support/managed-google-agent.mjs');
const user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',grant='33333333-3333-4333-8333-333333333333';
const binding={credentialId:'44444444-4444-4444-8444-444444444444',userId:user,organizationId:org,accountRef:JSON.stringify(['cloud','production',user,org]),sessionGeneration:'native-generation-1',token:'synthetic-native-cloud-key'};
const credential=await createNativeGoogleCloudPort(binding,()=>{}).agentCredential();
const scope=createHash('sha256').update(JSON.stringify(credential)+':'+grant).digest('hex');
const apiToken='Z_-q'.repeat(16);
const content={to:['self@example.invalid'],subject:'Native QA',bodyText:'Synthetic only'};
const writes={
 mailbox:()=>({mailbox:{kind:'archive',messageId:`alpha-gmail:${scope}:message-1`,requestId:randomUUID()}}),
 prepareSend:()=>({send:{operation:'prepare',requestId:randomUUID(),...content}}),
 dispatchSend:()=>({send:{operation:'dispatch',id:`alpha-gmail-send:${scope}:${randomUUID()}`,reviewDigest:'a'.repeat(64),...content}}),
 calendarWrite:()=>({calendar:{operation:'write-capabilities',grantId:`alpha-google:${scope}`,calendarId:'primary'}}),
};
const javaWrite=(dir,gmail,calendar)=>runJvm([nativeSource('GoogleAgentAccessFile.java'),fixture('GoogleAgentAccessFileTest.java')],'ai.alphacompute.alphaphone.GoogleAgentAccessFileTest',{args:[dir,String(gmail),String(calendar)]});
async function hostWith(file){
 const calls=[];
 const request=async url=>{
  const u=new URL(url);calls.push(u.pathname);
  if(u.pathname==='/api/v1/user')return Response.json({success:true,data:{id:user,organization_id:org}});
  if(u.pathname.endsWith('/accounts'))return Response.json([{configured:true,connected:true,reason:'connected',connectionId:grant,identity:{email:'owned@example.invalid'},grantedCapabilities:['google.gmail.triage','google.gmail.mailbox','google.gmail.send','google.calendar.write']}]);
  throw Error('Synthetic transport stops here');
 };
 if(file===undefined)delete process.env.ALPHA_GOOGLE_AGENT_ACCESS_FILE;else process.env.ALPHA_GOOGLE_AGENT_ACCESS_FILE=file;
 const host=await startNativeGoogleAgentHost({binding,apiToken,request});
 // JVM fixture writes block this Node event loop; give each consent check a fresh socket.
 const call=async body=>{const response=await fetch('http://127.0.0.1:'+host.port+'/__alpha-owner-gmail',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close',Authorization:'Bearer '+apiToken},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 return {calls,call,close:()=>host.close()};
}
async function assertRefused(host,label){
 for(const [name,body] of Object.entries(writes)){
  const before=host.calls.length,result=await host.call(body());
  assert.equal(result.status,409,`${label}: ${name} is refused`);
  assert.equal(result.data.reason,'changes-off',`${label}: ${name} is refused by the owner switch`);
  assert.equal(host.calls.length,before,`${label}: a refused ${name} never reaches Cloud or Google`);
 }
}
async function assertAllowed(host,label){
 const operationPath={mailbox:/\/gmail\/inbox-v1\/operations\/[a-f0-9-]+$/,prepareSend:/\/gmail\/inbox-v1\/operations$/,dispatchSend:/\/gmail\/inbox-v1\/operations\/[a-f0-9-]+$/,calendarWrite:/\/calendar\/sync-v1\/capabilities$/};
 for(const [name,body] of Object.entries(writes)){
  const before=host.calls.length,result=await host.call(body());
  assert.notEqual(result.data.reason,'changes-off');
  assert.ok(host.calls.slice(before).some(path=>operationPath[name].test(path)),`${label}: ${name} reaches its Cloud operation path`);
 }
}

test('the saved switches are off unless the file holds version 1 booleans',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-google-access-'));
 try{
  const file=join(dir,'access.json'),off={gmailChanges:false,calendarEdits:false};
  assert.deepEqual(savedGoogleAgentAccess(undefined),off,'no file configured');
  assert.deepEqual(savedGoogleAgentAccess(file),off,'missing file');
  for(const raw of ['not-json','null','[]','{"gmailChanges":true,"calendarEdits":true}','{"version":2,"gmailChanges":true,"calendarEdits":true}','{"version":1,"gmailChanges":"true","calendarEdits":true}','{"version":1,"gmailChanges":true}']){
   writeFileSync(file,raw);assert.deepEqual(savedGoogleAgentAccess(file),off,raw);
  }
  writeFileSync(file,'{"version":1,"gmailChanges":true,"calendarEdits":false}');
  assert.deepEqual(savedGoogleAgentAccess(file),{gmailChanges:true,calendarEdits:false});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('linked and nonregular access files are refused without a blocking read',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-google-access-types-'));
 try{
  const off={gmailChanges:false,calendarEdits:false},enabled='{"version":1,"gmailChanges":true,"calendarEdits":true}';
  const parent=join(dir,'real'),real=join(parent,'access.json');
  mkdirSync(parent);writeFileSync(real,enabled);
  const leaf=join(dir,'linked.json'),linkedParent=join(dir,'linked-parent'),directory=join(dir,'directory');
  symlinkSync(real,leaf);symlinkSync(parent,linkedParent);mkdirSync(directory);
  assert.deepEqual(savedGoogleAgentAccess(leaf),off);
  assert.deepEqual(savedGoogleAgentAccess(join(linkedParent,'access.json')),off);
  assert.deepEqual(savedGoogleAgentAccess(directory),off);
  assert.deepEqual(savedGoogleAgentAccess(real),{gmailChanges:true,calendarEdits:true});
  const absent=join(dir,'absent.json');
  for(const suffix of ['.tmp','.bak'])writeFileSync(absent+suffix,enabled);
  assert.deepEqual(savedGoogleAgentAccess(absent),off,'only the canonical record can admit access');
  const pipe=join(dir,'pipe');execFileSync('mkfifo',[pipe]);
  const read=spawnSync(process.execPath,['-e',
   'import {savedGoogleAgentAccess} from "./test/support/managed-google-agent.mjs"; console.log(JSON.stringify(savedGoogleAgentAccess()));'],
   {env:{...process.env,ALPHA_GOOGLE_AGENT_ACCESS_FILE:pipe},encoding:'utf8',timeout:scaledTimeout(10000)});
  assert.ifError(read.error);
  assert.equal(read.status,0,read.stderr);
  assert.deepEqual(JSON.parse(read.stdout),off);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the native host refuses every agent write when the switches are off, missing or corrupt, and reads still work',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-google-access-'));
 try{
  assert.match(javaWrite(dir,false,false),/^PASS google access file /);
  const file=join(dir,'.eliza','alpha-google-agent-access.json');
  for(const [label,path,setup] of [['switches off',file],['no file configured',undefined],['missing file',join(dir,'absent.json')],['corrupt file',join(dir,'corrupt.json'),()=>writeFileSync(join(dir,'corrupt.json'),'{"version":1,"gmailChanges":true')]]){
   setup?.();const host=await hostWith(path);
   try{
    await assertRefused(host,label);
    assert.equal((await host.call({limit:1})).status,409);assert.deepEqual(host.calls.slice(0,1),['/api/v1/user'],`${label}: reads still go to Cloud`);
   }finally{await host.close();}
  }
 }finally{rmSync(dir,{recursive:true,force:true});delete process.env.ALPHA_GOOGLE_AGENT_ACCESS_FILE;}
});

test('a switch change applies to the next write without restarting the host',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-google-access-'));
 try{
  javaWrite(dir,true,true);
  const host=await hostWith(join(dir,'.eliza','alpha-google-agent-access.json'));
  try{
   await assertAllowed(host,'switches on');
   javaWrite(dir,false,false);await assertRefused(host,'switched off');
   javaWrite(dir,true,false);
   let before=host.calls.length;await host.call(writes.prepareSend());assert.ok(host.calls.length>before,'Gmail changes on');
   before=host.calls.length;assert.equal((await host.call(writes.calendarWrite())).status,409);assert.equal(host.calls.length,before,'Calendar edits stay off');
  }finally{await host.close();}
 }finally{rmSync(dir,{recursive:true,force:true});delete process.env.ALPHA_GOOGLE_AGENT_ACCESS_FILE;}
});
