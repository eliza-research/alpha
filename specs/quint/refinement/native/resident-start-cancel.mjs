import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {directory} from './java.mjs';
import {residentSources} from './resident-coordinator.mjs';
import {residentPlatform} from './resident-platform.mjs';
import {modelTraces, replayJava} from './itf-replay.mjs';

const ports = 'ai.alphacompute.alphaphone.ResidentStartCancelReplay.Ports';
// The credential-stop reservation, window focus and the clock are inputs of this replay.
const rewrites = {
  'ai/alphacompute/alphaphone/ElizaAgentService.java': [
    ['public static long reserveCredentialShutdown() { throw new AssertionError("Unused credential reservation"); }',
      `public static long reserveCredentialShutdown() { return ${ports}.reserve(); }`],
    ['public static void retryCredentialShutdown(Context context, long request) { throw new AssertionError("Unused credential retry"); }',
      `public static void retryCredentialShutdown(Context context, long request) { ${ports}.strictStop(request); }`],
    [/public static boolean isCredentialShutdownConfirmed\(long request\) \{\s*return false;\s*\}/,
      `public static boolean isCredentialShutdownConfirmed(long request) { return ${ports}.confirmed(request); }`],
  ],
  'android/app/Activity.java': [[/public boolean hasWindowFocus\(\) \{\s*return true;\s*\}/, `public boolean hasWindowFocus() { return ${ports}.focused; }`]],
  'android/os/SystemClock.java': [['return System.nanoTime() / 1000000;', `return System.nanoTime() / 1000000 + ${ports}.clockOffset;`]],
};

/** ResidentStartCancel traces without a credential mutation, replayed on the real AlphaLocalAgentPlugin. */
export function checkResidentStartCancel({traces = 60, maxSteps = 30} = {}) {
  const generated = modelTraces({model: 'ResidentStartCancel', traces, maxSteps, step: 'lifecycleStep', witnessSeeds: 2,
    witnesses: ['AttachedWitness', 'RememberedCancellationWitness', 'OwnedLaunchStoppedWitness', 'RetryInProgressWitness',
      'RecheckAfterOrdinaryStopWitness', 'StatusReleasedStopWitness',
      // The recheck continued into a launch, and one that ended without it.
      's.outcome == "started" and s.shutdown == "none" and s.launches > 1 and s.startOwnsLaunch and s.epoch > 3',
      's.outcome == "retry-unconfirmed" and s.shutdown == "unconfirmed"']});
  const platform = residentPlatform();
  try {
    for (const [name, edits] of Object.entries(rewrites)) {
      let source = platform.sources[name];
      for (const [from, to] of edits) {
        const next = source.replace(from, to);
        assert.notEqual(next, source, `${name} port was not rewritten`);
        source = next;
      }
      writeFileSync(join(platform.directory, name), source);
    }
    return replayJava({
      harness: 'ResidentStartCancelReplay.java',
      sources: [...residentSources, ...platform.paths, `${directory}/ResidentTestPorts.java`],
      traces: generated, extraArguments: [platform.directory],
      required: ['start', 'cancelStart', 'stop', 'statusPolled', 'nativeStopped', 'acknowledgeShutdown', 'retryShutdown', 'finishRetry', 'rearm'],
      reached: {
        'an attached start': state => state.outcome === 'attached',
        'a cancellation remembered before its start': state => state.outcome === 'cancel-remembered',
        'a start refused by its earlier cancellation': state => state.outcome === 'cancelled',
        'a cancellation that stopped its own launch': state => state.outcome === 'cancel-stopped-launch',
        'a cancellation that stopped nothing': state => state.outcome === 'cancel-retired-request',
        'a recheck after an ordinary stop': state => state.outcome === 'retrying',
        'a recheck that continued into a launch': state => state.outcome === 'started' && state.epoch > 3 && state.launches > 1,
        'a recheck that ended unconfirmed': state => state.outcome === 'retry-unconfirmed',
        'a recheck refused without focus': state => state.outcome === 'retry-needs-focus',
        'a stop released by a status read': state => !state.stopping && !state.accepting && state.native === 'stopped' && state.launches > 0,
        'a broadcast start': state => state.outcome === 'rearmed',
      },
    });
  } finally { platform.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkResidentStartCancel(), null, 2));
