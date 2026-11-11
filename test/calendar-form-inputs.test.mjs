import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
const bundle=buildSync({stdin:{resolveDir:process.cwd(),contents:"export * from './apps/app/src/prototype/calendar-form-inputs';export * from './apps/app/src/runtime/calendar-form-draft';export * from './apps/app/src/runtime/canonical-calendar-draft';export {calendarIntervalDetail} from './apps/app/src/prototype/calendar-interval-presentation';"},bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {calendarFormInputs:inputs,calendarFormInputPatch:patch,calendarDefaultEventStart:defaultStart,calendarGuestEmail:email,encodeCalendarForm,decodeCalendarForm,encodeCanonicalCalendarDraft,decodeCanonicalCalendarDraft,calendarIntervalDetail}=module.exports;
test('direct civil dates and exact minutes round-trip across months and multi-day ends',()=>{
 const now=new Date(2027,5,10,12,0,0),form={off:0,t:13,d:1};
 Object.assign(form,patch(form,'date','2028-02-29',now),patch(form,'startTime','23:17',now));
 assert.deepEqual(inputs(form,now),{date:'2028-02-29',startTime:'23:17',endDate:'2028-03-01',endTime:'00:17'});
 Object.assign(form,patch(form,'endDate','2028-03-02',now));Object.assign(form,patch(form,'endTime','04:23',now));
 assert.equal(Math.round(form.d*60),1746);assert.equal(inputs(form,now).endDate,'2028-03-02');
 for(const [kind,value] of [['date','2027-02-29'],['date','2027-13-01'],['startTime','24:00'],['endDate','2028-02-28']])assert.throws(()=>patch(form,kind,value,now));
});
test('today defaults to the next full hour and midnight moves to tomorrow',()=>{
 assert.deepEqual(defaultStart(0,new Date(2027,5,10,12,0)),{off:0,t:13});
 assert.deepEqual(defaultStart(0,new Date(2027,5,10,23,59)),{off:1,t:0});
 assert.deepEqual(defaultStart(30,new Date(2027,5,10,23,59)),{off:30,t:10});
});
test('typed guest addresses remain literal draft values',()=>{
 assert.equal(email(' New.Guest@example.org '),'New.Guest@example.org');
 for(const value of ['Name <guest@example.org>','first@example.org,second@example.org','guest\n@example.org','@example.org','guest@',null])assert.equal(email(value),null);
});
test('long canonical drafts retain exact wall minutes and whether the owner reviewed guests',()=>{
 const form={id:null,canonicalOwnerKey:'owner',creationId:'draft',title:'Long event',notes:'',where:'',off:0,t:23+17/60,d:200+6/60,zone:'UTC',who:['guest@example.org'],canonicalGuestsReviewed:true,video:false,repeat:'none',alert:null,cal:'agent:'+'a'.repeat(64)};
 assert.equal(Math.round(decodeCalendarForm(encodeCalendarForm(form)).form.d*60),12006);
 const raw=encodeCanonicalCalendarDraft(form),read=decodeCanonicalCalendarDraft(raw);assert.equal(read.form.canonicalGuestsReviewed,true);assert.deepEqual(read.form.who,['guest@example.org']);
 const legacy=JSON.parse(raw);delete legacy.guestsReviewed;assert.equal(decodeCanonicalCalendarDraft(JSON.stringify(legacy)).form.canonicalGuestsReviewed,false);
});
test('detail range uses actual dates and labels a changed UTC offset',()=>{
 const prior=process.env.TZ;process.env.TZ='America/New_York';try{
  const detail=calendarIntervalDetail(Date.parse('2027-03-14T06:30Z'),Date.parse('2027-03-14T07:30Z'));
  assert.match(detail.when,/UTC-05:00.*UTC-04:00/);
  const overnight=calendarIntervalDetail(Date.parse('2027-06-11T03:17Z'),Date.parse('2027-06-12T08:23Z'));assert.match(overnight.day,/Jun.*10.*Jun.*12/);
 }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
