# Native application models

These finite models describe product and shared-native protocol boundaries in
the current working source. The source lists, named invariants, scenarios and bounds are in
[manifest.json](manifest.json). Each exposes `init`, `step` and `safety`.

## Source correspondence

| Model | Source symbols inspected | State represented |
| --- | --- | --- |
| `ResidentRuntime` | `AlphaLocalAgentPlugin.start`, `cancelStart`, `stop`, `getStatus`, `handleOnDestroy`, `startResidentIfAdmissible`, `LocalAgentProviderAdmission.bindCloudProvider`, `applyProviderEnvironment`, `providerStatus`, `ResidentCredentialShutdownRetry.await`, `ResidentScheduleRearm.decide`, renderer `residentRecoveryReason` | Local resident lifecycle, source admission, exact credential generation, uncertain unbind, retained recovery records, reset fence |
| `VoiceSession` | `VoiceAssistantSession.start`, `stop`, `setMuted`, `speechStarted`, `schedule`, `submit`, `respond`, `resume`, `respond`, `createNativeLiveDictation`, `createCloudVoice` | Session/turn/utterance generations, semantic and long-gap endpointing, capture, mute, barge-in, completed-sentence accounting, separately reviewed read response and local dictation |
| `SpeechResources` | `LiveCaptureAdmission.begin`, `attach`, `stop`, `cancelAll`, `SpeechAudioFocusPolicy.changed`, `stopsCapture`, `SpeechPcmQueue.offer`, `take`, `close` | Capture reservation and late startup, one capture owner, transient focus/duck/loss, bounded PCM queue and canceled stream |
| `AlwaysOnListener` | `ListenerPolicy.decide`, `holdsMicrophone`, `processesAudio`, `latchesIndicatorLoss`, `IndicatorLease.renew`, `verdict`, `ListeningEpoch.current`, `ListenerStore` consent generation | Consent, visibility, unlock, call/privacy, SystemUI lease, explained pause, sticky indicator loss and queued recognition invalidation |
| `ResetRecovery` | `ResetAuthorization.begin`, `confirm`, `authenticate`, `retire`, `DataReset.record`, `automaticAttempt`, `retry`, `admittedAttempt`, `automaticAttemptAllowed`, `admitAndExit` | Activity-bound approval, durable pending marker, listener-first reset, bounded automatic retry, recovery surface, accepted dispatch and externally observed erasure |
| `DeletionJournal` | `DeferredDeletionJournal.stage`, `undo`, `expire`, `list`, `acknowledge`, `NativeDeletionCoordinator.reconcile`, `stageOwnerCurrent` | Durable intent, monotonic Undo window, changed boot, exact owner/source admission, dispatch uncertainty and retained no-replay receipt |
| `MediaLifecycle` | `NativeReadEpoch.current`, `PermittedMediaCatalog.observeScope`, `SelectedPhotoCopy.read`, `publish`, browser `beginPhotoEdit`, `savePhotoEdit`, `cancelPhotoEdit`, `resultPhotoEdit` | Per-item permission, lifecycle/source revision, selected read, reviewed output, canceled temporary capture and active playback |
| `DeviceActions` | `SmsSendJournal.beginDispatch`, `endDispatch`, `sentResult`, `status`, `existing`, telephony read epoch checks, `retainReminderCreation`, `checkReminderCreation`, `reconcileReminderCreations`, `ClockHandoff.receiver` | Image/permission/SIM gates, exact reviewed SMS binding, durable dispatch, multipart evidence, retired operation id, stale contacts, reminder creation recovery and revision-bound notification |
| `RendererRecovery` | `RendererRecoveryBudget.onLoss`, `MainActivity.onRenderProcessGone`, delayed recreation and stock Settings actions | Three immediate losses, exact 60-second window, five-second backoff, HOME escape, duplicate callbacks and activity ownership |
| `VadSegmentation` | `LiveVadGate.accept`, `close` | Two high windows to open, sixteen low windows to close, hysteresis thresholds, nonfinite values and counter reset |
| `VoiceIpcAssembly` | `BufferedStreamExchange.exchange` | Handle ownership, deadline, response/chunk assembly, size limit, completion validation, first failure and cleanup |
| `ListenerLeaseProducer` | SystemUI `SenseListeningController`, `SenseListeningLease` | Measured eligible surfaces, queued acknowledgements, target validation, client generation and lease retirement |

The reviewed source paths are listed as repository-relative paths in the
manifest. Every callback accepting an identity has matching and stale scenarios.
The models leave external results nondeterministic where source cannot know an
outcome, including provider dispatch, storage failure and native acknowledgement.

## Composed application boundaries

`ApplicationComposition` now imports the current `IdentitySession`,
`CalendarLinkedSync` and `VoiceSession` modules. Native credential commit and
renderer publication are separate transitions. The renderer can retain the old
account while native activation completes. A published replacement invalidates
captured consumer bindings. A Calendar request already dispatched may still
apply remotely while its local checkpoint remains dirty.

The source campaign executes the actual renderer connection controller, Alpha
Calendar sync host and its shared controller/store/reconciler, plus the shared
voice session under the actual conversation-binding predicate. Nine controlled
schedules check 44 checkpoints. Native authentication internals are explicit
contract macros. The full voice UI listener wiring, Inbox multi-slot composition,
Resident lifecycle and reset cross-domain coordination remain separate
obligations. See the [composition refinement report](../refinement/composition/README.md).

The former Calendar outbox model is a historical-source model in the legacy
family. Its removed runtime API is not imported by the current composition.
The intentionally unsafe identity initializer remains a synthetic checker
canary and is excluded from ordinary transitions.

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
the session through Stop. Dictation produces an editable draft.

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

`NavigationProgress` adds the maneuver cursor and navigation retry state to the
service-level route model. A sparse geometric projection cannot skip the next
instruction. It advances only when the current maneuver is closer than 40 m.
Arrival requires distance below 25 m and accuracy no worse than 30 m. Fresh
navigation fixes require precise permission, accuracy at most 50 m, age at most
30 seconds and a timestamp at most five seconds in the future. Failed reroutes
retain the followed route and use 10, 20, 40 and then 60 second retries. The retry
loop rechecks the latest fix, cancels on arrival and stops scheduling after route
recovery. The controller must first leave ready/error before a new reroute result
is accepted. Native Stop, task removal, late start and replacement-session
callbacks retain separate session identities.

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

## Durable reset attempt admission

`ResetRecovery` separates authentication, budget and marker persistence, write-ahead
attempt reservation, listener/Android callbacks and process exit. An existing
process may remain initialized while the marker blocks subsequent startup. Legacy
markers retain their authority, while missing or corrupt budgets require explicit
recovery. Explicit retry preserves a readable same-window count. The reset source
adapter and two-process file-lock regressions are documented in
[reset-orchestration-report.md](../refinement/native/reset-orchestration-report.md).

## Executed resident coordinator

The native whole-plugin campaign covers owned, attached and unowned starts, exact
epoch retirement, disposed-surface calls and system-broadcast exclusion. Its
source relation and remaining obligations are documented in
[resident-coordinator-report.md](../refinement/native/resident-coordinator-report.md).

## Executed deletion coordinator

The whole coordinator campaign checks the authenticated owner again after waiting
for its monitor, persists dispatch intent before provider calls and preserves
uncertain receipts through restart. Selected-row projection and multi-row/provider
boundaries are described in
[deletion-coordinator-report.md](../refinement/native/deletion-coordinator-report.md).

## Executed credential coordination

The whole native credential campaign executes both bridge entry points and the
credential store's real lifecycle coordinator, including strict shutdown,
rebind, partial writes, concurrent owners and in-flight request/stream retirement.
Its observation relation and platform boundaries are in
[credential-coordinator-report.md](../refinement/native/credential-coordinator-report.md).

## Current shared-source port

The current pin is `475a8d59dc1811c2cde093613519906a5a3f6457`. The manifest now
maps the retained models to current product wrappers and shared Java or client
implementations. `current-policies.mjs` compiles the current classes directly,
including package-scoped SMS operations in a package-local observation harness.
`current-renderer.mjs` records the transitive source graph before executing the
shared voice controller and renderer resident wrapper.

The shared voice controller closes its capture before sending a turn and holds
input closed through response playback and owner review. `beginSubmission` and
`inputClosed` represent the asynchronous close boundary, while `submit` combines
the completed boundary for synchronous source observations. `inputCloseFailed`
retires the active session and reports the source error state. Eight actual
controller schedules include delayed close, rejected close and Stop racing close.
The request and service-stop lease fields in `NativeCredentialMutation` model
native-issued request expiry/cancellation and exact shutdown ownership.

The detailed current-pin source report is
`specs/quint/refinement/native/current-port-report.md`. Earlier counts above are
historical checks of their stated revisions. Current implementation receipts
retain source/model/driver hashes and explicit Android/provider obligations.

## Current aggregate integration

The native aggregate uses the current shared Java paths and product wrappers.
It includes the full MainActivity, reset, resident and deletion coordinators,
provider admission and native credential mutation/lease adapters. Each driver
hash includes the aggregate entry point and the shared Quint syntax-tree state
inventory helper. Missing actions and fields are derived from declarations and
imported state rather than a type-name or text-pattern heuristic.

Additional source schedules exercise semantic endpoint completion/continuation,
exact owner-reviewed voice resume, explicit speech interruption, timestamp and
head-position playback evidence, zero writes, ducking, expired IPC deadlines and
rejected deadline scheduling. The playback model only records fresh head-position
evidence while an audible timestamp has not already been reported. Native and
service ownership remain separate in the source manifest, and the aggregate
retains both credential and resident observations from their shared coordinator.

The aggregate emits explicit remaining obligations for complete native service,
media, navigation and SystemUI controller orchestration, alongside the Android,
provider and physical acceptance boundaries. A field absent from concrete source
observations is reported as unobserved even if its model invariant passes.

## Native segmented Notes recording

`NativeNoteRecording` covers the product-owned `AlphaNoteRecorder` state that the
older media model did not represent. Capture instances, current and finished
segment files, exact pause accounting, rollover, two transcript value classes,
durable journal prefixes, corruption, missing audio, legacy binding recovery and
remux outcomes remain distinct. A failed journal write may retain newer
in-memory text or audio until restart. The JVM driver observes the real files and
public status rather than reconstructing expected storage contents.

`NativeNoteRecordingService` covers the corresponding foreground notification
owner. A delayed START, STOP or empty legacy STOP cannot remove a newer
recording's foreground ownership. Initial invalid starts still enter and leave
the foreground as required by Android. Current-owner and closed-recorder cleanup,
pause/resume notification state and service recreation execute against controlled
Android ports. Installed foreground eligibility and physical recording remain
platform obligations. The renderer's recorder coordination is modeled separately.
