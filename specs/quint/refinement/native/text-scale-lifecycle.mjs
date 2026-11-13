// Partial source-contract regression: authenticated extracted production members execute
// with controlled ports; this is not whole-file implementation refinement.
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign} from './java.mjs';
import {navigationRequestSource,navigationActionSource} from './main-activity-platform.mjs';
import {bridgeCallSource, deviceSource, textScalePlatform} from './text-scale-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';

const model='NativeTextScaleLifecycle';
const harness='TextScaleLifecycleTraces.java';
const scenarios=[
  'two-views-config-and-resume','configuration-before-queued-write','invalid-installed','late-destroyed-owner',
  'finishing-owner','failed-commit-and-restart','webview-unavailable','timeout-stateless',
];

export async function checkNativeTextScaleLifecycle(extraSources=[]) {
  const fixture=textScalePlatform();
  try {
    const compiled=[app+'MainActivity.java',app+'RendererRecoveryBudget.java',navigationRequestSource,join(directory,'MainActivityPorts.java'),...fixture.paths];
    const sources=[...compiled,navigationActionSource,deviceSource,bridgeCallSource,join(directory,harness),join(directory,'Trace.java'),
      join(directory,'java.mjs'),join(directory,'main-activity-platform.mjs'),join(directory,'text-scale-platform.mjs'),
      fileURLToPath(import.meta.url),'test/fixtures/jvm-tools.mjs','android/app/src/main/AndroidManifest.xml',
      ...(jsonJar?[jsonJar]:[]),...extraSources];
    const driverHashes=captureInputs(sources);
    const traces=javaTraceCampaign(harness,compiled,scenarios.map(name=>[name]));
    const receipt=await checkTraces({model,sources,driverHashes,generatedSources:fixture.paths,traces,scope: 'partial-source-contract',assumptions:[
      'Actual MainActivity callbacks and exact AlphaDevicePlugin appearance and timeout members execute against controlled Android and Capacitor ports.',
      'Two Activity instances, a shared appearance preference, finite float and bridge input classes, and a FIFO UI queue with at most one pending write per owner.',
      'Controlled SharedPreferences modes distinguish refusal before a visible write and refusal after only a visible write. A modeled process restart reloads the durable value.',
      'Timeout readback is stateless. The JVM checks its API gate, exact mask and bridge results and observes no change to appearance state.',
    ]});
    return {receipt,obligations:[
      {model,obligation:'Installed text-scale and accessibility platform behavior',
        reason:'Android framework resource delivery, real WebView glyph metrics, SharedPreferences durability, AccessibilityManager recommendations and assistive service behavior remain outside the host ports.'},
    ]};
  } finally {fixture.close();}
}
