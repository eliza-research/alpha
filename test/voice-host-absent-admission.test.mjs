/** Unexecuted source proposal: metadata-only admission controls, never voice qualification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {verifyVoiceHost} from '../scripts/voice-host.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('../android/voice-host/qualified-voice-host.json', import.meta.url), 'utf8'));
const asrSlot = fs.readFileSync(new URL('../android/paradee-voice/asr-inputs.json', import.meta.url));
function fixture(t, {stale = false, invalid = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-voice-absence-control-'));
  // Only synthetic directories created by this test are removed if tests are later admitted.
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, value);
  };
  const record = {...baseline, qualified: false, evidence: {deviceExecuted: false, emulatorDeviceExecuted: false, userAccepted: false, scope: 'Synthetic schema control only; no executed voice evidence'}};
  write('upstream.lock.json', JSON.stringify({commit: stale ? 'f'.repeat(40) : record.pin}));
  write('app.config.json', JSON.stringify({appId: record.identity}));
  write('android/paradee-voice/asr-inputs.json', asrSlot);
  write('android/voice-host/qualified-voice-host.json', invalid ? 'invalid record must not be consumed in the explicit absent lane' : JSON.stringify(record));
  return {root, write, stage: () => fs.mkdirSync(path.join(root, '.eliza/paradee-voice/native'), {recursive: true})};
}

test('explicit allow + genuinely absent staging does not consume even an invalid record', t => {
  const f = fixture(t, {invalid: true});
  let runtimeCalls = 0;
  assert.deepEqual(verifyVoiceHost(f.root, {allowAbsentRuntime: true, runtime() {runtimeCalls++; throw Error('must not run');}}), {status: 'not-packaged', qualified: false});
  assert.equal(runtimeCalls, 0);
});

test('explicit allow + absent staging does not transfer a stale record', t => {
  const f = fixture(t, {stale: true});
  assert.deepEqual(verifyVoiceHost(f.root, {allowAbsentRuntime: true}), {status: 'not-packaged', qualified: false});
});

test('default/required mode retains stale-current-pin refusal even if staging is absent', t => {
  const f = fixture(t, {stale: true});
  assert.throws(() => verifyVoiceHost(f.root), /records pin .*upstream.lock.json pins/);
});

test('a truthy non-boolean value is not explicit absent-runtime authority', t => {
  const f = fixture(t, {stale: true});
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: 'false'}), /records pin .*upstream.lock.json pins/);
});

test('default/required mode does not skip schema parsing', t => {
  const f = fixture(t, {invalid: true});
  assert.throws(() => verifyVoiceHost(f.root), SyntaxError);
});

test('present staging retains stale-current-pin refusal despite explicit allow', t => {
  const f = fixture(t, {stale: true});
  f.stage();
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /records pin .*upstream.lock.json pins/);
});

test('empty/partial native staging still reaches the real strict build-record gate', t => {
  const f = fixture(t);
  f.stage();
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Paradee native build record is missing/);
});

test('orphaned staging-owner files cannot be admitted as absent', t => {
  const f = fixture(t);
  f.write('.eliza/paradee-voice/build-record.json', '{}');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Partial or unknown voice staging/);
});

test('an unknown staging-owner sibling is refused even when native is present', t => {
  const f = fixture(t);
  f.stage();
  f.write('.eliza/paradee-voice/unknown-output', 'unqualified');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Partial or unknown voice staging/);
});

test('a dangling native staging link is not absence', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.eliza/paradee-voice'), {recursive: true});
  fs.symlinkSync('missing-native', path.join(f.root, '.eliza/paradee-voice/native'));
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Voice staging contains a link/);
});

test('a linked staging parent is not absence', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'owned-empty'));
  fs.symlinkSync('owned-empty', path.join(f.root, '.eliza'));
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Voice staging contains a link/);
});

test('raw/default Gradle speech assets are unknown staging, not absent', t => {
  const f = fixture(t);
  f.write('android/local-speech/src/main/assets/paradee-voice/v1/manifest.json', '{}');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Unrecognized voice staging/);
});

test('raw voice JNI presence is refused independently of a voice record', t => {
  const f = fixture(t, {invalid: true});
  f.write('android/app/src/main/jniLibs/x86_64/libparadeevoicejni.so', 'not an admitted library');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Unrecorded voice JNI payload/);
});

test('ABI input validation still precedes an explicit absent result', t => {
  const f = fixture(t, {invalid: true});
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true, abis: ['unrecognized']}));
});

test('ordinary local-speech release asset overlay is not absent', t => {
  const f = fixture(t, {invalid: true});
  f.write('android/local-speech/src/release/assets/paradee-voice/v1/manifest.json', '{}');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Unrecognized voice staging in a speech source-set overlay/);
});

test('ordinary local-speech debug JNI overlay is not absent', t => {
  const f = fixture(t, {invalid: true});
  f.write('android/local-speech/src/debug/jniLibs/x86_64/libparadeevoicejni.so', 'unqualified presence');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Unrecognized voice staging in a speech source-set overlay/);
});

test('standalone release flavor/build-type voice asset overlay is not absent', t => {
  const f = fixture(t, {invalid: true});
  f.write('android/app/src/standaloneRelease/assets/paradee-voice/v1/manifest.json', '{}');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Unrecognized voice staging in an application source-set overlay/);
});

test('launcher debug flavor/build-type voice JNI overlay is not absent', t => {
  const f = fixture(t, {invalid: true});
  f.write('android/app/src/launcherDebug/jniLibs/arm64-v8a/libparadeevoicejni.so', 'unqualified presence');
  assert.throws(() => verifyVoiceHost(f.root, {allowAbsentRuntime: true}), /Unrecorded voice JNI payload/);
});
