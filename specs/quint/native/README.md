# Native application models

These finite models describe Alpha-bound protocol boundaries in the current
working source. The source lists, named invariants, scenarios and bounds are in
[manifest.json](manifest.json). Each exposes `init`, `step` and `safety`.

The manifest distinguishes product `sources` from `sharedSources` under the
reviewed Eliza pin. Native speech, listener policies, reset authorization, media
catalogs and deletion journals now use their shared owners. The Java conformance
adapters compile those current packages alongside Alpha's remaining host policies.

The authenticated `cloud-speech-native.patch` also supplies the bounded silent
output-warmup holder. Its close/play serialization, timeout and retirement on
first audio, cancellation and lifecycle loss have separate JVM coverage in
`test/speech-output-warmup.test.mjs`. `SpeechResources` and `StreamingPlayback`
represent capture and audible reply playback. Complete native-audio resource
refinement remains an additional obligation.

## Source correspondence

| Model | Source symbols inspected | State represented |
| --- | --- | --- |
| `ResidentRuntime` | `LocalAgentProviderAdmission.bindCloudProvider`, `applyProviderEnvironment`, `providerStatus`, `ResidentCredentialShutdownRetry.await`, `ResidentScheduleRearm.decide`, renderer `residentRecoveryReason` | Local resident lifecycle, source admission, exact credential generation, uncertain unbind, retained recovery records, reset fence |
| `VoiceSession` | `VoiceAssistantSession.start`, `stop`, `setMuted`, `speechStarted`, `schedule`, `submit`, `respond`, `resume`, `playSentence`, `createNativeLiveDictation`, `createCloudVoice` | Session/turn/utterance generations, semantic and long-gap endpointing, busy capture hold, mute, explicit speech interruption, completed-sentence accounting, separately reviewed read response and local dictation |
| `SpeechResources` | `LiveCaptureAdmission.begin`, `attach`, `stop`, `cancelAll`, `SpeechAudioFocusPolicy.changed`, `stopsCapture`, `SpeechPcmQueue.offer`, `take`, `close` | Capture reservation and late startup, one capture owner, transient focus/duck/loss, bounded PCM queue and canceled stream |
| `AlwaysOnListener` | `ListenerPolicy.decide`, `holdsMicrophone`, `processesAudio`, `latchesIndicatorLoss`, `IndicatorLease.renew`, `verdict`, `ListeningEpoch.current`, `ListenerStore` consent generation | Consent, visibility, unlock, call/privacy, SystemUI lease, explained pause, sticky indicator loss and queued recognition invalidation |
| `ResetRecovery` | `ResetAuthorization.begin`, `confirm`, `authenticate`, `retire`, shared `DataReset.record`, `attempt`, `automaticAttemptAllowed`, `recordFailure`, `admitAndExit` | Activity-bound approval, durable pending marker, listener-first reset, bounded automatic retry, recovery surface, accepted dispatch and externally observed erasure |
| `DeletionJournal` | `DeferredDeletionJournal.stage`, `undo`, `expire`, `list`, `acknowledge`, shared `DeferredDeletionCoordinator.reconcile`, `stageOwnerCurrent` | Durable intent, monotonic Undo window, changed boot, exact owner/source admission, dispatch uncertainty and retained no-replay receipt |
| `MediaLifecycle` | `NativeReadEpoch.current`, `PermittedMediaCatalog`, `SelectedPhotoCopy.read`, browser `beginPhotoEdit`, `savePhotoEdit`, `cancelPhotoEdit`, `resultPhotoEdit` | Per-item permission, lifecycle/source revision, selected read, reviewed output, canceled temporary capture and active playback |
| `DeviceActions` | `SmsSendJournal.beginDispatch`, `endDispatch`, `sentResult`, `status`, `existing`, telephony read epoch checks, `retainReminderCreation`, `checkReminderCreation`, `reconcileReminderCreations`, shared `ClockHandoff` | Image/permission/SIM gates, exact reviewed SMS binding, durable dispatch, multipart evidence, retired operation id, stale contacts, reminder creation recovery and revision-bound notification |
| `RendererRecovery` | `RendererRecoveryBudget.onLoss`, `MainActivity.onRenderProcessGone`, delayed recreation and stock Settings actions | Three immediate losses, exact 60-second window, five-second backoff, HOME escape, duplicate callbacks and activity ownership |
| `VadSegmentation` | `LiveVadGate.accept`, `close` | Two high windows to open, sixteen low windows to close, hysteresis thresholds, nonfinite values and counter reset |
| `VoiceIpcAssembly` | `BufferedStreamExchange.exchange` | Handle ownership, deadline, response/chunk assembly, size limit, completion validation, first failure and cleanup |
| `ListenerLeaseProducer` | SystemUI `SenseListeningController`, `SenseListeningLease` | Measured eligible surfaces, queued acknowledgements, target validation, client generation and lease retirement |

The reviewed source paths are listed as repository-relative paths in the
manifest. Every callback accepting an identity has matching and stale scenarios.
The models leave external results nondeterministic where source cannot know an
outcome, including provider dispatch, storage failure and native acknowledgement.

## Composed application boundaries

`ApplicationComposition` instantiates the actual `IdentitySession`, `VoiceSession`,
`ResidentRuntime`, `CalendarSync`, `InboxDelivery` and `ResetRecovery` modules. It
invokes their transitions and safety predicates with explicit frame assignments
for the unaffected components. Small constant-instantiated wrappers give each
module's internal `s` a distinct qualified identity in Quint's effect checker.
The wrappers preserve the imported transitions and export only the symbols used
by the composition.

The host adds foreground state and the account/epoch captured at voice start.
Committing a sign-in replacement retires voice and provider work while switching
Calendar/Inbox owners through their existing actions. Reset applies the real
model's marker transition together with resident stop and Inbox permission
withdrawal. Lifecycle pause invokes the imported voice stop transition. Late
voice/provider callbacks therefore exercise their imported generation checks.
Expected-rejection tests execute the imported Calendar/Inbox guards after account
retirement and reset. An intentionally uncoordinated identity transition appears
only in a canary scenario, where it must violate shared safety.

These boundary actions express the intended product integration contract.
Per-component source mappings and the executable Java policy replay establish
narrower correspondence evidence. Cross-domain implementation refinement remains
an additional obligation.

## Deliberate abstractions

Each model represents one process, operation or selected item. The model does not
encode an unbounded database, arbitrary text, audio samples, pixels or provider
payloads. Identity and revision equality stand for the exact validated hashes and
credentials used by the implementation. Counter limits stop generation-advancing
actions at their bound. They never wrap and accidentally accept a stale ticket.

`ResidentRuntime` retains one history marker through crash/recovery and abstracts
source provenance and credential parsing to admitted/refused inputs. `VoiceSession`
uses up to two spoken sentences, four submitted turn generations and a separate
utterance generation. The successful start action summarizes the awaited capture
opening. `SpeechResources` models the pending native reservation separately and
checks that a late opening cannot resurrect canceled capture. Voice errors retire
the session through Stop. Submitted turns keep capture closed until playback
settles. Explicit speech interruption and its playback drain are separate model
transitions. Dictation produces an editable draft.

`AlwaysOnListener` merges explained display-off, fullscreen, shade and transition
pauses into one state. Lease freshness summarizes the monotonic deadline,
SystemUI attribution and boot checks. A silenced recording can remain open to
observe its release, while its frames stay unprocessed. An unexplained lease loss
while recording is sticky until explicit resume. Its `decision`, `microphone` and
`analyzing` fields are projections computed by Quint for implementation replay.

`ResetRecovery` keeps accepted Android dispatch and observed erasure separate.
The three-attempt budget represents one retry window. The model includes unreadable
budget state and explicit user retry. It assumes the documented atomic marker-write
result and does not establish filesystem atomicity for Android's package clear.

`DeletionJournal` models one row and atomic journal writes. Count/byte admission,
multi-row scheduling and provider-specific deletion semantics are outside that
row abstraction. Unknown and dispatching outcomes are retained. A dismissed
unknown result does not reset dispatch authority.

`MediaLifecycle` combines full and per-item selected access with current-item
admission. Mixed media categories and catalogs containing many items use this
same boundary independently. Its publication fields retain the reviewed revision
and admission facts at the time of publication. Subsequent revocation does not
rewrite the history of a previously completed publication.

`DeviceActions` uses one SMS operation, at most two parts, two SIM/text identities,
one reminder and three reminder revisions. A permanent retired-id marker models
the journal's tombstone and Bloom-filter no-false-negative contract. Provider
completion is distinct from receiving a delivery callback, and multipart delivery
stays unconfirmed. Reminder `posted` means a notification was posted. Clock remains
a handoff to a separate Android app. Calendar/time-zone recurrence calculations,
carrier behavior and arbitrary provider records are outside this finite abstraction.

## Running the checks

From the repository root, a single model can be checked with the pinned executable.

```sh
node_modules/.bin/quint typecheck specs/quint/native/VoiceSession.qnt
node_modules/.bin/quint test specs/quint/native/VoiceSession.qnt --backend=typescript --seed=1701 --max-samples=1
node_modules/.bin/quint run specs/quint/native/VoiceSession.qnt --backend=typescript --invariant=safety --seed=1701 --max-samples=300 --max-steps=60
node specs/quint/native/conformance.mjs
```

The 98 deterministic scenarios exercise accepted, denied, canceled, stale,
unknown-outcome and restart paths. The runtime models make no unconditional
liveness claim about services or user decisions. Stuttering is permitted.

`conformance.mjs` requires JDK 21, matching the repository's Android build toolchain.
It emits temporary ITF traces from all five listener scenarios and 32 seeded
sampled traces. It replays each observed state through the actual pure Java
`ListenerPolicy.decide`, `holdsMicrophone` and `processesAudio` methods and compares
their results to projections evaluated by Quint. It also exercises actual
`ResetAuthorization` single-use/stale approval and `SpeechAudioFocusPolicy`
duck/regain/loss methods. Temporary fixtures and compiled classes are removed.

A successful replay establishes correspondence for those concrete policy inputs.
It does not establish a refinement proof, native capture release, Binder/process
ordering, Android permission behavior or physical microphone visibility. The
remaining native integration and device acceptance gates in the repository still
apply. No provider, credential, microphone or device action is performed by these
checks.

## Additional native protocol detail

`NavigationProgress` follows the current shared Maps screen, route controller and
background-navigation owner. Maneuver guidance advances only inside 40 m, and
arrival requires distance below 25 m and accuracy no worse than 30 m. A stored
fix can age without another callback. Explicit reroute rechecks its freshness,
and a provider error ends guidance. End retires guidance while allowing the
already requested route to finish in directions. Release aborts that request.
Late background replies clean up their exact session, including a second stop
command after a retired native Start finally succeeds. Dragging disables follow
until recentering or Start. A hidden watch whose pending background startup
is refused releases immediately unless a permission prompt still owns the
screen. A refusal from an older session cannot release its replacement.

`NativeNavigationOwnership` follows the Java Maps bridge and foreground service.
A renderer can retire only its session. Commands and notification Stop actions
carry an internal authority that survives a reused public route ID. Delayed START
commands meet the foreground-service boundary without replacing the current
instruction or removing a successor. The JVM campaign controls Android delivery
and rejection. A task-removal callback must name the Activity component that started
the live lease, including a resolved HOME root. This check treats roots that
share a component alike. Android supplies the root intent without a task ID.
Installed notification and task-delivery behavior remain separate.

`ListenerLeaseRecovery` models the actual lease and recovery mechanisms behind
`AlwaysOnListener` policy inputs. Lease acquire, acknowledgement, monotonic expiry,
replacement, revoke, process death and boot identity are distinct transitions.
SystemUI surface/chip visibility and microphone attribution are checked with the
2.5 second grace period. An unknown display state depends on the listener's own
screen observation. Restored crash records use the exact ten-minute window,
three-crash threshold, installation/boot markers and sticky trip state. A clean
shutdown, package update, new known boot or revoked microphone permission has a
separate outcome. The current store also requires fresh process consent after a
restart, and that consent clears saved crash history.

`StreamingPlayback` covers writer opening, pending output, partial and zero writes,
synthesis stalls, produced/written/played frames, platform drain, audible timestamp
and fallback evidence, stop/failure races and exactly one terminal callback.
Stopped playback has no owner-completion callback. Output release is a separate
cleanup action, so a canceled opening and an interrupted writer remain observable.

`ResidentScheduling` represents every ordered result of
`ResidentScheduleRearm.decide`. Broadcast admission and Start share one atomic
transition, while provider mutation and stop use the competing lifecycle lock.
A running resident receives no duplicate Start, locked/unpackaged/disabled builds
stay stopped, and process-local Stop can be followed by rearm after process death.
Its canary deliberately separates admission from Start and detects the resulting
lifecycle race.

The Java conformance runner additionally exercises real `IndicatorLease`,
`CrashLoopBreaker` and `ResidentScheduleRearm` methods, including lease expiry,
retired token rejection, boot/install crash exclusions, exact crash-window expiry
and a same-lock assertion for both rearm admission and Start.

## Native validation record

On 2026-11-07, the four additional modules `NavigationProgress`,
`ListenerLeaseRecovery`, `StreamingPlayback` and `ResidentScheduling` passed
Quint 0.33.1 typechecking and 1,000 seeded simulations each, up to 80 transitions
per trace with the TypeScript backend and seed 1701. They also passed Apalache
0.62.4 bounded symbolic safety checking through four transitions on a dedicated
local checker endpoint. The final navigation rerun included pending bridge
registration and confirmed background-service state.

```sh
node_modules/.bin/quint verify specs/quint/native/NavigationProgress.qnt --max-steps=4 --invariant=safety --server-endpoint=localhost:8846
```

The initial native package had 13 models and 98 own scenario tests. The composed
model passed 300 seeded traces through 80 transitions. The other original native
domain models passed 300 traces through 60 transitions. These are distinct
bounds and evidence classes.

The conformance command passed 1,992 emitted listener states, 6,013 Java
assertions and ten TypeScript navigation boundary assertions. The Java assertions
include direct policy-method cases in addition to the listener trace projection.
They execute local source code and synthetic model inputs.

## Initial native bounded proof sweep

The initial revisions of all 13 native models passed four-transition Apalache safety checks on
2026-11-07. The local machine-readable record is
`test-results/quint-native/proof-results.json`. It records full specification
hashes, composition dependency hashes, tool versions, commands, wall-clock and
checker-reported duration, status and per-attempt logs. Every captured source hash
was unchanged at completion.

| Model | Checker time | Final status |
| --- | --- | --- |
| `ResidentRuntime` | 42.489 s | Passed |
| `VoiceSession` | 37.842 s | Passed |
| `SpeechResources` | 20.210 s | Passed |
| `AlwaysOnListener` | 34.083 s | Passed |
| `ResetRecovery` | 36.545 s | Passed |
| `DeletionJournal` | 33.389 s | Passed |
| `MediaLifecycle` | 27.119 s | Passed |
| `DeviceActions` | 52.274 s | Passed |
| `ApplicationComposition` | 26.187 s | Passed |
| `NavigationProgress` | 17.537 s | Passed |
| `ListenerLeaseRecovery` | 17.466 s | Passed |
| `StreamingPlayback` | 9.371 s | Passed |
| `ResidentScheduling` | 12.386 s | Passed |

The first ResetRecovery attempt lost its checker connection. The first
MediaLifecycle attempt timed out while waiting for the checker server to become
ready. Both failures and their original logs are retained. Fresh isolated-endpoint
retries passed, with no specification changes. VoiceSession wall time includes
a deliberate resource-scheduling pause while the legacy Calendar check finished.
Its checker execution time is recorded separately.

These results establish safety for the stated four-transition bound. The longer
seeded simulations, scenario tests, source-policy replay and application/device
acceptance remain separate evidence.

## Final review expansion

The four additional models above separate state previously hidden behind domain
inputs. `ApplicationComposition` also adds MFA, cancellation, acknowledgement
recovery, resident recovery, voice review/dictation, Calendar resolution, Inbox
receipt cleanup and coordinated process restart. It remains a scoped composition
of six domain projections. Each Calendar and Inbox projection follows one durable
operation, preserving retired operations across account changes.

The renderer/VAD conformance runner replays Quint states through the actual
`RendererRecoveryBudget` and `LiveVadGate` Java classes. Separate counter-state
initializers allow bounded checking at the renderer-loss and VAD-close boundaries.
The final package has 17 models and 150 registered scenarios. All current models
passed four-transition symbolic safety checks. The expanded composition passed
27 scenarios and 1,000 traces through 80 transitions. The renderer/VAD replay
passed 12,085 Java assertions over 5,361 emitted states.

The current proof index is `test-results/quint/final-proof-index.json`. It links
the expanded composition, four new models and corrected IPC successor-ownership
invariant to their current receipts. The repository verification report records
the detailed bounds and provenance.

## Notes native contracts

`NativeNoteRecording` follows bounded segmented capture, pause accounting, durable journal
prefixes and restart. Its `recoveryBlocked` state reflects retained unreadable recordings that
prevent a new capture. `NativeNoteRecordingService` follows notification ownership and service
start IDs, including a refused fallback stop when Android has a newer start pending.

`NativeVoiceDraft` follows the shared draft recorder, delayed callbacks, external segment
selection and cleanup when constructing a MediaRecorder fails. `NativeNotePermission` follows
the product Notes bridge through queued admission, permission return, foreground retirement
and active-call refusal. The source campaigns use controlled Android inputs and synthetic audio.
Microphone, codec, foreground-service eligibility and device acceptance remain separate gates.

## Shared recording and live capture

`SharedRecordingAdmission` follows the complete shared bridge's draft capture entry points,
permission epochs, late call checks and cancellation barriers. A call retires the draft before
release. If release throws, its recorder stays unavailable until cancellation retries cleanup.
`NativeLiveCapture` follows
reservations, physical-source startup, publication, interrupted final events and teardown.
Both run current patched shared Java with controlled Android audio and permission inputs.
Protected-screen state is fixed inactive in these projections. Provider piping, physical
audio and installed Android scheduling require their separate acceptance checks.

`NativeAsrPipe` covers the shared `LiveSegmentPipe` worker, readiness and close
futures, eight-batch queue, serialized JSON copies, per-frame and per-VAD cutoff,
provider ownership checks and transcript/error replies. Frame and VAD timestamps
use independent membership bits. NaN cutoff remains NaN and therefore forwards
no timed items. A canceled warm request can still complete readiness successfully;
the capture controller must apply its own current-ticket guard.

The source campaign suspends at actual provider posts and compares completed
source operations, including future settlement. Transient instruction-level
ordering between the private `finished` flag and `closed.complete` is inside one
completion observation. Rejected-worker settlement now runs even when cancellation or the
failure listener throws. ASR_FAILED remains a recoverable per-response outcome;
transport failures close the pipe. These bounded checks use one worker start and
at most three posted batches/transcript results. Controller composition and
physical/native transport remain separate obligations.

`NativePipedCapture` checks the real join between shared bridge admission,
`LiveCaptureController`, `LiveVoiceCapture` and `LiveSegmentPipe`. Fourteen source
schedules cover provider warmup before microphone opening, late warmup after
pause/destruction, call entry while opening, provider retirement, recoverable
ASR failures, metadata-only renderer frame events and acknowledged/unconfirmed
pipe closure. A failed pipe can remain referenced by its controller until an
explicit Stop cleans it up, even after its physical source stopped.

The model uses one initially valid owner-bound pipe, two frame events and two
transcript results. The provider and physical AudioRecord are controlled ports.
The detailed pipe queue/response state has its own `NativeAsrPipe` projection;
these coordinator observations add the ordering between that pipe and capture.

`NativeCaptureFrames` covers the actual `LiveVoiceCapture` loop's input/output
state. Its observed history contains the detector inputs that were consumed;
a pure model fold derives VAD counters, the ten-window pre-roll, three-window
emission cadence and unflushed frames. Actual emitted packets carry distinct PCM
window markers, so packet membership and ordering are checked independently of
the model calculation. Stop flushes pending speech frames; a read failure drops
that unreported tail. The private running flag remains set after a read error
until Stop, even though the source and detector have closed.

Normal, interrupted and failed cleanup paths observe the actual short, float
and byte buffers and detached source ownership. The campaign includes partial
reads, exact threshold windows, non-finite and absent detector output, both
cleanup failures and the previous cleanup regression. Physical inference and
microphone timing remain external inputs.

`NativeIndicatorProvider` covers the real `IndicatorLeaseProvider.call` boundary
and the `IndicatorLease` fields it changes. The generation counter and active
Binder death recipient are admitted under the same monitor. The source regression
holds that monitor while two real public calls arrive, then compares the actual
lease generation with the generation captured by the linked callback. The old
source mismatched in 31 of 32 recorded schedules. The patched source matched in
all 32 schedules; bounded symbolic checking covers the finite transition model.

Twenty-seven source schedules cover failed caller authority, missing arguments,
lease replacement, old death callbacks after unlink failure, reuse of a Binder,
already-dead tokens, stale renewal/revocation, expiry, reboot and nine visibility
report classes. A revoked lease retains its registered death link until a later
acquisition. The model preserves that source behavior. Three lease generations
and three Binder identities bound the campaign. The actual listener convergence
method, operating-system Binder behavior, platform signing and SystemUI visibility
remain external acceptance obligations.

The Sense module is now included in authenticated native staging, and its shared
consumer Gradle script obtains `src/main` from that staging. The standalone and
launcher host descriptors include the same product listener project. Assertions
check this configuration for its debug/release builds. These checks do not
constitute an APK build or installed AOSP acceptance.

`NativeListenerStore` observes the actual shared `ListenerStore`,
`ListeningEpoch` and `CrashLoopBreaker`. Separate memory and durable preference
records preserve the outcome when a commit changes memory but fails to persist,
or durably writes and then throws. The failed-write latch gates consent getters
until a successful reset. Reset retires old consent generations and still
requires a new explicit opt-in. Restart observations execute a fresh JVM against
the stored fixture file, including a retained open-session marker after a failed
close. Persisted consent alone remains insufficient in that new process.

The model also covers timed and indefinite pauses across boot changes, epoch
retirement, explicit clearing of speech/indicator/crash stops, all eight retained
crash entries, malformed legacy history, permission-revoked starts and package
updates. Store calls are checked at serialized method boundaries with controlled
SharedPreferences outcomes. Concurrent arbitrary preference writers, real
filesystem power loss and whole-service stop acceptance remain external to this
component campaign.

`NativeListenerService` executes the shared `Listener`, `ListeningService`,
`ListenerStore`, lease and policy together for service creation, capture startup,
ASR allocation, pause, disable and destruction. Its source regression showed that
an `AudioRecord.release()` exception escaped destruction before audio callbacks,
the ASR engine, executor and superclass lifecycle were cleaned up.
`listener-service-cleanup.patch` now completes those lifecycle steps, retains an
unreleased record, preserves its durable open marker and refuses a replacement
capture while that handle remains. A later Stop can retry the release. When the durable open-session marker is
refused, the service now keeps recognition inactive and does not load a new
ASR engine. The memory-only marker and the durable marker are observed
separately.

Fourteen source schedules observe all thirty-four lifecycle fields. They include
successful and failed release, a failed stop plus failed release, retry, attempted
replacement, late service start, and ASR allocation completing after destruction.
Physical recording and confirmed resource release are separate observations. A
failed stop and release can leave the synthetic AudioRecord active; the model
preserves that uncertainty while checking callback and executor retirement.

The component uses one explicitly opted-in service instance, a fresh visible
lease and at most two recording allocations. Notification visibility, AudioRecord
and ASR allocation are controlled platform ports. Arbitrary recording/playback
callback interleavings, frame content and installed Android scheduling remain
separate from these lifecycle traces.

`NativeSpeechWarmup` covers the silent speech-output writer added by the
current product streaming patch. It observes the actual writer, late factory
return, play and write failure, close while blocked, duplicate close, and
release attempts. The injected clock crosses the 15 second boundary exactly.
An abort/release attempt is separate from confirmation that a physical track
has closed. Full bridge admission and the installed audio path are outside this
component projection.

`NativeRecognizerAvailability` covers the shared per-language cache. It
observes entries, real probe tickets, held concurrent probes, late answers,
cache lookups and demotion deadlines. Authoritative and unanswered results have
different replacement rules. Timed demotion and global/per-language retirement
are kept distinct. Android's recognizer support service and installed speech
models remain external inputs to this campaign.

`NativeOnDeviceRecognizer` covers one actual `OnDeviceRecognizer` session
with a controlled Android recognizer and PCM pipe. It observes input backlog,
queue ownership, EOF, early results, timeouts, stop-before-open, finished-state
refusals, and released recognizer/pipe handles. The exact 64 second backlog
boundary distinguishes accepted audio from refused input. A held main callback
separates a cancellation request from cleanup acknowledgement.

The unpatched source let a retired language-error callback demote the installed
language even when the terminal answer rejected that callback. The authenticated
repair makes language demotion part of the first accepted answer, under the
same monitor that admits cancellation. An active missing-language error still
demotes. The source campaign covers both old callback windows and the current
error control. Installed recognition, real Binder ordering, and unrestricted
audio histories remain platform and refinement obligations.

`NativeListenerInput` exercises actual listener recording, mode and playback
callbacks through the capture loop, SpeechGate, recognition executor, WakePhrase
and main-thread wake action. Synthetic PCM batches cross the minimum speech
length and playback guard exactly. The source driver holds a native read across
epoch retirement. Its first frame stays owned by the previous epoch, and the
next current utterance can be recognized. Playback, call and destroy retire
pending recognition or wake actions. The lock screen blocks assistant
invocation while allowing the capability-reducing spoken pause.

The component projects one capture and recognition worker at a time, up to three
recorder allocations, one queued wake action, and fixed speech/silence frame
sequences. It observes cleared frame and transferred ASR sample buffers.
General adaptive floor/pre-roll histories, unrestricted callback schedules and
installed Android audio and assistant invocation remain separate obligations.

`NativeSpeechGate` models the listener's separate adaptive noise floor and
PCM buffering. Its source projection reads the real circular pre-roll slots,
opening and closing counters, exact utterance sample order, and zeroed unused
storage. It covers the 15-frame minimum, 35-frame silence hangover and 400-frame
maximum, including truncation of a trailing silence run at that maximum. Reset
clears PCM while retaining the learned noise floor. Synthetic frame classes
straddle the absolute speech threshold and exercise steady-noise adaptation.

The model bounds PCM to eight constant-amplitude inputs and compares rounded
millidecibels with a two-millidecibel tolerance. The source passes the actual
classifier result and measured floor at each frame. The model checks their
threshold and update relation, then derives the expected buffer state. Complete
floating-point coverage and installed microphone behavior remain separate.

`NativeSpeechOutputPreparation` follows the staged lead-trim buffer and first-write report
through exact threshold boundaries, a full 727-sample production pre-roll, input zeroing,
post-onset pass-through and callback/write faults. Its symbolic run uses short representative
chunks and a three-sample pre-roll. The production-sized scenario executes the actual helper
and compares exact retained and returned sample classes.

`BatchCaptureCompletion` follows the renderer's recorded conversation capture. It models
early callbacks keyed by native draft identity, start acknowledgment, sampling, explicit
stop, cancellation and cleanup uncertainty. A call event prevents selection of that draft
for transcription, even when it arrives before the native start acknowledgment.

## Process-local update activation

`NativeUpdateActivation` checks the exact `AlphaDevicePlugin` update barrier.
Registration grows a pending barrier, and a new bridge after readiness
invalidates it before seal. Exact activation and bridge receipts admit each
ACK once. A refusal, retirement or malformed receipt cannot authorize the
resident stop. A bridge that joins after seal sees the pause and can reach the
existing Android confirmation.

The baseline in `cb1deb29c4` records six source schedules. It reproduced a
post-seal bridge receiving the sole cancellation resume flag after opening
confirmation, even though that bridge did not capture a mounted reconnect
callback. It also reproduced a terminal audience still naming a bridge that
had retired. The corrected barrier captures eligible mounted ACKs at seal.
On cancellation it selects the live eligible confirmation owner or the exact
eligible initiating bridge. Startup and older ACKs can prepare without granting
resume. Retirement clears the selected audience without transferring it, and
repeat settlement of the current terminal identity does not nominate anyone.

Eight JVM schedules execute the actual updater methods with a fixture download,
resident-stop port and PackageInstaller port. The prepared renderer adapters
separately check the mounted and startup request shapes. The durable journal,
physical installation, installed WebView callback delivery and full
cross-process recovery have separate evidence requirements.

### Activation and durable pause composition

`NativeUpdateComposition` imports the native activation and durable pause
transition relations. A JVM campaign drives the real updater, pinned journal,
and exact service-lease policy through one attempt. The test controls the
installer port and resident stop observation, then reads the actual PAUSING
and COMMITTING records, owner UUID, lease and renderer state. The source
scenarios cover a draft refusal, exact canceled release, and directory-sync
failure after a visible terminal rename. The third scenario requires a
nonprivileged POSIX host that honors the injected directory read denial.

A refused preparation leaves no pause. After an exact canceled release, the
mounted initiator can receive reconnect while the startup-only bridge keeps
Android confirmation ownership. After the ambiguous tombstone, renderer
readback is idle and the journal gate admits startup. The exact resident
shutdown lease still fences a launch, and neither a terminal cancellation nor
reconnect authority publishes. Retrying that same empty journal leaves the
lease held. The model covers these bounded schedules through source readback.
Installed Android and physical filesystem recovery remain separate.

### APK offer and pre-activation staging

`NativeUpdateStaging` follows the Settings manifest cache and the native
download before the update activation barrier. The JVM serves synthetic
responses through the pinned bounded transport. Exact Settings review selects
the tuple that the same source driver passes to the installer. Readback covers
the partial cache file, verified SHA-256, archive admission and exact bytes
copied to the synthetic installer sink. Each staged attempt ends at a refused
preparation. Installed session delivery remains a separate boundary.

The one-day clock controls a refresh. A failed check retains an otherwise
compatible cached offer, and an answered withdrawal removes it. A late
non-EOF read is rejected before its bytes are written. A late EOF can finish
verification if all exact bytes were already read. The process guard protects
the active cache file from peer taps and sweeps. An unsuccessful file deletion
can leave an orphan for a later idle bridge to sweep. A refused Android
abandonment can likewise leave the copied uncommitted session listed.

### Hosted inbox retention and receipts

`NativeHostedInbox` follows `HostedDelivery.sync` through the single-flight
operation and `HostedInbox.sync` through row, index and notice persistence.
The resident credential expires independently of the cached history. History
has an ordered 100-row cap and survives the matching scope reopening. The JVM
checks exact per-scope client UUIDs, GET and ACK paths, cursor and run ID.

The native receipt can acknowledge a row still listed or awaiting removal.
The source writes both the row and its index or journal entry before
requesting the receipt. A provider acceptance already recorded at the
synthetic IPC boundary can survive generation retirement. The retired
worker cannot mark the replacement current or commit its late result.
Pending notice and removal journals recover independently. The campaign
covers an already-visible post followed by a failed journal clear.

Two scopes, three tracked rows, a seeded historical suffix and held
synthetic IPC requests bound the model and source schedules. Actual server
cursor behavior, encrypted storage and WorkManager execution are separate
boundaries.
