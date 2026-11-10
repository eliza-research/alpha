import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {androidEnv} from '../toolchain.mjs';
const [mode,appApk,testApk,output='test-results/maps-native-recovery']=process.argv.slice(2),serial=process.env.ANDROID_SERIAL;
if(!['permission','outage'].includes(mode)||!appApk||!testApk||!/^emulator-\d+$/.test(serial||''))throw Error('Usage: explicit ANDROID_SERIAL=emulator-N node scripts/maps/test-native-recovery.mjs permission|outage APP.apk TEST.apk OUTPUT');
const env=androidEnv(),adb=path.join(env.ANDROID_HOME,'platform-tools/adb'),app='ai.elizaresearch.alphaphone';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{env,encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']});
const local=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:5000});
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const evidence={mode,scope:'Actual Android permission UI or controlled owned loopback gateway timeout; synthetic emulator coordinates only',serial,appSha256:digest(appApk),testSha256:digest(testApk),phases:[],passed:false};
let gateway;
if(mode==='outage'){
 gateway=Number(process.env.ALPHA_MAPS_GATEWAY_PID);
 if(!Number.isSafeInteger(gateway)||gateway<=1)throw Error('Outage requires explicit ALPHA_MAPS_GATEWAY_PID');
 const command=local('ps',['-p',String(gateway),'-o','command=']).trim(),uid=Number(local('ps',['-p',String(gateway),'-o','uid=']).trim());
 const listeners=local('lsof',['-nP','-iTCP:47850','-sTCP:LISTEN','-t']).trim().split(/\s+/).map(Number);
 const cwd=local('lsof',['-a','-p',String(gateway),'-d','cwd','-Fn']).split('\n').find(s=>s.startsWith('n'))?.slice(1);
 if(uid!==os.userInfo().uid||!listeners.includes(gateway)||!/(?:^|\/)python(?:3(?:\.\d+)?)?\s/i.test(command)||!command.endsWith('scripts/maps/serve-region.py')||cwd!==process.cwd())throw Error('PID is not the exact owned repository regional gateway listening on47850');
}
fs.mkdirSync(output,{recursive:true});run('install','-r',appApk);run('install','-r',testApk);
const permissions=['android.permission.ACCESS_COARSE_LOCATION','android.permission.ACCESS_FINE_LOCATION'];
const dump=run('shell','dumpsys','package',app);
const previous=permissions.map(permission=>{
 const line=dump.split('\n').find(l=>l.includes(permission+': granted='));if(!line)throw Error('Missing exact runtime permission snapshot');
 if(/SYSTEM_FIXED|POLICY_FIXED|ONE_TIME/.test(line))throw Error('Fixture does not change fixed or one-time permissions');
 return {permission,granted:line.includes('granted=true'),flags:['USER_SET','USER_FIXED'].filter(f=>line.includes(f)).map(f=>f.toLowerCase().replace('_','-'))};
});
let log='',child,failure,paused=false,pauseDeadline=0;
const resume=()=>{if(paused){process.kill(gateway,'SIGCONT');paused=false;}};
const interrupt=()=>{failure=new Error('Recovery runner interrupted');resume();child?.kill();};
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
try{
 if(mode==='permission')for(const {permission} of [...previous].reverse()){run('shell','pm','revoke',app,permission);run('shell','pm','clear-permission-flags',app,permission,'user-set','user-fixed');}
 run('shell','am','force-stop',app);run('shell','run-as',app,'rm','-f','files/maps-navigation-phase.txt','files/maps-navigation-ack.txt');
 const method=mode==='permission'?'deniedLocationAllowsManualOriginAndExplicitPermissionRetry':'configuredGatewayFailureRecoversOnlyAfterExplicitRetry';
 let finished=false;
 child=spawn(adb,['-s',serial,'shell','am','instrument','-w','-r','-e','class',app+'.MapsRegionalInstrumentedTest#'+method,'-e','mapsRegional','1','-e',mode==='permission'?'mapsPermission':'mapsOutage','1',app+'.test/androidx.test.runner.AndroidJUnitRunner'],{env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});child.on('close',()=>{finished=true;});child.on('error',e=>{failure=e;finished=true;});
 const until=Date.now()+180000;let current='';
 while(!finished&&Date.now()<until){
  if(paused&&Date.now()>pauseDeadline){resume();throw Error('Owned gateway pause exceeded bounded25seconds');}
  let phase='';try{phase=run('shell','run-as',app,'sh','-c',"'if [ -f files/maps-navigation-phase.txt ]; then cat files/maps-navigation-phase.txt; fi'").trim();}catch{}
  if(mode==='permission'&&phase==='permission-gps')run('emu','geo','fix','7.4246','43.7384');
  if(phase&&phase!==current){
   const allowed=mode==='permission'?['permission-gps']:['capabilities-stop','capabilities-restore','route-stop','route-restore'];
   if(!allowed.includes(phase))throw Error('Unexpected fixture phase');
   if(phase.endsWith('-stop')){process.kill(gateway,'SIGSTOP');paused=true;pauseDeadline=Date.now()+25000;}
   if(phase.endsWith('-restore'))resume();
   current=phase;evidence.phases.push(phase);run('shell','run-as',app,'sh','-c',`'echo ${phase} > files/maps-navigation-ack.txt'`);
  }
  await new Promise(r=>setTimeout(r,600));
 }
 if(failure)throw failure;
 if(!finished)throw Error('Recovery instrumentation deadline exceeded');
 evidence.passed=/OK \(1 test\)/.test(log)&&!/FAILURES|INSTRUMENTATION_FAILED|Process crashed/.test(log);
 if(!evidence.passed)throw Error('Native recovery failed; inspect instrumentation.txt');
}catch(error){failure=error;evidence.error=error.message;}
finally{
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);resume();if(child?.exitCode===null){child.kill();try{run('shell','am','force-stop',app);}catch{}}
 if(mode==='permission'){
  try{
   for(const {permission,granted} of previous)if(granted)run('shell','pm','grant',app,permission);
   for(const {permission,granted} of [...previous].reverse())if(!granted)run('shell','pm','revoke',app,permission);
   for(const {permission,flags} of previous){run('shell','pm','clear-permission-flags',app,permission,'user-set','user-fixed');if(flags.length)run('shell','pm','set-permission-flags',app,permission,...flags);}
  }catch(error){failure??=error;evidence.passed=false;evidence.restoreError='Permission restoration failed';}
 }
 try{run('shell','run-as',app,'rm','-f','files/maps-navigation-phase.txt','files/maps-navigation-ack.txt');}catch{}
 fs.writeFileSync(path.join(output,'instrumentation.txt'),log);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));
}
if(failure)throw failure;
console.log('PASS actual native Maps '+mode+' recovery');
