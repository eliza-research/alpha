// Clock handoff, native half (LOOP-C). Host-JVM run of the shared ClockDays fed with the pinned upstream
// validateClockOperation outputs, plus source checks of the plugin wiring. Not Android or Clock-app
// evidence: no AlarmClock intent is resolved or started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

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
 assert.match(runJvm([sharedClock('ClockDays.java'),fixture('ClockContractTest.java')],'ai.elizaresearch.alphaphone.ClockContractTest',{json:true,args:[JSON.stringify(cases)]}),/^PASS clock contract/);
});

test('surfaceInfo, clockHandoff, the shared ClockHandoff.launch and the capability header carry repeat days end to end',()=>{
 const daily=readFileSync(nativeSource('DailyAppsPlugin.java'),'utf8');
 assert.match(daily,/value\.put\("clockRepeatDaysVersion", 1\);/);
 const handoff=daily.slice(daily.indexOf('@PluginMethod public void clockHandoff('),daily.indexOf('@PluginMethod public void capabilities('));
 assert.match(handoff,/"timeZone","days"\)\.contains\(key\)/,'days is an accepted option');
 assert.match(handoff,/ai\.eliza\.plugins\.system\.clock\.ClockHandoff\.launch\(getActivity\(\),"Alpha",/,'the shared reviewed launch, naming Alpha in its messages');
 assert.match(handoff,/call\.getString\("timeZone"\),ai\.eliza\.plugins\.system\.clock\.ClockDays\.strict\(data\.opt\("days"\)\)\)\)\);/,'parsed strictly and passed to the launch');
 assert.match(handoff,/if\(result\.receiver!=null\)out\.put\("package",result\.receiver\);/,'the result names the receiving package');
 for(const name of ['ClockHandoff.java','ClockContract.java'])assert.throws(()=>readFileSync(nativeSource(name)),/ENOENT/,`Alpha keeps no copy of ${name}`);
 const launch=readFileSync(sharedClock('ClockHandoff.java'),'utf8');
 const body=launch.slice(launch.indexOf('public static Result start('));
 assert.match(body,/receiver\(activity\.getPackageName\(\), resolved\.activityInfo\.packageName\)/,'the handler is resolved and the host itself refused');
 assert.match(body,/target\.setComponent\(new ComponentName\(receiver, resolved\.activityInfo\.name\)\);\n\s+activity\.startActivity\(target\);/,'an explicit component is started');
 const review=readFileSync(nativeSource('ClockAgentReview.java'),'utf8');
 assert.match(review,/if\(operation\.has\("days"\)\)ClockDays\.agent\(operation\.get\("days"\)\);/);
 assert.match(review,/ClockDays\.agent\(operation\.opt\("days"\)\)\);/);
 assert.match(review,/ClockHandoff\.receiver\(activity\.getPackageName\(\),resolved\.activityInfo\.packageName\)==null\)return result\(action,"unavailable"\);/);
 const connection=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 assert.match(connection,/"clock\.handoff\.v1","clock\.handoff\.v2"\);/,'the device capability header may advertise v2');
});
