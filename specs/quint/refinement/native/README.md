# Native implementation correspondence

Run `node --test test/quint-native-refinement.test.mjs` from the repository root.
The runner requires a JDK and the pinned `org.json` 20250517 jar in the Gradle
cache or `ALPHA_JSON_JAR`. It compiles original Java classes in temporary
directories, executes them with controlled external inputs, and checks their
observations against named Quint transitions. Temporary classes are removed.

`runNativeRefinement()` returns `{receipts, obligations}`. Receipts are also
written under `test-results/quint-refinement`. They retain every input trace,
model/source/driver hashes captured before source execution, hashes after checking,
observed fields, action counts and checker output. A mismatch fails the runner.
The action counts include environment and macro setup actions. They are not
counts of individually observed implementation transitions.

## Scope

The three finite-helper campaigns cover the declared helper projections.

- VAD covers every reachable counter shape, all eleven probability classes and
  explicit close, using reachable prefixes. The float classes partition the two
  actual float comparisons and the nonfinite normalization branch.
- Renderer budget covers counts zero through four-or-more, equal/backwards
  elapsed time, and deltas below, at and above 60,000 ms. Elapsed time is
  nonnegative. Production now saturates the counter at four, preventing integer
  wraparound from reopening the immediate-recreation budget. The adapter also
  exercises 10,000 losses and an injected maximum counter as defensive regressions.
- Schedule admission covers every combination of the five broadcast classes,
  unlock/package/enabled Booleans and three lifecycle classes. Both actual
  callbacks assert that `admitAndStart` holds its monitor.

These helper scopes do not imply complete refinement of the larger model that
contains them. Remaining campaigns are bounded component correspondence.

## Actual source exercised

| Model | Executed entry points | Observed projection and remaining scope |
| --- | --- | --- |
| `ResidentRuntime` | `NativeProviderAdmission.bindCloudProvider`, `providerStatus`, renderer `stopLocalAgent`, `LocalAgentProtocol.connect` | Provider admission and actual renderer stop/cancel wrappers. Missing/incomplete shutdown status cannot resolve Stop. Late canceled startup does not publish a session. Native plugin/process lifecycle remains external. |
| `VoiceSession` | `VoiceAssistantSession.start`, listening callbacks, `setMuted`, `stop`, `recheck`, reply/playback callbacks | Phase, capture, mute, sent turn identity and completed sentence accounting. Dictation, semantic endpointing, reviewed resume and all barge-in schedules remain open. |
| `SpeechResources` | `LiveCaptureAdmission`, `SpeechPcmQueue`, `SpeechAudioFocusPolicy` | Late attachment cancellation, sample-count capacity/backpressure, buffer zeroing and focus transitions. The helpers run separately. |
| `AlwaysOnListener` | `ListenerPolicy.decide`, `holdsMicrophone`, `processesAudio`, `latchesIndicatorLoss` | Pairwise environment precedence and loss latching. Consent persistence, recognition epochs and service-owned capture remain open. |
| `ResetRecovery` | `ResetAuthorization.begin`, `confirm`, `authenticate`, `retire` | Activity-owned generation, confirmation and authorization result. Durable reset storage, retry orchestration and package erasure remain open. |
| `DeletionJournal` | `DeferredDeletionJournal.stage`, `expire`, `undo`, `list`, `acknowledge` | One persisted row, dispatch count, lost outcome, reload and acknowledgement. Coordinator identity, many-row scheduling and real providers remain open. |
| `MediaLifecycle` | `NativeReadEpoch`, `SelectedPhotoCopy.read`, `publish` | Epoch, readable scope/revision fence, exact copied bytes and publication guard. Catalog, editing, camera and video ownership remain open. |
| `DeviceActions` | `SmsSendJournal.beginDispatch`, `endDispatch`, callbacks, reload, `existing` | SMS durable intent, multipart result, delivery evidence, failed writes and no automatic repeat. Other device-action domains remain open. |
| `ApplicationComposition` | Owned by the root integration runner | Native component checks do not establish cross-domain implementation ordering. |
| `NavigationProgress` | `usableNavigationFix`, `atStep` | Fix validity classes and sparse-projection cursor preservation. Actual navigation closure, reroute timers and native service remain open. |
| `ListenerLeaseRecovery` | `IndicatorLease`, `CrashLoopBreaker` | Visibility/attribution inputs, generation, renewal, expiry, death/revoke and finite historical crash records. Persistent latch/consent and capture remain open. |
| `StreamingPlayback` | `StreamingSpeechPlayback` with its real queue/writer | Completion, partial writes, failed output, failed write, canceled opening, buffer release and terminal callback count. All possible thread schedules and native audio remain open. |
| `ResidentScheduling` | `ResidentScheduleRearm.decide`, `admitAndStart` | Complete finite decision table and monitor ownership. Actual service/receiver integration remains open. |
| `RendererRecovery` | `RendererRecoveryBudget.onLoss`, `delay` | Complete finite budget projection. Activity callbacks, escape rendering and Settings launches remain open. |
| `VadSegmentation` | `LiveVadGate.accept`, `close` | Complete finite gate projection. PCM generation/pre-roll and ASR transport remain external. |
| `VoiceIpcAssembly` | `BufferedStreamExchange.exchange` | Eight call/return schedules, response completion, malformed/oversized input, guard changes and successor preservation. Per-callback observations and deterministic deadline scheduling remain open. |
| `ListenerLeaseProducer` | `SenseListeningLease.start`, queued tick/delivery | Actual serial delivery, immutable supplied snapshots, target refusal and generation retirement. Actual controller/view measurements remain open. |

The Java trace utility performs serialization and read-only field observation.
Expected results come from source execution. It does not evaluate a copied
version of the policy. Test ports supply external outcomes such as provider
responses and measurements. Multi-action checkpoints represent one source call
or one joined writer execution. Intermediate model states in those macros have
no corresponding source observation in this campaign.

## External obligations

No campaign performs network provider calls, sends SMS, records a microphone,
opens another application or clears package data. Real Android/Binder identity,
permission/lifecycle delivery, filesystem power-loss behavior, media-provider
effects, AOSP SystemUI visibility and physical audio evidence require their
respective implementation/device tests. The returned obligation list names
unexecuted model transitions separately so a passed projection cannot silently
count as full application refinement.

## Notes source campaigns

The four Notes campaigns run the current product recorder, foreground service and complete
Notes bridge methods, plus the patched shared `LocalVoiceRecording`. They bind native patch
provenance and every generated platform adapter input before source execution. The service
campaign exercises failed stop-command launch, exact start-ID retirement, stale recording
callbacks and Android refusal when a newer start is pending. Recorder recovery keeps unreadable
or incomplete recordings and refuses replacement capture until recovery is resolved.

Bridge-parent lifecycle and permission behavior, service scheduling, media encoding and
protected-surface observation are controlled external inputs in these campaigns. Their receipts
claim the observed Notes transitions. The shared parent bridge and physical audio remain covered
by their corresponding integration and device gates.

## Shared recording source campaigns

The shared recording campaign executes the full `LocalSpeechBridgePlugin` and
`LocalVoiceRecording` through permission return, queued startup, call interruption and
cancellation completion. The live capture campaign also executes `LiveCaptureController`,
`LiveVoiceCapture`, `LiveCaptureAdmission` and `LiveCaptureResource`, separating capture
construction from publication to exercise late call, stop, replacement and lifecycle races.
The current native patch manifest binds every compiled patched source. These bounded
non-piped campaigns use controlled media primitives and fix protected-screen state inactive.
Provider enrollment, device audio and Android permission delivery remain external obligations.

## ASR pipe state

`asr-pipe.mjs` executes the current staged `LiveSegmentPipe` against a serial
worker and an owner-bound provider port. `AsrPipeTraces` reads its actual queue,
flags, cutoff and futures. Provider-post history supplies the dispatched frame
and VAD membership mask, with the cutoff observed at that posting boundary.
Source operations are suspended at provider requests and checked after their
stable return or future completion. No source queue or response algorithm is
reimplemented by the driver.

The finite scenarios cover maximum queue admission, frame-count and exact JSON
character limits, copied payload isolation, FIFO delivery, independent timestamp
filtering, NaN, malformed input/response, recoverable ASR failure, owner retirement,
discard and close acknowledgment. The executor-refusal regression retains the
cancellation or listener exception while guaranteeing completion of the public futures. The
actual controller-to-pipe join and full native transport have separate scopes.

## Piped capture coordinator

`piped-capture.mjs` executes the complete shared bridge and real capture, resource
and ASR-pipe implementations together. Provider replies are suspended at real
transport calls. The actual AudioRecord constructor is held until the model
observes successful ASR readiness. Source frame callbacks pass through the
controller, which forwards PCM to the pipe and only metadata to the renderer.
The observer reads actual reservation flags, controller references, public pipe
futures and bridge results. Its close reason names the outstanding source call
or lifecycle cleanup that is awaiting the provider.

The fourteen bounded schedules include recoverable and terminal provider
failures, explicit discard, late warmup and both kinds of owner retirement.
Installed Android delivery and the product's actual resident credential/IPC
transport remain external integration obligations. The provider response and
physical audio ports perform no real network or microphone effects.

## Capture frame buffering

`capture-frames.mjs` drives the real patched `LiveVoiceCapture`, `LiveVadGate`
and `LiveCaptureResource`. Its source and detector ports provide one distinct
PCM marker per window and record actual positive read calls and detector inputs.
Every source checkpoint waits until the next blocking read or the terminal sink,
so the observed packet list belongs to a completed window. Packet frames are
decoded from the actual base64 payload; the model computes its own expected
pre-roll and emission history. No copy of the VAD algorithm runs in the adapter.

The source, detector and Android base64 ports retain the actual reusable short,
float and byte array references for terminal zeroing checks. A before/after
source probe shows that failed release previously left buffers uncleared and
omitted the terminal callback. The patched source clears them and reports the
capture failure. Clock timestamps, arbitrary PCM and detector accuracy are not
in this finite equality projection.

### Indicator provider admission

`indicator-provider.mjs` executes the complete staged `IndicatorLeaseProvider`
with the real `IndicatorLease` and `ListenerPolicy`. `IndicatorProviderTraces`
reads private source fields and returned Bundles. Android identity, package
signing, clocks, Binder handles and the `Listener.refresh` destination are
controlled ports in `indicator-provider-platform.mjs`. All nineteen model fields
and six entry actions have source observations. The authority and lease payload
are synthetic.

`IndicatorProviderProbe` separately holds the real provider monitor while two
acquire calls reach it. Its final assertion checks actual captured callback
identity, including across repeated replacement. This regression identified the
source race fixed by `indicator-provider-generation.patch`. Native staging
includes the exact shared Sense module and the product Gradle wrapper consumes
that staged source. The full `ListeningService` reaction to refresh remains a
separate coordinator obligation.

### Listener consent and durable settings

`listener-store.mjs` compiles the actual shared store, epoch and crash breaker.
`StorePorts` implements the external preferences API with independently observed
memory and disk maps. Its four commit outcomes preserve successful persistence,
failed disk acknowledgement, an early exception and a lost acknowledgement after
durable persistence. `ListenerStoreTraces` observes source fields and getters;
a fresh JVM reads the disk file for each restart checkpoint. The retained history
includes eight entries and malformed input normalized by the actual decoder.

The settings coordinator is bounded to serialized source calls. Android's real
SharedPreferences implementation, stopService acceptance, unrestricted concurrent
writers and the service's reaction remain explicit obligations. This campaign
adds no runtime source patch.

### Shared listener service lifecycle

`listener-service.mjs` runs the complete shared listener/service implementation
with the actual settings, lease and policy helpers. `listener-service-platform`
provides Android primitives and an externally held ASR allocation. It records
actual callback registration, foreground calls, AudioRecord state and engine
close effects. The observer reads every lifecycle model field from source objects and
platform-port observations.

The release regression compares the original and patched source. Both release-only
and combined stop/release failures now allow destruction to retire callbacks and
the recognizer. A failed release remains an owned resource with its durable
marker, and another start cannot overwrite that reference. The campaign checks a
later successful release and capture restart. `listener-admission-probe.mjs`
drives a memory-only failed open-session commit and observes that capture, the
recognition epoch and a new engine load remain off. Installed Binder/audio behavior,
physical release acceptance and arbitrary callbacks remain external obligations.

### Speech warm-up writer and recognition availability

`speech-warmup.mjs` executes `SpeechOutputWarmup` from authenticated product
staging. The actual writer thread owns its output. Primitive ports observe
open/play/write/abort/release, and hold open or write while close runs.
`recognizer-availability.mjs` executes the shared cache and concurrent probe
callbacks directly. A held provider reply exposes actual ticket ordering,
including an old installed answer after a newer authoritative or unanswered
result. Source `known` and `available` calls check exact expiry and demotion.
Neither campaign uses a real microphone, installed speech service or output.

### On-device recognition session

`on-device-recognizer.mjs` runs the staged recognizer, real cache and worker
with the pinned upstream scripted Android recognizer and audio pipe. Each JVM
holds one active session. It observes exact byte counts, stalled writes,
backlog, first-result publication, cancellation and resource release. A held
main queue delivers a missing-language callback after cancellation was requested
and before the cancellation response executes. The callback preserves the
installed-language cache. `recognizer-retirement.mjs` also compares retirement
after an answer, retirement after cancellation and an active language failure.

These checks execute the patched shared class at its native plugin boundary.
The platform ports carry synthetic PCM and transcript classes. The runner
records settled cleanup rather than assuming that Android accepted real device
or service resource release.

### Listener input and wake callbacks

`listener-input.mjs` drives actual callback registration and audio reads, with
the current service, store, epoch, lease, SpeechGate and WakePhrase classes.
`ListenerInputTraces` records the pending read's epoch at the PCM port boundary,
actual received lengths, the ASR call boundary and retained PCM reference, and
the queued wake closure and ticket. The controlled port delays a fresh capture's
first read until start admission settles. On a retained capture, the pending
read's original ticket stays visible across privacy and playback changes.
Source traces include a held ASR reply and a queued wake callback across call,
playback and destruction, plus visible notification and lease loss boundaries.

### Listener adaptive speech gate

`speech-gate.mjs` runs the actual shared `SpeechGate` with fixed PCM classes.
The observer reads its RMS and adaptive floor, classifier result, physical ring
slots, utterance buffer and sink arrays. Source-side input reuse after each call
checks that retained audio owns its frame copy. Multi-frame checkpoints retain
every actual input and rounded floor observation. They cover ring wrap,
interrupted opening, short-turn discard, silence trimming, the exact 400-frame
cap, reset, invalid inputs and steady-noise adaptation.

`speech-output-preparation.mjs` executes the staged `SpeechLeadTrim` and
`FirstWriteSpeechOutput` under a single writer. It reads the bridge's configured threshold
and lead size from the authenticated stage and observes retained samples, caller zeroing,
returned array identity, report-before-write order, and write/delegate results. It checks
the current production-sized buffer and controlled quiet, threshold, NaN and infinity
classes. Real audio hardware and arbitrary PCM histories remain outside this campaign.

`batch-capture-completion.mjs` executes the exact renderer capture helper with a read-only
observer and controlled Capacitor replies. The held-start schedules observe the early
callback map, exact acknowledgment and terminal outputs before the shared conversation
loop consumes them. The existing voice-call tests exercise the full renderer and shared
loop together with the same external port boundary.
