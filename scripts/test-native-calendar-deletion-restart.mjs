#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {runNativeFixture} from './native-test-fixture.mjs';
import {requireInstrumentationSuccess} from './instrumentation-result.mjs';

// Requires explicit owned emulator/AVD/ABI environment variables accepted by runNativeFixture.
// Usage: node scripts/test-native-calendar-deletion-restart.mjs ARCHIVE OUTPUT VARIANT undo|expiry
const [archive,output,variant,mode,...extra]=process.argv.slice(2);
assert(archive&&output&&!extra.length);assert(['standalone','launcher'].includes(variant));assert(['undo','expiry'].includes(mode));
const runId=crypto.randomBytes(16).toString('hex'),pkg='ai.elizaresearch.alphaphone',testClass='CalendarDeletionRestartInstrumentedTest';
const args=phase=>['-e','calendarDeletionRestart','1','-e','restartRun',runId,'-e','restartMode',mode,'-e','restartPhase',phase];
await runNativeFixture({scenario:'calendar-deletion-restart',appApk:path.join(archive,variant+'-debug.apk'),testApk:path.join(archive,variant+'-androidTest.apk'),output,testClass,testMethod:'externalRestartPhase',expectedTests:1,requireWebView:false,runnerArgs:args('verify'),
 details:{scope:'Synthetic Calendar event, actual process stop, original ten-second deadline, Undo/expiry and another-process terminal receipt. No native review dialog, real account, invitation or full-image acceptance.',runId,mode},
 prepareVariant:async({run,androidUser})=>{
  assert(androidUser>0);for(const permission of ['READ_CALENDAR','WRITE_CALENDAR'])await run('shell','pm','grant','--user',String(androidUser),pkg,'android.permission.'+permission);
  const raw=await run('shell','am','instrument','--user',String(androidUser),'-w','-r','-e','class',pkg+'.'+testClass+'#externalRestartPhase',...args('prepare'),pkg+'.test/androidx.test.runner.AndroidJUnitRunner');
  fs.writeFileSync(path.join(output,'prepare.log'),raw);assert.equal(requireInstrumentationSuccess(raw,[pkg+'.'+testClass]).totalTests,1);
  await run('shell','am','force-stop','--user',String(androidUser),pkg);
  const processes=await run('shell','ps','-A','-o','PID,NAME');
  assert(!processes.split('\n').some(line=>{const name=line.trim().split(/\s+/).at(-1);return name===pkg||name?.startsWith(pkg+':');}),'Target processes must stop before restart');
  const fixture=JSON.parse(await run('shell','run-as',pkg,'--user',String(androidUser),'cat','files/calendar-restart-'+runId+'.json'));
  assert.equal(fixture.run,runId);assert.equal(fixture.mode,mode);
  const uptime=(await run('shell','cat','/proc/uptime')).trim().split(/\s+/)[0];assert.match(uptime,/^\d+(?:\.\d+)?$/);
  const elapsedMs=Number(uptime)*1000;assert(elapsedMs<fixture.deadline.expiresElapsed,'Process must be stopped before the original expiry');
  fs.writeFileSync(path.join(output,'stopped-before-expiry.json'),JSON.stringify({runId,mode,androidUser,elapsedMs,fixture},null,2));
  if(mode==='expiry')await new Promise(resolve=>setTimeout(resolve,11000));
 },
 collectVariant:async context=>{
  await context.run('shell','am','force-stop','--user',String(context.androidUser),pkg);
  await context.instrumentPhase('replay',args('replay'));
 }
});
