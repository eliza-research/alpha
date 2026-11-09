import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {clockJournalBridge, clockPlatform} from './clock-review-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';

const model = 'NativeClockReview';
const plugin=app+'AlphaActionJournalPlugin.java';
const harness='ClockReviewTraces.java';
const shared='plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/';
const clock='plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/clock/';
const upstreamPaths=[...['ActionJournal','ActionJournalConfiguration','ActionJournalPlugin'].map(name=>shared+name+'.java'),
  clock+'ClockHandoff.java',clock+'ClockDays.java'];
const compiled=[...['ClockAgentReview','AlphaActionJournal','PluginWorkers'].map(name=>app+name+'.java'),
  ...upstreamPaths.map(path=>'vendor/eliza/'+path)];

export function clockReviewSourceTraces(scenarios) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-clock-review-'));
  try{
    const ports={...clockPlatform,'ai/alphacompute/alphaphone/AlphaActionJournalPlugin.java':clockJournalBridge(readFileSync(join(root,plugin),'utf8'))};
    const files=Object.entries(ports).map(([path,contents])=>{
      const file=join(temporary,path);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,contents);
      return file;
    });
    return javaTraceCampaign(harness,[...compiled,...files],scenarios.map(mode=>[mode]));
  }finally{rmSync(temporary,{recursive:true,force:true});}
}

export async function checkNativeClockReview(extraSources = []) {
  const sources=[plugin,...compiled,fileURLToPath(import.meta.url),join(directory,harness),join(directory,'Trace.java'),
    join(directory,'java.mjs'),join(directory,'clock-review-platform.mjs'),'scripts/upstream-native-source.mjs',
    'upstream.lock.json','patches/eliza/native-manifest.json','test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...extraSources];
  const driverHashes=captureInputs(sources);
  const catalog=JSON.parse(readFileSync(join(root,'patches/eliza/native-manifest.json'),'utf8'));
  const targets=new Set(catalog.patches.flatMap(patch=>patch.targets.map(target=>target.path)));
  const upstream=upstreamNativeSource(root);
  for(const path of upstreamPaths){
    assert.ok(!targets.has(path),`Clock fixture requires effective patched source for ${path}`);
    assert.equal(driverHashes[join(root,'vendor/eliza',path)],upstream.read(path).get(path).sha256);
  }
  const traces=clockReviewSourceTraces([
    'late-dialog','late-dialog-negative','late-dialog-cancel','fabricated-outer','legacy-exact-replay',
    'mismatched-attempt-receipt','mismatched-operation-receipt','bare-failed-without-receipt',
    'absent-unknown-without-receipt','typed-unknown-without-receipt','approved-once','review-storage-and-foreground-retry',
    'approval-committed-before-failure-report','cancel-current-review','show-lost-mark','show-self',
    'show-missing','show-denied','show-unknown-before','snooze-manual','dismiss-manual',
    'effect-before-refused-receipt','terminal-receipt-before-refusal','expire-after-consume',
    'retire-after-consume','lock-after-consume','bare-unknown-can-retire-approved-token',
  ]);
  for(const trace of traces)for(const {expect} of [trace,...trace.steps]){
    expect['s.visible']=qset(expect['s.visible']);
    expect['s.retired']=qset(expect['s.retired']);
    expect['s.dialogReplies']=qmap(expect['s.dialogReplies']);
  }
  const receipt=await checkTraces({model,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'The exact native Clock review class, product Clock journal methods, shared journal and Clock handoff builder execute against controlled Android dialog and activity ports.',
    'A successful synthetic delivery is an external Clock activity handoff. This model has no alarm creation, ringing, snooze or stop acknowledgement.',
    'A retained legacy terminal row and mismatched nested attempt/hash are seeded as storage inputs. New typed outcomes require the exact durable producer, while typed and bare unknown remain conservative outcomes.',
  ]});
  return {receipt,obligations:[
    {model,obligation:'Installed dialog delivery and DeskClock behavior',
      reason:'AlertDialog, Handler, resolver, Activity and storage are synthetic. Installed Clock alarm ownership and whether Android delivers an already-queued dismissed listener are external.'},
  ]};
}
