import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {transformSync} from 'esbuild';import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
import {nextDefaultNoteTitle} from '../apps/app/src/runtime/note-default-title.ts';
import {authoredNoteText} from '../.eliza/client-features/plugins/plugin-notes/src/note-authored.ts';
// The staged canonical client, controller and snapshot state run with
// WebView113's static AbortSignal surface. Only the resident transport is a fixture.
function fixture({wait=false}={}){
 const compile=file=>transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',target:'es2022',format:'cjs'}).code;
 const globals={AbortController,AbortSignal:{},DOMException,structuredClone};
 const modules=new Map();
 const load=file=>{
  file=path.resolve(file);if(!fs.existsSync(file)&&file.endsWith('.js'))file=file.slice(0,-3)+'.ts';
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  const require=name=>{assert.match(name,/^\.\.?\//,'The Notes browser path must not load host dependencies');return load(path.resolve(path.dirname(file),name));};
  vm.runInNewContext(compile(file),{...globals,exports:module.exports,module,require},{filename:file});
  return module.exports;
 };
 const phases=[],snapshots=[],requests=[];let observedSignal;
 const port={sessionId:'s',identity:{ownerId:'o',agentId:'a',sessionId:'s',origin:'native'},current:()=>true,request:async(path,method,body,signal)=>{requests.push({path,method,body});observedSignal=signal;if(wait)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {success:true,data:{notes:[],revision:1}};}};
 const {CanonicalNotesController}=load('apps/app/src/prototype/canonical-notes-controller.ts');
 const controller=new CanonicalNotesController(port,{phase:value=>phases.push(value),snapshot:value=>snapshots.push(value)});
 return {controller,port,phases,snapshots,requests,signal:()=>observedSignal};
}
test('Notes reaches ready and dispatches exactly once without AbortSignal.any',async()=>{const f=fixture();await f.controller.refresh();assert.deepEqual(f.phases,['loading','ready']);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/notes/state');assert.equal(f.controller.revision,1);f.controller.retire();});
test('retiring a pending Notes read still cancels the request on old WebView',async()=>{const f=fixture({wait:true});const pending=f.controller.refresh();await Promise.resolve();assert.equal(f.requests.length,1);f.controller.retire();await assert.rejects(pending);assert.equal(f.signal().aborted,true);assert.equal(f.snapshots.length,0);assert.equal(f.controller.current,false);});
test('retired or rebound Notes controllers cannot attach invalidation listeners',()=>{
 for(const retire of [false,true]){
  const f=fixture(),listeners=new Set(),target={addEventListener:(_name,listener)=>listeners.add(listener),removeEventListener:(_name,listener)=>listeners.delete(listener)};
  f.controller.listen(target);assert.equal(listeners.size,1);
  if(retire)f.controller.retire();else f.port.identity.ownerId='another-owner';
  assert.throws(()=>f.controller.listen(target),{name:'AbortError'});assert.equal(listeners.size,0);assert.equal(f.requests.length,0);
 }
});
test('the affected app-record, automation and reminder paths use the same fallback',()=>{const source=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');assert.doesNotMatch(source,/AbortSignal\.any\(/);assert.match(source,/bounded=anyAbortSignal\(\[signal,controller\.signal\]\)/);for(const file of ['agent-calendar-client.ts'])assert.doesNotMatch(fs.readFileSync('apps/app/src/runtime/'+file,'utf8'),/AbortSignal\.any\(/);});
// Alpha's Notes binding over stub controller and editor ports: what retire and Undo do with them.
function notesUi(){
 const code=stripTypeScriptTypes(fs.readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
 const calls=[],dropped=[],toasts=[];
 class Controller{current=true;pending=false;revision=1;snapshot={notes:[{id:'n'}],trash:[],revision:1};constructor(_port,hooks){this.hooks=hooks;}listen(){}retire(){this.current=false;}hasViewNote(){return true;}}
 class Editor{draft=null;constructor(controller){this.controller=controller;}begin(){this.draft={token:'draft',title:'',body:'',version:0};}edit(patch){Object.assign(this.draft,patch);this.draft.version++;}get hasAuthoredContent(){return !!this.draft&&(!!this.draft.title||!!this.draft.body||!!authoredNoteText(this.draft.format));}async save(){calls.push('save');this.draft.id='new';return true;}close(){this.draft=null;}async remove(id){calls.push('remove:'+id);return true;}async restore(id){calls.push('restore:'+id);return true;}}
 const {CanonicalNotesUi}=new Function('parseNoteFormat','projectNoteForModel','noteScheduleDraft','agentPendingText','agentAvailabilityNotice','DailyApps','CanonicalNotesController','CanonicalNotesEditor','window','nextDefaultNoteTitle','authoredNoteText',code+';return {CanonicalNotesUi};')(x=>x,()=>({title:'',body:''}),async()=>({}),(_s,text)=>text,(_s,text)=>text,{},Controller,Editor,{},nextDefaultNoteTitle,authoredNoteText);
 const ui=new CanonicalNotesUi({},{paint(){},review(){calls.push('review');},dropped:title=>dropped.push(title)});
 return {ui,calls,dropped,toasts,api:{toast:(text,options)=>toasts.push({text,undo:options?.undo})}};
}
test('canonical UI numbers defaults without saving an untouched default or replacing a chosen title',async()=>{
 const f=notesUi();f.ui.controller.snapshot.notes=[{id:'one',title:'New note',body:'Kept'}];f.ui.controller.snapshot.trash=[{note:{id:'two',title:'New note #2',body:'Kept'}}];
 await f.ui.create();assert.equal(f.ui.editor.draft.title,'New note 3');assert.equal(f.ui.dirty,false);
 await f.ui.leave();assert.deepEqual(f.calls,[]);assert.equal(f.ui.editor.draft,null);
 await f.ui.create();f.ui.editor.edit({title:'My title',body:'Exact body'});assert.equal(f.ui.dirty,true);
 await f.ui.leave();assert.deepEqual(f.calls,['save']);assert.equal(f.ui.controller.snapshot.notes[0].title,'New note');
});
test('a connection change with an unsaved edit tells the owner the edit was dropped',()=>{
 for(const [draft,expected] of [[{token:'t',id:'n',version:2,title:'Groceries'},['Groceries']],[{token:'t',id:'n',version:0,title:'Clean'},[]],[null,[]]]){
  const f=notesUi();f.ui.editor.draft=draft;f.ui.retire();
  assert.deepEqual(f.dropped,expected);assert.equal(f.ui.editor.draft,null);assert.equal(f.ui.current,false);
 }
});
test('Undo waits for the current save and never restores over it into review',async()=>{
 const f=notesUi();
 assert.equal(await f.ui.remove('n',f.api),true);assert.equal(f.toasts.length,1);
 // A save is in flight and its queued follow-up keeps the controller pending.
 f.ui.controller.pending=true;const undone=f.toasts[0].undo();
 for(let i=0;i<20;i++){f.ui.controller.hooks.phase('ready');await new Promise(resolve=>setTimeout(resolve,0));}
 await undone;
 assert.deepEqual(f.calls,['remove:n']);assert.equal(f.toasts.at(-1).text,'Wait for the current save, then restore it from Trash.');
 // Once the save settles, Undo restores as before.
 f.ui.controller.pending=false;f.toasts[0].undo();await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(f.calls,['remove:n','restore:n']);
});
