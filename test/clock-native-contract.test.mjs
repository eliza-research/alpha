// Clock handoff, native half (LOOP-C). Host-JVM run of the shared ClockDays fed with the pinned upstream
// validateClockOperation outputs, plus source checks of the plugin wiring. Not Android or Clock-app
// evidence: no AlarmClock intent is resolved or started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

const sharedClock=name=>join(root,'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/clock',name);

const upstream=join(root,'vendor/eliza/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts');

test('upstream-valid repeat days (unordered or empty) are normalized natively, never refused',{skip:jsonJarSkip},async()=>{
 const {validateClockOperation}=await import(upstream);
 const set=days=>({type:'clock_handoff',action:'set',hour:7,minute:30,label:'Wake',timeZone:'America/New_York',...(days===undefined?{}:{days})});
 const cases=[[[3,2],[2,3]],[[],[]],[[7,1,4],[1,4,7]],[[2,3,4,5,6],[2,3,4,5,6]],[[1,2,3,4,5,6,7],[1,2,3,4,5,6,7]]].map(([days,expected])=>{
  const operation=validateClockOperation(set(days));
  assert.deepEqual(operation.days,days,'the pinned upstream contract admits these days as given');
  return {days:operation.days,expected};
 });
 assert.throws(()=>validateClockOperation(set([1,1])),/Duplicate/,'upstream refuses duplicates itself');
 assert.match(runJvm([sharedClock('ClockDays.java'),fixture('ClockContractTest.java')],'ai.alphacompute.alphaphone.ClockContractTest',{json:true,args:[JSON.stringify(cases)]}),/^PASS clock contract/);
});
