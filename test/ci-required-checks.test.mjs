import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const read = file => fs.readFileSync(file, 'utf8');

test('the local-agent profile step runs every profile spec whole', () => {
  const files = ['test/browser/browser-agent-tts.spec.ts', 'test/browser/browser-host-disclosure.spec.ts', 'test/browser/host-reminder-recovery.spec.ts'];
  const step = /name: Exercise synthetic local-agent speech profile[^\n]*\n(?:.*\n)*?.*VITE_LOCAL_AGENT=1 .*bun run test:browser -- (.*)\n/.exec(read('.github/workflows/promotion.yml'))?.[1];
  assert.ok(step, 'profile step');
  assert.doesNotMatch(step, /--grep/);
  for (const file of files) assert.ok(step.includes(file), file);
});

test('pull requests run one verify job, Android and resident preparation only for their inputs, and nothing re-runs on push', () => {
  const verify = YAML.parse(read('.github/workflows/verify.yml'));
  // No path filter: the required check must report on every pull request, or it stays pending.
  assert.deepEqual(verify.on, {pull_request: null});
  assert.deepEqual(Object.keys(verify.jobs), ['verify']);
  const run = verify.jobs.verify.steps.find(step => step.run === 'bun run verify');
  assert.deepEqual(run.env, {ALPHA_REQUIRE_PREPARED_SDK: '1', ALPHA_ELIZA_SOURCE: '${{ env.ALPHA_CLOUD_COLLECTOR_SOURCE }}'});
  assert.ok(verify.jobs.verify.steps.some(step => step.run === 'bun scripts/verify-upstream.ts --reachability-only'));
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
  for (const file of ['verify.yml', 'android.yml', 'resident-prepare.yml', 'promotion.yml'])
    assert.doesNotMatch(read(`.github/workflows/${file}`), /^  (push|schedule):/m, file);
  assert.match(android, /artifacts\/mapping\/\*\.txt/);
  const manualVerify = android.split('- name: Verify standalone manual qualification\n')[1]?.split('\n      - ')[0];
  assert.match(manualVerify, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(manualVerify, /ALPHA_REQUIRE_PREPARED_SDK: '1'/);
  assert.match(manualVerify, /run: bun run verify/);
  assert.match(android, /name: Prepare pinned SDK for manual verification[\s\S]*bun scripts\/prepare-local-agent\.ts/);
  assert.match(android, /name: Prepare pinned native lifecycle sources\n\s+if: github\.event_name != 'workflow_dispatch'/);

  const resident = read('.github/workflows/resident-android.yml');
  // The candidate workflow test checks the other concurrency groups.
  assert.ok(resident.includes("${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}"));
  assert.match(resident, /vars\.ELIZA_RESIDENT_QUALIFICATION == 'push'/);
  assert.match(resident, /vars\.ELIZA_RESIDENT_QUALIFICATION == 'nightly'/);
  // Independent main runs cannot cancel each other even if GitHub starts the older one later.
  // Reruns keep their run ID. Develop, nightly and manual qualification keep their existing groups.
  const carrierGroupSuffix = "${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}";
  const concurrency = YAML.parse(resident).concurrency;
  assert.equal(concurrency.group, "resident-${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('app-candidate-run-{0}', github.run_id) || (github.event_name == 'workflow_dispatch' && github.ref || format('{0}-{1}', github.event_name, github.sha)) }}" + carrierGroupSuffix);
  assert.equal(concurrency['cancel-in-progress'], "${{ github.event_name == 'workflow_dispatch' }}");
});

test('browser tests, the Quint gate, its node tests and the Lemma proofs run in CI only for promotion to main and on dispatch', () => {
  const formal = /quint:|lemma:|prepare-dafny|LEMMA_|ALPHA_QUINT|test:browser|playwright test/;
  for (const file of fs.readdirSync('.github/workflows').filter(name => name !== 'promotion.yml'))
    assert.doesNotMatch(read(`.github/workflows/${file}`), formal, file);
  assert.doesNotMatch(JSON.parse(read('package.json')).scripts.verify, formal);
  const promotion = YAML.parse(read('.github/workflows/promotion.yml'));
  assert.deepEqual(Object.keys(promotion.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(promotion.on.pull_request, {branches: ['main']});
  const commands = Object.values(promotion.jobs).flatMap(job => job.steps).map(step => step.run ?? '').join('\n');
  for (const command of ['quint:prepare-history', 'quint:check', 'quint:tests', 'quint:refinement -- --families=composition',
    'quint:verify', 'quint:compare', 'quint:temporal', 'lemma:check', 'scripts/ci/prepare-dafny.sh',
    'bun run test:browser -- --shard=${{ matrix.shard }}/6', 'bun run test:browser:production', 'bun run build:test-mocks'])
    assert.ok(commands.includes(command), command);
  for (const step of Object.values(promotion.jobs).flatMap(job => job.steps))
    if (/quint:(compare|temporal)/.test(step.run ?? '')) assert.doesNotMatch(step.run, /--models=/, 'promotion preserves every declared proof');
  assert.match(JSON.parse(read('package.json')).scripts['quint:tests'], /bun run test:node/, 'Node-only conformance remains in the formal suite');
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
