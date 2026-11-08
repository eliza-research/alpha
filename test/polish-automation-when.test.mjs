import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['apps/app/src/runtime/automations-protocol.ts'],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
const {automationWhen,AutomationsProtocol}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const options={year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'};
const expected=(stamp,zone)=>new Date(stamp).toLocaleString(undefined,{...options,...(zone?{timeZone:zone}:{})});
// The literal shape ("Oct 29, 2026, 6:00 PM") only holds under an English ICU locale; the equality and no-seconds checks hold everywhere.
const human=/^en\b/.test(Intl.DateTimeFormat().resolvedOptions().locale)?/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}(?: [AP]M)?$/:/^(?!.*:\d{2}:\d{2}).+$/;

test('automationWhen renders a short month, no seconds, in the named zone, and ignores a zone it cannot use',()=>{
 assert.match(automationWhen('2026-10-29T18:00:00Z','UTC'),human);
 assert.equal(automationWhen('2026-10-29T18:00:00Z','UTC'),expected('2026-10-29T18:00:00Z','UTC'));
 assert.equal(automationWhen('2026-10-29T18:00:00Z','Not/AZone'),expected('2026-10-29T18:00:00Z'));
 assert.equal(automationWhen(Date.parse('2026-10-29T18:00:00Z')),expected('2026-10-29T18:00:00Z'));
 assert.equal(automationWhen('not a date'),'');
 assert.equal(automationWhen(Number.NaN),'');
});

test('once prompts and agent reminders share the human instant format instead of the raw locale dump',async()=>{
 const once={id:'trigger:once',type:'coordinator_text',title:'Call mom',description:'',enabled:true,status:'active',triggerId:'once',schedules:[{triggerType:'once',scheduledAtIso:'2026-10-29T18:00:00Z',timezone:'UTC'}]};
 const reminder={definition:{id:'draft',title:'Check the draft',status:'active',timezone:'UTC',cadence:{kind:'once',dueAt:'2030-01-01T12:00:00Z'}},occurrence:{id:'occurrence',state:'pending',dueAt:'2030-01-01T12:00:00Z'},latestAttempt:null};
 const client=new AutomationsProtocol(async path=>path==='/api/automations'?{automations:[once]}:path==='/api/lifeops/reminders'?{reminders:[reminder]}:{tasks:[]});
 const rows=(await client.list(new AbortController().signal)).rows;
 for(const kind of ['prompt','reminder']){const row=rows.find(row=>row.kind===kind);assert.ok(row,kind);assert.match(row.schedule,human,kind);assert.doesNotMatch(row.schedule,/:\d{2}:\d{2}/,kind);}
 assert.equal(rows.find(row=>row.kind==='prompt').schedule,expected('2026-10-29T18:00:00Z','UTC'));
 assert.equal(rows.find(row=>row.kind==='reminder').schedule,expected('2030-01-01T12:00:00Z','UTC'));
});
