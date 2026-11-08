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
| `ResidentRuntime` | `LocalAgentProviderAdmission.bindCloudProvider`, `providerStatus`, renderer `stopLocalAgent`, `LocalAgentProtocol.connect` | Provider admission and actual renderer stop/cancel wrappers. Missing/incomplete shutdown status cannot resolve Stop. Late canceled startup does not publish a session. Native plugin/process lifecycle remains external. |
| `VoiceSession` | `VoiceAssistantSession.start`, listening callbacks, `setMuted`, `stop`, `recheck`, reply/playback callbacks | Phase, capture, mute, sent turn identity and completed sentence accounting. Dictation, semantic endpointing, reviewed resume and all barge-in schedules remain open. |
| `SpeechResources` | `LiveCaptureAdmission`, `SpeechPcmQueue`, `SpeechAudioFocusPolicy` | Late attachment cancellation, sample-count capacity/backpressure, buffer zeroing and focus transitions. The helpers run separately. |
| `AlwaysOnListener` | `ListenerPolicy.decide`, `holdsMicrophone`, `processesAudio`, `latchesIndicatorLoss` | Pairwise environment precedence and loss latching. Consent persistence, recognition epochs and service-owned capture remain open. |
| `ResetRecovery` | `ResetAuthorization.begin`, `confirm`, `authenticate`, `retire` | Activity-owned generation, confirmation and authorization result. Durable reset storage, retry orchestration and package erasure remain open. |
| `DeletionJournal` | `DeferredDeletionJournal.stage`, `expire`, `undo`, `list`, `acknowledge` | One persisted row, dispatch count, lost outcome, reload and acknowledgement. Coordinator identity, many-row scheduling and real providers remain open. |
| `MediaLifecycle` | `NativeReadEpoch`, `PhotoAttachmentSource.read`, `publish` | Epoch, readable scope/revision fence, exact copied bytes and publication guard. Catalog, editing, camera and video ownership remain open. |
| `DeviceActions` | `SmsSendJournal.beginDispatch`, `endDispatch`, callbacks, reload, `existing` | SMS durable intent, multipart result, delivery evidence, failed writes and no automatic repeat. Other device-action domains remain open. |
| `ApplicationComposition` | Owned by the root integration runner | Native component checks do not establish cross-domain implementation ordering. |
| `NavigationProgress` | `usableNavigationFix`, `atStep` | Fix validity classes and sparse-projection cursor preservation. Actual navigation closure, reroute timers and native service remain open. |
| `ListenerLeaseRecovery` | `IndicatorLease`, `CrashLoopBreaker` | Visibility/attribution inputs, generation, renewal, expiry, death/revoke and finite historical crash records. Persistent latch/consent and capture remain open. |
| `StreamingPlayback` | `StreamingSpeechPlayback` with its real queue/writer | Completion, partial writes, failed output, failed write, canceled opening, buffer release and terminal callback count. All possible thread schedules and native audio remain open. |
| `ResidentScheduling` | `ResidentScheduleRearm.decide`, `admitAndStart` | Complete finite decision table and monitor ownership. Actual service/receiver integration remains open. |
| `RendererRecovery` | `RendererRecoveryBudget.onLoss`, `delay` | Complete finite budget projection. Activity callbacks, escape rendering and Settings launches remain open. |
| `VadSegmentation` | `LiveVadGate.accept`, `close` | Complete finite gate projection. PCM generation/pre-roll and ASR transport remain external. |
| `VoiceIpcAssembly` | `NativeVoiceIpc.exchange` | Eight call/return schedules, response completion, malformed/oversized input, guard changes and successor preservation. Per-callback observations and deterministic deadline scheduling remain open. |
| `ListenerLeaseProducer` | `AlphaListeningLease.start`, queued tick/delivery | Actual serial delivery, immutable supplied snapshots, target refusal and generation retirement. Actual controller/view measurements remain open. |

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

## Product Notes permission boundary

`note-bridge.mjs` compiles the complete product `AlphaVoiceCloudPlugin` with real
`AlphaNoteRecorder`, `AlphaNoteRecordingService` and staged `LocalVoiceRecording`.
`NotePermissionTraces` observes the actual private foreground field, caller result,
recording status, successful media starts and controlled pending callback queue.
`note-bridge-platform.mjs` supplies the parent lifecycle and permission interface;
unrelated speech transports throw if reached. The campaign is conditional on that
interface and does not execute the shared parent's implementation.

The queued start and resume methods previously admitted capture after a phone call
began. Resume also admitted it after the product host paused or the parent retired.
The product now rechecks those boundaries inside each queued opening callback.
`NativeNotePermission` retains admission-time witnesses so later pause/call changes
do not rewrite a previously valid start. Twenty-two real-source schedules cover
all declared state fields and actions. Device microphone enforcement and concurrent
permission requests remain explicit obligations.
