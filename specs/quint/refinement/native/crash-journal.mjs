import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces,qset} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {crashCallSource,crashDeviceSource,crashJournalPlatform,crashLogPath} from './crash-journal-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from '../../../../test/fixtures/native-source.mjs';
import {verifyNativePatchReceipt} from '../../../../scripts/prepare-patched-native.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';

const model='NativeCrashJournal';
const harness='CrashJournalTraces.java';
const modulePath='plugins/plugin-native-system/android';
const scenarios=['workers','capacity','retention','legacy-bridge','corrupt','oversize','write-faults',
  'history-and-watermark','history-refused','held-read-and-clear','native-handler','unsafe-time'];

export async function checkNativeCrashJournal(extraSources=[]) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-native-crash-journal-'));
  try {
    const staged=prepareNativeFixture(root,temporary);
    const core=join(staged.root,crashLogPath);
    const sourceReceipt=join(staged.root,'.source.json');
    const ports=crashJournalPlatform(temporary);
    const generatedSources=[core,sourceReceipt,...ports];
    const product=app+'PluginWorkers.java';
    const sources=[product,crashDeviceSource,crashCallSource,'vendor/eliza/'+crashLogPath,
      'android/consumer-host.json','upstream.lock.json','android/upstream-native-sources.json','test/fixtures/native-source.mjs',
      'test/fixtures/jvm-tools.mjs','scripts/prepare-patched-native.mjs','scripts/upstream-native-source.mjs',
      join(directory,harness),join(directory,'Trace.java'),join(directory,'java.mjs'),join(directory,'crash-journal-platform.mjs'),
      fileURLToPath(import.meta.url),...(jsonJar?[jsonJar]:[]),...generatedSources,...extraSources];
    const driverHashes=captureInputs(sources);
    const pinned=upstreamNativeSource(root).read(modulePath).get(crashLogPath);
    const host=JSON.parse(readFileSync(join(root,'android/consumer-host.json'),'utf8'));
    assert.deepEqual(host.profile.modules.find(module=>module.name==='eliza-system'),{
      name:'eliza-system',source:{root:'patchedNative',path:modulePath},relocateBuild:true,
    });
    verifyNativePatchReceipt(readFileSync(sourceReceipt,'utf8'),staged);
    assert.equal(driverHashes[join(root,'vendor/eliza',crashLogPath)],pinned.sha256);
    assert.equal(driverHashes[core],staged.files[crashLogPath]);
    const traces=javaTraceCampaign(harness,[product,core,...ports],scenarios.map(name=>[name]));
    for(const trace of traces)for(const checkpoint of [trace,...trace.steps]){
      for(const name of ['history','captured']){
        const field='s.'+name;
        checkpoint.expect[field]=qset(checkpoint.expect[field]);
      }
    }
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,scope:'bounded-orchestration',assumptions:[
      'Actual AlphaDevicePlugin diagnostics and teardown members, actual PluginWorkers, and the exact authenticated Android CrashLog core.',
      'Two separate real JVM diagnostics executors with one admitted call per bridge. Synthetic exit history, deterministic wall time, and actual private temporary files with a controlled atomic replacement port.',
      'Fifty identical seeded old rows are represented by their count. Tagged rows remain ordered; time, history, and write fault inputs are finite.',
      'No device diagnostics, user logs, share, external open, or uncaught JVM termination. The handler trace invokes a synthetic throwable and observes its delegate.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Installed process exit history and AtomicFile behavior',
        reason:'The JVM supplies controlled Android snapshots and atomic write outcomes. Cross-process storage, actual OS exit collection and filesystem guarantees remain outside this campaign.'},
    ]};
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
