import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';

const read = file => fs.readFileSync(file, 'utf8');

test('pull requests run one verify job, Android and resident preparation only for their inputs, and nothing re-runs on push', () => {
  const verify = YAML.parse(read('.github/workflows/verify.yml'));
  // No path filter: the required check must report on every pull request, or it stays pending.
  assert.deepEqual(verify.on, {pull_request: null});
  assert.deepEqual(Object.keys(verify.jobs), ['verify']);
  const android = read('.github/workflows/android.yml'), androidOn = YAML.parse(android).on;
  assert.deepEqual(Object.keys(androidOn), ['pull_request', 'workflow_dispatch']);
  for (const path of ['android/**', 'apps/app/**', 'scripts/**', 'bun.lock', 'upstream.lock.json', 'vendor/eliza'])
    assert.ok(androidOn.pull_request.paths.includes(path), path);
  assert.deepEqual(Object.keys(YAML.parse(android).jobs), ['build']);
  const prepare = YAML.parse(read('.github/workflows/resident-prepare.yml'));
  assert.deepEqual(Object.keys(prepare.on), ['pull_request', 'workflow_dispatch']);
  for (const path of ['scripts/**', 'bun.lock', 'upstream.lock.json', 'vendor/eliza'])
    assert.ok(prepare.on.pull_request.paths.includes(path), path);
  for (const workflow of [androidOn, prepare.on])
    for (const path of workflow.pull_request.paths.filter(path => !/[*]/.test(path))) assert.ok(fs.existsSync(path), path);

  const resident = read('.github/workflows/resident-android.yml');
  // Independent main runs cannot cancel each other even if GitHub starts the older one later.
  // Reruns keep their run ID. Develop, nightly and manual qualification keep their existing groups.
  const carrierGroupSuffix = "${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}";
  const concurrency = YAML.parse(resident).concurrency;
  assert.equal(concurrency.group, "resident-${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('app-candidate-run-{0}', github.run_id) || (github.event_name == 'workflow_dispatch' && github.ref || format('{0}-{1}', github.event_name, github.sha)) }}" + carrierGroupSuffix);
  assert.equal(concurrency['cancel-in-progress'], "${{ github.event_name == 'workflow_dispatch' }}");
});

test('browser tests, the Quint gate, its node tests and the Lemma proofs run in CI only for promotion to main and on dispatch', () => {
  const promotion = YAML.parse(read('.github/workflows/promotion.yml'));
  assert.deepEqual(Object.keys(promotion.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(promotion.on.pull_request, {branches: ['main']});
  assert.deepEqual(promotion.jobs.browser.strategy.matrix.shard, [1, 2, 3, 4, 5, 6]);
});

test('promotion partitions every safety model and keeps comparisons and temporal checks independent', () => {
  const jobs = YAML.parse(read('.github/workflows/promotion.yml')).jobs;
  const families = ['application', 'services', 'native', 'legacy'];
  const manifests = families.map(family => JSON.parse(read('specs/quint/' + family + '/manifest.json')));
  const models = manifests.flat(), modules = models.map(model => model.module);
  assert.ok(manifests.every(models => Array.isArray(models) && models.length > 0));
  assert.equal(new Set(modules).size, modules.length, 'The complete families are a disjoint registry partition');
  const additionalInits = new Map(models.filter(model => model.additionalProofInit).map(model => [model.module, model.additionalProofInit]));
  assert.equal(additionalInits.get('RendererRecovery'), 'budgetInit');
  assert.equal(additionalInits.get('VadSegmentation'), 'counterInit');

  const safety = jobs.symbolic;
  assert.equal(safety.strategy['fail-fast'], false);
  assert.equal(safety.strategy.matrix.family, '$' + "{{ fromJSON(inputs.models && '" +
    JSON.stringify(['selected']) + "' || '" + JSON.stringify(families) + "') }}");
  const verify = safety.steps.find(step => step.name === 'Bounded symbolic safety and additional proof inits');
  assert.deepEqual(verify.env, {MODELS: '$' + '{{ inputs.models }}', MODEL_FAMILY: '$' + '{{ matrix.family }}'});
  const originalCommand = 'bun scripts/check-quint.ts verify --steps=6 $' + '{MODELS:+--models=$MODELS}';
  assert.ok(verify.run.endsWith(originalCommand + '\n'), 'Each partition uses the unchanged proof command and bounds');

  for (const [id, command] of [['comparison', 'compare'], ['temporal', 'temporal']]) {
    const job = jobs[id];
    assert.equal(job.if, '$' + '{{ !inputs.models }}', 'Manual selection keeps its existing safety-only policy');
    assert.deepEqual(job.steps.slice(0, 5), safety.steps.slice(0, 5), 'All original prerequisite actions, pins and environments remain');
    assert.equal(job.steps[5].run, 'bun scripts/check-quint.ts ' + command);
    assert.equal(job.steps[5].if, undefined);
  }
  for (const job of [safety, jobs.comparison, jobs.temporal]) {
    assert.equal(job.needs, undefined, 'A safety failure cannot suppress another proof family or comparison/temporal job');
    assert.equal(job['timeout-minutes'], 240);
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job.steps.at(-1).if, 'always()');
    assert.equal(job.steps.at(-1).with.path, 'test-results/quint/');
  }
  const familyArtifact = safety.steps.at(-1).with.name;
  assert.equal(familyArtifact, 'quint-symbolic-$' + '{{ matrix.family }}');
  const artifacts = families.map(family => familyArtifact.replace('$' + '{{ matrix.family }}', family));
  artifacts.push(jobs.comparison.steps.at(-1).with.name, jobs.temporal.steps.at(-1).with.name);
  assert.equal(new Set(artifacts).size, 6, 'Every independent job retains its own complete receipt artifact');
});

test('the actual promotion selector preserves manual filters and refuses an empty family fallback', () => {
  const safety = YAML.parse(read('.github/workflows/promotion.yml')).jobs.symbolic;
  const run = safety.steps.find(step => step.name === 'Bounded symbolic safety and additional proof inits').run;
  const command = 'bun scripts/check-quint.ts verify --steps=6 $' + '{MODELS:+--models=$MODELS}';
  assert.equal(run.indexOf(command), run.lastIndexOf(command));
  const prefix = run.slice(0, run.indexOf(command));
  const select = (family, models = '', cwd = process.cwd()) => spawnSync('bash', ['-e', '-c', prefix + '\nprintf "%s" "$MODELS"'], {
    cwd, env: {...process.env, MODEL_FAMILY: family, MODELS: models}, encoding: 'utf8', timeout: 30000,
  });
  for (const family of ['application', 'services', 'native', 'legacy']) {
    const result = select(family);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.split(','), JSON.parse(read('specs/quint/' + family + '/manifest.json')).map(model => model.module));
  }
  for (const models of ['NavigationProgress', 'NavigationProgress,PreviousNotesSourceOpening',
    'NavigationProgress,NavigationProgress', ',,', 'UnknownPromotionPartitionProbe', ' NavigationProgress']) {
    const result = select('selected', models);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, models, 'The singleton selected lane passes the original raw filter to global CLI validation');
  }
  const refused = (result, reason) => {
    assert.ifError(result.error);
    assert.notEqual(result.status, null);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, reason);
  };
  refused(select('selected'), /Unknown safety model family/);
  const scratch = fs.mkdtempSync(join(tmpdir(), 'alpha-promotion-family-'));
  try {
    fs.mkdirSync(join(scratch, 'specs/quint/application'), {recursive: true});
    for (const [malformed, reason] of [[[], /Safety model family must not be empty/],
      [[{}], /Safety model family contains an invalid module/], [[{module: ''}], /Safety model family contains an invalid module/]]) {
      fs.writeFileSync(join(scratch, 'specs/quint/application/manifest.json'), JSON.stringify(malformed));
      refused(select('application', '', scratch), reason);
    }
  } finally {fs.rmSync(scratch, {recursive: true, force: true});}
  const unknown = spawnSync('bun', ['scripts/check-quint.ts', 'verify', '--models=UnknownPromotionPartitionProbe'], {
    encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(unknown.error);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown model UnknownPromotionPartitionProbe/, 'The real CLI rejects unknown names before starting a solver');
});

test('committed ruleset requires exactly the verify job', () => {
  const ruleset = JSON.parse(read('scripts/ci/required-checks-ruleset.json'));
  assert.equal(ruleset.target, 'branch');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const checks = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks, [{context: 'Repository verification', integration_id: 15368}]);
  assert.equal(YAML.parse(read('.github/workflows/verify.yml')).jobs.verify.name, 'Repository verification');
});
