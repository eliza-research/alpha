import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import test from 'node:test';
const connection=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const pendingCode=stripTypeScriptTypes(connection.slice(connection.indexOf('export function residentPendingText('),connection.indexOf('/** The send/voice refusal')).replace(/^export /gm,''),{mode:'strip'});
const pending=(state,residentAlwaysPresent=false)=>new Function('state','residentAlwaysPresent','RESIDENT_RECOVERY_PENDING','PENDING_FALLBACK',pendingCode+';return {agentPendingText,agentAvailabilityNotice};')(state,residentAlwaysPresent,'Review agent recovery.','Unavailable.');
const source=readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
/** The restored module over Alpha's own Notes view: host imports are stubs, the binding is real. */
function notesFixture({kind='offline',resident=false,status='',ready=false}={}){
 const reason=pending({kind},resident),calls=[],toasts=[];
 class Controller{current=true;pending=false;revision=1;snapshot={notes:[],trash:[],revision:1};constructor(_port,hooks){this.hooks=hooks;}listen(){}refresh(){return Promise.resolve(this.snapshot);}hasViewNote(){return false;}viewNote(){}retire(){this.current=false;}}
 class Editor{draft=null;hasAuthoredContent=false;constructor(_controller,hooks){this.hooks=hooks;}begin(kind){calls.push('canonical-create:'+kind);this.draft={token:'t',version:0,title:'',body:''};}edit(){}close(){this.draft=null;}selection(){}}
 const module=new Function('parseNoteFormat','projectNoteForModel','noteScheduleDraft','agentPendingText','agentAvailabilityNotice','DailyApps','CanonicalNotesController','CanonicalNotesEditor','window',code+';return {installCanonicalNotesView,CanonicalNotesUi};')(x=>x,x=>x,async()=>({status:'empty',message:''}),reason.agentPendingText,reason.agentAvailabilityNotice,{},Controller,Editor,{});
 const state={list:[{id:'retained',body:'Exact draft'}],open:'retained',draft:{body:'Unsaved exact draft'},storageStatus:status},before=structuredClone(state);
 class Shell{live=true;notesSourceMode='canonical';vget(){return state;}api(){return{toast:x=>toasts.push(x),set:patch=>{calls.push(patch);return true;},notesSourceOptions:[]};}}
 const shell=new Shell();if(ready)shell.canonicalNotesUi=new module.CanonicalNotesUi({},{paint(){},review(){}});
 // Alpha's Notes view (model.js) as it reaches the restored projection: the state it was given, and its New note.
 const views={notes:{render:(value)=>({storageStatus:value.storageStatus,list:value.list,none:!value.list?.length,canCreate:true,canRecord:true})}};module.installCanonicalNotesView(Shell,views);
 return{state,before,calls,toasts,render:()=>{const view=views.notes.render(shell.vget('notes'),shell.api('notes'));return{view,storageStatus:view.storageStatus,newNote:()=>shell.api('notes').set({compose:true})};}};
}
test('attempted New Note explains starting, disconnected or unavailable without a placeholder or draft mutation',()=>{
 for(const options of [{kind:'starting',resident:true},{kind:'recovering',resident:true},{kind:'cloud',resident:false}]){
  const f=notesFixture(options),view=f.render();if(options.kind==='starting')assert.equal(view.storageStatus,'','passive startup stays quiet');
  // Waiting for a connection: Alpha's Notes view without retained notes, New note or device recording.
  assert.deepEqual(view.view.list,[]);assert.equal(view.view.none,false);assert.equal(view.view.canCreate,false);assert.equal(view.view.canRecord,false);
  assert.equal(view.newNote(),false);assert.deepEqual(f.state,f.before);assert.deepEqual(f.calls,[]);assert.equal(f.toasts.length,1);assert.match(f.toasts[0],options.kind==='starting'?/starting/:options.kind==='recovering'?/connected/:/unavailable for this agent connection/);assert.doesNotMatch(f.toasts[0],/on.phone agent|runs on your phone/);
 }
});
test('a genuine Notes recovery error stays visible and is used by the attempted action',()=>{
 const f=notesFixture({status:'Review unsaved Notes recovery.'});const view=f.render();assert.equal(view.storageStatus,'Review unsaved Notes recovery.');view.newNote();assert.deepEqual(f.toasts,['Review unsaved Notes recovery.']);assert.deepEqual(f.state,f.before);assert.deepEqual(f.calls,[]);
});
test('an available private Mac canonical Notes binding keeps its normal create path',async()=>{
 const f=notesFixture({kind:'cloud',ready:true});f.render().newNote();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(f.calls,[{compose:false},'canonical-create:text']);assert.deepEqual(f.toasts,[]);assert.deepEqual(f.state,f.before);
});
test('actual Notes binding accepts the existing app-record port independently of phone-only session labels',async()=>{
 const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8'),a=adapter.indexOf('  function canonicalNotesKey('),b=adapter.indexOf('  async function previousNotesObservation(',a);assert(a>=0&&b>a);
 const bindCode=stripTypeScriptTypes(adapter.slice(a,b),{mode:'strip'}),port={identity:{ownerId:'mac-owner',agentId:'mac-agent',sessionId:'mac-session',origin:'http://localhost:5229'},sessionId:'mac-session',scope:'owner',current:()=>true};let selected=port,starts=0,bindings=0;
 class Binding{current=true;constructor(actual){assert.equal(actual,port);bindings++;}refresh(){starts++;return Promise.resolve();}retire(){}}
 const updates=[],sync=new Function('connectionController','CanonicalNotesUi','originalSet','context','window','agentAvailabilityNotice',bindCode+';return syncCanonicalNotes;')({getAppRecordClient:()=>selected},Binding,function(_key,patch){updates.push(patch);},()=>{}, {},pending({kind:'cloud'}).agentAvailabilityNotice);
 const shell={live:true,notesSourceMode:'canonical',setState(){}};sync(shell);await shell.notesReady;assert.equal(bindings,1);assert.equal(starts,1);assert.equal(shell.canonicalNotesUi.current,true);sync(shell);assert.equal(bindings,1);
 selected=null;sync(shell);await shell.notesReady;assert.match(updates.at(-1).storageStatus,/unavailable for this agent connection/);assert.equal(bindings,1);
});
test('Review event from an agent note goes through Calendar admission with its note link; refusal opens nothing',async()=>{
 const origin={version:2,noteId:'n1',revision:'c'.repeat(64)};
 for(const admitted of [true,false]){
  const toasts=[],opened=[],reviewed=[];
  class Controller{current=true;pending=false;revision=1;snapshot={notes:[],trash:[],revision:1};constructor(_port,hooks){this.hooks=hooks;}listen(){}refresh(){return Promise.resolve(this.snapshot);}hasViewNote(){return true;}viewNote(id){return {id,title:'Venue plan'};}retire(){this.current=false;}}
  class Editor{draft=null;constructor(_controller,hooks){this.hooks=hooks;}open(id){this.draft={id,token:'t',version:0,title:'Venue plan',body:''};this.hooks.changed();}close(){this.draft=null;}}
  const module=new Function('parseNoteFormat','projectNoteForModel','noteScheduleDraft','agentPendingText','agentAvailabilityNotice','DailyApps','CanonicalNotesController','CanonicalNotesEditor','window',code+';return {installCanonicalNotesView,CanonicalNotesUi};')(x=>x,x=>x,async()=>({status:'ready',draft:{title:'',notes:'Book the venue',origin}}),()=>'',()=>'',{},Controller,Editor,{});
  class Shell{live=true;notesSourceMode='canonical';vget(){return {};}reviewScannedCalendarDraft(draft){reviewed.push(draft);return admitted;}api(){return{toast:x=>toasts.push(x),isActive:()=>true,get:()=>({}),open:(...args)=>opened.push(args),set:()=>true,notesSourceOptions:[]};}}
  const shell=new Shell();shell.canonicalNotesUi=new module.CanonicalNotesUi({},{paint(){},review(){}});shell.canonicalNotesUi.editor.open('n1');
  const views={notes:{render:()=>({vo:{}})}};module.installCanonicalNotesView(Shell,views);
  views.notes.render({},shell.api('notes')).vo.toEvent();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(reviewed.length,1);assert.deepEqual(reviewed[0].origin,origin);assert.equal(reviewed[0].notes,'Book the venue');assert.equal(reviewed[0].alert,null);
  assert.deepEqual(opened,[],'Calendar admission opens Calendar itself');
  assert.match(toasts[0],admitted?/^Review the time, then Save\.$/:/can't open this event yet/);
 }
});
