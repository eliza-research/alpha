import {mock} from 'node:test';
/** Existing source-executing MBT harness, shared by its original owning tests and the strict services receipt. */
import assert from 'node:assert/strict';
import {recordComparedObservation} from '../observed-replay.mjs';
let observedTraces=0,observedCheckpoints=0;
import {actionCounter, modelScenario, modelWalks, sourceModule} from './inbox-workflows-model-traces.mjs';

const model = 'specs/quint/services/ServiceReadCache.qnt', main = 'ServiceReadCache';
const scenarios = ['calendarClearKeepsMailTest', 'clearFencesPutTest', 'ownerSwitchIsolatesTest', 'lateWriteLandsInOwnDocumentTest', 'restartEndsWritesTest'];
const slots = [11, 12, 21, 22], T0 = 1_800_000_000_000, ageStep = 15 * 86400000;
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

// The secure slot store of the device, in memory. A read named in `gates` waits there, so a write
// can be held between its request and its store exchange.
const port = {slots: new Map(), gates: new Map()};
globalThis.alphaReadCachePort = port;
const store = await sourceModule('apps/app/src/runtime/service-read-cache-store.ts', {fresh: true, replace: {
  '^@capacitor/core$': 'export const Capacitor={isNativePlatform:()=>true};',
  'native-connection$': `const p=()=>globalThis.alphaReadCachePort;export const secureConnectionStore={
    read:async slot=>{const gate=p().gates.get(slot);if(gate){p().gates.delete(slot);gate.reached=true;await gate.wait;}return structuredClone(p().slots.get(slot)??null);},
    compareExchange:async(slot,before,value)=>{if(JSON.stringify(p().slots.get(slot)??null)!==JSON.stringify(before))return {status:'conflict'};if(value===null)p().slots.delete(slot);else p().slots.set(slot,structuredClone(value));return {status:'saved'};}};`,
  'json-domain-document$': 'export class BrowserJsonDomainDocument{}',
}});
const owner = key => ({environment: 'production', userId: 'user-' + Math.floor(key / 10), organizationId: 'org', credentialId: 'credential'});
const service = key => key % 10 === 1 ? 'gmail' : undefined;
const slotNames = new Map();
for (const key of slots) slotNames.set(key, 'connected-read-cache:v1:' + await sha(store.readCacheIdentity(owner(key), service(key))));

/** The real store binding and cache, one process at a time, with a reader in a process of its own. */
async function subject(t) {
  port.slots.clear(); port.gates.clear();
  const ages = new Map(slots.map(key => [key, 0]));
  let clockKey = 11;
  t.mock.method(Date, 'now', () => T0 + ages.get(clockKey) * ageStep);
  const open = async () => { const process = await store.fresh(), caches = new Map(); for (const key of slots) caches.set(key, await process.serviceReadCache(owner(key), service(key))); await settle(); return caches; };
  let caches = await open(), current = 1, serial = 0;
  const reader = await open(), pending = new Map(), newest = new Map();
  const name = p => `${p.key}:${p.epoch}:${p.began}`;
  const release = entry => { entry.answered = true; entry.release(); return entry.done; };
  const apply = async (action, {before, after, picks = {}, args = []}) => {
    if (action === 'beginPut') {
      const added = after.pending.find(p => !before.pending.some(q => name(q) === name(p)));
      if (!added) return 'unchanged';
      clockKey = added.key;
      let free; const gate = {wait: new Promise(resolve => { free = resolve; }), reached: false};
      port.gates.set(slotNames.get(added.key), gate);
      const key = `snapshot-${++serial}`, done = caches.get(added.key).put(key, {serial});
      await settle();
      assert.ok(gate.reached, 'the write reads its document before it stores');
      pending.set(name(added), {key, slot: added.key, release: free, done});
    } else if (action === 'commitPut') {
      const p = picks.p ?? Object.fromEntries([...args[0].matchAll(/(\w+):\s*(\d+)/g)].map(([, field, value]) => [field, Number(value)]));
      const entry = pending.get(name(p)); assert.ok(entry, `the model commits a write the cache was never asked for: ${name(p)}`);
      pending.delete(name(p)); clockKey = p.key;
      await release(entry);
      if (p.epoch === before.epochs.get(p.key)) newest.set(p.key, entry.key);
    } else if (action === 'read') {
      for (const key of after.shown.filter(k => !before.shown.includes(k))) { clockKey = key; assert.notEqual(await reader.get(key).get(newest.get(key) ?? 'none'), null, `the model shows ${key} from a snapshot the cache does not return`); }
    } else if (action === 'expire') ages.set(picks.key, ages.get(picks.key) + 1);
    else if (action === 'clear') {
      const key = after.lastClearKey, others = () => JSON.stringify(slots.filter(k => k !== key).map(k => port.slots.get(slotNames.get(k)) ?? null));
      assert.equal(Math.floor(key / 10), current); clockKey = key;
      const untouched = others(), done = caches.get(key).clear();
      // A write requested before the clear reaches its store exchange only now.
      for (const entry of pending.values()) if (entry.slot === key) await release(entry);
      await done;
      assert.equal(others(), untouched, 'a clear leaves every other document as it was');
      assert.equal(port.slots.has(slotNames.get(key)), false, 'a clear removes the whole document');
    } else if (action === 'switchOwner') current = current === 1 ? 2 : 1;
    else if (action === 'restart') { pending.clear(); port.gates.clear(); caches = await open(); }
    else assert.equal(action, '', `unmapped model action ${action}`);
  };
  const observe = async () => {
    const out = {};
    for (const key of slots) {
      clockKey = key;
      out[key] = {saved: port.slots.has(slotNames.get(key)), readable: await reader.get(key).get(newest.get(key) ?? 'none') !== null, epoch: caches.get(key).epoch};
    }
    return {owner: current, docs: out, pending: [...pending].filter(([, entry]) => !entry.answered).map(([id]) => id).sort()};
  };
  return {apply, observe};
}

const project = s => ({owner: s.owner,
  docs: Object.fromEntries(slots.map(key => [key, {saved: s.docs.get(key).n > 0, readable: s.docs.get(key).n > 0 && s.docs.get(key).age < 2, epoch: s.epochs.get(key)}])),
  // A write requested before a clear has been answered by the time the clear returns; the model keeps its record until it is committed.
  pending: s.pending.filter(p => p.epoch === s.epochs.get(p.key)).map(p => `${p.key}:${p.epoch}:${p.began}`).sort()});

async function replay(t, walk, label, seen) {
  const code = await subject(t);
  const initialObservation=await code.observe(),initialProjection=project(walk[0].state);
  assert.deepEqual(initialObservation,initialProjection,`${label} initial state`);
  recordComparedObservation({trace:label,step:0,actual:initialObservation,expected:initialProjection});observedTraces++;observedCheckpoints++;
  for (let i = 1; i < walk.length; i++) {
    const {action, state, picks, args, rejected} = walk[i], before = walk[i - 1].state;
    if (rejected) {
      assert.equal(action, 'read');
      const key = before.owner * 10 + Number(args[0]);
      assert.equal((await code.observe()).docs[key].readable, false, `${label}: the refused read has nothing to return`);
      const actual=await code.observe(),expected=project(state);assert.deepEqual(actual,expected);recordComparedObservation({trace:label,step:i,action:null,actual,expected});observedCheckpoints++;
      continue;
    }
    if (await code.apply(action, {before, after: state, picks, args}) !== 'unchanged') seen.note(action);
    const observation=await code.observe(),projection=project(state);
    assert.deepEqual(observation,projection,`${label} step ${i} ${action || 'stutter'}`);
    recordComparedObservation({trace:label,step:i,action,args:walk[i].args,picks:walk[i].picks,actual:observation,expected:projection});observedCheckpoints++;
    for (const key of state.shown) assert.equal(Math.floor(key / 10), state.owner, `${label} step ${i}`);
  }
  t.mock.restoreAll();
}


export async function runServiceReadCacheCase1(t, {canaries=true}={}) {
  const seen = actionCounter();
  for (const scenario of scenarios) await replay(t, modelScenario(model, scenario, {main}), scenario, seen);
  for (const action of ['beginPut', 'commitPut', 'read', 'clear', 'switchOwner', 'restart']) assert.ok(seen.count(action) > 0, action);
}

export async function runServiceReadCacheCase2(t, {canaries=true}={}) {
  const seen = actionCounter(), walks = modelWalks(model, {main, traces: 40, steps: 30});
  assert.equal(walks.length, 40);
  for (const [index, walk] of walks.entries()) await replay(t, walk, `walk ${index}`, seen);
  for (const action of ['beginPut', 'commitPut', 'read', 'expire', 'clear', 'switchOwner', 'restart']) assert.ok(seen.count(action) > 0, `${action} ${JSON.stringify(seen.all())}`);
}

export async function runServiceReadCacheCase3(t, {canaries=true}={}) {
  // The model bounds a document at two entries; the cache bounds it at MAX_ENTRIES and drops the oldest.
  port.slots.clear(); port.gates.clear();
  const cache = await (await store.fresh()).serviceReadCache(owner(11), 'gmail');
  for (let n = 0; n < 26; n++) await cache.put('entry-' + n, n, Date.now() - 1000 + n);
  const saved = port.slots.get(slotNames.get(11));
  assert.equal(saved.entries.length, 24);
  assert.deepEqual(saved.entries.map(entry => entry.key), Array.from({length: 24}, (_, n) => 'entry-' + (n + 2)));
}

export async function runServiceReadCacheReplay(){const beforeTraces=observedTraces,beforeCheckpoints=observedCheckpoints;const t={mock};try{await runServiceReadCacheCase1(t,{canaries:false});await runServiceReadCacheCase2(t,{canaries:false});}finally{mock.restoreAll();}return{traces:observedTraces-beforeTraces,checkpoints:observedCheckpoints-beforeCheckpoints};}
