import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {javaBinary} from './fixtures/jvm-tools.mjs';
// #394: a missed digest is never replayed. Run now is one new, explicitly reviewed run whose identity
// is derived from the missed record, so repeats and retries return the same run. Resident schedules
// run in the resident, which is brought back natively after boot, update and clock/time-zone changes
// when not running. Not Android/device evidence.
const root=resolve(import.meta.dirname,'..');
const read=path=>readFileSync(join(root,path),'utf8');
const script=`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const now=Date.parse('2026-10-14T12:00:00Z');
const live={provider:'native',ownerId:'o',agentId:'a',installationId:'i',enrollmentId:'e',sourceId:'s',revision:'r'};
const source={id:'s',revision:'r',kind:'tasks',label:'Phone sources',observedAt:'2026-10-13T12:00:00Z',expiresAt:'2026-10-18T12:00:00Z',revoked:false,live};
const loop={id:'l',versionId:'v',name:'Morning digest',active:true,removed:false,spec:{version:1,template:'morning',sourceId:'s',sourceRevision:'r',timeZone:'UTC',localTime:'08:00',enabled:true}};
const result=(cursor,status,extra={})=>({cursor,runId:'run-'+cursor,workflowId:'l',workflowVersionId:'v',templateVersion:'t',scheduledAt:'2026-10-14T08:00:00Z',source:{id:'s'},status,startedAt:'',completedAt:'',output:null,error:null,...extra});
const offers=(results,loops=[loop],sources=[source])=>[...d.missedRunNowOffers(results,loops,sources,now).values()];
const out={};
out.missed=offers([result(1,'completed'),result(2,'missed')]);
out.olderMissed=offers([result(1,'missed'),result(2,'completed')]);
out.twoMissed=offers([result(1,'missed'),result(2,'missed')]).map(o=>o.runId);
out.newerDossier=offers([result(1,'missed'),result(2,'completed',{workflowId:'manual'})]).length;
out.otherSource=offers([result(1,'missed'),result(2,'completed',{workflowId:'l2',source:{id:'other'}})],[loop,{...loop,id:'l2',spec:{...loop.spec,template:'evening',sourceId:'other'}}]).length;
out.otherDossier=offers([result(1,'missed'),result(2,'completed',{workflowId:'manual',source:{id:'other'}})]).length;
// Renewal rebinds the loop to s2 after Run now already produced a dossier over s1.
const renewed={...source,id:'s2',revision:'r2'};
out.renewed=offers([result(1,'missed'),result(2,'completed',{workflowId:'manual',source:{id:'s'}})],[{...loop,versionId:'v2',spec:{...loop.spec,sourceId:'s2',sourceRevision:'r2'}}],[{...source,revoked:true},renewed]).length;
out.renewedNoRun=offers([result(1,'missed')],[{...loop,versionId:'v2',spec:{...loop.spec,sourceId:'s2',sourceRevision:'r2'}}],[{...source,revoked:true},renewed]).map(o=>o.sourceId);
out.executed=offers([result(1,'completed'),result(2,'unavailable'),result(3,'overlap')]).length;
out.evening=offers([result(1,'missed')],[{...loop,spec:{...loop.spec,template:'evening'}}]).length;
out.paused=offers([result(1,'missed')],[{...loop,active:false}]).length;
out.removed=offers([result(1,'missed')],[{...loop,removed:true}]).length;
out.lapsed=offers([result(1,'missed')],[{...loop,sourceState:'expired'}]).length;
out.expired=offers([result(1,'missed')],[loop],[{...source,expiresAt:'2026-10-14T11:00:00Z'}]).length;
out.revoked=offers([result(1,'missed')],[loop],[{...source,revoked:true}]).length;
out.rebound=offers([result(1,'missed')],[loop],[{...source,revision:'r2'}]).length;
out.snapshot=offers([result(1,'missed')],[loop],[{...source,live:undefined}]).length;
out.google=offers([result(1,'missed')],[loop],[{...source,live:{provider:'google'}}]).length;
out.badId=offers([result(1,'missed',{runId:'../x'})]).length;
out.sameId=d.missedRunNowMutationId('run-2')===d.missedRunNowMutationId('run-2');
console.log(JSON.stringify(out));`;
test('Run now is offered only for the newest missed morning digest over a current reviewed phone source',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:60000}));
 assert.deepEqual(out.missed,[{runId:'run-2',sourceId:'s',sourceRevision:'r',sourceLabel:'Phone sources',scheduledAt:'2026-10-14T08:00:00Z',mutationId:'missed-run-now-run-2'}]);
 assert.equal(out.olderMissed.length,0,'a later result supersedes the missed one');
 assert.deepEqual(out.twoMissed,['run-2'],'only the newest missed occurrence, never a backlog');
 assert.equal(out.newerDossier,0,'a newer run over the same source hides it');
 assert.equal(out.otherSource,1,'another loop over another source does not');
 assert.equal(out.otherDossier,0,'any newer on-demand run does, whatever its source');
 assert.equal(out.renewed,0,'after a renewal the earlier Run now still hides the offer, so no refused repeat');
 assert.deepEqual(out.renewedNoRun,['s2'],'a renewed loop that never ran now is offered over its current source');
 assert.equal(out.executed,0,'unavailable and overlap records are not missed');
 for(const key of ['evening','paused','removed','lapsed','expired','revoked','rebound','snapshot','google','badId'])assert.equal(out[key],0,key);
 assert.equal(out.sameId,true,'identity is stable, so a repeat returns the same run');
});

test('Run now goes through the reviewed dossier path with the derived identity and no automatic replay',()=>{
 const ui=read('apps/app/src/runtime/hosted-digest-ui.tsx');
 assert.match(ui,/missedRunNowOffers\(/);
 assert.match(ui,/setReview\(\{path:'dossier',body:\{sourceId:offer\.sourceId,sourceRevision:offer\.sourceRevision,mutationId:offer\.mutationId,confirmed:true\}/);
 assert.match(ui,/The missed time is not replayed and your schedule doesn’t change/);
 assert.match(ui,/onClick=\{\(\)=>reviewMissedRunNow\(/,'only an owner tap opens the review');
 assert.match(ui,/\{missedOffers\.has\(result\.runId\)&&!ranMissed\.has\(result\.runId\)&&<button[^>]*onClick=\{\(\)=>reviewMissedRunNow\(missedOffers\.get\(result\.runId\)!\)\}/,'the button renders only for an offer, so revoked or rebound sources never show it');
 assert.doesNotMatch(ui,/reviewMissedRunNow\([^)]*\)\s*;?\s*\}\s*,\s*\[/,'never invoked from an effect');
 assert.doesNotMatch(ui,/submit\(\{path:'dossier'/,'never submitted without the review');
});

test('the resident is brought back after boot, update and clock or time-zone changes',()=>{
 const manifest=read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g,'');
 const receiver=manifest.match(/<receiver android:name="\.ResidentScheduleReceiver"[^>]*>([\s\S]*?)<\/receiver>/);
 assert.ok(receiver,'receiver declared');
 assert.match(receiver[0],/android:exported="false"/);
 for(const action of ['BOOT_COMPLETED','MY_PACKAGE_REPLACED','TIME_SET','TIMEZONE_CHANGED'])assert.match(receiver[1],new RegExp(`android\\.intent\\.action\\.${action}"`),action);
 assert.doesNotMatch(receiver[1],/LOCKED_BOOT_COMPLETED/,'credential-encrypted agent state needs unlock');
 const source=read('android/app/src/main/java/ai/elizaresearch/alphaphone/ResidentScheduleReceiver.java');
 assert.match(source,/ElizaAgentService\.shouldAutoStart\(context\)/);
 assert.match(source,/AlphaLocalAgentPlugin\.startResidentIfAdmissible\(context,action,unlocked,packaged,enabled\)/);
 assert.doesNotMatch(source,/ElizaAgentService\.start\(/,'the receiver never starts outside the lifecycle lock');
 const plugin=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java');
 assert.match(plugin,/ResidentScheduleRearm\.admitAndStart\(lifecycleLock,[\s\S]{0,240}\(\)->accepting&&!stopping&&credentialMutationEpoch<0&&credentialShutdownRequest==-1,\(\)->ElizaAgentService\.start\(context\)\)/,'admission and start share lifecycleLock');
 assert.doesNotMatch(source,/ACTION_RESTART|restart\(|runHostedDossier|dossier/i,'never restarts a running agent or runs a digest');
 assert.doesNotMatch(read('android/app/src/main/java/ai/elizaresearch/alphaphone/ResidentScheduleRearm.java'),/import android\./,'pure policy');
});

test('resident schedule re-arming policy runs on the JVM',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'resident-rearm-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-d',temporary,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/ResidentScheduleRearm.java'),join(root,'test/fixtures/ResidentScheduleRearmTest.java')],{timeout:60000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.ResidentScheduleRearmTest'],{encoding:'utf8',timeout:60000}),/^PASS resident schedule rearm/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
