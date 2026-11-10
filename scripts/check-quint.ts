import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { detectedCounterexample, loadModels, readJson, repositoryRoot, runQuintChecker, sha256 } from './quint-lib.ts';

const args = process.argv.slice(2);
const command = args.shift() || 'check';
const value = (name: any, fallback: any) => args.find((arg: any) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const allowedOptions = ['models', 'samples', 'steps', 'seed', 'out', 'backend', 'server-endpoint', 'timeout'];
for (const arg of args) if (!allowedOptions.some(name => arg.startsWith(`--${name}=`))) throw Error(`Unknown option ${arg}`);
if (!['check', 'typecheck', 'test', 'simulate', 'verify', 'temporal', 'compare'].includes(command)) throw Error(`Unknown Quint command ${command}`);
const checking = ['verify', 'temporal', 'compare'].includes(command);
const positiveInteger = (name: any, fallback: any) => {
  const result = Number(value(name, fallback));
  if (!Number.isSafeInteger(result) || result < 1) throw Error(`Invalid --${name}`);
  return result;
};
const samples = positiveInteger('samples', 80);
const steps = positiveInteger('steps', command === 'compare' ? 20 : checking ? 6 : 40);
const timeoutSeconds = positiveInteger('timeout', checking ? 1800 : 120);
const seed = value('seed', '20261107');
const backend = value('backend', ['compare', 'temporal'].includes(command) ? 'tlc' : 'apalache');
const serverEndpoint = value('server-endpoint', '127.0.0.1:8845');
if (!['apalache', 'tlc'].includes(backend)) throw Error('Verification backend must be apalache or tlc');
const allModels = loadModels();
const requested = value('models', '').split(',').filter(Boolean);
for (const name of requested) if (!allModels.some(model => model.module === name)) throw Error(`Unknown model ${name}`);
const models = requested.length ? allModels.filter(model => requested.includes(model.module)) : allModels;
if (command === 'temporal' && !models.some(model => model.temporal?.length)) throw Error('Selected models declare no temporal checks');
if (command === 'compare' && !models.some(model => model.currentChecks?.length || model.currentTemporalChecks?.length || model.expectedViolations?.length)) throw Error('Selected models declare no current-design comparisons');
const cli = join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js');
const version = readJson(join(repositoryRoot, 'node_modules/@informalsystems/quint/package.json')).version;
const inputPaths = [...new Set(['package-lock.json', 'scripts/check-quint.ts', 'scripts/quint-lib.ts', 'specs/quint/tlc.json',
  ...allModels.map((model: any) => model.path),
  ...['application', 'services', 'native', 'legacy'].map((family: any) => `specs/quint/${family}/manifest.json`),
  ...allModels.flatMap((model: any) => model.sources || [])])];
const inputHashes = Object.fromEntries(inputPaths.map((path: any) => [path, sha256(readFileSync(join(repositoryRoot, path)))]));
interface CheckResult {model:string;phase:string;expected:string;passed:boolean;exitCode:number|null;startedAt:string;finishedAt:string;signal:string|null;interruptedAttempt?:unknown;error?:string;argv:string[];modelSha256:string;output:string;}
interface CheckReceipt {schemaVersion:number;startedAt:string;command:string;quintVersion:string;evidence?:string;inputHashes:Record<string,string>;samples:number;steps:number;seed:string;backend:string;timeoutSeconds:number;results:CheckResult[];canary?:{detected:boolean;exitCode:number|null;signal:string|null;interruptedAttempt?:unknown};error?:string;finalInputErrors?:string[];finishedAt?:string;passed?:boolean;status?:string;}
const receipt: CheckReceipt = { schemaVersion: 1, startedAt: new Date().toISOString(), command, quintVersion: version,
  evidence: checking ? (backend === 'tlc' ? 'finite-state model checking' : 'bounded symbolic model checking') : {
    check: 'typecheck, scenarios and sampled simulation',
    typecheck: 'typechecking', test: 'scenario execution', simulate: 'sampled simulation',
  }[command],
  inputHashes, samples, steps, seed, backend, timeoutSeconds, results: [] };
const receiptPath = resolve(repositoryRoot, value('out', `test-results/quint/${command}.json`));
mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, status: 'running', passed: false }, null, 2)}\n`);
let failed = false;

function runCommand(argv: any) {
  return new Promise((resolveResult: any) => {
    const child = spawn(process.execPath, argv, {
      cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let stdout = '', stderr = ''; let error: Error | undefined, hardStop: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: any) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, signal);
      } catch (failure: any) { if (failure.code !== 'ESRCH') error ??= failure; }
    };
    const interrupt = () => { stop('SIGKILL'); process.exit(130); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => {
      error = Error(`Checker exceeded ${timeoutSeconds} seconds`);
      stop('SIGTERM');
      hardStop = setTimeout(() => stop('SIGKILL'), 1000);
    }, timeoutSeconds * 1000);
    const append = (stream: any, chunk: any) => {
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 8 * 1024 * 1024) {
        error = Error('Checker exceeded the output limit');
        stop('SIGKILL');
      }
    };
    child.stdout.on('data', (chunk: any) => append('stdout', chunk));
    child.stderr.on('data', (chunk: any) => append('stderr', chunk));
    child.on('error', (failure: any) => { error = failure; });
    child.on('close', (status: any, signal: any) => {
      clearTimeout(timer);
      clearTimeout(hardStop);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      stop('SIGKILL');
      resolveResult({ status, signal, error, stdout, stderr });
    });
  });
}

async function run(model: any, phase: any, options: any, expected: any = 'pass') {
  if (options[0] === 'verify') options.push(`--server-endpoint=${serverEndpoint}`, '--apalache-version=0.62.4', '--tlc-config=specs/quint/tlc.json');
  const argv = [cli, ...options];
  const modelSha256 = sha256(readFileSync(join(repositoryRoot, model.path)));
  const startedAt = new Date().toISOString();
  const {result, interruptedAttempt} = await runQuintChecker(() => runCommand(argv));
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const violation = detectedCounterexample(output);
  const modelChanged = modelSha256 !== sha256(readFileSync(join(repositoryRoot, model.path)));
  const completed = Number.isInteger(result.status) && !result.signal && !result.error;
  const passed = !modelChanged && completed && (expected === 'violation' ? result.status !== 0 && violation : result.status === 0);
  receipt.results.push({ model: model.module, phase, expected, passed, exitCode: result.status,
    startedAt, finishedAt: new Date().toISOString(), signal: result.signal, interruptedAttempt,
    error: modelChanged ? 'Model changed while its checker was running' : result.error?.message,
    argv: options, modelSha256, output });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${model.module} ${phase}${expected === 'violation' ? ' (counterexample required)' : ''}`);
  if (interruptedAttempt) console.log(`Retried ${model.module} ${phase} after checker signal ${interruptedAttempt.signal}`);
  if (!passed) {
    failed = true;
    const signal = result.signal ? ` (${result.signal})` : '';
    console.error(output || result.error?.message || `Checker terminated without output${signal}`);
  }
  return passed;
}

try {
  for (const model of models) {
    if (['check', 'typecheck'].includes(command) && !await run(model, 'typecheck', ['typecheck', model.path])) continue;
    if (['check', 'test'].includes(command) && !await run(model, 'scenarios', ['test', model.path, `--main=${model.module}`, '--backend=typescript', `--seed=${seed}`, '--max-samples=1'])) continue;
    if (['check', 'simulate'].includes(command)) {
      await run(model, 'simulation', ['run', model.path, `--main=${model.module}`, '--backend=typescript', `--seed=${seed}`, `--max-samples=${samples}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=${model.invariant}`, '--verbosity=1']);
    }
    if (command === 'verify') {
      await run(model, backend, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=${model.invariant}`, '--verbosity=1']);
    }
    if (command === 'temporal' && model.temporal?.length) {
      await run(model, `${backend}-temporal`, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--temporal=${model.temporal.join(',')}`, '--verbosity=1']);
    }
    if (command === 'compare') {
      for (const property of model.currentChecks || []) {
        await run(model, `current-${property.invariant}`, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${property.init}`, `--step=${property.step}`, `--invariant=${property.invariant}`, '--verbosity=1'], property.expected);
      }
      for (const property of model.currentTemporalChecks || []) {
        await run(model, `current-temporal-${property.property}`, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${property.init}`, `--step=${property.step}`, `--temporal=${property.property}`, '--verbosity=1'], property.expected);
      }
      for (const property of model.expectedViolations || []) {
        const invariant = property.invariant || property.property;
        await run(model, `known-${invariant}`, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=${invariant}`, '--verbosity=1'], 'violation');
      }
    }
  }
  if (command === 'check') {
    const temporary = mkdtempSync(join(tmpdir(), 'alpha-quint-canary-'));
    try {
      const file = join(temporary, 'CounterexampleCanary.qnt');
      writeFileSync(file, 'module CounterexampleCanary { var n: int action init = n\' = 0 action step = n\' = n + 1 val safety = n == 0 }\n');
      const {result, interruptedAttempt} = await runQuintChecker(() => spawnSync(process.execPath,
        [cli, 'run', file, '--backend=typescript', '--seed=1', '--max-samples=1', '--max-steps=1', '--invariant=safety'],
        { cwd: repositoryRoot, encoding: 'utf8', timeout: 30000 }));
      const detected = Number.isInteger(result.status) && result.status !== 0 && !result.signal && !result.error
        && detectedCounterexample(`${result.stdout || ''}${result.stderr || ''}`);
      receipt.canary = { detected, exitCode: result.status, signal: result.signal, interruptedAttempt };
      if (!detected) { failed = true; console.error('FAIL counterexample detection canary'); }
      else console.log('PASS counterexample detection canary');
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
} catch (error: any) {
  failed = true;
  receipt.error = error instanceof Error ? error.stack : String(error);
  console.error(receipt.error);
} finally {
  try {
    receipt.finalInputErrors = [];
    for (const path of inputPaths) if (inputHashes[path] !== sha256(readFileSync(join(repositoryRoot, path)))) receipt.finalInputErrors.push(`Checker input changed during run ${path}`);
  } catch (error: any) {
    receipt.finalInputErrors = [`Final input check failed: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (receipt.finalInputErrors.length) { failed = true; console.error(receipt.finalInputErrors.join('\n')); }
  receipt.finishedAt = new Date().toISOString();
  receipt.passed = !failed;
  receipt.status = failed ? 'failed' : 'passed';
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Evidence written to ${receiptPath}`);
}
process.exitCode = failed ? 1 : 0;
