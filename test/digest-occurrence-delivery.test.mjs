import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
// MVP-38 at the source level: one retained record and one delivery per digest occurrence across
// reconnect, a lost acknowledgement, an interrupted notice and a restart, and an honest presentation
// of an occurrence the agent recorded without running it. This drives the app's own inbox and
// presentation code against a synthetic result stream. It is not resident-runtime, emulator or
// device evidence.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8',timeout:scaledTimeout(120_000)}));
const prelude=`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const row=(cursor,runId,status,scheduledAt,extra={})=>({cursor,runId,workflowId:'loop-'+(extra.loop||'morning'),workflowVersionId:'v1',templateVersion:'t1',scheduledAt,source:{id:'s-'+(extra.loop||'morning'),revision:'r1',observedAt:'2026-10-01T06:00:00.000Z',expiresAt:'2026-10-08T06:00:00.000Z',type:'explicit_snapshot'},status,startedAt:scheduledAt,completedAt:extra.completedAt||scheduledAt,output:status==='missed'?{status:'missed',text:'The scheduled time was missed. No backlog was executed.'}:status==='overlap'?{status:'overlap',text:'An earlier occurrence is still active. This occurrence did not run.'}:'Brief '+runId,error:null});
const memory=()=>{const slots=new Map(),writes=[];return {slots,writes,read:async slot=>slots.has(slot)?structuredClone(slots.get(slot)):null,write:async(slot,value)=>{writes.push(slot);slots.set(slot,structuredClone(value));},remove:async slot=>{slots.delete(slot);}};};
// A result stream with per-client cursors, like /api/workflow/hosted/results and /results/ack.
const server=rows=>{const acks=new Map(),calls={results:0,ack:0};let failAck=0;return {calls,acks,failNextAck(){failAck++;},push(value){rows.push(value);},client:new d.HostedDigestProtocol(async(path,body)=>{
 if(path.startsWith('/api/workflow/hosted/results?clientId=')){calls.results++;const id=decodeURIComponent(path.split('=')[1]);return {entries:structuredClone(rows.filter(r=>r.cursor>(acks.get(id)||0)).slice(0,50))};}
 if(path==='/api/workflow/hosted/results/ack'){calls.ack++;if(failAck){failAck--;throw Error('connection lost');}acks.set(body.clientId,Math.max(acks.get(body.clientId)||0,body.cursor));return {};}
 throw Error('unexpected '+path);})};};
const signal=new AbortController().signal,out={};
`;

test('a missed, overlapping or unavailable occurrence is labelled as not run and never becomes the Home brief',()=>{
 const out=run(prelude+`
out.labels=['missed','overlap','unavailable','finished','failed','completed'].map(d.digestStatusLabel);
out.ran=['missed','overlap','unavailable','finished','failed','constructor','toString'].map(status=>d.digestRan({status}));
const ranRow=row(1,'run-a','finished','2026-10-06T06:00:00.000Z'),missedRow=row(2,'run-b','missed','2026-10-07T06:00:00.000Z');
out.missedText=d.digestSummaryText(missedRow);
d.rememberRetainedDigests([ranRow,missedRow],'Phone agent');out.home=d.latestRetainedDigest();
d.rememberRetainedDigests([missedRow],'Phone agent');out.onlyMissed=d.latestRetainedDigest();
d.rememberRetainedDigests([row(3,'run-c','overlap','2026-10-08T06:00:00.000Z'),row(4,'run-d','unavailable','2026-10-09T06:00:00.000Z')]);out.neverRan=d.latestRetainedDigest();
d.rememberRetainedDigests([ranRow,missedRow,row(5,'run-e','failed','2026-10-08T06:00:00.000Z')]);out.failed=d.latestRetainedDigest()?.status;
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.labels,['Missed — not run','Skipped — an earlier run was still active','Not run — source unavailable','finished','failed','completed']);
 assert.deepEqual(out.ran,[false,false,false,true,true,true,true]);
 assert.equal(out.missedText,'The scheduled time was missed. No backlog was executed.');
 assert.deepEqual(out.home,{summary:'Brief run-a',ranAt:'2026-10-06T06:00:00.000Z',agent:'Phone agent',status:'finished'});
 assert.equal(out.onlyMissed,null);assert.equal(out.neverRan,null);assert.equal(out.failed,'failed');
});

test('a schedule keeps its reviewed time zone and says so when the device clock is in another zone',()=>{
 const out=run(prelude+`
const loop=(timeZone,extra={})=>({removed:false,...extra,spec:{version:1,template:'morning',sourceId:'s',sourceRevision:'r',timeZone,localTime:'08:00',enabled:true,...(extra.spec||{})}});
const winter=Date.parse('2026-01-15T12:00:00Z'),summer=Date.parse('2026-07-15T12:00:00Z');
out.same=d.digestZoneNote(loop('America/New_York'),'America/New_York',winter);
out.travel=d.digestZoneNote(loop('America/New_York'),'Europe/Paris',winter);
out.alias=d.digestZoneNote(loop('UTC'),'Etc/UTC',winter);
// London and Lisbon share an offset all year; Lagos (UTC+1 all year) matches London only during British Summer Time.
out.sameOffset=d.digestZoneNote(loop('Europe/London'),'Europe/Lisbon',summer);
out.summerEqual=d.digestZoneNote(loop('Europe/London'),'Africa/Lagos',summer);
out.winterDiffers=d.digestZoneNote(loop('Europe/London'),'Africa/Lagos',winter);
out.paused=d.digestZoneNote(loop('America/New_York',{spec:{enabled:false}}),'Europe/Paris',winter);
out.removed=d.digestZoneNote(loop('America/New_York',{removed:true}),'Europe/Paris',winter);
out.invalid=d.digestZoneNote(loop('Not/AZone'),'Europe/Paris',winter);
console.log(JSON.stringify(out));`);
 assert.equal(out.same,'');assert.equal(out.alias,'');assert.equal(out.sameOffset,'');assert.equal(out.summerEqual,'');assert.equal(out.paused,'');assert.equal(out.removed,'');assert.equal(out.invalid,'');
 assert.equal(out.travel,'Runs at 08:00 America/New_York time, not this device’s current time zone (Europe/Paris). Review the schedule to change it.');
 assert.match(out.winterDiffers,/^Runs at 08:00 Europe\/London time, not this device’s current time zone \(Africa\/Lagos\)\./);
});

test('each occurrence is retained and delivered once across a lost acknowledgement, an interrupted notice and a restart',()=>{
 const out=run(prelude+`
const rows=[row(1,'run-morning','finished','2026-10-06T06:00:00.000Z'),row(2,'run-evening','finished','2026-10-06T18:00:00.000Z',{loop:'evening'}),row(3,'run-missed','missed','2026-10-07T06:00:00.000Z')];
const s=server(rows),storage=memory(),delivered=[];let failNotice='run-evening';
const publish=async result=>{if(failNotice===result.runId){failNotice='';throw Error('notice channel unavailable');}delivered.push(result.runId);};
const inbox=()=>new d.DigestInbox(storage,'scope',publish);
// 1. The acknowledgement is lost after the local commit.
s.failNextAck();out.firstError=await inbox().sync(s.client,signal).then(()=>'',error=>error.message);
out.afterLostAck={retained:(await inbox().history()).map(r=>r.runId),delivered:[...delivered]};
// 2. Reconnect in a new process: the same IDs replay, nothing is stored or delivered twice.
out.second=(await inbox().sync(s.client,signal)).map(r=>[r.runId,r.status]);out.afterReconnect=[...delivered];
// 3. Further syncs, including two overlapping ones from two surfaces, deliver nothing more.
await Promise.all([inbox().sync(s.client,signal),inbox().sync(s.client,signal)]);await inbox().sync(s.client,signal);
out.final={delivered:[...delivered],acked:[...s.acks.values()],index:storage.slots.get('scope')};
// 4. A later occurrence is its own record and its own single delivery.
s.push(row(4,'run-next','finished','2026-10-08T06:00:00.000Z'));await inbox().sync(s.client,signal);await inbox().sync(s.client,signal);
out.next={delivered:[...delivered],history:(await inbox().history()).map(r=>r.runId)};
// 5. A crash after the notice posted but before that fact was saved may publish again; history keeps one record.
const crash=memory();let dropped=false;const flaky={...crash,write:async(slot,value)=>{if(slot==='scope'&&!dropped&&Array.isArray(value.pendingNotices)&&value.ids?.length===1&&value.pendingNotices.length===0){dropped=true;throw Error('process killed');}return crash.write(slot,value);}};
const one=server([row(1,'run-solo','finished','2026-10-06T06:00:00.000Z')]),published=[],post=async result=>{published.push(result.runId);};
out.crashError=await new d.DigestInbox(flaky,'scope',post).sync(one.client,signal).then(()=>'',error=>error.message);
await new d.DigestInbox(crash,'scope',post).sync(one.client,signal);
out.crash={published,history:(await new d.DigestInbox(crash,'scope',post).history()).map(r=>r.runId)};
// 6. The same run ID arriving with different content is refused, not shown.
const changed=server([row(1,'run-solo','finished','2026-10-06T06:00:00.000Z')]);const tampered=server([{...row(1,'run-solo','finished','2026-10-06T06:00:00.000Z'),output:'Different brief'}]);
const fresh=memory();await new d.DigestInbox(fresh,'scope').sync(changed.client,signal);fresh.slots.get('scope').clientId='reader2';
out.tampered=await new d.DigestInbox(fresh,'scope').sync(tampered.client,signal).then(()=>'',error=>error.message);
console.log(JSON.stringify(out));`);
 assert.equal(out.firstError,'connection lost');
 // The interrupted notice (run-evening) stays pending; the others were delivered before the ack failed.
 assert.deepEqual(out.afterLostAck,{retained:['run-morning','run-evening','run-missed'],delivered:['run-morning','run-missed']});
 assert.deepEqual(out.second,[['run-morning','finished'],['run-evening','finished'],['run-missed','missed']]);
 assert.deepEqual(out.afterReconnect,['run-morning','run-missed','run-evening']);
 assert.deepEqual(out.final.delivered,['run-morning','run-missed','run-evening']);
 assert.deepEqual(out.final.acked,[3]);
 assert.deepEqual(out.final.index.ids,['run-morning','run-evening','run-missed']);assert.deepEqual(out.final.index.pendingNotices,[]);assert.deepEqual(out.final.index.pendingRemoval,[]);
 assert.deepEqual(out.next,{delivered:['run-morning','run-missed','run-evening','run-next'],history:['run-morning','run-evening','run-missed','run-next']});
 assert.equal(out.crashError,'process killed');
 assert.deepEqual(out.crash,{published:['run-solo','run-solo'],history:['run-solo']});
 assert.equal(out.tampered,'Saved digest result changed');
});

// Development schedule admission (apps/app/src/browser/development-digest-occurrence.ts) against the
// pinned agent's digestAdmission. Source-level parity only: the agent itself is not run here.
const occurrencePrelude=`
const o=await import(${JSON.stringify(resolve(root,'apps/app/src/browser/development-digest-occurrence.ts'))});
const at=text=>Date.parse(text),out={};
const loop=(createdAt,extra={})=>({active:true,removed:false,createdAt:at(createdAt),spec:{timeZone:'UTC',localTime:'08:00'},...extra});
// What the scheduler does on each tick: admit, settle, then act.
const tick=(l,time)=>{const found=o.scheduledOccurrence(l,at(time));if(!found)return null;o.settleOccurrence(l,found.local);return (found.missed?'missed ':'run ')+found.local;};
`;

test('a development occurrence runs up to 30 minutes late, is missed after that, and settles once',()=>{
 const out=run(occurrencePrelude+`
const ticks=(created,times)=>{const l=loop(created);return times.map(time=>tick(l,time));};
out.exact=ticks('2026-10-03T07:00:00Z',['2026-10-03T07:59:59.999Z','2026-10-03T08:00:00Z','2026-10-03T08:00:15Z','2026-10-03T08:01:00Z']);
out.late119=ticks('2026-10-03T07:00:00Z',['2026-10-03T08:29:59.999Z','2026-10-03T08:30:30Z']);
out.late120=ticks('2026-10-03T07:00:00Z',['2026-10-03T08:30:00Z']);
// Ten minutes late (a Doze-delayed tick) still runs.
out.late10m=ticks('2026-10-03T07:00:00Z',['2026-10-03T08:10:00Z','2026-10-03T08:10:15Z']);
out.late121=ticks('2026-10-03T07:00:00Z',['2026-10-03T08:30:00.001Z','2026-10-03T08:30:15Z','2026-10-03T12:00:00Z']);
// Three days closed: one record for the most recent occurrence, no backlog, then the next day runs.
out.absence=ticks('2026-10-03T07:00:00Z',['2026-10-06T09:30:00Z','2026-10-06T09:30:15Z','2026-10-07T08:00:20Z']);
// Created after today's time: nothing until tomorrow. Paused, removed or source-paused: nothing.
out.createdAfter=ticks('2026-10-03T08:00:30Z',['2026-10-03T08:00:45Z','2026-10-03T09:00:00Z','2026-10-04T08:00:00Z']);
out.inactive=[{active:false},{removed:true},{sourcePaused:true}].map(extra=>tick(loop('2026-10-03T07:00:00Z',extra),'2026-10-03T08:00:00Z'));
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.exact,[null,'run 2026-10-03T08:00',null,null]);
 assert.deepEqual(out.late119,['run 2026-10-03T08:00',null]);
 assert.deepEqual(out.late120,['run 2026-10-03T08:00']);
 assert.deepEqual(out.late10m,['run 2026-10-03T08:00',null]);
 assert.deepEqual(out.late121,['missed 2026-10-03T08:00',null,null]);
 assert.deepEqual(out.absence,['missed 2026-10-06T08:00',null,'run 2026-10-07T08:00']);
 assert.deepEqual(out.createdAfter,[null,null,'run 2026-10-04T08:00']);
 assert.deepEqual(out.inactive,[null,null,null]);
});

test('a clock jump forward then back runs each real occurrence exactly once and nothing twice',()=>{
 const out=run(occurrencePrelude+`
// Jump forward two days, where an occurrence is due and runs; then back to the real day.
const l=loop('2026-10-03T07:00:00Z');
out.jump=['2026-10-03T08:00:05Z','2026-10-05T08:00:10Z','2026-10-04T07:59:00Z','2026-10-04T08:00:05Z','2026-10-04T08:00:20Z','2026-10-04T12:00:00Z',
 // Time now passes the jumped record: it was already settled and does not run again. The day after is new.
 '2026-10-05T08:00:00Z','2026-10-05T08:01:00Z','2026-10-06T08:00:00Z'].map(time=>tick(l,time));
out.settled=l.settledOccurrences;out.mark=l.lastOccurrence;
// Back across an occurrence that already ran, then forward again: never twice.
const again=loop('2026-10-03T07:00:00Z');
out.again=['2026-10-03T08:00:05Z','2026-10-03T07:58:00Z','2026-10-03T08:00:30Z','2026-10-03T08:01:59Z'].map(time=>tick(again,time));
// Back behind the jump but past today's time: never a late run, and the occurrence does not pass without a
// record. It is recorded once as missed, like any other occurrence found more than 30 minutes late.
const late=loop('2026-10-03T07:00:00Z');
out.late=['2026-10-05T08:00:00Z','2026-10-04T09:30:00Z','2026-10-04T23:00:00Z','2026-10-05T08:00:00Z','2026-10-06T08:00:00Z'].map(time=>tick(late,time));
// The round-4 case: the clock jumps two days ahead and is corrected, then the tab sleeps through the real time.
const asleep=loop('2026-10-03T07:00:00Z');
out.asleep=['2026-10-05T08:00:10Z','2026-10-03T07:40:00Z','2026-10-03T08:40:00Z','2026-10-03T08:40:30Z','2026-10-04T08:50:00Z','2026-10-05T08:00:00Z','2026-10-06T08:00:00Z'].map(time=>tick(asleep,time));
// A clock set back onto a day a long absence skipped: one truthful record for that day, never a backlog or a run.
const absent=loop('2026-10-01T07:00:00Z');
out.absent=['2026-10-06T09:30:00Z','2026-10-03T09:00:00Z','2026-10-03T09:00:30Z','2026-10-03T23:00:00Z'].map(time=>tick(absent,time));out.absentSettled=absent.settledOccurrences;
// A schedule moved to another zone keeps no settled civil times: "12:30" settled in Auckland is another
// instant in Los Angeles and must still run there. Within one zone the memory is kept.
const auckland=loop('2026-10-09T00:00:00Z',{spec:{timeZone:'Pacific/Auckland',localTime:'12:30'}});
out.zone=[tick(auckland,'2026-10-09T23:30:05Z')];
const moved=(zone,created)=>({active:true,removed:false,createdAt:at(created),spec:{timeZone:zone,localTime:'12:30'},...o.carriedSettlement(auckland,zone)});
const angeles=moved('America/Los_Angeles','2026-10-10T00:00:00Z');
out.zone.push(tick(angeles,'2026-10-10T19:30:05Z'),tick(angeles,'2026-10-10T19:30:20Z'));
const sameZone=moved('Pacific/Auckland','2026-10-09T23:30:10Z');
out.zone.push(sameZone.lastOccurrence,tick(sameZone,'2026-10-09T23:30:20Z'),tick(sameZone,'2026-10-10T23:30:00Z'));
out.carried=[o.carriedSettlement(undefined,'UTC'),o.carriedSettlement(loop('2026-10-01T07:00:00Z'),'UTC')];
// A clock set to before the schedule existed settles nothing.
const before=loop('2026-10-03T07:59:30Z');
out.before=['2026-10-03T08:00:05Z','2026-10-02T08:00:10Z'].map(time=>tick(before,time));
// A document written before the settled list existed: everything up to its newest record counts as settled.
const legacy=loop('2026-10-01T07:00:00Z',{lastOccurrence:'2026-10-05T08:00'});
out.legacy=['2026-10-04T08:00:00Z','2026-10-05T08:00:00Z','2026-10-06T08:00:00Z','2026-10-04T08:00:00Z','2026-10-05T08:00:30Z'].map(time=>tick(legacy,time));
out.legacyFloor=legacy.settledFloor;
// History is bounded: occurrences older than the remembered list never run again.
const long=loop('2026-01-01T07:00:00Z');let ran=0;
for(let day=0;day<40;day++)if(tick(long,new Date(at('2026-01-01T08:00:00Z')+day*86400000).toISOString()))ran++;
out.long={ran,kept:long.settledOccurrences.length,floor:long.settledFloor,old:tick(long,'2026-01-03T08:00:00Z'),recent:tick(long,'2026-02-05T08:00:00Z')};
// A repeated civil time (end of daylight saving) is one occurrence, at its earlier instant.
const fall=loop('2026-10-31T00:00:00Z',{spec:{timeZone:'America/New_York',localTime:'01:30'}});
out.fall=['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'].map(time=>tick(fall,time));
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.jump,['run 2026-10-03T08:00','run 2026-10-05T08:00',null,'run 2026-10-04T08:00',null,null,null,null,'run 2026-10-06T08:00']);
 assert.deepEqual(out.settled,['2026-10-03T08:00','2026-10-04T08:00','2026-10-05T08:00','2026-10-06T08:00']);assert.equal(out.mark,'2026-10-06T08:00');
 assert.deepEqual(out.again,['run 2026-10-03T08:00',null,null,null]);
 assert.deepEqual(out.late,['run 2026-10-05T08:00','missed 2026-10-04T08:00',null,null,'run 2026-10-06T08:00']);
 assert.deepEqual(out.asleep,['run 2026-10-05T08:00',null,'missed 2026-10-03T08:00',null,'missed 2026-10-04T08:00',null,'run 2026-10-06T08:00']);
 assert.deepEqual(out.absent,['missed 2026-10-06T08:00','missed 2026-10-03T08:00',null,null]);assert.deepEqual(out.absentSettled,['2026-10-03T08:00','2026-10-06T08:00']);
 assert.deepEqual(out.zone,['run 2026-10-10T12:30','run 2026-10-10T12:30',null,'2026-10-10T12:30',null,'run 2026-10-11T12:30']);
 assert.deepEqual(out.carried,[{},{}]);
 assert.deepEqual(out.before,['run 2026-10-03T08:00',null]);
 assert.deepEqual(out.legacy,[null,null,'run 2026-10-06T08:00',null,null]);assert.equal(out.legacyFloor,'2026-10-05T08:00');
 assert.deepEqual(out.long,{ran:40,kept:32,floor:'2026-01-08T08:00',old:null,recent:null});
 assert.deepEqual(out.fall,['run 2026-11-01T01:30',null]);
});


test('development digest admission uses the pinned agent threshold, order and record text',async()=>{
 const out=run(occurrencePrelude+`
const p=await import(${JSON.stringify(resolve(root,'.eliza/client-features/plugins/plugin-workflow/src/services/hosted-digest-policy.ts'))});
out.window=o.DIGEST_RUN_WINDOW_MS;out.missed=o.DIGEST_MISSED_TEXT;out.unavailable=o.DIGEST_UNAVAILABLE_TEXT;
out.shared=[o.DIGEST_RUN_WINDOW_MS===p.DIGEST_RUN_WINDOW_MS,o.DIGEST_MISSED_TEXT===p.DIGEST_MISSED_TEXT,o.DIGEST_UNAVAILABLE_TEXT===p.DIGEST_PAUSED_TEXT];
out.states=[[false,'2026-10-08T00:00:00.000Z'],[false,'2026-10-07T08:00:00.000Z'],[false,'2026-10-07T07:59:59.999Z'],[true,'2026-10-08T00:00:00.000Z'],[true,'2026-10-01T00:00:00.000Z']].map(([revoked,expiresAt])=>o.digestSourceState({revoked,expiresAt},at('2026-10-07T08:00:00.000Z')));
console.log(JSON.stringify(out));`);
 // Threshold: the agent records missed only when more than 30 minutes late (owner decision, #680).
 assert.equal(out.window,30*60000);
 assert.deepEqual(out.shared,[true,true,true],'the development scheduler uses the agent policy module itself');
 assert.deepEqual(out.states,['current','expired','expired','revoked','revoked']);
});
