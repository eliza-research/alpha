import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const fieldPath = /^[A-Za-z][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z][A-Za-z0-9_]*)*$/;
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
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

/** Check concrete source observations at every named model transition. */
export async function checkTraces({model, modelPath, sources, traces, assumptions = [], scope, id = model, out, batchSize = 60}) {
  if (!identifier.test(model) || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid model or receipt identifier');
  if (!['complete-finite-helper', 'bounded-component', 'bounded-orchestration'].includes(scope)) throw new Error('An explicit refinement scope is required');
  if (!Array.isArray(traces) || !traces.length || !Array.isArray(sources) || !sources.length) throw new Error('Concrete traces and implementation source paths are required');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Invalid trace batch size');
  const path = modelFile(model, modelPath);
  const inputs = [...new Set([path, ...sources.map(source => resolve(root, source)), fileURLToPath(import.meta.url)])];
  const before = Object.fromEntries(inputs.map(input => [input, hash(input)]));
  const receiptPath = out ? resolve(root, out) : join(root, 'test-results/quint-refinement', `${id}.json`);
  const receipt = {schemaVersion: 1, model, scope, assumptions, startedAt: new Date().toISOString(),
    sourceHashesBefore: before, traces: traces.length, checkpoints: 0, actions: {}, observedFields: [],
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
          expression += `.expect(${observationText(step.expect)})`;
          receipt.checkpoints++;
        }
        return [`  // ${JSON.stringify(trace.name || name)}\n  run ${name} = ${expression}`, ...rejected];
      });
      const wrapper = join(temporary, `Refinement${offset}.qnt`);
      const importPath = relative(temporary, path).replaceAll('\\', '/').replace(/\.qnt$/, '');
      writeFileSync(wrapper, `module Refinement${offset} {\n  import ${model} as spec from ${JSON.stringify(importPath)}\n${definitions.join('\n')}\n}\n`);
      const args = [join(root, 'node_modules/@informalsystems/quint/dist/src/cli.js'), 'test', wrapper,
        `--main=Refinement${offset}`, '--backend=typescript', '--max-samples=1', '--seed=20261107', '--match=^trace[0-9]+(Reject[0-9]+)?Test$'];
      const result = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024});
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      const checked = Number(output.match(/(\d+) passing/)?.[1] || 0);
      const kind = result.status === 0 ? 'passed' : /\[QNT508\]|Assertion failed/.test(output) ? 'observation-mismatch' : 'tool-failure';
      receipt.results.push({offset, count: batch.length, generatedCases: definitions.length, checked, exitCode: result.status, kind,
        error: result.error?.message, output,
        names: batch.map(trace => trace.name)});
      if (result.status !== 0 || result.error || checked !== definitions.length) throw new Error(`Source/model trace mismatch in ${model} batch ${offset}\n${result.stdout || ''}${result.stderr || ''}`);
    }
  } catch (error) {
    failure = error;
    receipt.error = error instanceof Error ? error.stack : String(error);
  } finally {
    receipt.sourceHashesAfter = Object.fromEntries(inputs.map(input => [input, hash(input)]));
    receipt.inputsUnchanged = inputs.every(input => before[input] === receipt.sourceHashesAfter[input]);
    if (!receipt.inputsUnchanged) failure ||= new Error('Refinement input changed during checking');
    receipt.observedFields = [...fields].sort();
    receipt.finishedAt = new Date().toISOString();
    receipt.passed = !failure;
    receipt.status = failure ? 'failed' : 'passed';
    writeFileSync(receiptPath, serialize(receipt));
    rmSync(temporary, {recursive: true, force: true});
  }
  if (failure) throw failure;
  return {...receipt, receiptPath};
}
