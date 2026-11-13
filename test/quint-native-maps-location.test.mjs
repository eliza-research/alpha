import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames, modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {build} from 'esbuild';

/** Replays NativeMapsLocation model traces against the location owner the Maps screen is given.
 *
 * What runs: the NativeMapsLocation class exported by apps/app/src/maps/native-location.ts (the
 * shared owner bound to the ElizaLocation plugin and Capacitor's platform checks). The plugin
 * bridge, Capacitor and `document` are controlled ports: every bridge call stays pending until
 * the trace settles it.
 *
 * Observation: the owner's admitting, generation, session and permission flags are read from the
 * instance; the admission phase is the bridge call the running start is waiting on; listeners,
 * watches and cleanups are what the bridge has registered and not yet confirmed removed; start
 * outcomes, fixes and errors are what the callers' promise and callbacks received. `granted` is
 * the sessions that went on to register listeners. `selfStopped` has no observable counterpart
 * and is not compared; its effect is, as `cleanupErrors`.
 *
 * `listenersAdded` covers both listener registrations of one start. */

const model = {path: 'specs/quint/native/NativeMapsLocation.qnt', module: 'NativeMapsLocation'};
const tick = () => new Promise(resolve => setImmediate(resolve));
const CLEANUP = 'Location cleanup could not be confirmed.';
const OWN_FAILURES = new Set(['Location permission was not granted. You can choose an origin manually.', 'Location could not start.']);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

async function load() {
  const result = await build({
    absWorkingDir: repositoryRoot, entryPoints: ['apps/app/src/maps/native-location.ts'], bundle: true, write: false,
    format: 'esm', platform: 'neutral', logLevel: 'silent',
    plugins: [{name: 'ports', setup(builder) {
      const stubs = {
        '../platform-plugins': 'export const registerPlugin=name=>{if(name!=="ElizaLocation")throw Error(name);return globalThis.mapsLocationProbe.bridge;};',
        '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:name=>name==="ElizaLocation"&&globalThis.mapsLocationProbe.available};',
      };
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(stubs, args.path) ? {path: args.path, namespace: 'port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: stubs[args.path], loader: 'js'}));
    }}],
  });
  return result.outputFiles[0].text;
}

let loads = 0;
async function driver(code, available) {
  const previousDocument = globalThis.document;
  const document = globalThis.document = Object.assign(new EventTarget(), {hidden: false});
  let frontWaits = 0;
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (name, listener) => { if (name === 'visibilitychange') frontWaits++; add(name, listener); };
  document.removeEventListener = (name, listener) => { if (name === 'visibilitychange') frontWaits--; remove(name, listener); };

  const ids = new WeakMap(), sessions = new Map(), tickets = {1: 0, 2: 0, 3: 0}, errors = {1: 0, 2: 0, 3: 0};
  const native = {listeners: new Map(), watches: new Set(), cleanup: new Map(), failed: new Set()};
  const granted = new Set(), cleanupErrors = new Set(), deliveries = [];
  let pending = null, minted = 0, run = null, lastStart = 'none', lastTicket = 0, location;
  const call = kind => { assert.equal(pending, null, `${kind} while ${pending?.kind} is pending`); pending = {kind, owner: run, ...deferred()}; return pending.promise; };
  const take = kind => { assert.equal(pending?.kind, kind, `the code is not waiting on ${kind}`); const value = pending; pending = null; return value; };
  const active = owner => !!owner?.object && location.session === owner.object && !owner.object.aborted;
  // Removal of a registered listener or watch settles with the cleanup of its session.
  const cleanup = id => { let group = native.cleanup.get(id); if (!group) native.cleanup.set(id, group = deferred()); group.promise.catch(() => {}); return group.promise; };
  const bridge = {
    checkPermissions: () => call('check'),
    requestPermissions: () => call('request'),
    addListener(name, callback) { if (name === 'locationChange' && run.session) granted.add(run.session); return call('listener').then(resolved => resolved(name, callback)); },
    watchPosition: () => call('watch'),
    clearWatch: ({watchId}) => { const id = Number(watchId.slice(1)); return native.watches.has(id) ? cleanup(id) : Promise.resolve(); },
    cancelPermissionRequest: () => assert.fail('a native build cancels no permission request'),
  };
  globalThis.mapsLocationProbe = {bridge, available};
  const {NativeMapsLocation} = await import('data:text/javascript;base64,' + Buffer.from(code + `\n//${++loads}`).toString('base64'));
  location = new NativeMapsLocation();
  const id = object => object ? ids.get(object) ?? 0 : 0;
  function note() {
    const object = location.session;
    if (!object || ids.has(object)) return;
    assert.ok(run && !run.session, 'a session is put in place only by the running start');
    ids.set(object, ++minted); run.session = minted; run.object = object; sessions.set(minted, run); tickets[minted] = location.generation;
  }
  async function settle() { await tick(); note(); }
  function phase() {
    if (!location.admitting) return 'idle';
    if (frontWaits > 0) return 'waiting-front';
    if (pending) return {check: 'checking', request: 'requesting', listener: 'listening', watch: 'watch-requested'}[pending.kind];
    return run.session ? 'failing' : 'stopping';
  }
  return {
    async start(oneShot) {
      const cleanups = new Set(native.cleanup.keys()), wasAdmitting = location.admitting;
      const record = {oneShot, session: 0, object: null, waits: 0, ticket: 0, ownFailures: 0};
      const result = location.start(oneShot, () => {
        deliveries.push({session: record.session, ticket: tickets[record.session], generation: location.generation});
      }, error => {
        if (error.message === CLEANUP) cleanupErrors.add(record.session);
        else { errors[record.session]++; if (OWN_FAILURES.has(error.message)) record.ownFailures++; }
      });
      // The cleanup this start asked for before its first await is the one it waits on.
      record.waits = [...native.cleanup.keys()].find(session => !cleanups.has(session)) ?? 0;
      if (!wasAdmitting && location.admitting) { run = record; record.ticket = lastTicket = location.generation; lastStart = 'admitted'; }
      result.then(() => {
        lastStart = record.object?.watchId !== undefined ? 'watching' : record.ownFailures ? 'error' : 'superseded';
      }, error => {
        lastStart = /still settling/.test(error.message) ? 'refused-admitting' : /unavailable in this build/.test(error.message) ? 'refused-unavailable'
          : error.message === CLEANUP ? 'refused-cleanup' : assert.fail(error);
      });
      // The session is noted before a later tick could let anything else run.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); note();
      await settle();
    },
    async stop() { location.stop().catch(error => assert.equal(error.message, CLEANUP)); await settle(); },
    async cleanupSettles(session, confirmed) {
      const group = native.cleanup.get(session);
      assert.ok(group, `the code asked for no cleanup of session ${session}`);
      native.cleanup.delete(session);
      if (confirmed) { native.listeners.delete(session); native.watches.delete(session); group.resolve(); }
      else { native.failed.add(session); group.reject(Error('The bridge did not confirm the removal.')); }
      await settle();
    },
    async permissionChecked(grant) { take('check').resolve({location: grant ? 'granted' : 'prompt', accuracy: 'precise'}); await settle(); },
    async permissionAnswered(grant) { take('request').resolve({location: grant ? 'granted' : 'denied', accuracy: 'precise'}); await settle(); },
    async hide() { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); await settle(); },
    async show() { document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); await settle(); },
    async listenersAdded() {
      for (let count = 0; count < 2 && pending?.kind === 'listener'; count++) {
        const request = take('listener'), owner = request.owner, registered = active(owner);
        request.resolve((name, callback) => {
          if (registered) { const entry = native.listeners.get(owner.session) ?? {}; entry[name] = callback; native.listeners.set(owner.session, entry); }
          return {remove: () => registered ? cleanup(owner.session) : Promise.resolve()};
        });
        await settle();
      }
    },
    async watchSettles(created) {
      const request = take('watch'), owner = request.owner;
      if (!created) request.reject(Error('The bridge could not start a watch.'));
      else { if (active(owner)) native.watches.add(owner.session); request.resolve({watchId: 'w' + (active(owner) ? owner.session : 0)}); }
      await settle();
    },
    async nativeFix(session, valid) {
      const now = Date.now();
      native.listeners.get(session).locationChange({cached: false, coords: {latitude: 1, longitude: 2, accuracy: 5, timestamp: valid ? now : now - 60000}});
      await settle();
    },
    async nativeError(session) { native.listeners.get(session).error({code: 'UNAVAILABLE'}); await settle(); },
    observe() {
      const admitting = location.admitting, current = phase();
      return {
        available: location.available(), hidden: document.hidden, admitting, generation: location.generation,
        session: id(location.session), minted, requestingPermission: location.requestingPermission,
        admission: admitting ? {phase: current, ticket: run.ticket, session: run.session,
          awaits: current === 'stopping' ? run.waits : current === 'failing' ? run.session : 0, oneShot: run.oneShot}
          : {phase: 'idle', ticket: 0, session: 0, awaits: 0, oneShot: false},
        tickets: {...tickets}, oneShots: [...sessions].filter(([, record]) => record.oneShot).map(([session]) => session).sort(),
        granted: [...granted].sort(), listeners: [...native.listeners.keys()].sort(), watches: [...native.watches].sort(),
        cleanup: [...native.cleanup.keys()].sort(), failedCleanups: [...native.failed].sort(), cleanupErrors: [...cleanupErrors].sort(),
        lastStart, lastTicket, deliveries: [...new Set(deliveries.map(item => `${item.session}:${item.ticket}:${item.generation}`))].sort(), errors: {...errors},
      };
    },
    close() { globalThis.document = previousDocument; },
  };
}

const project = state => {
  const {selfStopped, ...rest} = state;
  return {...rest, deliveries: [...new Set(state.deliveries.map(item => `${item.session}:${item.ticket}:${item.generation}`))].sort()};
};

async function replayNativeMapsLocation({scenarios, witnesses, random = 60, steps = 40}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  const code = await load();
  return replayTraces(traces, trace => driver(code, trace.init.available), {project});
}

test('the Maps location owner follows every NativeMapsLocation model trace step by step', {timeout: scaledTimeout(300000)}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/native/NativeMapsLocation.qnt');
  assert.equal(scenarios.length, 11);
  assert.equal(witnesses.length, 8);
  const result = await replayNativeMapsLocation({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['start', 'stop', 'cleanupSettles', 'permissionChecked', 'permissionAnswered', 'hide', 'show', 'listenersAdded', 'watchSettles', 'nativeFix', 'nativeError']) assert.ok(result.actions[action] > 0, action);
});
