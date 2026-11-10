# Host speech configuration after the shared runtime migration

The explicit development host uses authenticated `/api/tts/paradee` and
`/api/asr/libelizainference` routes. Their reported providers are
`libelizainference-paradee` and `local-inference`. This configuration does not
admit Android models or establish product/device qualification.

For `start-local-remote.ts`, use the upstream names only (`scripts/speech-env.ts`):
`ELIZA_PARADEE_ENABLED` and `ELIZA_ASR_ENABLED` (`1` requires the service, `0` turns it off,
unset enables it only when its model directory is set). Supply the absolute
`ELIZA_INFERENCE_LIBRARY` and its independently reviewed `ELIZA_INFERENCE_LIBRARY_SHA256`; the
launcher never converts an arbitrary installed library's current hash into a trusted hash. Supply
`ELIZA_PARADEE_MODEL_DIR` and/or `ELIZA_ASR_MODEL_DIR`. The private profile's `local-speech.json`
accepts these same nonsecret values, including the digest. Explicit environment values override
saved settings. The earlier Alpha-only names (`ALPHA_LOCAL_TTS`, `ALPHA_LOCAL_ASR`,
`ALPHA_TTS_MODEL_DIR`, `ALPHA_ASR_MODEL_DIR`, `ALPHA_TTS_LIBRARY`) are refused with their
replacement, both in the environment and in a saved file; the Whisper executable, backend and
single-model settings are retired and refused.

The TTS directory contains the shared pinned Paradee GGUF and Misaki lexicon.
If `espeak-ng-data` is present its English data pins are checked too; without
that optional directory, the shared worker spells unknown words letter by
letter. ASR requires the shared pinned Phonon-2 GGUF (`asr/phonon-2-fv5.gguf`, the
parakeet backend, upstream `PHONON_ASR_ASSETS`) as the only GGUF under `asr/` and
Silero VAD under `vad/`, with no alternative VAD GGUF; the launchers export
`ELIZA_ASR_BACKEND=parakeet` (updated for the `c7a9a0d7e7` pin). Exact paths, sizes and
hashes are in `scripts/host-speech-assets.json`; a test compares them against
the checked-out shared workers. Assets are not downloaded by these launchers.

The direct voice and frozen combined launchers accept
`ELIZA_PARADEE_MODEL_DIR` and `ELIZA_ASR_MODEL_DIR` with the same library and
reviewed digest. The direct voice launcher enables ASR only when explicitly
requested by `ELIZA_ASR_ENABLED=1`; combined requires both sets. The launcher
checks assets before dispatch, and the shared worker checks them again before
loading native code. There is no Whisper CLI warmup. A launch configuration
receipt is not readiness: inspect the authenticated route status after native
worker initialization. Cancellation releases the HTTP caller while the worker
remains busy until its result or cancellation timeout retires that generation.

`fingerprint-voice-assets.ts` admits both configured model directories before
recording their hashes and discoverable Mach-O dependencies. Unresolved and
system dependencies remain explicit limitations of that closure record.

The old cold-Kokoro, paired-Whisper, agent-ASR/TTS and combined voice-roundtrip
campaign entrypoints were deleted on 2026-10-14. They embedded retired model and
independent recognizer assumptions and could not qualify this runtime. Their
existing evidence is retained in the docs that describe it. Current admission,
service lifecycle, protocol and proxy tests exercise source behavior with
synthetic inputs; new installed-asset, intelligibility, cold-start latency and
physical-device campaigns remain necessary. No new runtime qualification is
claimed by this migration.

The loopback development agent's `/transcribe` endpoint also uses the shared
ASR service. It requires Bun, canonical `ELIZA_ASR_MODEL_DIR` configuration,
and a prepared source tree verified against the product pin before importing
the service. WAV is validated directly by the shared parser; compressed audio
still uses bounded local ffmpeg conversion. `/health` reports local ASR ready
only after native worker initialization. Shutdown stops the worker, and
cancelled or late recognition cannot return a successful transcript. The Node
only diagnostic server does not advertise native ASR availability.
