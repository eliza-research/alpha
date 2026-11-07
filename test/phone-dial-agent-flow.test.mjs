// Reviewed phone.dial.v1 handoff through Alpha's device-action client (AP-08). Recording request,
// journal and executor stubs: no device, Telecom or call is involved, and a handed-off result proves
// only that the dial screen opened.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'phone-dial-flow-'));
const output=await build({entryPoints:[resolve('apps/app/src/runtime/device-actions.ts')],bundle:true,format:'esm',platform:'node',write:false});writeFileSync(join(dir,'sdk.mjs'),output.outputFiles[0].text);const {DeviceActions}=await import(pathToFileURL(join(dir,'sdk.mjs')));process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const context={view:'home',revision:1,sensitive:false},session={ownerId:'owner',agentId:'agent',origin:'https://agent.example',sessionId:'session'},id='5d1f0d2a-7f0e-4c8a-9a51-0e6c1c1f9b20',digest='d'.repeat(64);
const numberDial={type:'phone_dial',target:{kind:'number',number:'+15555550100'}};
function fixture({capabilities=['phone.dial.v1'],operation=numberDial,handoff='handed-off',receiptOutage=false,evidence=true}={}){let state='pending',attemptId,effects=0,entry;const posts=[];const proposal=()=>({id,digest,state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+600000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:attemptId?{attemptId,providerIdempotencyKey:id}:null});
 const request=async(path,body)=>{if(body===undefined)return {proposals:[proposal()]};posts.push({path,body});if(path.endsWith('/decision'))state='approved';if(path.endsWith('/claim')){state='executing';attemptId='attempt';}if(path.endsWith('/receipt')){if(receiptOutage)throw Error('offline');state=body.receipt.outcome==='applied'?'done':'reconciliation_required';}return {proposal:proposal(),digest};};
 const journal={reserve:async input=>{if(entry)return {created:false,entry};entry={...input,phase:'reserved'};return {created:true,entry};},markApplying:async input=>Object.assign(entry,{phase:'applying',attemptId:input.attemptId}),finish:async input=>Object.assign(entry,input,{phase:'terminal'}),get:async()=>({entry}),list:async()=>({entries:entry?[entry]:[]})};
 const client=new DeviceActions(session,{installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities},'c'.repeat(64),request,journal,async op=>{effects++;assert.deepEqual(op,operation);const dialResult={kind:'phone-dial',status:handoff,handler:handoff==='handed-off'?'com.android.dialer':null,contact:false};return {status:handoff==='handed-off'?'succeeded':'failed',summary:handoff,...(evidence?{dialResult}:{})};});
 return {client,posts,get entry(){return entry;},get effects(){return effects;},online(){receiptOutage=false;}};}
const signal=()=>new AbortController().signal;

test('dial requires the negotiated capability; a contact target also needs the lookup',async()=>{
 await assert.rejects(fixture({capabilities:[]}).client.pending(context,signal()),/not negotiated/);
 await assert.rejects(fixture({operation:{type:'phone_dial',target:{kind:'contact',query:'Ada'}}}).client.pending(context,signal()),/not negotiated/);
 const [card]=await fixture().client.pending(context,signal());
 assert.equal(card.title,'Open dial screen');assert.match(card.description,/\+15555550100/);assert.match(card.description,/You place the call there/);
});
test('a sensitive or hidden screen cannot review a dial',async()=>{
 const f=fixture();assert.deepEqual(await f.client.pending({...context,sensitive:true},signal()),[]);
});
test('an approved dial opens the dial screen once and reports a handoff, never a call',async()=>{
 const f=fixture();await f.client.pending(context,signal());assert.equal((await f.client.approve(id,context,signal())).status,'succeeded');
 const receipt=f.posts.find(p=>p.path.endsWith('/receipt')).body.receipt;
 assert.equal(receipt.outcome,'applied');assert.deepEqual(receipt.result,{kind:'phone-dial',status:'handed-off',handler:'com.android.dialer',contact:false});
 await f.client.approve(id,context,signal()).catch(()=>{});assert.equal(f.effects,1);
});
test('a cancelled dial is a failed receipt with nothing dialed',async()=>{
 const f=fixture({handoff:'cancelled'});await f.client.pending(context,signal());assert.equal((await f.client.approve(id,context,signal())).status,'failed');
 const receipt=f.posts.find(p=>p.path.endsWith('/receipt')).body.receipt;assert.equal(receipt.outcome,'failed');assert.equal(receipt.result.status,'cancelled');
});
test('receipt retry replays the journaled handoff without opening the dialer again',async()=>{
 const f=fixture({receiptOutage:true});await f.client.pending(context,signal());await f.client.approve(id,context,signal());f.online();await f.client.syncReceipts(signal());
 assert.equal(f.effects,1);assert.equal(f.posts.filter(p=>p.path.endsWith('/receipt')).at(-1).body.receipt.result.status,'handed-off');
});
test('a dial outcome without native evidence is never receipted as applied or failed',async()=>{
 for(const handoff of ['handed-off','cancelled']){const f=fixture({handoff,evidence:false});await f.client.pending(context,signal());
  assert.equal((await f.client.approve(id,context,signal())).status,'unknown');assert.equal(f.posts.filter(p=>p.path.endsWith('/receipt')).length,0);}
});
