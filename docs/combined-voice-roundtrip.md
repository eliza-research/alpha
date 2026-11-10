# Combined host speech roundtrip

> Historical. This campaign used Kokoro and whisper.cpp, which no longer ship. Its script
> (`test-combined-voice-roundtrip.mjs`) and the paired-Whisper script were deleted on 2026-10-14;
> on-device speech is Paradee-8M and Phonon-2 on libelizainference ([fused speech](fused-speech.md)).

`test-combined-voice-roundtrip.mjs` was prepared for the isolated combined Eliza host on47858. It has not been run against a service. The default invocation prints preparation metadata and exits without reading credentials or making requests. Only `--run` executes the proof. It never starts/restarts a host, requests a pairing code, creates a session or changes provider configuration.

The explicit owner-only, non-symlink session file supplies an existing paired token in memory. Requests use Node HTTP with `Host:10.0.2.2:47858` and a non-loopback forwarded identity; `/api/auth/me` must return OWNER with session mode. The combined profile process record must match the supplied reviewed source manifest. No token, session identifier, raw failed response or subprocess stderr is printed or saved. Both TTS and ASR POST routes must reject missing and invalid credentials with401 before synthesis proceeds.

The known synthetic English phrase is:

> Please remember to water the plants tomorrow morning and bring the blue notebook to the library on Friday.

Authenticated Kokoro synthesis must return a real RIFF/WAVE audio response. ffprobe must decode exactly one audio stream of positive duration, bounded60seconds. ffmpeg decodes/resamples those actual bytes to mono16000Hz PCM16 WAV; that output is capped2MiB and submitted to real authenticated `standalone-whisper.cpp`. The provider must advertise the reviewed tiny.en model SHA-256. No transcript is substituted or inferred when ASR fails.

The acceptance threshold is word error rate≤0.10. Comparison lowercases and NFKC-normalizes text, removes punctuation, splits whitespace words, and uses Levenshtein insertion/deletion/substitution distance divided by reference word count. The transcript, reference/recognized counts, edit count, WER and word accuracy are preserved even when the threshold fails. This is one fixed synthetic sentence and cannot establish broad language, accent or naturalness quality. It measures machine-recognizable speech; human listening, physical microphone/speaker, phone acoustic conditions, Cloud and enclave voice remain separate gates.

The new private evidence directory contains original synthesized WAV, converted PCM WAV and `result.json`: hashes, sizes, actual codec/sample-rate/channel/duration, ffmpeg/ffprobe binary hashes, ffmpeg version, source revision/content hash, provider/model/executable provenance and authorization results. Existing output directories are refused, preserving earlier runs. Failed stages record a safe stage label; generated synthetic audio remains available for diagnosis.

Prepared execution after the parent starts the reviewed combined host and supplies its existing paired session:

```sh
ALPHA_COMBINED_OWNER_SESSION=/absolute/private/session.json \
ALPHA_COMBINED_SOURCE_MANIFEST=/absolute/reviewed-source.json \
ALPHA_VOICE_ROUNDTRIP_OUTPUT=/absolute/new-evidence-directory \
node test-combined-voice-roundtrip.mjs --run   # deleted
```

`ALPHA_COMBINED_PROFILE` can name the explicitly isolated combined profile. Defaults are the prepared combined-agent47858 profile and `/opt/homebrew/bin/ffmpeg` / `ffprobe`; `ALPHA_FFMPEG` and `ALPHA_FFPROBE` may select reviewed installed tools. Syntax checking and the no-network preparation invocation pass. No combined-host result is claimed.

## Earlier evidence audit

- **47844:** `test-results/local-agent-voice/paired-http.json` records authenticated local Kokoro WAV synthesis (297644bytes, SHA-256 `663152d3e665a94358160255ae1b773b889e5b7650892c926b68641f9bb97426`),401 boundaries and a Cerebras text reply. It contains no ASR transcript or listening assessment. Native playback completion alone also does not establish intelligibility.
- **47846:** `test-results/paired-whisper/real-http.json` is genuine prior machine-recognition evidence, recorded2026-09-30T11:28:16.668Z. `test-paired-whisper.mjs` (deleted) synthesized “Please remember to water the plants tomorrow morning.” through that host's Kokoro, converted the actual audio with ffmpeg and submitted it to real tiny.en Whisper. The recorded transcript is the entire exact sentence; PCM SHA-256 is `98b304b8f11249eb540b95f6bcaeada5835e869a63b5b17fb5349deab392eea1`. Its assertion checked meaningful phrase inclusion, not a general WER metric. It also recorded missing/invalid401, duplicate409, silence/invalid422, oversize413, concurrent429 and actual decoding cancellation/release. This qualifies one synthetic phrase on that isolated historical runtime. It does not qualify the future combined47858 host, naturalness, human perception or every utterance.

## Configured voice asset identity

`scripts/fingerprint-voice-assets.ts` read the actual launcher asset specification at `test-results/combined-agent/voice-assets.json`, without launching inference or making HTTP calls. Its resulting `voice-asset-closure.json` hashes 32 files totaling 274130251bytes; the sorted content record SHA-256 is `33dd880d2c47afa9054eec4fe49e3189eab4d88491d8764157a86b10fa25c025`. This includes every regular file in the configured Kokoro model directory, the tiny.en model, native inference library, Whisper executable and recursively discoverable non-system Mach-O dependencies. There are 0 unresolved declared non-system links in this inspection. System shared-cache libraries are named rather than hashed; runtime `dlopen` of undeclared components and the operating-system closure are outside this record. The launcher-specified Whisper executable digest was independently checked. Asset identity alone does not prove readiness or intelligibility.

Reproduce on macOS with `node scripts/fingerprint-voice-assets.ts /absolute/voice-assets.json /absolute/new-closure.json` (macOS only: it walks the Mach-O closure with `otool` and refuses on other platforms); existing evidence is never overwritten. The manifest carries local nonsecret asset paths and is created owner-only. The initial combined-host read-only readiness inspection found PID58686 alive and listening, with first-boot BGE embedding download/warmup activity and no logged timeout markers. No HTTP health or speech result is inferred from those process/log facts.

## Initial combined-host executions: failures preserved

`test-results/combined-agent/voice-roundtrip-1/result.json` passed paired OWNER identity, readiness, and all four absent/invalid credential401 checks, then hit the120-second client synthesis deadline. It produced no audio artifact. Read-only process inspection observed system load averages569.83/426.74/245.71 on16 logical CPUs, while even basic command execution stalled; the combined process remained alive. This is substantial resource-contention evidence, not proof that contention was the sole cause. No provider restart or configuration change was made by this investigation.

`voice-roundtrip-2/result.json` again passed identity/readiness/authorization and successfully produced actual Kokoro PCM16 mono24000Hz WAV:318044bytes,6.625seconds, SHA-256 `9d13bcb761c7870209d436b0e1da64cd92d7b858462f0675b620cf96bb554d88`. Real ffmpeg conversion produced mono16000Hz PCM16 WAV:212078bytes,6.625seconds, SHA-256 `d56b7af06aaab4cf96ad18e150e2ee10475a52e87d23f67057e752a0d9c3658f`. The transcription stage failed an assertion before recording a transcript. The original harness omitted response status/error classification, so this result cannot distinguish a provider HTTP failure from an unexpected response contract. No intelligibility pass is inferred from successful WAV production.

The harness now records numeric HTTP status, response size, per-request/per-stage elapsed time, a fixed allowlist of provider error codes (unknown values become `unclassified`), and safe transport failure names. A successful transcription's expected shape is recorded before assertions. It continues to exclude raw failed response bodies, subprocess stderr and credentials. Syntax checking passes; these enhanced diagnostics have not yet been exercised against the combined host. Further voice calls are serialized with the parent's native campaign; no parallel retry is started here.
