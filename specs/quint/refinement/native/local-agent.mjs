import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {captureInputs} from '../check-traces.mjs';
import {root} from './java.mjs';

const action = (name, ...args) => ({name, args});

/** Bundle unmodified local-agent source, replacing only its external Capacitor port. */
export async function residentLifecycleTraces(additionalSources = []) {
  const options = {
    absWorkingDir: root, entryPoints: ['apps/app/src/runtime/local-agent.ts'], bundle: true, write: false,
    platform: 'node', format: 'esm', metafile: true,
    define: {'import.meta.env': JSON.stringify({DEV: false, VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: ''}),
      performance: 'globalThis.__quintNativeTime', setTimeout: 'globalThis.__quintNativeSleep'},
    plugins: [{name: 'native-boundary', setup(builder) {
      builder.onResolve({filter: /^@capacitor\/core$/}, () => ({path: 'capacitor-port', namespace: 'fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: `
        export const Capacitor = {isNativePlatform: () => true, isPluginAvailable: () => true, getPlatform: () => 'android'};
        export const registerPlugin = () => globalThis.__quintNativePort;
      `, loader: 'js'}));
    }}],
  };
  const discovery = await build(options);
  const sources = Object.keys(discovery.metafile.inputs).map(path => resolve(root, path)).filter(existsSync)
    .concat(fileURLToPath(import.meta.url), resolve(root, 'specs/quint/refinement/native/java.mjs'), additionalSources);
  const driverHashes = captureInputs(sources);
  const compiled = await build(options);
  const saved = Object.fromEntries(['__quintNativePort', '__quintNativeTime', '__quintNativeSleep'].map(key => [key, globalThis[key]]));
  const port = {};
  let elapsed = 0;
  globalThis.__quintNativePort = port;
  globalThis.__quintNativeTime = {now: () => elapsed};
  globalThis.__quintNativeSleep = (callback, delay) => { elapsed += delay; queueMicrotask(callback); return 0; };
  try {
    const actual = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64') + '#' + crypto.randomUUID());
    const traces = [];
    for (const mode of ['confirmed', 'incomplete-timeout', 'stop-rejected']) {
      elapsed = 0;
      const trace = {name: `native-stop-wrapper-${mode}`, expect: {'s.phase': 'stopped'}, steps: [
        {action: [action('start'), action('started', 0)], expect: {'s.phase': 'ready'}},
      ]};
      let polls = 0;
      port.stop = async () => {
        trace.steps.push({label: 'source emits stop request', action: action('requestStop'), expect: {'s.phase': 'stopping'}});
        if (mode === 'stop-rejected') throw new Error('unconfirmed stop');
        return {state: 'stopping'};
      };
      const responses = [
        {state: 'stopped'},
        {state: 'stopped', serviceActive: true, socketListening: false},
        {state: 'stopped', serviceActive: false, socketListening: true},
        {state: 'stopped', serviceActive: false, socketListening: false},
      ];
      port.getStatus = async () => {
        const result = mode === 'confirmed' ? responses[Math.min(polls, responses.length - 1)] : responses[0];
        polls++;
        return result;
      };
      let resolved = false;
      try { await actual.stopLocalAgent(); resolved = true; } catch (error) {
        if (mode === 'confirmed') throw error;
      }
      if (mode === 'confirmed' && polls !== 4) throw new Error('Stop accepted incomplete native status');
      if (mode === 'incomplete-timeout' && (resolved || polls < 2)) throw new Error('Missing stop timeout');
      trace.steps.push({label: 'actual wrapper settled', action: action(resolved ? 'shutdownConfirmed' : 'shutdownUnconfirmed'),
        expect: {'s.phase': resolved ? 'stopped' : 'stopping'}});
      traces.push(trace);
    }
    // The real renderer cancellation path is observed at the native cancelStart boundary.
    for (const attached of [false, true]) {
      let releaseStart;
      let releaseIdentity;
      let cancels = 0;
      const bridge = {
        start: () => attached ? Promise.resolve({attached: true}) : new Promise(resolve => { releaseStart = resolve; }),
        cancelStart: async () => { cancels++; },
        request: async input => {
          if (input.path === '/api/auth/me') {
            if (attached) await new Promise(resolve => { releaseIdentity = resolve; });
            return {status: 200, body: JSON.stringify({identity: {kind: 'owner', id: 'owner'}, access: {role: 'OWNER', mode: 'local'}})};
          }
          return {status: 200, body: JSON.stringify({agents: [{id: 'agent', status: 'running'}]})};
        },
      };
      const client = new actual.LocalAgentProtocol(bridge);
      const abort = new AbortController();
      const trace = {name: `connect-cancel-${attached ? 'attached' : 'owned'}`, expect: {'s.phase': 'stopped'}, steps: []};
      if (attached) {
        trace.steps.push({action: [action('start'), action('started', 0)], expect: {'s.phase': 'ready'}});
      }
      const pending = client.connect(abort.signal);
      pending.catch(() => {});
      for (let i = 0; i < 30; i++) await Promise.resolve();
      trace.steps.push({action: action(attached ? 'attachStart' : 'start'), expect: {'s.phase': attached ? 'ready' : 'starting'}});
      abort.abort(new DOMException('cancelled', 'AbortError'));
      releaseStart?.({attached: false}); releaseIdentity?.();
      let rejected = false;
      try { await pending; } catch { rejected = true; }
      if (!rejected || cancels !== 1 || client.session) throw new Error('Cancelled connect published a session');
      trace.steps.push({action: action(attached ? 'cancelAttachedStart' : 'cancelOwnedStart'),
        expect: {'s.phase': attached ? 'ready' : 'stopping', 's.pending': Boolean(client.session)}});
      if (!attached) trace.steps.push({label: 'late ready after cancelled owned start', action: action('started', 0), expect: {'s.phase': 'stopping'}});
      traces.push(trace);
    }
    return {traces, sources, driverHashes};
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}
