import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {app, directory, javaTraces} from './java.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {mainActivityPlatform} from './main-activity-platform.mjs';

export const rendererCoordinatorScenarios = [
  'home-escape', 'home-reload', 'standard-backoff', 'standalone', 'assistant',
  'foreign-duplicate', 'closed-callback', 'clock-window', 'focus-and-intent',
  'no-webview', 'settings-failure', 'handoff-home', 'handoff-standard',
  'handoff-marker', 'handoff-unacknowledged', 'handoff-start-failure',
  'settings-fallback-default', 'settings-fallback-settings', 'settings-fallback-none',
  'configuration-recreate', 'stale-posted-after-replacement',
  'handoff-same-task', 'handoff-foreign-parcel', 'handoff-front-ack',
  'home-task-restoration', 'old-teardown', 'finished-task-reuse',
];
export function generateRendererCoordinatorTraces(scenario, extraSources = []) {
  const fixture = mainActivityPlatform();
  const sources = [app + 'MainActivity.java', app + 'RendererRecoveryBudget.java',
    ...['MainActivityPorts.java', 'MainActivityRecoveryTraces.java', 'main-activity-platform.mjs',
      'Trace.java', 'java.mjs'].map(name => `${directory}/${name}`), fileURLToPath(import.meta.url), ...extraSources];
  try {
    const driverHashes = captureInputs(sources);
    const traces = javaTraces('MainActivityRecoveryTraces.java',
      [app + 'MainActivity.java', app + 'RendererRecoveryBudget.java',
        `${directory}/MainActivityPorts.java`, ...fixture.paths],
      scenario ? [scenario] : ['campaign', ...rendererCoordinatorScenarios]);
    return {traces, sources, driverHashes,
      fixtureSha256: createHash('sha256').update(JSON.stringify(fixture.sources)).digest('hex')};
  } finally { fixture.close(); }
}
export async function checkRendererCoordinator(extraSources = []) {
  const data = generateRendererCoordinatorTraces(undefined, extraSources);
  return checkTraces({model: 'RendererRecovery', id: 'RendererRecovery-main-activity',
    scope: 'bounded-orchestration', traces: data.traces, sources: [...data.sources, ...extraSources],
    driverHashes: data.driverHashes, assumptions: [
      `Actual MainActivity and RendererRecoveryBudget execute under Android/Capacitor primitive ports ${data.fixtureSha256}.`,
      'Activity recreation is asynchronous. The adapter observes its request separately from destruction and successor creation.',
      'The budget persists across Activity instances within a process and resets when a new process starts.',
      'Android task selection, WebView renderer-process death, pixel rendering and stock Settings handlers remain platform obligations.',
    ]});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv[2] ? generateRendererCoordinatorTraces(process.argv[2]) : await checkRendererCoordinator(), null, 2));
}
