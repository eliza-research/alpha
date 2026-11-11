// Trace replay for the Notes, Files and media models. The pinned Quint simulator writes ITF
// traces with the action taken and its nondeterministic picks at every step; a driver replays
// each step against the product module and the observed state must equal the model state.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {captureReplayInputs, recordComparedObservation} from '../observed-replay.mjs';
import {scaledTimeout} from '../timeouts.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const quint = join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js');

/** ITF values as plain data: integers, arrays for lists and tuples, sorted arrays for sets,
 * objects keyed by the printed key for maps. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#tup' in value) return value['#tup'].map(plain);
  if ('#set' in value) return value['#set'].map(plain).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if ('#map' in value) return Object.fromEntries(value['#map'].map(([key, item]) => [String(plain(key)), plain(item)]));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

/** Simulate `main` and return its traces as [{action, picks, state}], one entry per model state.
 * A stutter step has the action ''. `state` holds every model variable. */
export function modelTraces({path, main, traces = 24, maxSteps = 16, seed = 20261107}) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-itf-'));
  try {
    const result = spawnSync(process.execPath, [quint, 'run', path, `--main=${main}`, '--backend=typescript',
      `--seed=${seed}`, `--max-samples=${traces}`, `--n-traces=${traces}`, `--max-steps=${maxSteps}`, '--mbt',
      `--out-itf=${join(directory, 'trace-{seq}.itf.json')}`], {cwd: repositoryRoot, encoding: 'utf8', timeout: scaledTimeout(120000)});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const files = readdirSync(directory).filter(name => name.endsWith('.itf.json')).sort();
    assert.ok(files.length > 0, 'the simulator wrote no trace');
    return files.map(name => shape(join(directory, name)));
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

const shape = file => JSON.parse(readFileSync(file, 'utf8')).states.map(raw => {
  const {['#meta']: _meta, ['mbt::actionTaken']: action, ['mbt::nondetPicks']: picks, ...state} = raw;
  return {action, state: plain(state),
    picks: Object.fromEntries(Object.entries(picks ?? {}).filter(([, pick]) => pick.tag === 'Some').map(([name, pick]) => [name, plain(pick.value)]))};
});

/** One trace per reachability witness: the simulator's counterexample to `not(witness)`, which
 * ends in the witnessed state. Deep situations a short random walk rarely reaches are replayed
 * this way. */
export function witnessTraces({path, main, witnesses, seed = 20261107, maxSamples = 2000, maxSteps = 60}) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-itf-'));
  try {
    return witnesses.map(witness => {
      const output = join(directory, `${witness}.itf.json`);
      const result = spawnSync(process.execPath, [quint, 'run', path, `--main=${main}`, '--backend=typescript', `--seed=${seed}`,
        `--max-samples=${maxSamples}`, `--max-steps=${maxSteps}`, `--invariant=not(${witness})`, '--mbt', `--out-itf=${output}`],
      {cwd: repositoryRoot, encoding: 'utf8', timeout: scaledTimeout(120000)});
      assert.match(`${result.stdout}`, /\[violation\]/, `${witness} was not reached\n${result.stdout}\n${result.stderr}`);
      return shape(output);
    });
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

let loads = 0;
/** Bundle a product TypeScript module for Node. `stubs` maps an import specifier to replacement
 * source; `rewrite` maps a repository path suffix to a text transform applied before bundling.
 * Each call returns a fresh module instance. */
export async function loadProductModule(path, {stubs = {}, rewrite = {}} = {}) {
  const bundled = await build({absWorkingDir: repositoryRoot, entryPoints: [path], bundle: true, format: 'esm',
    platform: 'neutral', write: false, logLevel: 'silent', plugins: [{name: 'ports', setup(b) {
      b.onLoad({filter: /.*/, namespace: 'file'}, args => {captureReplayInputs([args.path]);});
      b.onResolve({filter: /.*/}, args => args.path in stubs || args.path.endsWith('.css') ? {path: args.path, namespace: 'port'} : undefined);
      b.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: stubs[args.path] ?? '', loader: 'js'}));
      for (const [suffix, transform] of Object.entries(rewrite)) {
        b.onLoad({filter: new RegExp(suffix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$')}, args => {
          const before = readFileSync(args.path, 'utf8'), after = transform(before);
          assert.notEqual(after, before, `${suffix} was not rewritten`);
          return {contents: after, loader: 'ts'};
        });
      }
    }}]});
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + `\n// ${++loads}`).toString('base64')}`);
}

export const settle = () => new Promise(done => setTimeout(done, 0));

/** Replay every trace. `start(initial)` builds a driver for the model's initial state and
 * returns {actions, observe, close?}; `actions[name](picks, before, after)` performs the product
 * step for a model action; `observe()` returns the product state in the model's vocabulary and
 * `project(state)` selects the model fields it is compared with. Every action in `required` and
 * every situation in `reached` must occur in the traces, so a replay cannot pass by idling. */
export async function replayTraces(traces, {start, project, required = [], reached = {}}) {
  const seen = new Map(), covered = Object.fromEntries(Object.keys(reached).map(name => [name, 0]));
  // Situations the replay must pass through, counted over the model states it compared.
  for (const trace of traces) for (const [name, holds] of Object.entries(reached)) if (trace.some(step => holds(step.state))) covered[name]++;
  for (const [name, count] of Object.entries(covered)) assert.ok(count > 0, `no trace reached ${name}`);
  let steps = 0;
  for (const [index, trace] of traces.entries()) {
    const driver = await start(trace[0].state, trace[0].picks);
    try {
      const initialObservation = await driver.observe(), initialProjection = project(trace[0].state);
      assert.deepEqual(initialObservation, initialProjection, `trace ${index} initial state`);
      recordComparedObservation({trace: index, step: 0, init: trace[0].action || 'init', actual: initialObservation, expected: initialProjection});
      for (let at = 1; at < trace.length; at++) {
        const {action, picks, state} = trace[at], label = `trace ${index} step ${at} ${action || 'stutter'} ${JSON.stringify(picks)}`;
        if (action) {
          const run = driver.actions[action];
          assert.equal(typeof run, 'function', `${label}: no product step for this model action`);
          await run(picks, trace[at - 1].state, state);
          seen.set(action, (seen.get(action) ?? 0) + 1);
          steps++;
        }
        const observation = await driver.observe(), projection = project(state);
        assert.deepEqual(observation, projection, label);
        recordComparedObservation({trace: index, step: at, action, picks, actual: observation, expected: projection});
      }
    } finally { await driver.close?.(); }
  }
  for (const action of required) assert.ok(seen.has(action), `no trace exercised ${action}`);
  return {traces: traces.length, steps, actions: Object.fromEntries([...seen].sort()), reached: covered};
}

/** A key-value Storage port. */
export function memoryStorage() {
  const values = new Map();
  return {values, getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); }, removeItem: key => { values.delete(key); }};
}

/** The revisioned document store port BrowserDomainDocument is given. `writes` counts commits. */
export function memoryDocuments() {
  const rows = new Map();
  let revision = 0;
  const put = (key, raw) => { const snapshot = {revision: String(++revision), raw}; rows.set(key, snapshot); store.writes++; return snapshot; };
  const store = {writes: 0, creations: 0, rows,
    async read(key) { return rows.get(key); },
    async readOrCreate(key, raw) { if (rows.has(key)) return rows.get(key); store.creations++; return put(key, raw); },
    async compareExchange(key, expected, raw) {
      const current = rows.get(key);
      if (current?.revision !== expected?.revision || current?.raw !== expected?.raw) throw Error('Document changed.');
      return put(key, raw);
    },
    async edit(key, editor) { const {raw, result} = await editor(rows.get(key)); put(key, raw); return result; }};
  return store;
}
