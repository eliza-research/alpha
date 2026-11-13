// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces,qmap} from '../check-traces.mjs';
import {app,directory,javaTraceCampaign,root} from './java.mjs';
import {digestBoundary,digestProduct,nativeDigestPlatform,noticeOwner} from './native-digest-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model='NativeDigestConsent';
const harness='NativeDigestTraces.java';
const nativeManifest='android/upstream-native-sources.json';
const scenarios=['describe-revoked-held','describe-expired-held','describe-current-held','describe-calendar-changed-held',
  'describe-owner-retired-held','consent','scope-refusal','storage','exact-owner',
  'projection','bounds','reminders-only','calendar-only','read-revoked','read-expired','read-calendar-changed',
  'read-owner-retired','read-transport-retired'];

export async function checkNativeDigestConsent(extraSources=[]) {
  const fixture=nativeDigestPlatform();
  try {
    const compiled=[...digestProduct,'vendor/eliza/'+noticeOwner];
    const sources=[...compiled,digestBoundary,app+'AlphaHostedResultsPlugin.java',app+'AlphaApplication.java',
      nativeManifest,'upstream.lock.json','scripts/upstream-native-source.ts',
      'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...fixture.paths,...extraSources,
      ...[harness,'Trace.java','java.mjs','native-digest-platform.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url)];
    const driverHashes=captureInputs(sources);
    const catalog=JSON.parse(readFileSync(join(root,nativeManifest),'utf8'));
    const pinned=upstreamNativeSource(root).read(noticeOwner).get(noticeOwner);
    assert.ok(catalog.patches.every(patch=>patch.targets.every(target=>target.path!==noticeOwner)));
    assert.equal(driverHashes[join(root,'vendor/eliza',noticeOwner)],pinned.sha256);
    const traces=javaTraceCampaign(harness,[...compiled,...fixture.paths],scenarios.map(name=>[name]));
    for(const trace of traces)for(const {expect} of [trace,...trace.steps])
      expect['s.rows']=qmap(Object.entries(expect['s.rows']).map(([id,row])=>[Number(id),row]));
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:fixture.paths,traces,
      scope: 'bounded-orchestration',assumptions:[
        'Actual NativeDigestHost and NativeDigestSources execute with exact HostedDelivery.nativeSource admission and generation check calls. Resident transport, source identity, Android permission and Calendar/Reminder source reads are closed synthetic ports.',
        'Two synthetic owners and two source slots, reviewed scope classes, one held operation and selected wall clock boundaries. The source uses actual 23-hour owner day projection, scope parsing, exact revision hash, and item and serialized byte limits.',
        'The store port records before-commit refusal, lost acknowledgement after commit, and a foreground transition following the grant write. Exact reply classification, durable row state and projected fields are observed.',
        'Held describe verifies the selected Calendar identity once, then rechecks the durable grant after the blocking port. Exact response source, revision, owner and occurrence/window are checked.',
        'Closed read results go only to the JVM trace observer. Installed Capacitor ingress and foreground scheduling, provider data freshness and later model use are external.',
      ]});
    return {receipt,obligations:[
      {model,obligation:'Installed permission, transport and provider admission',reason:'Closed fixtures control host foreground, exact resident generation, permission and Calendar identity. Installed Android provider behavior and resident authentication require separate evidence.'},
      {model,obligation:'Full native digest input and use',reason:'The replay checks selected finite scope and day windows and exact returned projection. Arbitrary provider results, on-device source storage and subsequent renderer/model handling are outside this receipt.'},
    ]};
  } finally {fixture.close();}
}
