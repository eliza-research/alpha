# Current-pin embedding execution candidate

This is limited synthetic execution evidence, not an embedding-host qualification
or a packaged-product receipt. `android/embedding-host/qualified-host.json` remains
unchanged and rejects its historical engine at the current pin. No provider, model,
runtime policy or release gate changes.

The engine bytes are the exact CPU builds retained with the voice candidate at
Eliza `968348d792d3d36df129bc53bd85cebed47d0830` and native fork
`3e5f73922ee804806a2e955b50843a5042e6e401`. They were not rebuilt for this test.
The pinned full JNI bridge was built separately with NDK 28.2, Release, Android
API 23, for ARM64 and x86_64. Its supported class parameter binds it to
`ai/alphacompute/alphaphone/ElizaVoiceNative`. The pinned Java loader and environment
helper only have the product package substitution. The synthetic harness supplies
BuildConfig (`auto`, one ASR thread), uses the full native method table, and does
not call ASR. Source/generated hashes, exact CMake commands, header authentication,
ELF inspection, engine/JNI/model/APK hashes and results are in `candidate.json`.
Build paths were not remapped; these JNI bytes are not claimed path-independent.

The separate `ai.alphacompute.embeddingqualifier` APK requests no permissions,
contains the existing hash-verified BGE-small-en-v1.5 F16 model, and runs an
Instrumentation class against itself. It executes five embedding calls in each of
two fresh contexts: repeated identical sentences, related/unrelated sentences,
and UTF-8 text. It checks 384 finite dimensions, unit normalization, repeat and
reopen consistency, and a higher cosine for the related sentence. The harness is
included for review; exact APKs, source/support files, execution and cleanup logs
are retained in the stable archive named in the candidate record.

| Execution | Result | Related / unrelated cosine | Five-call round including context/model load |
| --- | --- | --- | --- |
| Reserved Cuttlefish, x86_64, API 37 | Passed, two contexts | 0.786291 / 0.377098 | 120.15 ms / 110.08 ms |
| Pixel 10a, ARM64, API 37 | Passed, two contexts | 0.786336 / 0.376970 | 10,318.79 ms / 10,161.91 ms |

These timings include JNI calls and context/model loading, have no warmup or
controlled device-load protocol, and are not a throughput or latency acceptance
result. The large ABI/device difference is retained, not normalized away.

Before physical execution the test package was absent and no concurrent
instrumentation test was visible. Both test installations were removed after the
runs, with successful uninstall and package absence recorded. No microphone,
speaker, network, provider, HOME role, product package, reboot or personal data was
used or changed. The test reads fixed public sentences and its bundled model only.

The archive is `/home/shaw/Android/alpha-qualification/2026-10-15-embedding-968348`.
It retains 30 files with verified sizes and SHA-256 values; its large binaries are
not committed. Both APKs also retain the exact model and engine bytes. The engine
build records remain in the preceding `2026-10-15-native-968348` archive.

Still missing: a reviewed current embedding qualification receipt, unified engine
identity with the admitted voice host, full resident embedding/retrieval integration,
semantic corpus evaluation, cancellation behavior and controlled performance
qualification. Synthetic embedding success does not establish speech qualification,
AOSP image acceptance, a complete packaged runtime or user acceptance.
