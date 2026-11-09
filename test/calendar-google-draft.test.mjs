// Draft codecs for Google Calendar forms (synthetic forms only; no storage, Cloud or provider).
import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
// tsx resolves the edit codec's extensionless import of the form codec.
const {encodeCalendarForm,decodeCalendarForm}=await tsImport('../apps/app/src/runtime/calendar-form-draft.ts',import.meta.url);
const {encodeCalendarEdit,decodeCalendarEdit,snapshotCalendarEdit,calendarEditIdentity}=await tsImport('../apps/app/src/runtime/calendar-edit-draft.ts',import.meta.url);

const sourceId='google:72475cd0-e135-4c42-a9e2-fb5fe0820ada:owner%40example.test';
const now=new Date(2026,10,6,9);
const form={id:null,creationId:'0b0e7d1c-1111-4111-8111-111111111111',title:'Lunch',notes:'',where:'Cafe',off:1,t:12,d:1,video:false,who:[],cal:sourceId,repeat:'none',alert:null};

test('a new event on a Google calendar keeps its calendar through the creation draft',()=>{
 const restored=decodeCalendarForm(encodeCalendarForm(form,now),now).form;
 assert.equal(restored.cal,sourceId);assert.equal(restored.title,'Lunch');
 for(const cal of ['google:','google:conn','google: :x','google:conn:has space','google:conn:'+'x'.repeat(8192),'remote:x'])assert.throws(()=>encodeCalendarForm({...form,cal},now),/recovery/,cal);
 // Existing targets are unchanged.
 for(const cal of ['alpha-reminders','native:local'])assert.equal(decodeCalendarForm(encodeCalendarForm({...form,cal},now),now).form.cal,cal);
 assert.throws(()=>encodeCalendarForm({...form,cal:'native:'+'x'.repeat(300)},now),/recovery/,'device calendar ids keep their bound');
});

test('the edit codec preserves full-series scope and defaults old drafts to one occurrence',()=>{
 const base={revision:JSON.stringify(['evt_1','2026-11-07T20:00:00Z','2026-11-07T21:00:00Z','confirmed','Lunch','','Cafe',null]),begin:Date.parse('2026-11-07T20:00:00Z'),end:Date.parse('2026-11-07T21:00:00Z')};
 const edit={...form,creationId:undefined,id:sourceId+':evt_1',googleEventId:'evt_1',googleScope:'all',googleBase:base};
 const raw=encodeCalendarEdit(edit,now),restored=decodeCalendarEdit(raw,now).form;
 assert.equal(restored.googleScope,'all');
 assert.equal(JSON.parse(raw).target.kind,'google');
 // Scope defaults to this occurrence.
 assert.equal(decodeCalendarEdit(encodeCalendarEdit({...edit,googleScope:undefined},now),now).form.googleScope,'this');
 // Snapshot and identity carry the Google event.
 const snapshot=snapshotCalendarEdit(edit);assert.equal(snapshot.googleEventId,'evt_1');assert.deepEqual(snapshot.googleBase,base);
 assert.notEqual(calendarEditIdentity(edit),calendarEditIdentity({...edit,googleEventId:'evt_2'}));
 assert.notEqual(calendarEditIdentity(edit),calendarEditIdentity({...edit,googleBase:{...base,revision:'changed'}}));
 assert.equal(calendarEditIdentity({id:'native:1',expected:{revision:'r'}}),JSON.stringify(['native:1','r',null]),'other edits keep their identity');
});

test('malformed Google edit drafts need recovery',()=>{
 const base={revision:'r',begin:1000,end:2000};
 const edit={...form,creationId:undefined,id:sourceId+':evt_1',googleEventId:'evt_1',googleScope:'this',googleBase:base};
 for(const bad of [
  {googleScope:'following'},{googleBase:undefined},{googleBase:{...base,extra:1}},{googleBase:{...base,end:500}},{googleBase:{...base,revision:''}},
  {cal:'native:local'},{alphaCalendarId:'native:1',expected:{title:'',body:'',location:'',begin:1000,end:2000,revision:'r'}},{googleEventId:'x'.repeat(1025)},
 ])assert.throws(()=>encodeCalendarEdit({...edit,...bad},now),/recovery/,JSON.stringify(bad));
 const raw=JSON.parse(encodeCalendarEdit(edit,now));
 for(const target of [{...raw.target,sourceId:'google:other:x'},{...raw.target,extra:true},{...raw.target,kind:'calendar'}])assert.throws(()=>decodeCalendarEdit(JSON.stringify({...raw,target}),now),/recovery/);
});
