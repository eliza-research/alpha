/** Model traces for implementation replay.
 *
 * The pinned Quint CLI produces ITF traces of a model: its named scenarios, random walks of `step`
 * and one walk into each reachability witness. Every step carries the action that was taken, its
 * arguments and the model state after it, so a driver can run the same action against product code
 * and compare an observation with the model state after every step. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js');
const SEED = '20261107';

/** ITF values as plain data: integers as numbers, sets as sorted arrays, maps as objects. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#set' in value) return value['#set'].map(plain).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if ('#map' in value) return Object.fromEntries(value['#map'].map(([key, item]) => [String(plain(key)), plain(item)]));
  if ('#tup' in value) return value['#tup'].map(plain);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

function balanced(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if ('({['.includes(text[index])) depth++;
    else if (')}]'.includes(text[index]) && --depth === 0) return index;
  }
  throw Error('Unbalanced model text');
}

function splitArguments(text) {
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
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts.map(part => part.trim());
}

function literal(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^"[^"\\]*"$/.test(text)) return text.slice(1, -1);
  throw Error(`Scenario argument ${text} is not a literal`);
}

function callOf(text) {
  const call = text.trim(), open = call.indexOf('(');
  if (open < 0) { assert.match(call, /^\w+$/, call); return {action: call, args: []}; }
  assert.equal(balanced(call, open), call.length - 1, call);
  return {action: call.slice(0, open), args: splitArguments(call.slice(open + 1, -1))};
}

/** Which nondeterministic picks each action of `step` receives, by position. */
export function stepParameters(source) {
  const start = source.search(/\baction step\s*=/);
  assert.ok(start >= 0, 'model has no step action');
  const any = source.indexOf('any {', start), end = balanced(source, any + 4);
  const parameters = new Map();
  for (const item of splitArguments(source.slice(any + 5, end))) {
    if (/^s'\s*=\s*s$/.test(item)) continue;
    const {action, args} = callOf(item);
    parameters.set(action, args);
  }
  return parameters;
}

/** The action chain of one `run` scenario, with `run` prefixes expanded. */
export function scenarioActions(source, name, seen = new Set()) {
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
      const {action, args} = callOf(source.slice(open + 1, close));
      steps.push({action, args: args.map(literal)});
    }
    index = close + 1;
  }
  return steps;
}

function quint(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd: repositoryRoot, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024});
  assert.ifError(result.error);
  return result;
}

function withDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-replay-'));
  try { return run(directory); } finally { rmSync(directory, {recursive: true, force: true}); }
}

function walk(file, name, parameters, state) {
  const trace = JSON.parse(readFileSync(file, 'utf8')), steps = [];
  for (const item of trace.states.slice(1)) {
    const action = item['mbt::actionTaken'];
    if (!action) { steps.push({action: null, args: [], state: plain(item[state])}); continue; }
    assert.ok(parameters.has(action), `${name}: step action ${action} is not listed in step`);
    const picks = item['mbt::nondetPicks'] || {};
    const args = parameters.get(action).map(pick => {
      const value = picks[pick];
      assert.equal(value?.tag, 'Some', `${name}: ${action} has no pick ${pick}`);
      return plain(value.value);
    });
    steps.push({action, args, state: plain(item[state])});
  }
  return {name, init: plain(trace.states[0][state]), steps};
}

/**
 * Traces of one model: `{name, init, steps: [{action, args, state}]}`. A step whose action is null
 * is the model's stutter. Scenario traces replay the manifest's `run` tests, witness traces end in
 * a state satisfying the witness, and random traces sample `step`.
 */
export function modelTraces({path, module, scenarios = [], witnesses = [], random = 0, steps = 25, state = 's'}) {
  const source = readFileSync(join(repositoryRoot, path), 'utf8'), parameters = stepParameters(source), traces = [];
  const common = [path, `--main=${module}`, '--backend=typescript', `--seed=${SEED}`];
  withDirectory(directory => {
    for (const name of scenarios) {
      const result = quint(['test', ...common, '--max-samples=1', `--match=^${name}$`, `--out-itf=${join(directory, 'scenario-{test}-{seq}.json')}`]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const actions = scenarioActions(source, name);
      const trace = JSON.parse(readFileSync(join(directory, `scenario-${name}-0.json`), 'utf8'));
      assert.equal(trace.states.length, actions.length + 1, `${name}: one model state per scenario action`);
      traces.push({name, init: plain(trace.states[0][state]),
        steps: actions.map((step, index) => ({...step, state: plain(trace.states[index + 1][state])}))});
    }
    for (const witness of witnesses) {
      const file = join(directory, `witness-${witness}.json`);
      const result = quint(['run', ...common, '--max-samples=2000', '--max-steps=60', '--mbt', `--invariant=not(${witness})`, `--out-itf=${file}`]);
      assert.match(`${result.stdout}${result.stderr}`, /\[violation\]/, `${witness} is not reached: ${result.stdout}\n${result.stderr}`);
      traces.push(walk(file, witness, parameters, state));
    }
    if (random) {
      const result = quint(['run', ...common, `--max-samples=${random}`, `--n-traces=${random}`, `--max-steps=${steps}`, '--mbt', `--out-itf=${join(directory, 'random-{seq}.json')}`]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const files = readdirSync(directory).filter(name => name.startsWith('random-')).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
      assert.ok(files.length > 0, 'the simulator wrote no random trace');
      for (const file of files) traces.push(walk(join(directory, file), file.replace('.json', ''), parameters, state));
    }
  });
  return traces;
}

/**
 * Replay traces against an implementation. `create(trace)` builds a fresh driver with one method
 * per model action and `observe()`, which returns the implementation's view of (a projection of)
 * the model state. Every step's observation must equal the same projection of the model state.
 */
export async function replayTraces(traces, create, {project = state => state} = {}) {
  const coverage = new Map();
  let checkpoints = 0;
  for (const trace of traces) {
    const driver = await create(trace);
    try {
      assert.deepEqual(await driver.observe(), project(trace.init), `${trace.name}: initial state`);
      checkpoints++;
      let index = 0;
      for (const step of trace.steps) {
        index++;
        const label = `${trace.name} step ${index} ${step.action ?? 'stutter'}(${step.args.map(arg => JSON.stringify(arg)).join(', ')})`;
        if (step.action) {
          assert.equal(typeof driver[step.action], 'function', `${label}: the driver has no such action`);
          await driver[step.action](...step.args);
          coverage.set(step.action, (coverage.get(step.action) || 0) + 1);
        }
        assert.deepEqual(await driver.observe(), project(step.state), label);
        checkpoints++;
      }
    } finally { await driver.close?.(); }
  }
  return {traces: traces.length, checkpoints, actions: Object.fromEntries([...coverage].sort())};
}
