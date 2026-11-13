// Packaging toolchain checks, not image or native speech qualification.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// The shared consumer may select its NDK inside a condition (`if (!assetsOnly) { ndkVersion '…' }`).
const ndkVersion = source => source.match(/^[^/\n]*\bndkVersion\s+['"]([^'"]+)['"]/m)?.[1];
const sharedSense = read('vendor/eliza/packages/app/platforms/android/sense/consumer.gradle');
const version = ndkVersion(sharedSense);

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
    execFileSync(strip, ['--strip-unneeded', '-o', output, raw], {timeout:scaledTimeout(30000)});
    const bytes = fs.readFileSync(output);
    assert.equal(bytes.length, expected.bytes, `${abi} packaged size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${abi} packaged hash`);
    assert.notEqual(createHash('sha256').update(fs.readFileSync(raw)).digest('hex'), expected.sha256,
      `${abi}: silently copying the raw STL must fail descriptor admission`);
  }
});
