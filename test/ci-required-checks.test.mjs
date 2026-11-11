import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const read = file => fs.readFileSync(file, 'utf8');

test('aggregate result fails a selected lane that did not succeed and passes skipped unselected lanes', async () => {
  const { requiredResult } = await import('../scripts/ci/required-result.ts');
  assert.equal(requiredResult(['changes=success', 'build=skipped:false']).ok, true);
  assert.equal(requiredResult(['changes=success', 'build=success:true']).ok, true);
  for (const result of ['failure', 'cancelled', 'skipped', ''])
    assert.equal(requiredResult(['changes=success', `build=${result}:true`]).ok, false, result);
  assert.equal(requiredResult(['changes=failure', 'build=skipped:false']).ok, false);
  assert.equal(requiredResult(['changes=skipped']).ok, false, 'a job without selection must succeed');
  assert.equal(requiredResult(['build=failure:false']).ok, false, 'an unselected lane may skip, never fail');
  assert.equal(requiredResult([]).ok, false);
  assert.throws(() => requiredResult(['build=$(id)']));
});

test('production lane selects production-surface and every *.production.spec.ts in both places', async () => {
  const { productionSpec, browserPlan } = await import('../scripts/ci/affected.ts');
  const config = read('playwright.config.ts');
  const literal = /const productionSpec=(\/.*\/);/.exec(config)?.[1];
  assert.equal(literal, String(productionSpec), 'playwright.config.ts and scripts/ci/affected.ts must agree');
  for (const file of ['test/browser/production-surface.spec.ts', 'test/browser/notes.production.spec.ts', 'test/browser/a/b-c.production.spec.ts'])
    assert.ok(productionSpec.test(file), file);
  for (const file of ['test/browser/notes.spec.ts', 'test/browser/production.spec.ts', 'test/browser/notes.production.spec.ts.bak'])
    assert.ok(!productionSpec.test(file), file);
  const plan = browserPlan(['test/browser/notes.production.spec.ts'], () => true);
  assert.equal(plan.browser_production, true);
  assert.equal(plan.browser_development, false);
  assert.equal(plan.browser_specs, '[]');
  const mixed = browserPlan(['test/browser/notes.production.spec.ts', 'test/browser/notes.spec.ts'], () => true);
  assert.equal(mixed.browser_specs, '["test/browser/notes.spec.ts"]');
  assert.equal(mixed.browser_production, true);
});

test('the local-agent profile step runs every profile spec whole and the change gate selects each of them', async () => {
  const { browserPlan } = await import('../scripts/ci/affected.ts');
  const files = ['test/browser/browser-agent-tts.spec.ts', 'test/browser/browser-host-disclosure.spec.ts', 'test/browser/host-reminder-recovery.spec.ts'];
  const step = /name: Exercise synthetic local-agent speech profile[^\n]*\n(?:.*\n)*?.*VITE_LOCAL_AGENT=1 .*npm run test:browser -- (.*)\n/.exec(read('.github/workflows/browser.yml'))?.[1];
  assert.ok(step, 'profile step');
  assert.doesNotMatch(step, /--grep/);
  for (const file of files) {
    assert.ok(step.includes(file), file);
    assert.equal(browserPlan([file], () => true).browser_speech, true, file);
  }
  assert.equal(browserPlan(['test/browser/notes.spec.ts'], () => true).browser_speech, false);
});

test('Android foundation runs on main and develop pushes and both workflows end in the required aggregate jobs', () => {
  const android = read('.github/workflows/android.yml');
  assert.match(android, /^on:\n(?:.*\n)*?  push:\n    branches: \[main, develop\]\n/m);
  assert.match(android, /cancel-in-progress: \$\{\{ github\.event_name != 'push' \}\}/);
  // A shared group would still cancel a pending main run when another push arrives.
  assert.match(android, /group: android-\$\{\{ github\.event_name == 'push' && github\.sha \|\| github\.ref \}\}/);
  const browser = read('.github/workflows/browser.yml');
  // The event name also keeps a dispatch on main from cancelling the daily scheduled run.
  assert.ok(browser.includes("group: browser-${{ github.event_name }}-${{ github.event_name == 'push' && github.sha || github.ref }}\n"));
  assert.match(browser, /^on:\n(?:.*\n)*?  schedule:\n    - cron: '[^']+'\n/m);
  assert.match(browser, /- run: npm run verify\n        env:\n(?:.*\n)*?          ALPHA_REQUIRE_PREPARED_SDK: '1'\n/);
  assert.match(android, /name: Android foundation result\n    needs: \[changes, build\]\n    if: always\(\)/);
  assert.match(android, /artifacts\/mapping\/\*\.txt/);
  const manualVerify = android.split('- name: Verify standalone manual qualification\n')[1]?.split('\n      - ')[0];
  assert.match(manualVerify, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(manualVerify, /ALPHA_REQUIRE_PREPARED_SDK: '1'/);
  assert.match(manualVerify, /run: npm run verify/);
  assert.match(android, /name: Prepare pinned SDK for manual verification[\s\S]*node scripts\/prepare-local-agent\.ts/);
  assert.match(android, /name: Prepare pinned native lifecycle sources\n\s+if: github\.event_name != 'workflow_dispatch'/);

  assert.match(browser, /name: Browser MVP result\n    needs: \[changes, verify, browser, production\]\n    if: always\(\)/);
  assert.match(browser, /name: Repository verification\n/);
  assert.match(browser, /node scripts\/verify-upstream\.ts/);
  const resident = read('.github/workflows/resident-android.yml');
  // The candidate workflow test checks the other concurrency groups.
  assert.ok(resident.includes("${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}"));
  assert.match(resident, /vars\.ELIZA_RESIDENT_QUALIFICATION == 'push'/);
  assert.match(resident, /vars\.ELIZA_RESIDENT_QUALIFICATION == 'nightly'/);
  // Primary main attempts may supersede automatic candidate work; reruns are isolated. Develop pushes and
  // nightly qualification retain distinct groups; manual qualification stays isolated by
  // ref and upload-only carriers retain their extra suffix.
  const carrierGroupSuffix = "${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}";
  const concurrency = YAML.parse(resident).concurrency;
  assert.equal(concurrency.group, "resident-${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && (github.run_attempt == 1 && 'app-candidate-main' || format('app-candidate-run-{0}', github.run_id)) || (github.event_name == 'workflow_dispatch' && github.ref || format('{0}-{1}', github.event_name, github.sha)) }}" + carrierGroupSuffix);
  assert.equal(concurrency['cancel-in-progress'], "${{ github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main' && github.run_attempt == 1) }}");
});

test('the Quint gate, its node tests and the Lemma proofs run in CI only for promotion to main and on dispatch', () => {
  const formal = /quint:|lemma:|prepare-dafny|LEMMA_|ALPHA_QUINT/;
  for (const file of fs.readdirSync('.github/workflows').filter(name => name !== 'quint-model-check.yml'))
    assert.doesNotMatch(read(`.github/workflows/${file}`), formal, file);
  assert.doesNotMatch(JSON.parse(read('package.json')).scripts.verify, formal);
  const promotion = YAML.parse(read('.github/workflows/quint-model-check.yml'));
  assert.deepEqual(Object.keys(promotion.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(promotion.on.pull_request, {branches: ['main']});
  const commands = Object.values(promotion.jobs).flatMap(job => job.steps).map(step => step.run ?? '').join('\n');
  for (const command of ['quint:prepare-history', 'quint:check', 'quint:tests', 'quint:refinement -- --families=composition',
    'quint:verify', 'quint:compare', 'quint:temporal', 'lemma:check', 'scripts/ci/prepare-dafny.sh'])
    assert.ok(commands.includes(command), command);
});

test('committed ruleset requires exactly the stable check names', () => {
  const ruleset = JSON.parse(read('scripts/ci/required-checks-ruleset.json'));
  assert.equal(ruleset.target, 'branch');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const checks = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks.map(row => row.context).sort(), ['Android foundation result', 'Browser MVP result', 'Repository verification']);
  assert.ok(checks.every(row => row.integration_id === 15368));
  const workflows = read('.github/workflows/android.yml') + read('.github/workflows/browser.yml');
  for (const { context } of checks) assert.ok(workflows.includes(`name: ${context}\n`), context);
});
