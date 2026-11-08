// Owner incident-response helpers for #658 and #679 (scripts/owner/). These run without network:
// the GitHub reads are injected, and the branch scan runs against a throwaway repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {assertReadOnlyEndpoint, fullName, ghGetAll, loadIocs, parseArgs} from '../scripts/owner/gh-readonly.mjs';
import {forgedPrefixes, matchRuns, rotationState, auditRepository as auditCi} from '../scripts/owner/incident-ci-exposure.mjs';
import {actorPermission, actorHasAccess, grantsAccess, hookRow, hostOf, keyRow, summarizeAudit} from '../scripts/owner/incident-access-audit.mjs';
import {contentMarkers, initScripts, parseLsRemote, pathMarkers, scanHead} from '../scripts/owner/forged-branch-scan.mjs';
import {compareIntegrity} from '../scripts/owner/read-branch-integrity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const iocs = loadIocs(root);

test('the IOC file transcribes the cleanup record', () => {
  assert.equal(iocs.branches.length, 102);
  assert.equal(iocs.repositories.length, 26);
  assert.equal(Object.keys(iocs.ciRunsOnForgedCommits).length, 18);
  assert.equal(Object.values(iocs.ciRunsOnForgedCommits).reduce((a, b) => a + b, 0), 117);
  assert.equal(iocs.ciRunsOnForgedCommits.alphaphone, 6);
  assert.deepEqual(forgedPrefixes(iocs, 'eliza-research/alphaphone').sort(), ['0cefd6e47', '131cd0e63', '39ef59401', '61d293f61', 'cc3f7a709']);
  assert.equal(fullName(iocs, 'alphaphone'), 'eliza-research/alphaphone');
  assert.equal(fullName(iocs, 'vera'), 'AlphaCompute/vera');
  for (const row of iocs.branches) for (const key of ['preAttack', 'forged']) assert.match(row[key], /^[0-9a-f]{9}$/);
});

// The mutation checks cover every owner script. The secret-field check covers the incident scripts
// only: other owner scripts belong to other issues and legitimately read fields such as `.value`
// from non-secret data.
const INCIDENT_SCRIPTS = new Set(['gh-readonly.mjs', 'incident-ci-exposure.mjs', 'incident-access-audit.mjs', 'forged-branch-scan.mjs', 'read-branch-integrity.mjs']);

test('every owner script talks to GitHub with GET only and never mutates git state', () => {
  const dir = path.join(root, 'scripts/owner');
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.mjs'));
  for (const file of INCIDENT_SCRIPTS) assert.ok(files.includes(file), file);
  for (const file of files) {
    const code = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
    assert.doesNotMatch(code, /['"`](POST|PUT|PATCH|DELETE)['"`]/, file);
    assert.doesNotMatch(code, /--method['"`],\s*['"`](?!GET)/, file);
    assert.doesNotMatch(code, /['"`](checkout|switch|reset|push|merge|rebase|worktree|clean|update-ref)['"`]/, file);
    if (INCIDENT_SCRIPTS.has(file)) assert.doesNotMatch(code, /\.value\b|secret_value|encrypted_value/, file);
  }
  assert.throws(() => assertReadOnlyEndpoint('-X'), /refusing/);
  assert.throws(() => assertReadOnlyEndpoint('repos/a/b --method POST'), /refusing/);
  assert.equal(assertReadOnlyEndpoint('repos/a/b/environments/x%20(prod)/secrets?per_page=100'), 'repos/a/b/environments/x%20(prod)/secrets?per_page=100');
});

test('argument parsing rejects unknown flags and collects repeated options', () => {
  assert.deepEqual(parseArgs(['--repo', 'a/b', '--repo', 'c/d', '--json'], {flags: ['--json'], multi: ['--repo']}), {_: [], repo: ['a/b', 'c/d'], json: true});
  assert.throws(() => parseArgs(['--force'], {flags: ['--json']}), /unknown argument/);
  assert.throws(() => parseArgs(['--repo'], {multi: ['--repo']}), /needs a value/);
});

test('pagination stops on a short page and keeps partial results', () => {
  const pages = {1: Array(100).fill({name: 'x'}), 2: [{name: 'y'}]};
  const get = endpoint => ({ok: true, data: {secrets: pages[Number(/&page=(\d+)/.exec(endpoint)[1])] ?? []}});
  assert.equal(ghGetAll('repos/a/b/actions/secrets', {pick: page => page.secrets, get}).data.length, 101);
  const failing = endpoint => /&page=1\b/.test(endpoint) ? {ok: false, status: 403, message: 'no'} : {ok: true, data: []};
  assert.equal(ghGetAll('repos/a/b/x', {get: failing}).ok, false);
});

test('runs on forged commits are matched by SHA prefix and de-duplicated', () => {
  const runs = [
    {id: 2, head_sha: '61d293f61f8e', name: 'Browser MVP', event: 'pull_request', head_branch: 'b', conclusion: 'failure', created_at: '2026-10-27T22:49:21Z', actor: {login: 'gabrielbarbera'}},
    {id: 1, head_sha: '39ef594011c3', name: 'Android', event: 'pull_request', head_branch: 'a', conclusion: 'failure', created_at: '2026-10-27T22:49:12Z', actor: {login: 'gabrielbarbera'}},
    {id: 1, head_sha: '39ef594011c3', name: 'Android', event: 'pull_request', head_branch: 'a', conclusion: 'failure', created_at: '2026-10-27T22:49:12Z'},
    {id: 3, head_sha: 'aaaaaaaaaaaa', name: 'Clean', created_at: '2026-10-28T00:00:00Z'},
  ];
  const matched = matchRuns(runs, ['39ef59401', '61d293f61']);
  assert.deepEqual(matched.map(run => [run.id, run.forged]), [[1, '39ef59401'], [2, '61d293f61']]);
  assert.equal(rotationState('2026-10-28T09:00:00Z', iocs.window.end), 'UPDATED-AFTER-INCIDENT');
  assert.equal(rotationState('2026-10-01T00:00:00Z', iocs.window.end), 'NOT-ROTATED-YET');
  assert.equal(rotationState(null, iocs.window.end), 'UNKNOWN');
});

test('the CI exposure audit lists names only and reports unreadable endpoints', () => {
  const get = endpoint => {
    if (endpoint.startsWith('repos/o/alphaphone/commits/39ef59401')) return {ok: true, data: {sha: '39ef594011c34d625882ee8f4ecb5a0a07788885'}};
    if (endpoint.startsWith('repos/o/alphaphone/commits/')) return {ok: false, status: 422, message: 'No commit'};
    if (endpoint.includes('actions/runs')) return {ok: true, data: {workflow_runs: [{id: 9, head_sha: '39ef594011c34d625882ee8f4ecb5a0a07788885', name: 'Browser MVP', created_at: '2026-10-27T22:49:12Z'}]}};
    if (endpoint.includes('/actions/secrets')) return {ok: true, data: {secrets: [{name: 'DEPLOY_TOKEN', updated_at: '2026-09-01T00:00:00Z', value: 'never-printed'}]}};
    if (endpoint.includes('/environments?')) return {ok: true, data: {environments: [{name: 'release', protection_rules: [{type: 'required_reviewers'}]}]}};
    if (endpoint.includes('/environments/release/secrets')) return {ok: true, data: {secrets: [{name: 'SIGNING', updated_at: '2026-10-28T10:00:00Z'}]}};
    if (endpoint.includes('/environments/release/variables')) return {ok: true, data: {variables: [{name: 'AWS_ROLE_ARN', updated_at: '2026-10-01T00:00:00Z'}]}};
    return {ok: false, status: 403, message: 'Must have admin rights'};
  };
  const report = auditCi('o/alphaphone', iocs, {get});
  assert.deepEqual(report.forgedRuns.map(run => run.id), [9]);
  assert.deepEqual(report.secrets.map(row => [row.name, row.state]), [['DEPLOY_TOKEN', 'NOT-ROTATED-YET']]);
  assert.deepEqual(report.environments[0].secrets.map(row => row.state), ['UPDATED-AFTER-INCIDENT']);
  assert.deepEqual(report.environments[0].variables.map(row => row.state), ['VARIABLE']);
  assert.ok(!JSON.stringify(report).includes('never-printed'));
  assert.ok(report.unreadable.some(line => line.startsWith('organization secrets')));
});

test('access audit: public read is not access, a pending invitation is, hook URLs keep only the host', () => {
  assert.equal(actorPermission({ok: true, data: {permission: 'read', role_name: 'read'}}, {isPublic: true}), 'none (public read)');
  assert.equal(actorPermission({ok: true, data: {permission: 'read', role_name: 'read'}}), 'read');
  assert.equal(actorPermission({ok: true, data: {permission: 'none', role_name: ''}}), 'none');
  assert.equal(actorPermission({ok: false, status: 404}), 'none');
  assert.equal(actorPermission({ok: false, status: 403}), null);
  assert.equal(grantsAccess('none (public read)'), false);
  assert.equal(grantsAccess('write'), true);
  const repo = {actor: 'x', actorPermission: 'none', outsideCollaborators: [], invitations: [{invitee: 'x'}]};
  assert.equal(actorHasAccess([repo], []), true);
  assert.equal(actorHasAccess([{...repo, invitations: []}], [{actorIsMember: false}]), false);
  assert.equal(hostOf('https://hooks.example.test/p?token=abc'), 'hooks.example.test');
  assert.ok(!JSON.stringify(hookRow({id: 1, active: true, events: ['push'], config: {url: 'https://h.test/x?token=abc', secret: '***'}})).includes('abc'));
  assert.ok(!('key' in keyRow({id: 1, title: 't', key: 'ssh-ed25519 AAAA', read_only: true})));
  assert.deepEqual(summarizeAudit([{action: 'git.push'}, {action: 'git.push'}, {action: 'repo.access'}]), {'git.push': 2, 'repo.access': 1});
});

test('branch-integrity read-back names the source of each protection', () => {
  const names = new Map([[7, 'Shared branch integrity']]);
  const full = compareIntegrity({branchRules: [{type: 'non_fast_forward', ruleset_id: 7}, {type: 'deletion', ruleset_id: 7}, {type: 'required_signatures', ruleset_id: 7}], rulesetNames: names});
  assert.equal(full.ok, true);
  assert.deepEqual(full.enforcedBy.required_signatures, ['ruleset "Shared branch integrity"']);
  const classic = compareIntegrity({protection: {allow_force_pushes: {enabled: false}, allow_deletions: {enabled: false}, required_signatures: {enabled: false}, enforce_admins: {enabled: false}}});
  assert.deepEqual(classic.missing, ['required_signatures']);
  assert.match(classic.enforcedBy.non_fast_forward[0], /admins can bypass/);
  const evaluate = compareIntegrity({branchRules: [{type: 'required_signatures', ruleset_id: 7}], rulesetNames: names, evaluateOnly: new Set([7])});
  assert.ok(evaluate.missing.includes('required_signatures'));
  assert.deepEqual(evaluate.evaluating.required_signatures, ['ruleset "Shared branch integrity"']);
});

test('ruleset drafts block force-push and deletion, require signatures and have no bypass', () => {
  for (const file of ['shared-branch-integrity.json', 'alphacompute-org-shared-branch-integrity.json']) {
    const set = JSON.parse(fs.readFileSync(path.join(root, 'scripts/owner/rulesets', file), 'utf8'));
    assert.deepEqual(set.rules.map(rule => rule.type).sort(), ['deletion', 'non_fast_forward', 'required_signatures'], file);
    assert.deepEqual(set.bypass_actors, [], file);
    assert.ok(set.conditions.ref_name.include.includes('~DEFAULT_BRANCH'), file);
    assert.notEqual(set.name, 'Main required checks', file);
  }
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'scripts/owner/rulesets/default-branch-baseline.json'), 'utf8'));
  assert.deepEqual(baseline.rules.map(rule => rule.type), ['pull_request']);
  assert.deepEqual(baseline.rules[0].parameters.allowed_merge_methods, ['squash']);
});

test('marker detection matches the recorded payload shape', () => {
  const files = ['init', '.env', '.vscode/tasks.json', 'android/x/reminders/public/fonts/fa-brand-400.orc', 'src/init.ts', 'docs/init'];
  assert.deepEqual(pathMarkers(files, iocs.markers), ['init', '.env', '.vscode/tasks.json', 'android/x/reminders/public/fonts/fa-brand-400.orc']);
  assert.deepEqual(initScripts(JSON.stringify({scripts: {build: 'node init && vite build', dev: 'node ./init', test: 'node --test', initdb: 'node scripts/initdb.mjs', x: 'node init-db.mjs'}}), iocs.markers), ['build', 'dev']);
  assert.deepEqual(contentMarkers('"runOptions": { "runOn": "folderOpen" }', iocs.markers).length, 1);
  assert.deepEqual(contentMarkers('const src = atob(process.env.AUTH_API_KEY); eval(proxyInfo);', iocs.markers).length, 2);
  assert.deepEqual(contentMarkers('export default {webDir: "web-dist"}', iocs.markers), []);
  assert.deepEqual(parseLsRemote('abc\trefs/heads/main\ndef\trefs/tags/v1\n123\trefs/tags/v1^{}\n'), [{sha: 'abc', ref: 'refs/heads/main'}, {sha: 'def', ref: 'refs/tags/v1'}]);
});

test('the branch scan flags a payload commit and its descendants without a checkout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forged-scan-'));
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test'}}).trim();
  try {
    run('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {build: 'vite build'}}));
    run('add', '.'); run('commit', '-q', '-m', 'clean');
    const clean = run('rev-parse', 'HEAD');
    // Inert stand-ins for the payload shape: no executable content.
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {build: 'node init && vite build'}}));
    fs.writeFileSync(path.join(dir, 'init'), '// inert test marker\n');
    fs.mkdirSync(path.join(dir, '.vscode'));
    fs.writeFileSync(path.join(dir, '.vscode/tasks.json'), '{"tasks":[{"runOptions":{"runOn":"folderOpen"}}]}');
    run('add', '.'); run('commit', '-q', '-m', 'forged');
    const forged = run('rev-parse', 'HEAD');
    run('rm', '-q', 'init', '.vscode/tasks.json');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {build: 'vite build'}}));
    run('add', '.'); run('commit', '-q', '-m', 'restore');
    const restored = run('rev-parse', 'HEAD');
    const scanned = sha => scanHead(dir, {ref: 'refs/heads/x', sha}, [forged], iocs.markers);
    assert.deepEqual(scanned(clean).findings, []);
    const hit = scanned(forged).findings;
    assert.ok(hit.includes(`reaches forged commit ${forged.slice(0, 9)}`));
    assert.ok(hit.includes('marker path init'));
    assert.ok(hit.includes('package.json script "build" runs init'));
    assert.ok(hit.some(line => line.startsWith('.vscode/tasks.json matches')));
    // A restore commit on top of a forged commit still reaches it: the tree is clean, the history is not.
    assert.deepEqual(scanned(restored).findings, [`reaches forged commit ${forged.slice(0, 9)}`]);
    assert.equal(scanHead(dir, {ref: 'refs/heads/y', sha: '0'.repeat(40)}, [], iocs.markers).scanned, false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
