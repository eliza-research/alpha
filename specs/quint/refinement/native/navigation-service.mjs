import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign} from './java.mjs';
import {navigationServicePlatform} from './navigation-service-platform.mjs';

const model='NativeNavigationOwnership';
const modelPath='specs/quint/native/NativeNavigationOwnership.qnt';
export const navigationServiceScenarios=[
 'old-plugin-destroy','notification-owner','stale-start-command','old-notification','same-public-id',
 'fallback-successor','fallback-idle','foreign-stop-update','duplicate-app-stop','malformed-notification',
 'stale-update','old-task-removal','task-removal','home-task-removal','unrelated-assistant-task',
 'unrelated-power-task-after-replacement','assistant-own-task','unattributed-task-removal','unbound-root-uses-exact-owner',
 'old-service-destroy','service-destroy',
 'foreground-refused','old-foreground-refused','dispatch-refused','dispatch-failure-after-replacement',
 'retired-before-admission','refusals'
];
export async function checkNativeNavigationOwnership(extraSources=[]){
 const platform=navigationServicePlatform();
 const compiled=[...['AlphaNavigationService.java','AlphaMapsTransportPlugin.java','PluginWorkers.java'].map(name=>app+name),
  directory+'/NavigationServicePorts.java','node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java',
  ...platform.paths];
 const sources=[modelPath,...compiled,directory+'/NavigationServiceTraces.java',directory+'/navigation-service-platform.mjs',
  directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraceCampaign('NavigationServiceTraces.java',compiled,navigationServiceScenarios.map(name=>[name]));
  return await checkTraces({model,modelPath,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'The entire Java bridge and service execute against controlled command delivery, notification, permission and foreground ports. Regional network transport is disabled.',
   'Two renderer instances, two public session IDs and three internal authorities bound the projection. Actual UUIDs map to ordered admission identities; title and text fixtures remain independent.',
   'Task removal requires the component of the Activity captured at start. HOME and launcher roots of MainActivity share a component. The callback carries no task ID to distinguish two Android tasks with the same component.',
   'Android PendingIntent equivalence is projected as action, explicit service, data URI and request code. Service kill/restart, Binder, physical GPS, notification rendering and unbounded scheduling remain outside this JVM campaign.'
  ]});
 }finally{platform.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkNativeNavigationOwnership(),null,2));
