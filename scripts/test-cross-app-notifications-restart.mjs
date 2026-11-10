import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {androidEnv} from './toolchain.mjs';
const [appApk,testApk,fixtureDirectory,output]=process.argv.slice(2),serial=process.env.ANDROID_SERIAL;
if(!appApk||!testApk||!fixtureDirectory||!output||!/^emulator-\d+$/.test(serial||''))throw Error('Explicit emulator, archived app/test pair, fixture directory and new output required');
if(fs.existsSync(output))throw Error('Refuse to overwrite existing evidence');
const env=androidEnv(),adb=path.join(env.ANDROID_HOME,'platform-tools/adb'),app=JSON.parse(fs.readFileSync('app.config.json')).appId;
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{env,encoding:'utf8',timeout:args.includes('instrument')?360000:120000,maxBuffer:8*1024*1024});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(appApk)),'apk-manifest.json')));
if(path.dirname(path.resolve(appApk))!==path.dirname(path.resolve(testApk))||manifest[path.basename(appApk)]!==hash(appApk)||manifest[path.basename(testApk)]!==hash(testApk))throw Error('Matching immutable archived APKs required');
const variant=path.basename(appApk).match(/^(standalone|launcher)-debug\.apk$/)?.[1];if(!variant||path.basename(testApk)!==`${variant}-androidTest.apk`)throw Error('Matching distribution pair required');
const fixture=JSON.parse(fs.readFileSync(path.join(fixtureDirectory,'manifest.json'))),signerTool=path.join(env.ANDROID_HOME,'build-tools/36.0.0/apksigner');
const signer=apk=>execFileSync(signerTool,['verify','--print-certs',apk],{env,encoding:'utf8'}).match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1];
const alphaSigner=signer(appApk);if(!alphaSigner)throw Error('Alpha signer unavailable');
const companion=[];
for(const name of ['selected','excluded']){const row=fixture.apks[name],apk=path.join(fixtureDirectory,`${name}.apk`),pkg=`ai.elizaresearch.notificationfixture.${name}`;if(row.packageName!==pkg||row.sha256!==hash(apk)||signer(apk)!==row.signer||row.signer===alphaSigner)throw Error('Unqualified companion identity/hash/signer');if(run('shell','pm','list','packages',pkg).split('\n').some(line=>line.trim()===`package:${pkg}`))throw Error('Refuse preexisting synthetic companion installation');companion.push({apk,pkg,sha256:row.sha256,signer:row.signer});}
const access=run('shell','settings','get','secure','enabled_notification_listeners');if(access.includes(app+'/'))throw Error('Refuse preexisting Alpha notification-listener grant');
fs.mkdirSync(output,{recursive:true});
const runId=crypto.randomUUID(),evidence={variant,serial,runId,appSha256:hash(appApk),testSha256:hash(testApk),companion,phases:[],passed:false,companionCleanup:false,processRestartTested:false,secureLockTested:false,physicalDeviceTested:false};
const phase=name=>{
 let log='';
 try{log=run('shell','am','instrument','-w','-r','-e','class',`${app}.CrossAppNotificationsRestartInstrumentedTest#processPhase`,'-e','crossNotificationsRestart','1','-e','notificationPhase',name,'-e','notificationRunId',runId,`${app}.test/androidx.test.runner.AndroidJUnitRunner`);}
 catch(error){log=String(error.stdout||'')+String(error.stderr||'');fs.writeFileSync(path.join(output,`${name}.txt`),log);throw error;}
 fs.writeFileSync(path.join(output,`${name}.txt`),log);
 const completed=(log.match(/^INSTRUMENTATION_STATUS_CODE: 0\s*$/gm)||[]).length,assumptions=(log.match(/^INSTRUMENTATION_STATUS_CODE: -(?:3|4)\s*$/gm)||[]).length,pid=Number(log.match(/notificationRestartPid=(\d+)/)?.[1]);
 const passed=/OK \(1 test\)/.test(log)&&completed===1&&assumptions===0&&Number.isSafeInteger(pid)&&pid>0&&!/FAILURES|INSTRUMENTATION_FAILED|Process crashed|AssumptionViolated|INSTRUMENTATION_STATUS_CODE: -(?:1|2)/.test(log);
 evidence.phases.push({name,completed,assumptions,pid,passed});
 if(!passed)throw Error(`Notification restart ${name} failed; inspect ${name}.txt`);
 if(evidence.phases.slice(0,-1).some(prior=>prior.pid===pid))throw Error(`Distinct process not proven for ${name}`);
};
let failure,began=false,cleaned=false;const installed=[];
try{
 run('install','-r',appApk);run('install','-r',testApk);
 for(const row of companion){run('install',row.apk);installed.push(row.pkg);}
 fs.writeFileSync(path.join(output,'recovery.json'),JSON.stringify({serial,runId,ownedCompanions:installed,checkpoint:'no_backup/notification-restart-checkpoint.json',alphaListener:`${app}/${app}.AlphaNotificationListener`,cleanupClass:`${app}.CrossAppNotificationsRestartInstrumentedTest#processPhase`},null,2));
 began=true;
 for(const name of ['prepare','restore','pause','restorePaused','resumeAndRevoke','verifyRevoked']){run('shell','am','force-stop',app);phase(name);}
 evidence.processRestartTested=true;evidence.passed=true;
}catch(error){failure=error;evidence.error=error.message;}
finally{
 try{
  if(began){run('shell','am','force-stop',app);phase('cleanup');}
  if(run('shell','settings','get','secure','enabled_notification_listeners').includes(app+'/'))throw Error('Actual Android listener grant remains; exact recovery required');
  cleaned=true;
 }catch(error){failure??=error;evidence.passed=false;evidence.cleanupError=error.message;}
 if(cleaned||!began){
  try{for(const pkg of installed){run('uninstall',pkg);if(run('shell','pm','list','packages',pkg).split('\n').some(line=>line.trim()===`package:${pkg}`))throw Error('Owned companion removal not verified');}evidence.companionCleanup=true;}
  catch(error){failure??=error;evidence.passed=false;evidence.companionCleanupError=error.message;}
 }else evidence.recoveryRequired=true;
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));
}
if(failure)throw failure;
console.log('PASS distinct-PID notification history/capabilities, real mock entry/cold restore/explicit resume, Android revoke/cold restore and exact owned cleanup. Secure lock not tested.');
