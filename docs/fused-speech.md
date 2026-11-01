# Fused speech: libelizainference on the device and on the local agent

Alpha Phone has one local speech engine: **libelizainference**, the llama.cpp-based native
library from the elizaOS llama.cpp fork (decision P-42). At the pin `968348d792d3` (llama.cpp
gitlink `3e5f73922ee8`, voice ABI 18, built with `LLAMA_BUILD_PARAKEET=ON`) it contains ggml, the
**Parakeet-TDT** decoder that runs **Phonon-2** ASR in batch and streaming mode (P-55), mtmd (the
Qwen3-ASR alternative, not shipped), the **Paradee-8M** speech graph on the shared kokoro layers
(P-54), the native **misaki** English G2P, **eSpeak NG 1.52.0** (statically linked, used only for
words the misaki lexicon does not know, data path limit raised to 1024 bytes) and Silero VAD. It
loads GGUF models only; no other neural runtime or model ships anywhere
(`test/llama-cpp-only.test.mjs`, `scripts/audit-production-bundle.mjs`).

| Where | Engine | Route |
| --- | --- | --- |
| Android phone | The shared paradee-voice library (`:local-speech`, Java package `ai.eliza.voice`: `VoiceAssets`, `ParadeeVoice`, `NativeAsr`) and its `libparadeevoicejni.so` (RegisterNatives, only `JNI_OnLoad` exported), over the app's `libelizainference.so` | `AlphaVoiceCloud` local methods through the shared `LocalSpeechEngine` / `SessionSpeech` on the process-wide `InferenceSession`; provider `fused-paradee-asr`, execution `device` |
| Android phone, live voice conversation | Silero VAD in the app process (shared `ai.eliza.voice.LiveVoiceCapture` on the process-wide `InferenceSession` VAD context), Phonon-2 streaming decode in the resident agent's bionic host | The agent's `POST /api/asr/local-inference/live` through the owner-authenticated agent bridge (see Live voice below) |
| Browser with the local agent | The agent's host workers load libelizainference from `ELIZA_INFERENCE_LIBRARY` | TTS `POST /api/tts/paradee` (provider `libelizainference-paradee`); ASR `POST /api/asr/libelizainference` (provider `local-inference`) |
| Browser without the local agent | none | Local speech reports `local-agent-required`; replies are read as text. There is no Web Speech, no in-browser engine and no automatic network fallback |
| Eliza Cloud | provider-side | Test-mocks builds only; production speech stays on the device (P-43) |

Since the October 27 consolidation the speech engine owner (`LocalSpeechEngine`, `SessionSpeech`),
streamed playback (`StreamingSpeechPlayback`, `SpeechPcmQueue`, `AudioTrackSpeechOutput`), audio
focus, live capture with VAD (`LiveVoiceCapture`, `LiveVadGate`, `LiveCaptureSource`,
`LiveCaptureResource`, `LiveCaptureAdmission`) and the latency trials (`VoiceLatencyTrials`,
`VoiceLatencyProbe`) are the shared `ai.eliza.voice` classes in `plugin-local-inference`, compiled
through `:local-speech`. Speech output, recognition and VAD share one process-wide
`InferenceSession` (`VoiceAssets.sharedInference`). The engine's backend is its own client of that
session: cancelling a request fences only the engine's own calls, and an idle or memory-pressure
release drops only its own hold (the models are freed once no consumer holds them). VAD keeps a
small separate context so capture stays full duplex while a sentence is synthesized.
The Capacitor bridge itself is the shared `LocalSpeechBridgePlugin`
(`plugin-local-inference/native/android/speech-bridge`, enabled in `:local-speech` with
`elizaSpeechBridgeCapacitor=true`): recording drafts (`LocalVoiceRecording`, decoded by
`RecordingPcm`), single-request admission and the cancellation drain (`SpeechRequestGate`),
on-device recognition and synthesis, playback, audio focus, live capture and the latency
collector. `AlphaVoiceCloudPlugin` is a thin subclass that keeps the `AlphaVoiceCloud` name, the
installed `alpha-cloud-voice-`/`alpha-cloud-tts-` cache prefixes, the owner's resident transport
(`AlphaLocalAgentPlugin.openNativeVoiceTransport`), Notes audio storage and the Alpha-only
methods (browser-reading synthesis, paired agent speech, the explicit Cloud profile). The renderer
side is the shared `@elizaos/voice/native-live` and `@elizaos/voice/native-speech`, which
`native-live-voice.ts`, `native-voice-turn.ts`, `local-voice.ts` and `paired-voice.ts` bind to
that bridge. `AlphaApplication` names the timing export `alpha-native-voice-timing-v3`. The class
names in the sections below refer to these shared classes.

The app's own `ElizaVoiceNative` (embeddings and the host natives) is built from the same
upstream `elizavoice-jni.cpp` with `-DELIZA_VOICE_JNI_CLASS=ai/elizaresearch/alphaphone/ElizaVoiceNative`
and no source rewrite (`scripts/embedding-native-contract.mjs`). The paradee-voice library links
the app's engine instead of packaging a second copy, so the two must be byte-identical
(`node scripts/paradee-runtime.mjs --app-linkage`, Gradle `:app:verifyParadeeAppLinkage`).

## October 24 source update

Current consumer pin `c95a37be8d56` uses native engine `0d9fd4b9db23`.
The shared Android module now lives at
`plugins/plugin-local-inference/native/android`; its compatible Java APIs use the
full registered JNI surface. Alpha retains its own renderer and packaging.
Phonon-2 now uses the upstream b5x3t7 layout: 208,932,352 bytes, SHA-256
`c0f6ad42f0a5b481904416077dde0a1a78e5b8642295fdf2356ace822588c3df`.
The unchanged converter reproduced that exact hash under ARM64 Python/NumPy.
Fresh native receipts and component results are under `docs/evidence/native-c95a`.
Historical measurements below apply only to their named source and model hashes.
Complete device capture/playback and user acceptance remain separate requirements.

## The voice bundle

The bundle uses the libelizainference layout and ships **in the APK assets**
(`assets/paradee-voice/v1`). On first use `VoiceAssets.install` copies it to app storage
(`filesDir/paradee-voice-v1`) and checks every file against the SHA-256 in the bundle manifest;
nothing is downloaded.

| Path | Role | Size | Licence |
| --- | --- | --- | --- |
| `tts/paradee/paradee-8m-v1_2.gguf` | Paradee-8M v1.2 F32 (converted from the pinned PyTorch files) | 32 MB | Apache-2.0 |
| `tts/paradee/misaki-en-us.lex` | misaki US lexicon (converted from the pinned misaki data) | 12.9 MB | Apache-2.0 |
| `tts/paradee/espeak-ng-data/*` (7 files) | eSpeak NG English data for out-of-lexicon words | 0.8 MB | GPL-3.0-or-later (flagged) |
| `asr/phonon-2-fv5.gguf` | The ASR slot: Phonon-2 (Parakeet-TDT 0.6B, five-value weights, `general.architecture=parakeet-tdt`) | 331 MB | CC-BY-4.0 (attribution and NOTICE shipped; training-data terms flagged) |
| `vad/silero-vad-v5.gguf` | Silero VAD v5 | 0.6 MB | MIT |
| `notices/*` | eSpeak NG, misaki, spaCy and Phonon-2 (Fermion NOTICE, CC-BY-4.0 text) notices | small | as named |

At eliza pin `fbc2d23d4b` upstream pins Paradee-8M v1.2, adds an enabled Castilian Spanish voice
(Delibes-8M, with Spanish eSpeak NG data) and moves the llama.cpp fork to `13d0ccbf`. The recorded
engine libraries were built from fork `0d9fd4b9` and are not admitted at this pin: a fresh engine
build, a fresh byte record, a fresh APK and on-device validation are required
(`docs/evidence/develop-fbc2d23d-build-input-admission-20261029.json`).

The Phonon-2 GGUF (330,632,256 bytes, sha256 `dc552eb7…`) replaces the Qwen3-ASR pair
(about 1 GB), so the bundle is about 380 MB. It ships in the APK assets with the verified first-run
copy above; there is no network install path. It is converted locally by
`tools/parakeet/convert_phonon2_to_gguf.py --verify` from `FermionResearch/Phonon-2@7e153e40`
(byte-reproducible; the upstream `mobile-voice@1.1.0` catalog row is `unpublished`, so nothing is
downloaded).

### The ASR slot (P-55)

libelizainference serves `eliza_inference_asr_*` and `asr_stream_*` from whatever sits under
`asr/`: a parakeet-tdt GGUF (one file) or the Qwen3-ASR text + mmproj pair (two files).
`android/paradee-voice/asr-inputs.json` (schema 2) names the backend (`parakeet`) and pins its
files; `scripts/paradee-runtime.mjs` admits exactly the files that backend needs (one for
parakeet, two for qwen3) and refuses any other file under `asr/`, because the library would load
a stray parakeet GGUF first. The voice host record carries the same rows
(`asrSlot.backend`, `scripts/voice-host.mjs`). At runtime `parakeet` names the model
architecture, not a backend: the pinned `ElizaVoiceNative`/`ElizaAsrNativeEnv` and the shared
paradee-voice `VoiceNative` (loaded by the `SessionSpeech` backend) export
`ELIZA_ASR_BACKEND=ggml` before the library loads, so Phonon-2 runs on the in-tree ggml path.

**Licence.** Phonon-2 by Fermion Research is CC-BY-4.0, derived from NVIDIA
parakeet-tdt-0.6b-v3 (CC-BY-4.0). The attribution, Fermion's NOTICE
(`licenses/Phonon-2-NOTICE.txt`, also in the bundle as `notices/Phonon-2-NOTICE.txt` and in the
GGUF as `parakeet.notice`) and the licence text (`licenses/Phonon-2-LICENSE-WEIGHTS-CC-BY-4.0.txt`)
are in the generated third-party notices that Settings shows under Open source licenses. The NOTICE lists
CHiME-6 (CC-BY-SA-4.0) and SPGISpeech (Kensho terms) training audio; the entry is flagged
`unverified` for review and never blocks a build (P-09).

## Live voice (Android): Transcribe and the voice assistant

Two separate controls use the native live capture when both halves are ready
(`apps/app/src/runtime/native-live-voice.ts`, `nativeLiveVoiceReady`); otherwise each falls back to
recording a clip on the device:

- **Transcribe** (composer "Transcribe into draft"): records until Stop and puts the transcript in
  an editable review, then into the unsent draft. Nothing is sent to the agent until Send.
- **Voice assistant** (composer "Talk", title "Voice assistant"): listens continuously, sends each
  finished spoken turn and speaks the reply (`apps/app/src/runtime/voice-assistant.ts`, #423).

1. **App process.** `AlphaVoiceCloud.startLiveCapture` opens `AudioRecord` (16 kHz mono PCM16)
   and runs Silero VAD on every 32 ms window through libelizainference
   (shared `LiveVoiceCapture`, `InferenceSession.openVad()`). `LiveVadGate` opens a
   segment after two windows at P ≥ 0.5 and closes it after 16 windows (about 512 ms) below 0.35,
   with a 320 ms pre-roll. Only segment audio is forwarded; nothing is written to storage. The
   assistant asks for `echoCancel`: the communication source with the platform
   `AcousticEchoCanceler` (and `NoiseSuppressor`) when the device has one (`LiveCaptureSource`), so
   the microphone can stay open while the reply plays. Transcribe keeps the recognition source.
   Stopping flushes the frames of an open segment that were read before the stop.
2. **Native transport.** On a bridge advertising `nativeTransport`, the app process forwards
   PCM and VAD directly over owner-bound resident IPC; the renderer receives only levels,
   VAD and transcripts. The enrolled owner, token, root and lifecycle epoch are checked on
   every request and response. The bounded queue fails closed on overload, and cancellation
   closes the current IPC read. See [native transport](native-live-pcm-transport.md).
   Older native packages retain the renderer-forwarding compatibility path through
   `live-segment-stream.ts` and `live-voice.ts`; errors do not silently replay on that path.
   Both, and `voice-turn-routes.ts` below, re-export the shared `@elizaos/voice/live-session` and
   `@elizaos/voice/turn-routes` clients projected from the pin; Alpha adds no behavior to them.
3. **Agent.** The live route (elizaOS #36213, #36214) decodes with the Phonon-2 streaming decoder
   through the bionic host (`BionicAsrStreams`, staged from the pin) and returns
   `final.text` in the response to the request that carries `speech-end`.
4. **Stop reconciliation.** Stop (Transcribe), Mute and conversation end stop capture,
   omit queued frames after the cutoff, finalize the open segment and await the explicit
   server close acknowledgement. PCM already sent before native Stop arrives cannot be
   retracted. Cancel drops queued audio and late output; IPC closure does not roll back
   inference already running. A segment whose transcription fails (`502 ASR_FAILED`) yields
   no text and capture continues; an unavailable route or transport failure stops it.
5. **Endpointing (assistant).** After the last segment's final, a short gap (300 ms) asks the
   resident's semantic end-of-turn route and a long gap (1,200 ms) submits; both follow the VAD
   speech-end, which itself trails speech by the gate's ~512 ms hangover. The route is
   `POST /api/asr/local-inference/end-of-turn` (elizaOS #36546, in the pin `08703642627c`): one
   causal pass of the fused Eliza-1 end-of-turn scorer over the utterance text, through the same
   owner-bound resident request port as the live ASR route (`voice-turn-routes.ts`). It is asked once
   per utterance with a 600 ms deadline (short gap plus deadline stays under the long gap), aborted
   by resumed speech, and its answer is dropped when the utterance changed. `available` and
   `complete` submit at once; `available` and not complete waits for the long gap or more speech;
   `available: false` (`voice-not-started`, `ffi-context-unloaded`, `scorer-unsupported`,
   `ram-pressure`, `unscored`, `timeout`), a 502 scoring error, a transport failure or the deadline
   all fall back to the long gap; unavailable is never treated as complete. The route never starts
   voice or loads a model, so the semantic path only works where the resident's voice bridge and
   its fused text context are loaded; elsewhere the gaps decide alone. The scorer is the Eliza-1
   one. The assistant asks it through the shared end-of-turn chain (`@elizaos/voice/endpoint-chain`
   `createEndpointChain`): local fused scorer, then an optional **Clef** `turn` stage (Eliza Cloud
   `clef-decisions`, transcript text only, its own 300 ms timeout; unavailable, disabled, refused or
   late is never a yes), then the long gap. The Clef stage is asked only when the local scorer could
   not score, and is built only with an explicit switch AND a Cloud client: `CLEF_ENDPOINT_ENABLED`
   in `voice-selection.ts` is `false` and the renderer holds no Cloud Clef client (the owner
   decision is #663 / H-18), so today the chain is the local scorer and the gap, and no transcript
   leaves the phone for endpointing. Each submitted turn's voice timing record keeps `endpoint`: the
   path (`semantic` or `gap`), the outcome enum, the unavailable reason (scorer or `clef-*`), the
   latency and the chain stage that answered (`path`: `local` or `clef`), never text; the
   diagnostics export copies the same enums. The gaps and deadline are engineering
   defaults (local-speech research), not measurements or owner-set constants.
6. **Send.** The turn goes through the existing voice policy unchanged (`VOICE_SEND_POLICY`
   in `voice-selection.ts`, P-39: the assistant submits automatically; Transcribe only inserts
   editable text the user sends). A reply carrying action proposals ends voice for review in
   the conversation: automatic submission never approves a side effect.
   **Spoken replies follow voice mode.** Replies are spoken in the voice conversation and nowhere
   else: a typed message, or one dictated with Transcribe and sent from the composer, gets a
   silent reply. There is no setting for this; a stored `alphaphone:speak-replies:v1` value from
   an earlier build is ignored. A message action's Read aloud still plays one reply on request.
   **Path.** When the live assistant is not ready (`nativeLiveVoiceReady` false) or the route is
   Cloud, the conversation runs the recorded-clip loop (`BatchVoiceConversation`), which cannot hear
   the user while a reply plays; Alpha says so once per session ("Speaking will not interrupt
   Alpha's reply in this voice mode"). Each conversation turn's timing record keeps its path as the
   live ASR mode (`live.mode`: `batch` for the recorded-clip loop, `stream` from the live route), and
   the diagnostics export names it `path: live | batch`.
7. **Barge-in and heard content.** Speech that starts while a reply is pending or playing is
   tentative. Before playback it interrupts once the VAD segment has stayed open for 700 ms (longer
   than the gate's hangover, so a blip never confirms by time) or its transcript passes the
   disfluency and echo gate; during playback only the transcript gate confirms, since residual echo
   can hold the VAD open for a whole sentence. The gate is upstream `shouldRespondToVoiceTurn`,
   applied against every sentence of the reply that has started playing. A cough or the reply's own echo leaves the reply running. While a reply plays, voice
   interrupts only over a capture whose platform echo canceller is attached and enabled
   (`echoCancelled` from `startLiveCapture`); otherwise speech during playback is ignored and the
   Stop speaking button remains. Interrupting cancels that request or playback (generation ids drop
   its late callbacks) and the speech becomes the next turn; the earlier turn is never resent.
   Replies play one sentence at a time and only sentences whose playback completed count as heard:
   the conversation view keeps that text and marks the rest
   "(Interrupted. The rest of this reply was not played.)". Stop speaking does the same by button.
   Once the reply's message id is known, Alpha also sends exactly the played prefix (the completed
   sentences of the spoken form) to `POST /api/conversations/:id/messages/:messageId/heard`
   (elizaOS #36547), so the agent's stored reply, and its memory and search, keep only the heard
   part. Only an assistant reply of the current voice conversation's binding is sent; nothing is
   sent for a reply that was fully heard. The request never blocks the next turn. A 409 (the played
   text is not a prefix the agent recognises) is recorded and the view stays trimmed; a 404 or 503
   is retried once after 1.5 s, then dropped; the outcome enum is kept on the turn's voice timing
   record (`heard`). A reply interrupted before its first sentence finished is reported as
   `{ nothingHeard: true }`: the agent replaces it with an empty, interruption-marked reply
   (`heardNothing`), so it keeps that it answered and was cut off but none of the unheard words; an
   agent that predates the explicit report refuses it (`rejected`) and keeps the reply. A speech
   failure is not a barge-in: when playback fails before the first sentence finished
   (`playbackFailed`, for example a refused Cloud speech request) nothing is sent (`nothing-heard`)
   and both the agent and the view keep the whole reply; after a finished sentence only the heard
   prefix is kept, as for an interruption. **Gaps:** a
   reply the agent
   completes after the user interrupted it while it was still being generated has no message id
   in the voice session, is not trimmed and appears in full after a reload; a partially played
   sentence is never claimed as heard. The 700 ms hold and the sentence-by-sentence synthesis gap
   are engineering defaults to tune on a device.

Interim text: the agent publishes ephemeral `voice-transcript` events (`speech-start`, `partial`
with the full running text, `final`, `error`) on its WebSocket event stream. `live-voice.ts`
replaces the interim text on each newer partial of the current turn, drops other sessions and
stale turns, delivers each final once and shows the interim text in the conversation view
(`data-alpha-voice-interim`, "Heard so far, not sent"). It is never stored, logged, written to a
draft or sent. Alpha now consumes the private voice-only event subscription, fenced by
owner, runtime and surface lifecycle. The direct native transport uses that feed for
interim display and native HTTP responses as authoritative finals/errors; the
compatibility renderer transport retains its existing event/response deduplication.
Installed event-flow acceptance remains separate from source wiring.

Latency is recorded per turn as numbers only (`voice-timing.ts` `live`: ASR mode, partial count,
speech-start to first partial, speech-end to final on the client and the agent's own last-frame to
final) and appears in the diagnostics export. Evidence: class S (node tests
`test/live-voice.test.mjs`, `test/voice-assistant.test.mjs` and `test/voice-turn-routes.test.mjs`, the Playwright specs
`test/browser/live-voice.spec.ts` with a stub agent and `test/browser/voice-assistant.production.spec.ts`
on the flag-off renderer with synthetic native ports) and Gradle compilation; not run on an emulator
or a device. Echo, barge-in timing, lock, calls and Bluetooth need device acceptance.

## Records

- `vendor/eliza/packages/app/platforms/android/paradee-voice/inputs.json` (upstream): the Paradee
  GGUF and misaki lexicon pins and the eSpeak NG source.
- `android/paradee-voice/asr-inputs.json`: the ASR slot (backend `parakeet`, the Phonon-2 GGUF).
- `android/voice-host/qualified-voice-host.json` (schema 2, `scripts/voice-host.mjs`): the exact
  engine library per ABI (`libelizainference.so`, `libc++_shared.so`), every bundle file, the
  components and their licences, the reference JNI builds and the evidence. `qualified` is
  **false** and stays false until on-device qualification on both ABIs and device acceptance are
  recorded; the schema refuses `qualified: true` without them. The notices
  (`scripts/generate-licenses.mjs`) and the SBOM (`scripts/generate-sbom.mjs`) read it.

## Build, stage and verify

The current source pin uses the upstream-preserving native integration and disables
the optional Android video helper that required API 28. Both engine ABIs build with
ABI 19, ASR and Paradee enabled, and 16 KiB load alignment. The voice record contains
their measured hashes and remains unqualified. Staging binds the generated record to
both the Eliza and llama.cpp revisions; an older bundle cannot satisfy the new pin.
The earlier path-independent build described below is historical evidence, not a
claim that the current development build reproduces those bytes.

1. Build the shared outputs at the pin with the upstream builder, outside `vendor/eliza`
   (NDK 28.2; it converts the Paradee GGUF and misaki lexicon from pinned sources and checks them):
   `node scripts/build-pinned-voice.mjs --workspace <dir> --out <fresh-dir>`.
   This consumer wrapper verifies clean pinned Eliza/FFI sources before and after the upstream
   builder, then verifies the shared builder's recorded revisions and every fresh output hash. At `968348d792d3` the upstream builder
   emits both source fields; the wrapper rejects disagreement and unrecorded engine staging
   checks the original record against every selected engine hash. No vendor source is edited.
   The current engines were built from clean Eliza `58dfddf87ee5` and native
   `6003a10368d8` checkouts on 2026-10-23. The canonical Paradee v1.1 model was
   reproduced by the pinned macOS workflow and verified by size and SHA-256.
   Both hosts select the same engine bytes; see the [component evidence](evidence/native-58df/README.md).
2. Put the Phonon-2 GGUF, its NOTICE and licence text, and Silero VAD in a directory (their
   pinned sources are in the record).
3. Stage: `node scripts/android-stage-voice-models.mjs --from <build-native output> --from <model directory>`.
   Every file is checked by size and SHA-256 against the record and written to
   `.eliza/paradee-voice/native` (`jniLibs/<abi>/libelizainference.so`, the bundle under
   `assets/paradee-voice/v1`, and `build-record.json`). `--plan` lists the rows. Changed bytes are
   refused, never repaired. `--unrecorded-engine` exists only for hosted developer-APK runs that
   rebuild the engine: it rewrites that workspace's record (never committed) and stays unqualified.
4. Gradle checks the staged outputs: `:local-speech:verifySpeechInputs`
   (`scripts/paradee-runtime.mjs`), `:app:verifyParadeeAppLinkage` and `:app:verifyVoiceHost`
   (`scripts/voice-host.mjs --verify`). A distribution build needs them; the explicit
   `--allow-unpackaged-runtime` developer lane may omit them, and local speech then reports
   unavailable.
5. `npm run android:build:inputs` lists "on-device voice outputs" and "on-device voice qualified"
   as inputs only a person can supply. `scripts/verify-apks.mjs` checks a packaged bundle and
   engine against the record and records a release distributable only with a qualified voice host
   (`scripts/release-blockers.mjs`).

The app's engine comes from the embedding host (`android/embedding-host/qualified-host.json`).
The full Alpha JNI bridge and current engine passed BGE component qualification on ARM64
and x86_64. Its original JNI build revision is preserved, with current input equivalence
checked separately; this does not establish installed-app or device acceptance.

## Development host (browser with the local agent)

Configuration uses the upstream names only (`scripts/speech-env.mjs`):
`ELIZA_INFERENCE_LIBRARY` with its independently reviewed `ELIZA_INFERENCE_LIBRARY_SHA256`,
`ELIZA_PARADEE_ENABLED` / `ELIZA_PARADEE_MODEL_DIR` for TTS and `ELIZA_ASR_ENABLED` /
`ELIZA_ASR_MODEL_DIR` for ASR (`1` requires, `0` turns off, unset enables only with a model
directory). The earlier Alpha-only names (`ALPHA_LOCAL_TTS`, `ALPHA_TTS_LIBRARY`,
`ALPHA_TTS_MODEL_DIR`, `ALPHA_LOCAL_ASR`, `ALPHA_ASR_MODEL_DIR`, `ALPHA_WHISPER_*`,
`ALPHA_ASR_MODEL`) are refused with their replacement, in the environment and in a saved `local-speech.json`;
nothing maps them to the upstream names. Exact host asset paths and hashes are in `scripts/host-speech-assets.json`
([host speech migration](host-speech-migration-2026-10-14.md)).

## Always-on listener (`:sense`)

The AOSP-image-only listener APK uses the same library: `ListeningService` installs the bundle with
`VoiceAssets.install` and opens `NativeAsr` on the ASR slot. It packages its own copy of the staged
engine (`.eliza/paradee-voice/native/jniLibs`). `stage-aosp --production` refuses a listener APK
without the bundle manifest, without the Phonon-2 ASR file or whose engine is not the recorded bytes
(`scripts/aosp-listener.mjs`). No listener APK with a voice bundle has been built, staged or booted.

The listener only decides whether the user addressed Alpha: energy VAD (`SpeechGate`), batch
Phonon-2 recognition of the utterance in RAM, then `WakePhrase`. It has no network permission and
keeps no audio or transcript. On the wake phrase it opens `AlphaAssistActivity`, and the renderer
starts the voice assistant above (Silero VAD, streaming Phonon-2 through the resident agent on this
phone, Paradee replies, barge-in) when the invocation is the listener's, the phone is unlocked and
the surface is visible (`installListenerInvocation`, `listenerStartsVoice`). The listener releases
the microphone while Alpha records and ignores speech while Alpha speaks.

## Evidence

Class B only. At `c7a9a0d7e7` the engine and JNI libraries were built for both ABIs on
2026-10-14 and symbol-checked (voice ABI 18, `paradee_supported()=1`, `asr_supported()=1`, 83
`eliza_inference_*` exports including the six `asr_stream_*`, `parakeet_lib` and eSpeak NG linked,
16 KiB alignment, only `JNI_OnLoad` exported by the JNI bridges). The host gates were not rerun at
this pin; the earlier host runs of the same Phonon-2 GGUF (elizaOS/eliza#36212: batch and
streaming transcripts exact under `-Xcheck:jni`, Paradee to Phonon-2 round trip exact) and of
Paradee (parity SNR 58 to 76 dB) are host evidence, not Android execution. Nothing here has run on an emulator, an image or a device, and the hosted
`fused-speech` emulator suite refuses to start until hosted staging exists. On-device
qualification (`vendor/eliza/packages/app/scripts/paradee-voice/qualify`) and device acceptance are
still required.

## Upstream gaps

- Live event subscription and direct native PCM routing are implemented in the consumer;
  current installed capture/IPC/inference/playback acceptance remains open (see Live voice).
- The app-process recorded-clip path (`NativeAsr.transcribe`, used by Notes dictation and when the
  live route is not ready) is batch.

## Cloud speech plan limits (cloud runtime profile only)

Only the explicit `--runtime-profile=cloud` QA build and development browser-resident builds send
speech to Eliza Cloud; a flag-off native build routes speech to the device (`selectVoiceRoute`) and
never makes a Cloud speech request. When Cloud answers HTTP 429, `AlphaVoiceCloudPlugin`
(`CloudVoiceLimit.java`) and the development bridge (`cloud-voice-limit.ts`) pass on only the retry
facts: `Retry-After` or the body's `retryAfterSeconds`/`retryAt` (at most a day), a short
lower-case limit code and a bounded `resetAt`; the message, plan and provider body never leave.
The shared `LocalSpeechBridgePlugin.submit` rejects a non-2xx answer with `voice-http-<status>`
and no data, so Alpha's `submitLimited` settles a 429 itself: it closes the connection, marks the
request resolved and rejects with the same code plus those facts (a cancelled request keeps the
shared cancellation). Moving this data path into the shared request gate is upstream follow-up.
`cloud-voice.ts` reads them as the shared `ServiceLimit` (`readServiceLimit`), shows plan-limit
wording with the retry time ("... reached your plan's request limit. Try again in about 42
seconds. Your recording is kept."), keeps the recorded clip for an explicit retry, and records the
limit as the account panel's latest limit (`lastLimit` of the shared `useCloudSubscriptionSummary`)
for the same signed-in Cloud session only. Nothing is retried automatically.

## Streamed speech output and audio focus (#397)

When the pinned engine reports `ParadeeVoice.supportsStreaming()`, the speech bridge synthesizes
each reviewed sentence with `synthesizeStream` and plays the chunks through an AudioTrack
(`AudioTrackSpeechOutput`: MODE_STREAM, 24 kHz mono float, USAGE_ASSISTANT/CONTENT_TYPE_SPEECH) as
they arrive. `StreamingSpeechPlayback` holds at most 30 s of PCM in a `SpeechPcmQueue`; a full queue
blocks the synthesis callback (backpressure) and stop, barge-in, pause or focus loss closes it, zeroes
every unplayed chunk, flushes the track and cancels synthesis without reloading the models. Chunks are
validated per call (`SpeechStreamValidation`: bounded, finite, non-silent utterance) and zeroed after
the write; streamed audio is never written to storage. `synthesizeLocal` resolves at the first chunk
with the same `playbackId`/`play`/`playbackEnded` protocol. Only an engine without streaming uses the
whole-sentence MediaPlayer path; a streaming error is a failure, not a fallback.

Speech requests `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` before it plays and abandons it afterwards
(shared `SpeechAudioFocus`, `SpeechAudioFocusPolicy`): permanent or transient loss stops the utterance
and clears its queue, a ducking loss lowers it to 20 %, regain restores it. No speech, recording or
live capture starts while the audio mode is ringing, in a call or in VoIP communication
(`call-active`), and on Android 12+ a call starting stops speech and the assistant's live capture
with that reason. Host-JVM fixtures (`test/streaming-speech.test.mjs`) check the queue, writer,
cancellation and focus policy; AudioTrack playback, focus behaviour and call handling have not run on
an emulator or device.
- The Paradee GGUF, the misaki lexicon and the Phonon-2 GGUF are not published for download; they
  come from the pinned, byte-reproducible conversions.
- Closed at this pin by elizaOS/eliza#36239 and elizaOS/llama.cpp#79: AOSP stages eSpeak NG data,
  the Paradee GGUF is named `v1_0` everywhere, and the eSpeak NG data path limit is 1024 bytes.

## October 14 Linux rebuild at Eliza 193d9264fc

The dependency rebuild uses Eliza `193d9264fc8236c4a62a0d775532148162256dfb`
and its llama.cpp gitlink `56e70ff2a0ca060fa2dc3fead2f38003cd7dd64f`.
Both Android ABIs were rebuilt with NDK 28.2.13676358 and CMake 4.0.3.
The engine records name those new bytes; the voice host remains unqualified.
The ARM64 JNI host executed the real BGE384 model on the Pixel 10a, including
normalization, repeatability, Unicode/NUL tokenization and context reopening.
That evidence does not qualify speech or a full AOSP image.

Model pins were retained. On this x86 Linux host, ordinary PyTorch 2.14.0/2.14.1
weight normalization did not reproduce the Paradee hash. Reproducing the ARM
NEON four-lane accumulation and reduction order, including sequential reduction
for rows shorter than four elements, produced the exact recorded `35747765…`
model through the unchanged converter. Phonon-2's x86 conversion passed the
converter's tensor checks but produced a different whole-file hash. Running the
unchanged converter with aarch64 Python 3.12.14 and NumPy 2.5.4 under QEMU 7.2
produced the exact recorded `dc552eb7…` model. A successful tensor check alone
therefore must not substitute for the output hash check on either platform.

The attached rebuild workspace retains receipts, conversion scripts, logs and
model hashes under `test-results/rebuild-oct14` and `.eliza/native-oct14`.
These are development build inputs, not a production qualification declaration.

### Owner-bound wake invocation

The shared ElizaSense bridge binds wake invocations to the active authenticated
owner, agent and session. AlphaListener remains a compatibility alias for status
and settings. Cold process starts open the assistant with the microphone closed;
a wake starts voice automatically only when the native process already had the
same authenticated owner binding. Locked, stale, consumed or changed-owner wakes
never start capture.
