# Quint implementation refinement

The current implementation refinement continues in [draft PR 839](https://github.com/eliza-research/alphaphone/pull/839) on SDK
`99b49439ce9d0cb5607e9831b9f7f58d89525029`. The migration and its approved
product-source prerequisite are in merged PR 825. PR 838 integrated the
first refinement PR, 835, into main. The family manifests bind the reviewed
source owners, and the source inventory lists the remaining review work.

## Original source baseline

The historical campaign at `41d178701e` used
`b25d8aef2916385c571f4367e099809254fde0bb` from the original
`claude/finish-open-issues` lineage. Its receipt preserves its original hashes.
The later integrated source has separate evidence.

## Executable relation

Every adapter executes product code and records an explicit projection of its
state and effects. The checker generates Quint scenarios that require each
recorded checkpoint to match the named model transitions. It also checks
rejected actions, stuttering and each registered model safety invariant. Deliberately wrong observations and changed
source hashes are tested as failures.

Receipts retain concrete inputs, observations, exercised actions, assumptions,
Quint output and hashes captured before implementation execution. Imported model
dependencies are hashed transitively. The aggregate rejects stale receipts and
fails the full campaign when a runtime model has no passing current receipt.

`complete-finite-helper` applies only to the enumerated helper domain stated in
its receipt. `bounded-component` and `bounded-orchestration` preserve their
schedule and projection limits. The aggregate lists unobserved fields and
declared actions that the source campaigns never traversed. A rejected
action records guard evidence separately from evidence of a transition.
`--require-complete` fails while the universal application refinement
obligation remains open.

## First checked source milestone

At commit `41d178701e`, all 51 runtime models have current source-bound receipts
covering 1,392 concrete traces and 9,769 checked checkpoints. The 52 receipts
include two ResidentRuntime campaigns. The application, native and composition
cohorts were retained from the integrated run, and the services cohort was rerun
after repairing asynchronous scan polling. The combined inputs were checked
against the current files before saving
[`refinement-baseline.json`](../specs/quint/evidence/refinement-baseline.json).
This is a bounded correspondence milestone. The full command and deeper
coordinator obligations continue below.

## Corrections found through source execution

| Component | Finding and change | Remaining boundary |
| --- | --- | --- |
| Scan document | Explicit save and load now retain user ownership across later autosaves. Confirmed export only deletes an automatic draft. The preservation predicate is a safety invariant. | Actual document-provider persistence and PDF content retain separate integration tests. |
| Maps route admission | The source regression now follows the current free-flow and live-traffic route contract. A free-flow route remains valid when the provider also supports live traffic. | GPS, route-provider correctness and physical guidance retain separate integration requirements. |
| Renderer recovery | The loss counter now saturates after the immediate-recovery budget, preventing integer overflow from reopening that budget. | Visible Android Activity/WebView escape behavior needs platform evidence. |
| Startup permissions | The model separates volatile prompt ownership from a best-effort durable attempt marker. A failed marker write can allow a new flow to request permission again. | OS permission behavior is an environmental contract. |
| Draft dispatch | A failed release write with readable storage enters conflict review. The model distinguishes this from an unreadable store or failed clear. | Broader concurrent edit schedules remain explicit obligations. |
| Durable store | The final legacy check occurs before the document CAS finishes. A late external legacy write is detected on the next read. The original stronger cross-store condition is retained as a falsifiable property. | An atomic guarantee across external localStorage and document transactions is unresolved. |
| Resident runtime | Ordinary stop, confirmation failure, owned cancellation and attached cancellation now have distinct model transitions. Stop retires enrollment before confirmed process termination and retains provider configuration. | Native service locks and process shutdown require Android integration. |
| Application composition | Pending replacement keeps the existing account available, with committed owner generation separate from attempt generation. Stop and cancellation are composed with voice retirement. A real renderer-controller campaign observes account sign-out and replacement under isolated native/provider ports. | Intermediate events and cross-domain voice, Calendar, Inbox and reset schedules remain open. |

## Further coordinator findings

The next source-driven tranche executes complete coordinators beyond the first
component projections. Its failing traces remain explicit work items.

- `AlphaDataReset` preserves an existing retry count for manual attempts. The
  current model resets that count. Failure-budget write errors can also leave a
  missing budget and admit another automatic reset on every process launch.
  Durable admission and storage-failure transitions need implementation and model
  refinement together.
- `AlphaCloudSignInPlugin.resumeAcknowledgements` finishes the saved-key
  acknowledgement without the previous token held by an interrupted interactive
  call. The model currently retains that token across restart. The recovered
  state must preserve uncertainty about previous-session revocation.
- Positional Settings row keys can retarget an already-focused button when delayed permission data inserts a group. Stable group/row identity is being added and checked through the real renderer.
- Main chat integration uses `installAgentAdapter` and separate draft-recovery
  state. The first `AlphaClient` and `AssistantDraftController` projections leave
  that live coordinator work open.

## Reproduction

Use the pinned Node and npm dependencies, JDK 21 and the pinned host JSON jar.
CI prepares the JSON jar with `scripts/ci/prepare-host-test-json.sh` and installs
Chromium with `npx playwright install --with-deps chromium`.

```sh
npm run upstream:prepare-client
npm run quint:refinement
npm run quint:check
npm run verify
npm run android:build:local
npm run android:verify
```

The default refinement command runs the application, services, native,
composition and translated core campaigns. Use `--families=legacy` for the
translated source campaigns, or select `application`, `services`, `native`,
or `composition`. The summary includes the full model registry and identifies
models without a passing receipt from the selected campaigns. Reports are
written to `test-results/quint-refinement/`. CI retains model and source trace
evidence as artifacts.

## Verification repairs

The prerequisite snapshot carried stale Settings selectors and source-pin
ledgers. Their checks now follow the current product surfaces and pinned source.
The Calendar host test declares its Zod dependency directly. Committed notices
use the source-only form, with packaged-runtime notices generated by the Android
staging build.

The scan driver polls asynchronous IndexedDB results with awaited polling. The
pinned browser poller treats an unresolved Promise as truthy, so an async
`waitForFunction` predicate could sample a draft before the write completed.
SMS capacity checks use the production journal Storage interface. Separate
small file-adapter checks retain actual file write and reload coverage, while
capacity checks avoid hundreds of host-only fsync operations.

The service test sends its structured receipt summary separately from the
worker log. A concurrent verification run exhausted the previous 8 MiB
output pipe. The scoped Calendar fixture starts SQLite subprocesses and now
allows the same 60-second budget for execution as for JVM compilation.

The strict all-family run exposed a shared nested character settings object
in the upstream PGlite test helper. The embedding identity fixture changes
provider selection and now gives its runtime a separate settings object.
The identity and named-provenance campaigns pass consecutively in one
process. Aggregate errors retain source locations without embedding a copy
of a generated JavaScript bundle in the report.

Eleven native adapters compile generated Java fixtures in temporary
directories. Strict reporting previously dropped their passing receipts
after normal cleanup. The adapters now retain checksum-addressed copies
of declared generated files after checking the original bytes before and
after execution. The aggregate still rehashes live source and refuses
missing stable inputs. The repaired receipt validation passed for all
eleven adapters across 225 source traces and 1,264 checkpoints.

## Platform validation

The initial local Android attempts stopped at input preflight. The current
worktree staged the recorded voice outputs and verified their integrity with
the exact pinned FFI checkout. Its voice admission record remains unqualified.
The reviewed ARM64 embedding libraries and pinned model separately passed
admission using the repository qualification receipt. The local build and APK
verifier passed on commit `839325d966` for the standalone and launcher debug
and unsigned release APKs. Both unsigned releases report
`distributable: false`. The build also generated both instrumentation APKs.
The same build and APK verification passed again on commit `b7d63199b8`.
The 207-model follow-up at `4f3463f63d` passed the normal build and independent
APK verifier for all four standalone and launcher APKs. Both instrumentation
APKs were also archived with checksums. The APK verifier records 1,119 runtime
entries per release and 1,120 per debug APK. Mocks were disabled and both
unsigned releases remain non-distributable.
Installed emulator HOME behavior, full AOSP boot, real integrations and
physical-device acceptance each require their own evidence.

## Completeness

The executable campaigns establish their stated finite or bounded projections.
A universal simulation relation covering every supported source state and all
permitted interleavings remains open. Provider responses, Android execution,
physical audio, durable power-loss behavior and actual reset erasure require
additional contract or integration evidence. The source ledger's file coverage
does not discharge those obligations.

## Current SDK refinement checkpoint

The follow-up uses shared SDK `99b49439ce9d0cb5607e9831b9f7f58d89525029`.
The authenticated Android mobile producer passed module-load and pre-provider
smokes. It parsed 9,988 inputs, including 4,338 first-party inputs, 4,090 tracked
inputs and 248 generated inputs with origin mappings. The graph binds seven
Task, Notes, turn-controller and room-queue source transforms to the producer
receipt.

`CoreTurnControllers` checks 17 schedules and 105 checkpoints across two real
registries, observing all 17 model fields. The current SDK adds closure, so a
closed registry starts later handlers with an aborted signal. Reclosing changes
the reason for future starts while retaining the first reason of an already
aborted turn. The actual source tests use controlled handlers to check both
cooperative rejection and noncooperative completion.

The native port checks capture frame buffering, piped capture, ASR pipe
settlement, indicator ownership, listener persistence and listener teardown.
The six focused campaigns pass 131 schedules and 817 checkpoints. The Notes and
Task campaigns exercise the real runtime/store, controlled provider or worker
ports and real SQL where applicable. Their finite schedules and the current
source ledger leave explicit obligations for broader composition and device
behavior.

The translated core protocols also run against current source. The scheduler
campaign compares 10 real daemon schedules and 89 checkpoints, including
restart, stop, pending query ownership and a stopped-admission canary. The
interaction campaign compares 12 schedules and 121 checkpoints across the
real authority and SQLite journal. The semaphore campaign checks eight
schedules and 69 checkpoints with actual abort dispatch, including reentrant
release before cancellation. The serialisation campaign covers all 24
invocation orders and 254 checkpoints with sampled arrival and outcome timing.
The expanded scheduler campaign checks 125 additional checkpoints across 10
schedules for batched agent queries, owner replacement, process disposal and
shared timer ownership. The room handler queue compares both translated
profiles against the real FIFO and writer tail across six schedules and 112
checkpoints. The authenticated patch reserves capacity before publishing queue
telemetry, including synchronous listener reentry.

`NativeListenerInput` compares 20 real Java schedules and 108 checkpoints
through capture, the speech gate, ASR, and wake callbacks. It covers an input
read that outlives its epoch across microphone privacy, the playback guard
boundary, call and recording gates, ownership loss, and PCM cleanup. A
separate regression exercises failed durable capture admission and checks that
it leaves recognition fenced.
The separate speech-gate campaign checks 11 segmentation schedules, including
adaptive noise thresholds, circular pre-roll, utterance length and reset.

The Files filter and Google consent campaigns compare 17 and 16 source
schedules respectively. The browser deletion poll checks six Calendar and
Reminder schedules. It reproduces the old duplicate CAS revision and checks
that competing polls preserve the first committed revision. The pilot APK
update campaign uses scripted ADB and an actual temporary rotation journal to
compare 12 schedules and 149 checkpoints, including uncertainty after an
ambiguous install reply.

The embedding identity campaign checks ten schedules and 139 checkpoints
against the shared runtime and real PGlite. The previous source changed the
adapter column before reading the identity cache. A failed read left the
previous provider and pin active against the new width. The authenticated
repair validates the identity before resizing and holds generated vectors
until the adapter and cache confirm their writes. A retry reads back a
durable identity after a lost acknowledgement. The campaign also checks
same-width model refusal and operator acknowledgement. Independent runtime
owners, process restarts and named vector spaces have separate evidence
requirements.
The PGlite source campaign also confirms the translated dimension model's
provenance counterexample. A delayed unmarked vector is admitted under the
adapter's new space before the runtime publishes its pin. A stale direct SQL
update against the same row is blocked by the nonce trigger.

The resident liveness campaign checks seven schedules and 38 checkpoints on
the connection owner and actual rate limiter. It covers duplicate failures,
delayed native status, a busy rebind, and restart completion after ownership
changes. The reviewed retry action for an unavailable installed-file check is
available again in the recovery panel and Settings.

The current Maps guidance campaign checks explicit reroute, stale replies,
foreground fallback and background ownership across 24 source schedules.
When a pending native startup is refused after Maps hides, the patched shared
controller releases its foreground location watch. The launcher observer
campaign checks exact subscription retirement and timer cleanup. The browser
journal retention campaign checks production count and age cutoffs, pending
rows and replay claims against actual Calendar and Reminder source.

The Google access publication campaign checks five schedules and 29
checkpoints around an exclusive lock, canonical preferences and host replies.
After a lost acknowledgement, the controller attempts to republish the
canonical choice under the same lock. The original caller still receives the
failure. If corrective publication fails before the host write, the model
retains the possibility that the host and preferences diverge.

The native Google browser campaign checks 23 schedules and 121 checkpoints
against the authenticated Java callback and grace queues. The native Maps
campaign checks 27 schedules and 135 checkpoints around exact command
authority, replacement, foreground startup and teardown. A task removal
must have the same root activity component as the active route. Android
callbacks cannot distinguish two task generations sharing that component. Browser retention
also checks prototype-shaped operation IDs with actual Calendar and Reminder
stores. Recovery for older orphaned Reminder markers remains open.

The fact-write deduplication campaign checks both original profiles against
the pinned runtime and real PGlite. All 12 writer schedules match across 144
checkpoints. Equivalent writes can duplicate across separate runtime owners
or when the previous row falls outside the newest 120 candidates. The original
profiles describe the serialized, in-window case.

The launcher favorites campaign checks 21 schedules and 126 checkpoints
against the prepared Home controller and durable favorites adapter. Legacy
favorites remain accessible when the migration write is refused. The original
stored key stays in place until a save succeeds.

The accessibility timeout campaign checks six schedules and 46 checkpoints
against the actual timeout reader and shell timer methods. An older native
reply cannot overwrite a newer reading or a non-native reset. A new toast
uses the current scale, and an already scheduled toast keeps its original
duration. Dialog forwarding, Undo selection and installed TalkBack behavior
have separate evidence requirements.

The Home gesture campaign checks 20 schedules and 114 checkpoints against the
actual Home controller. A second pointer cannot cancel a held press, move an
active drag, or commit its reorder. Opening the drawer or replacing the Home
surface retires that interaction and its click suppression.

The modal toast campaign checks five schedules and 38 settled DOM
checkpoints. It tracks opening order, region ownership, forwarded Undo and
exact observer cleanup. Chromium also exercised dialogs opened in reverse
document order, close and reopen, Undo, and replacement cleanup. Browser
focus supplies a fallback when installation starts with existing dialogs.

The separate fact-write scope model checks six real PGlite schedules and 67
checkpoints. It covers the exact recent-row cutoff, independent runtime
owners, room isolation, refused writes, and a replay that adds no duplicate
evidence. Ambiguous commits and concurrent metadata hits remain separate.

The Apps drawer campaign checks 22 schedules and 134 checkpoints in the
actual mounted renderer. It tracks pointer-owned presses, menus across
inventory replacement, focus restoration and synthetic App Info outcomes.
A removed app's menu and armed press retire before the same component can
return.

The screen focus campaign checks six schedules and 77 checkpoints against
the authenticated shared helper and Alpha installer. It checks view changes,
resize priority, delayed titles, focus owners and the animation-frame retry
budget. The closed-over resize element is checked through behavior. All six
focused Chromium tests passed against the current source.

The dock clearance campaign checks five schedules and 35 checkpoints against
the actual Alpha wrapper and shared publisher. It checks split and full chat
header selection, measured scale, retained dock clearance while a dock is
inert, and cleanup that cannot erase a replacement publisher's values. A
focused Chromium test checks the header transition with unchanged geometry.

The native Google access file campaign checks seven schedules and 66
checkpoints using the actual JVM writer and a private loopback host. Missing,
malformed, linked, and nonregular policy files keep both switches off. A
read that overlaps atomic replacement returns one complete version. The
request crossing revocation is held at synthetic credential verification.
Android power-loss durability and effects after provider admission remain
separate.

The mounted and startup update campaigns check the actual shared gate on
controlled Android readbacks. The mounted gate and Alpha's five draft-flush
owners match six schedules and 41 checkpoints. The unmounted gate matches
four schedules and 22 checkpoints around readiness, terminal readback, and
Continue. Installed PackageInstaller delivery and each draft store's
physical persistence remain separate.

The canonical Calendar draft campaign checks 17 schedules and 121
checkpoints against the real controller and durable draft adapter. Retained
forms stay with their bound account, including when returning to an account
through a new renderer binding. Existing misbound bytes stay in storage
outside resume and raw recovery.

The Reminder orphan campaign checks eight schedules and 70 checkpoints.
The old marker remains in storage and ordinary explicit actions retain their
observed policy. Clock rechecks for a pending deletion while it holds the
ringing lock. Undo of a valid paired deletion can restore ordinary ringing.
Recovery of older markers without a receipt remains an open policy.

The named embedding provenance campaign checks eight real PGlite schedules
and 67 checkpoints. The authenticated patch validates a named vector at the
actual write or search boundary and rejects a delayed resize after named
activation. A rejected text-and-vector edit rolls back together. The
translated counterexample remains available against the pinned unpatched
source, and existing named rows require separate evidence. The current
Android mobile producer applies 11 reviewed transforms and passed its load
and pre-provider checks across 4,338 first-party inputs.

The Agent Calendar refresh campaign checks 25 schedules and 237 checkpoints
against the actual read controller. It covers trailing same-query refresh,
abort and stale replies, source readability, feed preservation on a
same-window failure, and exact owner and date-window eligibility. Mutations,
linked source selection and Maps return are separate.

The renderer notification tap campaign checks eight schedules and 70
checkpoints. Navigation retains its mount through the actual render
callback. A competing connection operation or user navigation can prevent
publication. A newer native token survives an old acknowledgement, and an
old mount cannot publish into its successor. Native expiry and installed
foreground delivery remain separate.

The durable runtime update pause campaign checks 12 schedules and 106
checkpoints using the pinned Java journal and actual Alpha wrapper against
controlled system observations. It covers fresh JVM reopen, exact execution
and successor evidence, and the difference between the journal's admission
state and an in-process shutdown lease. A release failure after a rename can
leave those states divergent. Installed PackageInstaller and power loss
remain separate.

The native update activation campaign checks eight JVM schedules and 84
checkpoints. Registration, retirement, readiness, seal and terminal
publication use exact bridge and activation identities. Mounted readiness
can carry reconnect eligibility when the renderer has a prepared callback.
Startup readiness still acknowledges the exact preparation without granting
reconnect authority. A confirming eligible sibling retains its existing
behavior. A fresh confirmation bridge can leave reconnect with the eligible
initiator. An already published terminal never transfers that authority.

The Agent Calendar mutation campaign checks 24 schedules and 134 checkpoints
for create, update and delete admission, preserved drafts, exact arguments,
deferred refresh and stale settlement after owner replacement. Provider
effects, linked controls and event-return readback remain separate.

The separate native canonical tap campaign checks nine JVM schedules and
173 checkpoints. It covers latest waiting and verified slots, owner and
agent identity, expiry, foreground checks, and the exact compare-and-clear
before acknowledging the resident read. An ambiguous acknowledgement
cannot retry the consumed token or erase its successor. Installed ingress
and the real resident read effect remain separate.

The Calendar event-return campaign checks 38 schedules and 203 checkpoints
using the default record port and actual shared API. It distinguishes exact
occurrence timestamps, read versions, retired owner and date-window state,
and a retained edit draft. The mounted Maps visit and installed Calendar
provider have separate obligations.

The native update composition campaign checks three schedules and 33
checkpoints across the actual activation controller and durable pause
journal. It follows the exact execution identity through staging abandonment,
PAUSING and COMMITTING, and terminal reconnect authority. A release failure
after rename can leave durable admission idle while the retained shutdown
lease still refuses startup. Bounded symbolic safety passed through eight
steps. Installed PackageInstaller and power-loss durability remain separate.

The original runtime lifecycle translation now compares 17 source
checkpoints over three startup and stop schedules. It executes actual
AgentRuntime and real PGlite during successful initialization. Queued ingress
enters after closure with an aborted signal, and duplicate stop calls share
the same promise. The original finite stop profile remains executable.

The native workflow notice campaign checks 14 schedules and 206 checkpoints
against the pinned delivery ledger, route preparation, and manager poster.
It observes owner withdrawal, interrupted claim and terminal writes, and
exact readback without a second post. Bounded symbolic safety passed through
eight steps. Installed notification delivery, approval suspension, and
canonical tap consumption retain separate evidence.

The mounted Maps event-return campaign checks 18 schedules and 129
checkpoints. A visit owns its exact origin, pending Calendar read and
navigation result. Leaving, hiding, or receiving pagehide retires the read
and releases its slot immediately. The canceled reply cannot navigate or
erase a newer visit's attempt. Two Chromium regressions reproduce the old
behavior and pass with the repair, alongside five existing Maps tests.
The native Calendar provider still requires installed evidence.

The original service lifecycle now compares seven real runtime schedules and
42 checkpoints across its two profiles. It uses isolated PGlite and
synthetic service hooks to hold concurrent start, teardown and withdrawal.
A separate mismatch receipt observes a send-handler setup failure after
publication. The runtime returns the published service and retains the
class's failure flag, while the original model clears the flag. The
passing projection and the mismatch use the original model transitions.

The APK offer and staging campaign checks 14 schedules and 109 checkpoints
using the pinned bounded transport, the actual Settings cache and the JVM
installer controller. A failed refresh can retain a compatible offer. A late
EOF can finish verification after the exact bytes have arrived. Failed cache
deletion can leave a file for a later bridge to sweep. Each campaign run stops
at the preparation barrier before commit. Symbolic safety passed through eight
steps.

The browser owner-reminder passive campaign checks eight schedules and 156
checkpoints. The actual port aborts a read when its owner or privacy gate
retires. Its shared flight remains until the transport settles. The successor
can join the old flight and receive an empty result before its next read can
dispatch. The source currently binds the port during browser startup without
a mounted shade consumer. The campaign leaves explicit opens, mark-read and
readback reconciliation to a separate projection.

The original plugin lifecycle checks six source schedules and 33
checkpoints across its three profiles. Three separate mismatch receipts
cover registration rollback visibility, a connector registered by a late
service start after withdrawal, and final shutdown lookup clearing. The
late service instance is stopped while its connector remains registered.
The original model forbids that orphan. All three original finite profiles
passed TLC on the translated relation.

Renderer linked Calendar control checks 36 schedules and 267 checkpoints.
The actual client and shared API bind a review to the current grant,
destination, calendar role and source version. The adapter compares the
result with the expected control revision and retains draft ownership
through refusals and stale readbacks. Settings presentation, the Google
link sequence and installed provider effects retain separate evidence.

The browser owner-reminder action campaign checks ten schedules and 90
checkpoints around reviewed revisions, policy, exact conversation and
message arguments, mark-read and uncertainty. A malformed or missing
acknowledgement can require readback, with no repeat mark-read while
uncertainty remains. Shade close can accompany an explicit open. The
port currently invokes the latest bound UI when a held open completes,
and detaching that UI makes the call fail before mark-read. This component
API has no mounted shade consumer in the current checkout.

The Android hosted-result notice campaign checks 12 schedules and 170
checkpoints. If cancellation fails during owner withdrawal, the durable
owner can change while the old pending token survives. The original bridge
accepted that token for consume or question release. The repaired ledger
validates the current owner under the same lock before either settlement.
Absent-owner bootstrap and retry after a same-owner clear failure remain
covered. The repaired model passed symbolic safety through four steps.

The original task service now checks seven real schedules and 38
checkpoints across the four host, daemon and local timer profiles. Actual
PGlite wake revisions are read, preserved across a stale completion and
consumed by the exact later run. A separate mismatch captures automatic
pause at the configured failure limit, which the original failure action
does not represent. All four original finite profiles passed TLC.

The original interactive task reducer checks five source schedules and 65
checkpoints. Independent graph conformance reproduced 1,015 states and
3,136 edges and passed both upstream tests. The current trusted rebind
transition can keep the task active, retire its observation and prepared
operation, and advance the epoch. That exact target state is outside the
original finite graph and has a separate mismatch receipt.

The Google Calendar link flow checks 42 schedules and 205 checkpoints.
The actual renderer sequence compares the captured review and operation
key through selection, repeated review, resume and final readback. It
separates the caller's result from a publication that still owns the
current mount. Linked Calendar control retains its own bounded source
proof and passes symbolic safety through four steps.

The browser hosted-result baseline checks eight schedules and 83
checkpoints using the actual browser ledger and renderer tap verifier.
It accepts an exact pending token after retirement even when the renderer
refuses the old owner's history. The repaired campaign checks ten schedules
and 110 checkpoints. The browser edit compares the captured binding and
current owner before changing the exact pending row. A queued settlement
can neither transfer to a same-scope replacement nor consume a later tap.
The old pending token remains available to its owner in a new explicit call.
All four existing hosted-result Chromium journeys pass with the fixture
using the current connection entry.

The Android hosted inbox campaign checks 12 schedules and 133 checkpoints
against the actual inbox, delivery, resident transport and local notice
ledger. It covers the 100-entry retention cap, exact acknowledgement and
deletion journals, failed notice writeback, and retirement while a request
is held. A replay can acknowledge a result that aged out of the history
index while its exact bytes remain in the pending-removal journal. The
JVM fixture blocks real HTTP and HTTPS, and symbolic safety passed through
four steps.

The Google Calendar disconnect campaign checks 59 schedules and 272
checkpoints. It separates Cloud privacy authorization from stale Calendar
pause authority and records the exact pause, revoke and callback retirement
outcomes. A mounted panel repair also fences link publication and busy
cleanup by the current intent, Cloud binding and request. Three mounted
regressions cover stale review publication, a replacement account read,
and a late host permission reply.

The historical ChatInput campaign compares six mounted Chromium schedules
and 40 checkpoints. Current source agrees with selected proposed
interactions and the common full-chat sequence. Separate mismatch receipts
cover outside taps, Back after the IME dismisses, upward content drags,
and pointer ownership at the raised dock. The original design stays intact.

The hosted-result question campaign checks 23 schedules and 95
checkpoints against the actual content review dialog and shared text
screening rules. An explicit Cancel or Back releases the review. Hiding
or retiring it preserves the pending notice. The exact retained snapshot
and token are rechecked before consume. A successful consume can settle
after retirement while the retired draft remains fenced from chat.

The mounted Google Calendar publication campaign checks 23 Chromium
schedules and 181 checkpoints. It exercises exact Cloud, client and
Calendar intent replacement, a held host permission reply, pending link
readback, and actual focus and inert cleanup. The legacy Settings modal
has test callers and no production callers. The mounted Google panel
has its own model and source evidence.

The Android Reminder campaign checks 17 schedules and 153 checkpoints
against the pinned engine and store, exact receiver and reviewed operation
receipt. It distinguishes stale and early alarm delivery, permission and
channel refusal, repeated snooze and Done, reboot replay, and the
notification that becomes visible before its posted marker is durable.
Both host JSON libraries produced identical projected traces. Actual
Android delivery remains a separate boundary.

The historical Settings navigation campaign checks six mounted traces and
38 checkpoints across both profiles. It observes license search and
detail navigation, return to Apps after Back, and sign-out confirmation
dismissal with the synthetic owner intact. Five independent mismatch
receipts record current navigation and information that the historical
profiles describe differently. Installed system Settings and accepted
sign-out remain separate.

The renderer hosted inbox checks 14 schedules and 85 checkpoints using the
actual Alpha admission wrapper and pinned inbox. The renderer fallback
uses a distinct storage scope. The campaign follows exact row and index
write refusal, lost replies, recovered removal and notice journals, and
provider acknowledgement after the result is durable. A notice effect
with a lost reply can be offered again. Native-ready selection keeps the
separate native inbox. Larger histories and same-scope queue schedules
retain separate evidence.

The renderer digest queue checks six schedules and 46 checkpoints.
Distinct inbox instances share FIFO ownership of the exact browser
storage scope. The Android renderer fallback has a different scope and
can read concurrently. A queued cancellation skips dispatch when its
predecessor settles. A refused predecessor still releases its slot.

The historical Home layout campaign compares two mounted traces and
20 checkpoints. It observes the four card sources, drawer and dock
behavior, and a grid change after a real inset callback. Separate receipts
record the mounted empty card shells and the historical date and setup
controls. Synthetic Settings role decline and grant stay outside the
original Home transition relation.

The Google Calendar access choice campaign checks 17 schedules and 118
checkpoints. A visible choice now belongs to the exact verified account
read and Calendar intent that produced it. Replacing the Cloud binding or
receiving a newer read retires the old choice and its held continuation.
A fresh read-only owner needs its own consent, and the source admits
only its own verified write rows. The related consent model now checks
that a newer read withdraws the saved-off choice.

The retained Home brief campaign checks six schedules and 45 checkpoints
against the actual Alpha wrapper and shared store. It distinguishes
completion time from cursor order, selects only occurrences that ran,
checks exact clipping, and observes copied listener delivery across
retirement and refusal. The store matches a scope value. Caller lifecycle
must fence an old read when the same scope returns.

The native Clock campaign checks 27 schedules and 181 checkpoints. Its
baseline records a late dialog callback removing a replacement review
and an outer journal accepting an unsupported renderer success. The
repairs bind each callback to its captured review and each new typed
non-unknown outcome to the exact durable native receipt. Exact legacy
terminal replays and unknown outcomes remain supported. The corrected
model passed depth-four symbolic safety across all four operation classes.
The evidence ends at Activity handoff.

The historical Files browser campaign checks three mounted schedules and
23 checkpoints over real IndexedDB browser storage. It observes category
membership, canonical selection, conflict-safe moves, Trash and restore,
and refusal of a stale reviewed identity. Three separate mismatch receipts
compare the category, conflict and identity ablations. Earlier agent
proposal transport and installed Android storage retain separate evidence.

`HostedBackgroundAdmission` checks the renderer wrapper against nine
schedules and 52 checkpoints. It observes the generated attempt identity,
actual abort signals and forwarding listener cleanup, session-targeted or
global pause, and reservation, configuration and cancellation settlement.
Native replies use controlled ports. The campaign holds begin and configure
replies and coalesces the microtasks between cancellation attempts. The
native journal and worker run remain separate evidence.

The historical Notes replay checks five mounted schedules and 31 checkpoints
against the current canonical controller, Previous Notes storage and a
synthetic browser microphone. Four separate comparisons record collection
revision admission, recovery after folder deletion, segment rollover and
the durable Stop boundary. Native recovery and recognition liveness remain
open.

The strict aggregate at `218935d633e6` completed all five source campaign
families and admitted current receipts for 157 of 168 registered models.
It exited 2 with 346 refinement obligations and 1,711 unobserved fields.
The later mounted historical campaigns address some missing model receipts.

The application and native aggregate tests allow 20 minutes per family.
The earlier application campaign took more than 10 minutes in an isolated
suite run, and the strict native campaign took more than 15 minutes under
concurrent verification. Focused source tests keep separate deadlines.

`CalendarPreservationConfirmation` checks ten mounted schedules and 69
checkpoints. The current Settings view, controller port and reviewed marker
fingerprint must agree at dispatch. An owner replacement or Back retires
the admission and its publication. An already-dispatched owner-keyed CAS
can settle while that review is retired. The fixture uses browser storage
and a closed Calendar port with synthetic records.

`NativeSmsDispatch` checks 26 schedules and 186 checkpoints across exact
review, SIM revalidation, receipt retries, provider rows, callback custody
and journal failure. The preserved as-built replay reproduces a foreign
receipt when two bridge instances approve different bodies for the same ID.
The authenticated product patch binds recovery to the original reviewed
tuple, including pruned IDs, and preserves the one synthetic radio attempt.
Both Android variants use the patched native module. Carrier behavior and
installed Android role enforcement remain open.

Mounted Calendar draft regressions preserve the last valid bytes after an
invalid edit, clear the validation latch after explicit discard and keep a
retained draft when Edit opens from either the same event or a different
event. The current event detail stays usable. Explicit Resume or Discard
owns the retained slot before a fresh edit can enter.

The standard local Android build and APK verifier passed at `974423a956` for
standalone and launcher. The checked set includes four packaged APKs and two
built instrumentation APKs. Both release APKs are unsigned and the packaged
voice host remains unqualified. This build covers the Clock and Google
access-choice repairs at that revision.

The historical `SignIn` replay checks three mounted schedules and 13
checkpoints. It observes offered methods, a wrong email code followed by
verified synthetic account admission, Back from a text challenge and Back
from a held Google request. The current historical profile has a separate
pre-chooser gate. That mismatch has its own receipt. Native authentication
and external browser behavior remain outside the Chromium campaign.

`CanonicalCalendarEditorClose` checks eight mounted schedules and 80
checkpoints through the header Back, host Back, picker, retained slot and
explicit discard paths. It verifies all ten model fields and six derived
controls. The historical Calendar replay separately checks four mounted
navigation schedules and 16 checkpoints against the unchanged proposed
model. Historical outbox, RSVP, undo and unmounted views remain open.

The historical Photos replay checks four mounted schedules and 41
checkpoints with actual browser media and IndexedDB. It preserves six
comparisons for window order and width, selection cap, favorite and patch
behavior, and Save copy. Android MediaStore and external share recipients
remain separate evidence.

The historical GoogleConnect replay checks three mounted schedules and
eight checkpoints. It observes the Google accounts review, combined-grant
Inbox and Calendar navigation, and mailbox retirement after a grant
readback. The original direct-consent path and read-only combined request
each have a separate mismatch receipt. The authorization handoff uses a
closed synthetic port.

`NativeMmsDispatch` checks 20 schedules and 137 checkpoints. The retained
baseline shows two late approvals returning a different MMS binding or an
SMS receipt for the same operation ID. The authenticated patch requires the
exact reviewed tuple and MMS record kind, distinguishes expired from
invalid, and keeps PDU cleanup and the single handoff. The combined staged
source also passed all 26 SMS schedules again. Radio, Android role and
provider effects use controlled ports.

The historical Maps replay checks four mounted schedules and 29
checkpoints. Six separate receipts cover offline status, origin entry,
chat retention, arrival and failed reroute. The guidance surface clears the
measured assistant dock in portrait and landscape. The mounted replay
checks two sizes per orientation and two text scales, including
guidance controls, attribution, Map information and the right-docked
assistant. A portrait tap admits the exact reroute request.

`HostedDigestRefresh` checks nine mounted schedules and 73 checkpoints. A
queued full refresh and a delayed poll status read keep their exact session
authority. The source regressions reproduce a previous agent's label on
the replacement result and an early replacement inbox request. The repair
passes both schedules and preserves same-session promotion. The hidden full
demand is checked through the resulting dispatch and publication.

`CanonicalCalendarDraftHandoff` checks five mounted schedules and 44
checkpoints through Notes and the synthetic Camera scan review. A retained
canonical draft keeps its exact bytes and originating view until explicit
Resume or Discard. Fresh Note and Camera drafts still enter. Native reminder
drafts retain their separate path.

`NativeTextScaleLifecycle` checks eight JVM schedules and 73 checkpoints
covering the actual Activity, persisted scale, queued writes and native
timeout readback. Android events and durable preference failures are
controlled. The standard build and APK verifier passed both variants at
`39d801b512`, including the SMS repair and earlier Calendar changes. Those
APK results are independent of installed-device and carrier behavior.

The historical Camera replay checks four mounted schedules and 27
checkpoints with synthetic browser media. It covers first frame, zoom and
lens, chat grace and release, and actual scan review. Capture settlement,
historical agent queuing and native resume remain explicit obligations.
All registered historical designs now have bounded source replays in the
branch. The selected projections and unsupported actions remain separate.

`DevelopmentRuntimeLoader` checks 21 schedules and 91 checkpoints with
authenticated synthetic source, private temporary state and a closed build
port. An optional real Bun run adds the repeated-build schedule and seven
checkpoints. The fixed generated URL can return the earlier module while
the generated bytes and receipt have advanced. The shipped development
entrypoint invokes the loader once per process.

`CameraPreviewRetirement` checks three mounted schedules and 33 checkpoints.
It observes the pre-commit release latch, the count of actual synthetic
preview requests and the release of late streams. Leaving suppresses a
second preview request while the old view is still committed. Deliberate
reentry still opens a fresh preview.

`NativeCrashJournal` checks 12 JVM schedules and 125 checkpoints. The
product bridge projects the native problem journal through the shared
redaction rules and accepts only safe integral timestamps. The source
campaign preserves valid rows, history watermarks, clear and pending
worker behavior. All log input is synthetic.

The digest save regression checks that a retired journal clear can settle
without dispatching a new owner's refresh. Independent replacement saves
keep their own busy state and exact durable slot. Late rejection text stays
within its original binding.

`HostedDigestMutation` checks eight mounted schedules and 67 checkpoints
over that repair. It observes legacy, reviewed and dispatched pending
records, exact retry, refusal and owner-keyed removal. One hidden stage
map is compared through the actual requests and publications it produces.
Native consent, renewal rebind and real provider settlement remain separate.

`CombinedAgentLauncher` checks 21 schedules and 174 checkpoints. The
baseline records a live child after a metadata-write failure. The repaired
launcher installs ownership before writing the receipt and reaps only its
own child before propagating that failure. Exact exit and signal paths,
validation-only behavior and PID-less spawn-error receipts remain covered.

`ReviewedWorkflowLauncher` checks 16 schedules and 104 checkpoints with
a closed child and local package inputs. A real Bun invocation in the same
isolated fixture adds three schedules and 27 checkpoints. The baseline
records a live child after the receipt or post-spawn Git read fails. The
launcher now reads the revision before spawn and shares child ownership
and failed-receipt cleanup with the combined launcher. The receipt
records spawn. Workflow readiness requires a separate HTTP observation.

`NativeSettingsHandoff` checks nine JVM schedules and 155 checkpoints
for all 15 allowlisted routes, explicit Settings home and the password
provider fallback. Controlled Activity failures reproduce the existing
targeted launch behavior. Installed Settings delivery remains open.

The authenticated Browser Files patch serializes Trash, listing,
Restore and Empty for each journal key. The baseline could erase a
moving file's origin record during listing or lose a peer Trash record
when Restore saved an earlier journal snapshot. Both exact synthetic
schedules now preserve the records. The primary path uses an exclusive
Web Lock. The fallback serializes the journal within one realm.

`SourceRenewalQuestion` checks 11 mounted schedules and 81 checkpoints.
The baseline reported an old question's failure into a replacement
binding and asked the native bridge to settle a tap before checking
composer admission. The repaired panel keeps the report in its exact
binding and checks the composer before native settlement. The replay
covers exact reread, owner replacement, explicit dismissal, lifecycle
interruption, settlement refusal and the final composed text. A
composer can still retire after settlement dispatch. The post-settlement
check keeps the draft out of that retired conversation.

`NativeSourceRenewal` checks 11 JVM schedules and 118 checkpoints.
The baseline could report posted when the second permission read
skipped the platform call. The repair keeps that row eligible for
another attempt and preserves retry eligibility if saving the reset
fails. Clear and owner withdrawal can cancel the platform alert before
the journal write fails. Installed delivery and scheduling are separate.

`BrowserFilesTrash` checks 12 schedules and 82 checkpoints over both
locking paths. It observes queued operations, exact origin markers,
restore, reviewed Empty and retention. The baseline records temporary
names that survive a failed move or restore and can hide the original
file. The authenticated Files repair moves and renames a row in one
IndexedDB transaction under its reviewed revision. An actual Chromium
fixture checks a missing destination, a stale source and a newly
occupied restore name. The first two preserve the original file. The
third preserves the exact Trash row and marker for a successful retry.
Cross-tab scheduling, legacy hidden rows and interruption between the
IndexedDB and journal writes remain open.

`MapsRerouteOwnership` checks seven mounted schedules and 49 checkpoints.
The baseline agent reply treated a reused provider route ID as a
failure after the new route was installed. A reply from a retired
guidance session could also report the replacement as its own.
The repaired adapter compares the exact admitted route publication
and guidance session. The renderer still keeps the current route when
its provider refuses the reroute. Same-component Android task removal
remains a separate installed-platform obligation.

The strict 183-model run at `d4427bdd0c` completed the application,
services, native and composition campaigns with current receipts for
156 runtime models. A transformed initializer failed before historical
SignIn could reach the email field. The initializer now carries its
required helper in the same browser script, and the focused transformed
SignIn regression passes. Independent historical campaigns now retain
their receipts and exact failure diagnostics when another campaign
fails.

`NativeAssistantEntry` checks 35 closed JVM schedules and 259
checkpoints. The baseline shows Capacitor's internal load callback
replacing the verified cold invocation origin before readback. The
repair keeps the origin for the exact sanitized intent passed through
bridge load and preserves normal warm invocation handling. The replay
checks listener, System UI, untrusted and Power cases, plus exact
one-shot readback. Android caller delivery, task placement and live
voice capture remain separate.

The shared plugin runtime's baseline records late eager and lazy
connectors after unload, including takeover of a rival or same-name
replacement. The authenticated repair fences publication by the exact
runtime and plugin ownership at withdrawal. `CoreConnectorCustody`
checks ten controlled runtime schedules and 41 checkpoints for connector,
post and send-handler publication, sibling keys, disposal ordering,
nested registration and two isolated runtimes.
The Android mobile producer observed the connector patch as its
twelfth authenticated transform and passed the pre-provider turn smoke.

`NativeActionRecovery` checks 35 JVM schedules and 189 checkpoints for
notification, deletion and reminder receipt recovery and passive
history. The baseline reproduced foreign-binding reminder recovery
and selected reminder details in passive history. The repair derives
the selected row's exact binding before reminder lookup. Passive
history exposes a retained-details flag, and exact reads and stored
bytes preserve the original result. The replay uses synthetic receipts
and observes no repeat dispatch. Platform receipt delivery and
physical storage durability remain open.

## Authored stylesheets

The source ledger includes 15 product stylesheets. Their allocations
follow the owners of the conditional presentation. They remain
provisional pending semantic review. Shared style assets retain the
separate consumed-source discovery policy.

| Source area | Mounted evidence and remaining state |
| --- | --- |
| Phone and prototype | Maps hit targets, dock clearance, Calendar agenda retention, Camera layout and reduced motion have mounted evidence. Modal and composer scrim ownership across app families remains open. |
| Workflow and scan | Workflow filters, typed layout, correction and review have mounted cases. Pending filter focus and the video review viewport still need their own projections. |
| Browser dialogs | Calendar, document, review and attachment styles now have source allocations. Cross-dialog pointer and focus ownership remains open. |
| Device and startup | Existing profile, inset and permission fixtures cover visible setup states. The audit keeps the style conditions for pending, disabled and short-height presentation. |
| Membership, connection and Undo | Billing and Undo style inputs follow their operation owners. The mounted connection-notice model observes both notices, their independent dismissals and Settings suppression. |

`MobileBundleAdmission` checks 11 source schedules and 191 checkpoints.
The driver exercises the actual receipt producer and verifier with
reviewed SDK inputs, the exact UUID transform, all 12 core transforms
and synthetic bundle generations. It checks stale receipt refusal,
missing, duplicate and altered transforms, and publication of a fresh
receipt. The actual Android producer and its pre-provider smoke have
separate provenance. Staging interruption and installed execution
remain open.


### Combined pull-request integration (2026-11-08)

The integration retains the source/model boundary: refreshed coverage hashes do not
prove semantic refinement. Canonical notification acknowledgement now rechecks the
exact owner and agent before consuming a tap token. The source-driven trace includes
an attempted acknowledgement after an agent switch. Explicit retirement clears both
waiting and delivered tap slots; temporary suspension preserves them.

The hosted-result model admits the existing reconciled-result replacement behavior:
a changed retained digest starts a new dispatch generation, while repeated publication
of that same digest does not repost it. The native harnesses compile the current
bridge handlers and explicitly model the separate source-renewal port. Tests of the
draft signing workflow use synthetic keys only and portable archive/stat fixtures.
`CloudConnectionNotices` checks two mounted schedules and 16 checkpoints.
The baseline shows the sign-in notice intercepting the plan notice's
Redeem, Choose and Dismiss targets. The repaired stack preserves the
two notices and their independent actions. The replay checks Settings
suppression and return, pointer access, keyboard order and a scrollable
360×480 viewport at 150% text. All account and billing effects use
closed fixture ports.

The runtime-source ledger also records the development bridge and
storage, SDK preparation and copy, client/native patch projections,
workflow worker publication, native Google artifact, mobile producer,
Android profile and packaging scripts. Their model allocations describe
the relevant owners. Individual stage, backup, interruption and QA
launcher behaviors retain separate review obligations.

`WorkflowWorkerStaging` replays 14 schedules and 55 checkpoints through
the actual host artifact verifier and publication helper. It rehashes the target,
extraction index and retained backup, and refuses coherent manifest
replacement during copy. A refused publication restores the previous
target when rollback succeeds. A refused rollback leaves the previous
artifact in its backup. A failed backup cleanup can report failure
after the new target was published. The fixtures use private scratch
directories. Installed extraction and process interruption retain
separate evidence.

`NativeGmailBackground` replays 29 staged JVM schedules and 292
checkpoints. The baseline let a held configuration commit after
withdrawal of its grant. It also let an already captured tap consume
after the grant's remote revocation. The authenticated repair retires
the matching pending grant and preserves unrelated saved and pending
state. Consumption rechecks the exact tap and authorization before
publication. Local question cancellation remains available offline.
The campaign uses synthetic transport, storage, scheduling and notice
ports. A refused enqueue releases only its exact unadmitted selection,
so the saved cursor resumes under a fresh epoch while earlier workers
and newer selections preserve their own custody. Installed delivery,
scheduler timing and accepted work draining remain open.

The 200-model standard Android build produced both variants and reached
the independent APK verifier. That verifier still had the prior core
patch allowlist and rejected the connector transform. The corrected
policy requires the exact connector patch and checks its independent
target list against the reviewed manifest in the focused test.

`NativeGoogleHostArtifact` checks 18 schedules and 148 checkpoints.
The baseline admitted a receipt for different source bytes than the
compiler consumed and could leave a changed module with the old
manifest. The producer now binds concrete loader bytes and exact
core preimages, verifies the private candidate, and compares the
current pair before publication. A refused manifest rename restores
the prior module under the serial producer contract. The two-rename
intermediate state, process interruption and installed execution
remain separate.

`ModalScrimOwnership` checks 15 schedules and 85 checkpoints. The
baseline let a captured raised-input scrim press survive a modal
opening, including open-and-close before the old release. The
repair retires the exact press at inert or native modal coverage and
fences both release and compatibility fallback. Trusted mouse and
touch, React's native event identity, unrelated mutations and a fresh
press have separate controlled observations. Full product modal entry
points and half-sheet ownership remain separately scoped.


`PreparedSourceStamp` replays 10 local Git schedules and 43 checkpoints.
The production preparer checks the exact checkout before accepting a stale
stamp for supersession. The replay compares complete old and new stamp
bytes, the external backup and preexisting lock or candidate bytes. An
occupied external backup stays intact. A refused candidate open after backup
preservation leaves the old stamp and its exact preserved copy. The modeled
retry still refuses that occupied backup path. Concurrent qualification,
interruption between durable operations and the dependency install remain open.

At `4f3463f63d`, the normal worker producer requalified its SDK stamp while
preserving the prior stamp and the earlier worker. The new Bun 1.4.2 artifact
and independent host and worker verifiers passed. The 182,682-byte Google
host records 59 inputs. Its module SHA-256 is
`562ad5cfd5c302f691797a4665f9aa43ff5a907d967e4d38f959614218f4ca84`.
The selected host graph used zero core transforms. The mobile runtime bundle
binds its separate core transform selection.

`NativeDigestConsent` checks 18 closed JVM schedules and 142 checkpoints.
The historical baseline could return captured describe metadata after
revocation or exact expiry during a held Calendar identity read. The native
host now rechecks the current grant and clock after that verification,
using the existing owner guard. The fixture confirms one Calendar identity
query, exact response provenance, read bounds and rejected retired work.
Installed providers and subsequent renderer or model use remain open.

`CloudQaLauncher` checks 19 schedules and 127 checkpoints through the actual
private profile and receipt implementation, using controlled child events.
The historical launcher could change a linked log target's mode. The
launcher now checks the opened descriptor for a regular single-link file
before changing permissions or passing it to the child. The fixture observes
unchanged foreign bytes and mode, refusal for a FIFO, retained regular log
contents, and exact child cleanup on failed receipt publication. Cross-process
profile races, kernel signal behavior and live service readiness remain open.

The frozen strict run at `4fda14a9ec` credited 116 of 198 models. Services,
native and composition passed. A cold shell mount timed out and the old
application collector omitted earlier receipts. Independent revalidation of
the retained artifacts recovered 39 application receipts for 36 models,
306 traces and 1,767 checkpoints from that same revision. The strict result
still records the failed run. The legacy collector retained 40 receipts
despite separate Home mount and Google fixture failures.
The Home replay now has its own navigation budget. Application campaigns
retain results on either side of an individual failure while the aggregate
still reports a failed run.

`NotesRecorderMediaAdmission` checks five mounted schedules and 34
checkpoints. Both the Notes button and the approved Notes recording control
now wait for confirmed playback retirement before requesting capture. A
refused stop leaves capture idle. Owner changes and Notes departure retire a
held request. The approved action already requires the Notes view, and the
replay checks fresh admission after reentry. Installed media focus, native
microphone timing and broader playback and recording interleavings remain
separate.

The Google Connect fixture now runs through the same `tsImport` entry as the
strict collector. Its browser initializer has no dependency on the host's
transpiler helper. The mounted replay passed three matching traces and
retained both expected historical differences.

`RetainedReminderTapAdmission` checks eight schedules and 34 checkpoints
through the actual renderer adapter. A held render used to acknowledge a
tap after the chooser, a sensitive surface or a Calendar form took
precedence. The commit now rechecks the same eligibility gates as the
initial read. The closed replay confirms retry after the chooser closes
and retains a newer native token when the old attempt is refused. Installed
notification custody, question handling and legacy navigation remain separate.

`BrowserCloudRequestCustody` checks three schedules and 25 checkpoints
through the actual development bridge handler. The as-built rejection of a
duplicate removed its incumbent's cancellation entry. The current bridge
releases the entry only for the owning controller and keeps an aborted entry
until that handler settles. Synthetic request, response and transport ports
exercise exact cancellation and late response close. Authenticated routes,
real HTTP and process restart remain separate.

The real Google host manifest maps its 59 loader inputs to 57 canonical
product and SDK paths and one installed dependency. One SDK configuration
appears both in the prepared checkout and under `vendor/eliza`. The ledger
records the raw inputs and their relevant model allocations. The compiler
receipt retains the exact effective bytes for 12 prepared client inputs.
The mailbox host and combined source helper are now part of the provisional
runtime source inventory.

The integrated Notes replay captured all five schedules and matched its
pre-execution and post-execution source hashes. Its first checker process
ended without output. Running the checker again on those exact observations
passed all 34 checkpoints and 12 fields. Future receipts retain checker exit
status or signal separately from source/model mismatches.

The archived view-refresh sources retain their original 22 TLC
configurations and historical results. Their active entry points now use
the four Quint modules. The product and SDK TLA+ files remain available as
translation evidence, and the pinned SDK checkout remains unchanged.

The source ledger also enumerates the Vite and Capacitor inputs, Android
host and asset staging, AOSP staging, Cloud deployment generation, the
production bundle audit, test-mock selection and packaged license emission.
These are provisional allocations for build and publication state.

`GmailAgentMailboxRecovery` checks 45 schedules and 299 checkpoints through
the actual mailbox host, Cloud protocol and shared mailbox client. Exact
scope, turn, message revision, review digest, grant and expected label
outcomes are observed through in-memory ports. Lost dispatch replies cause
at most one readback in the invocation. A non-prepared prior receipt does
not dispatch again. The prior prepared case can go through review again.
Provider durability and concurrent invocations remain separate.

The exact 211-model strict run produced passing Notes and ShellNavigation
receipts before a Node segmentation fault ended its reporting process.
Individual artifacts were retained. The crash record establishes a tool
failure and leaves the faulting operation unresolved. The exact 213-model
focused suite passed 29 Node tests, TypeScript, selected formal checks and
the 409-file mock-disabled production bundle audit.

`ReminderOpenIntent` checks 12 schedules and 56 checkpoints. A late legacy
read may update its cache after navigation, while opening a detail requires
the original visit or one direct Calendar transfer. The replay preserves the
Workflows row handoff before the Calendar view commits, latest-refresh
ownership, expiry and the exact occurrence. Mounted delivery and journal
reconciliation remain separate.

`NativeCalendarScopedReview` checks 19 schedules and 105 checkpoints. A
held inspection previously could insert a stale ticket after pause cleared
its epoch. Insertion now checks the captured epoch under the same monitor as
pause. The closed JVM replay covers exact target identity, provider revision
changes, confirmation and fresh-epoch review. The enqueue port is synthetic.
Installed lifecycle timing and downstream Calendar effects remain separate.

The exact 213-model commit `421bbd82a0` passed normal Android packaging and
independent verification for both variants. Its two releases are unsigned
and non-distributable. The four app APKs and both instrumentation APKs are
retained under that revision.

`DevelopmentDigestPending` checks seven schedules and 52 checkpoints. The
old development store rejected the renderer's normal transition from review
to dispatched. The repair permits that phase advance for the exact payload,
including a legacy record without a phase. The host still compares the
original stored bytes. The closed replay covers stale tabs, changed review
payloads and failed or uncertain acknowledgement. Physical durability and
provider effects remain separate.

The older full verification exposed stale Power and notification JVM
fixtures. Their stubs now match the current bridge entry and owner/agent
requirements. The mounted reminder fixture also supplies the synthetic Agent
access-preference method used at startup. These fixture changes preserve the
real product methods in the checks.

`FirstSendDraftMigration` checks 11 schedules and 83 checkpoints. Cleanup
now checks the current owner after each read and confirms the copied text
before clearing the exact source revision. The replay covers a changed
destination, retirement and source CAS conflict. An independent destination
write after final confirmation can still race the source CAS. The two slots
retain separate storage and durability obligations.

`NativeCalendarSyncEnable` checks nine closed schedules and 80 checkpoints.
An older accepted review previously could enable durable consent after
Calendar sync pause, even when pause left identical raw bytes. The bridge
serializes the exact enable CAS with lease retirement. A completed pause
fences that write, and an exhausted pause CAS reports unavailable while
preserving the previous durable row. Provider dispatch, cross-instance
ordering and installed lifecycle delivery remain separate.

The 217-model focused run passed 14 Node tests, TypeScript and the
selected digest formal checks. All ten mounted Chromium reminder cases
passed with the closed Agent preference stub.
