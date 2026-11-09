// The retained edit form keeps Google event edits like device-calendar edits (synthetic forms only;
// no storage, Cloud or provider).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {tsImport} from 'tsx/esm/api';
const codec=await tsImport('../apps/app/src/runtime/calendar-edit-draft.ts',import.meta.url);
const source=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/calendar-edit-draft-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});

const sourceId='google:72475cd0-e135-4c42-a9e2-fb5fe0820ada:owner%40example.test';
// The form the Google Calendar view opens for one event (google-calendar-view-adapter.ts `edit`).
const googleForm={id:`${sourceId}:event`,title:'Planning',off:0,t:12,d:1,where:'',video:false,who:[],cal:sourceId,repeat:'none',alert:null,notes:'Agenda',
  googleEventId:'event',googleScope:'this',googleBase:{revision:'["event"]',begin:Date.UTC(2026,10,6,12),end:Date.UTC(2026,10,6,13)}};

function harness(){
  const edits=[],consumed=[],toasts=[],state={form:null};
  class Controller{constructor(){this.state={message:'Saved on this phone',conflict:false,error:false,savedText:''};}open(){return Promise.resolve();}edit(text){edits.push(text);}retire(){}consume(text){consumed.push(text);return Promise.resolve();}}
  const ctx=vm.createContext({AssistantDraftController:Controller,assistantDraftStore:async()=>({}),Capacitor:{getPlatform:()=>'web'},openDomainRecovery(){},browserDevProfile:false,
    window:{confirm:()=>true},Intl,Date,JSON,...codec});
  vm.runInContext(source+'\nglobalThis.install=installCalendarEditDraftAdapter;',ctx);
  class Shell{live=true;vget(){return state;}vset(_key,patch){Object.assign(state,patch);}toast(text){toasts.push(text);}componentDidMount(){}componentDidUpdate(){}componentWillUnmount(){}}
  const views={calendar:{render:()=>({ev:{edit(){}}})}};
  ctx.install(Shell,views);const shell=new Shell();shell.componentDidMount();
  return {edits,consumed,toasts,state,shell,render:()=>views.calendar.render(state,{toast(){},set(){}})};
}

test('a Google event edit is retained with its event, scope and starting version',()=>{
  const h=harness();
  h.state.form=googleForm;h.shell.componentDidUpdate({});
  assert.equal(h.edits.length,1);
  const restored=codec.decodeCalendarEdit(h.edits[0]).form;
  assert.equal(restored.googleEventId,'event');assert.equal(restored.googleScope,'this');assert.equal(restored.cal,sourceId);
  assert.deepEqual(restored.googleBase,googleForm.googleBase);assert.equal(restored.title,'Planning');
  assert.equal(h.render().editDraftStatus,'Saved on this phone');
});

test('an existing-item form with no device, reminder or Google target is not retained',()=>{
  const h=harness();
  h.state.form={...googleForm,googleEventId:undefined,googleBase:undefined,cal:'work'};h.shell.componentDidUpdate({});
  assert.equal(h.edits.length,0);assert.equal(h.render().editDraftStatus,'');
});

test('saving a Google edit clears its retained form',async()=>{
  const h=harness();
  h.state.form=googleForm;h.shell.componentDidUpdate({});
  h.shell.calendarFormCommitted(googleForm);await Promise.resolve();
  assert.equal(h.consumed.length,1);assert.equal(h.consumed[0],h.edits[0]);assert.deepEqual(h.toasts,[]);
});

test('saving an edit of a Google event still waiting to be added never reports a retained-form error',async()=>{
  const h=harness();
  // google-calendar-view-adapter.ts `edit` for an unsent create: an id and a local create id, no Google event yet.
  const local={...googleForm,id:`${sourceId}:local:op1`,googleEventId:undefined,googleScope:undefined,googleBase:undefined,googleLocalId:'op1'};
  h.state.form=local;h.shell.componentDidUpdate({});assert.equal(h.edits.length,0);
  h.shell.calendarFormCommitted(local);await Promise.resolve();
  assert.equal(h.consumed.length,0);assert.deepEqual(h.toasts,[]);
});
