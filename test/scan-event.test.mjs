import test from 'node:test';import assert from 'node:assert/strict';
// J01 poster inference rules are the shared plugin-files documents/scan-event module and its tests
// cover every rule. Alpha keeps only the mapping of a reviewed proposal onto its local Calendar form.
const alpha=await import('../apps/app/src/prototype/scan-event.ts');
const shared=await import('../.eliza/client-features/plugins/plugin-files/src/documents/scan-event.ts');
const {suggestScanEventDetails,scanEventDraft,scanAllDayEventDraft}=alpha;
test('Alpha uses the shared poster suggestion rules, not a copy',()=>{
 assert.equal(alpha.suggestScanEvent,shared.suggestScanEvent);
 assert.equal(alpha.suggestScanEventDetails,shared.suggestScanEventDetails);
 assert.deepEqual(alpha.suggestScanEvent('Open studio\n2026-10-10\n18:30\nMain hall'),{title:'Open studio',date:'2026-10-10',time:'18:30',minutes:60,location:''});
});
test('reviewed draft keeps civil date across month/year boundaries without writing an event',()=>{
 const draft=scanEventDraft({title:' Reviewed event ',date:'2027-01-02',time:'23:45',minutes:90,location:' Hall '},'Exact reviewed OCR text',new Date(2026,11,31,12));
 assert.equal(draft.off,2);assert.equal(draft.t,23.75);assert.equal(draft.d,1.5);assert.equal(draft.title,'Reviewed event');assert.equal(draft.notes,'Exact reviewed OCR text');assert.equal(draft.where,'Hall');assert.equal(draft.cal,'native:local');assert.equal(draft.id,null);
 assert.equal('allDay' in draft,false,'a timed draft carries no all-day flag');
});
test('invalid dates, missing times and durations cannot become calendar drafts',()=>{
 assert.throws(()=>scanEventDraft({title:'Event',date:'2026-10-10',time:'18:30',minutes:60,location:''},'x'.repeat(16001)),/16,000/);
 const valid={title:'Event',date:'2026-10-10',time:'18:30',minutes:60,location:''};
 for(const patch of [{title:''},{date:'2026-02-30'},{date:'2026-13-01'},{date:'1969-12-31'},{date:''},{time:'24:00'},{time:''},{minutes:0},{minutes:15.5},{minutes:1441}])assert.throws(()=>scanEventDraft({...valid,...patch},'text'));
});
test('a scan draft never saves an all-day event silently and repeats only when confirmed',()=>{
 const now=new Date(2026,9,3);
 assert.equal(suggestScanEventDetails('Book fair\nOctober 10, 2026\nVenue: Library',{now:new Date('2026-10-03T15:00:00Z'),timeZone:'America/New_York'}).allDay,true);
 assert.throws(()=>scanEventDraft({title:'Book fair',date:'2026-10-10',time:'',minutes:60,location:'',allDay:true},'text',now),/need a start time/);
 const fields={title:'Yoga',date:'2026-10-06',time:'18:00',minutes:60,location:''};
 assert.equal(scanEventDraft(fields,'text',now).repeat,'none');assert.equal(scanEventDraft({...fields,repeat:'weekly'},'text',now).repeat,'weekly');
 assert.throws(()=>scanEventDraft({...fields,repeat:'monthly'},'text'));
 const allDay=scanAllDayEventDraft({title:'Fair',date:'2026-10-10',location:''},'',now);
 assert.deepEqual({allDay:allDay.allDay,t:allDay.t,d:allDay.d,off:allDay.off},{allDay:true,t:0,d:24,off:7});
});
