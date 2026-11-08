# Browser speech: the local agent or Eliza Cloud

The web build has **no speech engine of its own**. It loads no speech model, no inference
runtime and no speech worker. Speech in a browser takes one of two routes:

- **Local agent (local-first).** The private local agent on the same computer runs speech
  natively on libelizainference, the llama.cpp-based engine ([fused speech](fused-speech.md)).
  Audio goes only to that agent, over the authenticated development bridge.
- **Eliza Cloud.** Available only in test-mocks builds and on explicit development surfaces.
  Production speech stays on the device (decision **P-43** in [decisions.md](decisions.md)); a
  missing agent never falls back to Cloud.

Decision **P-42** removed the earlier in-browser recognizer (and with elizaOS/eliza#36153 the
shared ONNX browser recognizer is gone upstream too): one local engine, libelizainference,
because the earlier runtimes were too slow and used too much memory. Chat
**Talk** opens voice inside the chat sheet and keeps the current app and draft. Notes uses the
same recorder with a Notes destination. A recording stays in the app until the user chooses to
transcribe it, and a reviewed transcript is sent only when the user presses Send.

**English only.** As with OCR (decision **P-08**), recognition is English-only for now.

## Without a local agent

`BrowserVoice.localSpeechStatus()` returns
`{ready: false, playback: false, execution: 'browser', route: 'local-agent', reason: 'local-agent-required'}`
(`local-agent-starting` while the resident starts) and never names an engine or model. There is
no Web Speech fallback (P-43): without the agent, replies are read as text. `transcribeLocalRecording()` rejects with code
`local-agent-required` ("Connect the local agent to transcribe on this computer."). The recorder
shows the `local-agent` failure state: the recording is kept, and the user can connect the
agent and transcribe again, or type the transcript. Nothing falls back to Cloud or to any other
engine on its own.

## With the local agent

| Step | What happens |
| --- | --- |
| Readiness | `speechRequest()` with no audio asks the agent whether ASR is ready. |
| Transcribe | The browser decodes the clip and resamples it to a 16 kHz mono PCM16 WAV (`recordingPcmWav` from the shared `packages/voice/src/browser-capture/recording-pcm.ts`). It posts the WAV to the agent at `POST /api/asr/libelizainference` (provider `local-inference`), the shared ASR service over the voice bundle's ASR slot (`apps/app/src/browser/local-transcription.ts`). A changed agent selection during decoding or recognition, or an empty transcript, fails without trying another provider. |
| Read aloud | `synthesizeSpeech()` posts text to `POST /api/tts/paradee`. The agent runs Paradee-8M on libelizainference through the shared Paradee worker (provider `libelizainference-paradee`). With no agent, read-aloud is unavailable and the reply stays as text. |
| Cancel | Cancel, a hidden page (`visibilitychange`), `pagehide` or a change of agent session aborts the request. The agent sees the abort, and a late result is discarded. |

| State (`data-voice-state` on the recorder) | Shown to the user |
| --- | --- |
| `denied` | Microphone access is blocked, with site-settings guidance. Start recording retries. |
| `no-microphone` | No usable microphone; connect or enable one. |
| `local-agent` | Local transcription needs the local agent on this computer. The recording is kept; connect the agent and transcribe again, or type the transcript. |
| `no-speech` | No speech detected. **Record again** or **Type transcript instead** (keeps the recording). |
| `recognition` | Recognition failed for this clip; retry or type instead. |

## Provenance

A saved voice note records how its transcript was produced, in `transcription.route`:
`local-agent` for the local agent on this computer (the route the browser facade reports),
`development-agent` for the development voice driver, and `eliza-cloud` for Cloud. Fields such
as `engine` and `model` are recorded only when the route reports them; they are never guessed
(`apps/app/src/runtime/voice-states.ts`).

## Tests

- `test/browser/browser-speech.spec.ts` (Playwright, Chromium): with no agent, status is
  `local-agent-required`, transcription rejects with that code, the clip is kept, and no worker,
  WebAssembly module or speech asset is loaded. With a stub agent, the agent receives a
  16 kHz mono WAV and the transcript reports the `local-agent` route. The Cloud cases are also
  covered here.
- `test/browser/browser-audio.spec.ts`: `pagehide` aborts a pending local-agent transcription.
- `test/browser/note-read-aloud.spec.ts`, `reading-review.spec.ts`, `dev-voicemail-audio.spec.ts`,
  `dev-workflow-automatic-speech.spec.ts`, `dev-workflow-speech.spec.ts`, `dev-maps-voice.spec.ts`
  and `dev-speech-account-switch.spec.ts`: read-aloud through agent speech, stubbed at the agent
  boundary (`agentBrowserVoice` in `test/browser/voice-fixture.ts`); no `speechSynthesis` exists.
- `test/browser/production-surface.spec.ts` (production project): the built bundle contains no
  `browser-speech/` assets, no inference runtime and no speech model.
- `test/llama-cpp-only.test.mjs`: no tracked path, lockfile package or web source names a
  removed engine, and the bundle audit rejects one even in a test-mocks bundle.

These tests are source and browser evidence (class S). They say nothing about real agent speech
quality; see [local agent voice validation](local-agent-voice-validation.md).
