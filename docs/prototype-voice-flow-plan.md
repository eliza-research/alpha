# Exact-prototype Notes voice flow

## Implemented prototype adapter (current source)

`apps/app/src/prototype/voice-adapter.ts` now owns the real recording state machine.
`main.tsx` installs it after the data/agent adapters and no longer mounts the
VoiceRecorder modal. The existing Notes recorder template owns the entire flow;
only its primary control semantics and an editable transcript field were added.
Ready → Start recording → Stop recording → Transcribe locally → Review transcript
→ Save note (or Apply transcript) are separate explicit actions. Flat waveform
bars represent unavailable telemetry, not fake microphone levels. The note save
uses the existing persistence adapter's actual boolean receipt; a rejected save
retains the transcript. The prototype's original setView swallows that receipt,
so this adapter exposes a narrowly scoped saveVoiceNote callback from the shell.
Back/discard/leave cancel and discard the current temporary recording. Pending
native/ASR results are generation-gated. Existing-note apply compares its original
body before writing. Activity recreation does not restore an unsaved recording.

TypeScript passed after implementation. No new Android recording-flow test or
visual acceptance is implied; the parent owns the next APK build and device run.
The following design and release analysis remains relevant, with proposed
confirmation-sheet refinements still unimplemented.

## Original mismatch and implementation seam

The working recorder is `apps/app/src/VoiceRecorder.tsx`, mounted as a generic
`voice-overlay` from `main.tsx`. The prototype Notes Record button is intercepted
by `prototype/agent-adapter.ts` and dispatches `alpha-record-note`. This modal is
not the accepted visual design. The original screen already exists in
`prototype/template.html`: `notes.recording`, `notes.rec.clock`, `levels`, `lines`,
`discard`, `stop` and `toggle`. It occupies the Notes canvas with the original
72px timer, waveform region, transcript rows, 84px central control and 60px side
control. Reuse this tree, typography, spacing and icons.

The reference `artifacts/design-reference/inline-0.js` synthesizes transcript
lines from NOTES_LIVE and waveform heights from timers in Notes.render. Do not
call notesStartRec/notesStopRec or set `st.record`/`st.rec` in a way that invokes
that code. Its Stop and save action does not model a real explicit upload/review
boundary. Its Pause control is unsupported by the current native bridge.

Implement a product `prototype/voice-adapter.ts` **after** the agent adapter.
Capture its existing Notes.render, call it with `record:false, rec:null`, and
supply the `recording`/`rec` result from a private real-capture controller. Override
`record`, Notes editor `dictate`, Notes.back, and Notes.onLeave. Remove the modal
mount, React recording state and `alpha-record-note` listener from main only once
the replacement is functional. Existing verified agent and note-persistence
adapters remain the destination for approved text; do not recreate storage.

## Explicit state and control mapping

| State | Native activity | Existing screen presentation | Main control | Side control |
| --- | --- | --- | --- | --- |
| Ready | Mic off | Timer 0:00; flat neutral waveform; explanation in transcript-row region | Start recording | Return to note |
| Starting | Permission / MediaRecorder startup pending | Mic starting; no elapsed recording claim | Disabled | Cancel |
| Recording | Real native capture | Elapsed time based on confirmed start; red dot; neutral waveform unless real levels exist | Stop recording | Stop recording (no fake pause) |
| Recorded | Native stopped clip retained privately | Final duration; mic-off dot; explicit host-transcription disclosure | Transcribe locally | Record again |
| Transcribing | Explicit authenticated loopback upload to local ASR | Processing status in existing transcript region | Cancel transcription | Disabled |
| Review | No microphone; editable transcript draft | Existing Notes text-editor typography and layout | Save note / Apply to draft | Record again |
| Error | Depends on failure | Honest error in transcript/status region, retained draft if valid | Retry eligible operation | Discard |

The template needs small **semantic** extensions: bind the central control's
aria-label/icon to state (replace hardcoded Stop and save); make the side icon and
label dynamic; display status text in the existing transcript region; expose a
review textarea using the existing Notes editor styling; add a Save/Apply control
using the existing Notes top-bar button style. Preserve all screen geometry.
These are necessary functional states, not a new modal or generic action-card UI.

Record and transcribe can open Ready first so the disclosure precedes microphone
permission. Start is the explicit recording action. Stop must never upload.
Transcribe locally is the explicit transfer action. A recognized transcript is
untrusted editable text and must not auto-send, auto-create tasks or auto-save a
note. Save persists one new note; Apply inserts into the originating note draft.
The destination note ID/revision is captured when recording begins. If that
note changed/deleted, offer a new draft rather than appending to another note.

The existing debug bridge emits no level telemetry. Render 44 flat neutral bars
and say levels are unavailable; do not animate random/sine-wave bars as measured
microphone activity. A product native level event based on MediaRecorder's
maxAmplitude can later drive the exact waveform geometry. The current ASR result
is one text string with language/engine/local metadata. Do not manufacture
speaker identities, word timings, live interim lines, summaries or action items.
Show a single “Transcript” row or editable body until richer verified output exists.

## Current proven native/debug contract

`android/app/src/testMocks/java/ai/elizaresearch/alphaphone/DevelopmentAgentPlugin.java`
and `DevelopmentVoiceCapture.java` expose the following. They are compiled into the
debug variant only when Gradle receives `ELIZA_DEV_ALLOW_TEST_MOCKS=1`
(`npm run android:build -- --test-mocks`); distribution APKs omit them.

- `startRecording()` → recordingId/maxDurationMs, only after native capture starts.
- `stopRecording()` → recordingId/durationMs; no upload.
- retained `recordingStopped` event on automatic duration/size stop or native error.
- `transcribeRecording({recordingId,requestId})` → text/language/engine/local:true.
- `cancel({requestId})` disconnects the request; `cancelRecording()` clears capture.

Capture is app-private AAC/m4a, mono 16 kHz at 64 kbps, maximum 59 seconds and
4 MiB. The lower recording limit accommodates AAC padding within the server's
60-second decoded limit. It does not expose arbitrary filesystem/URI reads.
The host `/transcribe` route authenticates, bounds/decode-validates audio and runs
local whisper.cpp with tiny.en; it does not upload audio to Cerebras. Existing
recognition and synthetic-audio evidence remains valid only for the tested prior
flow, not automatically for this proposed exact-layout replacement.

Subscribe before allowing Start, remove the listener on disposal, and reconcile
retained events by recordingId. Use an operation mutex plus generation counter.
Native Start can still be pending when Back is pressed: invalidate generation and
call cancelRecording, reject its late result, and cancel again if the bridge
cannot cancel a pending permission callback. The current permission callback
behavior must be checked before claiming this race closed. A stop event cannot
revive a discarded clip. On transcription cancel, abort the request and invalidate
its generation before changing the UI. Late success must never overwrite newer
text. Do not use requestAnimationFrame alone for background cancellation; it may
be suspended. Handle visibilitychange/pagehide synchronously.

Recommended initial policy: recording is foreground-only and leaving Notes stops
and discards after explicit user choice; no background microphone session or
ongoing-recording claim. If a stopped clip exists, Back offers discard/keep-draft
inside the same prototype sheet language. An unresolved upload/save is not
silently replayed after Activity recreation. Raw audio remains temporary and is
deleted on discard/completion; do not promise recorded-audio playback or durable
voice-note media until a separate persistence path is implemented.

## Release-compatible native feasibility

The current DevelopmentAgent bridge is debug-source-only and depends on an
emulator-provisioned loopback bearer. Moving that whole plugin to main/release is
not a release solution. There is no deployed production ASR session/backend.
Separate **capture** from **transcription transport**.

1. Most contained capture path: extract the existing product
   DevelopmentVoiceCapture implementation into a reviewed main-source
   `AudioCapturePlugin` with opaque clip IDs, start/stop/discard/status, real-level
   events and optional playback. Keep URI/file access private. The debug ASR
   adapter may consume only a selected clip ID through a native shared owner;
   production transport remains unavailable until configured. Use feature-gated
   RECORD_AUDIO permission and explicit lifecycle cancellation. This reuses
   actually exercised MediaRecorder code without introducing a production secret.
2. Pinned `plugin-native-talkmode` provides Android AudioRecord capture independently
   of SpeechRecognizer: `startAudioFrames({sampleRate,frameMs})`, `audioFrame`
   events (PCM16/base64, rms, timestamp, frameIndex), `stopAudioFrames()` and
   `isCapturingAudioFrames()`. Source:
   `src/definitions.ts` and `android/src/main/java/ai/eliza/plugins/talkmode/TalkModePlugin.kt`.
   It can supply real waveform levels and is not intrinsically debug-only.
   However it streams audio through JavaScript, suspends/resumes STT, has no
   opaque durable clip equivalent to the current upload API, and brings a much
   wider speech/TTS/session surface. Adding it solely for a memo recorder needs
   explicit bounded buffering, WAV encoding, native transport adaptation and
   lifecycle tests. It is feasible, but larger than the product capture extraction.
3. Pinned `plugin-native-swabble` wraps Android SpeechRecognizer. Source:
   `android/src/main/java/ai/eliza/plugins/swabble/SwabblePlugin.kt` checks
   `SpeechRecognizer.isRecognitionAvailable` before creating a recognizer. It
   does not bundle an ASR engine. Likewise TalkMode's transcript path uses a
   platform recognizer. Neither fixes a pure AOSP image with no installed
   recognition service. Do not represent either bridge as offline ASR by itself.
4. Local-inference packages contain native audio/model code, but integrating and
   shipping a model is a separate size/performance/licensing/product decision.
   Current instruction is not to sneak inference assets into the production APK.
   A real configured ASR service or a separately approved local model remains a
   release acceptance requirement. Until then release can record locally if
   capture is moved safely, with transcription explicitly unavailable.

Do not import talkmode's top-level app/runtime entrypoints to use a bridge.
Use its exact native registration contract and minimum project dependency only
if that route is chosen. No vendor edit is required for this plan.

## Full-flow acceptance

- Compare Ready/Recording/Recorded/Processing/Review/Error screenshots against
  the accepted Notes layout on phone and tablet; verify no Voice draft modal.
- Real microphone grant → elapsed recording → explicit Stop → zero upload before
  Transcribe → real local transcript → edit → explicit Save → exact stored bytes
  after Activity recreation. Track exact APK hashes and server backend metadata.
- Assert no generated transcript, note, speaker attribution, summary or task before
  real result and explicit save. Verify saved text follows user edits exactly.
- Denial/permanent denial, tiny/empty recording, maximum-duration auto-stop,
  provider unavailable, malformed result, cancel pending Start, cancel upload,
  Back/Home/background/reentry and rapid record-again must not resurrect data.
- No auto-send to the agent or update of a different note after context changes.
- Raw files and listeners cleaned; no RECORD_AUDIO prompt on launch; debug bridge
  absent from release; release capture/ASR capabilities honestly distinguished.

## Text-note dictation correction (Build55 candidate)

(Historical; the view refresh of 2026-11 removed note-editor Dictate and the clip recorder from Notes: Record opens the unlimited Notes recorder, see docs/architecture.md.) The existing Dictate → Apply transcript path then captured the text selection and complete original note revision before recording. Applying replaces only that selection, preserves the existing note type/title/pin and other fields, and discards the transient recording. The separate Record and transcribe → Save note path still creates a retained voice note. Review copy describes the difference without adding a new control.

Concurrent note changes block application; persistence failure retains the reviewed transcript for explicit retry. The host adapter flow fixture verifies selected-range insertion, text-note preservation, no retained audio, save failure/retry and concurrent-edit refusal. This is synthetic recording/provider evidence. `NoteAudioInstrumentedTest#dictationReplacesSelectionAndKeepsTextNoteAcrossRecreation` adds actual Android recording with a manually entered transcript, selection insertion and recreation readback; this flow and the other three native audio flows passed on both Build55 variants. Exact logs are in `test-results/prototype-build55/native-updates/`; that combined matrix still failed the separate browser reload-namespace case. This does not claim live speech recognition.

## Browser build recognition (2026-10-07, superseded 2026-10-12)

Superseded by decision P-42: the in-browser recognizer described below was removed, and local
browser transcription now goes through the local agent
([browser-speech-recognition.md](browser-speech-recognition.md)). Historical record:

The web build no longer asks for a manually typed transcript on the **Record and transcribe**
route: **Transcribe in this browser** runs Whisper tiny.en locally in a worker (English only),
then opens the same editable Review state. Nothing is auto-sent or auto-saved. Distinct
denied, no-microphone, no-speech, model-loading/load-failure and recognition-failure states,
**Type transcript instead**, worker termination on cancel/background and saved transcript
provenance are described in [browser-speech-recognition.md](browser-speech-recognition.md).
The former browser transcript dialog (Chrome on-device `SpeechRecognition` or typing) was
removed; **Record without transcription** remains the manual path. Android is unchanged.
