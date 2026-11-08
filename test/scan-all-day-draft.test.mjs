import test from 'node:test';import assert from 'node:assert/strict';
const {suggestScanEventDetails,scanAllDayEventDraft,scanEventDraft}=await import('../apps/app/src/prototype/scan-event.ts');
test('an all-day scan suggestion becomes an all-day Calendar draft, never a save',()=>{
 const now=new Date(2026,9,3,15),suggested=suggestScanEventDetails('Book fair\nOctober 10, 2026\nVenue: Library',{now});
 assert.equal(suggested.allDay,true);
 const draft=scanAllDayEventDraft({title:suggested.fields.title,date:suggested.fields.date,location:suggested.fields.location},'Book fair text',now);
 assert.deepEqual({allDay:draft.allDay,off:draft.off,t:draft.t,d:draft.d,cal:draft.cal,where:draft.where,repeat:draft.repeat,alert:draft.alert},{allDay:true,off:7,t:0,d:24,cal:'native:local',where:'Library',repeat:'none',alert:null});
 assert.equal(scanAllDayEventDraft({title:'Fair',date:'2026-10-10',location:'',repeat:'weekly'},'',now).repeat,'weekly');
});
test('all-day scan drafts validate the date, text and repeat',()=>{
 const now=new Date(2026,9,3);
 for(const date of ['','2026-02-30','1969-12-31','10/10/2026'])assert.throws(()=>scanAllDayEventDraft({title:'Fair',date,location:''},'',now));
 assert.throws(()=>scanAllDayEventDraft({title:' ',date:'2026-10-10',location:''},'',now),/title/);
 assert.throws(()=>scanAllDayEventDraft({title:'Fair',date:'2026-10-10',location:'',repeat:'monthly'},'',now),/repeat/);
 assert.throws(()=>scanAllDayEventDraft({title:'Fair',date:'2026-10-10',location:''},'x'.repeat(16001),now),/16,000/);
});
test('scan drafts carry their own creationId, so Calendar retains the form under review and binds one Save',async()=>{
 const {encodeCalendarForm,decodeCalendarForm}=await import('../apps/app/src/runtime/calendar-form-draft.ts');
 const now=new Date(2026,9,3,15),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 const allDay=scanAllDayEventDraft({title:'Book fair',date:'2026-10-10',location:'Library'},'Book fair text',now);
 const timed=scanEventDraft({title:'Open studio',date:'2026-10-10',time:'18:30',minutes:90,location:'Main hall'},'Open studio text',now);
 for(const draft of [allDay,timed]){assert.match(draft.creationId,uuid);assert.equal(draft.separateCreation,false);assert.equal(draft.id,null);}
 assert.notEqual(allDay.creationId,timed.creationId);
 assert.notEqual(scanEventDraft({title:'Open studio',date:'2026-10-10',time:'18:30',minutes:90,location:''},'',now).creationId,timed.creationId,'every review is its own creation');
 // The retained-form codec keeps the reviewed fields, the creation identity and, for all-day, the all-day flag.
 for(const draft of [allDay,timed]){
  const restored=decodeCalendarForm(encodeCalendarForm(draft,now),now).form;
  assert.deepEqual({title:restored.title,where:restored.where,notes:restored.notes,off:restored.off,t:restored.t,d:restored.d,creationId:restored.creationId,separateCreation:restored.separateCreation,allDay:restored.allDay},{title:draft.title,where:draft.where,notes:draft.notes,off:draft.off,t:draft.t,d:draft.d,creationId:draft.creationId,separateCreation:false,allDay:draft.allDay});
 }
 assert.equal('allDay' in decodeCalendarForm(encodeCalendarForm({...timed,allDay:false},now),now).form,false,'a form toggled off all-day is stored as timed');
});
