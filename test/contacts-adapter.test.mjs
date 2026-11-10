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
 assert.deepEqual([...new Set(calls.map(([m])=>m))].sort(),['get','list','status'],'opening a contact only reads');
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

// In-app saves and deletes (ContactsBook.qnt): a write names the version that was shown.
const detail=version=>({id:'1',lookup:'k',displayName:'Ada',starred:false,phoneNumbers:[{number:'+15555550100',type:'mobile'}],emailAddresses:[{address:'ada@example.com',type:'home'}],version});
function mountBook(answers){const calls=[],sets=[],toasts=[];globalThis.mvpViews=['contacts'];
 globalThis.contactsPlugin=async(method,options)=>{calls.push([method,options]);if(method==='status'||method==='requestPermissions')return {available:true,readable:true,writable:answers.writable!==false};if(method==='list')return {contacts:[ada],more:false};const answer=answers[method];return typeof answer==='function'?answer(options):answer;};
 const views={contacts:{render:st=>({d:st.open?{}:null}),back:()=>false}};
 class Shell{S(){return {view:'contacts'};}vget(){return {q:''};}setState(){}toast(text){toasts.push(text);}}
 installContactsAdapter(Shell,views);const shell=new Shell();shell.componentDidMount();const api={open(){},set:patch=>sets.push(patch)};
 return {views,calls,sets,toasts,api,model:(st={open:'1'})=>views.contacts.render(st,api)};}
const typeInto=(handler,value)=>handler({target:{value}});

test('an owner edit saves with the version that was shown and closes the editor',async()=>{
 const book=mountBook({get:()=>detail('a1'.repeat(32)),save:{status:'saved',id:'1',version:'b2'.repeat(32)}});await settle();book.model();await settle();
 assert.deepEqual(book.model().d.fields.map(row=>[row.v,row.sub]),[['(555) 555-0100','Mobile'],['ada@example.com','Home']],'typed fields come from the open contact');
 book.model().d.edit();await settle();let ed=book.model().ed;assert.equal(ed.open,true);assert.equal(ed.cannotSave,true,'nothing to save until something changes');
 typeInto(ed.phones[0].onChange,'+15555550148');ed=book.model().ed;assert.equal(ed.cannotSave,false);ed.save();await settle();
 assert.deepEqual(book.calls.find(([m])=>m==='save')[1],{id:'1',version:'a1'.repeat(32),displayName:'Ada',phoneNumbers:[{number:'+15555550148',type:'mobile'}],emailAddresses:[{address:'ada@example.com',type:'home'}]});
 assert.equal(book.model().ed.open,false);
});
test('a contact that changed since it was shown keeps the editor and writes nothing more',async()=>{
 let version='a1'.repeat(32);const book=mountBook({get:()=>detail(version),save:{status:'stale'}});await settle();book.model();await settle();
 book.model().d.edit();await settle();typeInto(book.model().ed.onName,'Ada L');version='b2'.repeat(32);book.model().ed.save();await settle();
 const ed=book.model().ed;assert.equal(ed.open,true,'the editor stays open with what the owner typed');assert.equal(ed.name,'Ada L');assert.match(ed.notice,/changed/);
 assert.equal(book.calls.filter(([m])=>m==='save').length,1,'a conflict is never retried by itself');
 ed.save();await settle();assert.equal(book.calls.filter(([m])=>m==='save').at(-1)[1].version,'b2'.repeat(32),'the next save names the version read after the conflict');
});
test('a new contact needs something in it, and an invalid draft never reaches the phone',async()=>{
 const book=mountBook({save:{status:'saved',id:'9',version:'a1'.repeat(32)},get:()=>detail('a1'.repeat(32))});await settle();
 book.model({}).addNew();await settle();let ed=book.model({}).ed;assert.equal(ed.open,true);
 ed.addPhone();book.model({}).ed.save();await settle();assert.equal(book.calls.some(([m])=>m==='save'),false,'an empty contact is refused here');assert.match(book.model({}).ed.notice,/name, number or email/);
 typeInto(book.model({}).ed.onName,'  Grace  ');book.model({}).ed.save();await settle();
 assert.deepEqual(book.calls.find(([m])=>m==='save')[1],{displayName:'Grace',phoneNumbers:[],emailAddresses:[]},'blank rows are dropped and the name is trimmed');
 assert.deepEqual(book.sets.at(-1),{open:'9'},'the saved contact opens');
});
test('a delete asks first, names the version, and Back cancels it',async()=>{
 const book=mountBook({get:()=>detail('a1'.repeat(32)),remove:{status:'deleted'}});await settle();book.model();await settle();
 let d=book.model().d;assert.equal(d.canDelete,true);d.del();assert.equal(book.model().d.confirming,true);assert.equal(book.calls.some(([m])=>m==='remove'),false,'asking deletes nothing');
 assert.equal(book.views.contacts.back({open:'1'},book.api),true);assert.equal(book.model().d.confirming,false,'Back closes the confirmation, not the contact');
 book.model().d.del();book.model().d.confirmDelete();await settle();
 assert.deepEqual(book.calls.find(([m])=>m==='remove')[1],{id:'1',version:'a1'.repeat(32)});assert.deepEqual(book.sets.at(-1),{open:null});
});
test('without write access the system editor opens instead and nothing is written here',async()=>{
 const book=mountBook({writable:false,get:()=>detail('a1'.repeat(32))});await settle();book.model();await settle();
 assert.equal(book.model().d.canDelete,false);book.model().d.edit();await settle();
 assert.equal(book.model().ed.open,false);assert.ok(book.calls.some(([m])=>m==='edit'),'the handoff to Android Contacts still works');assert.equal(book.calls.some(([m])=>m==='save'),false);
});
