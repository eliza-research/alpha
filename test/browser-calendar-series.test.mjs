import test from 'node:test';
import assert from 'node:assert/strict';
import {modules,resetDocuments} from './fixtures/browser-daily-stores.mjs';
const {BrowserCalendar,calendarDocument,syncRecurrence}=modules;
const HOUR=3600000,DAY=86400000,start=Date.UTC(2030,0,7,9);
const read=async()=>JSON.parse(await calendarDocument.readRaw());
const clock=t=>{const state={now:1000};t.mock.method(performance,'now',()=>state.now);return state;};
async function weekly(calendar){
 const creationId=crypto.randomUUID();await calendar.save({creationId,calendarId:'local',title:'Weekly review',begin:start,end:start+HOUR,repeat:'weekly',timeZone:'UTC'});await calendar.acknowledgeCreation({creationId});
 return (await calendar.list({begin:start,end:start+5*7*DAY})).events;
}
const expected=row=>({title:row.title,body:row.body,location:row.location,begin:row.begin,end:row.end});
const remove=(calendar,row)=>calendar.remove({id:row.id,calendarId:'local',expected:expected(row),revision:row.revision});

test('two occurrence deletions in one series both settle, whichever expires first',async t=>{
 resetDocuments();const time=clock(t),calendar=new BrowserCalendar(),[,first,second,third,fourth]=await weekly(calendar);
 assert.equal((await remove(calendar,first)).status,'queued');time.now+=3000;
 assert.equal((await remove(calendar,second)).status,'queued');
 // The first expires while the second is still in its Undo window.
 time.now+=7000;await calendar.settleDeletions();
 assert.deepEqual((await calendar.pendingDeletions()).map(entry=>entry.target.row.id),[second.id]);
 time.now+=3000;await calendar.settleDeletions();
 // Two more expire together and settle in one pass.
 const [current3,current4]=(await calendar.list({begin:third.begin,end:fourth.end})).events;
 await remove(calendar,current3);await remove(calendar,current4);time.now+=10000;await calendar.settleDeletions();
 const data=await read();
 assert.deepEqual(Object.values(data.deletions).map(entry=>entry.phase),['deleted','deleted','deleted','deleted']);
 assert.deepEqual([...data.events[0].excluded].sort(),[first.begin,second.begin,third.begin,fourth.begin].sort());
 assert.deepEqual((await calendar.list({begin:start,end:start+5*7*DAY})).events.map(row=>row.begin),[start]);
});

test('a pending occurrence deletion still blocks a real change to that date',async t=>{
 resetDocuments();clock(t);const calendar=new BrowserCalendar(),[,first]=await weekly(calendar);
 await remove(calendar,first);const series=(await read()).events[0];
 await assert.rejects(calendarDocument.edit(()=>null,data=>{data.events[0].title='Renamed series';}),/pending deletion/);
 assert.equal((await read()).events[0].title,series.title);
});

test('a weekly series changed to Once keeps its edited date as its own event and syncs',async t=>{
 const harness=resetDocuments(),time=clock(t),calendar=new BrowserCalendar(),[,first,second]=await weekly(calendar);
 const edited=await calendar.save({id:first.id,calendarId:'local',title:'Moved review',begin:first.begin+HOUR,end:first.end+HOUR,expected:expected(first)});
 assert.equal(edited.status,'saved');
 const current=(await calendar.list({begin:second.begin,end:second.end})).events.find(row=>row.id===second.id);
 await remove(calendar,current);time.now+=10000;await calendar.settleDeletions();
 const before=await read(),series=before.events.find(row=>!row.seriesId);assert.equal(series.excluded.length,1);
 harness.next=row=>({title:row.title,body:row.body,location:row.location,begin:row.begin,end:row.end,timeZone:row.timeZone,repeat:'none'});
 await calendar.edit({id:series.id,revision:series.revision});
 const after=await read(),once=after.events.find(row=>row.id===series.id),moved=after.events.find(row=>row.id!==series.id);
 assert.equal(once.repeat,'none');assert.equal(once.excluded,undefined);
 assert.equal(moved.title,'Moved review');assert.equal(moved.seriesId,undefined);assert.equal(moved.occurrenceBegin,undefined);
 assert.deepEqual((await calendar.list({begin:start,end:start+5*7*DAY})).events.map(row=>row.title),['Weekly review','Moved review']);
 assert.deepEqual(syncRecurrence(once),[]);assert.deepEqual(syncRecurrence(moved),[]);
 // Older documents may still hold deleted dates on an event that no longer repeats.
 assert.deepEqual(syncRecurrence({...once,excluded:[second.begin]}),[]);
});
