// The Android preflight refuses a branch whose upstream pin is older than (or diverged from) the
// pin on origin/main: lock and checkout can agree on an old pin, and the APK then runs an older
// agent against state a newer one already wrote on the device.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {checkoutProblems, mainPinProblem, mainPinStatus, strictBuildInputs} from '../scripts/android-build-preflight.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false'];

/**
 * A product repository with vendor/eliza history A - B - C and a branch A - D, checked out at
 * `pin`. `mainPin` (when given) is the lock committed on refs/remotes/origin/main.
 */
// These fixtures have no staged voice outputs; the voice host check is covered elsewhere.
const noVoiceCheck = () => ({status: 'not-packaged'});
function fixture(t, {pin = 'B', mainPin = 'B', shallow = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pin-guard-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (cwd, ...args) => execFileSync('git', [...IDENTITY, ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const source = path.join(root, 'upstream-source');
  fs.mkdirSync(source);
  git(source, 'init', '-q', '-b', 'develop');
  const commits = {};
  const commit = name => { fs.writeFileSync(path.join(source, 'README'), `${name}\n`); git(source, 'add', '.'); git(source, 'commit', '-q', '-m', name); commits[name] = git(source, 'rev-parse', 'HEAD'); };
  commit('A'); commit('B'); git(source, 'tag', 'b'); commit('C');
  git(source, 'checkout', '-q', '-b', 'side', commits.A); commit('D'); git(source, 'checkout', '-q', 'develop');

  const product = path.join(root, 'product');
  fs.mkdirSync(path.join(product, 'vendor'), {recursive: true});
  const upstream = path.join(product, 'vendor/eliza');
  if (shallow) {
    git(root, 'clone', '-q', '--depth', '1', '--branch', 'develop', `file://${source}`, upstream);
    git(upstream, 'fetch', '-q', '--depth', '1', 'origin', 'tag', 'b');
  } else git(root, 'clone', '-q', source, upstream);
  git(upstream, 'checkout', '-q', '--detach', commits[pin] ?? pin);

  git(product, 'init', '-q', '-b', 'work');
  fs.writeFileSync(path.join(product, '.gitignore'), 'vendor/\n');
  const lock = commitId => fs.writeFileSync(path.join(product, 'upstream.lock.json'), JSON.stringify({commit: commitId}));
  if (mainPin) {
    lock(commits[mainPin] ?? mainPin);
    git(product, 'add', '.'); git(product, 'commit', '-q', '-m', 'main');
    git(product, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  }
  lock(commits[pin] ?? pin);
  git(product, 'add', '.'); git(product, 'commit', '-q', '--allow-empty', '-m', 'branch');
  return {root: product, commits, pin: commits[pin] ?? pin};
}

test('a pin equal to or descending from main passes', t => {
  let f = fixture(t, {pin: 'B', mainPin: 'B'});
  assert.equal(mainPinStatus(f.root, f.pin).state, 'equal');
  assert.equal(mainPinProblem(f.root, f.pin), null);
  assert.deepEqual(checkoutProblems(f.root, {voiceHost: noVoiceCheck}), []);
  f = fixture(t, {pin: 'C', mainPin: 'B'});
  assert.deepEqual(mainPinStatus(f.root, f.pin), {state: 'descendant', mainPin: f.commits.B, ref: 'refs/remotes/origin/main'});
  assert.deepEqual(checkoutProblems(f.root, {voiceHost: noVoiceCheck}), []);
});

test('a consistent but older or diverged pin is refused', t => {
  for (const pin of ['B', 'D']) {
    const f = fixture(t, {pin, mainPin: 'C'});
    assert.equal(mainPinStatus(f.root, f.pin).state, 'older');
    const problems = checkoutProblems(f.root, {voiceHost: noVoiceCheck});
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`pins ${f.pin}, which is older than or diverged from the pin ${f.commits.C} on refs/remotes/origin/main`));
    assert.match(problems[0], /Run: git fetch origin && git rebase origin\/main .*git submodule update --init vendor\/eliza/);
  }
});

test('a main pin unknown to vendor/eliza asks for a fetch instead of passing', t => {
  const f = fixture(t, {pin: 'B', mainPin: 'e'.repeat(40)});
  assert.equal(mainPinStatus(f.root, f.pin).state, 'unknown');
  assert.match(mainPinProblem(f.root, f.pin), /The upstream pin e{40} on refs\/remotes\/origin\/main is not in vendor\/eliza.*Run: git -C vendor\/eliza fetch origin\./);
});

test('a shallow vendor/eliza that cannot decide asks to unshallow', t => {
  const f = fixture(t, {pin: 'C', mainPin: 'B', shallow: true});
  assert.equal(mainPinStatus(f.root, f.pin).state, 'shallow');
  assert.match(mainPinProblem(f.root, f.pin), /shallow clone.*Run: git -C vendor\/eliza fetch --unshallow origin\./);
});

test('without an origin/main ref (a CI pull-request clone) the comparison is skipped with a note', t => {
  const f = fixture(t, {pin: 'B', mainPin: null});
  assert.equal(mainPinStatus(f.root, f.pin).state, 'unavailable');
  const notes = [];
  assert.deepEqual(checkoutProblems(f.root, {voiceHost: noVoiceCheck, notes}), []);
  assert.match(notes[0], /No origin\/main ref in this clone/);
});

test('the inputs report marks the pinned checkout missing for an older pin', t => {
  const f = fixture(t, {pin: 'B', mainPin: 'C'});
  // The report needs the product's committed metadata beside the lock.
  for (const rel of ['android/voice-host/qualified-voice-host.json', 'android/embedding-host/qualified-host.json', 'android/embedding-host/build-toolchain.json', 'android/release-signer.json']) {
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), {recursive: true});
    fs.copyFileSync(path.join(ROOT, rel), path.join(f.root, rel));
  }
  const rows = strictBuildInputs(f.root, null, {env: {}, voiceHost: () => ({status: 'not-packaged'})});
  const row = rows.find(item => item.input === 'pinned upstream checkout');
  assert.equal(row.state, 'missing');
  assert.match(row.detail, /older than or diverged from the pin/);
  assert.match(row.action, /Rebase on origin\/main/);
});

test('the preflight entry point exits 2 for an older pin', t => {
  const f = fixture(t, {pin: 'B', mainPin: 'C'});
  for (const file of ['android-build-preflight.ts', 'voice-host.ts', 'stage-embedding-host.ts', 'build-embedding-host.ts', 'mobile-uuid-adapter.ts', 'android-abis.ts', 'embedding-native-contract.ts', 'paradee-runtime.ts', 'toolchain.ts', 'copy-file-clone.ts', 'core-state-patch.ts', 'build-policy-source.ts']) {
    fs.mkdirSync(path.join(f.root, 'scripts'), {recursive: true});
    fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(f.root, 'scripts', file));
  }
  fs.mkdirSync(path.join(f.root, 'android/voice-host'), {recursive: true});
  fs.copyFileSync(path.join(ROOT, 'android/voice-host/qualified-voice-host.json'), path.join(f.root, 'android/voice-host/qualified-voice-host.json'));
  const run = () => spawnSync(process.execPath, ['scripts/android-build-preflight.ts'], {cwd: f.root, encoding: 'utf8'});
  const result = run();
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Android build prerequisites are missing:\n  - upstream\.lock\.json pins .* older than or diverged/);
});
