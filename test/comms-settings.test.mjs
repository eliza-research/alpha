import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {createSmsSession} from '../apps/app/src/runtime/image-sms.ts';

// Messages, Contacts and Settings: resume and ordering rules. The adapters are
// bundled with their native ports replaced by in-memory fixtures; no Android, Cloud or browser runs.
const tick=()=>new Promise(done=>setImmediate(done));
const read=file=>readFileSync(file,'utf8');
const region=async(file,name)=>{const source=read(file),text=source.slice(source.indexOf(`// ${name}:begin`),source.indexOf(`// ${name}:end`));assert.ok(text.length>100&&source.includes(`// ${name}:begin`),`${name} region is present`);return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(text)).toString('base64'));};
/** Bundles one source file with the modules matching `filter` replaced by `fixture(path)` source text. */
async function bundle(entry,filter,fixture){
 const dir=mkdtempSync(join(tmpdir(),'comms-settings-'));
 const result=await build({entryPoints:[resolve(entry)],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'fixture',setup(builder){builder.onResolve({filter},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixture(args.path)}));}}]});
 const filename=join(dir,'module.mjs');writeFileSync(filename,result.outputFiles[0].text);
 return {module:await import(pathToFileURL(filename)),dispose:()=>rmSync(dir,{recursive:true,force:true})};
}

test('one return to the app runs its watcher once, and again only after leaving',async()=>{
 const m=await region('apps/app/src/prototype/native-adapter.ts','return-gate');
 let now=1000;const gate=m.returnGate(250,()=>now);
 // visibilitychange, focus and appResumed for the same return.
 assert.deepEqual([gate.returned(),gate.returned(),gate.returned()],[true,false,false]);
 now+=249;assert.equal(gate.returned(),false);
 now+=1;assert.equal(gate.returned(),true,'a later focus (closing Android quick settings) runs again');
 gate.left();assert.equal(gate.returned(),true,'leaving and returning inside the window still runs');
 const source=read('apps/app/src/prototype/native-adapter.ts');
 assert.match(source,/export function watchReturnToApp[\s\S]{0,200}if \(document\.hidden\) gate\.left\(\); else if \(gate\.returned\(\)\) run\(\);/);
});

test('repeated return triggers start one Messages read',async()=>{
 const m=await region('apps/app/src/prototype/native-adapter.ts','return-gate');
 let reads=0;const client={smsSendHistory:async()=>[],status:async()=>{reads++;return {permissions:{sms:'granted'},subscriptions:[]};},threadPage:async()=>({rows:[],next:null}),observeMessages:async()=>async()=>{}};
 const session=createSmsSession(client,true,()=>{});session.setActive(true);await tick();reads=0;
 const gate=m.returnGate(250,()=>0),check=()=>{if(gate.returned())void session.refresh();};
 check();check();check();await tick();assert.equal(reads,1);session.setActive(false);
});

test('Contacts keeps the rows on screen while a refresh is in flight and clears them when access is lost',async()=>{
 const priorDocument=globalThis.document;let release,readable=true,lists=0;
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
 globalThis.__commsContacts={status:async()=>({available:true,readable}),requestPermissions:async()=>({available:true,readable}),list:()=>++lists===1?Promise.resolve({contacts:[{id:'1',name:'Ada'}],more:false}):new Promise(done=>{release=done;})};
 const loaded=await bundle('apps/app/src/prototype/contacts-adapter.ts',/platform-plugins|native-adapter|mvp-features$/,path=>path.includes('platform-plugins')?'export const registerPlugin=()=>globalThis.__commsContacts;':path.includes('mvp-features')?'export const isMvpView=()=>true;':'export const watchReturnToApp=run=>{globalThis.__commsContacts.returned=run;return()=>{};};');
 try{
  class Component{view='contacts';S(){return {view:this.view};}setState(){}vget(){return {q:''};}toast(){}}
  const views={contacts:{render:state=>({list:state.list})}};loaded.module.installContactsAdapter(Component,views);
  const owner=new Component(),names=()=>views.contacts.render({},{set(){}}).list.map(row=>row.name);
  owner.componentDidMount();await tick();assert.deepEqual(names(),['Ada']);
  globalThis.__commsContacts.returned();await tick();
  assert.equal(views.contacts.render({},{set(){}}).nativeBusy,true);
  assert.deepEqual(names(),['Ada'],'rows are not blanked while the next read is in flight');
  release({contacts:[{id:'1',name:'Ada'},{id:'2',name:'Bo'}],more:false});await tick();assert.deepEqual(names(),['Ada','Bo']);
  readable=false;globalThis.__commsContacts.returned();await tick();assert.deepEqual(names(),[],'rows go when access is no longer granted');
  readable=true;lists=0;globalThis.__commsContacts.returned();await tick();assert.deepEqual(names(),['Ada']);
  owner.view='home';owner.componentDidUpdate();assert.deepEqual(names(),[],'rows go when the view is left');
  owner.componentWillUnmount();
 }finally{globalThis.document=priorDocument;delete globalThis.__commsContacts;loaded.dispose();}
});

test('a listener status read never discards or replaces a Pause or Turn off result',async()=>{
 const m=await region('apps/app/src/prototype/settings-adapter.ts','settings-reads');
 const gate=m.listenerReadGate();
 const early=gate.beginRead();assert.equal(typeof early,'number');
 assert.equal(gate.beginAction(),true);assert.equal(gate.busy(),true);
 assert.equal(gate.beginAction(),false,'one action at a time');
 assert.equal(gate.beginRead(),null,'no status read starts during the action');
 assert.equal(gate.readApplies(early),false,'a read started before the action is dropped');
 gate.endAction();assert.equal(gate.busy(),false);
 assert.equal(gate.readApplies(early),false,'and stays dropped after the action');
 const later=gate.beginRead();assert.equal(gate.readApplies(later),true);
 const newest=gate.beginRead();assert.equal(gate.readApplies(later),false);assert.equal(gate.readApplies(newest),true);
 const source=read('apps/app/src/prototype/settings-adapter.ts');
 const action=source.slice(source.indexOf('async function listenerAction('),source.indexOf('const changed ='));
 assert.match(action,/if \(!listenerReads\.beginAction\(\)\) return;/);
 assert.match(action,/if \(owner !== instance\) return;\s+listener = next;/,'the action result is applied whatever was refreshed meanwhile');
 assert.match(action,/finally \{ listenerReads\.endAction\(\);/);
 assert.match(source,/if \(!imageSenseAvailable\(\)\) return;\s+const read = listenerReads\.beginRead\(\);\s+if \(read === null\) return;\s+const status = await listenerStatus\(\);\s+if \(owner === instance && capabilityAbort === abort && listenerReads\.readApplies\(read\)\) listener = status;/);
});

test('a resume behind another view defers the Settings device read until Settings is shown',async()=>{
 const m=await region('apps/app/src/prototype/settings-adapter.ts','settings-reads');
 assert.equal(m.settingsResumeRead('settings'),'now');
 for(const view of ['home','messages',null,undefined])assert.equal(m.settingsResumeRead(view),'on-show');
 const source=read('apps/app/src/prototype/settings-adapter.ts');
 const resume=source.slice(source.indexOf("this.deviceResume = DailyApps.addListener('appResumed'"),source.indexOf('p.componentDidUpdate ='));
 assert.match(resume,/if \(settingsResumeRead\(this\.S\?\.\(\)\.view\) === 'now'\) \{ void refresh\(\); void refreshCapabilities\(\); return; \}[\s\S]{0,200}resumedUnread = true;/);
 assert.equal((resume.match(/void refresh\(\)/g)||[]).length,1,'the device read on resume is only the one for Settings in front');
 assert.match(resume,/void checkForUpdate\(false\)\?\.then\(changed\); automaticUpdateActive\(\);\s+if \(settingsResumeRead/,'the update check does not depend on the view');
 assert.match(source,/if \(resumedUnread && owner === this && this\.S\?\.\(\)\.view === 'settings'\) \{ void refresh\(\); void refreshCapabilities\(\); \}/,'the deferred read runs when Settings comes to the front');
 assert.match(source,/if \(!instance\) return;\s+resumedUnread = false;/,'any read satisfies the deferred one');
});
