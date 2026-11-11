// Settings › Privacy › Activity decisions against a recording connection stub. No agent, phone
// action or device is involved: this proves the adapter's busy guard and failure toast only.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const stubs={
 '../runtime/cloud-protocol':'export const cloudServiceName=()=>"Cloud";',
 '../browser/dev-profile':'export const browserDevProfile=false;',
 '../build-flags':'export const testMocksEnabled=false;',
 '../runtime/voice-selection':'export const speechRoute=()=>"device";',
 '@capacitor/core':'export const Capacitor={isNativePlatform:()=>true};',
 '../daily':'export const DailyApps={perform:async()=>({status:"opened"}),addListener:async()=>null};',
 '../platform-plugins':'export function registerPlugin(){return {providerStatus:async()=>({})};}',
 '../runtime/connection-ui':'export const connectionController=globalThis.activityController;export const agentAvailabilityNotice=()=>"";export const agentPendingText=(_c,t)=>t;',
 '../runtime/local-agent':'export const modelLabel=(a,b)=>a+" · "+b;',
 './camera-adapter':'export const askAboutCapture=()=>false;',
 '@elizaos/capacitor-system/settings':'export const broaderPageNotice=0,handoffGate=0,switchValue=0,SYSTEM_TILE_SETTINGS_PAGES={},tileAccessibleName=0,tileFactsFromSystemFacts=0,tileStateText=0;',
 './context-selection':'export const captureQuestion=()=>undefined,locationMimeTypes=()=>undefined;',
};
const dir=mkdtempSync(join(tmpdir(),'native-activity-'));
const output=await build({entryPoints:[resolve('apps/app/src/prototype/native-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'stubs',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
writeFileSync(join(dir,'adapter.mjs'),output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));

const entry={id:'a1',title:'Send SMS',description:'Send SMS',state:'reconciliation_required'};
const controller=globalThis.activityController={calls:[],next:null,
 getSnapshot:()=>({kind:'resident',session:{sessionId:'s1'},phoneActionsAvailable:true,actionHistory:[entry],error:null,cloudAccount:null}),
 reconcile(id,applied){this.calls.push(['reconcile',id,applied]);return this.next();},
 rejectProposal(id){this.calls.push(['reject',id]);return this.next();},
 actionHistory:async()=>{},open(){}};
const {installPrototypeNativeAdapters}=await import(pathToFileURL(join(dir,'adapter.mjs')));
const views={settings:{render:()=>({stack:[{title:'Activity',groups:[]}]})}};
installPrototypeNativeAdapters(null,views);
function open(){const toasts=[];const api={toast:m=>toasts.push(m),set(){},get:()=>({})};
 const rows=views.settings.render({page:'privacy',log:true},api).stack[0].groups.flatMap(g=>g.rows);
 return {toasts,row:label=>rows.find(r=>r.label===label)};}
const settle=()=>new Promise(r=>setTimeout(r,5));

test('a rejected review shows a toast and frees the entry for another try',async()=>{
 controller.calls=[];controller.next=()=>Promise.reject(new Error('SMS reconciliation requires exact saved evidence'));
 const view=open();assert.ok(!view.row('Check your phone, then confirm whether this happened.'));
 view.row('It happened').go();await settle();
 assert.deepEqual(view.toasts,['Not recorded']);
 controller.next=()=>Promise.resolve();open().row('It happened').go();await settle();
 assert.equal(controller.calls.length,2,'busy was cleared after the failure');
});
test('a second tap while a review is in flight issues no second call',async()=>{
 controller.calls=[];let finish;controller.next=()=>new Promise(r=>{finish=r;});
 const view=open();view.row('It happened').go();view.row('It did not happen').go();open().row('It happened').go();
 assert.deepEqual(controller.calls,[['reconcile','a1',true]]);
 finish();await settle();assert.deepEqual(view.toasts,[]);
});
test('an error without a message still says the review was not recorded',async()=>{
 controller.calls=[];controller.next=()=>Promise.reject('offline');
 const view=open();view.row('It did not happen').go();await settle();
 assert.deepEqual(view.toasts,['Not recorded']);
});
