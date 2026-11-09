import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign} from './java.mjs';
import {scopedCalendarReviewPlatform} from './scoped-calendar-review-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';

const model='NativeCalendarScopedReview';
const harness='ScopedCalendarReviewTraces.java';
const scenarios=['exact-target','wrong-keys','visible-mismatch','at-expiry','after-expiry','provider-event','provider-source',
  'competing','pause-queued','pause-open','retired-queued','revoked-before-open','revoked-at-answer',
  'locked-at-answer','stopped-at-answer','uncertain-enqueue','inspect-held-current','inspect-pause-commit','inspect-destroy-commit'];

export function generateScopedCalendarReviewTraces(extraSources=[], selected=scenarios) {
  const fixture=scopedCalendarReviewPlatform();
  try {
    const compiled=[app+'CalendarScopedDeletionReview.java',app+'CalendarDeletionIdentity.java',
      join(directory,'ScopedCalendarReviewProvider.java'),...fixture.compiled];
    const sources=[...compiled,...fixture.sources,app+'AlphaCalendarPlugin.java','test/fixtures/jvm-tools.mjs',
      ...(jsonJar?[jsonJar]:[]),...extraSources,
      ...[harness,'Trace.java','java.mjs','scoped-calendar-review-platform.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url)];
    const driverHashes=captureInputs(sources);
    for(const [path,sha256] of Object.entries(fixture.expected))assert.equal(driverHashes[path],sha256);
    const traces=javaTraceCampaign(harness,compiled,selected.map(name=>[name]));
    return {traces,sources,driverHashes,generatedSources:fixture.generated,close:fixture.close};
  } catch(error){fixture.close();throw error;}
}

export async function checkNativeCalendarScopedReview(extraSources=[]) {
  const {traces,sources,driverHashes,generatedSources,close}=generateScopedCalendarReviewTraces(extraSources);
  try {
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,scope:'bounded-orchestration',
      assumptions:[
        'Actual product CalendarScopedDeletionReview and CalendarDeletionIdentity run with the authenticated staged shared CalendarEventGuard and CalendarSourceIdentity. Synthetic provider rows come from the existing closed scoped Calendar fixture. Any attempted provider write fails the test.',
        'One selected occurrence is inspected and reviewed. Exact provider and source revisions, four ticket coordinates, canonical stored target, inclusive deadline, captured UI runnable, native dialog dismissal and enqueue result are observed.',
        'The final worker permission read can be held across pause or destroy before ticket insertion. The foreground, lock, elapsed clock, UI delivery and enqueue result are controlled. The fixture delivers dismissal immediately after the user response.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'Installed calendar review and downstream deletion settlement',reason:'Closed JVM drives the actual app review delegate and synthetic dialog. Capacitor admission, platform lifecycle and late bridge reply delivery, multi-ticket eviction, reviewed agent journal claim, actual deletion/Undo and provider dispatch remain separate.'},
    ]};
  } finally {close();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--observe') {
    const result=generateScopedCalendarReviewTraces([],process.argv.slice(3));
    try{console.log(JSON.stringify(result.traces));}finally{result.close();}
  } else {
    const {receipt}=await checkNativeCalendarScopedReview();
    console.log(JSON.stringify({traces:receipt.traces,checkpoints:receipt.checkpoints,fields:receipt.observedFields.length,passed:receipt.passed}));
  }
}
