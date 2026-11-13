import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';

const read = file => fs.readFileSync(file, 'utf8');

test('pull requests run one verify job and Android only for its inputs; only main pushes build the native candidate', () => {
  const verify = YAML.parse(read('.github/workflows/verify.yml'));
  // No path filter: the required check must report on every pull request, or it stays pending.
  assert.deepEqual(verify.on, {pull_request: null});
  assert.deepEqual(Object.keys(verify.jobs), ['verify']);
  const android = read('.github/workflows/android.yml'), androidOn = YAML.parse(android).on;
  assert.deepEqual(Object.keys(androidOn), ['pull_request', 'workflow_dispatch']);
  for (const path of ['android/**', 'apps/app/**', 'scripts/**', 'bun.lock', 'upstream.lock.json', 'vendor/eliza'])
    assert.ok(androidOn.pull_request.paths.includes(path), path);
  assert.deepEqual(Object.keys(YAML.parse(android).jobs), ['build']);
  for (const path of androidOn.pull_request.paths.filter(path => !/[*]/.test(path))) assert.ok(fs.existsSync(path), path);
  assert.ok(!androidOn.pull_request.paths.some(path => path.startsWith('docs')), 'Documentation-only changes do not build APKs');

  const resident = YAML.parse(read('.github/workflows/resident-android.yml'));
  assert.deepEqual(resident.on.push, {branches: ['main']});
  assert.deepEqual(Object.keys(resident.on), ['workflow_dispatch', 'push']);
  // Independent main runs cannot cancel each other even if GitHub starts the older one later.
  // Reruns keep their run ID. Manual builds keep their group per ref and operation.
  const carrierGroupSuffix = "${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}";
  assert.equal(resident.concurrency.group, "resident-${{ github.event_name == 'push' && format('app-candidate-run-{0}', github.run_id) || github.ref }}" + carrierGroupSuffix);
  assert.equal(resident.concurrency['cancel-in-progress'], "${{ github.event_name == 'workflow_dispatch' }}");

  // The one emulator lane runs nightly and on dispatch in a single job.
  const emulator = YAML.parse(read('.github/workflows/android-emulator.yml'));
  assert.deepEqual(Object.keys(emulator.on), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(Object.keys(emulator.jobs), ['emulator']);
});

test('consolidated lanes retain required operation budgets and exact APK custody', () => {
  const resident = YAML.parse(read('.github/workflows/resident-android.yml')).jobs.build;
  assert.equal(resident.env.ELIZA_BUN_CHANNEL, 'stable');
  const acquisition = resident.steps.find(step => step.run === 'python3 scripts/ci/acquire-resident-bun.py');
  assert.equal(acquisition.env.GH_TOKEN, '$' + '{{ github.token }}');
  assert.ok(resident.steps.some(step => step.run === 'python3 -B scripts/ci/test-acquire-resident-bun.py'));
  for (const [command, minutes] of [['bun run agent:stage-android', 30], ['bun run agent:test-mobile-workflow-bundle', 5],
    ['bun scripts/generate-licenses.ts --packaged-runtime', 2], ['bun scripts/build-archive.ts test-results/resident-ci-distribution', 50]]) {
    const step = resident.steps.find(step => step.run?.split('\n').includes(command));
    assert.ok(step, command);assert.equal(step['timeout-minutes'], minutes, command);
    assert.notEqual(step['continue-on-error'], true);
    assert.equal(step.env.ALPHA_REQUIRE_PREPARED_SDK, '1');
  }
  const emulator = YAML.parse(read('.github/workflows/android-emulator.yml')).jobs.emulator;
  assert.equal(emulator['timeout-minutes'], 360);
  assert.equal(emulator.steps.find(step => step.id === 'build')['timeout-minutes'], 180);
  const anchor = emulator.steps.find(step => step.id === 'freeze');
  assert.match(anchor.run, /sha256sum artifacts\/apk-manifest\.json/);
  for (const mode of ['instrumentation', 'browser-reading']) {
    const step = emulator.steps.find(step => step.with?.script?.includes('bun scripts/ci/emulator-suite.ts ' + mode));
    assert.equal(step['timeout-minutes'], 90);
    assert.ok(step.with.script.includes('$' + '{{ steps.freeze.outputs.manifest }}'));
    assert.ok(step.with.script.includes('git rev-parse HEAD'));
  }
  const apks = emulator.steps.find(step => step.with?.name?.startsWith('android-emulator-apks-'));
  assert.equal(apks.with['if-no-files-found'], 'error');
  for (const input of ['artifacts/apk-manifest.json', 'artifacts/launcher-debug.apk', 'artifacts/instrumentation/*.apk'])
    assert.ok(apks.with.path.split('\n').includes(input), input);
});

test('browser tests, the Quint gate, its node tests and the Lemma proofs run in CI only for promotion to main and on dispatch', () => {
  const promotion = YAML.parse(read('.github/workflows/promotion.yml'));
  assert.deepEqual(Object.keys(promotion.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(promotion.on.pull_request, {branches: ['main']});
  assert.deepEqual(promotion.jobs.browser.strategy.matrix.shard, [1, 2, 3, 4, 5, 6]);
});

const safetyCommand = 'bun scripts/check-quint.ts verify --steps=6 $' + '{MODELS:+--models=$MODELS}';
const temporalCommand = 'bun scripts/check-quint.ts temporal --models="$MODELS"';
const selector = (step, command, env, cwd = process.cwd()) => {
  assert.equal(step.run.indexOf(command), step.run.lastIndexOf(command));
  assert.ok(step.run.endsWith(command + '\n'));
  return spawnSync('bash', ['-e', '-c', step.run.slice(0, step.run.indexOf(command)) + '\nprintf "%s" "$MODELS"'], {
    cwd, env: {...process.env, ...env}, encoding: 'utf8', timeout: scaledTimeout(30000),
  });
};
const selectedNames = result => {
  assert.ifError(result.error);assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout, '');return result.stdout.split(',');
};

test('promotion partitions every safety and temporal phase exactly once without changing proof options', () => {
  const jobs = YAML.parse(read('.github/workflows/promotion.yml')).jobs;
  const families = ['application', 'services', 'native', 'legacy'];
  const manifests = families.map(family => JSON.parse(read('specs/quint/' + family + '/manifest.json')));
  const models = manifests.flat(), byModule = new Map(models.map(model => [model.module, model]));
  assert.ok(manifests.every(models => Array.isArray(models) && models.length > 0));
  assert.equal(byModule.size, models.length, 'Registry families must remain disjoint');
  assert.equal(byModule.get('RendererRecovery').additionalProofInit, 'budgetInit');
  assert.equal(byModule.get('VadSegmentation').additionalProofInit, 'counterInit');
  const safety = jobs.symbolic, temporal = jobs.temporal;
  assert.equal(safety.strategy['fail-fast'], false);
  assert.equal(safety.strategy.matrix.family, '$' + "{{ fromJSON(inputs.models && '" + JSON.stringify(['selected']) + "' || '" + JSON.stringify(families) + "') }}");
  assert.deepEqual(safety.strategy.matrix.partition, [0, 1]);
  assert.deepEqual(safety.strategy.matrix.exclude, [{family: 'selected', partition: 1}]);
  const verify = safety.steps.find(step => step.name === 'Bounded symbolic safety and additional proof inits');
  assert.deepEqual(verify.env, {MODELS: '$' + '{{ inputs.models }}', MODEL_FAMILY: '$' + '{{ matrix.family }}', MODEL_PARTITION: '$' + '{{ matrix.partition }}'});
  const phases = model => [[model.module, model.init, model.step, model.invariant, 6, model.verifyBackend ?? 'apalache'],
    ...(model.additionalProofInit ? [[model.module, model.additionalProofInit, model.step, model.invariant, 1, model.verifyBackend ?? 'apalache']] : [])];
  const actual = [];
  for (const [index, family] of families.entries()) {
    const expected = manifests[index].map(model => model.module), width = Math.ceil(expected.length / 2);
    for (const partition of [0, 1]) {
      const names = selectedNames(selector(verify, safetyCommand, {MODELS: '', MODEL_FAMILY: family, MODEL_PARTITION: String(partition)}));
      assert.deepEqual(names, expected.slice(partition * width, (partition + 1) * width));
      actual.push(...names.flatMap(name => phases(byModule.get(name))));
    }
  }
  const phaseKeys = phases => phases.map(phase => JSON.stringify(phase)).sort();
  const actualKeys = phaseKeys(actual);
  assert.deepEqual(actualKeys, phaseKeys(models.flatMap(phases)), 'All base and additional-init phases retain their exact aliases, backend and CI depth');
  assert.equal(new Set(actualKeys).size, actualKeys.length, 'No phase is duplicated across partitions');

  assert.equal(temporal.if, '$' + '{{ !inputs.models }}');
  assert.equal(temporal.strategy['fail-fast'], false);
  assert.deepEqual(temporal.strategy.matrix.group, ['PhotosLibrary', 'NotesView', 'remaining']);
  const temporalStep = temporal.steps.find(step => step.name === 'Fairness-guarded temporal properties');
  assert.deepEqual(temporalStep.env, {TEMPORAL_GROUP: '$' + '{{ matrix.group }}'});
  const temporalModels = models.filter(model => model.temporal?.length);
  const temporalNames = temporal.strategy.matrix.group.flatMap(group => selectedNames(selector(temporalStep, temporalCommand, {TEMPORAL_GROUP: group})));
  assert.deepEqual([...temporalNames].sort(), temporalModels.map(model => model.module).sort());
  assert.equal(new Set(temporalNames).size, temporalNames.length, 'Every complete temporal property bundle has exactly one owner');
  assert.deepEqual(temporalNames.flatMap(name => {
    const model = byModule.get(name);return [[name, model.init, model.step, model.temporal]];
  }).sort(), temporalModels.map(model => [model.module, model.init, model.step, model.temporal]).sort());
  assert.equal(jobs.comparison.if, '$' + '{{ !inputs.models }}');
  assert.equal(jobs.comparison.steps[5].run, 'bun scripts/check-quint.ts compare');
  for (const job of [safety, jobs.comparison, temporal]) {
    assert.deepEqual(job.steps.slice(0, 5), safety.steps.slice(0, 5), 'All pinned prerequisites remain identical');
    assert.equal(job.needs, undefined);assert.equal(job['timeout-minutes'], 240);assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job.steps.at(-1).if, 'always()');assert.equal(job.steps.at(-1).with.path, 'test-results/quint/');
  }
  const safetyArtifact = safety.steps.at(-1).with.name, temporalArtifact = temporal.steps.at(-1).with.name;
  assert.equal(safetyArtifact, 'quint-symbolic-$' + '{{ matrix.family }}-$' + '{{ matrix.partition }}');
  assert.equal(temporalArtifact, 'quint-temporal-$' + '{{ matrix.group }}');
  const artifacts = families.flatMap(family => [0, 1].map(partition => safetyArtifact.replace('$' + '{{ matrix.family }}', family).replace('$' + '{{ matrix.partition }}', String(partition))));
  artifacts.push(jobs.comparison.steps.at(-1).with.name, ...temporal.strategy.matrix.group.map(group => temporalArtifact.replace('$' + '{{ matrix.group }}', group)));
  assert.equal(new Set(artifacts).size, 12);
});

test('the actual promotion selectors preserve manual filters and refuse empty or invalid partitions', () => {
  const jobs = YAML.parse(read('.github/workflows/promotion.yml')).jobs;
  const safety = jobs.symbolic.steps.find(step => step.name === 'Bounded symbolic safety and additional proof inits');
  const temporal = jobs.temporal.steps.find(step => step.name === 'Fairness-guarded temporal properties');
  const select = (family, partition = '0', models = '', cwd) => selector(safety, safetyCommand, {MODEL_FAMILY: family, MODEL_PARTITION: partition, MODELS: models}, cwd);
  for (const models of ['NavigationProgress', 'NavigationProgress,PreviousNotesSourceOpening',
    'NavigationProgress,NavigationProgress', ',,', 'UnknownPromotionPartitionProbe', ' NavigationProgress']) {
    const result = select('selected', '0', models);
    assert.equal(result.status, 0, result.stderr);assert.equal(result.stdout, models, 'The sole selected lane delegates the original raw filter to the CLI');
  }
  const refused = (result, reason) => {
    assert.ifError(result.error);assert.notEqual(result.status, null);assert.notEqual(result.status, 0);assert.match(result.stderr, reason);
  };
  refused(select('selected'), /Unknown safety model family/);
  for (const partition of ['', '2', '-1', 'unknown']) refused(select('application', partition), /Invalid safety model partition/);
  refused(selector(temporal, temporalCommand, {TEMPORAL_GROUP: 'unknown'}), /Unknown temporal model group/);
  const scratch = fs.mkdtempSync(join(tmpdir(), 'alpha-promotion-partition-'));
  try {
    for (const family of ['application', 'services', 'native', 'legacy']) {
      fs.mkdirSync(join(scratch, 'specs/quint', family), {recursive: true});fs.writeFileSync(join(scratch, 'specs/quint', family, 'manifest.json'), '[]');
    }
    for (const [malformed, reason] of [[[], /Safety model family must not be empty/], [[{}], /Safety model family contains an invalid module/],
      [[{module: ''}], /Safety model family contains an invalid module/]]) {
      fs.writeFileSync(join(scratch, 'specs/quint/application/manifest.json'), JSON.stringify(malformed));refused(select('application', '0', '', scratch), reason);
    }
    fs.writeFileSync(join(scratch, 'specs/quint/application/manifest.json'), JSON.stringify([{module: 'OnlyOne'}]));
    refused(select('application', '1', '', scratch), /Safety model partition must not be empty/);
    fs.writeFileSync(join(scratch, 'specs/quint/application/manifest.json'), JSON.stringify([{module: 'PhotosLibrary', temporal: ['Checked']}, {module: 'NotesView', temporal: ['Checked']}]));
    refused(selector(temporal, temporalCommand, {TEMPORAL_GROUP: 'remaining'}, scratch), /Temporal model group must not be empty/);
    fs.writeFileSync(join(scratch, 'specs/quint/application/manifest.json'), '[]');
    refused(selector(temporal, temporalCommand, {TEMPORAL_GROUP: 'PhotosLibrary'}, scratch), /Temporal model group must not be empty/);
  } finally {fs.rmSync(scratch, {recursive: true, force: true});}
  const unknown = spawnSync('bun', ['scripts/check-quint.ts', 'verify', '--models=UnknownPromotionPartitionProbe'], {encoding: 'utf8', timeout: scaledTimeout(30000)});
  assert.ifError(unknown.error);assert.notEqual(unknown.status, 0);assert.match(unknown.stderr, /Unknown model UnknownPromotionPartitionProbe/);
});

test('committed ruleset requires exactly the verify job', () => {
  const ruleset = JSON.parse(read('scripts/ci/required-checks-ruleset.json'));
  assert.equal(ruleset.target, 'branch');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const checks = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks, [{context: 'Repository verification', integration_id: 15368}]);
  assert.equal(YAML.parse(read('.github/workflows/verify.yml')).jobs.verify.name, 'Repository verification');
});
