// Issue #658 step 4: the branch-integrity read-back reports the bypass actors of enforcing rulesets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {compareIntegrity} from '../scripts/owner/read-branch-integrity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const repo = 'o/r';
const rules = [{type: 'non_fast_forward', ruleset_id: 7}, {type: 'deletion', ruleset_id: 7}, {type: 'required_signatures', ruleset_id: 7}];
const admins = [{actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always'}];

test('an enforcing ruleset with bypass actors is annotated and not ok unless allowed', () => {
  const input = {branchRules: rules, rulesetNames: new Map([[7, 'Shared branch integrity']]), bypassActors: new Map([[7, admins]])};
  const bypassed = compareIntegrity(input);
  assert.equal(bypassed.ok, false);
  assert.deepEqual(bypassed.missing, []);
  assert.deepEqual(bypassed.enforcedBy.non_fast_forward, ['ruleset "Shared branch integrity" (bypass: OrganizationAdmin always)']);
  assert.deepEqual(bypassed.bypassable, ['ruleset "Shared branch integrity"']);
  assert.equal(compareIntegrity({...input, allowBypass: true}).ok, true);
  assert.equal(compareIntegrity({...input, bypassActors: new Map([[7, []]])}).ok, true);
});

// Runs the script against a fake gh that answers GET endpoints from a fixture map.
function run(responses, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-fixture-'));
  const bin = path.join(dir, 'gh');
  fs.writeFileSync(path.join(dir, 'responses.json'), JSON.stringify(responses));
  fs.writeFileSync(bin, `#!${process.execPath}
const responses = require(${JSON.stringify(path.join(dir, 'responses.json'))});
const endpoint = process.argv[process.argv.length - 1];
if (endpoint in responses) process.stdout.write(JSON.stringify(responses[endpoint]));
else { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
`, {mode: 0o755});
  try {
    return spawnSync(process.execPath, ['scripts/owner/read-branch-integrity.mjs', '--repo', repo, '--branch', 'main', ...args], {cwd: root, encoding: 'utf8', env: {...process.env, GH_BIN: bin}});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

const base = {
  [`repos/${repo}/rulesets?includes_parents=true&per_page=100`]: [{id: 7, name: 'Shared branch integrity', enforcement: 'active', source_type: 'Repository', source: repo}],
  [`repos/${repo}/rules/branches/main?per_page=100`]: rules,
};

test('the read-back exits 1 on bypass actors, 0 with --allow-bypass, and 0 without bypass', () => {
  const bypassed = {...base, [`repos/${repo}/rulesets/7`]: {id: 7, bypass_actors: admins, current_user_can_bypass: 'always'}};
  const failing = run(bypassed);
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(failing.stdout, /non_fast_forward: ruleset "Shared branch integrity" \(bypass: OrganizationAdmin always\)/);
  assert.match(failing.stdout, /BYPASS ruleset "Shared branch integrity" has bypass actors/);
  assert.equal(run(bypassed, ['--allow-bypass']).status, 0);
  const clean = run({...base, [`repos/${repo}/rulesets/7`]: {id: 7, bypass_actors: [], current_user_can_bypass: 'never'}});
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
});

test('an unreadable ruleset detail or hidden bypass list exits 2', () => {
  const missing = run(base);
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /UNREADABLE ruleset 7 detail: 404/);
  const hidden = run({...base, [`repos/${repo}/rulesets/7`]: {id: 7}});
  assert.equal(hidden.status, 2);
  assert.match(hidden.stdout, /UNREADABLE ruleset 7 detail: bypass actors are not visible/);
});
