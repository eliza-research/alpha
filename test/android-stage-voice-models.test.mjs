import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stageAppEngines} from '../scripts/android-stage-voice-models.mjs';

// The app linkage check needs libelizainference.so in the app's jniLibs for every selected ABI.
// The embedding host supplies arm64-v8a; staging copies the other ABIs from the voice build record.
// Fixture bytes only: no real engine is read here.
const sha = value => createHash('sha256').update(value).digest('hex');
const appLib = abi => `android/app/src/main/jniLibs/${abi}/libelizainference.so`;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-app-engine-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const native = path.join(dir, '.eliza/paradee-voice/native');
  const files = [];
  for (const abi of ['arm64-v8a', 'x86_64']) {
    const relative = `jniLibs/${abi}/libelizainference.so`, content = `engine ${abi}`;
    fs.mkdirSync(path.dirname(path.join(native, relative)), {recursive: true});
    fs.writeFileSync(path.join(native, relative), content);
    files.push({path: relative, bytes: Buffer.byteLength(content), sha256: sha(content)});
  }
  fs.writeFileSync(path.join(native, 'build-record.json'), JSON.stringify({abis: ['arm64-v8a', 'x86_64'], files}));
  fs.mkdirSync(path.join(dir, 'android/embedding-host'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'android/embedding-host/qualified-host.json'), JSON.stringify({abi: 'arm64-v8a'}));
  return {dir, native, files};
}

test('staging writes the recorded x86_64 engine into the app jniLibs and never arm64-v8a', t => {
  const {dir, files} = fixture(t);
  assert.deepEqual(stageAppEngines(dir, {abis: ['arm64-v8a', 'x86_64']}), [appLib('x86_64')]);
  assert.equal(sha(fs.readFileSync(path.join(dir, appLib('x86_64')))), files.find(row => row.path.includes('x86_64')).sha256);
  assert.equal(fs.existsSync(path.join(dir, appLib('arm64-v8a'))), false, 'the qualified embedding host supplies arm64-v8a');
  // Staging again with the same bytes is a no-op; arm64-v8a alone stages nothing.
  assert.deepEqual(stageAppEngines(dir, {abis: ['arm64-v8a', 'x86_64']}), [appLib('x86_64')]);
  assert.deepEqual(stageAppEngines(dir, {abis: ['arm64-v8a']}), []);
});

test('staging refuses a voice output or an app library that does not match the record', t => {
  const {dir, native} = fixture(t);
  fs.writeFileSync(path.join(native, 'jniLibs/x86_64/libelizainference.so'), 'engine x86_64 changed');
  assert.throws(() => stageAppEngines(dir, {abis: ['x86_64']}), /does not match the voice build record/);
  assert.equal(fs.existsSync(path.join(dir, appLib('x86_64'))), false);

  const other = fixture(t);
  fs.mkdirSync(path.dirname(path.join(other.dir, appLib('x86_64'))), {recursive: true});
  fs.writeFileSync(path.join(other.dir, appLib('x86_64')), 'hand-copied engine');
  assert.throws(() => stageAppEngines(other.dir, {abis: ['x86_64']}), /already exists with other bytes/);
  assert.equal(fs.readFileSync(path.join(other.dir, appLib('x86_64')), 'utf8'), 'hand-copied engine');
});
