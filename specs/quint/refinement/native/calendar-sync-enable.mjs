import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign} from './java.mjs';
import {calendarSyncEnablePlatform} from './calendar-sync-enable-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';

const model='NativeCalendarSyncEnable';
const harness='CalendarSyncEnableTraces.java';
const scenarios=['enable-current','pause-after-enable','pause-before-read','pause-after-read',
  'pause-after-read-unchanged','pause-retry','pause-exhausted','fresh-after-pause'];

export function generateCalendarSyncEnableTraces(extraSources=[],selected=scenarios){
  const fixture=calendarSyncEnablePlatform();
  try {
    const compiled=[...['CalendarSyncBridge','CalendarSyncSnapshot','CalendarSyncMutation','CalendarSyncReceiptRecovery',
      'CalendarSyncConsent','LocalAgentProviderAdmission','HostedResultNotices'].map(name=>app+name+'.java'),...fixture.compiled];
    const sources=[...compiled,...fixture.sources,
      ...['AlphaCalendarPlugin','AlphaConnectionPlugin','AlphaCredentialStore','NativeDeletionCoordinator'].map(name=>app+name+'.java'),
      'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...extraSources,
      ...[harness,'Trace.java','java.mjs','calendar-sync-enable-platform.mjs','scoped-calendar-review-platform.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url)];
    const driverHashes=captureInputs(sources);
    for(const [path,sha256] of Object.entries(fixture.expected))assert.equal(driverHashes[path],sha256);
    const traces=javaTraceCampaign(harness,compiled,selected.map(name=>[name]));
    return {traces,sources,driverHashes,generatedSources:fixture.generated,close:fixture.close};
  } catch(error){fixture.close();throw error;}
}

export async function checkNativeCalendarSyncEnable(extraSources=[]){
  const {traces,sources,driverHashes,generatedSources,close}=generateCalendarSyncEnableTraces(extraSources);
  try {
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,scope:'bounded-orchestration',
      assumptions:[
        'Exact CalendarSyncBridge, native provider admission, native Calendar snapshot, credential consent and deletion-refusal code run with closed in-memory Android, Cloud identity, credential CAS and provider ports.',
        'One bridge, a single pre-marked local Calendar source with no event rows, and an exact synthetic grant. Provider mutation and deletion staging are prohibited by the fixture.',
        'The final enable journal read can be held before or after loading the CAS snapshot. CAS attempts, committed enabled bytes, both replies, and both subsequent exact consent gates are observed.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'Installed native Calendar sync and wider journal custody',reason:'One native bridge and one controlled credential store. Multiple live bridge instances, Android callback delivery, event apply/deletion/Undo and downstream provider settlement are separate obligations.'},
    ]};
  } finally {close();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--observe'){
    const result=generateCalendarSyncEnableTraces([],process.argv.slice(3));
    try{console.log(JSON.stringify(result.traces));}finally{result.close();}
  } else {
    const {receipt}=await checkNativeCalendarSyncEnable();
    console.log(JSON.stringify({traces:receipt.traces,checkpoints:receipt.checkpoints,fields:receipt.observedFields.length,passed:receipt.passed}));
  }
}
