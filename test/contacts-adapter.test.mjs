// Image Contacts view adapter against a recording AlphaContacts stub. No device address book, Phone
// or Messages is involved: this proves the detail actions only open a prefilled view and the 200 cap.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'contacts-adapter-'));
const output=await build({entryPoints:[resolve('apps/app/src/prototype/contacts-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^(\.\/native-adapter|\.\/mvp-features|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.includes('native-adapter')?'export function watchReturnToApp(){return ()=>{};}':a.path.includes('mvp-features')?'export function isMvpView(view){return (globalThis.mvpViews||[]).includes(view);}':'export function registerPlugin(){return new Proxy({},{get:(_,method)=>method==="then"?undefined:options=>globalThis.contactsPlugin(method,options)});}',loader:'js'}));}}]});
writeFileSync(join(dir,'adapter.mjs'),output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const {installContactsAdapter}=await import(pathToFileURL(join(dir,'adapter.mjs')));
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
const settle=()=>new Promise(r=>setTimeout(r,5));
function mount(list){const calls=[];globalThis.contactsPlugin=async(method,options)=>{calls.push([method,options]);if(method==='status')return {available:true,readable:true};if(method==='list')return list(options);return {};};
 const views={contacts:{render:st=>({d:st.open?{}:null})}};
 class Shell{S(){return {view:'contacts'};}vget(){return {q:''};}setState(){}toast(){}}
 installContactsAdapter(Shell,views);const shell=new Shell();shell.componentDidMount();return {views,calls};}
const ada={id:'1',name:'Ada',phones:['+15555550100','+15555550101'],emails:['ada@example.com']};

test('detail rows open Phone or Messages with the number and never dial or send',async()=>{
 globalThis.mvpViews=['contacts','phone','messages'];const {views,calls}=mount(()=>({contacts:[ada],more:false}));await settle();
 const opened=[];const api={open:(view,patch)=>opened.push([view,patch]),set(){}};
 const detail=views.contacts.render({open:'1'},api).d;
 assert.deepEqual(detail.acts.map(a=>a.label),['Call +15555550100','Message +15555550100','Call +15555550101','Message +15555550101']);assert.equal(detail.hasActs,true);
 detail.acts[0].go();detail.acts[3].go();
 assert.deepEqual(opened,[['phone',{prefill:'+15555550100'}],['messages',{prefill:'+15555550101'}]]);
 assert.deepEqual([...new Set(calls.map(([m])=>m))].sort(),['list','status']);
});
test('a view that is not admitted gets no action',async()=>{
 globalThis.mvpViews=['contacts','messages'];const {views}=mount(()=>({contacts:[ada],more:false}));await settle();
 const detail=views.contacts.render({open:'1'},{open(){},set(){}}).d;assert.deepEqual(detail.acts.map(a=>a.label),['Message +15555550100','Message +15555550101']);
 globalThis.mvpViews=['contacts'];const none=views.contacts.render({open:'1'},{open(){},set(){}}).d;assert.equal(none.hasActs,false);
});
test('Load more stops at 200 and says to search',async()=>{
 globalThis.mvpViews=['contacts'];const {views,calls}=mount(({limit})=>({contacts:Array.from({length:limit},(_,i)=>({id:String(i),name:'Contact '+i})),more:true}));await settle();
 let model=views.contacts.render({},{});assert.equal(model.nativeStatus,'50 contacts · more available');
 for(let i=0;i<3;i++){model.nativeLoadMore();await settle();model=views.contacts.render({},{});}
 assert.equal(calls.filter(([m])=>m==='list').at(-1)[1].limit,200);assert.equal(model.nativeMore,false);assert.equal(model.nativeStatus,'200 shown. Search to find other contacts.');
});
