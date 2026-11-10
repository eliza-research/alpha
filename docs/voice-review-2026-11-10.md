# Voice end-to-end review, 2026-11-10

Scope: speech-to-text (STT), text-to-speech (TTS), the language-model (LLM) hot path,
end-of-turn detection, barge-in, the voice state machine and the build profiles. Sources are
code at alphaphone `c39ecaddad` and eliza `00edc8ce2e`. Latency figures marked "measured" come
from the Pixel runs of 2026-11-01 to 2026-11-06; everything else is read from code.

Code lives in two repositories. `alphaphone` owns the renderer adapter, the Android packaging
and the build scripts. The shared voice session, the Android speech classes (`ai.eliza.voice`)
and Eliza Cloud live in `elizaOS/eliza`, pinned here as `vendor/eliza`. Changes there land
upstream first and reach this repo by advancing the pin.

## 1. Summary

| Area | Today | Target |
|---|---|---|
| Build profile | Two build-time profiles. `native` = local speech only. `cloud` = Cloud speech only, no local models. Neither falls back. | One profile. Local models always ship. Route chosen at run time. |
| Speech route | Fixed at build time (except own Cartesia key). | Cloud when signed in to Cloud or a Cartesia key is installed; otherwise local. Local also covers offline and plan-limit failures. |
| LLM hot path | 1 KV read, then 2 Durable Object (DO) calls in series, then the provider. Postgres inline on the first turn after 30 s of quiet and on cache misses. | 1 KV read and 1 DO call. No Postgres before the provider; refills run after the response. |
| Cloud speech | Streaming exists, but five serial hops before the microphone opens; batch fallback uploads whole clips. | One DO check before audio flows; other checks concurrent; batch only for dictation. |
| End of turn | 512 ms silence wait, then 300 ms / 1,200 ms timers stacked on top. No speculative submit. | Submit speculatively after a short pause; cancel and resubmit if the user resumes. |
| Barge-in | None. The microphone closes at submit and reopens after the reply finishes. Only the Stop button interrupts. | Microphone stays open; confirmed speech stops playback, cancels the reply and listens. |
| Local efficiency | Per-turn microphone reopen, per-sentence audio track, one local socket per 96 ms of audio. | Capture held across turns, one audio track per reply, pipelined sentences. |

## 2. Build profiles and routing

Findings:

- The two profiles differ only in speech and embeddings. Both use Cloud (or the user's own
  Cerebras key) for the LLM and both can sign in (`native-runtime-profile.ts:47-62`).
- `cloudRuntimeEnabled` is read on 28 lines in 10 renderer files; 23 of them route or label speech.
- Java refuses network speech outside the `cloud` profile (`CloudSpeechPolicy.java:9`), and
  keyboard dictation exists only in the `cloud` profile (`AlphaKeyboardDictationService.java:110`).
- The `cloud` build fails if local speech is packaged (`scripts/runtime-profile.mjs:57`).
- The local build is refused today by three stale records, unrelated to the profile split:
  the voice-host pin (`voice-host.mjs:78`), the staged build record
  (`paradee-runtime.mjs:58`) and the embedding host (`stage-embedding-host.mjs:49`).
  The speech engine sources are unchanged between the recorded pin and the current one.
- Cost of one profile: the APK grows from about 167 MB to about 518 MB (release), and first
  launch copies about 290 MB of models to private storage.

Design:

- One function, `speechRoute()`, returns `cloud`, `direct` or `device` from the connection
  snapshot: `direct` when the user's own provider has a Cartesia key; `cloud` when a Cloud
  credential is present and no stored plan limit is active; otherwise `device`.
- A Cloud or direct failure before audio flows (offline, 402/403/429, 5xx) falls back to
  `device` for that turn and records the limit so the next turn skips the network.
- `cloudRuntimeEnabled`, the `--runtime-profile` flag and the cloud packaging verifier go
  away. The agent still receives `ELIZA_RUNTIME_PROFILE=native` (local embeddings).
- PRD P-60 said Cloud speech is "never an automatic fallback". The owner's instruction of
  2026-11-10 replaces that: Cloud is the default when available.

## 3. LLM hot path (Eliza Cloud, Cloudflare Worker)

Request path for the phone's `/chat/completions` call, warm:

1. Ingress rate-limit binding (20 ms deadline).
2. Auth: KV read `iac:auth:<hash>`. A miss blocks on Postgres.
3. Org rate limit: DO call 1 (`rl:<org>` `/rate-limit`), awaited.
4. Admission: snapshot from the auth entry if younger than 30 s. Older: memo, then KV,
   then **an inline Postgres transaction** (`organization-inference-admission.ts:483-497`).
   This hits the first turn after any 30 s pause, the normal voice pattern.
5. Lease and dispatch: DO call 2 (`/lease-dispatched-authorized`), awaited, up to 3 tries.
6. Provider fetch.

Other findings:

- Billing, usage and ledger writes already run after the response (`waitUntil`).
- The phone's streamed call carries a tool, so it misses the byte passthrough and goes
  through a decode and re-encode path.
- Prompt cache: the key is stable per room, but a millisecond clock (`CURRENT_TIME`) is
  rendered before the transcript, so the reusable prefix ends there every turn.
- Cancellation reaches the provider. A cancelled request is billed the full input estimate,
  including one case where the provider never received it.
- Retryable 503s (`rate_limit_unavailable`, `inference_admission_unavailable`) can add
  seconds through client backoff.

Changes:

1. Admit from the carried snapshot at any age and refill under `waitUntil`. A refusal
   refill also becomes asynchronous: the stale answer stands for this call.
2. Fold the rate window into the lease DO call; drop the separate awaited rate DO call.
3. On an auth-cache miss, keep one authoritative read (first call per key only) and
   pre-write the entry when the mobile key is minted.
4. Move `CURRENT_TIME` after the transcript and round it to the minute.
5. Settle at zero when the signal is already aborted before the provider fetch.

Risk: items 1 and 2 widen the window in which a suspended or out-of-credit account gets one
more call. The DO still fences balance and policy generations, so the bound is one request
per stale snapshot.

## 4. Cloud speech

- Streaming path: one WebSocket per conversation, microphone frames sent live, TTS audio
  played as it arrives. Setup before the microphone opens is serial: consent POST (Redis
  nonce), session POST (auth again, strict credential check), WebSocket, then inside the DO
  a storage claim, a usage check (Redis), credit reservation (2 admissions and 2 dispatch
  marks), then the Cartesia socket.
- The relay DO is bound to the large API Worker. A config comment records 3.4 to 8.1 s
  first touch there against about 1 s in the small speech Worker.
- End of turn on this path is Cartesia's, tuned patient (8 s timeout).
- Batch path (dictation, Notes, keyboard, own-key native, and conversation after a 404):
  the clip uploads only after recording stops, the reply downloads fully before playback,
  and each request opens a new TLS connection. The measured 2 to 9 s per direction matches
  this path, not streaming (inference from code).
- No moderation or Postgres on the streaming frame path.

Changes:

1. In the relay DO, send `ready` after the token check and run usage and credit
   reservation concurrently; a failure retires the session.
2. Defer the strong credential check on `/speech/session`.
3. Remove the conversation's 404 batch fallback; a 404 now falls back to local speech.
4. Stop disconnecting after each batch request so connections are reused.

## 5. Local speech

Measured: 909 ms p50 from last word to audible reply without the LLM (512 ms silence wait,
81 ms final transcript, about 300 ms to audible). Both engines run 18 to 25 times faster
than real time, so the remaining cost is plumbing:

- The microphone, its echo canceller, the VAD detector and the agent ASR session are torn
  down at every submit and rebuilt after the reply. The turn is sent only after that close
  completes.
- Audio reaches the agent as base64 JSON, one 96 ms batch per request, each on a new local
  socket.
- Each sentence is a separate synthesis request with a new audio track, started only after
  the previous sentence has finished playing. The warm-up track is discarded, not reused.
- The audio track has no low-latency mode and waits for a full 200 ms buffer.
- TTS uses one thread per core including little cores; ASR already uses big cores only.
- The TTS model unloads after 120 s idle, mid-conversation included.
- Conversation readiness loads a second copy of the ASR model that live ASR never uses.

Changes: hold capture across turns (gate frames, do not close); low-latency track with a
40 ms start threshold; queue sentences into one playback; big-core thread count for TTS;
keep the engine while a conversation is open; skip the unused ASR load.

## 6. End of turn

Today: VAD needs 16 windows (512 ms) below threshold, then the session waits a further
300 ms before asking the end-of-turn scorer and up to 1,200 ms as a backstop. Nothing is
submitted early.

Design, "speculative submit":

- VAD end hangover drops to 8 windows (256 ms). That edge is a pause, not a commitment.
- On a pause with a non-empty transcript the session submits immediately.
- If speech resumes before the reply is audible, the session aborts that request, keeps
  the transcript and, at the next pause, submits the joined text. No reply text or audio
  from the aborted request is shown or spoken.
- Once audio is audible, resumed speech is a barge-in (section 7).
- The replacement request shares the room's prompt-cache key and, with section 3 item 4,
  the same prompt prefix up to the user's message, so only the tail is re-read.
- Cost: extra LLM input tokens on resumed turns. Accepted by the owner for speed.

## 7. Barge-in

Today the microphone is closed for the whole reply on every route. The session contains a
barge-in confirmation path that can never run because no capture is open during a reply.

Design:

- Capture stays open through thinking and speaking. Echo cancellation is already requested
  (`VOICE_COMMUNICATION` + `AcousticEchoCanceler`); TTS playback moves to a usage the
  canceller references.
- Speech during playback is tentative for 300 ms of sustained VAD (or a transcript word),
  then confirmed: playback stops, the reply request is aborted, the heard prefix is
  recorded and the session is listening with the user's audio already captured.
- Without a working echo canceller the session keeps today's half-duplex behaviour.
- The spoken acknowledgement cue keeps its echo guard.

## 8. State machine and cleanup

- `voice-adapter.ts` is 1,445 lines mixing dictation, conversation and Notes, with three
  conversation engines: live session, batch clip loop and a realtime developer route.
- Dead or constant-off code: paired voice in `enter()`, `preparedLocal`, the route
  preference helpers used only by tests, the Clef stage, review-send mode,
  `externalVoiceInvocationEnabled`, `ownVoiceOnPhone`.
- Nine copies of the direct/voiceConfigured check and five copies of the
  cleanup-unconfirmed idiom.
- Native: `OnDeviceRecognizer` is unused; two Cloud STT uploaders; duplicate call detection.

Changes in this pass: one `speechRoute()`; delete the dead helpers and the conversation
batch fallback; one helper for the cleanup idiom. Larger restructuring (splitting the
adapter, removing the developer realtime route) is listed but not done here.

## 9. Validation plan

| Level | What it proves |
|---|---|
| `npm run verify` | Unit, contract and model checks at the new routing. |
| eliza package tests | Session behaviour: speculative submit, resume, barge-in. Worker: admission order. |
| APK build, both variants | One profile packages local models and permits network speech. |
| Pixel, signed out | Local route end to end; last word to audible; barge-in; resumed turn. |
| Pixel, signed in | Cloud route selected; fallback to local when offline. |
| Cloud staging | Server-Timing before and after for the LLM path. |

An APK build, an emulator run, a Pixel run and owner acceptance are separate levels; each
result is reported at its own level.
