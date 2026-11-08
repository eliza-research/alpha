import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {prepareListenerSystemui, verifyListenerSystemui} from '../scripts/aosp-listener-systemui.mjs';
const directory = 'vendor/eliza/packages/os/android/sense/systemui';
const manifest = JSON.parse(fs.readFileSync(`${directory}/manifest.json`));
const patch = fs.readFileSync(`${directory}/microphone-ops.patch`, 'utf8');

test('reviewed SystemUI patch binds the baseline and adds both recording ops to all three lists', () => {
  const sha = input => createHash('sha256').update(input).digest('hex');
  assert.equal(sha(patch), manifest.patchSha256);
  assert.equal(sha(fs.readFileSync('vendor/eliza/packages/os/android/sources/pixel10a-stallion.json')), manifest.baselineLockSha256);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.lockAodIndicatorQualified, false);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemui-context-'));
  try {
    // Reconstruct every original hunk in place, retaining untouched gaps. This exercises git's
    // actual patch application, not an implementation-shaped string replacement.
    let target, lines;
    const flush = () => { if (target) { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, lines.join('\n') + '\n'); } };
    let position = 0;
    for (const line of patch.split('\n')) {
      if (line.startsWith('--- a/')) { flush(); target = path.join(temp, line.slice(6)); lines = []; }
      else if (line.startsWith('@@')) { position = Number(line.match(/^@@ -(\d+)/)[1]) - 1; while (lines.length < position) lines.push('// unchanged'); }
      else if (line.startsWith(' ') || (line.startsWith('-') && !line.startsWith('---'))) lines[position++] = line.slice(1);
    }
    flush();
    execFileSync('git', ['apply', '--whitespace=error', path.resolve(directory, 'microphone-ops.patch')], {cwd: temp});
    const controller = fs.readFileSync(path.join(temp, manifest.files[0].path), 'utf8');
    const monitor = fs.readFileSync(path.join(temp, manifest.files[1].path), 'utf8');
    for (const op of ['OP_RECORD_AUDIO_HOTWORD', 'OP_RECORD_AUDIO_SANDBOXED']) {
      assert.equal(controller.split(op).length - 1, 1);
      assert.equal(monitor.split(op).length - 1, 2);
    }
    assert.match(monitor, /OP_RECORD_AUDIO_SANDBOXED,\n\s+AppOpsManager.OP_RECORD_AUDIO -> PrivacyType.TYPE_MICROPHONE/);
    assert.match(controller, /OP_PHONE_CALL_MICROPHONE/);
    assert.match(monitor, /OP_PHONE_CALL_CAMERA/);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

test('exact pinned source produces a verified overlay and rejects postimage mutation', {skip: !process.env.ALPHA_SYSTEMUI_TEST_SOURCE}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemui-exact-'));
  try {
    const output = path.join(temp, 'overlay');
    const receipt = prepareListenerSystemui(process.env.ALPHA_SYSTEMUI_TEST_SOURCE, output);
    assert.equal(receipt.state, 'after');
    assert.equal(receipt.fullTreeVerified, false);
    assert.throws(() => prepareListenerSystemui(process.env.ALPHA_SYSTEMUI_TEST_SOURCE, output), /must not exist/);
    assert.throws(() => prepareListenerSystemui(output, path.join(output, 'nested')), /outside the supplied/);
    assert.throws(() => verifyListenerSystemui(output, 'before'), /image mismatch/);
    fs.appendFileSync(path.join(output, 'frameworks/base', manifest.files[0].path), '\n// mutation\n');
    assert.throws(() => verifyListenerSystemui(output, 'after'), /image mismatch/);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
