/**
 * Whether verify-apks records one release APK as distributable. Side-effect free so the
 * predicate can be run by tests; verify-apks assigns `row.distributable` only through it.
 *
 * Every term must hold: signed by the committed release
 * signer with no admission blockers or failures, the resident runtime packaged
 * (`runtime` is the scripts/verify-packaged-runtime.py entry for this APK) with notices that
 * list it, a packaged on-device voice host with ASR, and no licence blockers.
 * If the verifier is given Cartesia evidence, it must also pass for this exact APK.
 *
 */
import { CLOUD_VOICE_CHECKS, type cloudVoiceAdmission } from "../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs";

type CartesiaAdmission = ReturnType<typeof cloudVoiceAdmission>;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** Cartesia qualifies a runtime route in Alpha's native build. The packaged
 * on-device route is checked separately and is required for the same APK. */
export function nativeCartesiaBlockers(apkSha256: string, voice?: CartesiaAdmission): string[] {
  if (!voice || !["cloud-voice-admission-v1", "alpha-cloud-voice-admission-v1"].includes(voice.format) ||
      !HEX_SHA256.test(voice.evidenceSha256 ?? "")) return ["Cloud voice qualification evidence is missing or invalid"];
  const problems: string[] = [];
  if (!HEX_SHA256.test(apkSha256) || voice.apkSha256 !== apkSha256)
    problems.push("Cloud voice evidence does not match this APK");
  if (voice.provider !== "cartesia") problems.push("Cloud voice evidence does not qualify Cartesia");
  if (voice.outcome !== "passed") problems.push("Cloud voice qualification did not pass");
  const missing = CLOUD_VOICE_CHECKS.filter(name => voice.checks?.[name] !== true);
  if (missing.length) problems.push(`Cloud voice checks are incomplete: ${missing.join(", ")}`);
  return problems;
}

interface ReleaseFacts {
  signed: unknown;
  releaseAdmission: {signerMatches?: unknown; blockers: readonly string[]; failures: readonly string[]};
  runtime: {distributable?: unknown};
  runtimeNotices: unknown;
  voiceHost: {packaged?: unknown; asr?: unknown; qualified?: unknown};
  licenceBlockers: readonly string[];
  cartesia?: {apkSha256: string; admission: CartesiaAdmission};
}

export function releaseDistributable({ signed, releaseAdmission, runtime, runtimeNotices, voiceHost, licenceBlockers, cartesia }: ReleaseFacts): boolean {
  return signed === true && releaseAdmission.signerMatches === true &&
    releaseAdmission.blockers.length === 0 && releaseAdmission.failures.length === 0 &&
    runtime.distributable === true && runtimeNotices === true &&
    voiceHost.packaged === true && voiceHost.asr === true &&
    licenceBlockers.length === 0 &&
    (cartesia === undefined || nativeCartesiaBlockers(cartesia.apkSha256, cartesia.admission).length === 0);
}
