import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames, modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';

/** Replays MapsConnection model traces against the Cloud Maps connection code.
 *
 * What runs: apps/app/src/maps/cloud-maps.ts with the shared provider, session capture and
 * connection runtime it composes, keepCloudMapsCoverage from apps/app/src/maps/agent-navigation.ts,
 * and the readCloudMaps guard of apps/app/src/prototype/maps-adapter.ts. The connection
 * controller, the subscription reader and the Cloud client are controlled ports.
 *
 * Observation: the account binding and resident readiness the ports report; the provider's
 * generation as the number of reads and retirements it was asked for; reads in flight as the
 * capabilities requests the client has not answered; diagnostics; the installed provider and the
 * account its coverage came from; the outcome and serving client of the last provider request.
 * `guidance` is held by a subscriber that drops it when the connection stops being configured,
 * which is what the shared Maps screen does on that change. The launch reader's private memory
 * (seenAccount, seenClient, coveragePending), `opened`, `ownerClient` and `guidanceEnd` have no
 * observable counterpart and are not compared. */

const model = {path: 'specs/quint/services/MapsConnection.qnt', module: 'MapsConnection'};
const adapterPath = 'apps/app/src/prototype/maps-adapter.ts';
// Scenario actions that describe behaviour the code does not have; a trace ends before one.
const counterfactual = new Set(['pinnedClientRequest']);
const tick = () => new Promise(resolve => setImmediate(resolve));

async function load() {
  const guard = readFileSync(join(repositoryRoot, adapterPath), 'utf8').split('\n').filter(line => line.trimStart().startsWith('const readCloudMaps = '));
  assert.equal(guard.length, 1, 'the Maps adapter has one readCloudMaps guard');
  const provider = join(repositoryRoot, 'apps/app/src/maps/cloud-provider.ts');
  const stubs = {
    '../runtime/connection-ui': 'export const connectionController={getCloudClient:()=>globalThis.mapsConnectionProbe.binding,subscribe(listener){const all=globalThis.mapsConnectionProbe.listeners;all.push(listener);return()=>{const at=all.indexOf(listener);if(at>=0)all.splice(at,1);};}};',
    '../runtime/subscription-entitlement.ts': 'export const readServiceLimit=()=>undefined;',
    // The real provider, with its reads and retirements counted.
    './cloud-provider': `export * from ${JSON.stringify(provider)};import {createCloudMaps as create} from ${JSON.stringify(provider)};
      export const createCloudMaps=(...args)=>{const maps=create(...args),probe=globalThis.mapsConnectionProbe;
        return {...maps,initializeCloudMaps:(...input)=>{probe.reads++;return maps.initializeCloudMaps(...input);},retireCloudMaps:()=>{probe.retired++;return maps.retireCloudMaps();}};};`,
  };
  const result = await build({
    absWorkingDir: repositoryRoot, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
    stdin: {resolveDir: repositoryRoot, loader: 'ts', contents: `
      import {initializeCloudMaps, cloudMapsDiagnostics} from './apps/app/src/maps/cloud-maps.ts';
      import {keepCloudMapsCoverage} from './apps/app/src/maps/agent-navigation.ts';
      import {mapsConnection, onMapsConnectionChange} from './apps/app/src/maps/runtime.ts';
      ${guard[0]}
      export {initializeCloudMaps, cloudMapsDiagnostics, keepCloudMapsCoverage, mapsConnection, onMapsConnectionChange, readCloudMaps};`},
    plugins: [{name: 'ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(stubs, args.path) && (args.path !== './cloud-provider' || args.importer.endsWith('/maps/cloud-maps.ts'))
        ? {path: args.path, namespace: 'port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: stubs[args.path], loader: 'js', resolveDir: repositoryRoot}));
    }}],
  });
  return result.outputFiles[0].text;
}

let loads = 0;
async function driver(code) {
  const probe = globalThis.mapsConnectionProbe = {binding: null, listeners: [], reads: 0, retired: 0};
  // A fresh evaluation per trace: the provider, its runtime and the account subscription start empty.
  const app = await import('data:text/javascript;base64,' + Buffer.from(code + `\n//${++loads}`).toString('base64'));
  const attempts = [];
  let clients = 0, ready = false, reachable = true, guidance = false, last = null;
  const notify = () => { for (const listener of [...probe.listeners]) listener(); };
  const account = () => probe.binding ? Number(probe.binding.sessionId.slice(1)) : 0;
  function client() {
    const index = ++clients, owner = account();
    return {index, mapsRequest(route) {
      if (route === 'capabilities') return new Promise((resolve, reject) => attempts.push({generation: probe.reads + probe.retired, account: owner, client: index, resolve, reject, settled: false}));
      last.servedClient = index;
      return reachable ? Promise.resolve({places: []}) : Promise.reject(Error('The network is unreachable.'));
    }};
  }
  const capabilities = owner => ({providerId: 'cloud-fixture', connectionId: 'conn_fixture_account_' + owner, revision: 'r1', attribution: 'Fixture',
    regions: [{id: 'world', name: 'World', bounds: [-10, -10, 10, 10]}],
    capabilities: {search: true, placeDetails: true, traffic: 'none', transit: 'none', modes: ['drive']}});
  const stopGuidance = app.onMapsConnectionChange(() => { if (app.mapsConnection().config.status !== 'configured') guidance = false; });
  const stopCoverage = app.keepCloudMapsCoverage({enabled: () => true, ready: () => ready, account: () => probe.binding,
    initialize: app.readCloudMaps, onChange: listener => { probe.listeners.push(listener); return () => probe.listeners.splice(probe.listeners.indexOf(listener), 1); }});
  const bind = async next => { probe.binding = next; notify(); await tick(); };
  return {
    async accountChange(target) {
      probe.binding = target ? {sessionId: 's' + target, credentialId: 'c' + target, client: null} : null;
      // The model numbers every binding change, a sign-out included.
      if (probe.binding) probe.binding.client = client(); else clients++;
      notify(); await tick();
    },
    async clientRebuilt() { await bind({...probe.binding, client: client()}); },
    async residentBecomesReady() { ready = true; notify(); await tick(); },
    async openMaps() { void app.readCloudMaps(); await tick(); },
    async searchRetry() { void app.readCloudMaps(); await tick(); },
    async unguardedRead() { void app.initializeCloudMaps(); await tick(); },
    async attemptSettles(generation, ok) {
      const attempt = attempts.find(item => item.generation === generation && !item.settled);
      assert.ok(attempt, `the code has no read in flight for generation ${generation}`);
      attempt.settled = true;
      if (ok) attempt.resolve(capabilities(attempt.account)); else attempt.reject(Error('The network is unreachable.'));
      await tick();
    },
    async request(available) {
      const provider = app.mapsConnection().provider;
      assert.ok(provider, 'a request needs the installed provider');
      reachable = available; last = {provider, outcome: 'none', servedClient: 0};
      try { await provider.search('cafe', new AbortController().signal); last.outcome = 'ok'; }
      catch (error) { last.outcome = error?.code === 'unauthorized' || error?.code === 'cancelled' ? 'refused' : 'failed'; }
    },
    startGuidance() { assert.equal(app.mapsConnection().config.status, 'configured'); guidance = true; },
    endGuidance() { guidance = false; },
    observe() {
      const connection = app.mapsConnection(), diagnostics = app.cloudMapsDiagnostics(), installed = connection.config.status === 'configured';
      const current = installed && last?.provider === connection.provider ? last : null;
      return {
        account: account(), client: clients, residentReady: ready,
        generation: probe.reads + probe.retired,
        inflight: attempts.filter(item => !item.settled).map(item => `${item.generation}:${item.account}:${item.client}`).sort(),
        configured: diagnostics.configured,
        error: !diagnostics.error ? 'none' : diagnostics.error === 'unauthorized' ? 'unauthorized' : 'transient',
        installed, ownerAccount: installed ? Number(connection.config.connectionId.split('_').at(-1)) : 0,
        guidance, lastRequest: current?.outcome ?? 'none', servedClient: current?.servedClient ?? 0,
      };
    },
    close() { stopCoverage(); stopGuidance(); probe.listeners.length = 0; },
  };
}

const project = state => ({
  account: state.account, client: state.client, residentReady: state.residentReady, generation: state.generation,
  inflight: state.inflight.map(item => `${item.generation}:${item.account}:${item.client}`).sort(),
  configured: state.configured, error: state.error, installed: state.installed, ownerAccount: state.ownerAccount,
  guidance: state.guidance, lastRequest: state.lastRequest, servedClient: state.servedClient,
});

async function replayMapsConnection({scenarios, witnesses, random = 40, steps = 30}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps}).map(trace => {
    const end = trace.steps.findIndex(step => counterfactual.has(step.action));
    return end < 0 ? trace : {...trace, steps: trace.steps.slice(0, end)};
  });
  const code = await load();
  return replayTraces(traces, () => driver(code), {project});
}

test('Cloud Maps connection code follows every MapsConnection model trace step by step', {timeout: scaledTimeout(300000)}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/services/MapsConnection.qnt');
  assert.equal(scenarios.length, 8);
  assert.equal(witnesses.length, 6);
  const result = await replayMapsConnection({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 40);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['accountChange', 'clientRebuilt', 'residentBecomesReady', 'openMaps', 'searchRetry', 'attemptSettles', 'request', 'startGuidance', 'endGuidance', 'unguardedRead']) assert.ok(result.actions[action] > 0, action);
});
