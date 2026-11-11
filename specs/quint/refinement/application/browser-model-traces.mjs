/** Model traces for replaying the Browser and Passwords models against product code.
 *
 * The pinned Quint CLI writes ITF traces of a model: its named `run` scenarios, random walks of
 * `step`, and one walk into each reachability witness. Each step carries the action taken, its
 * arguments and the model state before and after it. A driver performs the same action on the
 * product code and returns what it observes; the observation must equal the driver's projection
 * of the model state after every step. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js');
const SEED = '20261107';

/** ITF values as plain data: integers as numbers, sets as sorted arrays (numbers in numeric order), maps as objects. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#set' in value) return value['#set'].map(plain).sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if ('#map' in value) return Object.fromEntries(value['#map'].map(([key, item]) => [String(plain(key)), plain(item)]));
  if ('#tup' in value) return value['#tup'].map(plain);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

function closing(text, open) {
  let depth = 0, quoted = false;
  for (let index = open; index < text.length; index++) {
    const c = text[index];
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c) && --depth === 0) return index;
  }
  throw Error('Unbalanced model text');
}

function split(text) {
  const parts = [];
  let depth = 0, start = 0, quoted = false;
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

function call(text) {
  const value = text.trim(), open = value.indexOf('(');
  if (open < 0) { assert.match(value, /^\w+$/, value); return {action: value, args: []}; }
  assert.equal(closing(value, open), value.length - 1, value);
  return {action: value.slice(0, open), args: split(value.slice(open + 1, -1))};
}

/** The argument expressions each action of `step` is called with. */
function stepCalls(source) {
  const start = source.search(/\baction step\s*=/);
  assert.ok(start >= 0, 'model has no step action');
  const any = source.indexOf('any {', start), calls = new Map();
  for (const item of split(source.slice(any + 5, closing(source, any + 4)))) {
    if (/^s'\s*=\s*s$/.test(item)) continue;
    const {action, args} = call(item);
    if (!calls.has(action)) calls.set(action, []);
    calls.get(action).push(args);
  }
  return calls;
}

function literal(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^"[^"\\]*"$/.test(text)) return text.slice(1, -1);
  return undefined;
}

/** The action chain of a `run` scenario. `evaluate` reads an argument that is not a plain literal. */
function scenarioSteps(source, name, evaluate) {
  const start = source.search(new RegExp(`\\brun ${name}\\s*=`));
  assert.ok(start >= 0, `missing scenario ${name}`);
  let index = source.indexOf('=', start) + 1;
  const head = /^\s*(\w+)/.exec(source.slice(index));
  index += head[0].length;
  const steps = [];
  let initial = null;
  if (source[index] === '(') {
    const end = closing(source, index);
    initial = {action: head[1], args: split(source.slice(index + 1, end)).map(text => literal(text))};
    index = end + 1;
  }
  for (;;) {
    const next = /^\s*\.(then|expect|fail)\(/.exec(source.slice(index));
    if (!next) break;
    const open = index + next[0].length - 1, end = closing(source, open);
    assert.notEqual(next[1], 'fail', `${name}: a scenario that ends in a refused action has no trace to replay`);
    if (next[1] === 'then') {
      const {action, args} = call(source.slice(open + 1, end));
      steps.push({action, args: args.map(text => literal(text) ?? evaluate(text))});
    }
    index = end + 1;
  }
  return {initial, steps};
}

function quint(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd: repositoryRoot, encoding: 'utf8', timeout: 180000, maxBuffer: 256 * 1024 * 1024});
  assert.ifError(result.error);
  return result;
}

function walk(file, name, calls, state) {
  const trace = JSON.parse(readFileSync(file, 'utf8')), steps = [];
  let before = plain(trace.states[0][state]);
  for (const item of trace.states.slice(1)) {
    const action = item['mbt::actionTaken'] || null, after = plain(item[state]);
    const picks = Object.fromEntries(Object.entries(item['mbt::nondetPicks'] || {}).filter(([, value]) => value?.tag === 'Some').map(([key, value]) => [key, plain(value.value)]));
    let args = [];
    if (action) {
      assert.ok(calls.has(action), `${name}: action ${action} is not called from step`);
      // An action listed more than once in `step` (with different constants) is told apart by the driver from `picks` and the states.
      const forms = calls.get(action);
      args = forms.length === 1 ? forms[0].map(text => literal(text) ?? (text in picks ? picks[text] : undefined)) : [];
    }
    steps.push({action, args, picks, before, after});
    before = after;
  }
  return {name, init: plain(trace.states[0][state]), steps};
}

/**
 * Traces of one model: `{name, init, steps: [{action, args, picks, before, after}]}`. A null action
 * is the model's stutter step. `scenarios` are `run` tests, `witnesses` are walks that end in a
 * state satisfying the witness, and `random` walks sample `step`.
 */
export function modelTraces({path, module, scenarios = [], witnesses = [], random = 0, steps = 25, state = 's', evaluate = text => { throw Error(`Scenario argument ${text} needs an evaluator`); }}) {
  const source = readFileSync(join(repositoryRoot, path), 'utf8'), calls = stepCalls(source), traces = [];
  const common = [path, `--main=${module}`, '--backend=typescript', `--seed=${SEED}`];
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-browser-replay-'));
  try {
    for (const name of scenarios) {
      const result = quint(['test', ...common, '--max-samples=1', `--match=^${name}$`, `--out-itf=${join(directory, 'scenario-{test}-{seq}.json')}`]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const {steps: actions} = scenarioSteps(source, name, evaluate);
      const trace = JSON.parse(readFileSync(join(directory, `scenario-${name}-0.json`), 'utf8'));
      assert.equal(trace.states.length, actions.length + 1, `${name}: one model state per scenario action`);
      const states = trace.states.map(item => plain(item[state]));
      traces.push({name, init: states[0], steps: actions.map((step, index) => ({...step, picks: {}, before: states[index], after: states[index + 1]}))});
    }
    for (const witness of witnesses) {
      const file = join(directory, `witness-${witness}.json`);
      const result = quint(['run', ...common, '--max-samples=2000', '--max-steps=60', '--mbt', `--invariant=not(${witness})`, `--out-itf=${file}`]);
      assert.match(`${result.stdout}${result.stderr}`, /\[violation\]/, `${witness} is not reached: ${result.stdout}\n${result.stderr}`);
      traces.push(walk(file, witness, calls, state));
    }
    if (random) {
      const result = quint(['run', ...common, `--max-samples=${random}`, `--n-traces=${random}`, `--max-steps=${steps}`, '--mbt', `--out-itf=${join(directory, 'random-{seq}.json')}`]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const files = readdirSync(directory).filter(name => name.startsWith('random-')).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
      assert.ok(files.length > 0, 'the simulator wrote no random trace');
      for (const file of files) traces.push(walk(join(directory, file), file.replace('.json', ''), calls, state));
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
  return traces;
}

/**
 * Replay traces against product code. `create(trace)` returns a driver with one method per model
 * action, called as `action(...args, step)`, and `observe()`, which returns the product's view of
 * the projected model state. `project(state)` selects the model fields the driver can observe.
 */
export async function replayTraces(traces, create, {project = state => state} = {}) {
  const actions = new Map();
  let checkpoints = 0;
  for (const trace of traces) {
    const driver = await create(trace);
    try {
      assert.deepEqual(await driver.observe(), project(trace.init), `${trace.name}: initial state`);
      checkpoints++;
      let index = 0;
      for (const step of trace.steps) {
        index++;
        const label = `${trace.name} step ${index} ${step.action ?? 'stutter'}(${step.args.map(arg => JSON.stringify(arg)).join(', ')}) picks ${JSON.stringify(step.picks)}`;
        if (step.action) {
          assert.equal(typeof driver[step.action], 'function', `${label}: the driver has no such action`);
          await driver[step.action](...step.args, step);
          actions.set(step.action, (actions.get(step.action) || 0) + 1);
        }
        assert.deepEqual(await driver.observe(), project(step.after), label);
        checkpoints++;
      }
    } finally { await driver.teardown?.(); }
  }
  return {traces: traces.length, checkpoints, actions: Object.fromEntries([...actions].sort())};
}

/** Lets every settled promise run its continuations. */
export async function settle(rounds = 6) {
  for (let round = 0; round < rounds; round++) await new Promise(resolve => setImmediate(resolve));
}

let bundles = 0;
/**
 * Bundle a product module for a fresh import. `stubs` maps an import specifier (as written in the
 * source) to replacement module text for an environmental port; style sheets load as empty.
 * Every call returns its own module instance, so module-level state starts over.
 */
export async function loadBundled(entry, stubs = {}) {
  const {build} = await import('esbuild');
  const names = Object.keys(stubs);
  const built = await build({absWorkingDir: repositoryRoot, entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false,
    loader: {'.css': 'empty'}, logLevel: 'silent',
    plugins: names.length ? [{name: 'ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => names.includes(args.path) ? {path: args.path, namespace: 'port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: stubs[args.path], loader: 'js'}));
    }}] : []});
  const text = built.outputFiles[0].text;
  return () => import('data:text/javascript;base64,' + Buffer.from(`${text}\n// instance ${++bundles}`).toString('base64'));
}

/** A jsdom document installed as the process's `window` and `document`, with a modal dialog and a
 * settable `document.hidden`. `restore()` puts the previous globals back and closes the window. */
export async function installDocument(html = '<!doctype html><body></body>') {
  const {JSDOM} = await import('jsdom');
  const {window} = new JSDOM(html, {url: 'https://fixture.invalid', pretendToBeVisual: true});
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => hidden});
  const globals = {window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle.bind(window), navigator: window.navigator, DOMException: window.DOMException};
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  return {window, document: window.document,
    setHidden(value) { if (hidden === value) return; hidden = value; window.document.dispatchEvent(new window.Event('visibilitychange')); },
    restore() {
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
      window.close();
    }};
}

/** Counts listeners added to and removed from `target` for the named events. */
export function countListeners(target, events) {
  const live = new Set(), add = target.addEventListener, remove = target.removeEventListener;
  const key = (type, listener, options) => `${type}|${typeof options === 'boolean' ? options : !!options?.capture}`;
  const ids = new Map();
  let next = 0;
  const id = listener => { if (!ids.has(listener)) ids.set(listener, ++next); return ids.get(listener); };
  target.addEventListener = function(type, listener, options) { if (events.includes(type)) live.add(`${key(type, listener, options)}|${id(listener)}`); return add.call(this, type, listener, options); };
  target.removeEventListener = function(type, listener, options) { if (events.includes(type)) live.delete(`${key(type, listener, options)}|${id(listener)}`); return remove.call(this, type, listener, options); };
  return () => live.size;
}
