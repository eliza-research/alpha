import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectedCounterexample, sha256 } from '../../../scripts/quint-lib.mjs';

// This local runner intentionally does not admit the runtime coverage ledger.
// It checks only the four historical design translations and their frozen inputs.
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const allowed = ['phase', 'models', 'configurations', 'timeout', 'server-endpoint', 'out', 'samples', 'steps', 'seed'];
for (const arg of args) if (!allowed.some(name => arg.startsWith(`--${name}=`))) throw Error(`Unknown option ${arg}`);
const phase = option('phase', 'check');
if (!['check', 'typecheck', 'test', 'simulate', 'symbolic', 'design', 'compare', 'properties', 'temporal'].includes(phase)) throw Error(`Unknown phase ${phase}`);
const positive = (name, fallback) => {
  const value = Number(option(name, fallback));
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`Invalid --${name}`);
  return value;
};
const timeoutSeconds = positive('timeout', 1800);
const samples = positive('samples', 1000);
const steps = positive('steps', phase === 'symbolic' ? 4 : 80);
const seed = option('seed', '20261108');
const endpoint = option('server-endpoint', '127.0.0.1:8852');
const documentPath = 'specs/quint/legacy/view-refresh-configurations.json';
const allModels = JSON.parse(readFileSync(resolve(root, documentPath), 'utf8')).models;
const requested = option('models', '').split(',').filter(Boolean);
for (const name of requested) if (!allModels.some(model => model.module === name)) throw Error(`Unknown model ${name}`);
const models = allModels.filter(model => requested.length === 0 || requested.includes(model.module));
const configurations = option('configurations', '').split(',').filter(Boolean);
for (const name of configurations) if (!models.some(model => model.configurations.some(config => config.name === name))) throw Error(`Unknown configuration ${name}`);
const originalInputs = models.flatMap(model => [model.legacySource,
  ...model.configurations.map(config => config.legacyConfiguration)]);
for (const input of originalInputs) {
  if (sha256(readFileSync(resolve(root, input.path))) !== input.sha256) {
    throw Error(`Historical design input changed: ${input.path}`);
  }
}
const inputPaths = [documentPath, 'specs/quint/legacy/check-view-refresh.mjs', 'scripts/quint-lib.mjs',
  'specs/quint/tlc.json', 'package-lock.json', ...models.map(model => model.path),
  ...originalInputs.map(input => input.path)];
const hashes = () => Object.fromEntries(inputPaths.map(path => [path, sha256(readFileSync(resolve(root, path)))]));
const inputHashes = hashes();
const output = resolve(root, option('out', `test-results/quint-view-refresh/${phase}.json`));
mkdirSync(dirname(output), { recursive: true });
const receipt = { format: 'alpha-quint-view-refresh-v1', startedAt: new Date().toISOString(),
  phase, quintVersion: JSON.parse(readFileSync(resolve(root, 'node_modules/@informalsystems/quint/package.json'), 'utf8')).version,
  inputHashes, samples, steps, seed, timeoutSeconds, results: [], status: 'running', passed: false };
const save = () => writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
save();

async function run(model, label, options, expected = 'pass') {
  const startedAt = new Date().toISOString();
  const result = await new Promise(resolveResult => {
    const child = spawn(process.execPath, [resolve(root, 'node_modules/@informalsystems/quint/dist/src/cli.js'), ...options],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let text = '', error = null, killTimer;
    const stop = signal => { try { process.kill(-child.pid, signal); } catch (failure) { if (failure.code !== 'ESRCH') error ??= failure.message; } };
    const interrupt = () => { stop('SIGKILL'); process.exit(130); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => {
      error = `Checker exceeded ${timeoutSeconds} seconds`;
      stop('SIGTERM');
      killTimer = setTimeout(() => stop('SIGKILL'), 1000);
    }, timeoutSeconds * 1000);
    const append = chunk => {
      text += chunk.toString();
      if (text.length > 8 * 1024 * 1024) { error = 'Checker exceeded output limit'; stop('SIGKILL'); }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', failure => { error = failure.message; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      stop('SIGKILL');
      resolveResult({ exitCode, signal, error, text });
    });
  });
  const inputsUnchanged = JSON.stringify(hashes()) === JSON.stringify(inputHashes);
  const passed = inputsUnchanged && !result.error && (expected === 'violation'
    ? result.exitCode !== 0 && detectedCounterexample(result.text) : result.exitCode === 0);
  receipt.results.push({ model: model.module, label, options, expected, passed, startedAt,
    finishedAt: new Date().toISOString(), inputsUnchanged, ...result });
  save();
  console.log(`${passed ? 'PASS' : 'FAIL'} ${model.module} ${label}`);
  if (!passed) console.error(result.text || result.error);
  return passed;
}

for (const model of models) {
  const file = model.path;
  if (['check', 'typecheck'].includes(phase)) await run(model, 'typecheck', ['typecheck', file]);
  if (['check', 'test'].includes(phase)) await run(model, 'scenarios', ['test', file, '--backend=typescript', `--seed=${seed}`]);
  if (['check', 'simulate'].includes(phase)) await run(model, 'simulation', ['run', file, '--backend=typescript', '--init=checkerInit',
    '--step=step', '--invariant=safety', `--seed=${seed}`, `--max-samples=${samples}`, `--max-steps=${steps}`, '--verbosity=1']);
  if (phase === 'symbolic') await run(model, 'symbolic', ['verify', file, '--backend=apalache', '--init=checkerInit',
    '--step=step', '--invariant=safety', `--max-steps=${steps}`, `--server-endpoint=${endpoint}`, '--apalache-version=0.62.4', '--verbosity=1']);
  if (['design', 'compare', 'properties', 'temporal'].includes(phase)) {
    const selected = model.configurations.filter(config => (!configurations.length || configurations.includes(config.name))
      && (phase !== 'design' || config.name === 'Design'));
    for (const config of selected) {
      const checks = phase === 'properties' ? [
        { label: `${config.name}-passing-properties`, expected: 'pass',
          invariants: config.invariants.filter(property => property.expected === 'pass').map(property => property.name),
          properties: config.temporal.filter(property => property.expected === 'pass').map(property => property.property) },
        ...config.invariants.filter(property => property.expected === 'violation').map(property => ({
          label: `${config.name}-${property.name}`, expected: 'violation', invariants: [property.name], properties: [],
        })),
        ...config.temporal.filter(property => property.expected === 'violation').map(property => ({
          label: `${config.name}-${property.name}`, expected: 'violation', invariants: [], properties: [property.property],
        })),
      ] : phase === 'temporal' ? config.temporal.map(property => ({
        label: `${config.name}-${property.name}`, expected: property.expected, properties: [property.property], invariants: [],
      })) : [{ label: config.name, expected: config.expected, properties: config.temporal.map(property => property.property), invariants: ['stateSafety'] }];
      for (const check of checks) await run(model, check.label, ['verify', file, '--backend=tlc', `--init=${config.init}`, '--step=step',
        ...(check.invariants.length ? [`--invariant=${check.invariants.join(',')}`] : []),
        ...(check.properties.length ? [`--temporal=${check.properties.join(',')}`] : []),
        `--server-endpoint=${endpoint}`, '--apalache-version=0.62.4', '--tlc-config=specs/quint/tlc.json', '--verbosity=3'], check.expected);
    }
  }
}
receipt.finishedAt = new Date().toISOString();
receipt.finalInputHashes = hashes();
receipt.inputsUnchanged = JSON.stringify(receipt.finalInputHashes) === JSON.stringify(inputHashes);
receipt.passed = receipt.results.length > 0 && receipt.inputsUnchanged && receipt.results.every(result => result.passed);
receipt.status = receipt.passed ? 'passed' : 'failed';
save();
process.exitCode = receipt.passed ? 0 : 1;
