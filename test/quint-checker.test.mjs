import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { boundedTlcSpec, detectedCounterexample, fullTemporalTlcSpec, fullTemporalTlcViolation, loadModels, missingQuintScenarios, quintModelOptions, quintProofBackend, readJson, repositoryRoot, runQuintChecker, runtimeScriptPaths, runtimeAssetPaths, sha256, sourceRoots, validateQuintModelMetadata } from '../scripts/quint-lib.ts';
import { scaledTimeout } from '../specs/quint/refinement/timeouts.mjs';

test('all registered scenarios need an actual successful execution record', () => {
  assert.deepEqual(missingQuintScenarios(['reviewTest', 'setup'], '\u001b[32m    ok reviewTest passed 1 test(s)\u001b[0m\n    ok setup passed 3 test(s)\n'), []);
  assert.deepEqual(missingQuintScenarios(['reviewTest', 'setup'], '2 passing\n    ok reviewTest passed 1 test(s)\n'), ['setup']);
  assert.deepEqual(missingQuintScenarios(['reviewTest'], '    ok reviewTest passed 0 test(s)\n'), ['reviewTest']);
});

test('unknown model selection fails before source loading while valid selections validate the entire registry', t => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-selection-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['check-quint.ts', 'quint-lib.ts']) copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
  const models = ['Selected', 'Unselected'].map(module => ({module,
    path: `specs/quint/application/${module}.qnt`, init: 'init', step: 'step', invariant: 'safety',
    tests: ['exampleTest'], sources: module === 'Unselected' ? ['missing-unselected.ts'] : []}));
  for (const family of ['application', 'services', 'native', 'legacy']) {
    mkdirSync(join(root, 'specs/quint', family), {recursive: true});
    writeFileSync(join(root, 'specs/quint', family, 'manifest.json'), JSON.stringify(family === 'application' ? models : []));
  }
  const run = name => spawnSync(process.env.ALPHA_BUN ?? process.execPath,
    ['scripts/check-quint.ts', 'typecheck', `--models=${name}`, '--out=proof.json'],
    {cwd: root, encoding: 'utf8', timeout: 30000});
  const refused = (result, message) => {
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(root, 'proof.json')), false, 'Invalid selections or registry entries never start a checker');
  };
  refused(run('Unknown'), /Unknown model Unknown/);
  for (const model of models) writeFileSync(join(root, model.path),
    `module ${model.module} { var n: int action init = n' = 0 action step = n' = n val safety = true run exampleTest = init }`);
  refused(run('Selected'), /missing-unselected\.ts/);
  writeFileSync(join(root, 'missing-unselected.ts'), 'controlled source');
  models[1].tests = ['missingTest'];
  writeFileSync(join(root, 'specs/quint/application/manifest.json'), JSON.stringify(models));
  refused(run('Selected'), /Missing scenario Unselected\.missingTest/);
});

test('manifest budgets and extra proof initializers cannot silently disappear', () => {
  const model = {module: 'Fixture', path: 'Fixture.qnt', tests: ['exampleTest'],
    bounds: {maxSamples: 1000, maxSteps: 60, maxVerifyDepth: 8, seed: '123'},
    invariants: ['safety'], additionalProofInit: 'counterInit'};
  const source = 'module Fixture { var n: int action counterInit = n\' = 1 val safety = n >= 0 run exampleTest = counterInit }';
  validateQuintModelMetadata(model, source);
  assert.throws(() => validateQuintModelMetadata({...model, invariants: ['local']},
    'module Fixture { var n: int action counterInit = { val local = true n\' = 1 } run exampleTest = counterInit }'), /Missing top-level invariant/);
  assert.throws(() => validateQuintModelMetadata({...model, additionalProofInit: 'missing'}, source), /Missing additional proof init/);
  assert.throws(() => validateQuintModelMetadata({...model, bounds: {maxVerifyDepth: 0}}, source), /Invalid bounds/);
  assert.deepEqual(quintModelOptions(model, 'check'), {samples: 1000, steps: 60, seed: '123'});
  assert.deepEqual(quintModelOptions(model, 'verify'), {samples: 1000, steps: 8, seed: '123'});
  assert.deepEqual(quintModelOptions(model, 'check', {samples: 3, steps: 2, seed: '1'}), {samples: 3, steps: 2, seed: '1'});
});

test('verification backend honors explicit overrides and preserves other proof defaults', () => {
  assert.equal(quintProofBackend({}, 'verify'), 'apalache');
  assert.equal(quintProofBackend({verifyBackend: 'tlc'}, 'verify'), 'tlc');
  assert.equal(quintProofBackend({verifyBackend: 'tlc-bounded'}, 'verify'), 'tlc-bounded');
  assert.equal(quintProofBackend({verifyBackend: 'tlc'}, 'verify', 'apalache'), 'apalache');
  for (const phase of ['compare', 'temporal']) {
    assert.equal(quintProofBackend({verifyBackend: 'apalache'}, phase), 'tlc');
    assert.equal(quintProofBackend({verifyBackend: 'tlc'}, phase, 'apalache'), 'apalache');
    assert.equal(quintProofBackend({verifyBackend: 'tlc-bounded'}, phase), 'tlc');
    assert.throws(() => quintProofBackend({}, phase, 'tlc-bounded'), /safety verification only/);
  }
  assert.throws(() => validateQuintModelMetadata({module: 'Fixture', tests: ['exampleTest'], verifyBackend: 'unknown'}, ''),
    /Invalid verifyBackend/);
});

test('bounded TLC preserves original declarations and refuses invalid bounds or namespaces', () => {
  const source = '---- MODULE Fixture ----\nVARIABLE n\nq_init == n = 0\nq_step == n\' = n + 1\nq_inv == n < 7\n====\n';
  const spec = boundedTlcSpec(source, 6);
  assert.ok(spec.source.startsWith(source.slice(0, source.indexOf('===='))));
  assert.match(spec.source, /q_bounded_init == q_init \/\\ q_bounded_depth = 0/);
  assert.match(spec.source, /q_bounded_depth < 6[\s\S]*q_step[\s\S]*q_bounded_depth' = q_bounded_depth \+ 1/);
  assert.equal(spec.configuration, 'INIT q_bounded_init\nNEXT q_bounded_next\nINVARIANT q_inv\n');
  assert.deepEqual(spec.evidence, {scope: 'safety-through-transition-bound', depth: 6,
    translatedSourceSha256: sha256(source), instrumentedSourceSha256: sha256(spec.source), configurationSha256: sha256(spec.configuration)});
  for (const depth of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => boundedTlcSpec(source, depth), /positive integer/);
  }
  for (const name of ['q_bounded_depth', 'q_bounded_init', 'q_bounded_next']) {
    assert.throws(() => boundedTlcSpec(source.replace('VARIABLE n', `VARIABLE ${name}`), 6), /namespace collision/);
  }
  for (const name of ['q_init', 'q_step', 'q_inv']) {
    assert.throws(() => boundedTlcSpec(source.replace(name, 'missing'), 6), /Missing translated/);
  }
  for (const invalid of [source.replace('====\n', ''), source + 'untranslated content', source + source]) {
    assert.throws(() => boundedTlcSpec(invalid, 6), /complete translated TLA module/);
  }
});

test('full temporal TLC preserves the complete translation and admits only real liveness counterexamples', () => {
  const source = "---- MODULE Fixture ----\nVARIABLE n\nq_init == n = 7\nq_step == n' = n\nq_temporalProps == <> (n = 8)\n====\n";
  const spec = fullTemporalTlcSpec(source);
  assert.equal(spec.source, source);
  assert.equal(spec.configuration, 'INIT q_init\nNEXT q_step\nPROPERTY q_temporalProps\n');
  assert.deepEqual(spec.evidence, {scope: 'full-temporal-state-graph', livenessScheduling: 'final',
    translatedSourceSha256: sha256(source), configurationSha256: sha256(spec.configuration)});
  for (const name of ['q_init', 'q_step', 'q_temporalProps']) {
    assert.throws(() => fullTemporalTlcSpec(source.replace(name, 'missing')), /Missing translated/);
  }
  for (const invalid of [source.replace('====\n', ''), source + 'trailing text', source + source]) {
    assert.throws(() => fullTemporalTlcSpec(invalid), /complete translated TLA module/);
  }
  const output = 'Error: Temporal property q_temporalProps was violated.\nError: The following behavior constitutes a counter-example:\n';
  const genuine = {status: 13, signal: null};
  assert.equal(fullTemporalTlcViolation(genuine, output), true);
  for (const result of [{...genuine, status: 12}, {...genuine, status: 77}, {...genuine, status: 0},
    {...genuine, signal: 'SIGTERM'}, {...genuine, error: Error('deadline')}]) {
    assert.equal(fullTemporalTlcViolation(result, output), false);
  }
  assert.equal(fullTemporalTlcViolation(genuine, 'Error: Invariant q_inv is violated.\n'), false);
  assert.equal(fullTemporalTlcViolation(genuine, 'Error: Temporal property q_temporalProps was violated.\n'), false);
});

test('TLC liveness scheduling is restricted to temporal full-TLC checking', () => {
  for (const args of [['temporal', '--tlc-liveness=unknown'], ['verify', '--tlc-liveness=final'],
    ['compare', '--tlc-liveness=final'], ['typecheck', '--tlc-liveness=default'],
    ['temporal', '--tlc-liveness=final', '--backend=apalache'], ['temporal', '--tlc-liveness=final', '--backend=tlc-bounded']]) {
    const result = spawnSync(process.execPath, ['scripts/check-quint.ts', ...args], {cwd: repositoryRoot, encoding: 'utf8', timeout: 30000});
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /TLC liveness scheduling must be|requires temporal checking with the full TLC backend/);
  }
});

test('full temporal final scheduling CLI checks beyond nominal depth and refuses tool failures', {timeout: scaledTimeout(600000)}, () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-temporal-owner-'));
  const write = (path, contents) => {const target = join(root, path);mkdirSync(dirname(target), {recursive: true});writeFileSync(target, contents);};
  const source = `module TemporalFixture {
    var n: int
    action init = n' = 0
    action selectedInit = n' = 7
    action progress = all { n < 7, n' = n + 1 }
    action step = any { progress, n' = n }
    val safety = true
    temporal Fairness = progress.weakFair(n)
    temporal CheckedSettles = Fairness implies eventually(n == 7)
    temporal CheckedImpossible = Fairness implies eventually(n == 8)
    run exampleTest = init.expect(n == 0)
  }\n`;
  const model = {module: 'TemporalFixture', path: 'specs/quint/application/TemporalFixture.qnt',
    init: 'init', step: 'step', invariant: 'safety', tests: ['exampleTest'], temporal: ['CheckedSettles']};
  const config = readJson(join(repositoryRoot, 'specs/quint/tlc.json'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const name of ['check-quint.ts', 'quint-lib.ts']) copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
    symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    write('upstream.lock.json', JSON.stringify({commit: 'fixture'}));write('bun.lock', '{}');write(model.path, source);
    const manifests = selected => {for (const family of ['application', 'services', 'native', 'legacy'])
      write(`specs/quint/${family}/manifest.json`, JSON.stringify(family === 'application' ? [selected] : []));};
    let endpointPort = 8941;
    const run = (mode, expected) => {
      const child = spawnSync(process.execPath, ['scripts/check-quint.ts', 'temporal', '--models=TemporalFixture',
        `--tlc-liveness=${mode}`, `--server-endpoint=127.0.0.1:${endpointPort++}`, '--out=proof.json'], {cwd: root, encoding: 'utf8', timeout: scaledTimeout(150000)});
      assert.ifError(child.error);
      assert.equal(child.status, expected === 'pass' ? 0 : 1, child.stdout + child.stderr);
      const proof = readJson(join(root, 'proof.json')), phase = proof.results[0];
      const selectedInit = phase.argv.find(arg => arg.startsWith('--init=')).slice('--init='.length);
      const evidenceDirectory = join(repositoryRoot, 'test-results/quint/full-temporal-owner');
      mkdirSync(evidenceDirectory, {recursive: true});
      writeFileSync(join(evidenceDirectory, `${mode}-${expected}-${selectedInit}.json`), JSON.stringify(proof, null, 2) + '\n');
      assert.equal(proof.tlcLiveness, mode);assert.equal(proof.timeoutSeconds, 1800);
      assert.deepEqual(proof.finalInputErrors, []);assert.equal(phase.backend, 'tlc');
      assert.equal(phase.boundedProof, undefined);assert.ok(phase.argv.includes('--max-steps=6'));
      assert.equal(phase.passed, expected === 'pass');
      if (mode === 'final') {
        const evidence = phase.fullTemporalProof;
        assert.equal(evidence.scope, 'full-temporal-state-graph');assert.equal(evidence.livenessScheduling, 'final');
        assert.equal(evidence.configurationSha256, sha256('INIT q_init\nNEXT q_step\nPROPERTY q_temporalProps\n'));
        assert.equal(evidence.jarSha256, 'e5223915507b65cc5f1638bd037ede60f8a4fc1644aff46355779f9b05df9262');
        assert.deepEqual(evidence.javaArgv.slice(0, 2), [expected === 'tool-error' ? '-XmxNOTAHEAP' : config.maxHeap, config.stackSize]);
        assert.deepEqual(evidence.javaArgv.slice(evidence.javaArgv.indexOf('-lncheck'), evidence.javaArgv.indexOf('-lncheck') + 2), ['-lncheck', 'final']);
        assert.equal(evidence.javaArgv[evidence.javaArgv.indexOf('-workers') + 1], String(config.workers));
      } else assert.equal(phase.fullTemporalProof, undefined, 'Default scheduling uses the original Quint routine');
      if (expected === 'pass' && mode === 'final') assert.match(phase.output, /0 states left on queue/);
      if (expected === 'violation') {
        assert.equal(phase.exitCode, 13);assert.equal(detectedCounterexample(phase.output), true);
        assert.match(phase.output, /n = 7/);assert.match(phase.output, /Stuttering|Back to state/);
      }
      if (expected === 'tool-error') {assert.equal(detectedCounterexample(phase.output), false);assert.match(phase.output, /Invalid maximum heap size/);}
      return phase;
    };
    manifests(model);write('specs/quint/tlc.json', JSON.stringify(config));
    run('default', 'pass');
    const positive = run('final', 'pass');
    assert.match(positive.output, /8 distinct states found, 0 states left on queue/);
    assert.match(positive.output, /complete state graph search is 8/);
    manifests({...model, temporal: ['CheckedImpossible']});run('final', 'violation');
    manifests({...model, init: 'selectedInit'});
    assert.ok(run('final', 'pass').argv.includes('--init=selectedInit'));
    manifests(model);write('specs/quint/tlc.json', JSON.stringify({...config, maxHeap: '-XmxNOTAHEAP'}));
    run('final', 'tool-error');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('bounded TLC CLI includes the boundary, retains selected init and rejects tool errors', {timeout: scaledTimeout(780000)}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-bounded-owner-'));
  const write = (path, contents) => {
    const target = join(root, path);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, contents);
  };
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const endpoint = `127.0.0.1:${listener.address().port}`;
  await new Promise(resolve => listener.close(resolve));
  try {
    for (const path of [...sourceRoots, 'scripts']) mkdirSync(join(root, path), {recursive: true});
    for (const name of ['check-quint.ts', 'quint-lib.ts']) copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
    symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    write('upstream.lock.json', JSON.stringify({commit: 'fixture'}));
    write('bun.lock', '{}');
    mkdirSync(join(root, 'specs/quint'), {recursive: true});
    copyFileSync(join(repositoryRoot, 'specs/quint/tlc.json'), join(root, 'specs/quint/tlc.json'));
    const model = {module: 'BoundedFixture', path: 'specs/quint/application/BoundedFixture.qnt', init: 'init', step: 'step', invariant: 'safety', tests: ['exampleTest'], verifyBackend: 'tlc-bounded'};
    for (const family of ['application', 'services', 'native', 'legacy']) write(`specs/quint/${family}/manifest.json`, JSON.stringify(family === 'application' ? [model] : []));
    const source = limit => `module BoundedFixture { var n: int var retained: bool action init = all {n' = 0, retained' = true} action selectedInit = all {n' = 5, retained' = true} action step = all {n' = n + 1, retained' = retained} val safety = n < ${limit} and retained run exampleTest = init.expect(n == 0) }\n`;
    const run = (depth, expected, failureDepth, env = process.env) => {
      const result = spawnSync(process.execPath, ['scripts/check-quint.ts', 'verify', '--models=BoundedFixture', `--steps=${depth}`,
        `--server-endpoint=${endpoint}`, `--timeout=${Math.ceil(scaledTimeout(120000) / 1000)}`, '--out=proof.json'],
      {cwd: root, encoding: 'utf8', timeout: scaledTimeout(150000), env});
      assert.equal(result.error, undefined, result.error?.message);
      const proof = readJson(join(root, 'proof.json'));
      assert.equal(result.status, expected === 'pass' ? 0 : 1, result.stdout + result.stderr);
      assert.equal(proof.backend, 'tlc-bounded');
      assert.deepEqual(proof.finalInputErrors, []);
      const phase = proof.results[0];
      assert.equal(phase.boundedProof.scope, 'safety-through-transition-bound');
      assert.equal(phase.boundedProof.depth, depth);
      assert.equal(phase.passed, expected === 'pass');
      if (expected === 'pass') {
        assert.match(phase.output, /0 states left on queue/);
      } else {
        assert.equal(phase.exitCode, 12);
        assert.equal(detectedCounterexample(phase.output), true);
        const counters = [...phase.output.matchAll(/q_bounded_depth = (\d+)/g)].map(match => Number(match[1]));
        assert.equal(counters.at(-1), failureDepth);
        assert.equal(Math.max(...counters), failureDepth);
      }
      return phase;
    };
    write(model.path, source(6));
    run(6, 'violation', 6);
    write(model.path, source(7));
    run(6, 'pass');
    run(7, 'violation', 7);
    write(model.path, source(6));
    write('specs/quint/application/manifest.json', JSON.stringify([{...model, init: 'selectedInit'}]));
    assert.ok(run(1, 'violation', 1).argv.includes('--init=selectedInit'));
    // A reusable translation server must not hide a missing local TLC JAR.
    const require = createRequire(import.meta.url);
    const {apalacheDistDir} = require('@informalsystems/quint/dist/src/config.js');
    const warmJar = join(apalacheDistDir('0.62.4'), 'apalache/lib/apalache.jar');
    const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
    const server = spawn(java, ['-Xmx512m', '-jar', warmJar, 'server', `--port=${endpoint.split(':')[1]}`], {stdio: ['ignore', 'pipe', 'pipe']});
    const stopServer = () => server.kill('SIGKILL');
    process.once('exit', stopServer);
    let serverOutput = '';
    server.stdout.on('data', chunk => {serverOutput += chunk;});
    server.stderr.on('data', chunk => {serverOutput += chunk;});
    try {
      const deadline = Date.now() + scaledTimeout(30000);
      while (!serverOutput.includes('The Apalache server is running')) {
        assert.equal(server.exitCode, null, serverOutput);
        assert.ok(Date.now() < deadline, serverOutput);
        await delay(20);
      }
      const freshCache = join(root, 'fresh-quint-cache');
      assert.equal(existsSync(freshCache), false);
      write(model.path, source(7));
      write('specs/quint/application/manifest.json', JSON.stringify([model]));
      const phase = run(6, 'pass', undefined, {...process.env, QUINT_HOME: freshCache});
      assert.match(phase.output, /Downloading Apalache distribution 0\.62\.4/);
      const jarSha256 = sha256(readFileSync(join(freshCache, 'apalache-dist-0.62.4/apalache/lib/apalache.jar')));
      assert.equal(jarSha256, sha256(readFileSync(warmJar)));
      console.log('Bounded TLC fresh-cache receipt: ' + JSON.stringify({cacheInitiallyAbsent: true, existingTranslationServer: true,
        downloadedVersion: '0.62.4', jarSha256, boundedProof: phase.boundedProof}));
    } finally {
      process.removeListener('exit', stopServer);
      if (server.exitCode === null) {
        const exited = once(server, 'exit');
        stopServer();
        await exited;
      }
    }
    write(model.path, 'module BoundedFixture { run exampleTest = true this is not valid Quint }');
    const invalid = spawnSync(process.execPath, ['scripts/check-quint.ts', 'verify', '--out=invalid.json'], {cwd: root, encoding: 'utf8', timeout: scaledTimeout(30000)});
    assert.equal(invalid.status, 1);
    const failure = readJson(join(root, 'invalid.json'));
    assert.equal(failure.passed, false);
    assert.equal(detectedCounterexample(failure.results[0].output), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('the admitted model registry retains the audited families and scenarios', () => {
  const models = loadModels();
  const floors = {application: 116, services: 51, native: 65, legacy: 27};
  for (const [family, floor] of Object.entries(floors)) assert.ok(models.filter(model => model.family === family).length >= floor, `${family} lost registered models; review an intentional retirement explicitly`);
  assert.ok(models.reduce((count, model) => count + model.tests.length, 0) >= 1841, 'registered scenario count regressed');
});

test('counterexample admission requires the pinned CLI violation markers and rejects tool errors', () => {
  assert.equal(detectedCounterexample('[violation] Found an issue (42ms).\nerror: found a counterexample\n'), true);
  assert.equal(detectedCounterexample('\u001b[31m[violation]\u001b[0m Found an issue (42ms).\nerror: Invariant violated\n'), true);
  assert.equal(detectedCounterexample("error: [QNT404] Name 'InvariantViolated' not found\nerror: Argument error\n"), false);
  assert.equal(detectedCounterexample('Invariant safety violated\n'), false);
  assert.equal(detectedCounterexample('[violation] Found an issue (42ms).\nerror: found a counterexample\nerror: [QNT404] missing\n'), false);
  assert.equal(detectedCounterexample('[failure] TLC encountered an error\nerror: found a counterexample\n'), false);
});

test('only a silent native checker fault gets one retained retry', async () => {
  const silent = {status: null, signal: 'SIGSEGV', stdout: '', stderr: ''};
  const success = {status: 0, signal: null, stdout: '1 passing', stderr: ''};
  const interruptedAttempt = {exitCode: null, signal: 'SIGSEGV'};
  const cases = [
    {attempts: [silent, success], expected: {result: success, interruptedAttempt}},
    {attempts: [silent, silent], expected: {result: silent, interruptedAttempt}},
    ...[
      {...silent, signal: 'SIGTERM'},
      {...silent, error: Error('timeout')},
      {...silent, stderr: 'checker diagnostic'},
      {...silent, status: 1, signal: null, stdout: 'Assertion failed'},
      success,
    ].map(result => ({attempts: [result], expected: {result}})),
  ];
  for (const {attempts, expected} of cases) {
    let called = 0;
    assert.deepEqual(await runQuintChecker(() => attempts[called++]), expected);
    assert.equal(called, attempts.length);
  }
});

test('runner records backend routing, unexpected exceptions and unfinished results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-quint-runner-'));
  const write = (path, contents) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  try {
    for (const path of [...sourceRoots, 'scripts']) mkdirSync(join(root, path), { recursive: true });
    const runnerModules = ['check-quint.ts', 'quint-lib.ts', 'core-state-patch.ts', 'build-policy-source.ts'];
    for (const name of runnerModules) copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
    const fixtureSources = [...runtimeScriptPaths, ...runtimeAssetPaths];
    for (const path of fixtureSources) if (!runnerModules.some(name => path === `scripts/${name}`)) write(path, '');
    const model = { module: 'Fixture', path: 'specs/quint/application/Fixture.qnt', init: 'init', step: 'step', invariant: 'safety', tests: ['exampleTest'], currentChecks: [null] };
    write(model.path, 'module Fixture { run exampleTest = true }');
    for (const family of ['application', 'services', 'native', 'legacy']) {
      write(`specs/quint/${family}/manifest.json`, JSON.stringify(family === 'application' ? [model] : []));
    }
    write('upstream.lock.json', JSON.stringify({ commit: 'fixture' }));
    write('bun.lock', '{}');
    write('specs/quint/tlc.json', '{}');
    write('node_modules/@informalsystems/quint/package.json', JSON.stringify({ version: '0.33.1' }));

    const compare = spawnSync(process.execPath, ['scripts/check-quint.ts', 'compare', '--out=compare.json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(compare.status, 1, compare.stderr);
    const failure = readJson(join(root, 'compare.json'));
    assert.equal(failure.passed, false);
    assert.equal(failure.status, 'failed');
    assert.match(failure.error, /TypeError/);
    assert.deepEqual(failure.finalInputErrors, []);

    const routed = {...model, module: 'Routed', path: 'specs/quint/application/Routed.qnt', verifyBackend: 'tlc'};
    write(routed.path, 'module Routed { run exampleTest = true }');
    write('specs/quint/application/manifest.json', JSON.stringify([model, routed]));
    write('node_modules/@informalsystems/quint/dist/src/cli.js', 'console.log(process.argv.find(arg => arg.startsWith("--backend=")));');
    for (const override of [[], ['--backend=apalache']]) {
      const result = spawnSync(process.execPath, ['scripts/check-quint.ts', 'verify', '--out=verify.json', ...override],
        {cwd: root, encoding: 'utf8', timeout: 10000});
      assert.equal(result.status, 0, result.stderr);
      const proof = readJson(join(root, 'verify.json'));
      assert.equal(proof.passed, true);
      assert.equal(proof.jobs, 1);
      assert.equal(proof.backend, override.length ? 'apalache' : 'mixed');
      assert.deepEqual(proof.results.map(row => [row.model, row.backend, row.output.trim()]),
        [['Fixture', 'apalache', '--backend=apalache'], ['Routed', override.length ? 'apalache' : 'tlc', override[0] ?? '--backend=tlc']]);
    }

    const parallelProof = spawnSync(process.execPath, ['scripts/check-quint.ts', 'verify', '--jobs=2'],
      {cwd: root, encoding: 'utf8', timeout: 10000});
    assert.equal(parallelProof.status, 1);
    assert.match(parallelProof.stderr, /one job per server endpoint/);

    if (availableParallelism() >= 2) {
      write('node_modules/@informalsystems/quint/dist/src/cli.js', `
        const {existsSync, writeFileSync} = require('node:fs');
        const name = require('node:path').basename(process.argv[3]);
        if (name === 'Routed.qnt') {
          writeFileSync('routed-started', '');
          console.log(name);
        } else {
          const timer = setInterval(() => {
            if (existsSync('routed-started')) {
              clearInterval(timer);
              clearTimeout(deadline);
              console.log(name);
            }
          }, 10);
          const deadline = setTimeout(() => process.exit(1), 4000);
        }
      `);
      const parallel = spawnSync(process.execPath, ['scripts/check-quint.ts', 'typecheck', '--out=parallel.json'],
        {cwd: root, encoding: 'utf8', timeout: 10000, env: {...process.env, ALPHA_QUINT_JOBS: '2'}});
      assert.equal(parallel.status, 0, parallel.stderr);
      const evidence = readJson(join(root, 'parallel.json'));
      assert.equal(evidence.jobs, 2);
      assert.deepEqual(evidence.results.map(row => [row.model, row.phase, row.passed]),
        [['Fixture', 'typecheck', true], ['Routed', 'typecheck', true]]);
      assert.deepEqual(evidence.finalInputErrors, []);
    }

    write('node_modules/@informalsystems/quint/dist/src/cli.js', 'setTimeout(() => {}, 60000);');
    const interrupted = spawnSync(process.execPath, ['scripts/check-quint.ts', 'typecheck', '--out=interrupted.json'], { cwd: root, encoding: 'utf8', timeout: 2000 });
    assert.equal(interrupted.error?.code, 'ETIMEDOUT');
    const unfinished = readJson(join(root, 'interrupted.json'));
    assert.equal(unfinished.passed, false);
    assert.equal(unfinished.status, 'running');

    if (process.platform !== 'win32') {
      write('node_modules/@informalsystems/quint/dist/src/cli.js', `
        const command = process.argv[2];
        const name = require('node:path').basename(process.argv[3]);
        if (command === 'typecheck' || name === 'CounterexampleCanary.qnt') {
          require('node:net').createConnection(process.env.ALPHA_QUINT_TEST_SOCKET);
        } else if (command === 'test') {
          console.log('ok exampleTest passed 1 test(s)');
        }
      `);
      for (const [command, expectedChildren] of [['typecheck', Math.min(2, availableParallelism())], ['check', 1]]) {
        const socketPath = join(root, `${command}.sock`);
        const sockets = [];
        const server = createServer(socket => {
          sockets.push(socket);
          socket.resume();
        });
        server.listen(socketPath);
        await once(server, 'listening');
        const runner = spawn(process.execPath, ['scripts/check-quint.ts', command, '--jobs=2', '--out=interrupted.json'], {
          cwd: root, stdio: 'ignore', env: {...process.env, ALPHA_QUINT_TEST_SOCKET: socketPath},
        });
        const signal = AbortSignal.timeout(10000);
        try {
          while (sockets.length < expectedChildren) await delay(20, undefined, {signal});
          const exited = once(runner, 'exit', {signal});
          runner.kill('SIGTERM');
          assert.deepEqual(await exited, [130, null]);
          while (sockets.some(socket => !socket.destroyed)) await delay(20, undefined, {signal});
          assert.equal(readJson(join(root, 'interrupted.json')).status, 'running');
        } finally {
          runner.kill('SIGKILL');
          for (const socket of sockets) socket.destroy();
          server.close();
        }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
