import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = join(root, 'node_modules/@informalsystems/quint/dist/src/cli.js');

/** ITF values as plain JavaScript: integers, sorted arrays for sets, objects for maps and records. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#set' in value) return value['#set'].map(plain).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if ('#map' in value) return Object.fromEntries(value['#map'].map(([key, item]) => [String(plain(key)), plain(item)]));
  if ('#tup' in value) return value['#tup'].map(plain);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

function read(file, name, variable) {
  const trace = JSON.parse(readFileSync(file, 'utf8'));
  const steps = trace.states.map(state => ({
    action: state['mbt::actionTaken'],
    picks: Object.fromEntries(Object.entries(state['mbt::nondetPicks'] ?? {})
      .filter(([, pick]) => pick.tag === 'Some').map(([key, pick]) => [key, plain(pick.value)])),
    state: plain(state[variable]),
  }));
  assert.equal(steps[0].action, 'init', name);
  return {name, steps};
}

function quint(args) {
  return new Promise((resolve, reject) => execFile(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8',
    timeout: 120000, maxBuffer: 16 * 1024 * 1024}, (error, stdout, stderr) => {
    if (error && typeof error.code !== 'number') reject(error);
    else resolve({status: error ? error.code : 0, stdout, stderr});
  }));
}

/**
 * Traces of `module` produced by the pinned Quint simulator: `traces` random walks of at most
 * `steps` transitions, and one walk per witness or goal that ends in a state where it holds.
 * Each step names the model action taken, its nondeterministic picks and the state after it.
 * `goals` name further states to walk to, as Quint expressions over the model state.
 */
export function modelTraces(options) {
  // One simulator campaign per model and process: a second replay reads the same traces.
  const key = JSON.stringify(options);
  if (!generated.has(key)) generated.set(key, generate(options));
  return generated.get(key);
}
const generated = new Map();
async function generate({path, module, variable = 's', witnesses = [], goals = {}, traces = 12, steps = 30,
  samples = 60, seed = 20261107}) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-itf-'));
  const common = [path, `--main=${module}`, '--backend=typescript', '--mbt', `--seed=${seed}`];
  try {
    const walk = await quint(['run', ...common, `--max-samples=${samples}`, `--max-steps=${steps}`, `--n-traces=${traces}`,
      '--invariant=safety', `--out-itf=${join(directory, 'walk-{seq}.itf.json')}`]);
    assert.equal(walk.status, 0, `${walk.stdout}\n${walk.stderr}`);
    const found = readdirSync(directory).filter(name => name.startsWith('walk-')).sort()
      .map(name => read(join(directory, name), name.replace('.itf.json', ''), variable));
    assert.equal(found.length, traces, `${module} random walks`);
    const wanted = [...witnesses.map(witness => [witness, witness]), ...Object.entries(goals)];
    const reach = async ([name, goal]) => {
      const file = join(directory, `goal-${name}.itf.json`);
      const reached = await quint(['run', ...common, '--max-samples=20000', '--max-steps=60', '--n-traces=1',
        `--invariant=not(${goal})`, `--out-itf=${file}`]);
      assert.notEqual(reached.status, 0, `${module} never reached ${name}\n${reached.stdout}\n${reached.stderr}`);
      assert.match(reached.stdout + reached.stderr, /violation/i, `${module} ${name}`);
      return read(file, name, variable);
    };
    // A few simulator processes at a time.
    for (let index = 0; index < wanted.length; index += 4) found.push(...await Promise.all(wanted.slice(index, index + 4).map(reach)));
    return found;
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

/** Model actions taken across `traces`, with how often each was replayed. */
export function actionCounts(traces) {
  const counts = {};
  for (const trace of traces) for (const step of trace.steps.slice(1)) {
    const name = step.action || 'stutter';
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** Compares the implementation's projected state with the model state, naming the trace and step. */
export function sameState(actual, expected, trace, index) {
  const step = trace.steps[index];
  assert.deepEqual(actual, expected, `${trace.name} step ${index} ${step.action || 'stutter'} ${JSON.stringify(step.picks)}\n` +
    `actions so far: ${trace.steps.slice(1, index + 1).map(item => item.action || 'stutter').join(' ')}`);
}
