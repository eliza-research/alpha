# On-device speech: measurements and decisions, 2026-11-05

Device: Pixel 10a `stallion`, `ro.soc.model` Tensor G4, Alpha userdebug image. Engine
`b3eb2bf63b`, measured at Eliza pin `36236fc059`; the pin is now `5d1af326e5` with byte-identical engines. Raw results are under
[evidence](evidence/on-device-speech-2026-11-05). Everything here is development evidence from
a dirty tree and a debug APK: not release, AOSP image or user acceptance.

## Status

- Local speech is the default in the `native` profile, which is also the default build profile.
  Cartesia came from the explicit `cloud` QA profile (October 18 override). The phone now runs a
  `native` developer APK: Settings shows Speech "On this device", AI "Eliza Cloud", and the Cloud
  sign-in and plan survived the in-place update from the `cloud` build.
- Passed with networking off (`Active default network: none`): `LocalSpeechInstrumentedTest` and
  `LocalSpeechBridgeInstrumentedTest`, on real human speech through the Capacitor bridge.
- `SpeechNoNetworkInstrumentedTest` was skipped, not passed: other app traffic meant egress could
  not be attributed.
- A native build refuses Cloud speech: `synthesize` and `transcribeRecording` reject on the device,
  and `CloudSpeechPolicy.host` throws for any non-`cloud` profile.
- Complete spoken turns ran on v32: speech from a laptop speaker reached the physical microphone,
  Phonon-2 transcribed it in the app, the Cloud language model replied and Paradee spoke. These used
  synthetic speech at a distance ("That is two plus two." for "What is two plus two?"), so they prove
  the path, not recognition accuracy for a person.
- **Those turns used the recorded-clip fallback, not the live route.** The latency table below
  describes the live pipeline, which real turns do not yet take (see Live route).
- Not done: the live route in a distributable build, an AOSP image with this APK, and the embedding and voice qualification
  records (`qualified` stays false).

## Live route

Real turns use the recorded-clip fallback unless `nativeLiveVoiceReady` passes. Four defects block it.
Findings below come from values returned by the running agent; `console.warn` from these code paths
does not reach the bridge log, so an absent log line proves nothing.

1. **Authorization, fixed here.** The local ASR routes use `ensureCompatApiAuthorized`, which accepts the
   resident's per-boot token and not the owner session, so `/api/asr/local-inference/live/status`
   returned 401 while `/api/status` returned 200. `AlphaLocalAgentPlugin.routeToken` sends the per-boot
   token for those routes after owner admission; the token stays in native code.
2. **Wrapper, upstream.** `LocalInferenceLoaderRuntimeService` forwards `generate`, `transcribe` and
   others but not `createStreamingTranscriber` or `asrStreamSupported`, so the route sees no loader.
3. **Voice bundle, upstream.** `BionicHostLoader.bundleDir` is set only by `loadModel`, which a phone with
   hosted text never calls.
4. **Socket release, upstream.** `LocalServerSocket.close()` does not free the address while a thread
   is blocked in `accept()`. A service restart inside one process then fails with "Address already in
   use": `ElizaBionicInferenceServer` does not start, and speech gets `ECONNREFUSED`. `AgentSecureStore`
   fails the same way. On this phone close alone gave `rebind=false acceptAlive=true`; `Os.shutdown`
   first gave `rebind=true acceptAlive=false` (`LocalServerSocketReleaseInstrumentedTest`). The patched
   Java itself has not run on a device. How often this restart happens on a normal launch is unknown.

The boot hook runs and registers the loader in `local` mode (`runBootHooks`, `ensure mode=local`,
`tryBionic`). The Cloud rule in `ensureLocalInferenceHandler` is not involved.

[`patches/eliza/local-inference-live-asr.patch`](../patches/eliza/local-inference-live-asr.patch) fixes 2,
3 and 4; it applies to the pin. With it, status returned `ready:true, streaming:true` and a
real clip posted to the route returned "If you go into different cultures, they have different concepts
of creation." in stream mode in 287 ms, including the final IPC round trip. That run was a one-off
without defect 4. `docs/architecture.md` refuses resident patches, so this patch is not consumed by a
build: it is proposed upstream in [elizaOS/eliza#38821](https://github.com/elizaOS/eliza/pull/38821) and
needs that merge and a pin bump. The APK on the phone carries a locally built
developer bundle with it.

A temporary in-app decoder reached the `live-voice` pipeline with `VOICE_COMMUNICATION` capture and
barge-in armed, and three real turns passed. It was removed in favour of the upstream fix. One of those
turns: VAD 536 ms, endpoint to submit 998 ms, request to first token 8,310 ms, first token to TTS start
170 ms, TTS start to ready 284 ms, ready to audible 192 ms. One turn is not a distribution; its record
was not retained.

## November 6: pin 5d1af326e5, qualification, live turns

- elizaOS/eliza#38821 merged; the pin moved to `5d1af326e5`. Engine bytes are unchanged (`b3eb2bf63b`), so
  the voice record keeps its hashes. The resident now reports `ready:true, streaming:true` without any
  local patch, and the in-app decoder and developer bundle are gone.
- Upstream qualify app on the Pixel (arm64): ASR WER 1.94% over 101 utterances (limit 6%), empty
  transcript for silence; Paradee round trip WER 4.77% over 230 sentences (limit 8%). ASR RTF 0.043,
  TTS RTF 0.055. Reports: `evidence/on-device-speech-2026-11-05/qualify/`. Not run at this engine: x86_64.
- Physical microphone, live route, Cloud LLM, Paradee playback: one passed `live-voice` turn, last
  speech to audible reply 4,460 ms: endpoint to final transcript 1,002 ms (end-of-turn gap, not decode),
  request to first token 65 ms, first token to audible 2,862 ms. Four other turns were superseded by
  people talking in the room, so testing stopped. The 2.9 s wait for a complete first sentence of LLM
  text and the 1.0 s end-of-turn gap are now the main costs; speech engines are not.
- No same-day Cloud speech run: it needs reinstalling a `cloud` build over v35 and a quiet room.

## Latency

Last user sample to first audible reply sample, harness `harness-no-inference` (no language
model), production capture, VAD, Phonon-2 and Paradee, paced WAV feed, `audiotrack-timestamp`:

| Stage, warm p50 | Before | Lead-in trimmed | Trimmed and output warmed |
| --- | --- | --- | --- |
| Speech end to VAD endpoint | 519 ms | 519 ms | 519 ms |
| Endpoint to final transcript (Phonon-2) | 70 ms | 67 ms | 82 ms |
| TTS start to first audio ready (Paradee) | 141 ms | 156 ms | 149 ms |
| First PCM to audible | 530 ms | 256 ms | 134 ms |
| **Total** | **1,294 ms** | **1,017 ms** | **918 ms** |

Trials: 15 warm of 18, 9 of 9, 9 of 9, all passed. The trimmed-only row was printed, not retained.

Cloud baseline (`evidence/cloud-voice-latency-2026-11-01.json`, 8 turns on `cloud` v12, renderer
clock): recording stop to transcript 2.1 to 8.9 s; final reply to playback start 2.2 to 8.3 s. The
boundaries differ from the table above, so compare orders of magnitude only. No same-day A/B run
exists.

Three causes were found and two fixed:

- Paradee output opens with 298 ms below 0.01 full scale. `SpeechLeadTrim` removes it and keeps
  30 ms of pre-roll. A listening check for clipped onsets has not been done.
- The output path wakes from standby. `SpeechOutputWarmup` plays silence from the send of a voice
  turn until the reply's first samples. Its gain above is from the harness; the renderer wiring
  (`warmSpeechOutput`) is installed but has not been timed in a real turn.
- `PERFORMANCE_MODE_LOW_LATENCY` made no measurable difference (542 ms against 530 ms) and was
  removed.

`StreamingSpeechPlayback` stamped first PCM after the blocking write of a whole chunk, so the
collector refused the earlier audible time and every streamed reply recorded `no-audible-time`.
`FirstWriteSpeechOutput` stamps the first write instead.

The largest remaining cost is the 519 ms VAD hangover. The assistant then adds its end-of-turn gap
(fused speech, step 5). Neither has been tuned; that needs real speech.

## CPU

`parakeet-bench` and `paradee-tts`, 4 threads, i8mm, cross-compiled from the pin:

| Measure | Result |
| --- | --- |
| Phonon-2 batch, 3 / 6 / 10 s audio | 72 / 127 / 208 ms (47x realtime) |
| Phonon-2 stream finish | 52 to 57 ms |
| Phonon-2 peak RSS, load | 245 MB, about 190 ms |
| Paradee, 1.43 s / 5.35 s audio | 153 / 260 ms (9x / 21x realtime) |
| CPU energy, batch ASR | about 0.16 J per second of audio |

Streaming re-decodes its window: 10 s of audio cost 5.1 s of CPU. Its text also differed from
batch on this clip ("If you're going to" against the correct "If you go into"); re-decoding the
segment in batch at the endpoint costs about 130 ms and is worth evaluating.

## TPU

The EdgeTPU is reachable through NNAPI (`google-edgetpu`) from `shell` and `runas_app`. `untrusted_app`
itself was not tested. `tpu-probes/nnconf2.c` builds Conformer-shaped layers (FF, attention with
`BATCH_MATMUL` and softmax, GLU, depthwise convolution, residuals; 25M int8 weights each), compiled
per layer, resident, run through bursts. All 34 ops ran on the TPU. `tpu_active_cycle_count`
scaled with depth (222M, 661M, 1,326M).

| Measure, N=64 (5.12 s audio) | CPU encoder | TPU, 24 resident layers |
| --- | --- | --- |
| Warm pass | about 95 ms (interpolated) | 41 ms measured |
| First pass | n/a | 63 to 81 ms |
| Energy per second of audio | about 0.16 J (whole ASR, net of idle) | about 0.032 J (not net of idle) |
| Memory | 245 MB | about 1.8 GB resident |
| Weight bytes | 209 MB | about 605 MB |
| Preparation | none | about 31 s compile, uncached |

Per-layer time is nearly flat from N=16 to N=256 (1.47 to 2.30 ms, two layers), so one N=256
bucket should cover about 20 s of audio in about 55 ms. That total is extrapolated.

**These are speed and energy figures for random weights.** The graph omits LayerNorm, the
relative-position term and subsampling; only the bare FC chain was checked against a reference
(within 1 LSB). No real Phonon-2 inference has run on the TPU, and the accuracy of static int8
activations, which replace the CPU path's per-token quantization, is unknown.

Earlier FC-only probes showed a slowdown above N=64 and 438 ms for the encoder. That was a property
of those probes and does not apply to the layered graph. One 604M-weight model at N=64 panicked the
kernel (`system_is_deadlocked_on_memory`); 24 separate models did not.

## TPU decision (P-58)

The owner's rule is to use the TPU only if it is faster on the shipped path. On that path, live voice
streams Phonon-2 during speech, so the user waits only for the stream's finish after the endpoint:
45 to 54 ms on the CPU for 3, 6 and 10 s clips (`parakeet-bench --stream`, 4 threads, i8mm). The
encoder is 85 to 90% of a batch decode (`PK_PROFILE`: FF GEMMs 52%, QKV 9%, attention 8%, conv
GEMMs 10%, subsampling 5%). The best TPU result, 24 resident random-weight layers at N=64, took 41 ms
warm and 63 to 81 ms on the first pass. It covers only the encoder: subsampling, LayerNorm, the
position term, the TDT decoder and the IPC to the TPU service all add to it. A TPU port therefore
cannot reach the 45 to 54 ms the CPU already gives, and would cost about 1.8 GB of memory, so
Phonon-2 stays on the CPU.

What would reopen this: always-on listening, where energy matters more than latency (about 0.032 J
against 0.16 J per second of audio, both unconfirmed for real weights), or a Tensor G5 or later, where
the LiteRT Tensor SDK supports ahead-of-time compiled models. `litert-community/parakeet-redux` is the
same base model and would be the reference for that port. Paradee already runs 9 to 21 times faster
than real time on the CPU, and its first audio is ready in about 150 ms.

## GPU

No GPU path exists for either model. Phonon-2 uses hand-written `pk-*` kernels and Paradee its own
CPU code; ggml is used for GGUF reading. Enabling `GGML_VULKAN` changes nothing: the G3D rail showed
64 mJ against 53 mJ. GPU speed for a port is unmeasured.

## LiteRT and platform speech

- **Tensor SDK**: the docs list Tensor G5 and G6, and the blog the Pixel 10 family. This phone is
  Tensor G4. Delivery uses Play Feature Delivery and AI Packs; this image has no Play services.
  Terms are in the Tensor ML SDK licence, which has not been reviewed.
- **`litert-community/parakeet-redux`**: the same base model as Phonon-2. Published figures: Pixel 8a
  CPU 9x realtime; Galaxy S26 NPU 99x, peak 4.80 GB, f16 encoders 3.68 GB. No streaming.
- **`litert-community/Kokoro-82M`**: Pixel 10 Pro RTF 0.49 GPU and 0.93 CPU, 400 MB or more. Paradee
  measures RTF 0.05 here.
- **`litert-community/phonon-31m-en`**: a TTS model from Gradium, unrelated to Phonon-2. 84 MB, CPU
  only, claims about 45 ms first audio with no stated hardware. Unmeasured here; worth a listening
  and latency comparison against Paradee.
- **Platform speech**: this image has no `RecognitionService`, no TTS engine, no AICore and no Play
  services (`pm`, `cmd package query-services`).

P-42 allows only libelizainference. Any LiteRT or NNAPI model path needs an owner decision.

## Device recovery notes

- `ipc-recovery-*` directories hold a dead socket and 87 bytes of `{generation,inode,pid}`, no user
  data. Each unclean exit with a live IPC directory adds one, and startup refuses at eight. Clear
  them with Settings, Agent connection, Review recovery, Keep records and restart: this moves them
  to `ipc-reviewed-<id>/` and deletes nothing. Instrumentation runs and APK updates each cost a slot.
- The first Talk after launch fails with "Voice request already active or unavailable", because
  native `submit` allows one request at a time; Try voice again then works. This is an open bug.
- After an APK update the service can fail with `Address already in use` from `AgentSecureStore`,
  and Retry then cannot recover in the same process. Relaunching the app does. This is an open bug.

## Build notes

- The bundle moved to `eliza-paradee-voice-v2` with Paradee v1.2 and the Delibes Spanish voice.
  Upstream's `spanish.release_override` cites a Grace owner decision over the release's
  `commercial_distribution BLOCKED`; it needs an Alpha decision before distribution.
- Models came from a local Gradle cache and matched every upstream pin hash; x86 conversion was not
  attempted. `libelizavoicejni.so` was built against the recorded engine with the receipt's commands
  but without path remapping, so it is not a reproducible candidate.
- `ALPHA_BUN` did not reach the nested `bun` in `build:mobile`, so a Bun 1.3.14 on `PATH` produced the
  known `default10 is not defined` bundle and every chat failed. The stage script now puts the selected
  Bun first on `PATH`.
- `lintLauncherDebug` fails: the launcher manifest in the working tree references
  `AlphaPowerVoiceActivity`, which is not in this tree. The full `android:build` therefore stops after
  the debug APKs; v32 came from `assembleLauncherDebug`.
- The resident logs `No provider registered for TEXT_EMBEDDING` on this build, so memory vectors are not
  being written. Replies still work. Cloud embeddings or the local embedder need binding in `native`.
- `--allow-unpackaged-runtime` now proceeds while embedding requalification is pending and stays
  non-distributable.
- `npm run aosp:stage` refused with "Unrecorded source changes: system/core". That tree is clean at the
  pinned commit; the contract expects a recorded override of `android_filesystem_config.h` that is not
  applied there, so `artifacts/pixel11-aosp` is not the prepared stallion source. The prepared source is
  `~/Android/pixel10a-preparation/eliza-source`, which has that override. Staging there stops at
  `build/soong`: three files carry an October 27 `prebuilt_app_native` module for installing native APK
  payloads, which `android/aosp/pixel10a-source.json` does not record. It needs review, then recording in
  the contract or removal. No overlay or image exists for this APK.
  `/product` is full at 1.0 GB with a 692 MB AlphaPhone; the fit of this APK is unproven.
