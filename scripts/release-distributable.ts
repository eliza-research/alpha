/**
 * Whether verify-apks records one release APK as distributable. Side-effect free so the
 * predicate can be run by tests; verify-apks assigns `row.distributable` only through it.
 *
 * Every term must hold: a flag-off build (no test mocks), signed by the committed release
 * signer with no admission blockers or failures, the resident runtime packaged
 * (`runtime` is the scripts/verify-packaged-runtime.py entry for this APK) with notices that
 * list it, a packaged and qualified on-device voice host with ASR, and no licence blockers.
 *
 */
interface ReleaseFacts {
  testMocks: boolean;
  signed: unknown;
  releaseAdmission: {signerMatches?: unknown; blockers: readonly string[]; failures: readonly string[]};
  runtime: {distributable?: unknown};
  runtimeNotices: unknown;
  voiceHost: {packaged?: unknown; asr?: unknown; qualified?: unknown};
  licenceBlockers: readonly string[];
}

export function releaseDistributable({ testMocks, signed, releaseAdmission, runtime, runtimeNotices, voiceHost, licenceBlockers }: ReleaseFacts): boolean {
  return !testMocks && signed === true && releaseAdmission.signerMatches === true &&
    releaseAdmission.blockers.length === 0 && releaseAdmission.failures.length === 0 &&
    runtime.distributable === true && runtimeNotices === true &&
    voiceHost.packaged === true && voiceHost.asr === true && voiceHost.qualified === true &&
    licenceBlockers.length === 0;
}
