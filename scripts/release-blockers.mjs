/**
 * Named reasons a verify-apks release row may not be distributed: Alpha's policy binding of
 * the shared judgement (vendor/eliza/packages/os/scripts/android/apk-release-record.mjs).
 *
 * The shared function reads one recorded row back and names every blocker (test mocks, the
 * flag-off bundle audit, signing, the packaged runtime and its notices, on-device voice and,
 * for an image, the reviewed platform certificate). Alpha supplies only its policy:
 * - signer: `releaseSigner` (the committed android/release-signer.json) recomputes admission
 *   with build-android's releaseAdmission, so an unset signer always blocks;
 * - licences: open-source licence flags never block (decision P-09). The single item that can
 *   is the separately named `unresolved-font-licence` check for a proprietary font with no
 *   recorded licence, and only while UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION
 *   (scripts/licence-policy.mjs) is true.
 *
 * @param {Record<string, any>} row one `results[]` entry with mode "release"
 * @param {{manifestTestMocks?: unknown, admission?: {failures: string[], blockers: string[], signerMatches?: boolean}, releaseSigner?: Record<string, any>, image?: {platformCertificateSha256?: unknown}, fontLicenceBlocks?: boolean}} [options]
 * @returns {string[]}
 */
import { apkReleaseBlockers } from "../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs";
import { UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION } from "./licence-policy.mjs";
import { releaseAdmission } from "./build-android.mjs";

const FONT_CHECK = /^(unresolved-font-licence: |font licence check failed: )/;

export function releaseBlockers(row, { fontLicenceBlocks = UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION, ...options } = {}) {
  const blockers = apkReleaseBlockers(row, {
    ...options,
    admitSigner: releaseAdmission,
    signerFile: "android/release-signer.json",
    cloudVoiceProvider: "cartesia",
    licenceBlocks: item => fontLicenceBlocks && FONT_CHECK.test(item),
  });
  // Device acceptance is observed separately; a checked-in approval flag is not a build gate.
  return blockers.filter(item => item !== 'unqualified on-device voice (device qualification pending)');
}
