import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runQuintChecker} from '../../../scripts/quint-lib.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const fieldPath = /^[A-Za-z][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z][A-Za-z0-9_]*)*$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = path => digest(readFileSync(path));
const hashPattern = /^[a-f0-9]{64}$/;
const snapshotDirectory = join(root, 'test-results/quint-refinement/input-snapshots');
const checkerSources = [fileURLToPath(import.meta.url), join(root, 'scripts/quint-lib.ts')];

function containsPath(directory, file) {
  const name = relative(directory, file);
  return name !== '' && !isAbsolute(name) && name !== '..' && !name.startsWith('..'+sep);
}

function isTemporarySource(path) {
  // macOS exposes the same temp directory through /var and canonical /private/var.
  // Accept either root spelling; live files still need the physical containment check below.
  const temporaryRoots = [resolve(tmpdir()), realpathSync(tmpdir())];
  return isAbsolute(path) && resolve(path) === path && temporaryRoots.some(directory => containsPath(directory, path))
    && !containsPath(root, path) && !containsPath(realpathSync(root), path);
}

function isGeneratedFile(path) {
  if (!isTemporarySource(path) || !lstatSync(path).isFile()) return false;
  const resolved = realpathSync(path);
  return containsPath(realpathSync(tmpdir()), resolved) && !containsPath(realpathSync(root), resolved);
}

function matchesSnapshot(sha256) {
  const path = join(snapshotDirectory, sha256);
  return lstatSync(path, {throwIfNoEntry: false})?.isFile() && hash(path) === sha256;
}

function retainGeneratedSource(path, sha256) {
  if (!isGeneratedFile(path)) throw new Error('Generated refinement input is no longer a temporary file: '+path);
  const bytes = readFileSync(path);
  if (digest(bytes) !== sha256) throw new Error('Generated refinement input changed during snapshot: '+path);
  mkdirSync(snapshotDirectory, {recursive: true});
  const snapshot = join(snapshotDirectory, sha256);
  if (!lstatSync(snapshot, {throwIfNoEntry: false})) {
    const stage = mkdtempSync(join(snapshotDirectory, '.publish-'));
    try {
      const staged = join(stage, 'source');
      writeFileSync(staged, bytes, {mode: 0o600});
      try {linkSync(staged, snapshot);}
      catch (error) {if (error.code !== 'EEXIST') throw error;}
    } finally {rmSync(stage, {recursive: true, force: true});}
  }
  if (!matchesSnapshot(sha256)) throw new Error('Retained refinement input does not match its address: '+sha256);
}

/** Revalidate live sources and use retained bytes only for a declared, removed generated input. */
export function verifyRefinementReceiptInputs(receipt) {
  const inputs = receipt.sourceHashesAfter;
  const snapshots = receipt.generatedSourceSnapshots ?? {};
  if (!inputs || typeof snapshots !== 'object' || Array.isArray(snapshots)) return false;
  try {
    for (const [path, sha256] of Object.entries(snapshots)) {
      if (!isTemporarySource(path) || !hashPattern.test(sha256) || !Object.hasOwn(inputs, path)
          || inputs[path] !== sha256 || receipt.sourceHashesBefore?.[path] !== sha256
          || receipt.driverHashesBefore?.[path] !== sha256 || !matchesSnapshot(sha256)) return false;
    }
    return Object.entries(inputs).every(([path, sha256]) => {
      const live = lstatSync(path, {throwIfNoEntry: false});
      if (!live) return Object.hasOwn(snapshots, path);
      return (!Object.hasOwn(snapshots, path) || isGeneratedFile(path)) && hash(path) === sha256;
    });
  } catch {return false;}
}
function registeredModelInputs() {
  const paths = new Set();
  for (const family of ['application', 'services', 'native', 'legacy']) {
    const manifest = join(root, 'specs/quint', family, 'manifest.json');
    paths.add(manifest);
    const document = JSON.parse(readFileSync(manifest));
    for (const model of Array.isArray(document) ? document : document.models) {
      for (const path of modelDependencies(join(root, model.path))) paths.add(path);
    }
  }
  return [...paths];
}

/** Freeze model selection, safety predicates and implementation inputs before driving source. */
export function captureInputs(sources) {
  const inputs = new Set([
    ...registeredModelInputs(),
    ...sources.map(source => resolve(root, source)),
    ...checkerSources,
  ]);
  return Object.fromEntries([...inputs].map(path => [path, hash(path)]));
}
export const qset = values => ({quintCollection: 'set', values: [...values]});
export const qmap = entries => ({quintCollection: 'map', entries: [...entries]});

export function literal(value) {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string') {
    if (/["\\\u0000-\u001f]/.test(value) || !value.isWellFormed()) throw new Error('Map text with quotes, escapes or control characters to explicit equality classes before Quint serialization');
    return `"${value}"`;
  }
  if (value?.quintCollection === 'set') return `Set(${value.values.map(literal).join(', ')})`;
  if (value?.quintCollection === 'map') return `Map(${value.entries.map(([key, entry]) => `(${literal(key)}, ${literal(entry)})`).join(', ')})`;
  if (Array.isArray(value)) return `List(${value.map(literal).join(', ')})`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    for (const [key] of entries) if (!identifier.test(key)) throw new Error(`Invalid Quint record field ${key}`);
    return `{ ${entries.map(([key, entry]) => `${key}: ${literal(entry)}`).join(', ')} }`;
  }
  throw new Error(`Unsupported Quint literal ${String(value)}`);
}

function actionText(action) {
  if (!action || !fieldPath.test(action.name)) throw new Error('A model action name is required');
  const call = `spec::${action.name}${!action.args?.length ? '' : `(${action.args.map(literal).join(', ')})`}`;
  return call;
}

function observationText(observation) {
  const entries = Object.entries(observation || {});
  if (!entries.length) throw new Error('Every checkpoint needs a concrete source observation');
  return `all { ${entries.map(([path, value]) => {
    if (!fieldPath.test(path)) throw new Error(`Invalid observation path ${path}`);
    return `spec::${path} == ${literal(value)}`;
  }).join(', ')} }`;
}

function modelFile(model, requested) {
  if (requested) return isAbsolute(requested) ? requested : resolve(root, requested);
  for (const family of ['application', 'services', 'native', 'legacy']) {
    const document = JSON.parse(readFileSync(join(root, 'specs/quint', family, 'manifest.json')));
    const found = (Array.isArray(document) ? document : document.models).find(row => row.module === model);
    if (found) return join(root, found.path);
  }
  throw new Error(`Unknown model ${model}`);
}

function invariantFor(model) {
  for (const family of ['application', 'services', 'native', 'legacy']) {
    const document = JSON.parse(readFileSync(join(root, 'specs/quint', family, 'manifest.json')));
    const found = (Array.isArray(document) ? document : document.models).find(row => row.module === model);
    if (found) return found.invariant;
  }
  return null;
}

function modelDependencies(path, paths = new Set()) {
  if (paths.has(path)) return paths;
  paths.add(path);
  for (const match of readFileSync(path, 'utf8').matchAll(/\bfrom\s+"([^"]+)"/g)) {
    const imported = resolve(dirname(path), match[1]);
    modelDependencies(imported.endsWith('.qnt') ? imported : `${imported}.qnt`, paths);
  }
  return paths;
}

/** Check concrete source observations at every named model transition. */
export async function checkTraces({model, modelPath, sources, traces, assumptions = [], scope, id = model, out, batchSize = 60, driverHashes, generatedSources = []}) {
  if (!identifier.test(model) || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid model or receipt identifier');
  if (!['complete-finite-helper', 'bounded-component', 'bounded-orchestration'].includes(scope)) throw new Error('An explicit refinement scope is required');
  if (!Array.isArray(traces) || !traces.length || !Array.isArray(sources) || !sources.length) throw new Error('Concrete traces and implementation source paths are required');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Invalid trace batch size');
  const path = modelFile(model, modelPath);
  const invariant = invariantFor(model);
  const modelInputs = modelDependencies(path);
  const stable = new Set([...registeredModelInputs(), ...modelInputs, ...checkerSources]);
  const sourcePaths = new Set(sources.map(source => resolve(root, source)));
  if (!Array.isArray(generatedSources) || generatedSources.some(input => typeof input !== 'string'))
    throw new Error('Generated refinement sources must be an array of temporary input paths');
  const generated = [...new Set(generatedSources.map(input => resolve(root, input)))];
  for (const input of generated) {
    if (stable.has(input) || !sourcePaths.has(input) || !isGeneratedFile(input) || !hashPattern.test(driverHashes?.[input]))
      throw new Error('Generated refinement source must be an explicit driver-bound temporary file: '+input);
  }
  const inputs = [...new Set([...stable, ...Object.keys(driverHashes || {}), ...sourcePaths])];
  const before = Object.fromEntries(inputs.map(input => [input, hash(input)]));
  const receiptPath = out ? resolve(root, out) : join(root, 'test-results/quint-refinement', `${id}.json`);
  const receipt = {schemaVersion: 1, model, scope, assumptions, invariant, startedAt: new Date().toISOString(),
    sourceHashesBefore: before, driverHashesBefore: driverHashes || null,
    sourceCapture: driverHashes ? 'before driver execution' : 'before model checking, after observation generation',
    traces: traces.length, checkpoints: 0, actions: {}, observedFields: [],
    traceInputs: traces, results: [], passed: false, status: 'running'};
  const serialize = value => JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? {'#bigint': String(entry)} : entry, 2) + '\n';
  mkdirSync(dirname(receiptPath), {recursive: true});
  writeFileSync(receiptPath, serialize(receipt));
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-quint-refinement-'));
  const fields = new Set();
  let failure;
  try {
    for (let offset = 0; offset < traces.length; offset += batchSize) {
      const batch = traces.slice(offset, offset + batchSize);
      const definitions = batch.flatMap((trace, index) => {
        const name = `trace${offset + index}Test`;
        const rejected = [];
        let expression = actionText(trace.init || {name: 'init'});
        const checkpoints = [{expect: trace.expect}, ...(trace.steps || [])];
        for (let stepIndex = 0; stepIndex < checkpoints.length; stepIndex++) {
          const step = checkpoints[stepIndex];
          if (stepIndex > 0 && step.action) {
            const actions = Array.isArray(step.action) ? step.action : [step.action];
            for (const action of actions) {
              if (action.reject) rejected.push(`  run trace${offset + index}Reject${rejected.length}Test = ${expression}.then(${actionText(action)}.fail())`);
              else expression += `.then(${actionText(action)})`;
              receipt.actions[action.name] = (receipt.actions[action.name] || 0) + 1;
            }
          }
          for (const field of Object.keys(step.expect || {})) fields.add(field);
          expression += `.expect(${invariant ? `spec::${invariant} and ` : ''}${observationText(step.expect)})`;
          receipt.checkpoints++;
        }
        return [`  // ${JSON.stringify(trace.name || name)}\n  run ${name} = ${expression}`, ...rejected];
      });
      const wrapper = join(temporary, `Refinement${offset}.qnt`);
      const importPath = relative(temporary, path).replaceAll('\\', '/').replace(/\.qnt$/, '');
      writeFileSync(wrapper, `module Refinement${offset} {\n  import ${model} as spec from ${JSON.stringify(importPath)}\n${definitions.join('\n')}\n}\n`);
      const args = [join(root, 'node_modules/@informalsystems/quint/dist/src/cli.js'), 'test', wrapper,
        `--main=Refinement${offset}`, '--backend=typescript', '--max-samples=1', '--seed=20261107', '--match=^trace[0-9]+(Reject[0-9]+)?Test$'];
      const {result, interruptedAttempt} = await runQuintChecker(() => spawnSync(process.execPath, args,
        {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024}));
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      const checked = Number(output.match(/(\d+) passing/)?.[1] || 0);
      const passed = !result.error && !result.signal && result.status === 0 && checked === definitions.length;
      const mismatched = !result.error && !result.signal && /\[QNT508\]|Assertion failed/.test(output);
      const kind = passed ? 'passed' : mismatched ? 'observation-mismatch' : 'tool-failure';
      receipt.results.push({offset, count: batch.length, generatedCases: definitions.length, checked, exitCode: result.status, signal: result.signal, kind, interruptedAttempt,
        error: result.error?.message, output,
        names: batch.map(trace => trace.name)});
      if (kind === 'observation-mismatch') throw new Error(`Source/model trace mismatch in ${model} batch ${offset}\n${output}`);
      if (!passed) {
        const exit = result.signal ? `signal ${result.signal}` : `exit ${result.status}, checked ${checked} of ${definitions.length}`;
        throw new Error(`Quint checker failed in ${model} batch ${offset} (${result.error?.message ?? exit})\n${output}`);
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      receipt.sourceHashesAfter = Object.fromEntries(inputs.map(input => [input, hash(input)]));
      receipt.inputsUnchanged = inputs.every(input => before[input] === receipt.sourceHashesAfter[input]);
      if (!receipt.inputsUnchanged) failure ||= new Error('Refinement input changed during checking');
      receipt.driverInputsBound = !!driverHashes && inputs.every(input => driverHashes[input] === receipt.sourceHashesAfter[input]);
      if (driverHashes && !receipt.driverInputsBound) failure ||= new Error('Model, implementation or adapter changed during observation generation');
      if (!failure && generated.length) {
        for (const input of generated) retainGeneratedSource(input, before[input]);
        receipt.generatedSourceSnapshots = Object.fromEntries(generated.map(input => [input, before[input]]));
      }
    } catch (error) {
      failure ||= error;
    }
    if (failure) receipt.error = failure instanceof Error ? failure.stack : String(failure);
    receipt.observedFields = [...fields].sort();
    receipt.finishedAt = new Date().toISOString();
    receipt.passed = !failure;
    receipt.status = failure ? 'failed' : 'passed';
    try {writeFileSync(receiptPath, serialize(receipt));}
    finally {rmSync(temporary, {recursive: true, force: true});}
  }
  if (failure) throw failure;
  return {...receipt, receiptPath};
}
