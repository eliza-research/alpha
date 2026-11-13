import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {app, directory, javaTraceCampaign} from '../specs/quint/refinement/native/java.mjs';
import {navigationServicePlatform} from '../specs/quint/refinement/native/navigation-service-platform.mjs';

const model='NativeNavigationOwnership';
const modelPath='specs/quint/native/NativeNavigationOwnership.qnt';
const navigationServiceScenarios=[
 'old-plugin-destroy','notification-owner','stale-start-command','old-notification','same-public-id',
 'fallback-successor','fallback-idle','foreign-stop-update','duplicate-app-stop','malformed-notification',
 'stale-update','old-task-removal','task-removal','home-task-removal','unrelated-assistant-task',
 'unrelated-power-task-after-replacement','assistant-own-task','unattributed-task-removal','unbound-root-uses-exact-owner',
 'old-service-destroy','service-destroy',
 'foreground-refused','old-foreground-refused','dispatch-refused','dispatch-failure-after-replacement',
 'retired-before-admission','refusals'
];
async function checkNativeNavigationOwnership(extraSources=[]){
 const platform=navigationServicePlatform();
 const compiled=[...['AlphaNavigationService.java','AlphaMapsTransportPlugin.java','PluginWorkers.java'].map(name=>app+name),
  directory+'/NavigationServicePorts.java','node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java',
  ...platform.paths];
 const sources=[modelPath,...compiled,directory+'/NavigationServiceTraces.java',directory+'/navigation-service-platform.mjs',
  directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraceCampaign('NavigationServiceTraces.java',compiled,navigationServiceScenarios.map(name=>[name]));
  return await checkTraces({model,modelPath,sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'The entire Java bridge and service execute against controlled command delivery, notification, permission and foreground ports. The bridge has no regional network transport.',
   'Two renderer instances, two public session IDs and three internal authorities bound the projection. Actual UUIDs map to ordered admission identities; title and text fixtures remain independent.',
   'Task removal requires the component of the Activity captured at start. HOME and launcher roots of MainActivity share a component. The callback carries no task ID to distinguish two Android tasks with the same component.',
   'Android PendingIntent equivalence is projected as action, explicit service, data URI and request code. Service kill/restart, Binder, physical GPS, notification rendering and unbounded scheduling remain outside this JVM campaign.'
  ]});
 }finally{platform.close();}
}

test('native Maps service keeps terminal and notification authority with the exact session', {timeout:180000},async()=>{
 const receipt=await checkNativeNavigationOwnership(['test/quint-native-navigation-ownership.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,navigationServiceScenarios.length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.invariant,'safety');
 for(const action of ['start','destroy','deliver','press','fallback','supersededStart','stop','update'])
  assert.ok(receipt.actions[action]>0,action);
 const after=name=>receipt.traceInputs.find(trace=>trace.name==='native-navigation-'+name).steps.at(-1).expect;
 assert.equal(after('old-plugin-destroy')['s.owner'],2);
 assert.equal(after('stale-start-command')['s.shown'],true);
 assert.equal(after('old-notification')['s.owner'],2);
 assert.equal(after('fallback-successor')['s.fallbackStops'],0);
 assert.equal(after('retired-before-admission')['s.issued'],1);
 assert.equal(after('retired-before-admission')['s.lastCall'],'unavailable');
 for(const name of ['unrelated-assistant-task','unrelated-power-task-after-replacement','unattributed-task-removal']){
  assert.equal(after(name)['s.shown'],true,name);
  assert.equal(after(name)['s.rootComponent'],'main',name);
 }
 for(const name of ['home-task-removal','task-removal','assistant-own-task']){
  assert.equal(after(name)['s.active'],0,name);
  assert.equal(after(name)['s.lastReason'],'task-removed',name);
 }
 const assistant=receipt.traceInputs.find(trace=>trace.name==='native-navigation-assistant-own-task');
 assert.equal(assistant.steps.at(-2).expect['s.shown'],true,'MainActivity root leaves the assistant-owned session active');
 assert.equal(after('unbound-root-uses-exact-owner')['s.lastReason'],'renderer-closed');
});
