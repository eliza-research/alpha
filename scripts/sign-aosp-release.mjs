/**
 * Release-sign an alpha_stallion_phone target-files zip and build its OTA (issue #400).
 *
 * Alpha's binding of the shared Pixel 10a signing job
 * (vendor/eliza/packages/os/scripts/android/aosp-release-signing.mjs): it signs with
 * Alpha's release descriptor (android/aosp/pixel10a-product.json), its one update channel
 * (android/aosp/pixel10a-ota-channel.json) and its APK release signer
 * (android/release-signer.json). Runs on the Linux image host after the production image
 * build, with AOSP releasetools (otatools `bin/`) and a decrypted release key directory:
 *
 *   node scripts/sign-aosp-release.mjs \
 *     --target-files /abs/unsigned-target_files.zip --target-files-sha256 <hex from the build record> \
 *     --keys-dir /dev/shm/keys --releasetools /abs/otatools/bin --out /abs/new-release-dir \
 *     [--apksigner /abs/apksigner] [--map-key SOURCE=NAME ...] [--apk-manifest /abs/apk-manifest.json]
 *     [--incremental-from /abs/previous-signed-target_files.zip] [--dry-run]
 *     [--pkcs11-config /abs/sunpkcs11.cfg --avb-signing-helper /abs/helper
 *      --payload-signer /abs/signer [--payload-signer-arg ARG ...] --payload-signer-signature-size BYTES]
 *
 * The shared job reads only public certificates and AVB public key metadata, refuses any
 * UNSET or mismatching reviewed digest, and writes the version/hash compatibility record
 * (release-record.json). A signed output is not an image boot, an applied update, a rollback
 * or recovery drill, or release qualification. See docs/pixel10a-staging.md.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signingMain, signRelease as signShared } from "../vendor/eliza/packages/os/scripts/android/aosp-release-signing.mjs";
import { PIXEL10A_RELEASE } from "./aosp-pixel10a.mjs";

export { AVB_SIGNABLE_PARTITIONS, PKCS11_JAVA_ARGS, X509_KEYS, gitWorkTreeProblem, isWithin, parseSigningArgs, signingCommands } from "../vendor/eliza/packages/os/scripts/android/aosp-release-signing.mjs";
export { channelDistributionProblems, channelSigningProblems } from "../vendor/eliza/packages/os/scripts/android/pixel10a-release.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Sign Alpha's release; `root` defaults to this repository (tests pass a fixture copy). */
export function signRelease(options) {
  return signShared({ root: ROOT, ...options, ...PIXEL10A_RELEASE });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await signingMain(process.argv.slice(2), { root: ROOT, ...PIXEL10A_RELEASE });
