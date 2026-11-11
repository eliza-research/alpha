/** Receipts for existing forward replays. Observations are recorded only at the real
 * source/model comparison, never reconstructed from the replay's summary counters. */
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, retainGeneratedSource, verifyRefinementReceiptInputs} from './check-traces.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const active = new AsyncLocalStorage();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const within = (directory, path) => {
  const name = relative(directory, path);
  return name !== '' && !isAbsolute(name) && name !== '..' && !name.startsWith('..' + sep);
};
const temporary = path => !within(root, path) && within(resolve(tmpdir()), path);

function filesUnder(directory, output) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (['node_modules', '.git', 'artifacts', 'test-results'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(path, output);
    else if (entry.isFile()) output.add(path);
  }
}

/** Bind all tracked product inputs, new fixture modules and the generated client
 * tree. This deliberately over-approximates the source closure. Actual generated
 * Java ports, compiler inputs and trace argument files are added before use. */
function sourceClosure(extraSources) {
  const files = new Set(execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'})
    .split('\0').filter(Boolean).map(path => resolve(root, path))
    .filter(path => existsSync(path) && lstatSync(path).isFile()));
  for (const name of ['specs/quint/refinement', 'test/fixtures', 'test/support', '.eliza/client-features'])
    filesUnder(join(root, name), files);
  for (const path of extraSources) files.add(resolve(root, path));
  return [...files];
}

/** The same conservative closure for a new reverse/source-observation adapter
 * that uses checkTraces directly instead of an existing forward replay. */
export function captureReplayClosure(extraSources = []) {
  return captureInputs(sourceClosure(extraSources));
}

/** Called before the JVM compiles/reads any input. Outside a receipt campaign this
 * is a no-op, so standalone replay behavior and its mutation canaries are intact. */
export function captureReplayInputs(paths) {
  const current = active.getStore();
  if (!current) return;
  const files = new Set();
  for (const name of paths) {
    const path = resolve(root, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) filesUnder(path, files);
    else {
      assert.ok(stat.isFile(), 'Replay input must be a regular file: ' + path);
      files.add(path);
    }
  }
  for (const path of files) {
    const sha256 = hash(path);
    if (Object.hasOwn(current.before, path)) assert.equal(sha256, current.before[path], 'Replay input changed before use: ' + path);
    else current.before[path] = sha256;
    if (temporary(path)) {
      retainGeneratedSource(path, sha256);
      current.snapshots[path] = sha256;
    }
  }
}

/** Record the exact observation already checked by an existing replay oracle.
 * `expected` is retained for audit; `expect` always contains source observations. */
export function recordComparedObservation({trace, step, action, args, picks, init = 'init', actual, expected}) {
  const current = active.getStore();
  if (!current) return;
  assert.deepEqual(actual, expected, 'Recorded source observation must equal the declared model projection');
  assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual));
  let entry = current.traces.get(trace);
  if (!entry) {
    assert.equal(step, 0, 'Every replay trace must record its initial source observation');
    entry = {name: String(trace), init: {name: init}, steps: []};
    current.traces.set(trace, entry);
  }
  assert.equal(step, Object.hasOwn(entry, 'expect') ? entry.steps.length + 1 : 0, 'Replay observations must be ordered and complete');
  const observed = Object.fromEntries(Object.entries(actual).map(([key, value]) => [current.prefix + '.' + key, structuredClone(value)]));
  for (const key of Object.keys(observed)) current.fields.add(key);
  const checkpoint = {expect: observed, modelProjection: structuredClone(expected)};
  if (step === 0) Object.assign(entry, checkpoint);
  else {
    const call = action ? {name: action, ...(args ? {args: structuredClone(args)} : {}), ...(picks ? {picks: structuredClone(picks)} : {})} : undefined;
    entry.steps.push({...checkpoint, label: 'Actual source replay checkpoint ' + step, ...(call ? {action: call} : {})});
    if (action) current.actions[action] = (current.actions[action] ?? 0) + 1;
  }
  current.checkpoints++;
}

export async function observedReplay({model, run, prefix, projection, assumptions, extraSources = [], out}) {
  assert.match(model, /^[A-Za-z][A-Za-z0-9_]*$/);
  assert.match(prefix, /^[A-Za-z][A-Za-z0-9_]*$/);
  const current = {before: captureReplayClosure(extraSources), snapshots: {}, traces: new Map(), fields: new Set(), actions: {}, checkpoints: 0, prefix};
  const receiptPath = out ? resolve(root, out) : join(root, 'test-results/quint-refinement', model + '-forward-replay.json');
  const receipt = {schemaVersion: 1, model, scope: 'bounded-component',
    assumptions, projection, sourceCapture: 'before source replay; generated compiler inputs captured before use',
    startedAt: new Date().toISOString(), passed: false, status: 'running'};
  const publish = () => writeFileSync(receiptPath,
    JSON.stringify(receipt, (_key, value) => typeof value === 'bigint' ? {'#bigint': String(value)} : value, 2) + '\n');
  mkdirSync(dirname(receiptPath), {recursive: true});
  publish();
  let failure;
  try {
    const summary = await active.run(current, run);
    assert.ok(current.checkpoints > 0, 'A passing replay must record actual source comparisons');
    assert.equal(summary.traces, current.traces.size, 'Every summarized trace must have recorded observations');
    if (summary.checkpoints !== undefined) assert.equal(summary.checkpoints, current.checkpoints);
    if (summary.steps !== undefined) assert.equal(summary.steps, Object.values(current.actions).reduce((sum, value) => sum + value, 0));
    receipt.replaySummary = summary;
  } catch (error) { failure = error; }
  const after = {};
  try {
    for (const [path, sha256] of Object.entries(current.before)) {
      after[path] = existsSync(path) ? hash(path) : current.snapshots[path];
      assert.equal(after[path], sha256, 'Replay input changed or disappeared: ' + path);
    }
  } catch (error) { failure ||= error; }
  Object.assign(receipt, {sourceHashesBefore: current.before, driverHashesBefore: current.before,
    sourceHashesAfter: after, generatedSourceSnapshots: current.snapshots,
    inputsUnchanged: Object.keys(after).length === Object.keys(current.before).length && Object.entries(current.before).every(([path, sha256]) => after[path] === sha256),
    traceInputs: [...current.traces.values()], traces: current.traces.size, checkpoints: current.checkpoints,
    actions: current.actions, observedFields: [...current.fields].sort(), finishedAt: new Date().toISOString()});
  receipt.driverInputsBound = receipt.inputsUnchanged && verifyRefinementReceiptInputs(receipt);
  if (!receipt.driverInputsBound) failure ||= Error('Forward replay source/fixture bindings are not current');
  receipt.passed = !failure;
  receipt.status = failure ? 'failed' : 'passed';
  if (failure) receipt.error = failure.stack ?? String(failure);
  publish();
  if (failure) throw failure;
  return {...receipt, receiptPath};
}
