import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

// The product's standard node --test entry must load its real TypeScript client.
if(!process.execArgv.some((arg,i)=>arg==='--import'&&process.execArgv[i+1]==='tsx')||!process.execArgv.includes('--experimental-transform-types')){
 const child=spawnSync(process.execPath,['--import','tsx','--experimental-transform-types',process.argv[1]],{stdio:'inherit',timeout:30000});
 if(child.error)throw child.error;
 if(child.signal)throw Error(`Capability test stopped with ${child.signal}`);
 process.exit(child.status??1);
}
const {DeviceActions}=await import('../apps/app/src/runtime/device-actions.ts');
const {PHONE_DIAL_CAPABILITY,telephonyDeviceCapabilities}=await import('../apps/app/src/runtime/phone-dial-contract.ts');

const connection=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const start=connection.indexOf('async function deviceCapabilities(');
const end=connection.indexOf("return capabilities.join(',');",start);
assert.ok(start>=0&&end>start,'test the actual shared registration negotiator');
const negotiateSource=connection.slice(start,end)+"return capabilities.join(',');\n}";
const offered=['reminders.create.v1','reminders.local-record.v2','calendar.create.v1','calendar.next-read.v1','notes.query.v1','maps.selected-read.v1'];

// Execute the production function, with platform/foreign-domain ports supplied.
// This is capability and client-boundary proof, not Android or model acceptance.
async function capabilities(platform,offers=offered){
 const negotiate=runInNewContext(stripTypeScriptTypes(negotiateSource,{mode:'transform'})+';deviceCapabilities',{
  Capacitor:{getPlatform:()=>platform,isNativePlatform:()=>platform!=='web',isPluginAvailable:()=>false},
  CAMERA_CAPTURE_CAPABILITY:'camera.capture-photo.v1',SMS_SEND_CAPABILITY:'sms.send.v1',
  CALENDAR_AVAILABILITY_CAPABILITY:'calendar.availability-read.v1',
  availabilityNegotiated:()=>false,foregroundExecutor:undefined,aospImage:false,
  clockHandoffCapabilities:()=>[],clockRepeatDaysSupported:async()=>false,
  PHONE_DIAL_CAPABILITY,telephonyDeviceCapabilities,
 });
 return (await negotiate(offers)).split(',');
}

test('normal browser declines device reminder creation and retains existing record capabilities',async()=>{
 const caps=await capabilities('web');
 assert.equal(caps.includes('reminders.create.v1'),false);
 for(const cap of ['reminders.local-record.v2','calendar.local-event.v1','notes.local-record.v1','notes.query.v1','calendar.create.v1','maps.selected-read.v1'])assert.ok(caps.includes(cap),cap);
 assert.equal(caps.includes('reminders.local-record.v1'),false,'one record version');
});

test('native platforms retain only the reminder creation capability offered by their agent',async()=>{
 for(const platform of ['android','ios']){
  assert.ok((await capabilities(platform)).includes('reminders.create.v1'),platform);
  assert.equal((await capabilities(platform,['reminders.local-record.v2'])).includes('reminders.create.v1'),false,platform);
 }
 assert.equal((await capabilities('web',['reminders.local-record.v1'])).includes('reminders.local-record.v2'),false);
});

test('normal resident, remote and Cloud registration use the same capability policy',()=>{
 // Source-wiring assertion only; the execution tests above cover policy behavior.
 assert.equal((connection.match(/await deviceCapabilities\(/g)||[]).length,3);
});

const now=Date.now(),due=now+3600000;
const create={type:'reminder_create',fields:{title:'Boundary fixture',body:'',schedule:{at:due,dueAt:due,alertMinutes:0,recurrence:null}}};
const session={ownerId:'owner',agentId:'agent',origin:'https://agent.example',sessionId:'session'};
function client(operation,creation){
 const calls={gets:0,writes:0,executions:0};
 const proposal={id:'proposal',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(now+600000).toISOString(),subjectUserId:'owner',requestedBy:'agent',action:'device_action',payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:null};
 const request=async(_path,body)=>{if(body!==undefined){calls.writes++;throw Error('No approval, claim or effect is authorized by a pending-review test');}calls.gets++;return {proposals:[proposal]};};
 const actions=new DeviceActions(session,{installationId:'device',enrollmentId:'enrollment',key:'b'.repeat(64)},'c'.repeat(64),request,{},async()=>{calls.executions++;throw Error('No device effect is authorized');},undefined,true,creation);
 return {actions,calls};
}
const context={view:'home',revision:1,sensitive:false,timeZone:'UTC'};

test('an unnegotiated browser reminder proposal cannot reach approval or execution',async()=>{
 const {actions,calls}=client(create,false),items=await actions.pendingReview(context,new AbortController().signal);
 assert.equal(items.some(item=>item.proposal),false);
 assert.ok(items.some(item=>item.notice),'refusal is visible');
 assert.deepEqual(calls,{gets:1,writes:0,executions:0});
});

test('native creation remains pending review, never a saved-reminder or delivery receipt',async()=>{
 const {actions,calls}=client(create,true),items=await actions.pendingReview(context,new AbortController().signal);
 assert.equal(items.filter(item=>item.proposal).length,1);
 assert.equal(items.find(item=>item.proposal).proposal.id,'proposal');
 assert.deepEqual(calls,{gets:1,writes:0,executions:0});
});

test('legacy reminder compatibility remains separate from v1 negotiation and is not an applied effect',async()=>{
 const {actions,calls}=client({type:'create_reminder',title:'Legacy fixture',dueAt:new Date(due).toISOString()},false);
 const items=await actions.pendingReview(context,new AbortController().signal);
 assert.equal(items.filter(item=>item.proposal).length,1,'legacy bypass remains a disclosed compatibility limitation');
 assert.deepEqual(calls,{gets:1,writes:0,executions:0});
});
