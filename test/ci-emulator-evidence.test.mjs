import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as parseYaml} from 'yaml';
import {AVD,READING_CLASSES,SERIAL,runSuite,suitePlan,summarize} from '../scripts/ci/emulator-suite.ts';
import {CLASS_REGISTRY,DEFAULT_CLASSES,parseInstrumentationArgs} from '../scripts/android-instrumentation.ts';

const read=file=>fs.readFileSync(file,'utf8');
const WORKFLOW='.github/workflows/android-emulator.yml';
const workflow=read(WORKFLOW);
const emulatorJobs=['instrumentation','browser-reading'];
const suites=['instrumentation','browser-reading'];
const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'7'};

test('only the admitted release workflows may sign or publish',()=>{
 const release=parseYaml(read('.github/workflows/release.yml'));
  assert.deepEqual(release.permissions,{});
  assert.deepEqual(Object.keys(release.on),['workflow_dispatch']);
  assert.deepEqual(release.on.workflow_dispatch.inputs.operation.options,['signing-proof','sign','publish']);
  assert.deepEqual(Object.keys(release.jobs),['signing-proof','admit-signing','sign','admit-publication','publish']);
  assert.deepEqual(release.concurrency,{group:"${{ inputs.operation == 'publish' && 'alpha-app-stable-publication' || 'release-signing' }}",'cancel-in-progress':false});
  const guard=operation=>`github.repository_id == '1396333361' && github.ref == 'refs/heads/main' && inputs.operation == '${operation}' && inputs.workflow_commit == github.sha`;
  assert.deepEqual(release.jobs['signing-proof'].permissions,{contents:'read'});
  assert.equal(release.jobs['signing-proof'].environment,'release');
  assert.equal(release.jobs['signing-proof'].if,guard('signing-proof'));
  assert.deepEqual(release.jobs['admit-signing'].permissions,{actions:'read',contents:'read'});
  assert.equal(release.jobs['admit-signing'].if,guard('sign'));
  assert.equal(release.jobs['admit-signing'].environment,undefined);
  const sign=release.jobs.sign;
  assert.deepEqual(sign.permissions,{actions:'read',contents:'read','id-token':'write'});
  assert.equal(sign.environment,'release');
  assert.equal(sign.needs,'admit-signing');
  assert.equal(sign.if,"needs.admit-signing.result == 'success' && needs.admit-signing.outputs.plan_sha256 != '' && inputs.operation == 'sign' && inputs.workflow_commit == github.sha");
  assert.deepEqual(release.jobs['admit-publication'].permissions,{contents:'read',actions:'read'});
  assert.equal(release.jobs['admit-publication'].if,guard('publish'));
  assert.equal(release.jobs['admit-publication'].environment,undefined);
  const publish=release.jobs.publish;
  assert.deepEqual(publish.permissions,{actions:'read',contents:'write','id-token':'write'});
  assert.equal(publish.environment,'release');
  assert.equal(publish.needs,'admit-publication');
  assert.equal(publish.if,"needs.admit-publication.result == 'success' && needs.admit-publication.outputs.qualification_sha256 != '' && inputs.operation == 'publish' && inputs.workflow_commit == github.sha");
 const ota=parseYaml(read('.github/workflows/release-os-ota-signing.yml'));
 assert.deepEqual(ota.permissions,{});
 assert.deepEqual(Object.keys(ota.on),['workflow_dispatch']);
 assert.deepEqual(Object.keys(ota.jobs),['sign']);
 assert.deepEqual(ota.jobs.sign.permissions,{contents:'read','id-token':'write'});
 assert.equal(ota.jobs.sign.environment,'release');
 assert.equal(ota.jobs.sign.if,"github.repository_id == '1396333361' && github.ref == 'refs/heads/main' && inputs.workflow_commit == github.sha");
 assert.deepEqual(ota.concurrency,{group:'preserving-os-ota-signing','cancel-in-progress':false});

});

/** A results.json as the instrumentation runner writes it, at the path a step names. */
function results(root,step,statuses){
 const file=path.join(root,step.results);fs.mkdirSync(path.dirname(file),{recursive:true});
 const classes=Object.entries(statuses).map(([name,status])=>({variant:'launcher',class:`ai.alphacompute.alphaphone.${name}InstrumentedTest`,status,failed:status==='failed'?['m']:[]}));
 fs.writeFileSync(file,JSON.stringify({passed:classes.every(row=>row.status==='passed'),classes}));
}
function inDirectory(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'emulator-suite-')));const previous=process.cwd();process.chdir(root);t.after(()=>{process.chdir(previous);fs.rmSync(root,{recursive:true,force:true});});return root;}
test('suite run: preparation failure stops it; evidence steps are independent; any class that did not pass fails it',t=>{
 const root=inDirectory(t);
 let calls=[];
 const failing=runSuite('browser-reading',{environment:hosted,execute:(command,env)=>{calls.push([command,env]);const step=suitePlan('browser-reading').find(row=>row.command===command||JSON.stringify(row.command)===JSON.stringify(command));
  if(step.name==='ci-reading'){results(root,step,{BrowserReadingNavigation:'failed'});return 1;}
  return 0;}});
 assert.equal(calls.length,3);assert.deepEqual(calls[1][1],{ANDROID_SERIAL:'emulator-5554',ALPHA_DISPOSABLE_WEBVIEW_FIXTURE:'api35-default-x86_64'});
 assert.deepEqual(failing.steps.map(row=>row.status),['passed','passed','failed']);assert.equal(failing.passed,false);
 assert.deepEqual(failing.steps[2].evidence.classes[0],{variant:'launcher',class:'BrowserReadingNavigation',status:'failed',failed:['m']});
 assert.equal(failing.evidenceClass,'E');assert.equal(failing.commit,'a'.repeat(40));
 const summary=summarize(failing);assert.match(summary,/`browser-reading`: FAILED/);assert.match(summary,/\| launcher \| BrowserReadingNavigation \| failed \|/);assert.match(summary,/Not a distributable build, a device or acceptance/);

 // A provider that cannot be installed stops the suite: the reading classes are not run on WebView 124.
 fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});calls=[];
 const stopped=runSuite('browser-reading',{environment:hosted,execute:command=>{calls.push(command);return command.includes('scripts/prepare-ci-webview.ts')?1:0;}});
 assert.equal(calls.length,2);assert.deepEqual(stopped.steps.map(row=>row.status),['passed','failed','not-run']);assert.equal(stopped.passed,false);

 // A skipped or missing class is not a pass, whatever the exit status says; neither is a run that left no record.
 for(const [status,exit] of [['skipped',0],['missing',0],['passed',1]]){
  fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});
  const report=runSuite('instrumentation',{environment:hosted,execute:command=>{
   if(command[0]!=='bun')return 0;
   results(root,suitePlan('instrumentation')[1],Object.fromEntries(DEFAULT_CLASSES.map(name=>[name,name==='Shell'?status:'passed'])));return exit;
  }});
  assert.equal(report.passed,false,`${status}/${exit}`);assert.equal(report.steps[1].status,'failed',`${status}/${exit}`);
 }
 fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});
 const silent=runSuite('instrumentation',{environment:hosted,execute:()=>0});
 assert.equal(silent.passed,false);assert.match(silent.steps[1].error,/results\.json was not written/);

 fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});
 const records=[];
 const passing=runSuite('instrumentation',{environment:hosted,record:value=>records.push(JSON.parse(JSON.stringify(value))),execute:command=>{
  if(command[0]!=='bun')return 0;
  results(root,suitePlan('instrumentation')[1],Object.fromEntries(DEFAULT_CLASSES.map(name=>[name,'passed'])));
  return 0;
 }});
 assert.equal(passing.passed,true);assert.match(summarize(passing),/`instrumentation`: passed/);
 assert.equal(records.at(-1).passed,true);assert.equal(records[0].passed,false,'the record is written after every step and is not a pass until the end');
 // Outside a hosted runner emulator-5554 may be someone's emulator.
 assert.throws(()=>runSuite('instrumentation',{environment:{},execute:()=>{throw new Error('must not run');}}),/only on a GitHub-hosted runner/);
});

test('the suite command refuses to start, and writes nothing, outside a hosted runner',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'emulator-suite-cli-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const env={PATH:process.env.PATH,HOME:process.env.HOME};
 for(const suite of suites){
  const run=spawnSync(process.execPath,[path.resolve('scripts/ci/emulator-suite.ts'),suite],{cwd:root,env,encoding:'utf8'});
  assert.notEqual(run.status,0,suite);assert.match(run.stderr,/only on a GitHub-hosted runner/,suite);
 }
 const unknown=spawnSync(process.execPath,[path.resolve('scripts/ci/emulator-suite.ts'),'all'],{cwd:root,env:{...env,GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'},encoding:'utf8'});
 assert.notEqual(unknown.status,0);assert.match(unknown.stderr,/Unknown suite/);
 assert.deepEqual(fs.readdirSync(root),[]);
});

test('suite plans: default classes; reading classes with the gates they need',()=>{
 const instrumentation=suitePlan('instrumentation');
 assert.deepEqual(instrumentation.map(step=>[step.name,step.kind]),[['prepare-emulator','preparation'],['ci-default','evidence']]);
 // `bun run test:android:instrumentation` with no --classes: the runner's own default list.
 assert.deepEqual(instrumentation[1].command,['bun','run','test:android:instrumentation','--','--owned-emulator','--avd','test','--serial','emulator-5554','--output','test-results/android-instrumentation/ci-default']);
 const parsed=parseInstrumentationArgs(instrumentation[1].command.slice(4));
 assert.equal(parsed.classes.length,DEFAULT_CLASSES.length);

 const reading=suitePlan('browser-reading');
 assert.deepEqual(reading.map(step=>step.name),['prepare-emulator','prepare-webview','ci-reading']);
 assert.deepEqual(reading[1].command.slice(1),['scripts/prepare-ci-webview.ts']);
 assert.deepEqual(reading[1].env,{ANDROID_SERIAL:'emulator-5554',ALPHA_DISPOSABLE_WEBVIEW_FIXTURE:'api35-default-x86_64'});
 assert.deepEqual(reading[0].command.slice(1),['scripts/prepare-ci-emulator.ts']);
 assert.deepEqual(READING_CLASSES,['BrowserReadingNavigation']);
 assert.ok(!READING_CLASSES.includes('BrowserPageQuestion'),'a fresh signed-out fixture cannot qualify the account-gated journey');
 const parsedReading=parseInstrumentationArgs(reading[2].command.slice(4));
 assert.deepEqual(parsedReading.classes.map(name=>name.split('.').at(-1)),READING_CLASSES.map(name=>name+'InstrumentedTest'));
 assert.deepEqual(Object.fromEntries(READING_CLASSES.map(name=>[name,CLASS_REGISTRY[name].args])),{BrowserReadingNavigation:{browserIsolatedReading:'1'}});

 assert.throws(()=>suitePlan('all'),/Unknown suite/);assert.throws(()=>suitePlan('resident'),/Unknown suite/);
 assert.equal(SERIAL,'emulator-5554');assert.equal(AVD,'test');
});
