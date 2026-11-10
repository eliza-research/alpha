import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {workflowCronLabel,workflowClockSchedule,workflowClockExpression} from '../apps/app/src/runtime/workflow-local-time.ts';

const bundle=await build({entryPoints:['apps/app/src/runtime/automations-protocol.ts'],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
const {automationWhen,AutomationsProtocol}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('automationWhen uses device-local time regardless of stored zone metadata',()=>{
 const before=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try{
  for(const zone of ['UTC','America/New_York','Asia/Tokyo','Not/AZone',undefined])assert.equal(automationWhen('2026-10-29T18:00:00Z',zone,'en-US'),'Oct 29, 2026, 11:00 AM');
  assert.equal(automationWhen('not a date'),'');assert.equal(automationWhen(Number.NaN),'');
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('once prompts and agent reminders share the human instant format instead of the raw locale dump',async()=>{
 const once={id:'trigger:once',type:'coordinator_text',title:'Call mom',description:'',enabled:true,status:'active',triggerId:'once',schedules:[{triggerType:'once',scheduledAtIso:'2026-10-29T18:00:00Z',timezone:'UTC'}]};
 const reminder={definition:{id:'draft',title:'Check the draft',status:'active',timezone:'UTC',cadence:{kind:'once',dueAt:'2030-01-01T12:00:00Z'}},occurrence:{id:'occurrence',state:'pending',dueAt:'2030-01-01T12:00:00Z'},latestAttempt:null};
 const client=new AutomationsProtocol(async path=>path==='/api/automations'?{automations:[once]}:path==='/api/lifeops/reminders'?{reminders:[reminder]}:{tasks:[]});
 const rows=(await client.list(new AbortController().signal)).rows;
 assert.equal(rows.find(row=>row.kind==='prompt').schedule,automationWhen('2026-10-29T18:00:00Z','UTC'));
 assert.equal(rows.find(row=>row.kind==='reminder').schedule,automationWhen('2030-01-01T12:00:00Z','UTC'));
 for(const row of rows)assert.doesNotMatch(row.schedule,/:\d{2}:\d{2}/,row.kind);
});

test('foreign recurring clocks show their actual next local instant across daylight saving',()=>{
 const before=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try{
  assert.equal(workflowCronLabel('0 8 * * *','America/Los_Angeles'),'Every day at 8am');
  assert.equal(workflowCronLabel('0 8 * * *','owner_local'),'Every day at 8am');
  for(const [now,expected] of [['2026-01-15T07:00:00Z','Jan 15, 2026, 12:00 AM'],['2026-07-15T07:00:00Z','Jul 15, 2026, 1:00 AM']])assert.equal(workflowCronLabel('0 8 * * *','UTC',Date.parse(now)),'Next '+expected);
  assert.equal(workflowCronLabel('0 8 * * *','Invalid/Zone'),'Scheduled time unavailable');
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

// These values cross the existing scheduler boundary. Unsupported schedules must stay intact.
test('weekly clock editing preserves chosen days and rejects non-weekly schedules',()=>{
 for(const [cron,time,days] of [['0 0 * * *','00:00',[0,1,2,3,4,5,6]],['45 12 * * 1,3,5','12:45',[1,3,5]],['5 23 * * 0,6','23:05',[0,6]],['0 8 * * 1-5','08:00',[1,2,3,4,5]]]){
  assert.deepEqual(workflowClockSchedule(cron),{time,days});
  assert.deepEqual(workflowClockSchedule(workflowClockExpression(time,days)),{time,days});
 }
 for(const cron of ['0 8 1 * *','*/5 8 * * *','0 8 * 12 *','0 25 * * *','0 8 * * 7'])assert.equal(workflowClockSchedule(cron),null);
 assert.throws(()=>workflowClockExpression('08:00',[]));
 assert.throws(()=>workflowClockExpression('24:00',[1]));
 const before=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try{assert.equal(workflowCronLabel('45 12 * * 1,3,5','America/Los_Angeles'),'Mon, Wed, Fri at 12:45pm');}finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});
