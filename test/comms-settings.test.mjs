import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// Messages, Contacts and Settings: resume and ordering rules. The adapters are
// bundled with their native ports replaced by in-memory fixtures; no Android, Cloud or browser runs.
const tick=()=>new Promise(done=>setImmediate(done));
/** Bundles one source file with the modules matching `filter` replaced by `fixture(path)` source text. */
async function bundle(entry,filter,fixture){
 const dir=mkdtempSync(join(tmpdir(),'comms-settings-'));
 const result=await build({entryPoints:[resolve(entry)],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'fixture',setup(builder){builder.onResolve({filter},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixture(args.path)}));}}]});
 const filename=join(dir,'module.mjs');writeFileSync(filename,result.outputFiles[0].text);
 return {module:await import(pathToFileURL(filename)),dispose:()=>rmSync(dir,{recursive:true,force:true})};
}

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

