// Image Phone view adapter (AP-08) against a recording telephony stub. No device, call log or
// Telecom is involved: this proves the renderer's fences and handoff wording, not a device read.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'phone-adapter-'));
const output=await build({entryPoints:[resolve('apps/app/src/prototype/phone-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,external:['@capacitor/core'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^(\.\.\/runtime\/aosp-image|\.\/native-adapter|\.\/mvp-features|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.includes('aosp-image')?'export const aospImage=false;':a.path.includes('native-adapter')?'export function watchReturnToApp(){return ()=>{};}':a.path.includes('mvp-features')?'export function isMvpView(view){return (globalThis.mvpViews||[]).includes(view);}':'export function registerPlugin(){return {};}',loader:'js'}));}}]});
writeFileSync(join(dir,'adapter.mjs'),output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const {installPhoneAdapter,phoneRows,openVoicemailRead,deleteOpenVoicemail}=await import(pathToFileURL(join(dir,'adapter.mjs')));
const {createAospTelephony}=await import('../apps/app/src/runtime/aosp-telephony.ts');
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
const status=callLog=>({version:2,voiceCapable:true,smsCapable:true,permissions:{contacts:'granted',phoneState:'denied',sms:'denied',sendSms:'denied',...(callLog?{callLog}:{})},sendMode:'handoff',roles:{dialer:{available:true,held:false,eligible:true},sms:{available:true,held:false,eligible:true}},defaultDialer:'com.android.dialer',defaultSms:null,subscriptions:null,defaultSmsSubscriptionId:null});
const call={id:'4',number:'+15555550100',cachedName:'Ada',date:1700000000000,durationSeconds:75,type:'missed',isNew:true};
function mount(answers){const calls=[];const plugin=new Proxy({},{get:(_,method)=>method==='then'?undefined:async options=>{calls.push([method,options]);const a=answers[method];return typeof a==='function'?a(options):a;}});
 const views={phone:{render:()=>({nativePrototype:true}),reply:()=>({text:'Calling'}),suggestions:()=>['call Ada']}};
 class Shell{constructor(){this.view='phone';}S(){return {view:this.view};}setState(){}}
 installPhoneAdapter(Shell,views,createAospTelephony(plugin,true));const shell=new Shell();shell.componentDidMount();return {views,shell,calls};}
const settle=()=>new Promise(r=>setTimeout(r,5));

test('off the image the adapter installs nothing',()=>{const views={phone:{render:()=>'prototype'}};class Shell{}installPhoneAdapter(Shell,views,null);assert.equal(views.phone.render(),'prototype');assert.equal(Shell.prototype.componentDidMount,undefined);});
test('the simulated call, agent reply and suggestions are replaced on the image',async()=>{
 const {views}=mount({status:status()});await settle();
 assert.equal(views.phone.reply(),null);assert.deepEqual(views.phone.suggestions(),[]);assert.equal(views.phone.status(),undefined);
 const model=views.phone.render({},{});assert.equal(model.nativeManaged,true);assert.equal(model.nativePrototype,false);
});
test('a host without the read shows no history and never asks for it',async()=>{
 const {views,calls}=mount({status:status()});await settle();
 assert.equal(views.phone.render({},{}).nativeStatus,'Recent calls aren\'t available.');assert.ok(!calls.some(([m])=>m==='listRecentCalls'||m==='requestAccess'));
});
test('access is asked for only from the owner control; recents are then read bounded',async()=>{
 let granted=false;const {views,calls}=mount({status:()=>status(granted?'granted':'prompt'),requestAccess:()=>{granted=true;return status('granted');},listRecentCalls:{calls:[call]}});await settle();
 let model=views.phone.render({},{});assert.equal(model.nativeAccess,true);assert.ok(!calls.some(([m])=>m==='requestAccess'||m==='listRecentCalls'));
 model.nativeRequest();await settle();model=views.phone.render({},{});
 assert.deepEqual(calls.find(([m])=>m==='requestAccess'),['requestAccess',{access:'callLog'}]);assert.deepEqual(calls.find(([m])=>m==='listRecentCalls'),['listRecentCalls',{limit:50}]);
 assert.equal(model.nativeRows.length,1);assert.match(model.nativeRows[0].label,/Ada · new/);assert.match(model.nativeRows[0].detail,/Missed/);
});
const placed={status:'placed',message:'Calling.'};
test('the owner tap on a recent call or a typed number places the call; an MMI string never does',async()=>{
 const {views,calls}=mount({status:status('granted'),listRecentCalls:{calls:[call]},placeCall:placed});await settle();
 views.phone.render({},{}).nativeRows[0].dial();await settle();
 assert.deepEqual(calls.find(([m])=>m==='placeCall'),['placeCall',{number:'+15555550100'}]);assert.equal(views.phone.render({},{}).nativeNotice,'','a placed call needs no words: the call screen takes over');
 assert.ok(!calls.some(([m])=>m==='dial'),'a placed call is not also handed off');
 const model=views.phone.render({},{});model.nativeOnNumber({target:{value:'*#06#'}});views.phone.render({},{}).nativeDial();await settle();
 assert.equal(views.phone.render({},{}).nativeNotice,'Enter a valid phone number.');assert.equal(calls.filter(([m])=>m==='placeCall').length,1,'an MMI string never reaches Telecom');
});
test('a number from Contacts fills the keypad once and calls only on the owner tap',async()=>{
 const {views,calls}=mount({status:status('granted'),listRecentCalls:{calls:[]},placeCall:placed});await settle();
 const sets=[];const api={set:patch=>sets.push(patch)};
 let model=views.phone.render({prefill:'+15555550100'},api);await settle();
 assert.equal(model.nativeNumber,'+15555550100');assert.equal(model.isKeypad,true,'the keypad shows the handed-over number');assert.deepEqual(sets,[{prefill:null}]);assert.ok(!calls.some(([m])=>m==='placeCall'||m==='dial'),'a prefill never calls');
 model=views.phone.render({},api);model.nativeOnNumber({target:{value:'+15555550199'}});assert.equal(views.phone.render({},api).nativeNumber,'+15555550199','the consumed prefill does not overwrite the owner edit');
 views.phone.render({},api).nativeDial();await settle();assert.deepEqual(calls.filter(([m])=>m==='placeCall'),[['placeCall',{number:'+15555550199'}]]);
 assert.equal(views.phone.render({},api).nativeNumber,'','a placed call clears the keypad');
});
test('an emergency number, a busy line and a refusal say what happened and place nothing more',async()=>{
 for(const [answer,text] of [[{status:'emergency-handoff',message:'Emergency numbers open in the phone app.'},/phone app/],[{status:'busy',message:'Another call is in progress.'},/in progress/],[{status:'unavailable',message:'Calls are unavailable.'},/unavailable/]]){
  const {views,calls}=mount({status:status('granted'),listRecentCalls:{calls:[call]},placeCall:answer});await settle();
  views.phone.render({},{}).nativeRows[0].dial();await settle();assert.match(views.phone.render({},{}).nativeNotice,text);assert.equal(calls.filter(([m])=>m==='placeCall').length,1);
 }
});
test('without the dialer role the number opens in the system dial screen instead',async()=>{
 const refuse=()=>{throw Object.assign(Error('Dialer role required'),{code:'role-required'});};
 const {views,calls}=mount({status:status('granted'),listRecentCalls:{calls:[call]},placeCall:refuse,dial:{status:'handed-off',target:'dialer',handler:null,message:'Your phone app is open with the number.'}});await settle();
 views.phone.render({},{}).nativeRows[0].dial();await settle();
 assert.deepEqual(calls.find(([m])=>m==='dial'),['dial',{number:'+15555550100'}]);assert.match(views.phone.render({},{}).nativeNotice,/phone app is open/);
});
test('a call that cannot start says so and is not retried',async()=>{
 const {views,calls}=mount({status:status('granted'),listRecentCalls:{calls:[call]},placeCall:()=>{throw Error('telecom gone');}});await settle();
 views.phone.render({},{}).nativeRows[0].dial();await settle();assert.equal(views.phone.render({},{}).nativeNotice,'The call could not be started.');
 assert.equal(calls.filter(([m])=>m==='placeCall').length,1);assert.ok(!calls.some(([m])=>m==='dial'));
});
test('voicemail shows only while the carrier store is ready, and an open voicemail is what the agent may read',async()=>{
 const item={id:'7',number:'+15555550100',cachedName:null,date:1700000000000,durationSeconds:24,isNew:true,hasAudio:true,carrierTranscript:'Call me back.'};
 let {views}=mount({status:status('granted'),listRecentCalls:{calls:[]},voicemailStatus:{access:true,state:'unsupported'},listVoicemail:{state:'unsupported',voicemails:[]}});await settle();
 assert.deepEqual(views.phone.render({},{}).tabs.map(tab=>tab.key),['recents','keypad'],'no voicemail tab without a carrier source');assert.equal(openVoicemailRead(),null);
 ({views}=mount({status:status('granted'),listRecentCalls:{calls:[]},listVoicemail:{state:'ready',voicemails:[item]},observeVoicemail:{},voicemailPcm:()=>{throw Error('no decoder in this test');}}));await settle();
 let model=views.phone.render({},{});assert.deepEqual(model.tabs.map(tab=>tab.key),['recents','keypad','voicemail']);assert.equal(model.tabs[2].dot,true,'a new voicemail marks the tab');
 model.tabs[2].pick();model=views.phone.render({},{});assert.equal(model.isVoicemail,true);assert.equal(openVoicemailRead(),null,'a listed voicemail is not an open one');
 model.voicemails[0].toggle();await settle();model=views.phone.render({},{});
 assert.equal(model.vm.open,true);assert.equal(model.vm.text,'Call me back.','the carrier transcript shows as it is');assert.equal(model.vm.failed,true,'audio that cannot be decoded offers a retry, not a guess');
 assert.deepEqual(openVoicemailRead(),{caller:null,date:1700000000000,durationSeconds:24,transcriptState:'ready',engine:'carrier',transcript:'Call me back.'});
 const answer=deleteOpenVoicemail();assert.equal(views.phone.render({},{}).vm.confirming,true,'a delete asks first');views.phone.render({},{}).vm.cancelDelete();assert.equal(await answer,'cancelled');
});
test('Contacts opens only where Contacts is admitted',async()=>{
 const {views}=mount({status:status()});await settle();const opened=[],toasts=[];const api={open:view=>opened.push(view),toast:text=>toasts.push(text)};
 globalThis.mvpViews=[];views.phone.render({},api).nativeContacts();assert.deepEqual(opened,[]);assert.deepEqual(toasts,['Contacts isn\'t available on this phone.']);
 globalThis.mvpViews=['contacts'];views.phone.render({},api).nativeContacts();assert.deepEqual(opened,['contacts']);globalThis.mvpViews=[];
});
test('rows without a dialable number cannot dial',()=>{const rows=phoneRows([{...call,number:'',cachedName:null}],()=>{throw Error('dialed');});assert.equal(rows[0].noDial,true);rows[0].dial();assert.match(rows[0].label,/Unknown caller/);});
test('the template wraps the prototype Phone behind nativePrototype',()=>{const html=readFileSync('apps/app/src/prototype/template.html','utf8');const start=html.indexOf('<sc-if value="{{is.phone}}">');assert.ok(html.indexOf('<sc-if value="{{phone.nativeManaged}}">',start)>start);assert.ok(html.indexOf('<sc-if value="{{phone.nativePrototype}}">',start)<html.indexOf('{{phone.title}}',start));});
