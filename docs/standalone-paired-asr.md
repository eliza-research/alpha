# Explicit standalone paired ASR

The isolated local agent47846 now serves an explicitly enabled whisper.cpp
provider through its normal authenticated HTTP host. This is separate from
`/api/asr/local-inference`, whose fused Gemma bundle remains unavailable and
whose curated release gates are unchanged. It does not forward to legacy47831.
No generic TRANSCRIPTION handler/default is reassigned; the dedicated host
provider owns these routes and reports its actual implementation identity.
Cerebras `qwen-3.8-27b` text routing is unchanged.

## API and authorization

- `GET /api/asr/whisper/status`: normal host auth plus a verified OWNER identity;
  returns readiness, busy/decoding, `provider:standalone-whisper.cpp`, model
  `tiny.en`, English, raw PCM16-WAV/16000Hz,60-second limit and verified asset
  digests. No credential, executable path or transcript is returned.
- `POST /api/asr/whisper`: same verified owner, required UUID `X-Request-Id`,
  `Content-Type:audio/wav`, raw mono16-bit16000Hz WAV only. Maximum2MiB and60s.
  Returns `{text,words:[],provider,model,language,local:true,durationSeconds,requestId}`.
  Word timings are unavailable and not fabricated.
- Missing/invalid credentials401; wrong role or unnamed ambient/static owner403;
  duplicate409; busy429; body bound413; wrong format415; malformed/silent422;
  configured assets absent/mismatched503. Both routes are hidden outside the
  existing local/local-only runtime modes. Owner cookies keep normal CSRF checks.

One request runs at a time. Duplicate suppression is per owner/request ID for
10minutes in this process, capped256 entries; it is not durable exactly-once
execution. Disconnect aborts the running child, and deadlines/body bounds stop
stalled work. Input/transcript files live in a private temporary directory and
are removed in finally. The decoder receives no provider API keys in its
subprocess environment. Its output streams are not logged.

The provider accepts a narrowly parsed PCM WAV instead of arbitrary ffmpeg
formats or file references. It does not accept Android's existing AAC/M4A
recordings yet; phone integration requires native decode/resample to this exact
format, explicit upload consent, native session binding and cancellation.

## Explicit configuration and provenance

Historical: `patches/eliza/0003-explicit-standalone-whisper.patch` (historical; retired in `34b3c82a`) applied after patch0002;
its digest/base were recorded in `standalone-whisper-source-base.json`. Upstream changes now arrive only through a reviewed pin move in `upstream.lock.json`; the product's `patches/eliza` series is historical: this repository retired it in `34b3c82a` (2026-10-03) and `55c2944f` (2026-10-04), and the last reference went in `530d3b26` (2026-10-10), each when the pinned upstream already carried the change.
`start-local-voice-agent.mjs` only enables the provider with all of:

```text
ELIZA_WHISPER_ENABLED=1
ELIZA_WHISPER_BINARY=/absolute/whisper-cli
ELIZA_WHISPER_BINARY_SHA256=<reviewed executable digest>
ELIZA_WHISPER_MODEL=/absolute/tiny.en/ggml-model.bin
```

The model is the existing77,704,698-byte tiny.en asset, pinned by SHA256
`4baf807ea95de42a7f9df96e24a36fe835ac8fb5b6ca20d7539ef521c42e6a2b`.
The tested Homebrew executable SHA256 is
`40bca494d49af736058eb3f33cbcebaa020eacf6d0087b623f334946e1ab2128`.
These verify installed bytes, not the complete dynamically linked dependency
closure. A different model needs explicit reviewed implementation support.
Readiness verifies configured asset bytes; real transcription is tested
separately. Nothing is downloaded or packaged into the phone APK.

## Actual proof

The retired `test-paired-whisper.mjs` (deleted on 2026-10-14) ran against47846, uses normal owner
pairing and Host10.0.2.2 to prevent loopback trust from replacing authentication.
It synthesizes a fixed phrase with the same agent's Kokoro TTS, converts only
that known fixture to PCM WAV, and transcribes it with real whisper.cpp.
`test-results/paired-whisper/real-http.json` records exact recognized phrase,
audio/model/executable digests,401/409/413/422/429 checks, real decoder-active
cancellation followed by released capacity, fused ASR false and actual Cerebras42.

A separate restart of only47846 with an intentionally wrong executable digest
proved `ready:false` and POST503; evidence is `unavailable-http.json`. The valid
configuration was then restored. Primary47840 and TTS47844 were not restarted.
Four upstream changed files pass Biome and clean patch application is checked;
full upstream typecheck has not run. No Android microphone/ASR, Cloud, remote
production host or enclave acceptance is claimed.

## Android integration prepared for Build65

The paired voice bridge now exposes a separate Whisper capability check and
explicit clip upload. The shared `RecordingPcm` (`ai.eliza.voice`) decodes only the app recorder's mono16kHz
AAC/M4A into bounded PCM16 WAV with MediaExtractor/MediaCodec. Unexpected channel,
rate or PCM encoding is rejected rather than silently resampled. Conversion is
cancellable and bounded20seconds/60seconds decoded audio; the draft remains
available after a transcription error.

Notes displays **Transcribe with agent Whisper** only after that selected
agent advertises the expected provider, PCM format, sample rate and English.
Recording and stopping do not upload. Pressing Transcribe uploads the selected
clip through native encrypted credential/owner/origin/expiry binding; the
returned transcript enters editable review. Composer voice first verifies the
capability and places the reviewed transcript into the chat draft, never sends
it automatically. Cloud voice and paired TTS remain separate capabilities.
Account/view/background/chooser transitions cancel pending work; stale results
cannot replace the current draft. Unavailable Notes ASR retains manual review.

Typecheck and renderer lifecycle fixture pass, including explicit upload,
reviewed composer draft and cancelled old-account result. Native execution is
pending: `PairedAsrInstrumentedTest` covers real AAC conversion plus synthetic
native HTTP; `PairedAsrLiveInstrumentedTest` is gated `pairedAsrLive=1` and its
runner `android-paired-asr-live.mjs` verifies archived matching APKs and real
47846 transcription/review/edit/TTS playback. The live fixture injects only a
test-owned synthesized AAC recording at capture ingress; it never opens a
microphone. There is still no physical microphone/user speech acceptance.

## Build65 Android evidence

Both standalone and launcher pass `PairedAsrInstrumentedTest` plus the real `android-paired-asr-live.mjs` runner against Eliza47846. The native flow decodes the test-owned AAC, explicitly uploads PCM to the authenticated Whisper endpoint, reviews and edits the actual transcript, and plays/cancels real TTS. Original connection/credential selection is restored. Evidence: `test-results/prototype-build65/paired-asr-live/result.json` and `photos-files-asr/result.json`. Audio ingress is synthetic; microphone, Cloud and enclave voice remain separate acceptance gates.
