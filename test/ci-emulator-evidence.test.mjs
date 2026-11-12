import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as parseYaml} from 'yaml';
import {AVD,BROWSER_CONTROLS_CLASSES,READING_CLASSES,READING_TEST_MOCKS_CLASSES,SERIAL,runSuite,suitePlan,summarize} from '../scripts/ci/emulator-suite.ts';
import {CLASS_REGISTRY,DEFAULT_CLASSES,parseInstrumentationArgs} from '../scripts/android-instrumentation.ts';

const read=file=>fs.readFileSync(file,'utf8');
const WORKFLOW='.github/workflows/android-emulator.yml';
const workflow=read(WORKFLOW);
const emulatorJobs=['instrumentation','browser-reading'];
const suites=['instrumentation','browser-reading','browser-controls'];
const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'7'};

test('emulator jobs restore both APK pairs from the archive root at artifacts',()=>{
 const jobs=parseYaml(workflow).jobs;
 const upload=jobs.build.steps.find(step=>step.id==='apks');
 const appFiles=['standalone-debug.apk','launcher-debug.apk'];
 const testFiles=['standalone-androidTest.apk','launcher-androidTest.apk'];
 const archivedFiles=['apk-manifest.json',...appFiles,...testFiles.map(file=>`instrumentation/${file}`),
  'test-mocks/apk-manifest.json',...[...appFiles,...testFiles].map(file=>`test-mocks/${file}`)];
 // upload-artifact strips the common artifacts directory. The flag-off manifest anchors that root
 // whether or not the browser suites add the separate test-mocks pair.
 assert.deepEqual(upload.with.path.trim().split('\n'),[
  'artifacts/apk-manifest.json',...appFiles.map(file=>`artifacts/${file}`),'artifacts/instrumentation/*.apk',
  'artifacts/test-mocks/apk-manifest.json','artifacts/test-mocks/*-debug.apk','artifacts/test-mocks/*-androidTest.apk',
 ]);
 for(const name of emulatorJobs){
  const {with: download}=jobs[name].steps.find(step=>step.with?.['artifact-ids']==='${{ needs.build.outputs.artifact_id }}');
  assert.equal(download['merge-multiple'],true,name);
  assert.deepEqual(archivedFiles.map(file=>path.posix.join(download.path,file)),archivedFiles.map(file=>`artifacts/${file}`),name);
 }
});

test('browser controls are opt-in and record the three exact classes on both test-mocks variants',()=>{
 const browser=parseYaml(workflow).jobs['browser-reading'];
 assert.equal(browser.env.BROWSER_SUITE,"${{ inputs.suite == 'browser-controls' && 'browser-controls' || 'browser-reading' }}");
 assert.equal(browser.steps.find(step=>step.with?.script).with.script,'bun scripts/ci/emulator-suite.ts ${{ env.BROWSER_SUITE }}');
 assert.match(browser.steps.find(step=>step.uses?.startsWith('actions/upload-artifact@')).with.name,/^android-emulator-\$\{\{ env\.BROWSER_SUITE \}\}-/);
 const controls=suitePlan('browser-controls');
 assert.deepEqual(controls.slice(0,2),suitePlan('browser-reading').slice(0,2),'uses the same pinned WebView preparation');
 assert.deepEqual(controls.map(step=>step.name),['prepare-emulator','prepare-webview','ci-browser-controls']);
 const options=parseInstrumentationArgs(controls[2].command.slice(4));
 assert.deepEqual(BROWSER_CONTROLS_CLASSES,['BrowserDownload','BrowserAutofill','PasswordBrowserFill']);
 assert.deepEqual(options.classes.map(name=>name.split('.').at(-1)),BROWSER_CONTROLS_CLASSES.map(name=>`${name}InstrumentedTest`));
 assert.deepEqual(options.variants,['standalone','launcher']);
 assert.equal(options.testMocks,true);
 assert.equal(options.apkDir,'artifacts/test-mocks');
 assert.equal(controls[2].results,'test-results/android-instrumentation/ci-browser-controls/results.json');
});

test('suite plans: default classes; reading classes with the builds and gates they need',()=>{
 const instrumentation=suitePlan('instrumentation');
 assert.deepEqual(instrumentation.map(step=>[step.name,step.kind]),[['prepare-emulator','preparation'],['ci-default','evidence']]);
 // `bun run test:android:instrumentation` with no --classes: the runner's own default list, both distributions.
 assert.deepEqual(instrumentation[1].command,['bun','run','test:android:instrumentation','--','--owned-emulator','--avd','test','--serial','emulator-5554','--output','test-results/android-instrumentation/ci-default']);
 const parsed=parseInstrumentationArgs(instrumentation[1].command.slice(4));
 assert.deepEqual(parsed.variants,['standalone','launcher']);assert.equal(parsed.classes.length,DEFAULT_CLASSES.length);assert.equal(parsed.testMocks,false);

 const reading=suitePlan('browser-reading');
 assert.deepEqual(reading.map(step=>step.name),['prepare-emulator','prepare-webview','ci-reading','ci-reading-test-mocks']);
 assert.deepEqual(reading[1].command.slice(1),['scripts/prepare-ci-webview.ts']);
 assert.deepEqual(reading[1].env,{ANDROID_SERIAL:'emulator-5554',ALPHA_DISPOSABLE_WEBVIEW_FIXTURE:'api35-default-x86_64'});
 assert.deepEqual(reading[0].command.slice(1),['scripts/prepare-ci-emulator.ts']);
 assert.deepEqual([...READING_CLASSES,...READING_TEST_MOCKS_CLASSES].sort(),['BrowserIsolatedReading','BrowserPageQuestion','BrowserReading','BrowserReadingNavigation','BrowserSensitiveReading']);
 // The runner itself accepts both invocations, on both distributions, with each class's own gate.
 const flagOff=parseInstrumentationArgs(reading[2].command.slice(4)),mocks=parseInstrumentationArgs(reading[3].command.slice(4));
 assert.equal(flagOff.testMocks,false);assert.equal(mocks.testMocks,true);assert.equal(mocks.apkDir,'artifacts/test-mocks');
 assert.deepEqual(flagOff.classes.map(name=>name.split('.').at(-1)),READING_CLASSES.map(name=>name+'InstrumentedTest'));
 assert.deepEqual(mocks.classes.map(name=>name.split('.').at(-1)),READING_TEST_MOCKS_CLASSES.map(name=>name+'InstrumentedTest'));
 for(const name of READING_TEST_MOCKS_CLASSES)assert.equal(CLASS_REGISTRY[name].requiresTestMocksBuild,true,name);
 for(const name of READING_CLASSES)assert.notEqual(CLASS_REGISTRY[name].requiresTestMocksBuild,true,name);
 assert.deepEqual(Object.fromEntries([...READING_CLASSES,...READING_TEST_MOCKS_CLASSES].map(name=>[name,CLASS_REGISTRY[name].args])),{BrowserReadingNavigation:{browserIsolatedReading:'1'},BrowserPageQuestion:{browserPageQuestion:'1'},BrowserReading:{browserReading:'1'},BrowserSensitiveReading:{browserSensitiveReading:'1'},BrowserIsolatedReading:{browserIsolatedReading:'1'}});
 // The negative class needs a provider WITHOUT isolated worlds; it must not share this fixture.
 assert.ok(![...READING_CLASSES,...READING_TEST_MOCKS_CLASSES].includes('BrowserUnsupportedReading'));

 assert.throws(()=>suitePlan('all'),/Unknown suite/);assert.throws(()=>suitePlan('resident'),/Unknown suite/);
 assert.equal(SERIAL,'emulator-5554');assert.equal(AVD,'test');
});

/** A results.json as the instrumentation runner writes it, at the path a step names. */
function results(root,step,statuses){
 const file=path.join(root,step.results);fs.mkdirSync(path.dirname(file),{recursive:true});
 const classes=Object.entries(statuses).map(([name,status])=>({variant:'standalone',class:`ai.alphacompute.alphaphone.${name}InstrumentedTest`,status,failed:status==='failed'?['m']:[]}));
 fs.writeFileSync(file,JSON.stringify({passed:classes.every(row=>row.status==='passed'),classes}));
}
function inDirectory(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'emulator-suite-')));const previous=process.cwd();process.chdir(root);t.after(()=>{process.chdir(previous);fs.rmSync(root,{recursive:true,force:true});});return root;}

test('suite run: preparation failure stops it; evidence steps are independent; any class that did not pass fails it',t=>{
 const root=inDirectory(t);
 // Both evidence runs execute although the first has a failed class.
 let calls=[];
 const failing=runSuite('browser-reading',{environment:hosted,execute:(command,env)=>{calls.push([command,env]);const step=suitePlan('browser-reading').find(row=>row.command===command||JSON.stringify(row.command)===JSON.stringify(command));
  if(step.name==='ci-reading'){results(root,step,{BrowserReadingNavigation:'failed',BrowserPageQuestion:'passed'});return 1;}
  if(step.name==='ci-reading-test-mocks'){results(root,step,{BrowserReading:'passed',BrowserSensitiveReading:'passed',BrowserIsolatedReading:'passed'});return 0;}
  return 0;}});
 assert.equal(calls.length,4);assert.deepEqual(calls[1][1],{ANDROID_SERIAL:'emulator-5554',ALPHA_DISPOSABLE_WEBVIEW_FIXTURE:'api35-default-x86_64'});
 assert.deepEqual(failing.steps.map(row=>row.status),['passed','passed','failed','passed']);assert.equal(failing.passed,false);
 assert.deepEqual(failing.steps[2].evidence.classes[0],{variant:'standalone',class:'BrowserReadingNavigation',status:'failed',failed:['m']});
 assert.equal(failing.evidenceClass,'E');assert.equal(failing.commit,'a'.repeat(40));
 const summary=summarize(failing);assert.match(summary,/`browser-reading`: FAILED/);assert.match(summary,/\| standalone \| BrowserReadingNavigation \| failed \|/);assert.match(summary,/Not a distributable build/);

 // A provider that cannot be installed stops the suite: the reading classes are not run on WebView 124.
 fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});calls=[];
 const stopped=runSuite('browser-reading',{environment:hosted,execute:command=>{calls.push(command);return command.includes('scripts/prepare-ci-webview.ts')?1:0;}});
 assert.equal(calls.length,2);assert.deepEqual(stopped.steps.map(row=>row.status),['passed','failed','not-run','not-run']);assert.equal(stopped.passed,false);

 // A skipped or missing class is not a pass, whatever the exit status says; neither is a run that left no record.
 for(const [status,exit] of [['skipped',0],['missing',0],['passed',1]]){
  fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});
  const report=runSuite('instrumentation',{environment:hosted,execute:command=>{const step=suitePlan('instrumentation')[1];if(command[0]==='bun'){results(root,step,{Shell:'passed',TextScale:status});return exit;}return 0;}});
  assert.equal(report.passed,false,`${status}/${exit}`);assert.equal(report.steps[1].status,'failed',`${status}/${exit}`);
 }
 fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});
 const silent=runSuite('instrumentation',{environment:hosted,execute:()=>0});
 assert.equal(silent.passed,false);assert.match(silent.steps[1].error,/results\.json was not written/);

 fs.rmSync(path.join(root,'test-results'),{recursive:true,force:true});
 const records=[];
 const passing=runSuite('instrumentation',{environment:hosted,record:value=>records.push(JSON.parse(JSON.stringify(value))),execute:command=>{if(command[0]==='bun')results(root,suitePlan('instrumentation')[1],Object.fromEntries(DEFAULT_CLASSES.map(name=>[name,'passed'])));return 0;}});
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
