// Packaging toolchain checks, not image or native speech qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ndkVersion = source => source.match(/\bndkVersion\s+['"]([^'"]+)['"]/)?.[1];
const version = ndkVersion(read('android/sense/build.gradle'));

test('Sense packaging selects the same explicit NDK as the pinned voice consumer', () => {
  const consumer = read('vendor/eliza/plugins/plugin-local-inference/native/android/consumer.gradle');
  assert.ok(version, 'an implicit AGP NDK can leave shared libraries unstripped');
  assert.equal(version, ndkVersion(consumer));
  assert.doesNotMatch(read('android/sense/build.gradle'), /keepDebugSymbols|doNotStrip/,
    'preserving raw STL bytes does not satisfy the recorded packaged-library contract');
});

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Android/Sdk');
const toolchain = path.join(sdk, 'ndk', version || 'missing', 'toolchains/llvm/prebuilt/linux-x86_64');
const strip = path.join(toolchain, 'bin/llvm-strip');
test('the selected NDK normal strip produces both recorded packaged STL libraries', {
  skip: fs.existsSync(strip) ? false : 'pinned Linux Android NDK not installed',
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sense-stl-contract-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const descriptor = JSON.parse(read('android/voice-host/qualified-voice-host.json'));
  const triples = {'arm64-v8a':'aarch64-linux-android', x86_64:'x86_64-linux-android'};
  for (const [abi, triple] of Object.entries(triples)) {
    const expected = descriptor.abis.find(entry => entry.abi === abi).libraries.find(entry => entry.name === 'libc++_shared.so');
    const raw = path.join(toolchain, 'sysroot/usr/lib', triple, expected.name);
    const output = path.join(dir, `${abi}.so`);
    execFileSync(strip, ['--strip-unneeded', '-o', output, raw], {timeout:30000});
    const bytes = fs.readFileSync(output);
    assert.equal(bytes.length, expected.bytes, `${abi} packaged size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${abi} packaged hash`);
    assert.notEqual(createHash('sha256').update(fs.readFileSync(raw)).digest('hex'), expected.sha256,
      `${abi}: silently copying the raw STL must fail descriptor admission`);
  }
});
