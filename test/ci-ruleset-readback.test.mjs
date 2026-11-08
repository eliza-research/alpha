// MVP-46: the read-back compares enforced rules with the intended ruleset and never writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compareRequiredChecks, ghGet, repositoryFromRemote, INTENDED_FILE} from '../scripts/ci/read-required-checks.mjs';

const intended = JSON.parse(fs.readFileSync(INTENDED_FILE, 'utf8'));
const parameters = intended.rules[0].parameters;
const baseline = {id: 1, name: 'Default branch baseline', enforcement: 'active', target: 'branch', rules: [{type: 'deletion'}, {type: 'non_fast_forward'}, {type: 'pull_request'}]};
const installed = {id: 2, ...intended};
const baselineRules = baseline.rules.map(rule => ({...rule, ruleset_id: 1}));
const requiredRule = {type: 'required_status_checks', ruleset_id: 2, parameters};
const clone = value => JSON.parse(JSON.stringify(value));

test('the read-back script only issues GET requests', () => {
  const source = fs.readFileSync('scripts/ci/read-required-checks.mjs', 'utf8');
  const calls = source.match(/execFileSync\(bin,[^\n]*/g);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /execFileSync\(bin, \['api', '--method', 'GET', endpoint\]/);
  // The only other method named is the command printed for the owner to run.
  assert.deepEqual(source.match(/--method (?!GET)\w+/g), ['--method POST']);
  assert.match(source, /console\.log\(named\(result\) \?[^\n]*\n\s+: `  gh api --method POST repos\/\$\{repo\}\/rulesets --input \$\{INTENDED_FILE\}`\)/);
  assert.doesNotMatch(source, /-X\b|--input['"]|-f\b|--field|--raw-field|PATCH|PUT|DELETE/);
});

test('a stalled gh is killed and reported as an unreadable read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stall-'));
  const bin = path.join(dir, 'gh');
  fs.writeFileSync(bin, '#!/bin/sh\nexec sleep 30\n', {mode: 0o755});
  try {
    const started = Date.now();
    // A status of 0 is not an "absent" status, so the caller lists it as UNREADABLE and exits 2.
    assert.deepEqual(ghGet('repos/o/r', {bin, timeoutMs: 300}), {ok: false, status: 0, message: 'gh timed out after 0.3s'});
    assert.ok(Date.now() - started < 10_000);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('today\'s state: baseline only, so every intended check is reported missing', () => {
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
  const renamed = clone(requiredRule);
  renamed.parameters.required_status_checks[1].context = 'Chromium (shard 1/4)';
  assert.match(problems({branchRules: [renamed]}), /MISSING required check "Browser MVP result"[\s\S]*UNEXPECTED required check "Chromium \(shard 1\/4\)"/);
  const unbound = clone(requiredRule);
  delete unbound.parameters.required_status_checks[0].integration_id;
  assert.match(problems({branchRules: [unbound]}), /"Repository verification" is not bound to integration 15368/);
  const strict = clone(requiredRule);
  strict.parameters.strict_required_status_checks_policy = true;
  assert.match(problems({branchRules: [strict]}), /Up-to-date branches are required/);
  const rules = [requiredRule];
  assert.match(problems({branchRules: rules, rulesets: [{...installed, bypass_actors: [{actor_type: 'RepositoryRole', actor_id: 5}]}]}), /has 1 bypass actor\(s\)/);
  assert.match(problems({branchRules: [], rulesets: [{...installed, enforcement: 'evaluate'}]}), /MISSING[\s\S]*enforcement is "evaluate", intended "active"/);
  assert.match(problems({branchRules: rules, rulesets: [{...installed, conditions: {ref_name: {include: ['refs/heads/release'], exclude: []}}}]}), /applies to \["refs\/heads\/release"\]/);
  const hidden = clone(installed);
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
