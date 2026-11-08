# ARM64 embedding host requalification at eliza 4787d51a14, 2026-11-08

Pin `4787d51a142c63c98371c832997184c53f7218d3`, engine gitlink `6337fd4c4b`. This replaces the
`requalification.required` refusal in `android/embedding-host/qualified-host.json`.

## What was built

- `prepare-embedding-host.mjs` (without `--build`) staged the relocated native inputs and wrote
  [`PREPARATION.json`](PREPARATION.json). Only `stage-elizavoice-lib.ts` changed among the native
  inputs (reformatting); the JNI C++, CMake file and Java class are the reviewed bytes. The producer
  closure now includes `build-helpers/elizavoice-build-flags.ts`, which is why the old record was
  refused ("Embedding producer input qualification missing or changed").
- The JNI bridge was compiled with the two recorded `cmake` commands (NDK 28.2.13676358, CMake 4.4.4,
  Ninja, the same path remap rules as the c95a receipt). `libelizavoicejni.so` came out byte-identical
  to the previously reviewed bridge (`4244312b…`, 1,234,768 bytes).
- `libc++_shared.so` is the NDK 28.2 sysroot library after `llvm-strip --strip-unneeded`, equal to the
  reviewed bytes (`cd617628…`).
- `libelizainference.so` was **not** rebuilt here. It is the on-device voice engine `6337fd4c4b`
  recorded in `android/voice-host/qualified-voice-host.json` (`49b01a18…`, 10,018,448 bytes), because
  Gradle `:app:verifyParadeeAppLinkage` requires the app to package exactly that engine. It exports the
  three embedding symbols the host needs.

`build-embedding-host.mjs --candidate` was not used: it would rebuild a separate engine that cannot
equal the voice engine, and its `--remap-build-path` step refuses because
`embedding-build-remap.mjs` requires `docs/evidence/native-c95a/embedding-QUALIFICATION.json` to hash
to the superseded `qualificationReceiptSha256` (it hashes to `78d59843…`, the record named
`feaa7710…`). The receipt's `commandsNote` records this.

## What ran

The 58df embedding harness ([harness](harness)), as a separate package `ai.eliza.embeddingqualify`,
on the Pixel 10a (`67091JEA313850`, API 37, Alpha userdebug image). The APK carried the exact three
libraries (`keepDebugSymbols` so Gradle did not strip them; checked by unzipping) and the pinned BGE
model. Installed APK hashes were read back from the device. Result ([report](embedding-pixel.json),
[log](instrument.log)): `OK (1 test)`, two open/close rounds, 384 finite dimensions, repeat cosine
0.99999997, related 0.783 vs unrelated 0.268, Unicode distinct, NUL suffix tokenized. The vectors
are identical to the 58df qualification. Both temporary packages were uninstalled; the Alpha app was
not touched.

## Scope

ARM64 embedding component only. Not x86_64, not the installed Alpha app, not voice hardware, release
signing or user acceptance. [`QUALIFICATION.json`](QUALIFICATION.json) is the receipt staged with
`node scripts/stage-embedding-host.mjs --receipt docs/evidence/embedding-host-4787d51a14/QUALIFICATION.json`.

## Admission at 99b49439ce

Main moved to eliza `99b49439ce` before this was merged. There the engine gitlink and every
native build input equal `4787d51a14`; only the producer input `package.json` differs. The JNI
bridge was prepared and rebuilt at `99b49439ce` and gave the same bytes, so
[`QUALIFICATION-99b49439ce.json`](QUALIFICATION-99b49439ce.json) (with
[`PREPARATION-99b49439ce.json`](PREPARATION-99b49439ce.json)) names the same three libraries and the
same Pixel run; the device run was not repeated at that pin. `android/embedding-host/qualified-host.json`
was written from that receipt by `stage-embedding-host.mjs --receipt`.
