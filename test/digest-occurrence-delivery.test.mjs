import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// MVP-38 at the source level: one retained record and one delivery per digest occurrence across
// reconnect, a lost acknowledgement, an interrupted notice and a restart, and an honest presentation
// of an occurrence the agent recorded without running it. This drives the app's own inbox and
// presentation code against a synthetic result stream. It is not resident-runtime, emulator or
// device evidence.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
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
// The notice ledger is idempotent per run (browser hostedResultsDocument, native HostedResultNotices).
const visible=new Set(),publish=async result=>{if(failNotice===result.runId){failNotice='';throw Error('notice channel unavailable');}delivered.push(result.runId);visible.add(result.runId);};
const inbox=()=>new d.DigestInbox(storage,'scope',publish);
// 1. The acknowledgement is lost after the local commit.
s.failNextAck();out.firstError=await inbox().sync(s.client,signal).then(()=>'',error=>error.message);
out.afterLostAck={retained:(await inbox().history()).map(r=>r.runId),delivered:[...delivered]};
// 2. Reconnect in a new process: the same IDs replay, nothing is stored or delivered twice.
out.second=(await inbox().sync(s.client,signal)).map(r=>[r.runId,r.status]);out.afterReconnect=[...delivered];
// 3. Further syncs, including two overlapping ones from two surfaces, deliver nothing more.
await Promise.all([inbox().sync(s.client,signal),inbox().sync(s.client,signal)]);await inbox().sync(s.client,signal);
out.final={delivered:[...delivered],visible:[...visible].sort(),acked:[...s.acks.values()],index:storage.slots.get('scope')};
// 4. A later occurrence is its own record and its own single delivery.
s.push(row(4,'run-next','finished','2026-10-08T06:00:00.000Z'));await inbox().sync(s.client,signal);await inbox().sync(s.client,signal);
out.next={delivered:[...delivered],history:(await inbox().history()).map(r=>r.runId)};
// 5. A crash after the notice posted but before that fact was saved may publish again; the ledger keeps one notice.
const crash=memory();let dropped=false;const flaky={...crash,write:async(slot,value)=>{if(slot==='scope'&&!dropped&&Array.isArray(value.pendingNotices)&&value.ids?.length===1&&value.pendingNotices.length===0){dropped=true;throw Error('process killed');}return crash.write(slot,value);}};
const one=server([row(1,'run-solo','finished','2026-10-06T06:00:00.000Z')]),published=[],ledger=new Set(),post=async result=>{published.push(result.runId);ledger.add(result.runId);};
out.crashError=await new d.DigestInbox(flaky,'scope',post).sync(one.client,signal).then(()=>'',error=>error.message);
await new d.DigestInbox(crash,'scope',post).sync(one.client,signal);
out.crash={published,visible:[...ledger],history:(await new d.DigestInbox(crash,'scope',post).history()).map(r=>r.runId)};
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
 assert.deepEqual(out.final.visible,['run-evening','run-missed','run-morning']);
 assert.deepEqual(out.final.acked,[3]);
 assert.deepEqual(out.final.index.ids,['run-morning','run-evening','run-missed']);assert.deepEqual(out.final.index.pendingNotices,[]);assert.deepEqual(out.final.index.pendingRemoval,[]);
 assert.deepEqual(out.next,{delivered:['run-morning','run-missed','run-evening','run-next'],history:['run-morning','run-evening','run-missed','run-next']});
 assert.equal(out.crashError,'process killed');
 assert.deepEqual(out.crash,{published:['run-solo','run-solo'],visible:['run-solo'],history:['run-solo']});
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

test('development digest admission uses the pinned agent threshold, order and record text',async()=>{
 const {readFileSync}=await import('node:fs');
 const agent=readFileSync(resolve(root,'vendor/eliza/plugins/plugin-workflow/src/services/hosted-digest.ts'),'utf8');
 // The agent's run window, record texts and source state live in its shared occurrence policy; the
 // development scheduler imports that same module from the authenticated client feature copy.
 const policy=readFileSync(resolve(root,'vendor/eliza/plugins/plugin-workflow/src/services/hosted-digest-policy.ts'),'utf8');
 const out=run(occurrencePrelude+`
const p=await import(${JSON.stringify(resolve(root,'.eliza/client-features/plugins/plugin-workflow/src/services/hosted-digest-policy.ts'))});
out.window=o.DIGEST_RUN_WINDOW_MS;out.missed=o.DIGEST_MISSED_TEXT;out.unavailable=o.DIGEST_UNAVAILABLE_TEXT;
out.shared=[o.DIGEST_RUN_WINDOW_MS===p.DIGEST_RUN_WINDOW_MS,o.DIGEST_MISSED_TEXT===p.DIGEST_MISSED_TEXT,o.DIGEST_UNAVAILABLE_TEXT===p.DIGEST_PAUSED_TEXT];
out.states=[[false,'2026-10-08T00:00:00.000Z'],[false,'2026-10-07T08:00:00.000Z'],[false,'2026-10-07T07:59:59.999Z'],[true,'2026-10-08T00:00:00.000Z'],[true,'2026-10-01T00:00:00.000Z']].map(([revoked,expiresAt])=>o.digestSourceState({revoked,expiresAt},at('2026-10-07T08:00:00.000Z')));
console.log(JSON.stringify(out));`);
 // Threshold: the agent records missed only when more than 30 minutes late (owner decision, #680).
 assert.match(agent,/if \(checkWindow && digestOccurrenceMissed\(scheduledAt, now\)\)/);
 assert.match(policy,/export const DIGEST_RUN_WINDOW_MS = 30 \* 60_000;/);
 assert.match(policy,/return now - scheduledAt > DIGEST_RUN_WINDOW_MS;/);
 assert.equal(out.window,30*60000);
 assert.deepEqual(out.shared,[true,true,true],'the development scheduler uses the agent policy module itself');
 for(const text of [out.missed,out.unavailable.expired,out.unavailable.revoked])assert.ok(policy.includes(`'${text}'`),`pinned agent policy writes: ${text}`);
 assert.match(agent,/text: DIGEST_PAUSED_TEXT\[sourceState\]/);
 assert.match(agent,/text: DIGEST_MISSED_TEXT/);
 // Order: the source state is decided before lateness, so a late occurrence of a lapsed source is unavailable, not missed.
 const admission=agent.slice(agent.indexOf('export async function digestAdmission('));
 assert.ok(admission.indexOf("status: 'unavailable'")>0&&admission.indexOf("status: 'unavailable'")<admission.indexOf("status: 'missed'"));
 assert.match(admission,/sourceState,\s*paused: true,/);
 // digestSourceState: revoked wins; expiry is inclusive of the expiry instant.
 assert.match(policy,/if \(source\.revoked\) return 'revoked';\s*return Date\.parse\(source\.expiresAt\) <= now \? 'expired' : 'current';/);
 assert.deepEqual(out.states,['current','expired','expired','revoked','revoked']);
});

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

// The development scheduler against the pinned agent itself: digestAdmission, digestSourceState and
// digestCron from plugin-workflow services/hosted-digest.ts, and the cron scan it uses
// (computeNextCronRunAtMs from packages/core), all read with git show at the upstream.lock.json commit.
// The agent's database read and spec integrity checks are stubbed; its admission order, window, texts,
// pause flag and DST resolution run as written. The same table of clock scenarios goes through both
// sides, and any difference fails. Source-level parity only: no agent process runs.
test('development admission matches the pinned agent across a table of clock scenarios, including DST',async()=>{
 const {mkdtempSync,writeFileSync,rmSync,readFileSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const pin=JSON.parse(readFileSync(resolve(root,'upstream.lock.json'),'utf8')).commit;
 const show=path=>execFileSync('git',['-C',resolve(root,'vendor/eliza'),'show',`${pin}:${path}`],{encoding:'utf8',maxBuffer:16*1024*1024});
 const agent=show('plugins/plugin-workflow/src/services/hosted-digest.ts');
 const extract=start=>{const from=agent.indexOf(start);assert.ok(from>=0,`pinned agent defines ${start}`);const end=agent.indexOf('\n}\n',from);return agent.slice(from,end+2);};
 const constant=name=>{const match=agent.match(new RegExp(`export const ${name} = [^;]+;`));assert.ok(match,`pinned agent defines ${name}`);return match[0];};
 const directory=mkdtempSync(resolve(tmpdir(),'digest-parity-'));
 try{
  writeFileSync(resolve(directory,'trigger-scheduling.ts'),show('packages/core/src/services/trigger-scheduling.ts'));
  writeFileSync(resolve(directory,'hosted-digest-policy.ts'),show('plugins/plugin-workflow/src/services/hosted-digest-policy.ts'));
  assert.match(agent,/from '\.\/hosted-digest-policy'/,'the agent admission imports its shared occurrence policy');
  writeFileSync(resolve(directory,'agent.ts'),`import {computeNextCronRunAtMs} from './trigger-scheduling.ts';
import {DIGEST_MISSED_TEXT,DIGEST_PAUSED_TEXT,DIGEST_SOURCE_UNAVAILABLE_TEXT,digestOccurrenceMissed,digestSourceState} from './hosted-digest-policy.ts';
class WorkflowApiError extends Error{constructor(message:string,readonly status:number){super(message);}}
// Stubs for the database read and the reviewed-definition integrity check, which these scenarios hold fixed.
let current:any;const digestSource=async(..._args:unknown[])=>current;const validateDigestSpec=(value:any)=>value;
const digestPhoneSpec=(..._args:unknown[])=>null;const phoneDraftDefinition=(_spec:unknown)=>({source:'reviewed-definition'});
${constant('HOSTED_SPEC')}
${constant('HOSTED_TEMPLATE_VERSION')}
${extract('export function digestCron(')}
${extract('export async function digestAdmission(')}
export {computeNextCronRunAtMs};export const useSource=(source:unknown)=>{current=source;};
`);
  const out=run(`
const o=await import(${JSON.stringify(resolve(root,'apps/app/src/browser/development-digest-occurrence.ts'))});
const a=await import(${JSON.stringify(resolve(directory,'agent.ts'))});
const at=text=>Date.parse(text),out={};
const spec=(timeZone,localTime)=>({version:1,template:'morning',sourceId:'s',sourceRevision:'r',timeZone,localTime,enabled:true});
const sourceRow=(expiresAt,revoked=false)=>({id:'s',revision:'r',kind:'tasks',label:'Phone',observedAt:'2026-01-01T00:00:00.000Z',expiresAt,revoked});
// Agent: the most recent cron instant at or before now, then its admission of that occurrence.
const agentLatest=(zone,localTime,now)=>{const cron=a.digestCron(spec(zone,localTime));let found=null;for(let t=now-27*3600000;;){const next=a.computeNextCronRunAtMs(cron,t,zone);if(next===null||next>now)return found;found=next;t=next;}};
const agentSide=async(row)=>{const now=at(row.now),scheduledAt=agentLatest(row.zone,row.localTime,now);if(scheduledAt===null||scheduledAt<at(row.created))return null;a.useSource(sourceRow(row.expiresAt,row.revoked));
 const s=spec(row.zone,row.localTime),result=await a.digestAdmission(null,'agent',{metadata:{[a.HOSTED_SPEC]:JSON.stringify(s),elizaOwnerEntityId:'owner'},source:'reviewed-definition'},now,scheduledAt);
 return {scheduledAt:new Date(scheduledAt).toISOString(),status:result.status,text:result.text,...(result.paused?{paused:true,sourceState:result.sourceState}:{})};};
// Development: what development-digests.ts tick does with one admitted occurrence.
const devSide=(row)=>{const loop={active:true,removed:false,createdAt:at(row.created),spec:{timeZone:row.zone,localTime:row.localTime}},now=at(row.now),found=o.scheduledOccurrence(loop,now);if(!found)return null;
 const base={scheduledAt:new Date(found.at).toISOString()},state=o.digestSourceState(sourceRow(row.expiresAt,row.revoked),now);
 if(state!=='current')return {...base,status:'unavailable',text:o.DIGEST_UNAVAILABLE_TEXT[state],paused:true,sourceState:state};
 return found.missed?{...base,status:'missed',text:o.DIGEST_MISSED_TEXT}:{...base,status:'ready',text:''};};
const later='2027-01-01T00:00:00.000Z';
const rows=[
 ['on time','UTC','08:00','2026-10-03T08:00:00.000Z'],['29:59.999 late','UTC','08:00','2026-10-03T08:29:59.999Z'],['30 minutes late','UTC','08:00','2026-10-03T08:30:00.000Z'],
 ['30:00.001 late','UTC','08:00','2026-10-03T08:30:00.001Z'],['three days absent','UTC','08:00','2026-10-06T09:30:00.000Z'],
 ['created after the time today, ticked an hour later','UTC','08:00','2026-10-03T09:00:00.000Z',{created:'2026-10-03T08:00:30.000Z'}],
 ['expired, on time','UTC','08:00','2026-10-03T08:00:30.000Z',{expiresAt:'2026-10-03T08:00:00.000Z'}],
 ['expires at this instant','UTC','08:00','2026-10-03T08:00:00.000Z',{expiresAt:'2026-10-03T08:00:00.000Z'}],
 ['expired and late','UTC','08:00','2026-10-03T11:00:00.000Z',{expiresAt:'2026-10-03T09:00:00.000Z'}],
 ['revoked, on time','UTC','08:00','2026-10-03T08:00:10.000Z',{revoked:true}],
 ['offset zone','Asia/Kolkata','07:15','2026-10-03T01:45:30.000Z'],
 // Start of daylight saving: 02:30 does not exist in New York on 8 March, nor 01:30 in London on 29 March.
 ['spring-forward day, skipped time','America/New_York','02:30','2026-03-08T12:00:00.000Z'],
 ['day after spring forward','America/New_York','02:30','2026-03-09T06:30:30.000Z'],
 ['spring-forward day, London','Europe/London','01:30','2026-03-29T03:00:00.000Z'],
 // A skipped time runs one gap later: 02:30 New York runs at 03:30 EDT, and Santiago's skipped midnight hour moves 00:30 to 01:30.
 // Created after today's time: no occurrence until tomorrow on either side.
 ['created after the time today','UTC','08:00','2026-10-03T08:00:30.000Z',{created:'2026-10-03T08:00:10.000Z'}],
 ['spring-forward day, skipped time on time','America/New_York','02:30','2026-03-08T07:30:20.000Z'],
 ['spring-forward at midnight, skipped time on time','America/Santiago','00:30','2026-09-06T04:30:10.000Z'],
 ['spring-forward day, hour after','America/New_York','03:30','2026-03-08T07:30:00.000Z'],
 // End of daylight saving: 01:30 happens twice; only the first instant is the occurrence.
 ['fall-back day, first 01:30','America/New_York','01:30','2026-11-01T05:30:00.000Z'],
 ['fall-back day, second 01:30','America/New_York','01:30','2026-11-01T06:30:30.000Z'],
 ['fall-back day, London','Europe/London','01:30','2026-10-25T00:31:00.000Z'],
 ['fall-back day, London repeat','Europe/London','01:30','2026-10-25T01:31:00.000Z'],
].map(([name,zone,localTime,now,extra={}])=>({name,zone,localTime,now,created:'2026-01-01T00:00:00.000Z',expiresAt:later,revoked:false,...extra}));
out.rows=[];for(const row of rows)out.rows.push({name:row.name,dev:devSide(row),agent:await agentSide(row)});
// Pausing: after the one unavailable record the development loop is source-paused and yields nothing, as the agent's paused record says.
const paused={active:true,removed:false,createdAt:at('2026-01-01T00:00:00Z'),spec:{timeZone:'UTC',localTime:'08:00'},sourcePaused:true};
out.pausedNext=o.scheduledOccurrence(paused,at('2026-10-04T08:00:00Z'));
// Occurrence instants over each DST transition week: the agent's cron scan and the development scheduler pick the same ones.
out.weeks=[];for(const [zone,localTime,start] of [['America/New_York','02:30','2026-03-05T00:00:00Z'],['America/New_York','01:30','2026-10-29T00:00:00Z'],['Europe/London','01:30','2026-03-26T00:00:00Z'],['Europe/London','01:30','2026-10-22T00:00:00Z'],['Australia/Lord_Howe','01:45','2026-04-02T00:00:00Z'],['America/Santiago','00:30','2026-09-03T00:00:00Z']]){
 const cron=a.digestCron(spec(zone,localTime)),agentAt=[];for(let t=at(start),i=0;i<7;i++){const next=a.computeNextCronRunAtMs(cron,t,zone);agentAt.push(new Date(next).toISOString());t=next;}
 const devAt=new Set(),loop={active:true,removed:false,createdAt:at(start),spec:{timeZone:zone,localTime}};
 // Probe the end of each UTC day: the latest occurrence at or before then.
 for(let day=0;day<9;day++){const end=at(start)+day*86400000+86399000;const found=o.scheduledOccurrence(loop,end);if(found&&found.at<=at(agentAt.at(-1)))devAt.add(new Date(found.at).toISOString());}
 out.weeks.push({zone,localTime,agent:agentAt,dev:[...devAt].sort()});}
console.log(JSON.stringify(out));`);
  if(process.env.DIGEST_PARITY_DEBUG)console.log(JSON.stringify(out,null,1));
  for(const row of out.rows)assert.deepEqual(row.dev,row.agent,`${row.name}: development and agent admission agree`);
  // The table exercises every status, not only the happy path.
  assert.deepEqual([...new Set(out.rows.map(row=>row.agent?.status??'none'))].sort(),['missed','none','ready','unavailable']);
  // A skipped civil time runs one gap later on both sides (02:30 EST does not exist; 03:30 EDT is 07:30Z).
  assert.equal(out.rows.find(row=>row.name==='spring-forward day, skipped time').agent?.scheduledAt,'2026-03-08T07:30:00.000Z');
  assert.ok(out.rows.some(row=>row.agent?.sourceState==='expired')&&out.rows.some(row=>row.agent?.sourceState==='revoked'));
  assert.equal(out.pausedNext,null);
  for(const week of out.weeks)assert.deepEqual(week.dev,week.agent,`${week.zone} ${week.localTime}: the same occurrence instants`);
 }finally{rmSync(directory,{recursive:true,force:true});}
 // development-digests.ts applies these in the agent's order: source state first (and pause), then lateness.
 const tick=readFileSync(resolve(root,'apps/app/src/browser/development-digests.ts'),'utf8');
 const sourceCheck=tick.indexOf("if(sourceState!=='current'){loop.sourcePaused=true;notRun('unavailable',{sourceState,paused:true,text:DIGEST_UNAVAILABLE_TEXT[sourceState]});continue;}");
 assert.ok(sourceCheck>0&&sourceCheck<tick.indexOf("if(occurrence.missed){notRun('missed',{text:DIGEST_MISSED_TEXT});continue;}"),'development tick checks the source before lateness and pauses');
});
