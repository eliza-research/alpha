import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createCombinedDeviceRunner,requireCombinedCase} from '../scripts/combined-agent-device.mjs';

function fixture(t,{hangStartupDelay=0}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-combined-command-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const adb=path.join(dir,'adb'),pidFile=path.join(dir,'pid');
  fs.writeFileSync(adb,`#!${process.execPath}
import fs from 'node:fs';
const mode=process.argv[4];
if(mode==='hang'){
  await new Promise(resolve=>setTimeout(resolve,${hangStartupDelay}));
  process.on('SIGTERM',()=>process.stdout.write('combinedStage=term-handled\\n'));
  setInterval(()=>{},1000);
  fs.writeFileSync(process.argv[5],String(process.pid));
  process.stdout.write('combinedStage=term-ready\\n');
} else {
fs.writeFileSync(process.argv[5],String(process.pid));
if(mode==='stdout'||mode==='stderr'){process[mode].write('x'.repeat(8192));}
else if(mode==='fail'){process.stderr.write('private fixture bytes');process.exitCode=1;}
else {let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{process.stdout.write('INSTRUMENTATION_STATUS: combinedSta');setTimeout(()=>process.stdout.write('ge=paired\\r\\n'+text),10);});}
}
`,{mode:0o700});
  return {adb,pidFile};
}
function runner(adb,options={}) {return createCombinedDeviceRunner({adb,serial:'emulator-9999',env:process.env,onStage:()=>{},...options});}
function dead(pidFile) {const pid=Number(fs.readFileSync(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});}

test('device runner preserves private stdin and reports a split progress line once',async t=>{
  const {adb,pidFile}=fixture(t),stages=[];
  const output=await runner(adb,{onStage:stage=>stages.push(stage)})(['echo',pidFile],'fixture body');
  assert.equal(output,'INSTRUMENTATION_STATUS: combinedStage=paired\r\nfixture body');
  assert.deepEqual(stages,['paired']);dead(pidFile);
});
test('timeout kills a TERM-resistant child before returning failure',async t=>{
  // execFile's clock includes Node startup. Prove readiness within a separate
  // finite fixture budget, then retain a full second of TERM-resistant running.
  const startupBudget=3000,executionWindow=1000;
  const {adb,pidFile}=fixture(t,{hangStartupDelay:1200}),stages=[];
  const started=performance.now();let readyAt;
  await assert.rejects(runner(adb,{
    timeout:startupBudget+executionWindow,
    onStage:stage=>{
      stages.push(stage);
      if(stage==='term-ready'){
        readyAt=performance.now();
        process.kill(Number(fs.readFileSync(pidFile,'utf8')),'SIGTERM');
      }
    },
  })(['hang',pidFile]),/execution bound/);
  assert.deepEqual(stages,['term-ready','term-handled'],'fixture must start and actually resist SIGTERM before timeout');
  assert.ok(readyAt-started<=startupBudget,'fixture startup exceeded its finite budget');
  assert.ok(performance.now()-readyAt>=executionWindow,'timeout must exercise the ready child for the execution window');
  dead(pidFile);
});
for(const mode of ['stdout','stderr'])test(`oversized ${mode} fails even if the child would exit successfully`,async t=>{
  const {adb,pidFile}=fixture(t);
  await assert.rejects(runner(adb,{maxBuffer:1024})([mode,pidFile]),/execution bound/);dead(pidFile);
});
test('spawn and exit failures do not include captured private fixture data',async t=>{
  const {adb,pidFile}=fixture(t);
  for(const run of [()=>runner(adb)(['fail',pidFile]),()=>runner(adb+'-missing')([])]) {
    await assert.rejects(run,error=>{assert.doesNotMatch(String(error),/private fixture bytes/);return /execution bound/.test(error.message);});
  }
});
const app='ai.elizaresearch.alphaphone',cls='CombinedAgentRestartInstrumentedTest',method='verifyAfterBothProcessesRestart';
const status=code=>`INSTRUMENTATION_STATUS: class=${app}.${cls}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const progress='INSTRUMENTATION_STATUS: combinedStage=paired\nINSTRUMENTATION_STATUS_CODE: 0\n';
const success=status(1)+progress+status(0)+'OK (1 test)\nINSTRUMENTATION_CODE: -1\n';
test('upstream parser verifies the exact case despite product progress bundles',()=>{
  assert.deepEqual(requireCombinedCase(success,app,cls,method).cases,[`${app}.${cls}#${method}`]);
});
test('summary, wrong method, skipped status and malformed advisory bundles cannot prove success',()=>{
  for(const text of ['OK (1 test)\n',success.replaceAll(method,'differentMethod'),success.replace(status(0),status(-3)),success.replace(progress,progress.replace('CODE: 0','CODE: -1')),success+progress,success.replace(progress,progress.replace('combinedStage=paired','class=unrequested'))]) {
    assert.throws(()=>requireCombinedCase(text,app,cls,method));
  }
});
