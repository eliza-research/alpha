// Image Contacts view adapter against a recording AlphaContacts stub. No device address book, Phone
// or Messages is involved: this proves the detail actions only open a prefilled view and the 200 cap.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'contacts-adapter-'));
const output=await build({entryPoints:[resolve('apps/app/src/prototype/contacts-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^(\.\/native-adapter|\.\/mvp-features|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.includes('native-adapter')?'export function watchReturnToApp(){return ()=>{};}':a.path.includes('mvp-features')?'export function isMvpView(view){return (globalThis.mvpViews||[]).includes(view);}':'export function registerPlugin(){return new Proxy({},{get:(_,method)=>method==="then"?undefined:options=>globalThis.contactsPlugin(method,options)});}',loader:'js'}));}}]});
writeFileSync(join(dir,'adapter.mjs'),output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const {installContactsAdapter}=await import(pathToFileURL(join(dir,'adapter.mjs')));
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
const settle=()=>new Promise(r=>setTimeout(r,5));
function mount(list,editor=async()=>({})){const calls=[],notices=[];globalThis.contactsPlugin=async(method,options)=>{calls.push([method,options]);if(method==='status')return {available:true,readable:true};if(method==='list')return list(options);if(method==='edit'||method==='create')return editor(method,options);return {};};
 const views={contacts:{render:st=>({contactsRows:st.list,d:st.open?{}:null})}};
 class Shell{view='contacts';S(){return {view:this.view};}vget(){return {q:''};}setState(){}toast(message){notices.push(message);}}
 installContactsAdapter(Shell,views);const shell=new Shell();shell.componentDidMount();return {views,calls,shell,Shell,notices};}
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
 let record=detail('a1'.repeat(32));const book=mountBook({get:()=>record,save:{status:'stale'}});await settle();book.model();await settle();
 book.model().d.edit();await settle();typeInto(book.model().ed.onName,'Ada L');
 record={...detail('b2'.repeat(32)),emailAddresses:[{address:'updated@example.com',type:'home'}]};
 book.model().ed.save();await settle();
 const ed=book.model().ed;assert.equal(ed.open,true,'the editor stays open with what the owner typed');assert.equal(ed.name,'Ada L');assert.match(ed.notice,/changed/);assert.equal(ed.cannotSave,true);
 ed.save();await settle();assert.equal(book.calls.filter(([m])=>m==='save').length,1,'the stale draft cannot overwrite current fields');
 ed.cancel();book.model().d.edit();await settle();
 assert.equal(book.model().ed.emails[0].value,'updated@example.com','reopening shows the current provider fields');
 typeInto(book.model().ed.onName,'Ada L');book.model().ed.save();await settle();
 const latest=book.calls.filter(([m])=>m==='save').at(-1)[1];assert.equal(latest.version,'b2'.repeat(32));assert.deepEqual(latest.emailAddresses,record.emailAddresses);
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

for(const lostReply of [false,true])test(`uncertain contact writes require an explicit refresh before another write (${lostReply?'lost reply':'native unknown'})`,async()=>{
 for(const kind of ['save','remove']){
  const unknown=()=>{if(lostReply)throw Error('Reply lost after commit');return {status:'unknown'};};
  const book=mountBook({get:()=>detail('a1'.repeat(32)),[kind]:unknown});await settle();book.model();await settle();
  if(kind==='save'){book.model().d.edit();await settle();typeInto(book.model().ed.onName,'Ada changed');book.model().ed.save();}
  else{book.model().d.del();book.model().d.confirmDelete();}
  await settle();assert.equal(book.model().ed.open,false);assert.match(book.model().nativeStatus,/Outcome unknown/);
  book.model().d.edit();book.model().addNew();book.model().d.del();book.model().d.confirmDelete();await settle();
  assert.equal(book.model().ed.open,false);assert.equal(book.calls.filter(([method])=>method===kind).length,1,'uncertainty never repeats the write');
  book.model().nativeRefresh();await settle();book.model();await settle();book.model().d.edit();await settle();
  assert.equal(book.model().ed.open,true,'an explicit successful read permits a newly reviewed edit');
 }
});

test('a retired Contacts editor cannot replace the read belonging to a later visit',async()=>{
 for(const operation of ['edit','create'])for(const outcome of ['saved','failed']){
  globalThis.mvpViews=['contacts'];
  const editor=Promise.withResolvers(),freshRead=Promise.withResolvers();
  let reads=0;
  const f=mount(()=>++reads===1?{contacts:[ada],more:false}:freshRead.promise,()=>editor.promise);
  await settle();
  const api={set(){},open(){}};
  const original=f.views.contacts.render({open:ada.id},api);
  if(operation==='edit')original.d.edit();else original.addNew();
  await settle();
  assert.equal(f.calls.filter(([method])=>method===operation).length,1);
  f.shell.view='notes';f.shell.componentDidUpdate();
  f.shell.view='contacts';f.shell.componentDidUpdate();
  await settle();
  assert.equal(reads,2);
  if(outcome==='saved')editor.resolve({saved:true});else editor.reject(Error('Old editor failed'));
  await settle();
  assert.equal(reads,2,operation+' '+outcome+' completion invalidated the new visit read');
  assert.deepEqual(f.notices,[],operation+' '+outcome+' completion reported in another visit');
  freshRead.resolve({contacts:[{...ada,id:'current',name:'Current contact'}],more:false});
  await settle();
  const shown=f.views.contacts.render({},api);
  assert.deepEqual(shown.contactsRows.map(row=>row.name),['Current contact']);
  assert.equal(shown.nativeBusy,false);
  f.shell.componentWillUnmount();
 }
});

test('an editor belonging to an unmounted shell cannot refresh its replacement',async()=>{
 globalThis.mvpViews=['contacts'];
 const editor=Promise.withResolvers(),freshRead=Promise.withResolvers();
 let reads=0;
 const f=mount(()=>++reads===1?{contacts:[ada],more:false}:freshRead.promise,()=>editor.promise);
 await settle();
 f.views.contacts.render({open:ada.id},{set(){}}).d.edit();
 await settle();assert.equal(f.calls.filter(([method])=>method==='edit').length,1,'the native handoff started before retirement');
 f.shell.componentWillUnmount();
 const replacement=new f.Shell();
 replacement.view='notes';replacement.componentDidMount();
 replacement.view='contacts';replacement.componentDidUpdate();
 await settle();
 assert.equal(reads,2);
 editor.reject(Error('Unmounted editor failed'));
 await settle();
 assert.equal(reads,2,'the retired editor started a read for its replacement');
 assert.deepEqual(f.notices,[]);
 freshRead.resolve({contacts:[{...ada,id:'replacement',name:'Replacement contact'}],more:false});
 await settle();
 assert.deepEqual(f.views.contacts.render({},{}).contactsRows.map(row=>row.name),['Replacement contact']);
 replacement.componentWillUnmount();
});

test('the current Contacts editor still refreshes and reports its own failure',async()=>{
 globalThis.mvpViews=['contacts'];
 const editor=Promise.withResolvers();
 let reads=0;
 const f=mount(()=>{reads++;return {contacts:[ada],more:false};},()=>editor.promise);
 await settle();
 f.views.contacts.render({open:ada.id},{set(){}}).d.edit();
 editor.reject(Error('Current editor failed'));
 await settle();
 assert.equal(reads,2);
 assert.deepEqual(f.notices,['Android Contacts could not open. Refresh and try again.']);
 assert.equal(f.views.contacts.render({},{}).nativeBusy,false);
 f.shell.componentWillUnmount();
});

test('a newer read in the same Contacts visit owns the editor completion',async()=>{
 for(const operation of ['edit','create'])for(const outcome of ['saved','failed']){
  globalThis.mvpViews=['contacts'];const editor=Promise.withResolvers(),fresh=Promise.withResolvers();let reads=0;
  const f=mount(()=>++reads===1?{contacts:[ada],more:false}:fresh.promise,()=>editor.promise);await settle();
  const api={set(){},open(){}};const original=f.views.contacts.render({open:ada.id},api);
  if(operation==='edit')original.d.edit();else original.addNew();await settle();
  f.views.contacts.render({},api).nativeRefresh();await settle();assert.equal(reads,2);
  if(outcome==='saved')editor.resolve({saved:true});else editor.reject(Error('Old editor reply'));await settle();
  assert.equal(reads,2,'an editor reply cannot supersede the current visit read');assert.deepEqual(f.notices,[]);
  fresh.resolve({contacts:[{...ada,name:'Current read'}],more:false});await settle();
  assert.deepEqual(f.views.contacts.render({},api).contactsRows.map(row=>row.name),['Current read']);
  assert.equal(f.views.contacts.render({},api).nativeBusy,false);f.shell.componentWillUnmount();
 }
});
