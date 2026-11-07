import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
// P-43: a resident left recovering starts again by itself, bounded; a recovery review never loops.
const source=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const begin=source.indexOf('const RESIDENT_AUTO_RETRY_MS'),end=source.indexOf('\n/** Start (or restart) the resident.',begin);
assert.ok(begin>0&&end>begin,'auto-retry policy located');
const code=stripTypeScriptTypes(source.slice(begin,end),{mode:'strip'});
function harness(overrides={}){
 const timers=[],starts=[];
 const context=vm.createContext({active:null,residentAlwaysPresent:true,isAndroid:true,testMocksEnabled:false,operation:null,state:{kind:'recovering'},
  setTimeout:(run,ms)=>{timers.push({run,ms});return timers.length;},ensureResident:async()=>{starts.push(1);},...overrides});
 vm.runInContext(code+'\nthis.schedule=scheduleResidentAutoRetry;',context);
 return {context,timers,starts};
}
test('a recovering resident restarts itself with bounded backoff',()=>{
 const {context,timers,starts}=harness();
 for(let i=0;i<6;i++){context.schedule();context.schedule();const next=timers.at(-1);if(next&&!next.fired){next.fired=true;next.run();}}
 assert.deepEqual(timers.map(t=>t.ms),[3000,10000,30000,60000]);
 assert.equal(starts.length,4);
});
test('a running agent resets the attempts and a recovery review never retries',()=>{
 const review=harness({state:{kind:'recovering',residentRecoveryReason:'ipc-recovery-required'}});
 review.context.schedule();assert.equal(review.timers.length,0);
 const running=harness();running.context.schedule();running.timers[0].run();
 running.context.active={};running.context.schedule();running.context.active=null;running.context.schedule();
 assert.deepEqual(running.timers.map(t=>t.ms),[3000,3000]);
 const busy=harness({operation:{}});busy.context.schedule();assert.equal(busy.timers.length,0);
});
