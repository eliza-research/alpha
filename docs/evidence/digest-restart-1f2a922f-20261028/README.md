# Digest process recovery at the 1f2a922f pin (2026-10-28)

Evidence class: **host runtime only.** A synthetic model inside the pinned upstream runtime on a
Linux development host. This is not Android, emulator, AOSP image, real-inference, real-account or
device evidence, and it does not prove anything about the APK.

## Inputs

- Upstream commit: `1f2a922f86e2a1f3d6cd62e097145492bd49ebfc` (`upstream.lock.json`
  sha256 `cabc4af4915eb5381dc7b9912dd1b8fd9e899ed3a70c095624523c882f550a72`).
- Check: `scripts/test-local-digest-restart.mjs`
  (sha256 `c647258d20d51899873eae38dad2d5ba696a88bb4ae44b976eb54134d38e660b`), unchanged.
- Prepared source: `ALPHA_RUNTIME_GIT_CACHE="$PWD/vendor/eliza" npm run agent:prepare`, which
  verified the prepared checkout against the pin before and after the run and installed it with
  `bun install --frozen-lockfile` (Bun 1.3.14).
- Run: `npm run agent:test-digest-restart` with `TMPDIR` set to a session scratch directory.
  Exit 0.

## Result

`result.json` is the check's own summary. In order, the four isolated runtimes showed:

1. **admit**: a scheduled hosted digest entered synthetic inference and the fixture's whole
   process group was killed with SIGKILL (`crashDuringInference`).
2. **recover**: a new process read the same run as `outcome-unknown`, unfinished, with no result
   entry; two concurrent repeated admissions returned that same run (`recovered.json`). The model
   was not called again (`unknownOutcomeNotReplayed`, `noFabricatedResult`).
3. **overdue**: a loop whose occurrence was a day overdue, consumed by the real trigger worker,
   produced exactly one `missed` record without inference and moved its schedule to the future
   (`overdue-result.json`).
4. **overdue-restart**: a fourth runtime read the same missed receipt and the same future
   `nextRunAtMs`; repeated admissions returned the same finished run (`overdue-restart-result.json`).

`model-calls.jsonl` shows one model attempt in total, all in the admit phase. This is the P-10
missed-once, no-replay policy at the current pin.

The per-phase logs and PGlite database stayed in the temporary directory and were deleted; the
overdue-restart log contained only the expected shutdown-time `CHARACTER_MANAGEMENT` start
cancellation from cleanup.
