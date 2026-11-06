import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');

test('aggregate result fails a selected lane that did not succeed and passes skipped unselected lanes', async () => {
  const { requiredResult } = await import('../scripts/ci/required-result.mjs');
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
  const { productionSpec, browserPlan } = await import('../scripts/ci/affected.mjs');
  const config = read('playwright.config.ts');
  const literal = /const productionSpec=(\/.*\/);/.exec(config)?.[1];
  assert.equal(literal, String(productionSpec), 'playwright.config.ts and scripts/ci/affected.mjs must agree');
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
  const { browserPlan } = await import('../scripts/ci/affected.mjs');
  const files = ['test/browser/browser-agent-tts.spec.ts', 'test/browser/browser-host-disclosure.spec.ts', 'test/browser/host-reminder-recovery.spec.ts'];
  const step = /name: Exercise synthetic local-agent speech profile\n(?:.*\n)*?.*VITE_LOCAL_AGENT=1 .*npm run test:browser -- (.*)\n/.exec(read('.github/workflows/browser.yml'))?.[1];
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
  for (const [name, text] of [['android', android], ['browser', read('.github/workflows/browser.yml')]])
    assert.match(text, new RegExp(`group: ${name}-\\$\\{\\{ github\\.event_name == 'push' && github\\.sha \\|\\| github\\.ref \\}\\}`), name);
  assert.match(android, /name: Android foundation result\n    needs: \[changes, build\]\n    if: always\(\)/);
  assert.match(android, /artifacts\/mapping\/\*\.txt/);
  const browser = read('.github/workflows/browser.yml');
  assert.match(browser, /name: Browser MVP result\n    needs: \[changes, verify, browser, production\]\n    if: always\(\)/);
  assert.match(browser, /name: Repository verification\n/);
  assert.match(browser, /node scripts\/verify-upstream\.mjs/);
  const residentFull = read('.github/workflows/resident-android.yml');
  const carrierGroupSuffix = "${{ inputs.operation == 'publish-qualification' && '-carrier' || '' }}";
  assert.ok(residentFull.includes(carrierGroupSuffix));
  const resident = residentFull.replace(carrierGroupSuffix, '');
  assert.match(resident, /vars\.ELIZA_RESIDENT_QUALIFICATION == 'push'/);
  assert.match(resident, /vars\.ELIZA_RESIDENT_QUALIFICATION == 'nightly'/);
  // Push and nightly runs never share a group with, or cancel, a dispatched qualification.
  assert.match(resident, /group: resident-\$\{\{ github\.event_name == 'workflow_dispatch' && github\.ref \|\| format\('\{0\}-\{1\}', github\.event_name, github\.sha\) \}\}\n  cancel-in-progress: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
});

test('documented ruleset is the committed ruleset and requires exactly the stable check names', () => {
  const ruleset = JSON.parse(read('scripts/ci/required-checks-ruleset.json'));
  const docs = read('docs/ci-cost-policy.md');
  const block = /## Required checks[\s\S]*?```json\n([\s\S]*?)\n```/.exec(docs)?.[1];
  assert.ok(block, 'docs/ci-cost-policy.md embeds the ruleset JSON');
  assert.deepEqual(JSON.parse(block), ruleset);
  assert.equal(ruleset.target, 'branch');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const checks = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks.map(row => row.context).sort(), ['Android foundation result', 'Browser MVP result', 'Repository verification']);
  assert.ok(checks.every(row => row.integration_id === 15368));
  const workflows = read('.github/workflows/android.yml') + read('.github/workflows/browser.yml');
  for (const { context } of checks) assert.ok(workflows.includes(`name: ${context}\n`), context);
});

test('the scheduled dependency advisory audit is never a required check', () => {
  const workflow = read('.github/workflows/dependency-audit.yml');
  const name = /^name: (.+)$/m.exec(workflow)[1];
  const jobNames = [...workflow.matchAll(/^    name: (.+)$/gm)].map(match => match[1]);
  const ruleset = JSON.parse(read('scripts/ci/required-checks-ruleset.json'));
  const required = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks.map(row => row.context);
  assert.ok(jobNames.length > 0);
  for (const context of [name, ...jobNames]) assert.ok(!required.includes(context), `${context} must not be required`);
  // Schedule and manual dispatch only: it never runs on, or blocks, a pull request or push.
  assert.doesNotMatch(workflow, /^\s*(pull_request|pull_request_target|push|workflow_call):/m);
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
});
