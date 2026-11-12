import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export * from './apps/app/src/runtime/automations-protocol.ts'; export {workflowLocalInstant} from './apps/app/src/runtime/workflow-local-time.ts'; export {setLocalePreferences} from './apps/app/src/prototype/locale-time.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
const {automationWhen,AutomationsProtocol,workflowLocalInstant,workflowSnoozeTime,setLocalePreferences}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('automationWhen renders the device-local instant consistently across saved source zones',()=>{
 setLocalePreferences({locale:'en-US',hourCycle:'h12'});
 try{
  const local=new Date(2026,9,29,18),stamp=local.toISOString();
  // The glue between date and time depends on the runtime's CLDR revision (Bun uses the system ICU).
  const expected=/^Oct 29, 2026(?:,| at) 6:00 PM$/;
  for(const zone of ['UTC','America/New_York','Asia/Tokyo','Not/AZone',undefined])assert.match(automationWhen(stamp,zone,'en-US'),expected);
  assert.match(automationWhen(local.getTime(),'Asia/Tokyo','en-US'),expected);
  assert.equal(automationWhen('not a date'),'');assert.equal(automationWhen(Number.NaN),'');
 }finally{setLocalePreferences({});}
});

for(const hourCycle of ['h23','h12'])test(`workflow instants and snoozes honor the device ${hourCycle} choice rather than the locale default`,()=>{
 const locale=hourCycle==='h23'?'en-US':'en-GB',date=new Date(2026,9,7,15,4),now=new Date(2026,9,7,9).getTime();
 setLocalePreferences({locale,hourCycle});
 try{
  const time=hourCycle==='h23'?'15:04':'3:04 pm';
  const expected=hourCycle==='h23'?/^Oct 7, 2026(?:,| at) 15:04$/:/^7 Oct 2026(?:,| at) 3:04 pm$/;
  assert.match(workflowLocalInstant(date.getTime(),'fr-FR'),expected);
  assert.equal(workflowSnoozeTime(date.getTime(),now),time);
  assert.notEqual(workflowSnoozeTime(date.getTime(),now),date.toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'}),'vanilla Intl cannot see Android\'s hour-cycle override');
  const tomorrow=new Date(2026,9,8,15,4),nextYear=new Date(2027,9,8,15,4);
  assert.equal(workflowSnoozeTime(tomorrow.getTime(),now),(hourCycle==='h23'?'Oct 8':'8 Oct')+', '+time);
  assert.equal(workflowSnoozeTime(nextYear.getTime(),now),(hourCycle==='h23'?'Oct 8, 2027':'8 Oct 2027')+', '+time);
  assert.equal(workflowSnoozeTime('invalid',now),'');
 }finally{setLocalePreferences({});}
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
