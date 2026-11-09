import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const inventoryPath = 'specs/quint/legacy/core/source-inventory.json';
const manifestPath = 'specs/quint/legacy/manifest.json';
const runnerPath = 'specs/quint/legacy/core/check-configurations.mjs';
const quint = 'node_modules/@informalsystems/quint/dist/src/cli.js';
const apalacheVersion = '0.62.4';
const flags = new Map();
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.+)$/.exec(argument);
  if (!match || !['phase', 'models', 'profiles', 'samples', 'steps', 'seed', 'timeout', 'out', 'server-endpoint', 'tlc-jar', 'tlc-max-heap-mb', 'metadata'].includes(match[1])) {
    throw Error(`Unknown option ${argument}`);
  }
  if (flags.has(match[1])) throw Error(`Repeated option ${argument}`);
  flags.set(match[1], match[2]);
}
const get = (name, fallback) => flags.get(name) ?? fallback;
const positive = (name, fallback) => {
  const value = Number(get(name, fallback));
  if (!Number.isSafeInteger(value) || value <= 0) throw Error(`Invalid --${name}`);
  return value;
};
const phase = get('phase', 'check');
if (!['check', 'typecheck', 'test', 'simulate', 'symbolic', 'temporal'].includes(phase)) throw Error(`Unknown phase ${phase}`);
const samples = positive('samples', 1000);
const steps = positive('steps', phase === 'symbolic' ? 4 : 80);
const timeout = positive('timeout', 1800);
const seed = get('seed', '20261108');
const server = get('server-endpoint', '127.0.0.1:8853');
const tlcJar = resolve(get('tlc-jar', resolve(homedir(), `.quint/apalache-dist-${apalacheVersion}/apalache/lib/apalache.jar`)));
const tlcConfigPath = 'specs/quint/tlc.json';
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = path => sha256(readFileSync(resolve(root, path)));
const inventory = json(inventoryPath);
const pinPath = 'upstream.lock.json';
const currentPin = json(pinPath).commit;
if (!/^[a-f0-9]{40}$/.test(currentPin)) throw Error('Invalid upstream source pin');
const manifest = json(manifestPath);
const metadataFiles = get('metadata', '').split(',').filter(Boolean);
const metadata = metadataFiles.length ? metadataFiles.flatMap(json) : Array.isArray(manifest) ? manifest : manifest.models;
const requested = get('models', '').split(',').filter(Boolean);
const requestedProfiles = get('profiles', '').split(',').filter(Boolean);
const selected = inventory.models.filter(model => !requested.length || requested.includes(model.module) || requested.includes(model.quintModule));
for (const name of requested) if (!selected.some(model => [model.module, model.quintModule].includes(name))) throw Error(`Unknown model ${name}`);
const modelPlans = selected.map(source => {
  const candidates = metadata.filter(entry => entry.module === source.quintModule);
  if (candidates.length !== 1) throw Error(`Expected one translation for ${source.module}, found ${candidates.length}`);
  const [model] = candidates;
  if (model.path !== `specs/quint/legacy/${source.quintModule}.qnt`) throw Error(`Unexpected model path ${model.path}`);
  const mapped = model.configurations;
  if (!Array.isArray(mapped) || mapped.length !== source.configs.length) throw Error(`Missing or extra configurations for ${model.module}`);
  const profiles = source.configs.map(original => {
    const candidates = mapped.filter(config => config.name === original.name);
    if (candidates.length !== 1) throw Error(`Expected one mapping for ${source.module}.${original.name}`);
    const [profile] = candidates;
    const sections = original.sections;
    const invariants = sections.INVARIANTS ?? sections.INVARIANT ?? [];
    const properties = sections.PROPERTIES ?? sections.PROPERTY ?? [];
    for (const [field, expected] of Object.entries({invariants, properties, constantAssignments: sections.CONSTANTS ?? sections.CONSTANT ?? []})) {
      if (JSON.stringify(profile[field]) !== JSON.stringify(expected)) throw Error(`${source.module}.${original.name} differs from original ${field}`);
    }
    if (profile.checkDeadlock !== (sections.CHECK_DEADLOCK?.[0] !== 'FALSE')) throw Error(`${source.module}.${original.name} differs on deadlock checking`);
    if ((profile.symmetry ?? null) !== (sections.SYMMETRY?.[0] ?? null)) throw Error(`${source.module}.${original.name} differs on symmetry metadata`);
    for (const field of ['module', 'init', 'step', 'rawStep', 'invariant']) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(profile[field] ?? '')) {
      throw Error(`Invalid ${field} for ${source.module}.${original.name}`);
    }
    if (properties.length && !/^[A-Za-z][A-Za-z0-9_]*$/.test(profile.temporal ?? '')) throw Error(`Missing temporal property wrapper for ${source.module}.${original.name}`);
    return {...profile, original};
  }).filter(profile => !requestedProfiles.length || requestedProfiles.includes(profile.name) || requestedProfiles.includes(`${source.module}.${profile.name}`));
  return {source, model, profiles};
}).filter(plan => plan.profiles.length);
for (const name of requestedProfiles) if (!modelPlans.some(plan => plan.profiles.some(profile => [profile.name, `${plan.source.module}.${profile.name}`].includes(name)))) {
  throw Error(`Unknown profile ${name}`);
}
if (!modelPlans.length) throw Error('No configurations selected');

// Read Git blobs directly. This proves provenance without changing the immutable checkout.
const upstream = [];
for (const {source} of modelPlans) for (const original of [{path: source.source, sha256: source.sha256}, ...source.configs]) {
  const bytes = execFileSync('git', ['-C', resolve(root, 'vendor/eliza'), 'cat-file', 'blob', `${currentPin}:${original.path}`]);
  const actual = sha256(bytes);
  if (actual !== original.sha256) throw Error(`Upstream input hash mismatch ${original.path}`);
  upstream.push({path: original.path, sha256: actual});
}
const modelFiles = new Set();
function includeModel(path) {
  if (modelFiles.has(path)) return;
  modelFiles.add(path);
  const bytes = readFileSync(resolve(root, path), 'utf8');
  for (const match of bytes.matchAll(/\bfrom\s+"([^"]+)"/g)) {
    const dependency = resolve(root, dirname(path), match[1]);
    includeModel(dependency.endsWith('.qnt') ? dependency : dependency + '.qnt');
  }
}
for (const {model} of modelPlans) includeModel(model.path);
const inputFiles = [inventoryPath, manifestPath, runnerPath, tlcConfigPath, pinPath, 'package-lock.json', ...metadataFiles, ...modelFiles];
if (phase === 'temporal') inputFiles.push(tlcJar);
const snapshot = () => Object.fromEntries(inputFiles.map(path => [path, hash(path)]));
const before = snapshot();
const stable = () => JSON.stringify(snapshot()) === JSON.stringify(before);
const directory = resolve(root, get('out', `test-results/quint-core-configurations/${phase}`));
mkdirSync(directory, {recursive: true});
const receiptPath = resolve(directory, 'receipt.json');
const receipt = {format: 'alpha-quint-core-configurations-v1', phase, samples, steps, seed, timeoutSeconds: timeout,
  upstreamRevision: currentPin, originalRevision: inventory.revision, upstream, inputHashes: before, startedAt: new Date().toISOString(),
  quintVersion: json('node_modules/@informalsystems/quint/package.json').version,
  selected: modelPlans.flatMap(({source, profiles}) => profiles.map(profile => `${source.module}.${profile.name}`)),
  results: [], status: 'running', passed: false};
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
save();

async function execute(command, args, log, cwd = root) {
  const startedAt = new Date().toISOString();
  const result = await new Promise(done => {
    const child = spawn(command, args, {cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
    let text = '', error, escalator;
    const stop = signal => { if (child.pid) try {process.kill(-child.pid, signal);} catch (failure) {if (failure.code !== 'ESRCH') error ??= failure.message;} };
    const interrupt = () => {
      stop('SIGKILL');
      writeFileSync(log, text);
      receipt.status = 'interrupted';
      receipt.interruptedCheck = {command, args, log, startedAt};
      receipt.finishedAt = new Date().toISOString();
      save();
      process.exit(130);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => {error = `Exceeded ${timeout} seconds`; stop('SIGTERM');
      escalator = setTimeout(() => stop('SIGKILL'), 1000);}, timeout * 1000);
    const append = chunk => {text += chunk.toString(); if (text.length > 8 * 1024 * 1024) {error = 'Exceeded output limit'; stop('SIGKILL');}};
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', failure => {error = failure.message;});
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer); clearTimeout(escalator);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      stop('SIGKILL');
      done({exitCode, signal, error, text});
    });
  });
  writeFileSync(log, result.text);
  return {...result, command, args, log, startedAt, finishedAt: new Date().toISOString()};
}
function record(model, profile, check, result, marker = () => true, details = {}) {
  const {text, ...processResult} = result;
  const inputsUnchanged = stable();
  const passed = inputsUnchanged && !result.error && result.exitCode === 0 && marker(text);
  receipt.results.push({model, profile, check, passed, inputsUnchanged, ...details, ...processResult});
  save();
  console.log(`${passed ? 'PASS' : 'FAIL'} ${model}${profile ? '.' + profile : ''} ${check}`);
  if (!passed) console.error(result.error ?? text.trim().slice(-3000));
  return passed;
}
const cli = (args, log) => execute(process.execPath, [resolve(root, quint), ...args], log);
const tlcOptions = json(tlcConfigPath);
const tlcHeap = flags.has('tlc-max-heap-mb') ? `-Xmx${positive('tlc-max-heap-mb')}m` : tlcOptions.maxHeap;
for (const {source, model, profiles} of modelPlans) {
  if (phase === 'check' || phase === 'typecheck') {
    record(source.module, null, 'typecheck', await cli(['typecheck', model.path], resolve(directory, `${source.module}-typecheck.log`)));
  }
  for (const profile of profiles) {
    const title = `${source.module}-${profile.name}`;
    const args = [model.path, `--main=${profile.module}`];
    const init = `--init=${profile.init}`, step = `--step=${profile.step}`, invariant = `--invariant=${profile.invariant}`;
    if (phase === 'check' || phase === 'test') {
      record(source.module, profile.name, 'scenarios', await cli(['test', ...args, '--backend=typescript', '--max-samples=1', `--seed=${seed}`],
        resolve(directory, `${title}-scenarios.log`)), text => /\b[1-9]\d* passing\b/.test(text));
    }
    if (phase === 'check' || phase === 'simulate') {
      record(source.module, profile.name, 'simulation', await cli(['run', ...args, '--backend=typescript', init, step, invariant,
        `--seed=${seed}`, `--max-samples=${samples}`, `--max-steps=${steps}`, '--verbosity=1'], resolve(directory, `${title}-simulation.log`)),
        text => text.includes('[ok] No violation found'));
    }
    if (phase === 'symbolic') {
      record(source.module, profile.name, 'symbolic', await cli(['verify', ...args, '--backend=apalache', init, step, invariant,
        `--server-endpoint=${server}`, `--apalache-version=${apalacheVersion}`, `--max-steps=${steps}`, '--verbosity=1'],
      resolve(directory, `${title}-symbolic.log`)), text => text.includes('[ok] No violation found'));
    }
    if (phase === 'temporal') {
      const work = resolve(directory, title);
      mkdirSync(work, {recursive: true});
      const compileArgs = ['compile', ...args, init, `--step=${profile.rawStep}`, invariant, '--target=tlaplus',
        `--server-endpoint=${server}`, `--apalache-version=${apalacheVersion}`, '--verbosity=0',
        ...(profile.temporal ? [`--temporal=${profile.temporal}`] : [])];
      const compiled = await cli(compileArgs, resolve(work, 'compile.log'));
      const header = /^-{4,} MODULE (\w+) -{4,}/m.exec(compiled.text);
      const end = compiled.text.lastIndexOf('====');
      if (!record(source.module, profile.name, 'compile', compiled, () => !!header && end > header.index)) continue;
      const tla = resolve(work, `${header[1]}.tla`);
      const cfg = resolve(work, `${header[1]}.cfg`);
      writeFileSync(tla, compiled.text.slice(header.index, end + 4) + '\n');
      writeFileSync(cfg, `INIT q_init\nNEXT q_step\nINVARIANT q_inv\n${profile.temporal ? 'PROPERTY q_temporalProps\n' : ''}CHECK_DEADLOCK ${profile.checkDeadlock ? 'TRUE' : 'FALSE'}\n`);
      const tlcArgs = ['-XX:+UseParallelGC', tlcHeap, tlcOptions.stackSize, '-cp', tlcJar, 'tlc2.TLC',
        '-workers', tlcOptions.workers, '-lncheck', 'final', '-metadir', resolve(work, 'states'), '-config', cfg, tla];
      const details = {generatedModelSha256: hash(tla), generatedConfigSha256: hash(cfg),
        deadlockCheck: profile.checkDeadlock, originalSymmetry: profile.symmetry ?? null, symmetryReduction: false};
      record(source.module, profile.name, 'finite-temporal', await execute('java', tlcArgs, resolve(work, 'tlc.log'), work),
        text => text.includes('Model checking completed. No error has been found.'), details);
    }
  }
}
receipt.finalInputHashes = snapshot();
receipt.finishedAt = new Date().toISOString();
receipt.passed = receipt.results.length > 0 && receipt.results.every(result => result.passed) && stable();
receipt.status = receipt.passed ? 'passed' : 'failed';
save();
process.exitCode = receipt.passed ? 0 : 1;
