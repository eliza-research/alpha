import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {residentRecoveryReason,residentRecoveryMessage,residentRecoveryCopy,parseRecoveryReview,parseRecoveryArchive,residentBootMessage,residentLivenessCheck} from '../apps/app/src/runtime/resident-recovery.ts';
const token='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
test('only exact native hard-block codes change recovery guidance',()=>{
 for(const code of ['ipc-recovery-retention-limit','ipc-recovery-required','runtime-identity-unavailable']){
  assert.equal(residentRecoveryReason(Object.assign(Error('opaque native detail'),{code})),code);
  assert.doesNotMatch(residentRecoveryMessage(code),/another connection|Retry|connect another/i);
 }
 for(const value of [null,Error('ipc-recovery-retention-limit'),{code:'temporary'},{message:'ipc-recovery-required'}])assert.equal(residentRecoveryReason(value),undefined);
});
test('review accepts only a bounded actual-native snapshot and retains no extra metadata',()=>{
 assert.deepEqual(parseRecoveryReview({status:'reviewable',retainedCount:8,reviewToken:token,files:['PRIVATE_PATH']}),{status:'reviewable',retainedCount:8,reviewToken:token});
 for(const value of [null,{status:'reviewable',retainedCount:0,reviewToken:token},{status:'reviewable',retainedCount:65,reviewToken:token},{status:'reviewable',retainedCount:8,reviewToken:'../path'},{status:'ready',retainedCount:8,reviewToken:token}])assert.throws(()=>parseRecoveryReview(value));
 assert.deepEqual(parseRecoveryReview({status:'unavailable',retainedCount:8,reviewToken:token}),{status:'unavailable',retainedCount:8});
});
test('archive outcomes stay finite and incomplete or unknown data cannot mean success',()=>{
 for(const status of ['archived','unavailable','partial'])assert.deepEqual(parseRecoveryArchive({status,archivedCount:3,retainedCount:5,extra:'PRIVATE_PATH'}),{status,archivedCount:3,retainedCount:5});
 for(const value of [null,{status:'success',archivedCount:8,retainedCount:0},{status:'archived',archivedCount:-1,retainedCount:0},{status:'archived',archivedCount:8,retainedCount:NaN}])assert.throws(()=>parseRecoveryArchive(value));
});

test('only reviewable state offers restart readiness; incomplete states remain truthful',()=>{
 const reason='ipc-recovery-retention-limit';
 assert.equal(residentRecoveryCopy(reason,{step:'review',review:{status:'reviewable',retainedCount:8,reviewToken:token}}),'Restart needed');
 for(const view of [undefined,{step:'reviewing'},{step:'archiving'},{step:'unavailable'},{step:'partial'}])assert.doesNotMatch(residentRecoveryCopy(reason,view),/ready to restart|data is safe/);
 for(const reason of ['ipc-recovery-required','runtime-identity-unavailable'])assert.doesNotMatch(residentRecoveryCopy(reason),/ready to restart|data is safe/);
});
test('a runtime identity refusal says to try again and never to reinstall or clear data',()=>{
 for(const line of [residentRecoveryCopy('runtime-identity-unavailable'),residentRecoveryMessage('runtime-identity-unavailable')]){
  assert.equal(line,'Startup check failed','the panel carries Try again');assert.doesNotMatch(line,/reinstall|clear/i);
 }
 assert.equal(residentRecoveryCopy('ipc-recovery-required'),'Restart phone');
});

test('the liveness check reads once at a time, at most every 10 s, and reports only a lost resident',async()=>{
 let clock=0,reads=0,starts=0,boot={state:'dead',reason:'fatal'};
 const check=residentLivenessCheck(async()=>{reads++;await null;return boot;},()=>clock);
 const channelUnavailable=async()=>{const status=await check();if(status)starts++;};
 await Promise.all([channelUnavailable(),channelUnavailable()]);
 assert.equal(reads,1);assert.equal(starts,1);
 clock=5_000;await channelUnavailable();assert.equal(reads,1);
 for(const state of ['listening','stopping','stopped',undefined]){clock+=10_000;boot={state};await channelUnavailable();}
 assert.equal(starts,1);
 for(const state of ['restarting','booting']){clock+=10_000;boot={state};await channelUnavailable();}
 assert.equal(starts,3);
 const failing=residentLivenessCheck(async()=>{throw Error('Local runtime status unavailable.');},()=>0);
 assert.equal(await failing(),undefined);
});
test('every terminal boot reason reads as one plain line without its code',()=>{
 for(const reason of ['agent startup blocked: missing bun','fatal','agent-update-deferred','agent exited: 137','',undefined]){
  const line=residentBootMessage(reason);
  assert.match(line,/^[^\n.]+$/);
  assert.doesNotMatch(line,/fatal|blocked|deferred|exited|137|bun/i);
 }
 assert.notEqual(residentBootMessage('agent-update-deferred'),residentBootMessage('fatal'));
 assert.notEqual(residentBootMessage('agent startup blocked: x'),residentBootMessage('fatal'));
});
const connectionSource=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const lostSection=transformSync(connectionSource.slice(connectionSource.indexOf('let residentRestartEpoch'),connectionSource.indexOf('/** Test mocks only (the mock-mode exit')),{loader:'ts'}).code;
function residentFixture(boot,startConnects=false){
 const calls=[];
 const context={epoch:1,operation:null,active:{kind:'resident'},state:{error:''},residentLivenessCheck,residentBootMessage,
  localAgentBootStatus:async()=>{calls.push('status');return boot;},
  retire(){calls.push('retire');context.active=null;context.epoch++;},update:patch=>Object.assign(context.state,patch),
  ensureResident:async()=>{calls.push('start');if(startConnects)context.active={kind:'resident'};},queueResidentRebind:()=>calls.push('queue')};
 vm.createContext(context);vm.runInContext(lostSection,context);
 return {context,calls,settle:()=>new Promise(resolve=>setTimeout(resolve,0))};
}
test('connection-ui retires a dead resident once and starts it again; a listening one is left alone',async()=>{
 const dead=residentFixture({state:'dead',reason:'fatal'});
 dead.context.checkResidentAlive(1);dead.context.checkResidentAlive(1);await dead.settle();
 assert.deepEqual(dead.calls,['status','retire','start']);
 assert.equal(dead.context.state.kind,'recovering');assert.equal(dead.context.state.error,residentBootMessage('fatal'));
 const restarted=residentFixture({state:'restarting'},true);restarted.context.checkResidentAlive(1);await restarted.settle();
 assert.deepEqual(restarted.calls,['status','retire','start']);assert.equal(restarted.context.state.error,'');
 for(const state of ['listening','stopping','stopped']){
  const alive=residentFixture({state});alive.context.checkResidentAlive(1);await alive.settle();
  assert.deepEqual(alive.calls,['status']);
 }
 const stale=residentFixture({state:'dead'});stale.context.checkResidentAlive(0);await stale.settle();assert.deepEqual(stale.calls,[]);
});
