// Offline: checks the committed audit snapshot and reviewed dispositions against package-lock.json.
// The network audit itself is `node scripts/dependency-audit.mjs` (docs/dependency-audit.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  checkDispositions, dependencyPaths, loadAndCheck, normalizeAudit, sha256, DISPOSITIONS, LOCK, MAX_EXCEPTION_DAYS, REFRESH, SNAPSHOT,
  bunLockPackages, checkResident, inRange, noticePackages, normalizeResident, residentBinding, RESIDENT_REFRESH, RESIDENT_SNAPSHOT, UPSTREAM_BUN_LOCK, UPSTREAM_LOCK,
} from '../scripts/dependency-audit.mjs';

const lockText = fs.readFileSync(LOCK, 'utf8');
const lock = JSON.parse(lockText);
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const dispositions = JSON.parse(fs.readFileSync(DISPOSITIONS, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const today = snapshot.auditedOn;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const check = (overrides = {}) => checkDispositions({snapshot, dispositions, lock, lockText, today, ...overrides});

test('the committed audit snapshot matches package-lock.json and every advisory path is dispositioned', () => {
  // Uses the real date: an exception past its reviewBy date fails here until it is re-reviewed.
  assert.deepEqual(loadAndCheck(), []);
  assert.equal(snapshot.lockSha256, sha256(lockText), `re-audit with: ${REFRESH}`);
  assert.equal(snapshot.counts.high + snapshot.counts.critical, 0, 'no high or critical advisory is carried as an exception');
});

test('a lockfile change makes the snapshot stale', () => {
  const problems = check({lockText: `${lockText}\n`});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /different package-lock\.json; re-audit with: node scripts\/dependency-audit\.mjs --write/);
});

test('an unrecorded high or critical advisory fails, as does a recorded advisory on a new path', () => {
  for (const severity of ['high', 'critical']) {
    const next = clone(snapshot);
    next.findings.push({
      package: 'left-pad', severity, direct: false, affectedRange: '*', via: ['left-pad'], fixAvailable: 'none',
      advisories: [{id: 'GHSA-xxxx-xxxx-xxxx', package: 'left-pad', severity, vulnerableRange: '*', title: 'synthetic', url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx'}],
      installed: [{location: 'node_modules/left-pad', version: '1.0.0', scope: 'production', paths: ['react > left-pad']}],
    });
    assert.ok(check({snapshot: next}).some(problem => problem.startsWith(`Unrecorded advisory: ${severity} GHSA-xxxx-xxxx-xxxx via left-pad`)), severity);
  }
  const moved = clone(snapshot);
  const uuid = moved.findings.find(finding => finding.package === 'uuid');
  uuid.installed[0].paths.push('react > uuid');
  uuid.installed[0].scope = 'production';
  const problems = check({snapshot: moved});
  assert.ok(problems.some(problem => problem.includes('reaches the tree through "react > uuid"')), problems.join('\n'));
  assert.ok(problems.some(problem => problem.includes('is a production dependency, but the exception was reviewed as dev-only')));
  const pulled = clone(snapshot);
  pulled.findings.push({...clone(uuid), package: 'other-consumer', installed: []});
  assert.ok(check({snapshot: pulled}).some(problem => problem.includes('via other-consumer is not among the packages reviewed')));
  const worse = clone(snapshot);
  for (const finding of worse.findings) for (const advisory of finding.advisories) advisory.severity = 'high';
  assert.ok(check({snapshot: worse}).some(problem => problem.includes('severity rose from the reviewed moderate to high')));
});

test('exceptions are time-bounded, justified and removed once the advisory is gone', () => {
  const [exception] = dispositions.exceptions;
  assert.ok(check({today: exception.reviewBy}).length === 0, 'valid through the reviewBy date');
  assert.ok(check({today: '2099-01-01'}).some(problem => problem.includes(`expired on ${exception.reviewBy}`)));
  const unbounded = clone(dispositions);
  unbounded.exceptions[0].reviewBy = '2030-01-01';
  assert.ok(check({dispositions: unbounded}).some(problem => problem.includes(`within ${MAX_EXCEPTION_DAYS} days`)));
  const bare = clone(dispositions);
  delete bare.exceptions[0].justification;
  bare.exceptions[0].reachability = '';
  const problems = check({dispositions: bare});
  assert.ok(problems.some(problem => problem.endsWith('missing justification')) && problems.some(problem => problem.endsWith('missing reachability')));
  assert.ok(check({snapshot: {...snapshot, findings: []}}).some(problem => problem.includes(`stale exception ${exception.advisory}`)));
});

test('a recorded fix cannot regress in the lockfile', () => {
  const [fix] = dispositions.fixes;
  assert.equal(fix.package, 'source-map-js');
  assert.deepEqual(check(), []);
  const regressed = clone(lock);
  regressed.packages['node_modules/source-map-js'].version = fix.from;
  const regressedText = JSON.stringify(regressed);
  const problems = checkDispositions({snapshot: {...snapshot, lockSha256: sha256(regressedText)}, dispositions, lock: regressed, lockText: regressedText, today});
  assert.deepEqual(problems, [`fix ${fix.advisory} regressed: node_modules/source-map-js is ${fix.from}, below ${fix.fixedIn}`]);
});

test('npm audit output is normalised to advisory ids and exact dependency paths', () => {
  assert.deepEqual(dependencyPaths(lock, 'node_modules/xcode/node_modules/uuid'), ['@capacitor/cli > xcode > uuid']);
  assert.deepEqual(dependencyPaths(lock, 'node_modules/source-map-js'), [
    '@vitejs/plugin-react > vite > postcss > source-map-js',
    'jsdom > @asamuzakjp/dom-selector > css-tree > source-map-js',
    'jsdom > @bramus/specificity > css-tree > source-map-js',
    'jsdom > @csstools/css-syntax-patches-for-csstree > css-tree > source-map-js',
    'jsdom > css-tree > source-map-js',
    'vite > postcss > source-map-js',
  ]);
  const advisory = {source: 1, name: 'uuid', title: 't', url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq', severity: 'moderate', range: '<11.1.1'};
  const report = {vulnerabilities: {
    uuid: {name: 'uuid', severity: 'moderate', isDirect: false, via: [advisory], effects: ['xcode'], range: '<11.1.1', nodes: ['node_modules/xcode/node_modules/uuid'], fixAvailable: {name: '@capacitor/cli', version: '8.4.3', isSemVerMajor: true}},
    xcode: {name: 'xcode', severity: 'moderate', isDirect: false, via: ['uuid'], effects: [], range: '>=0.9.2', nodes: ['node_modules/xcode'], fixAvailable: true},
  }};
  const normalised = normalizeAudit(report, lock, lockText);
  assert.deepEqual(normalised.counts, {info: 0, low: 0, moderate: 2, high: 0, critical: 0});
  const xcode = normalised.findings.find(finding => finding.package === 'xcode');
  assert.deepEqual(xcode.advisories.map(row => row.id), ['GHSA-w5hq-g745-h8pq'], 'a transitive finding resolves to its root advisory');
  assert.deepEqual(xcode.installed, [{location: 'node_modules/xcode', version: lock.packages['node_modules/xcode'].version, scope: 'dev', paths: ['@capacitor/cli > xcode']}]);
  assert.equal(normalised.findings.find(finding => finding.package === 'uuid').fixAvailable, '@capacitor/cli@8.4.3 (outside the declared range)');
  // Re-normalising the committed snapshot's own inputs is stable: same lock, same hash.
  assert.equal(normalised.lockSha256, snapshot.lockSha256);
});

test('docs/dependency-audit.md records every disposition', () => {
  const docs = fs.readFileSync('docs/dependency-audit.md', 'utf8');
  for (const item of [...dispositions.fixes, ...dispositions.exceptions]) assert.ok(docs.includes(item.advisory), item.advisory);
  for (const item of dispositions.exceptions) {
    assert.ok(docs.includes(item.reviewBy), `${item.advisory} review date`);
    for (const chain of item.paths) assert.ok(docs.includes(chain), chain);
  }
  assert.ok(docs.includes('node scripts/dependency-audit.mjs'));
});

test('a network run fails on an advisory published after the snapshot (the scheduled audit comparison)', t => {
  // A fabricated `npm audit --json` report: the reviewed uuid chain plus one advisory nobody has seen.
  const reviewed = {source: 1, name: 'uuid', title: 'uuid buffer bounds', url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq', severity: 'moderate', range: '<11.1.1'};
  const report = {vulnerabilities: {
    uuid: {name: 'uuid', severity: 'moderate', isDirect: false, via: [reviewed], effects: ['xcode'], range: '<11.1.1', nodes: ['node_modules/xcode/node_modules/uuid'], fixAvailable: false},
    xcode: {name: 'xcode', severity: 'moderate', isDirect: false, via: ['uuid'], effects: ['@capacitor/cli'], range: '*', nodes: ['node_modules/xcode'], fixAvailable: false},
    '@capacitor/cli': {name: '@capacitor/cli', severity: 'moderate', isDirect: true, via: ['xcode'], effects: [], range: '*', nodes: ['node_modules/@capacitor/cli'], fixAvailable: false},
  }};
  const known = {...normalizeAudit(report, lock, lockText), auditedOn: today};
  assert.deepEqual(check({snapshot: known}), [], 'the reviewed advisory alone passes');
  const fresh = clone(report);
  fresh.vulnerabilities.react = {name: 'react', severity: 'high', isDirect: true, range: '*', nodes: ['node_modules/react'], fixAvailable: false,
    via: [{source: 2, name: 'react', title: 'synthetic', url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz', severity: 'high', range: '*'}]};
  const problems = check({snapshot: {...normalizeAudit(fresh, lock, lockText), auditedOn: today}});
  assert.ok(problems.some(problem => problem.startsWith('Unrecorded advisory: high GHSA-zzzz-zzzz-zzzz via react')), problems.join('\n'));
  // The CLI path the workflow takes exits non-zero for the same report (--from stands in for the registry).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-audit-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'audit.json');
  fs.writeFileSync(file, JSON.stringify(fresh));
  const run = spawnSync(process.execPath, ['scripts/dependency-audit.mjs', '--from', file], {encoding: 'utf8'});
  assert.equal(run.status, 1);
  assert.match(run.stderr, /FAIL Unrecorded advisory: high GHSA-zzzz-zzzz-zzzz via react/);
  fs.writeFileSync(file, JSON.stringify(report));
  assert.equal(spawnSync(process.execPath, ['scripts/dependency-audit.mjs', '--from', file], {encoding: 'utf8'}).status, 0);
});

test('the scheduled advisory workflow runs the network audit read-only and is not a required check', () => {
  const workflow = fs.readFileSync('.github/workflows/dependency-audit.yml', 'utf8');
  assert.match(workflow, /^on:\n  schedule:\n    - cron: '[^']+'\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /pull_request|push:/);
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /secrets\./);
  for (const [, ref] of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is pinned by commit`);
  assert.match(workflow, /run: node scripts\/dependency-audit\.mjs\n/);
  assert.match(workflow, /run: node scripts\/dependency-audit\.mjs --resident\n/);
});

// ---------------------------------------------------------------- resident runtime

test('the resident snapshot is bound to the pinned upstream commit and its lock', () => {
  const {commit, snapshot: resident, inputSha256} = residentBinding();
  assert.equal(commit, JSON.parse(fs.readFileSync(UPSTREAM_LOCK, 'utf8')).commit);
  assert.ok(resident, `audit the resident runtime with: ${RESIDENT_REFRESH}`);
  // Fails offline when upstream.lock.json moves without a refreshed resident snapshot.
  assert.equal(resident.upstreamCommit, commit, `re-audit with: ${RESIDENT_REFRESH}`);
  assert.equal(resident.input, UPSTREAM_BUN_LOCK);
  if (inputSha256) assert.equal(resident.inputSha256, inputSha256, `${UPSTREAM_BUN_LOCK} changed; re-audit with: ${RESIDENT_REFRESH}`);
  assert.equal(resident.findings.length, Object.values(resident.counts).reduce((a, b) => a + b, 0));
  const moved = checkResident({snapshot: resident, dispositions, commit: 'f'.repeat(40), inputSha256: resident.inputSha256, today});
  assert.ok(moved.some(problem => problem.includes(`pins ${'f'.repeat(40)}; re-audit with: ${RESIDENT_REFRESH}`)));
  assert.ok(checkResident({snapshot: resident, dispositions, commit, inputSha256: 'e'.repeat(64), today}).some(problem => problem.includes(`different ${UPSTREAM_BUN_LOCK}`)));
  assert.deepEqual(checkResident({snapshot: null, dispositions, commit, today}), [`${RESIDENT_SNAPSHOT} is missing; audit the resident runtime with: ${RESIDENT_REFRESH}`]);
});

test('resident dispositions are bound to the commit and must cover every resident advisory', () => {
  const commit = 'a'.repeat(40);
  const finding = (id, severity = 'high', name = 'undici') => ({package: name, versions: ['5.29.0'], severity, advisory: {id, severity, vulnerableRange: '<6.0.0', title: 't', url: `https://github.com/advisories/${id}`}});
  const resident = {upstreamCommit: commit, input: UPSTREAM_BUN_LOCK, inputSha256: 'b'.repeat(64), auditedOn: today, packages: 2, counts: {}, findings: [finding('GHSA-aaaa-aaaa-aaaa')]};
  const exception = {advisory: 'GHSA-aaaa-aaaa-aaaa', severity: 'high', packages: ['undici'], reachability: 'Not reached on device', justification: 'No upstream fix yet',
    removeWhen: 'upstream takes undici 6', reviewedBy: 'reviewer', reviewedOn: today, reviewBy: addDays(today, 30)};
  const reviewed = {resident: {upstreamCommit: commit, exceptions: [exception]}};
  assert.deepEqual(checkResident({snapshot: resident, dispositions: reviewed, commit, inputSha256: 'b'.repeat(64), today}), []);
  assert.ok(checkResident({snapshot: resident, dispositions: {resident: {...reviewed.resident, upstreamCommit: 'c'.repeat(40)}}, commit, today})
    .some(problem => problem.includes(`resident dispositions were reviewed at upstream ${'c'.repeat(40)}, not ${commit}`)));
  const added = {...resident, findings: [...resident.findings, finding('GHSA-bbbb-bbbb-bbbb', 'critical', 'axios')]};
  assert.ok(checkResident({snapshot: added, dispositions: reviewed, commit, today}).some(problem => problem.startsWith('Unrecorded resident advisory: critical GHSA-bbbb-bbbb-bbbb via axios@5.29.0')));
  assert.ok(checkResident({snapshot: resident, dispositions: reviewed, commit, today: '2099-01-01'}).some(problem => problem.includes('expired on')));
  assert.ok(checkResident({snapshot: {...resident, findings: []}, dispositions: reviewed, commit, today}).some(problem => problem.includes('stale resident exception')));
});

test('packaged resident audit checks shipped findings without invalidating absent lock-wide exceptions', () => {
  const commit = 'a'.repeat(40);
  const finding = {package: 'uuid', versions: ['8.3.2'], severity: 'moderate', advisory: {id: 'GHSA-aaaa-aaaa-aaaa'}};
  const snapshot = {upstreamCommit: commit, input: 'packaged-runtime notices', auditedOn: today, findings: [finding]};
  const shipped = {advisory: finding.advisory.id, packages: ['uuid'], severity: 'moderate', ships: true,
    reachability: 'Only v4 without caller-supplied buffer', justification: 'Reviewed shipped consumer call sites',
    removeWhen: 'Upstream updates uuid', reviewedBy: 'reviewer', reviewedOn: today, reviewBy: addDays(today, 30)};
  const absent = {...shipped, advisory: 'GHSA-bbbb-bbbb-bbbb', packages: ['undici'], ships: false};
  const check = (row = shipped, snap = snapshot, date = today) => checkResident({snapshot: snap,
    dispositions: {resident: {upstreamCommit: commit, exceptions: [row, absent]}}, commit, today: date});
  assert.deepEqual(check(), []);
  assert.ok(check(shipped, {...snapshot, input: UPSTREAM_BUN_LOCK}).some(p => p.includes('stale resident exception GHSA-bbbb')));
  assert.deepEqual(check(shipped, {...snapshot, findings: []}), []);
  assert.ok(check({...shipped, ships: false}).some(p => p.includes('lacks a reviewed shipped exception')));
  assert.ok(check({...shipped, packages: ['other']}).some(p => p.startsWith('Unrecorded resident advisory')));
  assert.ok(check({...shipped, severity: 'low'}).some(p => p.includes('severity rose')));
  assert.ok(check(shipped, snapshot, '2099-01-01').some(p => p.includes('expired on')));
  assert.ok(check({...shipped, reviewBy: 'invalid'}).some(p => p.includes('must be YYYY-MM-DD')));
  assert.ok(check({...shipped, reviewBy: addDays(today, MAX_EXCEPTION_DAYS + 30)}).some(p => p.includes('reviewBy must fall within')));
  for (const field of ['reachability', 'justification', 'removeWhen', 'reviewedBy']) {
    assert.ok(check({...shipped, [field]: ''}).some(p => p.includes(`missing ${field}`)));
  }
  for (const severity of ['high', 'critical']) {
    assert.ok(check({...shipped, severity}, {...snapshot, findings: [{...finding, severity}]}).some(p => p.includes('require an upstream fix')));
  }
  assert.ok(check(shipped, {...snapshot, upstreamCommit: 'c'.repeat(40)}).some(p => p.includes('but upstream.lock.json pins')));
});

test('the committed resident snapshot is dispositioned except the shipped advisories pending an upstream fix', () => {
  // Every resident problem must be an unrecorded advisory that the review listed under
  // resident.pendingUpstreamFixes (shipped, deliberately without an exception). A new advisory, a
  // stale or expired exception, or a binding problem fails here. Uses the real date.
  const {commit, snapshot: resident, inputSha256} = residentBinding();
  const pending = dispositions.resident?.pendingUpstreamFixes ?? [];
  const problems = checkResident({snapshot: resident, dispositions, commit, inputSha256, today: new Date().toISOString().slice(0, 10)});
  for (const problem of problems) {
    const match = /^Unrecorded resident advisory: \S+ (GHSA-[0-9a-z-]+) via (\S+)@/.exec(problem);
    assert.ok(match && pending.some(item => item.advisory === match[1] && item.package === match[2]), problem);
  }
  for (const item of pending) {
    assert.ok(resident.findings.some(finding => finding.advisory.id === item.advisory && finding.package === item.package), `pending fix ${item.advisory} is no longer reported; remove it`);
    assert.ok(!(dispositions.resident.exceptions ?? []).some(exception => exception.advisory === item.advisory), `${item.advisory} is both pending and excepted`);
    for (const field of ['reachability', 'plan']) assert.ok(typeof item[field] === 'string' && item[field].length > 20, `${item.advisory}: missing ${field}`);
  }
  // A shipped high or critical advisory is never carried as an exception: it stays pending until fixed.
  for (const exception of dispositions.resident.exceptions ?? [])
    assert.ok(!(exception.ships && ['high', 'critical'].includes(exception.severity)), `${exception.advisory} ships and is ${exception.severity}`);
});

test('resident input comes from the upstream Bun lock or packaged-runtime notices, and ranges match npm advisories', () => {
  const bunLock = `{\n  "lockfileVersion": 1,\n  "workspaces": {},\n  "packages": {\n    "undici": ["undici@5.29.0", "", {}, "sha512-x"],\n    "a/undici": ["undici@7.28.0", "", {}, "sha512-y"],\n    "@elizaos/core": ["@elizaos/core@workspace:packages/core"],\n    "@s/p": ["@s/p@1.0.0-beta.1", "", {}, "sha512-z"],\n  },\n}\n`;
  assert.deepEqual(bunLockPackages(bunLock), ['@s/p@1.0.0-beta.1', 'undici@5.29.0', 'undici@7.28.0']);
  assert.deepEqual(noticePackages([
    {name: 'zod', version: '4.1.0', text: 'Bundled in the on-device agent bundle.\n\nMIT'},
    {name: 'react', version: '19.3.0', text: 'MIT'},
    {name: 'Bun JavaScript runtime (libeliza_bun.so)', version: '1.4.2 (oven-sh/bun b)', text: 'Bundled in the on-device agent bundle.'},
  ]), ['zod@4.1.0']);
  for (const [version, range, expected] of [['5.29.0', '<5.29.1', true], ['5.29.1', '<5.29.1', false], ['7.28.0', '>=7.0.0 <7.30.0 || >=8.0.0 <8.2.0', true],
    ['8.10.0', '>=7.0.0 <7.30.0 || >=8.0.0 <8.2.0', false], ['1.0.0', '*', true], ['2.0.0', '<=2.0.0', true], ['2.0.1', '=2.0.0', false],
    ['1.5.0', '>= 1.2.0 < 1.6.0', true], ['1.6.0', '>= 1.2.0 < 1.6.0', false], ['1.5.0', '1.0.0 - 2.0.0', true], ['2.0.1', '1.0.0 - 2.0.0', false],
    // A prerelease of a fixed version is still before the fix.
    ['1.6.0-beta.1', '<1.6.0', true], ['1.6.0-beta.1', '>=1.6.0', false], ['1.6.1-rc.0', '<1.6.0', false],
    // An unreadable comparator is shown for review rather than dropped.
    ['1.0.0', '<unknown', true]])
    assert.equal(inRange(version, range), expected, `${version} ${range}`);
  const normalized = normalizeResident({undici: [{id: 1, url: 'https://github.com/advisories/GHSA-aaaa-aaaa-aaaa', title: 't', severity: 'high', vulnerable_versions: '<6.0.0'}]}, ['undici@5.29.0', 'undici@7.28.0']);
  assert.deepEqual(normalized.findings.map(row => [row.package, row.versions, row.advisory.id]), [['undici', ['5.29.0'], 'GHSA-aaaa-aaaa-aaaa']]);
  assert.equal(normalized.counts.high, 1);
  assert.equal(normalized.inputSha256, sha256('undici@5.29.0\nundici@7.28.0'));
});
