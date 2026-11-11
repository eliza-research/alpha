import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { detectedCounterexample, loadModels, missingQuintScenarios, quintModelOptions, quintProofBackend, readJson, repositoryRoot, runQuintChecker, sha256, type CheckerResult, type QuintModel } from './quint-lib.ts';

const args = process.argv.slice(2);
const commands = ['check', 'typecheck', 'test', 'simulate', 'verify', 'temporal', 'compare'] as const;
const inputCommand = args.shift() || 'check';
const selectedCommand = commands.find(command => command === inputCommand);
if (!selectedCommand) throw Error(`Unknown Quint command ${inputCommand}`);
const command = selectedCommand;
function value(name: string): string | undefined;
function value(name: string, fallback: string): string;
function value(name: string, fallback?: string) {return args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;}
const allowedOptions = ['models', 'samples', 'steps', 'seed', 'out', 'backend', 'server-endpoint', 'timeout', 'jobs'];
for (const arg of args) if (!allowedOptions.some(name => arg.startsWith(`--${name}=`))) throw Error(`Unknown option ${arg}`);
const checking = ['verify', 'temporal', 'compare'].includes(command);
const positiveInteger = (name: string, fallback: number = 1) => {
  const result = Number(value(name, String(fallback)));
  if (!Number.isSafeInteger(result) || result < 1) throw Error(`Invalid --${name}`);
  return result;
};
const samples = positiveInteger('samples', 80);
const steps = positiveInteger('steps', command === 'compare' ? 20 : checking ? 6 : 40);
const timeoutSeconds = positiveInteger('timeout', checking ? 1800 : 120);
const requestedJobs = positiveInteger('jobs', checking ? 1 : Number(process.env.ALPHA_QUINT_JOBS ?? 1));
if (checking && requestedJobs !== 1) throw Error('Model checking uses one job per server endpoint');
const seed = value('seed', '20261107');
const overrides = Object.fromEntries(['samples', 'steps', 'seed'].filter(name => value(name) !== undefined)
  .map(name => [name, name === 'seed' ? value(name) : positiveInteger(name)]));
const requestedBackend = value('backend');
const serverEndpoint = value('server-endpoint', '127.0.0.1:8845');
if (requestedBackend !== undefined && requestedBackend !== 'apalache' && requestedBackend !== 'tlc') throw Error('Verification backend must be apalache or tlc');
const backendOption = requestedBackend;
const allModels = loadModels();
const requested = value('models', '').split(',').filter(Boolean);
for (const name of requested) if (!allModels.some(model => model.module === name)) throw Error(`Unknown model ${name}`);
const models = requested.length ? allModels.filter(model => requested.includes(model.module)) : allModels;
const jobs = Math.min(requestedJobs, availableParallelism(), Math.max(1, models.length));
const modelOrder = new Map(models.map((model, index) => [model.module, index]));
const backends = new Set(models.map(model => quintProofBackend(model, command, backendOption)));
const receiptBackend = backends.size > 1 ? 'mixed' : backends.values().next().value ?? quintProofBackend({}, command, backendOption);
if (command === 'temporal' && !models.some(model => model.temporal?.length)) throw Error('Selected models declare no temporal checks');
if (command === 'compare' && !models.some(model => model.currentChecks?.length || model.currentTemporalChecks?.length || model.expectedViolations?.length)) throw Error('Selected models declare no current-design comparisons');
const cli = join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js');
const version = readJson<{version: string}>(join(repositoryRoot, 'node_modules/@informalsystems/quint/package.json')).version;
const inputPaths = [...new Set(['package-lock.json', 'scripts/check-quint.ts', 'scripts/quint-lib.ts', 'specs/quint/tlc.json',
  ...allModels.map(model => model.path),
  ...['application', 'services', 'native', 'legacy'].map(family => `specs/quint/${family}/manifest.json`),
  ...allModels.flatMap(model => model.sources || [])])];
const inputHashes = Object.fromEntries(inputPaths.map(path => [path, sha256(readFileSync(join(repositoryRoot, path)))]));
type CheckEvidence = {
  model: string;
  phase: string;
  backend?: string;
  expected: string;
  passed: boolean;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  signal: NodeJS.Signals | null;
  interruptedAttempt?: {exitCode: null; signal: NodeJS.Signals | null};
  error?: string;
  argv: string[];
  missingScenarios?: string[];
  modelSha256: string;
  output: string;
};
type Receipt = {
  schemaVersion: number;
  startedAt: string;
  command: typeof command;
  quintVersion: string;
  evidence?: string;
  inputHashes: Record<string, string>;
  samples: number;
  steps: number;
  seed: string;
  backend: string;
  jobs: number;
  timeoutSeconds: number;
  modelOptions: Record<string, ReturnType<typeof quintModelOptions>>;
  scenarioCanary?: {detected: boolean; exitCode: number | null; signal: NodeJS.Signals | null; interruptedAttempt?: {exitCode: null; signal: NodeJS.Signals | null}; output: string};
  results: CheckEvidence[];
  canary?: {detected: boolean; exitCode: number | null; signal: NodeJS.Signals | null; interruptedAttempt?: {exitCode: null; signal: NodeJS.Signals | null}};
  error?: string;
  finalInputErrors?: string[];
  finishedAt?: string;
  passed?: boolean;
  status?: string;
};
const proofEvidence = {
  tlc: 'finite-state model checking', apalache: 'bounded symbolic model checking',
  mixed: 'finite-state and bounded symbolic model checking',
};
const receipt: Receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), command, quintVersion: version,
  evidence: checking ? proofEvidence[receiptBackend] : {
    verify: undefined, temporal: undefined, compare: undefined,
    check: 'typecheck, scenarios and sampled simulation',
    typecheck: 'typechecking', test: 'scenario execution', simulate: 'sampled simulation',
  }[command],
  inputHashes, samples, steps, seed, modelOptions: Object.fromEntries(models.map(model => [model.module, quintModelOptions(model, command, overrides)])),
  backend: receiptBackend, jobs, timeoutSeconds, results: [] };
const receiptPath = resolve(repositoryRoot, value('out', `test-results/quint/${command}.json`));
mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, status: 'running', passed: false }, null, 2)}\n`);
let failed = false;
const activeStops = new Set<(signal: NodeJS.Signals) => void>();
const interrupt = () => {
  for (const stop of activeStops) stop('SIGKILL');
  process.exit(130);
};

function runCommand(argv: string[], commandTimeoutSeconds = timeoutSeconds): Promise<CheckerResult> {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, argv, {
      cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let stdout = '', stderr = '';
    let error: Error | undefined;
    let hardStop: NodeJS.Timeout | undefined;
    const stop = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, signal);
      } catch (failure) {
        if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH'))
          error ??= failure instanceof Error ? failure : new Error(String(failure));
      }
    };
    activeStops.add(stop);
    const timer = setTimeout(() => {
      error = Error(`Checker exceeded ${commandTimeoutSeconds} seconds`);
      stop('SIGTERM');
      hardStop = setTimeout(() => stop('SIGKILL'), 1000);
    }, commandTimeoutSeconds * 1000);
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 8 * 1024 * 1024) {
        error = Error('Checker exceeded the output limit');
        stop('SIGKILL');
      }
    };
    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));
    child.on('error', failure => { error = failure; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      clearTimeout(hardStop);
      activeStops.delete(stop);
      stop('SIGKILL');
      resolveResult({ status, signal, error, stdout, stderr });
    });
  });
}

async function run(model: QuintModel, phase: string, options: string[], expected = 'pass') {
  if (options[0] === 'verify') options.push(`--server-endpoint=${serverEndpoint}`, '--apalache-version=0.62.4', '--tlc-config=specs/quint/tlc.json');
  const argv = [cli, ...options];
  const modelSha256 = sha256(readFileSync(join(repositoryRoot, model.path)));
  const startedAt = new Date().toISOString();
  const {result, interruptedAttempt} = await runQuintChecker(() => runCommand(argv));
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const violation = detectedCounterexample(output);
  const modelChanged = modelSha256 !== sha256(readFileSync(join(repositoryRoot, model.path)));
  const completed = Number.isInteger(result.status) && !result.signal && !result.error;
  const missingScenarios = phase === 'scenarios' ? missingQuintScenarios(model.tests, output) : [];
  const passed = !modelChanged && completed && !missingScenarios.length && (expected === 'violation' ? result.status !== 0 && violation : result.status === 0);
  const backend = options[0] === 'verify' ? options.find(option => option.startsWith('--backend='))?.slice('--backend='.length) : undefined;
  receipt.results.push({ model: model.module, phase, backend, expected, passed, exitCode: result.status,
    startedAt, finishedAt: new Date().toISOString(), signal: result.signal, interruptedAttempt,
    error: modelChanged ? 'Model changed while its checker was running' : result.error?.message,
    argv: options, modelSha256, missingScenarios, output });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${model.module} ${phase}${expected === 'violation' ? ' (counterexample required)' : ''}`);
  if (interruptedAttempt) console.log(`Retried ${model.module} ${phase} after checker signal ${interruptedAttempt.signal}`);
  if (!passed) {
    failed = true;
    const signal = result.signal ? ` (${result.signal})` : '';
    console.error(output || result.error?.message || `Checker terminated without output${signal}`);
    if (missingScenarios.length) console.error(`Scenarios not executed: ${missingScenarios.join(', ')}`);
  }
  return passed;
}

async function runModel(model: QuintModel) {
  const {samples, steps, seed} = quintModelOptions(model, command, overrides);
  const backend = quintProofBackend(model, command, backendOption);
  if (command === 'typecheck' && !await run(model, 'typecheck', ['typecheck', model.path])) return;
  if (['check', 'test'].includes(command) && !await run(model, 'scenarios', ['test', model.path, `--main=${model.module}`, '--backend=typescript', `--seed=${seed}`, '--max-samples=1', `--match=^(${model.tests.join('|')})$`])) return;
  if (['check', 'simulate'].includes(command)) {
    await run(model, 'simulation', ['run', model.path, `--main=${model.module}`, '--backend=typescript', `--seed=${seed}`, `--max-samples=${samples}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=${model.invariant}`, '--verbosity=1']);
    if (model.additionalProofInit) await run(model, 'additional-init-simulation', ['run', model.path, `--main=${model.module}`, '--backend=typescript', `--seed=${seed}`, `--max-samples=${samples}`, '--max-steps=1', `--init=${model.additionalProofInit}`, `--step=${model.step}`, `--invariant=${model.invariant}`, '--verbosity=1']);
    // Every declared witness must be reachable; an unreachable guarded property is not coverage.
    for (const witness of model.witnesses || []) {
      await run(model, `witness-${witness}`, ['run', model.path, `--main=${model.module}`, '--backend=typescript', `--seed=${seed}`, `--max-samples=${Math.max(samples, 2000)}`, `--max-steps=${Math.max(steps, 60)}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=not(${witness})`, '--verbosity=1'], 'violation');
    }
  }
  if (command === 'verify') {
    await run(model, backend, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=${model.invariant}`, backend === 'tlc' ? '--verbosity=5' : '--verbosity=1']);
    if (model.additionalProofInit) await run(model, `${backend}-additional-init`, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, '--max-steps=1', `--init=${model.additionalProofInit}`, `--step=${model.step}`, `--invariant=${model.invariant}`, '--verbosity=1']);
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
      const invariant = 'invariant' in property ? property.invariant : property.property;
      await run(model, `known-${invariant}`, ['verify', model.path, `--main=${model.module}`, `--backend=${backend}`, `--max-steps=${steps}`, `--init=${model.init}`, `--step=${model.step}`, `--invariant=${invariant}`, '--verbosity=1'], 'violation');
    }
  }
}

process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  let nextModel = 0;
  const workers = Array.from({length: jobs}, async () => {
    while (nextModel < models.length) await runModel(models[nextModel++]);
  });
  const outcomes = await Promise.allSettled(workers);
  const rejected = outcomes.find(outcome => outcome.status === 'rejected');
  if (rejected) throw rejected.reason;
  if (command === 'check') {
    const temporary = mkdtempSync(join(tmpdir(), 'alpha-quint-canary-'));
    const removeTemporary = () => rmSync(temporary, { recursive: true, force: true });
    process.once('exit', removeTemporary);
    try {
      const file = join(temporary, 'CounterexampleCanary.qnt');
      writeFileSync(file, 'module CounterexampleCanary { var n: int action init = n\' = 0 action step = n\' = n + 1 val safety = n == 0 run failingTest = init.expect(n == 1) }\n');
      const {result, interruptedAttempt} = await runQuintChecker(() => runCommand(
        [cli, 'run', file, '--backend=typescript', '--seed=1', '--max-samples=1', '--max-steps=1', '--invariant=safety'], 30));
      const detected = Number.isInteger(result.status) && result.status !== 0 && !result.signal && !result.error
        && detectedCounterexample(`${result.stdout || ''}${result.stderr || ''}`);
      receipt.canary = { detected, exitCode: result.status, signal: result.signal, interruptedAttempt };
      if (!detected) { failed = true; console.error('FAIL counterexample detection canary'); }
      else console.log('PASS counterexample detection canary');
      const scenario = await runQuintChecker(() => runCommand(
        [cli, 'test', file, '--backend=typescript', '--seed=1', '--max-samples=1', '--match=^failingTest$'], 30));
      const scenarioOutput = `${scenario.result.stdout || ''}${scenario.result.stderr || ''}`;
      const scenarioDetected = Number.isInteger(scenario.result.status) && scenario.result.status !== 0
        && !scenario.result.signal && !scenario.result.error
        && /failingTest failed after 1 test\(s\)/.test(scenarioOutput)
        && /Error \[QNT508\]: Expect condition does not hold true/.test(scenarioOutput)
        && /error: Tests failed/.test(scenarioOutput);
      receipt.scenarioCanary = {detected: scenarioDetected, exitCode: scenario.result.status,
        signal: scenario.result.signal, interruptedAttempt: scenario.interruptedAttempt, output: scenarioOutput};
      if (!scenarioDetected) {failed = true; console.error('FAIL scenario assertion detection canary');}
      else console.log('PASS scenario assertion detection canary');
    } finally {
      process.removeListener('exit', removeTemporary);
      removeTemporary();
    }
  }
} catch (error) {
  failed = true;
  receipt.error = error instanceof Error ? error.stack : String(error);
  console.error(receipt.error);
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  receipt.results.sort((left, right) => modelOrder.get(left.model)! - modelOrder.get(right.model)!);
  try {
    receipt.finalInputErrors = [];
    for (const path of inputPaths) if (inputHashes[path] !== sha256(readFileSync(join(repositoryRoot, path)))) receipt.finalInputErrors.push(`Checker input changed during run ${path}`);
  } catch (error) {
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
