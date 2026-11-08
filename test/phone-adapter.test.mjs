// Image Phone view adapter (AP-08) against a recording telephony stub. No device, call log or
// Telecom is involved: this proves the renderer's fences and handoff wording, not a device read.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'phone-adapter-'));
const output=await build({entryPoints:[resolve('apps/app/src/prototype/phone-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,external:['@capacitor/core'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^(\.\.\/runtime\/aosp-image|\.\/native-adapter|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.includes('aosp-image')?'export const aospImage=false;':a.path.includes('native-adapter')?'export function watchReturnToApp(){return ()=>{};}':'export function registerPlugin(){return {};}',loader:'js'}));}}]});
writeFileSync(join(dir,'adapter.mjs'),output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const {installPhoneAdapter,phoneRows}=await import(pathToFileURL(join(dir,'adapter.mjs')));
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
 assert.match(views.phone.render({},{}).nativeStatus,/not available/);assert.ok(!calls.some(([m])=>m==='listRecentCalls'||m==='requestAccess'));
});
test('access is asked for only from the owner control; recents are then read bounded',async()=>{
 let granted=false;const {views,calls}=mount({status:()=>status(granted?'granted':'prompt'),requestAccess:()=>{granted=true;return status('granted');},listRecentCalls:{calls:[call]}});await settle();
 let model=views.phone.render({},{});assert.equal(model.nativeAccess,true);assert.ok(!calls.some(([m])=>m==='requestAccess'||m==='listRecentCalls'));
 model.nativeRequest();await settle();model=views.phone.render({},{});
 assert.deepEqual(calls.find(([m])=>m==='requestAccess'),['requestAccess',{access:'callLog'}]);assert.deepEqual(calls.find(([m])=>m==='listRecentCalls'),['listRecentCalls',{limit:50}]);
 assert.equal(model.nativeRows.length,1);assert.match(model.nativeRows[0].label,/Ada · new/);assert.match(model.nativeRows[0].detail,/Missed/);
});
test('dialing a recent call or a typed number is a handoff with the native message',async()=>{
 const {views,calls}=mount({status:status('granted'),listRecentCalls:{calls:[call]},dial:{status:'handed-off',target:'dialer',handler:null,message:'Your phone app is open with the number.'}});await settle();
 views.phone.render({},{}).nativeRows[0].dial();await settle();
 assert.deepEqual(calls.find(([m])=>m==='dial'),['dial',{number:'+15555550100'}]);assert.match(views.phone.render({},{}).nativeNotice,/phone app is open/);
 const model=views.phone.render({},{});model.nativeOnNumber({target:{value:'*#06#'}});views.phone.render({},{}).nativeDial();await settle();
 assert.match(views.phone.render({},{}).nativeNotice,/Enter a phone number/);assert.equal(calls.filter(([m])=>m==='dial').length,1,'an MMI string never reaches the dial handoff');
});
test('rows without a dialable number cannot dial',()=>{const rows=phoneRows([{...call,number:'',cachedName:null}],()=>{throw Error('dialed');});assert.equal(rows[0].noDial,true);rows[0].dial();assert.match(rows[0].label,/Unknown caller/);});
test('the template wraps the prototype Phone behind nativePrototype',()=>{const html=readFileSync('apps/app/src/prototype/template.html','utf8');const start=html.indexOf('<sc-if value="{{is.phone}}">');assert.ok(html.indexOf('<sc-if value="{{phone.nativeManaged}}">',start)>start);assert.ok(html.indexOf('<sc-if value="{{phone.nativePrototype}}">',start)<html.indexOf('{{phone.title}}',start));});
