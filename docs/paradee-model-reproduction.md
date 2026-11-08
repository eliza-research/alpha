# Reproduce the pinned Paradee v1.1 model

The manual **Reproduce pinned Paradee model** workflow builds the model from the
exact Hugging Face inputs named by the pinned native fork. It runs the unchanged
upstream converter on macOS ARM64 with pinned Python dependencies and requires
`--check-output` to pass. It does not change the expected model hash.

The successful [reproduction run](https://github.com/eliza-research/alphaphone/actions/runs/39920314121)
used Eliza `f931082ebd87a0fecc3f11f8eacf58f598294d4a` and native fork
`6003a10368d8a6d5fb1f70fe9c63a70866e8bcff`. The result has 31,275,232 bytes and
SHA-256 `f205ab055f0120d571aa6fda2deadde1e6fbc88e8d8bd56a592917fd0e50892e`.
Local verification of the downloaded artifact confirmed both values; native
`test-paradee-api` and `test-paradee-phase-lock` passed with that exact model.
These are model reproducibility and host API checks, not Android audio acceptance.

Download the workflow artifact before its seven-day retention expires. Preserve
`result.json`, `conversion.log`, and the model together. Independently compare the
model size and hash with the current native fork's `tools/paradee/pins.json` before
using it as a model-cache input. A newer source pin requires a fresh reproduction;
this receipt does not qualify future converters or native libraries.

Linux conversion of these same inputs produced different hashes in the observed
CPU environments. A successful conversion without the expected hash is not an
admitted replacement. The helper records environment and source identities and
retains a failed converter's output for diagnosis; a failed run must not be used
as an accepted asset. Native libraries, complete voice-bundle staging, APK builds,
and physical speech qualification retain their existing independent gates.

Fresh current-pin Android engine and JNI builds also passed for ARM64 and x86_64.
Each passed 24 ABI checks on a Pixel or emulator with verified device library
hashes. See the [build and ABI receipt](evidence/paradee-reproduction-native-build-20261023.json).
The initial ARM64 probe omitted the shared-library search path and failed to load;
with the explicit test directory in `LD_LIBRARY_PATH`, the same library passed.
Real-model ASR cancellation was skipped; no application was installed or replaced.

A silent Pixel probe also generated 75,000 finite PCM samples at 24 kHz
(RMS 0.052109991) for a fixed public sentence using the exact model, current
ARM64 engine and pinned lexicon. No microphone or speaker was used. This proves
model loading and PCM generation only; intelligibility and app audio remain untested.
