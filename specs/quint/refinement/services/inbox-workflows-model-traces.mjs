import assert from 'node:assert/strict';
import {captureReplayInputs} from '../observed-replay.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {scaledTimeout} from '../timeouts.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const cli = join(root, 'node_modules/@informalsystems/quint/dist/src/cli.js');

/** ITF values as plain JavaScript: integers as numbers, sets as arrays, maps as Map, tuples as arrays. */
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  if ('#bigint' in value) return Number(value['#bigint']);
  if ('#set' in value) return value['#set'].map(plain);
  if ('#tup' in value) return value['#tup'].map(plain);
  if ('#map' in value) return new Map(value['#map'].map(([key, entry]) => [plain(key), plain(entry)]));
  if ('tag' in value && 'value' in value && Object.keys(value).length === 2) return {tag: value.tag, value: plain(value.value)};
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '#meta').map(([key, entry]) => [key, plain(entry)]));
}

function read(path, variable) {
  const trace = JSON.parse(readFileSync(path, 'utf8'));
  return trace.states.map(state => ({
    action: state['mbt::actionTaken'] ?? null,
    picks: Object.fromEntries(Object.entries(state['mbt::nondetPicks'] ?? {}).filter(([, pick]) => pick?.tag === 'Some').map(([name, pick]) => [name, plain(pick.value)])),
    state: plain(variable ? state[variable] : Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('mbt::') && key !== '#meta'))),
  }));
}

/**
 * Random walks of a model's `step`, as the pinned interpreter produces them. Each entry carries the
 * action the interpreter took (empty for the stutter branch), its nondeterministic picks and the
 * state after it. The walks are fixed by the seed, so a failure is reproducible.
 */
export function modelWalks(model, {main, traces = 40, steps = 25, seed = 20261107, variable = 's'} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-walks-'));
  try {
    const result = spawnSync(process.execPath, [cli, 'run', model, `--main=${main}`, '--backend=typescript', `--seed=${seed}`,
      `--max-samples=${traces}`, `--n-traces=${traces}`, `--max-steps=${steps}`, '--mbt', `--out-itf=${join(directory, 'walk-{seq}.itf.json')}`],
    {cwd: root, encoding: 'utf8', timeout: scaledTimeout(120000), maxBuffer: 16 * 1024 * 1024});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const files = readdirSync(directory).filter(name => name.endsWith('.itf.json')).sort();
    assert.ok(files.length > 0, 'The interpreter wrote no walk');
    return files.map(name => read(join(directory, name), variable));
  } finally {rmSync(directory, {recursive: true, force: true});}
}

/** Splits `a.then(b).expect(c)` at the top level into its calls. */
function chain(text) {
  const calls = [];
  let depth = 0, start = 0, head = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0 && head !== null) { calls.push({kind: head, body: text.slice(start, i).trim()}); head = null; }
    } else if (depth === 0 && c === '.' && head === null) {
      const call = /^\.(then|expect)\(/.exec(text.slice(i));
      if (call) { head = call[1]; start = i + call[0].length; i = start - 1; depth = 1; }
    }
  }
  return calls;
}

/** The top-level arguments of a call's text, as written in the model. */
function callArguments(text) {
  const open = text.indexOf('(');
  if (open < 0) return {name: text.trim(), args: []};
  const args = [];
  let depth = 0, start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) { if (text.slice(start, i).trim()) args.push(text.slice(start, i).trim()); break; } depth--; }
    else if (c === ',' && depth === 0) { args.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return {name: text.slice(0, open).trim(), args};
}

/**
 * One named `run` scenario of a model: its actions as the model text writes them, each with the
 * state the pinned interpreter reached after it. A step the scenario expects to be refused
 * (`.fail()`) is marked `rejected` and carries the unchanged state before it.
 */
export function modelScenario(model, scenario, {main, seed = 20261107, variable = 's'} = {}) {
  const source = readFileSync(join(root, model), 'utf8');
  const begin = source.search(new RegExp(`\\brun ${scenario}\\s*=`));
  assert.ok(begin >= 0, `${scenario} is not a run of ${model}`);
  const rest = source.slice(source.indexOf('=', begin) + 1);
  const end = rest.search(/\n\s*(?:\/\/\/[^\n]*\n\s*)*(?:run|val|def|action|pure|temporal|type|var|const)\b|\n}\s*$/);
  const body = (end < 0 ? rest : rest.slice(0, end)).replace(/\/\/[^\n]*/g, '');
  const first = body.search(/\.(?:then|expect)\(/);
  const steps = [{text: (first < 0 ? body : body.slice(0, first)).trim()}, ...chain(first < 0 ? '' : body.slice(first)).filter(call => call.kind === 'then').map(call => ({text: call.body}))];
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-scenario-'));
  try {
    const result = spawnSync(process.execPath, [cli, 'test', model, `--main=${main}`, '--backend=typescript', `--seed=${seed}`,
      '--max-samples=1', `--match=^${scenario}$`, `--out-itf=${join(directory, 'trace-{test}-{seq}.json')}`],
    {cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const states = JSON.parse(readFileSync(join(directory, `trace-${scenario}-0.json`), 'utf8')).states;
    assert.equal(states.length, steps.length, `${scenario}: ${states.length} states for ${steps.length} written steps`);
    let last;
    return steps.map((step, index) => {
      const rejected = /\.fail\(\)$/.test(step.text);
      const {name, args} = callArguments(rejected ? step.text.replace(/\.fail\(\)$/, '') : step.text);
      if (!rejected) last = plain(variable ? states[index][variable] : states[index]);
      return {action: index === 0 ? 'init' : name, args, picks: {}, rejected, state: last};
    });
  } finally {rmSync(directory, {recursive: true, force: true});}
}

/** Loads a repository TypeScript module as its neighbours' tests do: bundled for Node, with replaceable imports. */
export async function sourceModule(path, {replace = {}, external = [], define = {}, fresh = false} = {}) {
  captureReplayInputs([path]);
  const plugins = [{name: 'replace', setup(b) {
    for (const [filter, contents] of Object.entries(replace)) {
      const pattern = new RegExp(filter);
      b.onResolve({filter: pattern}, args => ({path: args.path, namespace: 'replaced-' + filter}));
      b.onLoad({filter: /.*/, namespace: 'replaced-' + filter}, () => ({contents, loader: 'js'}));
    }
  }}];
  const bundled = await build({absWorkingDir: root, entryPoints: [path], bundle: true, format: 'esm', platform: 'node',
    write: false, metafile:true, logLevel: 'silent', plugins, external, define});
  captureReplayInputs(Object.keys(bundled.metafile.inputs).filter(path=>!path.startsWith('replaced-')));
  const text = bundled.outputFiles[0].text;
  let instance = 0;
  const load = () => import(`data:text/javascript;base64,${Buffer.from(`${text}\n// instance ${instance++}`).toString('base64')}`);
  const module = await load();
  // Each call evaluates the module again, with its own module state, as a new app process would.
  return fresh ? {...module, fresh: load} : module;
}

/** Counts how often each model action was replayed, so a test can require that none was skipped. */
export function actionCounter() {
  const seen = new Map();
  return {note: name => seen.set(name, (seen.get(name) ?? 0) + 1), count: name => seen.get(name) ?? 0, all: () => Object.fromEntries(seen)};
}
