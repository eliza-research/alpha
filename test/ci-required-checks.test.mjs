import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('committed ruleset requires exactly the verify job', () => {
  const ruleset = JSON.parse(read('scripts/ci/required-checks-ruleset.json'));
  assert.equal(ruleset.target, 'branch');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const checks = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks, [{context: 'Repository verification', integration_id: 15368}]);
  assert.equal(YAML.parse(read('.github/workflows/verify.yml')).jobs.verify.name, 'Repository verification');
});
