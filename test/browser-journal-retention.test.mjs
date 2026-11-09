import test from 'node:test';
import assert from 'node:assert/strict';
import {modules,resetDocuments} from './fixtures/browser-daily-stores.mjs';
const {BrowserCalendar,BrowserDaily,calendarDocument,reminderDocument}=modules;
const HOUR=3600000,start=Date.UTC(2030,0,1,9),hash='a'.repeat(64);
const read=async store=>JSON.parse(await store.readRaw());
const clock=t=>{const state={now:1000};t.mock.method(performance,'now',()=>state.now);return state;};

test('calendar keeps creating events after 1000 acknowledged creations',async()=>{
 resetDocuments();const calendar=new BrowserCalendar();
 for(let i=0;i<1001;i++){
  const creationId=crypto.randomUUID(),saved=await calendar.save({creationId,calendarId:'local',title:'Event '+i,begin:start+i*HOUR,end:start+i*HOUR+1800000});
  assert.equal(saved.status,'saved');assert.deepEqual(await calendar.acknowledgeCreation({creationId}),{status:'acknowledged'});
 }
 const data=await read(calendarDocument);assert.equal(data.events.length,1001);assert.equal(Object.keys(data.creations).length,201);
});

test('an oversized creation journal is pruned on the next save, but never an unacknowledged row',async()=>{
 const harness=resetDocuments(),calendar=new BrowserCalendar();
 await calendarDocument.edit(()=>({sourceRevision:'b'.repeat(64),events:[]}),data=>{data.creations={};for(let i=0;i<1200;i++)data.creations['old'+i]={binding:'x',result:{status:'saved',id:'e'+i,calendarId:'local',creationId:'old'+i},acknowledged:true};data.creations.open={binding:'x',result:{status:'saved',id:'open',calendarId:'local',creationId:'open'},acknowledged:false};});
 assert.equal((await calendar.save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'After',begin:start,end:start+HOUR})).status,'saved');
 const rows=Object.entries((await read(calendarDocument)).creations);
 assert.equal(rows.filter(([,row])=>row.acknowledged).length,200);assert.ok(rows.some(([id])=>id==='old1199'));assert.ok(!rows.some(([id])=>id==='old999'));
 assert.equal(rows.filter(([,row])=>!row.acknowledged).length,2);assert.ok(rows.some(([id])=>id==='open'));
 // Unacknowledged creations still refuse at the cap, and the refusal writes nothing.
 await calendarDocument.edit(()=>null,data=>{for(let i=0;i<998;i++)data.creations['pending'+i]={binding:'x',result:{status:'saved',id:'p'+i,calendarId:'local',creationId:'pending'+i},acknowledged:false};});
 const writes=harness.documents.writes;
 await assert.rejects(calendar.save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Refused',begin:start,end:start+HOUR}),/Calendar creation receipt storage full/);
 assert.equal(harness.documents.writes,writes);
});

test('501 agent calendar deletions all queue and settle; claims follow their kept deletions',async t=>{
 resetDocuments();const time=clock(t),calendar=new BrowserCalendar(),{sourceRevision}=await calendar.prepareAgentSource();
 await calendarDocument.edit(()=>null,data=>{for(let i=0;i<501;i++)data.events.push({id:'event-'+i,calendarId:'local',title:'Event '+i,body:'',location:'',begin:start+i*HOUR,end:start+i*HOUR+1800000,revision:String(i).padStart(64,'0'),timeZone:'UTC',repeat:'none'});});
 for(let i=0;i<501;i++){
  const response=await calendar.executeAgent({operationId:'delete-'+i,operation:{type:'calendar_delete',target:{sourceId:'local',sourceRevision,eventId:'event-'+i,revision:String(i).padStart(64,'0')}},journalIdentity:{scope:'scope',proposalId:'proposal-'+i}});
  assert.equal(response.status,'queued',`delete ${i}`);time.now+=10000;await calendar.settleDeletions();
 }
 const data=await read(calendarDocument);assert.equal(data.events.length,0);
 assert.ok(Object.keys(data.deleteClaims).length<=128);assert.deepEqual(Object.keys(data.deleteClaims).sort(),Object.keys(data.deletions).sort());
 // A replay of a recent deletion is still recognized.
 assert.deepEqual(await calendar.executeAgent({operationId:'delete-500',operation:{type:'calendar_delete',target:{sourceId:'local',sourceRevision,eventId:'event-500',revision:'0'.repeat(61)+'500'}},journalIdentity:{scope:'scope',proposalId:'proposal-500'}}),{status:'unknown'});
});

test('Calendar retention drops claims whose deletion is absent even when the key is inherited',async()=>{
 resetDocuments();const calendar=new BrowserCalendar(),{sourceRevision}=await calendar.prepareAgentSource();
 await calendarDocument.edit(()=>null,data=>{
  data.events.push({id:'reviewed',calendarId:'local',title:'Reviewed event',body:'',location:'',begin:start,end:start+HOUR,revision:hash,timeZone:'UTC',repeat:'none'});
  const terminal=Array.from({length:128},(_,i)=>{
   const id=i===0?'constructor':'previous-'+i;
   return [id,{id,phase:'deleted',deadline:{createdElapsed:i}}];
  });
  data.deletions=Object.fromEntries(terminal);
  data.deleteClaims=Object.fromEntries([['constructor','old'],['toString','dangling'],['__proto__','dangling'],['previous-127','kept']]);
 });
 const result=await calendar.executeAgent({operationId:'queued',operation:{type:'calendar_delete',target:{sourceId:'local',sourceRevision,eventId:'reviewed',revision:hash}},journalIdentity:{scope:'scope',proposalId:'proposal'}});
 assert.equal(result.status,'queued');
 const {deletions,deleteClaims}=await read(calendarDocument);
 assert.equal(Object.hasOwn(deletions,'constructor'),false);
 assert.deepEqual(Object.keys(deleteClaims),['previous-127','queued']);
});

test('reviewed Calendar and Reminder deletions persist an own entry for every admitted identity',async()=>{
 const {documents}=resetDocuments(),calendar=new BrowserCalendar(),daily=new BrowserDaily({}),id='__proto__';
 const saved=await calendar.save({creationId:crypto.randomUUID(),calendarId:'local',title:'Reviewed event',begin:start,end:start+HOUR});
 const {sourceRevision,events}=await read(calendarDocument),row=events.find(event=>event.id===saved.id);
 const request={operationId:id,operation:{type:'calendar_delete',target:{sourceId:'local',sourceRevision,eventId:row.id,revision:row.revision}},journalIdentity:{scope:'scope',proposalId:'proposal'}};
 assert.equal((await calendar.executeAgent(request)).status,'queued');
 const calendarData=await read(calendarDocument);
 assert.ok(Object.hasOwn(calendarData.deletions,id)&&Object.hasOwn(calendarData.deleteClaims,id));
 assert.equal((await calendar.deletionReceipt(id)).phase,'queued');
 const calendarWrites=documents.writes;
 assert.deepEqual(await calendar.executeAgent(request),{status:'unknown'});
 assert.equal(documents.writes,calendarWrites);

 await daily.scheduleReminder({id:'reviewed',title:'Reviewed reminder',at:Date.now()+86400000});
 const target=await daily.selectedReminder({id:'reviewed'}),stage=()=>daily.stageDeletion(target,'agent:test',id,'review-binding');
 assert.equal((await stage()).phase,'queued');
 const reminderData=await read(reminderDocument);
 assert.ok(Object.hasOwn(reminderData.deletions,id)&&Object.hasOwn(reminderData.deleteClaims,id));
 assert.equal(reminderData.reminders[0].pendingDeletion,id);
 assert.equal((await daily.deletionReceipt(id)).entry.phase,'queued');
 const reminderWrites=documents.writes;
 await assert.rejects(stage,/already used/);
 assert.equal(documents.writes,reminderWrites);
});

test('Calendar and Reminder journal receipts can bind prototype-shaped operation identities',async()=>{
 resetDocuments();const calendar=new BrowserCalendar(),daily=new BrowserDaily({}),{sourceRevision}=await calendar.prepareAgentSource();
 const calendarOp={type:'calendar_create',source:{sourceId:'local',sourceRevision},fields:{title:'Reviewed event',description:'',location:'',start:new Date(start).toISOString(),end:new Date(start+HOUR).toISOString(),timeZone:'UTC'}};
 await daily.scheduleReminder({id:'reviewed',title:'Reviewed reminder',at:Date.now()+86400000});
 for(const id of ['constructor','__proto__','toString']){
  const reminderOp={type:'reminder_update',target:await daily.selectedReminder({id:'reviewed'}),fields:{title:'Reviewed '+id,body:''}};
  const calendarRequest={operationId:id,operation:calendarOp},reminderRequest={operationId:id,bindingHash:hash,operation:reminderOp};
  const calendarResult=await calendar.executeAgent(calendarRequest),reminderResult=await daily.operateReminder(reminderRequest);
  assert.equal(calendarResult.status,'applied');assert.equal(reminderResult.status,'succeeded');
  assert.deepEqual(await calendar.executeAgent(calendarRequest),calendarResult);
  assert.deepEqual(await daily.reminderOperationReceipt(reminderRequest),reminderResult);
 }
 const keys=['constructor','__proto__','toString'];
 assert.deepEqual(Object.keys((await read(calendarDocument)).receipts),keys);
 assert.deepEqual(Object.keys((await read(reminderDocument)).receipts),keys);
});

test('Calendar cannot acknowledge an inherited creation receipt',async()=>{
 const {documents}=resetDocuments(),calendar=new BrowserCalendar(),creationId=crypto.randomUUID();
 await calendar.save({creationId,calendarId:'local',title:'Pending event',begin:start,end:start+HOUR});
 const before=await calendarDocument.readRaw(),writes=documents.writes;
 const property=Object.getOwnPropertyDescriptor(Object.prototype,'acknowledged');
 try{
  await assert.rejects(calendar.acknowledgeCreation({creationId:'__proto__'}),/Creation receipt unavailable/);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype,'acknowledged'),property);
  assert.equal(await calendarDocument.readRaw(),before);
  assert.equal(documents.writes,writes);
  assert.deepEqual(await calendar.acknowledgeCreation({creationId}),{status:'acknowledged'});
 }finally{
  if(property)Object.defineProperty(Object.prototype,'acknowledged',property);
  else delete Object.prototype.acknowledged;
 }
});

test('agent calendar receipts are bounded and next-event reads are not journaled',async()=>{
 const harness=resetDocuments(),calendar=new BrowserCalendar(),{sourceRevision}=await calendar.prepareAgentSource();
 for(let i=0;i<260;i++){
  const response=await calendar.executeAgent({operationId:'create-'+i,operation:{type:'calendar_create',source:{sourceId:'local',sourceRevision},fields:{title:'Agent '+i,description:'',location:'',start:new Date(start+i*HOUR).toISOString(),end:new Date(start+i*HOUR+1800000).toISOString(),timeZone:'UTC'}}});
  assert.equal(response.status,'applied');
 }
 assert.equal(Object.keys((await read(calendarDocument)).receipts).length,201);
 const writes=harness.documents.writes,next=await calendar.executeAgent({operationId:'next-1',operation:{type:'calendar_read_next'}});
 assert.equal(next.status,'applied');assert.equal(harness.documents.writes,writes);
});

test('reminders keep accepting agent work after 700 mixed operations, and reads write nothing',async()=>{
 const harness=resetDocuments(),daily=new BrowserDaily({}),at=Date.now()+86400000;
 await daily.scheduleReminder({id:'r1',title:'Water plants',at});
 for(let i=0;i<700;i++){
  const target=await daily.selectedReminder({id:'r1'}),reading=i%4===0,writes=harness.documents.writes;
  const operation=reading?{type:'reminder_read_selected',target}:{type:'reminder_update',target,fields:{title:'Water plants '+i,body:''}};
  assert.equal((await daily.operateReminder({operationId:'op-'+i,bindingHash:hash,operation})).status,'succeeded');
  if(reading)assert.equal(harness.documents.writes,writes);
 }
 const receipts=(await read(reminderDocument)).receipts;assert.ok(Object.keys(receipts).length<=201);assert.ok(!Object.keys(receipts).some(id=>Number(id.slice(3))%4===0));
 const create={type:'reminder_create',fields:{title:'New reminder',body:'',schedule:{at,dueAt:at,alertMinutes:null,recurrence:null}}};
 assert.equal((await daily.operateReminder({operationId:'create_1',bindingHash:hash,operation:create})).status,'succeeded');
});

test('an oversized reminder journal from before retention is pruned by the next create',async()=>{
 resetDocuments();const daily=new BrowserDaily({}),at=Date.now()+86400000;
 await reminderDocument.edit(()=>({sourceRevision:'c'.repeat(64),reminders:[]}),data=>{data.receipts={};data.deleteClaims={};for(let i=0;i<600;i++){data.receipts['old'+i]={binding:'x',result:{}};data.deleteClaims['claim'+i]='x';}});
 const create={type:'reminder_create',fields:{title:'After',body:'',schedule:{at,dueAt:at,alertMinutes:null,recurrence:null}}};
 assert.equal((await daily.operateReminder({operationId:'create_after',bindingHash:hash,operation:create})).status,'succeeded');
 assert.ok(Object.keys((await read(reminderDocument)).receipts).length<=201);
});

test('501 agent reminder deletions all stage; settle writes only when one has expired',async t=>{
 const harness=resetDocuments(),time=clock(t),daily=new BrowserDaily({}),at=Date.now()+86400000;
 for(let i=0;i<501;i++){
  await daily.scheduleReminder({id:'r'+i,title:'Reminder '+i,at});
  const target=await daily.selectedReminder({id:'r'+i});
  await daily.stageDeletion(target,'agent:test','delete-'+i,JSON.stringify([hash,i]));
  const writes=harness.documents.writes;await daily.settleDeletions();assert.equal(harness.documents.writes,writes,'no write inside the Undo window');
  time.now+=10000;await daily.settleDeletions();assert.equal(harness.documents.writes,writes+1);
 }
 const data=await read(reminderDocument);assert.ok(data.reminders.every(row=>row.status==='cancelled'));
 assert.deepEqual(Object.keys(data.deleteClaims).sort(),Object.keys(data.deletions).sort());assert.ok(Object.keys(data.deleteClaims).length<=128);
 const writes=harness.documents.writes;await daily.settleDeletions();assert.equal(harness.documents.writes,writes);
});
