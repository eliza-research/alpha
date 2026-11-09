import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stageVoiceModels} from '../scripts/android-stage-voice-models.mjs';
import {fixtureProduct} from './fixtures/voice-host-product.mjs';

// The current stager publishes verified engine/STL libraries for the selected ABI.
// Fixture bytes only: no real engine, model or embedding host is used here.
const sha = value => createHash('sha256').update(value).digest('hex');
const native = '.eliza/paradee-voice/native';
const host = 'android/app/src/main/jniLibs';
const engine = 'libelizainference.so';

test('staging publishes recorded x86_64 voice libraries only when x86_64 is selected', t => {
  const {dir, from, record} = fixtureProduct(t);
  const options = {from: [from], abis: ['x86_64']};
  const result = stageVoiceModels(dir, options);
  const libraries = record.abis.find(row => row.abi === 'x86_64').libraries;
  assert.deepEqual(result.staged.filter(file => file.startsWith('jniLibs/')), [`jniLibs/x86_64/${engine}`]);
  for (const library of libraries) {
    const bytes = fs.readFileSync(path.join(dir, host, 'x86_64', library.name));
    assert.equal(bytes.length, library.bytes);
    assert.equal(sha(bytes), library.sha256);
  }
  assert.equal(fs.existsSync(path.join(dir, host, 'arm64-v8a')), false);
  assert.equal(fs.existsSync(path.join(dir, native, 'jniLibs/arm64-v8a')), false);
  const build = JSON.parse(fs.readFileSync(path.join(dir, native, 'build-record.json'), 'utf8'));
  assert.deepEqual(build.abis, ['x86_64']);
  assert.deepEqual(stageVoiceModels(dir, options), result, 'same recorded output is idempotent');
});

test('staging refuses a changed voice output or conflicting app library before publication', t => {
  const changed = fixtureProduct(t);
  const relative = `jniLibs/x86_64/${engine}`;
  fs.writeFileSync(path.join(changed.from, relative), 'engine x86_64 changed');
  assert.throws(() => stageVoiceModels(changed.dir, {from: [changed.from], abis: ['x86_64']}), /does not match the pinned libelizainference\.so/);
  assert.equal(fs.existsSync(path.join(changed.dir, native)), false);
  assert.equal(fs.existsSync(path.join(changed.dir, host, 'x86_64', engine)), false);

  const other = fixtureProduct(t);
  const target = path.join(other.dir, host, 'x86_64', engine);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, 'hand-copied engine');
  assert.throws(() => stageVoiceModels(other.dir, {from: [other.from], abis: ['x86_64']}), /already exists with other bytes/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'hand-copied engine');
  assert.equal(fs.existsSync(path.join(other.dir, native)), false);
});
