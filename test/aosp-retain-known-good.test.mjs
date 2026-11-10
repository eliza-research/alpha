import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALPHA_OTA_DEFAULTS} from '../scripts/aosp-ota-update.ts';
import {parseArgs} from '../vendor/eliza/packages/os/scripts/android/aosp-ota-update.mjs';

// Alpha binds the shared retain-known-good operator command to its Pixel 10a channel. Argument
// handling only: no release record, image or device is read here.
test('retain-known-good runs the shared command with the Alpha channel and every required input', () => {
  const args = ['retain-known-good', '--record', 'r.json', '--signed-target-files', 'tf.zip', '--signed-image', 'img.zip', '--archive-dir', 'kept'];
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['aosp:retain-known-good'], 'node scripts/aosp-ota-update.ts retain-known-good');
  assert.match(ALPHA_OTA_DEFAULTS.channel, /android\/aosp\/pixel10a-ota-channel\.json$/);
  const options = parseArgs([...args, '--channel', ALPHA_OTA_DEFAULTS.channel]);
  assert.equal(options.command, 'retain-known-good');
  assert.equal(options.archiveDir, 'kept');
  assert.throws(() => parseArgs(['retain-known-good', '--record', 'r.json']), /requires --channel|requires --signed-target-files/);
  assert.throws(() => parseArgs([...args, '--channel', 'c.json', '--execute']), /read-only/);
});
