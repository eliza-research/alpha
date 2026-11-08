import test from 'node:test';
import assert from 'node:assert/strict';
import {expandCalendarSeries as expand} from '../apps/app/src/browser/calendar-recurrence.ts';
const iso=n=>new Date(n).toISOString();
test('daily Calendar recurrence keeps its saved zone across spring gaps and autumn overlaps',()=>{
 const run=(start,until)=>expand({id:'series',title:'Private title',begin:Date.parse(start),end:Date.parse(start)+3600000,timeZone:'America/New_York',repeat:'daily'},{begin:Date.parse(start),end:Date.parse(until)}).events;
 const spring=run('2027-03-13T07:30:00Z','2027-03-16T00:00:00Z'),autumn=run('2026-10-31T05:30:00Z','2026-11-03T00:00:00Z');
 assert.deepEqual(spring.map(r=>iso(r.begin)),['2027-03-13T07:30:00.000Z','2027-03-14T07:30:00.000Z','2027-03-15T06:30:00.000Z']);
 assert.deepEqual(autumn.map(r=>iso(r.begin)),['2026-10-31T05:30:00.000Z','2026-11-01T05:30:00.000Z','2026-11-02T06:30:00.000Z']);
 assert.ok(spring.every(r=>r.end-r.begin===3600000));
 assert.equal(new Set(spring.map(r=>r.id)).size,3);
});
test('weekday, weekly, all-day and overlapping multi-day occurrences have exact range semantics',()=>{
 const start=Date.parse('2027-01-01T00:00:00Z'),row={id:'x',begin:start,end:start+2*86400000,allDay:true,timeZone:'Pacific/Auckland'};
 const [weekdays,weekly,daily]=['weekdays','weekly','daily'].map(repeat=>expand({...row,repeat},{begin:Date.parse('2027-01-02T00:00:00Z'),end:Date.parse('2027-01-09T00:00:00Z')}).events.map(r=>iso(r.begin).slice(0,10)));
 assert.deepEqual(weekdays,['2027-01-01','2027-01-04','2027-01-05','2027-01-06','2027-01-07','2027-01-08']);
 assert.deepEqual(weekly,['2027-01-01','2027-01-08']);
 assert.equal(daily.length,8);
});
test('old series seek to the requested range, report truncation and leave storage untouched',()=>{
 const row={id:'old',begin:Date.parse('2000-01-01T12:00:00Z'),end:Date.parse('2000-01-01T13:00:00Z'),repeat:'daily',timeZone:'UTC'},before=JSON.stringify(row);
 const result=expand(row,{begin:Date.parse('2040-01-01T00:00:00Z'),end:Date.parse('2040-02-01T00:00:00Z')},3);
 assert.equal(result.events.length,3);assert.equal(result.truncated,true);assert.equal(JSON.stringify(row),before);
 assert.equal(iso(result.events[0].begin),'2040-01-01T12:00:00.000Z');
});
test('half-hour transitions and quarter-hour zones retain the requested civil clock',()=>{
 const [lordHowe,kathmandu]=[['Australia/Lord_Howe','2026-10-02T15:45:00Z'],['Asia/Kathmandu','2026-10-03T03:15:00Z']].map(([timeZone,start])=>{const begin=Date.parse(start);return expand({id:'z',begin,end:begin+3600000,repeat:'daily',timeZone},{begin,end:begin+3*86400000}).events.map(r=>iso(r.begin));});
 assert.deepEqual(lordHowe.slice(0,3),['2026-10-02T15:45:00.000Z','2026-10-03T15:45:00.000Z','2026-10-04T15:15:00.000Z']);
 assert.deepEqual(kathmandu.slice(0,3),['2026-10-03T03:15:00.000Z','2026-10-04T03:15:00.000Z','2026-10-05T03:15:00.000Z']);
});
