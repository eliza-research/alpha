/** Existing source-executing MBT harness, shared by its original owning tests and the strict services receipt. */
import assert from 'node:assert/strict';
import {recordComparedObservation} from '../observed-replay.mjs';
let observedTraces=0,observedCheckpoints=0;
import {actionCounter, modelScenario, modelWalks, sourceModule} from './inbox-workflows-model-traces.mjs';

const model = 'specs/quint/services/TriggerCursor.qnt', main = 'TriggerCursor';
const scenarios = ['leaveAcrossBackgroundTest', 'brokenFlowDoesNotStopOthersTest', 'fullQueueStillDispatchesTest', 'heldDispatchWaitsForWakeTest', 'movedPlaceRestartsCursorTest'];
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };

// The development device around the runtime: its document, its stored app documents, its place
// settings and its location watch. The runtime itself and trigger detection are the real modules.
const device = {hidden: false, storage: new Map(), config: null, places: [], sensor: null, watch: null};
globalThis.alphaTriggerDevice = device;
globalThis.document = {get hidden() { return device.hidden; }, documentElement: {dataset: {}}, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, removeEventListener() {}};
globalThis.window = {addEventListener() {}, removeEventListener() {}};
globalThis.localStorage = {getItem: key => device.storage.get(key) ?? null, setItem: (key, value) => { device.storage.set(key, String(value)); }, removeItem: key => { device.storage.delete(key); }};
const {WorkflowTriggerRuntime} = await sourceModule('apps/app/src/browser/workflow-trigger-runtime.ts', {replace: {
  'workflow-focus$': 'export const isFocusWorkflow=()=>false;',
  'platform-plugins$': `export const registerPlugin=()=>({checkPermissions:async()=>({location:'granted'}),list:async()=>({events:[],truncated:false})});`,
  'location-simulation$': 'export const readLocationSimulation=()=>globalThis.alphaTriggerDevice.config;',
  'sensor-policy$': 'export const browserSensorEnabled=()=>true;',
  'saved-places$': 'export class SavedPlaces{read(){return globalThis.alphaTriggerDevice.places;}}',
  // A started watch reports the latest reading at once, as a location provider does.
  'native-location$': `const d=()=>globalThis.alphaTriggerDevice;export class NativeMapsLocation{async start(_precise,on,lost){d().watch={on,lost};if(d().sensor)on(d().sensor());}async stop(){d().watch=null;}}`,
}});
const {triggerDefinition, detectWorkflowTriggers} = await import('../../../../apps/app/src/browser/workflow-triggers.ts');

const home = {latitude: 37, longitude: -122}, away = {latitude: 37.02, longitude: -122};
// About 100 m north of home: with 60 m accuracy the reading straddles a 100 m or 120 m radius.
const edge = {latitude: 37.0009, longitude: -122};
const farHour = (new Date().getHours() + 12) % 24;
const flowA = {id: 'a', on: true, name: 'Leaving', trig: {kind: 'location', place: 'I leave home'}, steps: [{k: 'Notify', t: 'a notification'}]};
const flowB = {id: 'b', on: true, name: 'Messages', trig: {kind: 'message', person: 'maya'}, steps: [{k: 'Notify', t: 'a notification'}]};
// A third workflow holds 97 of the queue's 100 places, so the model's bound of three is the real bound.
const flowC = {id: 'c', on: true, name: 'Standing', trig: {kind: 'time', t: farHour, days: 'Every day'}, steps: [{k: 'Notify', t: 'a notification'}]};
const standing = Array.from({length: 97}, (_, n) => ({flowId: 'c', definition: triggerDefinition(flowC), key: 'standing-' + n, at: n, source: {kind: 'time'}, id: 'standing-' + n, sourceHash: ''}));

function subject() {
  device.hidden = false; device.storage.clear(); device.sensor = null; device.watch = null;
  device.places = [{id: 'home', label: 'Home', coordinate: home}];
  device.config = {mode: 'browser', latitude: 0, longitude: 0, accuracy: 5, homeId: 'home', radius: 100, workId: '', workRadius: 200};
  const write = (name, value) => device.storage.set('alpha.dev.app.' + name, JSON.stringify(value));
  const read = name => JSON.parse(device.storage.get('alpha.dev.app.' + name) ?? '{}');
  write('workflows', {flows: [flowA, flowB, flowC], triggerState: {cursors: [], queue: standing}});
  write('messages', {threads: {maya: []}});
  let ready = true, dispatchOnly = false, outcome = null, actual = 'in';
  const queued = {a: new Set(), b: new Set()};
  const api = {get: () => ({}), setView: (name, patch) => write(name, {...read(name), ...patch}), isActive: () => true};
  const runtime = new WorkflowTriggerRuntime(flowId => flowId === 'c' || !dispatchOnly, async (_flow, _api, job) => {
    assert.ok(outcome, 'a dispatch the model did not take');
    if (outcome === 'done') { const state = read('workflows'); write('workflows', {...state, triggerState: {...state.triggerState, queue: state.triggerState.queue.filter(row => row.id !== job.id)}}); }
    // The follow-up check of a finished dispatch belongs to a later model step.
    ready = false;
  });
  // The runtime is bound as connect() binds it, without its interval: every check here is a model step.
  runtime.api = () => api; runtime.ready = () => ready;
  const reading = side => () => ({coordinate: side === 'edge' ? edge : side === 'in' ? home : away, accuracyMeters: side === 'edge' ? 60 : 10, timestamp: Date.now(), precision: 'precise'});
  const messages = change => { const state = read('messages'); write('messages', {threads: {maya: change(state.threads.maya)}}); };
  let checked = false;
  const apply = async (action, {after, args = [], before}) => {
    checked = false;
    if (action === 'move') actual = actual === 'in' ? 'out' : 'in';
    else if (action === 'fix') { device.sensor = reading(after.pos === 'edge' ? 'edge' : actual); device.watch?.on(device.sensor()); }
    else if (action === 'loseFix') { device.sensor = null; device.watch?.lost(); }
    else if (action === 'editPlace') device.config = {...device.config, radius: 120};
    else if (action === 'background') { device.hidden = true; device.sensor = null; await runtime.tick(); }
    else if (action === 'resume' || action === 'wake') { if (action === 'resume') device.hidden = false; ready = false; runtime.wake(); ready = true; }
    else if (action === 'arrive') { const m = args[0] ?? after.liveB.find(id => !before.liveB.includes(id)); messages(rows => [...rows, {id: 'm' + m, me: false}]); }
    else if (action === 'remove') { const m = args[0] ?? before.liveB.find(id => !after.liveB.includes(id)); messages(rows => rows.filter(row => row.id !== 'm' + m)); }
    // A message without an identity cannot be checked. The workflow itself is unchanged.
    else if (action === 'breakB') messages(rows => [...rows, {me: false}]);
    else if (action === 'repairB') messages(rows => rows.filter(row => row.id !== undefined));
    else if (action === 'scan') { await runtime.tick(); await settle(); checked = !runtime.blocked; }
    else if (action === 'dispatch') {
      // Only the dispatch half of this tick runs: the check half is a separate model step.
      const latch = runtime.blocked; runtime.blocked = true; dispatchOnly = true;
      outcome = (args[0] ? args[0] === 'true' : after.queue < before.queue) ? 'done' : 'held';
      await runtime.tick(); await settle();
      if (outcome === 'held') runtime.blocked = latch;
      outcome = null; dispatchOnly = false; ready = true;
    } else assert.equal(action, '', `unmapped model action ${action}`);
  };
  const observe = () => {
    const state = read('workflows'), cursors = state.triggerState.cursors, queue = state.triggerState.queue;
    for (const job of queue) queued[job.flowId]?.add(job.id);
    const a = cursors.find(row => row.flowId === 'a'), b = cursors.find(row => row.flowId === 'b');
    return {foreground: !device.hidden, blocked: runtime.blocked, held: runtime.held, queue: queue.length - standing.length,
      cursor: !!a, cursorInside: a?.inside === true ? 'in' : a?.inside === false ? 'out' : 'none',
      cursorPlace: a?.placeKey ? (JSON.parse(a.placeKey)[2] === 100 ? 1 : 2) : 0,
      cursorB: !!b, seenB: (b?.seen ?? []).map(key => Number(JSON.parse(key)[2].slice(1))).sort(), fired: queued.a.size, firedB: queued.b.size,
      report: checked ? !!state.localTriggerError : null};
  };
  return {apply, observe, checked: () => checked};
}

const project = (s, checked) => ({foreground: s.foreground, blocked: s.blocked, held: s.held, queue: s.queue, cursor: s.cursor, cursorInside: s.cursorInside,
  cursorPlace: s.cursorPlace, cursorB: s.cursorB, seenB: [...s.seenB].sort(), fired: s.fired, firedB: s.firedB,
  // The per-workflow report is compared after each completed check; a failed check replaces it with its own message.
  report: checked ? s.reportB : null});

async function replay(walk, label, seen) {
  const code = subject();
  const initialObservation=code.observe(),initialProjection=project(walk[0].state, false);
  assert.deepEqual(initialObservation,initialProjection,`${label} initial state`);
  recordComparedObservation({trace:label,step:0,actual:initialObservation,expected:initialProjection});observedTraces++;observedCheckpoints++;
  for (let i = 1; i < walk.length; i++) {
    const {action, state, args, rejected} = walk[i], before = walk[i - 1].state;
    assert.equal(rejected, false, `${label}: no scenario of this model refuses a step`);
    seen.note(action);
    await code.apply(action, {after: state, before, args});
    const observation=code.observe(),projection=project(state, code.checked());
    assert.deepEqual(observation,projection,`${label} step ${i} ${action || 'stutter'}`);
    recordComparedObservation({trace:label,step:i,action,args:walk[i].args,picks:walk[i].picks,actual:observation,expected:projection});observedCheckpoints++;
  }
}


export async function runTriggerCursorCase1(t, {canaries=true}={}) {
  const seen = actionCounter();
  for (const scenario of scenarios) await replay(modelScenario(model, scenario, {main}), scenario, seen);
  for (const action of ['fix', 'scan', 'background', 'move', 'resume', 'breakB', 'repairB', 'arrive', 'remove', 'dispatch', 'wake', 'editPlace']) assert.ok(seen.count(action) > 0, action);
}

export async function runTriggerCursorCase2(t, {canaries=true}={}) {
  const seen = actionCounter(), walks = modelWalks(model, {main, traces: 60, steps: 40});
  assert.equal(walks.length, 60);
  for (const [index, walk] of walks.entries()) await replay(walk.map(step => ({...step, rejected: false})), `walk ${index}`, seen);
  for (const action of ['move', 'fix', 'loseFix', 'editPlace', 'background', 'resume', 'wake', 'arrive', 'remove', 'breakB', 'repairB', 'scan', 'dispatch']) assert.ok(seen.count(action) > 0, `${action} ${JSON.stringify(seen.all())}`);
}

export async function runTriggerCursorCase3(t, {canaries=true}={}) {
  const snapshot = rows => ({messages: {maya: rows}, mails: [], events: [], places: {}});
  const first = detectWorkflowTriggers([flowB], [], snapshot([{id: 'm1', me: false}]), 1000);
  assert.deepEqual(first.occurrences, []);
  // An unreadable source: reported, the cursor is kept, and the message that arrived meanwhile fires afterwards.
  const unreadable = detectWorkflowTriggers([flowB], first.cursors, snapshot([{id: 'm1', me: false}, {id: 'm2', me: false}, {me: false}]), 2000);
  assert.equal(unreadable.errors.length, 1); assert.deepEqual(unreadable.cursors, first.cursors); assert.deepEqual(unreadable.occurrences, []);
  const readable = detectWorkflowTriggers([flowB], unreadable.cursors, snapshot([{id: 'm1', me: false}, {id: 'm2', me: false}]), 3000);
  assert.deepEqual(readable.occurrences.map(row => row.source.id), ['m2']);
  // An unsupported trigger is another definition: no cursor is kept for it, and the repaired workflow starts over.
  const edited = detectWorkflowTriggers([{...flowB, trig: {kind: 'unsupported'}}], first.cursors, snapshot([{id: 'm1', me: false}, {id: 'm2', me: false}]), 2000);
  assert.equal(edited.errors.length, 1); assert.deepEqual(edited.cursors, []);
  const repaired = detectWorkflowTriggers([flowB], edited.cursors, snapshot([{id: 'm1', me: false}, {id: 'm2', me: false}]), 3000);
  assert.deepEqual(repaired.occurrences, []); assert.equal(repaired.cursors[0].seen.length, 2);
}

export async function runTriggerCursorReplay(){const beforeTraces=observedTraces,beforeCheckpoints=observedCheckpoints;await runTriggerCursorCase1(undefined,{canaries:false});await runTriggerCursorCase2(undefined,{canaries:false});return{traces:observedTraces-beforeTraces,checkpoints:observedCheckpoints-beforeCheckpoints};}
