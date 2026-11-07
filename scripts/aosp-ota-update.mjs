#!/usr/bin/env node
/**
 * Alpha Phone binding of the shared operator OTA update client
 * (vendor/eliza/packages/os/scripts/android/aosp-ota-update.mjs; issue #400). The channel
 * defaults to android/aosp/pixel10a-ota-channel.json and the stock recovery source lock to the
 * shared stallion inventory:
 *
 *   node scripts/aosp-ota-update.mjs check --from INSTALLED_RECORD --to CANDIDATE_RECORD
 *   node scripts/aosp-ota-update.mjs apply --serial S --from INSTALLED_RECORD --to CANDIDATE_RECORD \
 *     --ota OTA.zip --journal FILE [--execute --confirm-update]
 *   node scripts/aosp-ota-update.mjs status --serial S --journal FILE
 *   node scripts/aosp-ota-update.mjs fallback --serial S --journal FILE [--execute --confirm-fallback]
 *   node scripts/aosp-ota-update.mjs stock-archive --archive FACTORY.zip [--known-good DIR]
 *   node scripts/aosp-ota-update.mjs retain-known-good --record RECORD --signed-target-files ZIP \
 *     --signed-image IMAGE.zip --archive-dir NEW_DIR   (or scripts/aosp-retain-known-good.mjs)
 *   node scripts/aosp-ota-update.mjs verify-stock --serial S
 *
 * `apply` enters recovery with `adb reboot recovery`; the operator chooses "Apply update from
 * ADB" when asked (a user build's adbd cannot enter sideload itself). Results are observations
 * for the release owner's drill record; the channel's drills are recorded from executed
 * drills, never by this tool.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main} from '../vendor/eliza/packages/os/scripts/android/aosp-ota-update.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ALPHA_OTA_DEFAULTS = Object.freeze({
  channel: path.join(ROOT, 'android/aosp/pixel10a-ota-channel.json'),
  sourceLock: path.join(ROOT, 'vendor/eliza/packages/os/android/sources/pixel10a-stallion.json'),
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2), ALPHA_OTA_DEFAULTS);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
