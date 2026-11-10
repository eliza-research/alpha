import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {androidEnv} from '../toolchain.mjs';
const [appApk,testApk,output='test-results/maps-native-navigation']=process.argv.slice(2);
const serial=process.env.ANDROID_SERIAL;
if(!appApk||!testApk||!/^emulator-\d+$/.test(serial||''))throw Error('Explicit emulator serial and matching APP.apk TEST.apk required');
const env=androidEnv(),adb=path.join(env.ANDROID_HOME,'platform-tools/adb'),app='ai.elizaresearch.alphaphone';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const evidence={scope:'Public Monaco simulator GPS through actual Android location provider; foreground guidance plus a screen-off phase with a single notification Stop; not physical navigation',serial,appSha256:digest(appApk),testSha256:digest(testApk),phases:[],passed:false};
fs.mkdirSync(output,{recursive:true});
const places=await fetch('http://127.0.0.1:47850/search?q=Casino%20de%20Monte%20Carlo',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
const destination=places.find(p=>p.name==='Casino de Monte Carlo')?.coordinate;
if(!destination||destination.latitude<43.724||destination.latitude>43.752||destination.longitude<7.409||destination.longitude>7.449)throw Error('Actual Monaco destination unavailable');
// The screen-off phase moves the device to a real maneuver point on the same drive route.
const origin={latitude:43.7384,longitude:7.4246};
const route=await fetch('http://127.0.0.1:47850/route?'+new URLSearchParams({from:`${origin.latitude},${origin.longitude}`,to:`${destination.latitude},${destination.longitude}`,mode:'drive'}),{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
const moving=route.steps?.[Math.min(2,route.steps.length-2)]?.coordinate;
if(!moving)throw Error('Actual Monaco route unavailable');
run('install','-r',appApk);run('install','-r',testApk);
const permissions=['android.permission.ACCESS_COARSE_LOCATION','android.permission.ACCESS_FINE_LOCATION','android.permission.POST_NOTIFICATIONS'];
const dump=run('shell','dumpsys','package',app);
const previous=permissions.map(permission=>({permission,granted:new RegExp(permission.replaceAll('.','\\.')+': granted=true').test(dump)}));
let child,log='',failure;
try{
 for(const {permission} of previous)run('shell','pm','grant',app,permission);
 run('shell','run-as',app,'rm','-f','files/maps-navigation-phase.txt','files/maps-navigation-ack.txt');
 let finished=false;
 child=spawn(adb,['-s',serial,'shell','am','instrument','-w','-r','-e','class',app+'.MapsRegionalInstrumentedTest#foregroundNavigationUsesRealGpsAndReleasesNativeWatches,'+app+'.MapsBackgroundNavigationInstrumentedTest#screenOffGuidanceContinuesAndNotificationStopEndsOnce','-e','mapsRegional','1','-e','mapsNavigation','1','-e','mapsBackground','1',app+'.test/androidx.test.runner.AndroidJUnitRunner'],{env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});child.on('close',()=>{finished=true;});child.on('error',e=>{failure=e;finished=true;});
 const until=Date.now()+300000;let current='',point=origin;
 while(!finished&&Date.now()<until){
  let phase='';try{phase=run('exec-out','run-as',app,'cat','files/maps-navigation-phase.txt').trim();}catch{}
  if(['origin','origin-again','off-route','arrival','background-origin','background-moving'].includes(phase)){
   point=phase==='off-route'?{latitude:43.725,longitude:7.410}:phase==='arrival'?destination:phase==='background-moving'?moving:origin;
   run('emu','geo','fix',String(point.longitude),String(point.latitude));
   if(phase!==current){current=phase;evidence.phases.push(phase);run('shell','run-as',app,'sh','-c',`'echo ${phase} > files/maps-navigation-ack.txt'`);}
  }
  await new Promise(r=>setTimeout(r,700));
 }
 if(!finished){child.kill();run('shell','am','force-stop',app);throw Error('Navigation instrumentation deadline exceeded');}
 evidence.passed=/OK \(2 tests\)/.test(log)&&!/FAILURES|INSTRUMENTATION_FAILED|Process crashed/.test(log)&&evidence.phases.includes('background-moving');
 if(!evidence.passed)throw Error('Native navigation failed; inspect instrumentation.txt');
}catch(error){failure=error;evidence.error=error.message;}
finally{
 for(const {permission,granted} of previous)if(!granted){try{run('shell','pm','revoke',app,permission);}catch(error){failure??=error;evidence.passed=false;}}
 try{run('shell','run-as',app,'rm','-f','files/maps-navigation-phase.txt','files/maps-navigation-ack.txt');}catch{}
 fs.writeFileSync(path.join(output,'instrumentation.txt'),log);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));
}
if(failure)throw failure;
console.log('PASS simulator GPS foreground guidance, off-route, arrival, Stop/leave watch cleanup, no automatic resume, and screen-off guidance with one notification Stop');
