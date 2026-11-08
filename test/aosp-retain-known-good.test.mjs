import test from 'node:test';
import assert from 'node:assert/strict';
import {retainKnownGoodArgs} from '../scripts/aosp-retain-known-good.mjs';
import {ALPHA_OTA_DEFAULTS} from '../scripts/aosp-ota-update.mjs';
import {parseArgs} from '../vendor/eliza/packages/os/scripts/android/aosp-ota-update.mjs';

// Alpha binds the shared retain-known-good operator command to its Pixel 10a channel. Argument
// handling only: no release record, image or device is read here.
test('retain-known-good runs the shared command with the Alpha channel and every required input', () => {
  const args = ['--record', 'r.json', '--signed-target-files', 'tf.zip', '--signed-image', 'img.zip', '--archive-dir', 'kept'];
  assert.deepEqual(retainKnownGoodArgs(args), ['retain-known-good', ...args]);
  assert.match(ALPHA_OTA_DEFAULTS.channel, /android\/aosp\/pixel10a-ota-channel\.json$/);
  const options = parseArgs([...retainKnownGoodArgs(args), '--channel', ALPHA_OTA_DEFAULTS.channel]);
  assert.equal(options.command, 'retain-known-good');
  assert.equal(options.archiveDir, 'kept');
  assert.throws(() => parseArgs(retainKnownGoodArgs(['--record', 'r.json'])), /requires --channel|requires --signed-target-files/);
  assert.throws(() => parseArgs([...retainKnownGoodArgs(args), '--channel', 'c.json', '--execute']), /read-only/);
});
