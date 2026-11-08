import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {transformSync} from 'esbuild';
const root=process.env.ALPHA_NOTES_BASE_ROOT??fileURLToPath(new URL('..',import.meta.url));
const changed=process.env.ALPHA_NOTES_CANDIDATE_ROOT??root;
const read=name=>fs.readFileSync(path.join(changed,name),'utf8');
const source=read('apps/app/src/prototype/agent-adapter.ts');
const slice=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const transform=text=>stripTypeScriptTypes(text,{mode:'transform'});
function moduleLoader(){
 const modules=new Map();
 function load(request){
  let file=path.resolve(request);if(!fs.existsSync(file))for(const suffix of ['.ts','.tsx','.js'])if(fs.existsSync(file+suffix)){file+=suffix;break;}
  const local=path.relative(root,file),candidate=path.join(changed,local);if(!local.startsWith('..')&&fs.existsSync(candidate))file=candidate;
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  const require=name=>{assert.match(name,/^\.\.?\//);const here=path.relative(changed,file);return load(path.resolve(path.dirname(here.startsWith('..')?file:path.join(root,here)),name));};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',target:'es2022',format:'cjs'}).code,{exports:module.exports,module,require,AbortController,DOMException,crypto,structuredClone,TextEncoder,TextDecoder},{filename:file});return module.exports;
 }
 return load;
}
test('empty previous Notes is distinct from retained keys and unreadable storage without initializing it',async()=>{
 const load=moduleLoader(),access=load(path.join(root,'apps/app/src/prototype/legacy-notes-access.ts')),keys=load(path.join(root,'apps/app/src/runtime/notes-secure-store.ts'));
 const signal=new AbortController().signal;
 let writes=0;const storage={getItem:()=>null,setItem:()=>writes++,removeItem:()=>writes++},vault={read:async()=>null,compareExchange:async()=>{writes++;throw Error('No write allowed');}},port={read:async()=>null,compareExchange:async()=>{writes++;throw Error('No write allowed');}};
 await assert.rejects(access.openExistingBrowserNotes(port,signal,()=>true,storage),error=>error.constructor.name==='LegacyNotesAbsent');
 await assert.rejects(access.openExistingDeviceNotes(vault,storage,signal,()=>true),error=>error.constructor.name==='LegacyNotesAbsent');assert.equal(writes,0);
 for(const key of keys.LEGACY_NOTES_SOURCE_KEYS){const old={...storage,getItem:found=>found===key?'retained':null};await assert.rejects(access.openExistingBrowserNotes(port,signal,()=>true,old),error=>error.constructor.name==='LegacyNotesReviewRequired');await assert.rejects(access.openExistingDeviceNotes(vault,old,signal,()=>true),error=>error.constructor.name!=='LegacyNotesAbsent');}
 const unreadable={...vault,read:async()=>{throw Error('Keystore locked');}};await assert.rejects(access.openExistingDeviceNotes(unreadable,storage,signal,()=>true),/Keystore locked/);assert.equal(writes,0);
});
function notesSelectionFixture({retained={version:1,token:'older-draft'},readFailure=false,hold=false}={}){
 const list=[{id:'old',kind:'text',title:'Saved',body:'Saved body'}],store={list,raw:JSON.stringify({records:list})};
 const state={list:[],open:null},events=[],drafts=[];
 const shell={live:true,notesSourceMode:'canonical',notesSourceEpoch:0,notesPending:0,notesOpenAbort:new AbortController(),vget:()=>state,toast:text=>events.push(text)};
 const scope={AbortController,DOMException,clearTimeout,isAndroid:true,localStorage:{},secureConnectionStore:{},browserNotesPort:{},LegacyNotesAbsent:class LegacyNotesAbsent extends Error{},syncCanonicalNotes(){},context(){},notesDataset(){},previousNotesObservation:async()=>({id:'old'}),openExistingDeviceNotes:async()=>store,openExistingBrowserNotes:async()=>store,originalSet:{call(_shell,_key,patch){Object.assign(state,patch);}},SecureNotesStore:{readDraft:async()=>{if(hold)await new Promise(resolve=>scope.release=resolve);if(readFailure)throw Error('Unreadable');return retained;},saveDraft:async(_vault,input)=>{drafts.push(input);return {...input,token:'newer'};}}};
 vm.createContext(scope);vm.runInContext(transform(slice('  async function selectNotesSource(','  function context(shell: Shell)')+slice('  function keepNotesDraft(','  /** Android: after a clean open')),scope);return{scope,shell,state,store,events,drafts,select:mode=>scope.selectNotesSource(shell,mode)};
}
test('earlier encrypted draft is read before Notes becomes editable and passed into a later failed-save merge',async()=>{
 const f=notesSelectionFixture({hold:true});const opening=f.select('legacy');await new Promise(setImmediate);assert.equal(f.shell.notesStorageFailed,true);assert.equal(f.state.list.length,0);f.scope.release();assert.equal(await opening,true);assert.equal(f.shell.notesDraftKept.token,'older-draft');
 f.shell.notesStorageFailed=true;f.scope.failedNotesStatus=()=>'';f.scope.keepNotesDraft(f.shell,[{id:'new',body:'New unsaved text'}],'failed');await f.shell.notesDraftTask;assert.equal(f.drafts[0].kept.token,'older-draft');assert.equal(f.drafts[0].list[0].body,'New unsaved text');
});
test('unreadable retained draft stays in recovery and cannot be silently initialized',async()=>{
 const f=notesSelectionFixture({readFailure:true});assert.equal(await f.select('legacy'),false);assert.equal(f.shell.notesDraftUnreadable,true);assert.equal(f.shell.notesStorageFailed,true);assert.equal(f.state.list[0].body,'Saved body');assert.equal(f.drafts.length,0);
});
test('retired opening cannot publish a prior source draft into the next source',async()=>{
 const f=notesSelectionFixture({hold:true}),opening=f.select('legacy');await new Promise(setImmediate);await f.select('canonical');f.scope.release();await opening;assert.equal(f.shell.notesSourceMode,'canonical');assert.equal(f.shell.notesDraftKept,null);assert.equal(f.state.list.length,0);
});
test('leaving failed legacy edits without a confirmed draft keeps the text visible',async()=>{
 const f=notesSelectionFixture();await f.select('legacy');f.state.list=[{id:'old',title:'Saved',body:'Unsaved newest text'}];f.shell.notesStorageFailed=true;assert.equal(await f.select('canonical'),false);assert.equal(f.shell.notesSourceMode,'legacy');assert.equal(f.state.list[0].body,'Unsaved newest text');assert.equal(f.events.length,1);
});
function bindingFixture(){
 let notify;const paints=[],actions=[],state={draft:'Owner A unsent',msgs:[],chat:'sheet'},connection={session:{sessionId:'owner-a'},startupResolved:true};
 const shell={live:true,connectionSession:'owner-a',startupDraft:null,S:()=>state,composerDraft:{binding:'owner-a',retire(notify=true){actions.push(['retire',notify]);this.binding=undefined;},edit(text){actions.push(['edit',this.binding,text]);}},draftBindingAbort:{abort:()=>actions.push(['abort'])},refreshDraftBinding:()=>actions.push(['open',state.draft]),setState(update,after){paints.push(()=>{Object.assign(state,typeof update==='function'?update(state):update);shell.composerDraft.edit(state.draft);after?.();});}};
 const scope={connectionController:{subscribe:fn=>{notify=fn;return ()=>{};},getSnapshot:()=>connection,getSelectedConversationId:()=>undefined},cancelMessageContext(){},clearMapsSelection(){},alphaClient:{disconnect(){}},syncStoppedReplyNotice(){},syncCanonicalNotes(){},context(){},collapseSystemNotices:x=>x,mergeConversationDelivery:(x,y)=>[...x,...y]};vm.createContext(scope);vm.runInContext(transform('globalThis.install=function(){'+slice('    this.connectionUnsubscribe = connectionController.subscribe(() => {','    // Canonical is the default;')+'};'),scope);scope.install.call(shell);return{shell,state,connection,paints,actions,notify:()=>notify()};
}
for(const kind of ['owner','history'])test(`${kind} transition retires old draft before paint and opens the new binding after clearing`,()=>{
 const f=bindingFixture();if(kind==='owner')f.connection.session={sessionId:'owner-b'};else f.connection.history={sessionId:'owner-a',conversationId:'new-chat',automatic:false,messages:[]};f.notify();assert.deepEqual(f.actions[0],['abort']);assert.deepEqual(f.actions[1],['retire',false]);assert.equal(f.actions.some(a=>a[0]==='open'),false);f.paints.forEach(paint=>paint());assert.equal(f.state.draft,'');assert.deepEqual(f.actions.at(-1),['open','']);assert.equal(f.actions.some(a=>a[0]==='edit'&&a[1]==='owner-a'),false);
});
test('first-send settlement remains tracked by updater flush and recovery review is still aborted',()=>{
 assert.match(slice('function settleFirstSendSlot(','/**\n * A new chat'),/firstSendSlotWrites/);assert.match(slice('  p.flushComposerForAppUpdate','  p.flushNotesForAppUpdate'),/Promise\.all\(writes\)/);assert.match(slice('    this.connectionUnsubscribe','    // Canonical is the default;'),/draftRecoveryAbort\?\.abort/);
});
function agentNotesFixture(){
 const initial=[{id:'one',title:'Note',body:'Before'}],raw=list=>JSON.stringify({version:2,records:list}),state={list:initial,open:'one',sheet:'menu'},timers=[],events=[];
 let finish;const store={list:initial,raw:raw(initial),needsRecovery:false,execute:async()=>{await new Promise(resolve=>finish=resolve);store.list=[];store.raw=raw([]);return {kind:'notes_delete'};}};
 const shell={live:true,notesSourceMode:'legacy',notesSourceEpoch:1,notesStore:store,notesRaw:store.raw,notesPending:0,notesStorageFailed:false,vget:()=>state};
 const selected={view:'notes',sensitive:false},scope={document:{hidden:false},context(){},alphaClient:{getState:()=>({context:selected})},isNotesOperation:()=>true,presentDeviceRecordOperation:()=>({appliedSummary:'Changed'}),NotesCommitUncertain:class extends Error{},NotesStorageFull:class extends Error{},isNotesTrashFull:()=>false,failedNotesStatus:()=>'',originalSet:{call(_shell,_key,patch){events.push(patch);Object.assign(state,patch);}},isAndroid:true,previousNotesObservation:async()=>({}),reconcileNotesEditor:moduleLoader()(path.join(root,'.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts')).reconcileNotesEditor,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout:()=>{}};
 vm.createContext(scope);
 vm.runInContext(transform(slice('  function armNotesAgentFallback(','  /** Android Notes recovery')+'\nglobalThis.install=function(){'+slice('    this.notesCommittedHandler=()=>{',"    window.addEventListener('alpha:notes-committed'")+'};\nglobalThis.execute=async function(operation,signal,expectedContext){const operationId="agent-operation";'+slice('      if(isNotesOperation(operation)){',"      if(operation.type==='read_calendar_range'")+'};'),scope);scope.install.call(shell);
 return{scope,shell,state,store,events,timers,start:()=>scope.execute.call(shell,{type:'notes_update'},new AbortController().signal,selected),finish:()=>finish()};
}
test('agent Notes writes publish only after the committed callback and clear an obsolete open note',async()=>{
 const f=agentNotesFixture(),pending=f.start();assert.equal(f.shell.notesAgentBusy,true);f.shell.notesCommittedHandler();assert.equal(f.events.length,0);assert.equal(f.state.list[0].body,'Before');f.finish();const result=await pending;assert.equal(result.status,'succeeded');assert.equal(f.shell.notesAgentBusy,false);assert.equal(f.shell.notesAgentRaw,f.store.raw);assert.equal(f.events.length,0,'no render or selection update before the receipt caller returns');assert.equal(f.state.open,'one');f.shell.notesCommittedHandler();assert.equal(f.state.list.length,0);assert.equal(f.state.open,null);assert.equal(f.shell.notesAgentRaw,null);
});
for(const retire of [false,true])test(`agent fallback adopts only its own committed source; retired=${retire}`,async()=>{
 const f=agentNotesFixture(),pending=f.start();f.finish();await pending;assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,30000);if(retire)f.shell.notesSourceEpoch++;f.timers[0].fn();assert.equal(f.state.list.length,retire?1:0);assert.equal(f.events.length,retire?0:1);
});
test('reopened draft merging preserves earlier-session changes after this session reverts its own failed edit',async()=>{
 const load=moduleLoader(),{SecureNotesStore}=load(path.join(root,'apps/app/src/runtime/notes-secure-store.ts'));
 let stored=null;const vault={read:async()=>stored,compareExchange:async(_key,expected,value)=>{assert.equal(JSON.stringify(expected),JSON.stringify(stored));stored=structuredClone(value);return {status:'saved'};}};
 const saved=[{id:'old',kind:'text',title:'Saved',body:'Saved body'}],older=[{id:'old',kind:'text',title:'Saved',body:'Earlier unsaved body'}];
 const retained=await SecureNotesStore.saveDraft(vault,{savedRaw:JSON.stringify({version:2,records:saved}),saved,list:older,reason:'failed'});
 const f=notesSelectionFixture({retained});await f.select('legacy');f.scope.SecureNotesStore=SecureNotesStore;f.scope.secureConnectionStore=vault;f.scope.failedNotesStatus=()=>'';
 const newest=[...saved,{id:'new',kind:'text',title:'New',body:'Current session text'}];f.scope.keepNotesDraft(f.shell,newest,'failed');await f.shell.notesDraftTask;
 f.scope.keepNotesDraft(f.shell,saved,'failed');await f.shell.notesDraftTask;
 assert.equal(stored.records.find(row=>row.id==='old')?.body,'Earlier unsaved body');assert.equal(stored.records.some(row=>row.id==='new'),false,'reverting this session does not resurrect its failed edit');
});

test('source switching and app update wait until the approved Notes write is published',async()=>{
 const f=notesSelectionFixture();await f.select('legacy');f.shell.notesAgentBusy=true;assert.equal(await f.select('canonical'),false);f.shell.notesAgentBusy=false;f.shell.notesAgentRaw='committed newer raw';f.store.raw=f.shell.notesAgentRaw;assert.equal(await f.select('canonical'),false);
 f.scope.p={};vm.runInContext(transform(slice('  p.flushNotesForAppUpdate','  p.componentDidUpdate')),f.scope);
 await assert.rejects(f.scope.p.flushNotesForAppUpdate.call(f.shell,()=>true),/still pending/);
 f.shell.notesAgentRaw=null;f.shell.notesRaw=f.store.raw;f.store.assertCurrent=async()=>{};await f.scope.p.flushNotesForAppUpdate.call(f.shell,()=>true);
});

test('source change waits for encrypted-draft retention and refuses a newer queued draft',async()=>{
 const f=notesSelectionFixture();await f.select('legacy');const held=Promise.withResolvers();f.shell.notesDraftTask=held.promise;const leaving=f.select('canonical');assert.equal(f.shell.notesSourceMode,'legacy');f.shell.notesDraftTask=Promise.resolve();held.resolve();assert.equal(await leaving,false);assert.equal(f.shell.notesSourceMode,'legacy');
});
