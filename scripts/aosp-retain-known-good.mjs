#!/usr/bin/env node
/**
 * Retain a signed Alpha Phone Pixel 10a release as the channel's known-good recovery image
 * (issue #400). Alpha's binding of the shared `aosp-ota-update.mjs retain-known-good`
 * operator command; the channel defaults to android/aosp/pixel10a-ota-channel.json:
 *
 *   node scripts/aosp-retain-known-good.mjs --record RELEASE_RECORD.json \
 *     --signed-target-files SIGNED_TARGET_FILES.zip --signed-image IMAGE.zip --archive-dir NEW_DIR
 *
 * It verifies the compatibility record (scripts/aosp-release-record.mjs) against the channel,
 * refuses placeholders, test-keys or dev-keys builds and inputs whose bytes differ from the
 * record, then copies and hash-records them in a new read-only directory. `node
 * scripts/aosp-ota-update.mjs stock-archive --archive FACTORY.zip --known-good DIR` re-hashes
 * it and offers its reflash plan. Nothing here flashes a device or records a drill.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main} from '../vendor/eliza/packages/os/scripts/android/aosp-ota-update.mjs';
import {ALPHA_OTA_DEFAULTS} from './aosp-ota-update.mjs';

export const retainKnownGoodArgs = argv => ['retain-known-good', ...argv];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(retainKnownGoodArgs(process.argv.slice(2)), ALPHA_OTA_DEFAULTS);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
