/** Model traces for replay against the identity, telephony and connection sources.
 *
 * The pinned Quint CLI writes ITF traces of a model: its named scenarios, one walk into each
 * reachability witness, and random walks of `step`. Every trace step names the action taken, its
 * arguments and the model state after it. A driver runs the same action against product code and
 * the replay compares an observation of that code with the model state after every step. */
import assert from 'node:assert/strict';
import {captureReplayInputs,recordComparedObservation} from '../observed-replay.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

export const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js');
const SEED = '20261107';

/** ITF values as plain data: integers as numbers, sets as sorted arrays, maps as objects. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#set' in value) return value['#set'].map(plain).sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if ('#map' in value) return Object.fromEntries(value['#map'].map(([key, item]) => [String(plain(key)), plain(item)]));
  if ('#tup' in value) return value['#tup'].map(plain);
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '#meta').map(([key, item]) => [key, plain(item)]));
}

function balanced(text, open) {
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

function literal(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^"[^"\\]*"$/.test(text)) return text.slice(1, -1);
  return undefined;
}

function callOf(text) {
  const call = text.trim(), open = call.indexOf('(');
  if (open < 0) { assert.match(call, /^\w+$/, call); return {action: call, args: []}; }
  assert.equal(balanced(call, open), call.length - 1, call);
  return {action: call.slice(0, open), args: split(call.slice(open + 1, -1))};
}

/** The arguments each action of `step` receives: a literal, or the name of a nondeterministic pick.
 * An action listed more than once must take picks only, so the trace says which call ran. */
function stepParameters(source) {
  const start = source.search(/\baction step\s*=/);
  assert.ok(start >= 0, 'the model has no step action');
  const any = source.indexOf('any {', start), end = balanced(source, any + 4), parameters = new Map();
  for (const item of split(source.slice(any + 5, end))) {
    if (/^s'\s*=\s*s$/.test(item)) continue;
    const {action, args} = callOf(item);
    assert.ok(!parameters.has(action), `step lists ${action} twice; pass its arguments as nondeterministic picks`);
    parameters.set(action, args);
  }
  return parameters;
}

/** The action chain of one `run` scenario. `.then(a.fail())` is a refused action: it adds no state. */
function scenarioActions(source, name, seen = new Set()) {
  assert.ok(!seen.has(name), `cyclic scenario ${name}`);
  const start = source.search(new RegExp(`\\brun ${name}\\s*=`));
  assert.ok(start >= 0, `missing scenario ${name}`);
  let index = source.indexOf('=', start) + 1;
  const head = /^\s*(\w+)/.exec(source.slice(index));
  assert.ok(head, name);
  index += head[0].length;
  const steps = head[1] === 'init' ? [] : scenarioActions(source, head[1], new Set([...seen, name]));
  for (;;) {
    const next = /^\s*\.(then|expect)\(/.exec(source.slice(index));
    if (!next) break;
    const open = index + next[0].length - 1, close = balanced(source, open);
    if (next[1] === 'then') {
      let text = source.slice(open + 1, close).trim();
      const reject = text.endsWith('.fail()');
      if (reject) text = text.slice(0, -'.fail()'.length);
      const {action, args} = callOf(text);
      steps.push({action, reject, args: args.map(arg => { const value = literal(arg); assert.notEqual(value, undefined, `${name}: ${arg} is not a literal`); return value; })});
    }
    index = close + 1;
  }
  return steps;
}

function quint(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd: repositoryRoot, encoding: 'utf8', timeout: 150000, maxBuffer: 64 * 1024 * 1024});
  assert.ifError(result.error);
  return result;
}

function walk(file, name, parameters, variable) {
  const trace = JSON.parse(readFileSync(file, 'utf8')), steps = [];
  for (const item of trace.states.slice(1)) {
    const action = item['mbt::actionTaken'], state = plain(item[variable]);
    if (!action) { steps.push({action: null, args: [], state}); continue; }
    assert.ok(parameters.has(action), `${name}: ${action} is not an action of step`);
    const picks = item['mbt::nondetPicks'] || {};
    steps.push({action, state, args: parameters.get(action).map(arg => {
      const value = literal(arg);
      if (value !== undefined) return value;
      assert.equal(picks[arg]?.tag, 'Some', `${name}: ${action} has no pick ${arg}`);
      return plain(picks[arg].value);
    })});
  }
  return {name, init: plain(trace.states[0][variable]), steps};
}

/**
 * Traces of one model: `{name, init, steps: [{action, args, state, reject}]}`. A null action is the
 * model's stutter. A rejected step is an action the model refuses in that state: it has no state of
 * its own and the implementation must stay where it was.
 */
export function modelTraces({path, module, scenarios = [], witnesses = [], random = 0, steps = 25, variable = 's'}) {
  const source = readFileSync(join(repositoryRoot, path), 'utf8'), parameters = stepParameters(source), traces = [];
  const common = [path, `--main=${module}`, '--backend=typescript', `--seed=${SEED}`];
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-identity-comms-'));
  try {
    if (scenarios.length) {
      const result = quint(['test', ...common, '--max-samples=1', `--match=^(${scenarios.join('|')})$`, `--out-itf=${join(directory, 'scenario-{test}-{seq}.json')}`]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const files = readdirSync(directory);
      for (const name of scenarios) {
        const file = files.find(item => item.startsWith(`scenario-${name}-`));
        assert.ok(file, `${name}: no trace was written`);
        const actions = scenarioActions(source, name);
        const states = JSON.parse(readFileSync(join(directory, file), 'utf8')).states.filter(state => variable in state).map(state => plain(state[variable]));
        assert.equal(states.length, actions.filter(step => !step.reject).length + 1, `${name}: one model state per accepted scenario action`);
        let index = 0;
        traces.push({name, init: states[0], steps: actions.map(step => ({...step, state: step.reject ? states[index] : states[++index]}))});
      }
    }
    for (const witness of witnesses) {
      const file = join(directory, `witness-${witness}.json`);
      const result = quint(['run', ...common, '--max-samples=2000', '--max-steps=60', '--mbt', `--invariant=not(${witness})`, `--out-itf=${file}`]);
      assert.match(`${result.stdout}${result.stderr}`, /\[violation\]/, `${witness} is not reached: ${result.stdout}\n${result.stderr}`);
      traces.push(walk(file, witness, parameters, variable));
    }
    if (random) {
      const result = quint(['run', ...common, `--max-samples=${random}`, `--n-traces=${random}`, `--max-steps=${steps}`, '--mbt', `--out-itf=${join(directory, 'random-{seq}.json')}`]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const files = readdirSync(directory).filter(name => name.startsWith('random-')).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
      assert.ok(files.length > 0, 'the simulator wrote no random trace');
      for (const file of files) traces.push(walk(join(directory, file), file.replace('.json', ''), parameters, variable));
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
  return traces;
}

/**
 * Replays traces against an implementation. `create(trace)` builds a fresh driver with one method
 * per model action, and `observe()` returning the implementation's view of the projected model
 * state. After every step the observation must equal `project(model state)`. An action also
 * receives `{before, after}`, the model states around it, for mapping a model token (a read or a
 * call in flight) to the implementation's handle for the same thing.
 */
export async function replayTraces(traces, create, {project = state => state} = {}) {
  const coverage = new Map();
  let checkpoints = 0, rejected = 0;
  for (const [traceIndex,trace] of traces.entries()) {
    const driver = await create(trace);
    try {
      const actual=await driver.observe(),expected=project(trace.init);
      assert.deepEqual(actual, expected, `${trace.name}: initial state`);
      recordComparedObservation({trace:traceIndex,step:0,actual,expected});
      checkpoints++;
      let index = 0, before = trace.init;
      for (const step of trace.steps) {
        index++;
        const label = `${trace.name} step ${index} ${step.reject ? 'refused ' : ''}${step.action ?? 'stutter'}(${step.args.map(arg => JSON.stringify(arg)).join(', ')})`;
        if (step.action) {
          assert.equal(typeof driver[step.action], 'function', `${label}: the driver has no such action`);
          await driver[step.action](...step.args, {before, after: step.state});
          if (step.reject) rejected++;
          else coverage.set(step.action, (coverage.get(step.action) || 0) + 1);
        }
        const actual=await driver.observe(),expected=project(step.state);
        assert.deepEqual(actual, expected, label);
        recordComparedObservation({trace:traceIndex,step:index,action:step.reject?null:step.action,args:step.args,actual,expected});
        before = step.state;
        checkpoints++;
      }
    } finally { await driver.close?.(); }
  }
  return {traces: traces.length, checkpoints, rejected, actions: Object.fromEntries([...coverage].sort())};
}

/** Bundles one repository source (or several, as one module instance) for Node with the imports matching `stubs` keys (regular
 * expression source) replaced by the given module text, as the neighbouring adapter tests do. */
export async function sourceModule(path, stubs = {}) {
  captureReplayInputs(Array.isArray(path)?path:[path]);
  const entries = Object.entries(stubs).map(([pattern, contents]) => [new RegExp(pattern), contents]);
  const entry = Array.isArray(path)
    ? {stdin: {contents: path.map(item => `export * from './${item}';`).join('\n'), resolveDir: repositoryRoot, loader: 'ts'}}
    : {entryPoints: [path]};
  const bundled = await build({absWorkingDir: repositoryRoot, ...entry, bundle: true, format: 'esm', platform: 'node', write: false, metafile:true, logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom', '@capacitor/core'],
    plugins: [{name: 'stubs', setup(builder) {
      builder.onResolve({filter: /.*/}, args => { const index = entries.findIndex(([pattern]) => pattern.test(args.path)); return index < 0 ? undefined : {path: String(index), namespace: 'stub'}; });
      builder.onLoad({filter: /.*/, namespace: 'stub'}, args => ({contents: entries[Number(args.path)][1], loader: 'js', resolveDir: repositoryRoot}));
    }}]});
  captureReplayInputs(Object.keys(bundled.metafile.inputs).filter(path=>!path.startsWith('stub:')&&path!=='<stdin>'));
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}

/** Lets every settled promise continuation of the implementation run. */
export async function settle(turns = 6) {
  for (let turn = 0; turn < turns; turn++) await new Promise(resolve => setImmediate(resolve));
}
