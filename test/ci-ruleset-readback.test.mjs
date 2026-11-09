// MVP-46: the read-back compares enforced rules with the intended ruleset and never writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compareRequiredChecks, repositoryFromRemote, INTENDED_FILE} from '../scripts/ci/read-required-checks.mjs';

const intended = JSON.parse(fs.readFileSync(INTENDED_FILE, 'utf8'));
const parameters = intended.rules[0].parameters;
const baseline = {id: 1, name: 'Default branch baseline', enforcement: 'active', target: 'branch', rules: [{type: 'deletion'}, {type: 'non_fast_forward'}, {type: 'pull_request'}]};
const installed = {id: 2, ...intended};
const baselineRules = baseline.rules.map(rule => ({...rule, ruleset_id: 1}));
const requiredRule = {type: 'required_status_checks', ruleset_id: 2, parameters};
test('the read-back CLI fetches rules with GET and prints an unapplied correction', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'alpha-required-checks-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const calls = join(dir, 'calls.txt');
  fs.writeFileSync(join(dir, 'gh'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$ALPHA_RULESET_CALLS"',
    '[ "$1" = api ] && [ "$2" = --method ] && [ "$3" = GET ] || exit 88',
    'case "$4" in */protection) printf null ;; *) printf "[]" ;; esac',
  ].join('\n') + '\n', {mode: 0o755});

  const result = spawnSync(process.execPath, ['scripts/ci/read-required-checks.mjs', '--repo', 'fixture/phone', '--branch', 'main'], {
    env: {...process.env, PATH: dir, ALPHA_RULESET_CALLS: calls},
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), [
    'api --method GET repos/fixture/phone/rules/branches/main?per_page=100',
    'api --method GET repos/fixture/phone/rulesets?includes_parents=true&per_page=100',
    'api --method GET repos/fixture/phone/branches/main/protection',
  ]);
  assert.match(result.stdout, /gh api --method POST repos\/fixture\/phone\/rulesets --input scripts\/ci\/required-checks-ruleset\.json/);
});

test('when only the baseline is installed, every intended check is reported missing', () => {
  const result = compareRequiredChecks({intended, branchRules: baselineRules, rulesets: [baseline], protection: null});
  assert.equal(result.ok, false);
  assert.deepEqual(result.enforced, []);
  assert.deepEqual(result.problems, [
    ...parameters.required_status_checks.map(check => `MISSING required check "${check.context}": merges are not blocked when it is absent or failing.`),
    'Ruleset "Main required checks" is not installed.',
  ]);
  assert.deepEqual(result.notes, ['Other ruleset: "Default branch baseline" (active; rules: deletion, non_fast_forward, pull_request).']);
});

test('the installed ruleset matches, and an unreadable branch is never a match', () => {
  const result = compareRequiredChecks({intended, branchRules: [...baselineRules, requiredRule], rulesets: [baseline, installed], protection: null});
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.enforced.map(row => row.context).sort(), ['Android foundation result', 'Browser MVP result', 'Repository verification']);
  assert.equal(compareRequiredChecks({intended, branchRules: null, rulesets: [baseline, installed]}).ok, false);
});

test('renamed, sharded, unbound, bypassable and weakened configurations are reported', () => {
  const problems = input => compareRequiredChecks({intended, rulesets: [baseline, installed], protection: null, ...input}).problems.join('\n');
  const renamed = structuredClone(requiredRule);
  renamed.parameters.required_status_checks[1].context = 'Chromium (shard 1/4)';
  assert.match(problems({branchRules: [renamed]}), /MISSING required check "Browser MVP result"[\s\S]*UNEXPECTED required check "Chromium \(shard 1\/4\)"/);
  const unbound = structuredClone(requiredRule);
  delete unbound.parameters.required_status_checks[0].integration_id;
  assert.match(problems({branchRules: [unbound]}), /"Repository verification" is not bound to integration 15368/);
  const strict = structuredClone(requiredRule);
  strict.parameters.strict_required_status_checks_policy = true;
  assert.match(problems({branchRules: [strict]}), /Up-to-date branches are required/);
  const rules = [requiredRule];
  assert.match(problems({branchRules: rules, rulesets: [{...installed, bypass_actors: [{actor_type: 'RepositoryRole', actor_id: 5}]}]}), /has 1 bypass actor\(s\)/);
  assert.match(problems({branchRules: [], rulesets: [{...installed, enforcement: 'evaluate'}]}), /MISSING[\s\S]*enforcement is "evaluate", intended "active"/);
  assert.match(problems({branchRules: rules, rulesets: [{...installed, conditions: {ref_name: {include: ['refs/heads/release'], exclude: []}}}]}), /applies to \["refs\/heads\/release"\]/);
  const hidden = structuredClone(installed);
  delete hidden.bypass_actors;
  const result = compareRequiredChecks({intended, branchRules: rules, rulesets: [hidden]});
  assert.equal(result.ok, true);
  assert.ok(result.notes.some(note => note.includes('not visible to this account')));
  // Classic branch protection counts as enforcement, but does not install the ruleset.
  const classic = compareRequiredChecks({intended, branchRules: [], rulesets: [], protection: {required_status_checks: {strict: false, checks: parameters.required_status_checks.map(check => ({context: check.context, app_id: check.integration_id}))}}});
  assert.deepEqual(classic.problems, ['Ruleset "Main required checks" is not installed.']);
});

test('the repository comes from the origin remote', () => {
  assert.equal(repositoryFromRemote('https://github.com/AlphaCompute/alphaphone.git\n'), 'AlphaCompute/alphaphone');
  assert.equal(repositoryFromRemote('git@github.com:AlphaCompute/alphaphone.git'), 'AlphaCompute/alphaphone');
  assert.equal(repositoryFromRemote('https://example.com/x/y.git'), null);
});
