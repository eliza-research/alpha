import {test} from 'node:test';
import assert from 'node:assert/strict';
const {calendarAgentReviewText}=await import('../apps/app/src/browser/calendar-agent-review.ts');
const source={name:'App calendar',account:'Alpha Phone'};
const fields={title:'Venue booking call',description:'From the venue meeting note',location:'Main hall',start:'2026-10-12T05:00:00.000Z',end:'2026-10-12T06:00:00.000Z',timeZone:'Asia/Tokyo'};

test('a create review names the calendar, account, zone, all-day state and attendees, in the event zone', () => {
  assert.deepEqual(calendarAgentReviewText('calendar_create',fields,source,undefined,'America/New_York').split('\n'),[
    'Create event',
    '“Venue booking call”',
    'App calendar · Alpha Phone',
    'October 12, 2026 at 2:00 PM GMT+9 – October 12, 2026 at 3:00 PM GMT+9',
    'Time zone: Asia/Tokyo (this phone is set to America/New_York)',
    'No invites sent',
    'Location: Main hall',
    'From the venue meeting note',
  ]);
});
test('the device zone is not repeated when it is the event zone, and empty optional lines are omitted', () => {
  const lines=calendarAgentReviewText('calendar_create',{...fields,location:' ',description:''},source,undefined,'Asia/Tokyo').split('\n');
  assert.equal(lines[4],'Time zone: Asia/Tokyo');assert.equal(lines.length,6);
});
test('an update says existing attendees are kept and that an all-day event stays all day', () => {
  const timed=calendarAgentReviewText('calendar_update',fields,source,{who:['a','b']},'Asia/Tokyo');
  assert.match(timed,/^Update event\n/);
  assert.match(timed,/2 people · no invites sent/);
  const allDay=calendarAgentReviewText('calendar_update',{...fields,start:'2026-10-12T00:00:00.000Z',end:'2026-10-14T00:00:00.000Z'},source,{allDay:true,who:['a'],seriesId:'s'},'Asia/Tokyo').split('\n');
  assert.equal(allDay[0],'Update event · This occurrence only');
  assert.equal(allDay[3],'October 12, 2026 – October 13, 2026');
  assert.equal(allDay[4],'All day');
  assert.match(allDay[5],/^1 person · no invites sent$/);
  assert.equal(calendarAgentReviewText('calendar_update',{...fields,start:'2026-10-12T00:00:00.000Z',end:'2026-10-13T00:00:00.000Z'},source,{allDay:true}).split('\n')[3],'October 12, 2026');
});
test('delete and share reviews state what happens to attendees', () => {
  assert.match(calendarAgentReviewText('calendar_delete',fields,source,{who:['a']}),/^Delete event\n[\s\S]*1 person · no cancellation sent/);
  assert.match(calendarAgentReviewText('calendar_read_selected',fields,source,{who:['a','b','c']}),/^Share with agent\n[\s\S]*3 people · names not shared/);
  assert.match(calendarAgentReviewText('calendar_delete',fields,source,{}),/Attendees: none\.$/m);
});
test('times on both sides of a daylight-saving change are shown in the event zone with its offset at each instant', () => {
  // America/New_York leaves daylight time at 06:00Z on 2026-11-01: 01:30 happens twice.
  const lines=calendarAgentReviewText('calendar_create',{...fields,start:'2026-11-01T05:30:00.000Z',end:'2026-11-01T06:30:00.000Z',timeZone:'America/New_York'},source,undefined,'Asia/Tokyo').split('\n');
  assert.equal(lines[3],'November 1, 2026 at 1:30 AM EDT – November 1, 2026 at 1:30 AM EST');
  assert.equal(lines[4],'Time zone: America/New_York (this phone is set to Asia/Tokyo)');
  // Europe/Paris enters summer time at 01:00Z on 2026-03-29: 02:30 local does not exist.
  const spring=calendarAgentReviewText('calendar_update',{...fields,start:'2026-03-29T00:30:00.000Z',end:'2026-03-29T01:30:00.000Z',timeZone:'Europe/Paris'},source,{},'Europe/Paris').split('\n');
  assert.equal(spring[3],'March 29, 2026 at 1:30 AM GMT+1 – March 29, 2026 at 3:30 AM GMT+2');
  // The same instants shown for a phone in another zone are the same line: the device zone never moves them.
  assert.equal(calendarAgentReviewText('calendar_update',{...fields,start:'2026-03-29T00:30:00.000Z',end:'2026-03-29T01:30:00.000Z',timeZone:'Europe/Paris'},source,{},'Pacific/Kiritimati').split('\n')[3],spring[3]);
});
test('an all-day event is shown as its stored dates whatever the phone zone or the proposal zone', () => {
  const dates={start:'2026-12-31T00:00:00.000Z',end:'2027-01-02T00:00:00.000Z'};
  for(const [zone,device] of [['Pacific/Kiritimati','Pacific/Pago_Pago'],['Pacific/Pago_Pago','Pacific/Kiritimati'],['UTC','America/New_York']]){
    const lines=calendarAgentReviewText('calendar_update',{...fields,...dates,timeZone:zone},source,{allDay:true},device).split('\n');
    assert.equal(lines[3],'December 31, 2026 – January 1, 2027');
    assert.equal(lines.some(line=>line.startsWith('Time zone:')),false);
  }
});
test('only whole UTC dates can update an all-day event', async () => {
  const {wholeUtcDates}=await import('../apps/app/src/browser/calendar-agent-review.ts');
  assert.equal(wholeUtcDates({start:'2026-10-12T00:00:00.000Z',end:'2026-10-13T00:00:00.000Z'}),true);
  assert.equal(wholeUtcDates({start:'2026-10-12T15:00:00.000Z',end:'2026-10-13T15:00:00.000Z'}),false);
  assert.equal(wholeUtcDates({start:'2026-10-12T00:00:00.000Z',end:'2026-10-12T23:59:59.999Z'}),false);
});
