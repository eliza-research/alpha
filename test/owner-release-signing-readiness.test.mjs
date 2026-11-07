// Read-only release-signing readiness (issue #661). These tests check the draft CI signing workflow
// and the secret layout with throwaway --test-keys ceremonies only; they establish nothing about a
// real ceremony, an uploaded secret, a CI run, a signed APK or image, or a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  DRAFT, KEY_MANIFEST, SECRET_LIMIT_BYTES, draftProblems, expectedSecrets, jobBlocks, keySecretName, localReport, remoteReport,
} from '../scripts/owner/release-signing-readiness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, KEY_MANIFEST), 'utf8'));
const expected = expectedSecrets(manifest);
const draft = fs.readFileSync(path.join(root, DRAFT), 'utf8');
const vendorPresent = fs.existsSync(path.join(root, 'vendor/eliza/packages/os/scripts/android/decrypt-release-keys.ts'));

test('the expected secrets are one per manifest key plus the passphrase and the public bundle', () => {
  assert.equal(expected.all.length, manifest.keys.length + 2);
  assert.deepEqual(expected.apks, ['ALPHA_RELEASE_KEY_PASSPHRASE', 'ALPHA_RELEASE_PUBLIC_BUNDLE', 'ALPHA_RELEASE_KEY_ALPHAPHONE_APP']);
  assert.equal(expected.image.length, manifest.keys.length + 1, 'the image job reads every key but the application key');
  assert.ok(!expected.image.includes(keySecretName('alphaphone_app')));
  assert.equal(expected.files.ALPHA_RELEASE_KEY_AVB, 'avb.pem.enc');
  assert.equal(expected.files.ALPHA_RELEASE_KEY_PLATFORM, 'platform.pk8.enc');
});

test('the committed draft keeps every safety rule and is not enabled', () => {
  const report = localReport(root);
  assert.deepEqual(report.draft.problems, []);
  assert.deepEqual(report.enabledWorkflows, [], 'no workflow under .github/workflows may read a release secret before the owner enables it');
  assert.deepEqual(jobBlocks(draft).map(job => job.name), ['sign-apks', 'sign-image']);
});

test('each unsafe change to the draft is reported', () => {
  const cases = {
    'pull_request trigger': draft.replace('  workflow_dispatch:\n', '  pull_request:\n  workflow_dispatch:\n'),
    'no environment': draft.replace('    environment: release\n', ''),
    'write permission': draft.replace('    permissions:\n      contents: read\n', '    permissions:\n      contents: read\n      id-token: write\n'),
    'set -x': draft.replace('          set +x\n', '          set -x\n'),
    'echo a secret': draft.replace('          umask 077\n', '          umask 077\n          echo "$ALPHA_RELEASE_KEY_PASSPHRASE"\n'),
    'cat a key': draft.replace('          shred -u "$pass"\n', '          cat "$keys/alphaphone_app.pk8"\n          shred -u "$pass"\n'),
    'upload keys': draft.replace('            artifacts/launcher-release.apk\n', '            artifacts/launcher-release.apk\n            /dev/shm/alpha-release-keys\n'),
    'job-level secret': draft.replace('    timeout-minutes: 30\n', '    timeout-minutes: 30\n    env:\n      P: ${{ secrets.ALPHA_RELEASE_KEY_PASSPHRASE }}\n'),
    'unknown secret': draft.replace('${{ secrets.ALPHA_RELEASE_KEY_ALPHAPHONE_APP }}', '${{ secrets.ALPHA_RELEASE_KEY_ALPHAPHONE_APP }}${{ secrets.OTHER_TOKEN }}'),
    'unpinned action': draft.replace('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/setup-node@v7'),
    'third-party action': draft.replace('actions/setup-java@de7274f081f381c8f8158605e0321c36c376e2e6', 'someone/setup-java@de7274f081f381c8f8158605e0321c36c376e2e6'),
    'no wipe': draft.replace(/ {6}- name: Wipe key material\n {8}if: always\(\)\n/, '      - name: Wipe key material\n'),
    'any branch': draft.replace(/ {6}- name: Refuse anything but main\n.*\n/, ''),
    'persisted credentials': draft.replace('persist-credentials: false', 'persist-credentials: true'),
    'top-level permissions': draft.replace('permissions: {}\n', 'permissions:\n  contents: write\n'),
  };
  for (const [label, text] of Object.entries(cases)) {
    assert.notEqual(text, draft, `${label}: the mutation did not apply`);
    assert.ok(draftProblems(text, expected).length > 0, `${label} was not reported`);
  }
});

test('the remote view asks GET endpoints only and reports names, never values', () => {
  const asked = [];
  const responses = {
    'repos/o/r/environments/release': {ok: true, data: {can_admins_bypass: true, deployment_branch_policy: {custom_branch_policies: true}, protection_rules: [{type: 'required_reviewers', prevent_self_review: false, reviewers: [{reviewer: {login: 'owner'}}]}, {type: 'branch_policy'}]}},
    'repos/o/r/environments/release/deployment-branch-policies': {ok: true, data: {branch_policies: [{name: 'main', type: 'branch'}]}},
    'repos/o/r/environments/release/secrets?per_page=100': {ok: true, data: {secrets: [{name: 'ALPHA_RELEASE_KEY_PASSPHRASE', updated_at: 't'}, {name: 'ALPHA_RELEASE_KEY_OLD', updated_at: 't'}]}},
    'repos/o/r/actions/secrets?per_page=100': {ok: true, data: {secrets: [{name: 'ALPHA_RELEASE_KEY_AVB', updated_at: 't'}]}},
  };
  const report = remoteReport('o/r', expected.all, {get: endpoint => { asked.push(endpoint); return responses[endpoint] ?? {ok: false, status: 404, message: 'Not Found'}; }});
  assert.deepEqual(asked.sort(), Object.keys(responses).sort());
  assert.equal(report.missing.length, expected.all.length - 1);
  assert.deepEqual(report.unexpected, ['ALPHA_RELEASE_KEY_OLD']);
  assert.deepEqual(report.atRepositoryLevel, ['ALPHA_RELEASE_KEY_AVB']);
  assert.ok(report.notes.some(note => /can_admins_bypass/.test(note)));
  assert.ok(report.notes.some(note => /repository level/.test(note)));
  assert.ok(!JSON.stringify(report).includes('"value"'));
  const missingEnv = remoteReport('o/r', expected.all, {get: () => ({ok: false, status: 404, message: 'Not Found'})});
  assert.ok(missingEnv.notes.includes('environment release does not exist'));
});

/** The run block of one draft step, dedented, with the signing commands replaced by a listing. */
function stepScript(name) {
  const lines = draft.split('\n');
  const at = lines.findIndex(line => line === `      - name: ${name}`);
  assert.ok(at >= 0, `step ${name} not found`);
  const run = lines.findIndex((line, i) => i > at && line === '        run: |');
  const body = [];
  for (let i = run + 1; i < lines.length && (lines[i] === '' || lines[i].startsWith('          ')); i++) body.push(lines[i].slice(10));
  const out = [];
  let listed = false;
  for (let i = 0; i < body.length; i++) {
    if (!/node scripts\/sign-(aosp-release|release-apks)\.mjs/.test(body[i])) { out.push(body[i]); continue; }
    out.push(listed ? ':' : '(cd "$keys" && stat -c "%a %n" *) > "$RUNNER_TEMP/listing"');
    listed = true;
    while (body[i].trimEnd().endsWith('\\')) i++;
  }
  return out.join('\n');
}

function ceremony(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-signing-draft-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const pass = path.join(base, 'pass');
  fs.writeFileSync(pass, 'throwaway-test-only-passphrase-0123456789\n', {mode: 0o600});
  const out = path.join(base, 'ceremony');
  const made = spawnSync(process.execPath, ['vendor/eliza/packages/os/scripts/android/generate-release-keys.ts', '--manifest', KEY_MANIFEST, '--output', out, '--passphrase-file', pass, '--organization', 'Test Only', '--test-keys'], {cwd: root, encoding: 'utf8'});
  assert.equal(made.status, 0, made.stderr);
  return {base, out, passphrase: fs.readFileSync(pass, 'utf8').split('\n')[0]};
}

/** The secret values exactly as the runbook's upload commands produce them (base64, one line). */
function secretValues(dir, passphrase) {
  const publicFiles = fs.readdirSync(dir).filter(file => /\.(x509|pub)\.pem$|\.avbpubkey$|^avb_pkmd\.bin$|^fingerprints\.json$/.test(file)).sort();
  const tar = spawnSync('tar', ['-czf', '-', '--sort=name', '--owner=0', '--group=0', '--numeric-owner', ...publicFiles], {cwd: dir});
  assert.equal(tar.status, 0);
  const values = {ALPHA_RELEASE_KEY_PASSPHRASE: passphrase, ALPHA_RELEASE_PUBLIC_BUNDLE: tar.stdout.toString('base64')};
  for (const [secret, file] of Object.entries(expected.files)) values[secret] = fs.readFileSync(path.join(dir, file)).toString('base64');
  return values;
}

for (const [job, step, keys] of [
  ['apks', 'Decrypt the application key into tmpfs, sign, shred', ['alphaphone_app.pk8', 'alphaphone_app.x509.pem', 'fingerprints.json']],
  ['image', 'Decrypt the image keys into tmpfs, sign, shred', null],
]) {
  test(`the ${job} step rebuilds the ceremony layout from the secrets and leaves no key behind`, {skip: !vendorPresent && 'vendor/eliza is not checked out'}, t => {
    const {base, out, passphrase} = ceremony(t);
    const values = secretValues(out, passphrase);
    for (const [name, value] of Object.entries(values)) assert.ok(Buffer.byteLength(value) < SECRET_LIMIT_BYTES / 2, `${name} is far below the per-secret limit even before 4096-bit keys double it`);
    const shm = fs.existsSync('/dev/shm') ? fs.mkdtempSync('/dev/shm/alpha-draft-test-') : fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-draft-shm-'));
    t.after(() => fs.rmSync(shm, {recursive: true, force: true}));
    const runnerTemp = path.join(base, 'runner-temp');
    fs.mkdirSync(runnerTemp);
    const script = stepScript(step).replaceAll('/dev/shm/', `${shm}/`);
    const env = {PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: runnerTemp, TARGET_FILES_SHA256: 'a'.repeat(64)};
    for (const name of job === 'apks' ? expected.apks : expected.image) env[name] = values[name];
    const result = spawnSync('bash', ['-c', script], {cwd: root, env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const rows = fs.readFileSync(path.join(runnerTemp, 'listing'), 'utf8').trim().split('\n').map(line => line.split(' '));
    const listing = rows.map(([, file]) => file).sort();
    if (job === 'image') assert.deepEqual(rows.filter(([mode]) => mode !== '600'), [], 'the shared image signing job requires 0600 for every key directory file');
    if (keys) assert.deepEqual(listing, keys.sort());
    else {
      assert.equal(listing.filter(file => file.endsWith('.pk8')).length, 9);
      assert.deepEqual(listing.filter(file => /^[a-z_]+\.pem$/.test(file)).sort(), ['apex_payload.pem', 'avb.pem']);
      assert.ok(!listing.includes('alphaphone_app.pk8'), 'the image job never decrypts the application key');
    }
    assert.deepEqual(fs.readdirSync(shm), [], 'the step trap removes the decrypted keys and the passphrase file');
    assert.ok(!fs.existsSync(path.join(runnerTemp, 'release-keys-in')), 'the encrypted input copy is removed too');
    const output = result.stdout + result.stderr;
    for (const name of Object.keys(env).filter(name => name.startsWith('ALPHA_RELEASE_'))) assert.ok(!output.includes(env[name]), `${name} appeared in the step output`);
  });
}
