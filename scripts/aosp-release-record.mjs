/**
 * Version/hash compatibility record for one signed Alpha Phone Pixel 10a release (issue #400).
 *
 * Alpha's binding of the shared record generator
 * (vendor/eliza/packages/os/scripts/android/aosp-release-record.mjs). Run from the repository
 * root; --product defaults to android/aosp/pixel10a-product.json and --channel to its update
 * channel:
 *
 *   node scripts/aosp-release-record.mjs --signed-target-files ZIP --ota ZIP --out NEW_FILE
 *     [--product FILE] [--channel FILE] [--apk-manifest FILE] [--keys-dir DIR] [--incremental-from ZIP]
 *
 * It only reads archives; imageBooted, signedUpdateApplied, releaseQualified and
 * deviceAcceptanceVerified stay false in every record.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../vendor/eliza/packages/os/scripts/android/aosp-release-record.mjs";
import { PIXEL10A_PRODUCT } from "./aosp-pixel10a.mjs";

export { RECORD_KIND, compatibilityRecord, parseProperties } from "../vendor/eliza/packages/os/scripts/android/aosp-release-record.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2), { product: PIXEL10A_PRODUCT, root: process.cwd() });
