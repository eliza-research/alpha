# Quint migration and application-state coverage report

Prepared on 2026-11-07, before implementation delegation.

## Objective and evidence boundary

Replace every authored TLA+ specification with executable Quint, preserve its
design comparisons and properties, and add models for Alpha's currently implicit
application state. Model runtime behavior separately from historical design
proposals. Coverage includes production, explicit development surfaces, Android
wrappers, the AOSP listener and product-owned backend composition.

The working tree already contains extensive unrelated changes, including edited
Calendar specifications and untracked Calendar/Google integration source. This
work uses those current files as input and preserves their edits. The source pin
at inventory time is `b25d8aef2916385c571f4367e099809254fde0bb`.

An executable model covers an abstraction of application state. Each domain needs
source mappings, meaningful transitions, failure/restart paths, invariants and
scenarios. A mapped file alone does not establish implementation conformance.
Random simulation, bounded symbolic checking, exhaustive finite-state checking,
implementation tests, APK inspection and installed-device acceptance must retain
their distinct evidence labels.

## Inventory performed before implementation

Read `README.md`, `docs/architecture.md` and `docs/implementation-plan.md`.
Inspected root package scripts, product source directories, state/status type
declarations, the seven specifications, their model configuration and runners.
Searched tracked and untracked authored files for formal-language sources and
searched the tracked `vendor/eliza` checkout separately. Generated runtime copies,
dependencies, binary build products and design exports are provenance/reference
inputs rather than additional authored application implementations.

### Existing formal specifications

| Existing source | State and properties to preserve | Required migration work |
| --- | --- | --- |
| `docs/flow-redesign-2026-11/tla/SignIn.tla` | Network, saved credential, readiness, screen, browser return, offered methods, scopes, taps, detours, fairness and eventual Home | Translate current/proposed modes, nondeterministic deployment facts, saturating counters, seven invariants and `ReachesHome` with fairness |
| `docs/flow-redesign-2026-11/tla/GoogleConnect.tla` | Granted/requested scopes, consent browser, Inbox/Calendar refresh, picker, cancellation | Preserve four invariants and three temporal properties, including scope monotonicity and return behavior |
| `docs/flow-redesign-2026-11/tla/Calendar.tla` | Selection, editability, malformed events, connectivity, outbox, visible saved changes and Undo | Translate the current working copy, five invariants and two temporal properties |
| `docs/flow-redesign-2026-11/tla/Maps.tla` | Search/route/navigation, provider faults, assistant handoff and recovery | Preserve two invariants and six temporal properties, including navigation survival and service progress |
| `docs/ui-refresh-2026-11/tla/ChatInput.tla` | Pointer ownership, composer/focus, draft and Back ordering | Preserve six invariants and the current/proposed comparison |
| `docs/ui-refresh-2026-11/tla/HomeLayout.tla` | Grid, cards, loading/content, setup and top region | Preserve five invariants and the current/proposed comparison |
| `docs/ui-refresh-2026-11/tla/SettingsNav.tla` | Page stack, entry points, destructive confirmation and navigation depth | Preserve seven invariants and the current/proposed comparison |

There are seven authored `.tla` files and no pre-existing `.qnt` files in these
sources. The tracked upstream checkout contains neither extension. Both design
folders also have `models.json`, a Python TLC runner and historical `results.md`.
The flow folder's previously tracked `tla2tools.jar` is already deleted in the
working tree. Migration must remove obsolete runners/configuration, update active
links and retain historical results with their original evidence classification.
The absent JAR must stay absent.

### Unmodeled runtime domains and work packages

The following decomposition keeps related state together while making account,
revision, generation, lifecycle and approval boundaries explicit. Representative
source paths below identify entry points. The implementation inventory must
account for every authored application source file, including pure adapters and
development-only code, and identify shared dependencies separately.

| Package / planned module | Source entry points | State and transitions | Properties and adverse scenarios |
| --- | --- | --- | --- |
| Root / `Application` | `main.tsx`, `runtime/alpha-client.ts`, `prototype/model.js`, `platform-plugins.ts` | Active view, owner, session, lifecycle, outstanding action and generation | Cross-domain account switch, reset, lock and stale completion fences, no unreviewed external effect |
| Root / `ShellNavigation` | `runtime/view-navigation.ts`, `prototype/model.js`, `prototype/*adapter.ts`, `prototype/subview-accessibility.ts` | View/subview stack, sheet, focus, keyboard, selection, Back, recreation | One active surface, ordered Back, draft preservation, reachable dismissal |
| Root / `StartupPermissions` | `startup-permission-*`, `startup-permissions.tsx`, `runtime/aosp-image.ts` | Sign-in prerequisite, per-permission prompt/denied/settings/granted, saved completion, platform capabilities | Ordered requests, blocked prompt suppression, return from Settings, upgraded completion |
| Root / `AssistantConversation` | `runtime/alpha-client.ts`, `conversation-selection.ts`, `assistant-draft-*`, `prototype/agent-adapter.ts` | Attach/detach, owner/session, draft, send/stream/cancel, proposal/receipt | Sensitive-view suppression, stale response rejection, consumed proposal deduplication, conversation identity |
| Root / `NotesLifecycle` | `runtime/notes-*`, `note-*`, `prototype/notes-*`, `runtime/notes-store.ts` | Load/edit/save/conflict, secure storage, trash/Undo/expiry, audio/source leases | Failed saves retain edits, deterministic merge boundaries, deletion never resurrects bytes |
| Root / `BrowserSession` | `browser/browsing-session.ts`, `browser/browser-surface.ts`, `prototype/browser-*`, Android `Browser*`, `AlphaBrowserPlugin` | Tabs, history/bookmarks, navigation, private mode, permission, downloads and external return | Origin isolation, private state erasure, explicit external handoff, obsolete navigation callbacks |
| Root / `CredentialVault` | `passwords/*`, `browser/password-provider.ts`, Android `PasswordProviderSupport` | Lock/unlock, provider selection, origin match, fill/save review, cancellation | Locked vault isolation, exact origin binding, fresh review before fill/save, migration disabled in production |
| Root / `DevelopmentSurfaces` | `build-flags.ts`, `browser/development-*`, `runtime/development-*`, `runtime/mock-admission.ts` | Production/dev admission, fixture selection, synthetic lifecycle and transport | Production excludes fixtures, remote pairing and development hooks, explicit dev mode remains isolated |
| Services / `IdentitySession` | `runtime/cloud-sign-in*`, `cloud-protocol.ts`, `native-connection.ts`, Android `CloudSignIn*`, `CloudEmailCode`, `CloudSmsCode`, `AlphaCredentialStore` | Readiness, PKCE, callback state, code attempts, credential intent/ack/revoke and account replacement | Single-use matching callback, mismatches ignored, bounded retries, retired owner cannot commit |
| Services / `ServiceAuthorization` | `runtime/subscription-entitlement.ts`, `cloud-environment-selection.ts`, `managed-service-routes.ts`, backend `managed-google-*` | Environment fingerprint, entitlement expiry/revoke, service route/capability admission | No per-turn billing preflight, expired authorization denied, local agent remains available, exact service/owner binding |
| Services / `GoogleAccounts` | `runtime/google-accounts.ts`, `google-connect-flow.ts`, `google-authorization.ts`, `gmail-grants.ts`, Android `GoogleConnectReturn` | Multi-account choice, grant refresh/withdrawal, pending connect and App Link return | Superseded return rejected, read/write grants distinct, selected account is current, denial never authorizes |
| Services / `CalendarSync` | `runtime/calendar-*`, `google-calendar-*`, Android `CalendarSync*`, `CalendarCreationStore`, `AlphaCalendarPlugin` | Local edit, review, revision, selected calendar, sync consent, durable outbox, claim/write/readback/retry/Undo | No stale owner write, create recovery identity, conditional edit conflict, unknown outcomes retained, consent revocation fences |
| Services / `InboxDelivery` | `runtime/gmail-*`, `inbox-*`, `reviewed-mail-context.ts`, `prototype/inbox-*`, Android `Gmail*`, `AlphaGmailPlugin` | Folder/page/cache, account-bound draft, attachments, reviewed send, dispatch/readback/unknown | Exact reviewed bytes/recipients, no duplicate unknown send, grant loss retires work, stale pages excluded |
| Services / `MapsNavigation` | `maps/*`, `runtime/maps-*`, `prototype/maps-*`, Android `AlphaMapsTransportPlugin`, `AlphaNavigationService` | Search generations, selected route, GPS freshness, reroute, service faults, native navigation/assistant return | Fresh route commits, failed reroute retains route, account and lifecycle isolation, local guidance continuity |
| Services / `WorkflowExecution` | `runtime/workflow-*`, `phone-workflow-authoring.ts`, `prototype/workflow-*`, `browser/workflow-*`, backend `proposal-action.ts` | Author/review/install/enable, trigger cursor, queued run, action proposal, cancellation and durable receipt | Approval bound to revision/owner, retry deduplication, disabled trigger stops new work, terminal outcome remains stable |
| Services / `NoticesAndCaches` | `runtime/hosted-*`, `digest-inbox.ts`, `service-read-cache*`, `notice-owner-coordinator.ts`, Android `Hosted*`, `WorkflowNotice*`, `SourceRenewal*` | Cache expiry, owner-scoped notice claim/post/tap/ack, source renewal, scheduled reconciliation | Exactly-once claim/ack abstraction, account retirement, stale cache classification, restart recovery |
| Native / `ResidentRuntime` | `runtime/local-agent*`, `resident-recovery.ts`, backend `runtime.ts`, Android `AlphaLocalAgentPlugin`, `Resident*`, `LocalAgentProviderAdmission` | Source/profile admission, stopped/starting/ready/failed/recovering, provider bind/unbind, IPC epoch | Resident stays local, obsolete connection rejected, failed unbind remains visible, durable state survives restart |
| Native / `VoiceSession` | `runtime/voice-*`, `live-*`, `local-voice.ts`, `native-*voice*`, `cloud-voice.ts`, `app-speech.ts` | Capture, listening, short gap, transcription, submission, speaking, interruption, mute and stop | Late generation cannot play/submit, account binding, explicit Cloud disclosure/start, separate Notes dictation |
| Native / `SpeechResources` | `local-speech-playback.ts`, Android `AlphaLiveVoiceCapture`, `NativeLiveVoicePipe`, `Speech*`, `StreamingSpeechPlayback`, `AudioTrackSpeechOutput` | Mic/audio-focus ownership, stream format, PCM queue, cancellation, engine readiness and teardown | Single resource owner, bounded buffers, revoked focus stops output, stop releases capture and queued audio |
| Native / `AlwaysOnListener` | `runtime/always-on-listener*`, `android/sense`, `android/aosp/listener`, Android `AlphaListenerPlugin`, `AssistInvocation` | Consent, unlock, privacy, foreground/background, recognition ticket, pause/off/reset generation | Image-only admission, no pre-consent listening, locked data boundary, reset invalidates queued recognition |
| Native / `ResetRecovery` | Android `AlphaDataReset`, `ResetAuthorization`, `ResetRecoveryActivity`, `ResetCloudRevocation`, listener reset handling | Fresh credential confirmation, durable pending marker, listener revoke/ack, bounded retry, Android clear dispatch | No renderer reset authority, no initialization while pending, failed listener ack retains marker, late callback cannot recreate state |
| Native / `DeletionJournal` | `runtime/deletion-*`, `deletions.ts`, Android `DeferredDeletionJournal`, `NativeDeletion*`, `DeletionWorker`, `NotesDeletionLease` | Prepared/deferred/claimed/committed/restored/expired, leases, process death and retry | Undo only before commit, unique claim, owner/revision fencing, idempotent recovery |
| Native / `MediaLifecycle` | `prototype/camera-*`, `scan-*`, `photo-library-*`, `video-edit-review.ts`, `runtime/photo-library.ts`, Android `PermittedMedia*`, `Photo*`, `Video*`, `SelectedDocumentAccess` | Permission/scope/generation, capture, selected source read, scan/edit review, publish/export, playback | Revoked scope stops reads, source revisions exact, review binds output bytes, unpublished capture cleanup |
| Native / `DeviceActions` | `runtime/aosp-telephony*`, `sms-*`, `device-actions.ts`, Android `AlphaTelephonyPlugin`, `Sms*`, `AlphaContacts*`, `Clock*`, `AlphaReminders` | Image/role/SIM admission, reviewed SMS, multipart callbacks, contact reads, reminder scheduling/Clock handoff | Standalone cannot invoke AOSP tools, no repeat send after unknown, delivered needs provider evidence, handoff never claims completion |
| Root / `FilesAndSharing` | `prototype/files-*`, `file-email-review.ts`, `share-panel-adapter.ts`, `runtime/inbox-attachment.ts`, `media-copy-intent.ts`, Android `AlphaFilesPlugin`, `AlphaMailAttachmentsPlugin`, `IsolatedPdfService` | Selected document grant, read/review/hash/copy, recipient/draft binding, cancellation and PDF generation | Exact-byte copy, changed source/account invalidates review, cancellation does not publish, isolated rendering |
| Root / `PreferencesAndPresentation` | `prototype/settings-adapter.ts`, `home-cards.ts`, `home-launcher.ts`, `runtime/text-scale.ts`, `canvas-geometry.ts`, `dock-clearance.ts`, Android `SystemShade`, `AlphaSystemPlugin` | Persistent preferences, theme/text size, geometry/insets, layout/card availability, launcher role | Valid bounds, capability-aware presentation, rotation preserves state, one system shade |

Source names in this planning table are representative patterns and may cover
multiple files. Implementation will publish the exact per-file inventory and
review any unmatched paths, rather than interpreting a pattern as proof.

## Parallel execution plan

The report is written before dispatch. Four independent owners can now work in
parallel, with no runtime-source edits required for adding the specifications.

1. Legacy owner converts the seven design models into `specs/quint/legacy/`,
   preserving variable/action/property names, current/proposed distinction and
   temporal fairness. Records translation decisions and comparison scenarios.
2. Services owner implements the eight service/data modules in
   `specs/quint/services/`, reading the current account, Calendar, Inbox, Maps,
   workflow and notice implementations.
3. Native owner implements the eight native modules in `specs/quint/native/`,
   reading Android, listener, voice, reset, deletion, media and device code.
4. Coordinator implements the ten application/UI/storage modules in
   `specs/quint/application/`, shared validation, source inventory, dependency
   admission, CI integration and cross-domain scenarios. The coordinator reviews
   all packages and runs the repository and Android gates.

Every model exposes `init`, `step`, `safety` and named invariant definitions.
Runtime models include executable `run ...Test` scenarios with happy, stale,
denied, cancelled, unknown-outcome and restart paths as applicable. Domain models
must retain meaningful state rather than making a safety predicate true by
definition. Legacy models additionally expose current/proposed entry points.
Finite domains and simulation bounds are documented. Stuttering is explicit.
Temporal specifications and fairness are preserved even when a selected checker
cannot evaluate them. Unsupported checks must be reported as unrun.

## Tooling and coverage deliverables

- Pin `@informalsystems/quint` as a development dependency with the lockfile.
- Provide commands for parsing/typechecking, deterministic scenario tests,
  seeded safety simulation and separately invoked model checking. Use local
  pinned executables and clear failures for absent checker prerequisites.
- Make ordinary repository verification run a bounded, reproducible Quint gate.
  Add a dedicated CI path for formal checks if existing CI cannot run it cleanly.
- Generate a reviewed inventory for all authored renderer, backend, Android and
  listener source, with domain, source hash, state markers and treatment. Distinguish
  modeled state, stateless helpers, shared wrappers and development-only code.
- Check source additions/removals and changed hashes against the inventory so
  coverage cannot silently become stale. Enumerate upstream/generated ownership
  and never mutate the vendor checkout.
- Preserve historical TLC result tables as historical evidence. Remove migrated
  executable TLA+ source/config/runners only after Quint equivalents pass checks.
- Update the two design README links and add a central model guide describing
  source mappings, bounds, abstractions, check commands and evidence limitations.
- Add source-entry-point conformance checks for selected stateful contracts and
  test the coverage/checker plumbing with deliberate missing or invalid inputs.

## Completion criteria

1. Authored formal-language inventory contains the seven Quint conversions and
   no executable TLA+ specifications or obsolete TLC runners.
2. All domains above have executable state models, meaningful invariants,
   adverse-path scenarios and reviewed source mappings. Any remaining uncovered
   behavior or insufficient implementation conformance is stated explicitly.
3. Typechecking, scenario tests and seeded simulation pass for all admitted
   models. Actual symbolic/exhaustive checks record tool versions, parameters,
   outcomes and counterexamples separately from simulation.
4. Existing current-design violations remain reproducible and do not silently
   become successes during translation. Proposed-design checks preserve the
   source model's contract, including any discovered source-model defects.
5. `npm run verify` runs, and `npm run android:build:local` is attempted using
   staged on-device speech inputs. Inspect standalone and launcher debug/release
   results when available. Missing inputs or unrelated existing failures remain
   visible and do not justify changing production admission.
6. Evidence reports distinguish successful model checks, actual application
   tests, APK builds/audits, emulator HOME behavior, AOSP image boot, real provider
   integrations and physical-device/user acceptance.

## Tool references used for the implementation plan

Quint's official documentation distinguishes sampled simulation from model
checking and describes invariant and temporal-property checking. CLI capabilities
will be confirmed against the pinned installed version before implementation.
[Checking properties](https://quint.sh/docs/checking-properties)
[Model-based testing](https://quint.sh/docs/model-based-testing)

## Execution record

Implementation, exact inventory counts, checks and remaining limitations are
recorded in `specs/quint/README.md` and the generated verification evidence after
the parallel work is integrated. This initial report is a plan, not completion
evidence.

### Expansion during implementation review

The initial domain split was insufficient for several independent lifecycles.
The parallel reviewers identified these additional machines and implemented
dedicated specifications rather than treating a file allocation as coverage.

| Additional machine | Reason for separate modeling |
| --- | --- |
| `DurableStore` | Compare-and-exchange writes, retained legacy bytes, metadata corruption and reviewed recovery |
| `PermissionWalkthrough` | Six independent permission states, ordered durable progress and final readback |
| `DevelopmentDevice` | Actual simulated calls, messages, voicemail, navigation and payment states behind the build gate |
| `DevelopmentHost` | Private credential claims, resident replacement, active request cancellation and child-process lifetime |
| `DraftDispatch` | Per-conversation held text and serialized clear/release behavior around uncertain dispatch |
| `PermanentVoiceDeletion` | Separate durable note and recording effects, cross-view claims and recovery leases |
| `FilesTree` | Partial batch mutation outcomes, revision-bound navigation, selection and system-picker lifetime |
| `CalendarPresentation` | Month/day/search/menu navigation, visible-calendar selection and query-generation races |
| `NotificationCollection` | Opt-in external collection, consent, lock privacy, history retention and policy changes |
| `BrowserSiteState` | Cookie/profile boundaries, site grants versus platform permission, HTTP auth and passkey capability |
| `BrowserReadingState` | Isolated extraction, sensitive-content refusal, expiring single-use review and cancellation |
| `BrowserDownloads` | Reviewed download, redirect/cookie scope, streamed capture, publication and private-session cleanup |
| `ScanDocument` | Ordered pages/text layers, serialized autosave, picker visibility and irreversible export outcomes |
| `NativeCredentialMutation` | Shutdown before credential CAS, provider readback, admission invalidation and rollback |
| `PdfWorker` | Isolated service admission, single worker, timeout/memory abort and shared-memory ownership |
| `ApplicationComposition` | Actual imports of six domain models, coordinated account replacement and reset |
| `NavigationProgress` | Maneuver cursor, arrival accuracy, off-route retry, background handoff and stale sessions |
| `ListenerLeaseRecovery` | Indicator TTL/boot/grace, crash history and restart consent |
| `StreamingPlayback` | Writer/terminal races, partial writes, audio-head drain and terminal callback ownership |
| `ResidentScheduling` | Locked/disabled/busy admission and atomic schedule rearming |
| `RendererRecovery` | Renderer-loss window, bounded recreation, backoff and HOME escape |
| `VadSegmentation` | Consecutive high/low windows, speech-start/end hysteresis and reset |
| `VoiceIpcAssembly` | Active handle, bounded response assembly, completion marker, timeout and cleanup |
| `ListenerLeaseProducer` | Measured SystemUI eligibility, queued acknowledgements, provider validation and client generation |
| `CallbackLanding` | Static delegation-return validation, duplicate/oversized input rejection, URL clearing and app-link exposure |

The first integrated inventory contained 53 models and 330 registered scenarios.
Final review identified four additional native machines in the table above and
missing MFA, cancellation, restart and grant-restoration transitions in the
six-domain composition and its imported service models.
The HTML entry-point review also identified the delegation-return script and
added it to the models. HTML bootstrap and template inputs are now inventoried.
These required explicit model expansion. Final counts are recorded in the
verification report. The source ledger includes 858 files, covering 605 application files, 34
development-only files, nine development-runtime scripts and 210 test-support
files. Configuration inputs have separate hashes. The ledger records ownership
and drift, while model manifests record the actual state abstraction.

Review also corrected two false assumptions in the first model drafts. Native
sign-in may deliver an authenticated outcome before best-effort Steward cleanup,
and cancellation after credential commit must allow acknowledgement to finish.
Billing snapshots, signed entitlements and organization credits also have
different expiry and refresh-failure behavior. The models now distinguish these
source behaviors.

### Defect reproduced at migration baseline

The scan flow can automatically save a draft, accept an explicit Save draft,
then remove that draft after successful export because the automatic-save marker
remains set. `ScanDocument` keeps the desired preservation predicate separate
from current-behavior safety and contains an expected counterexample. The
isolated source-conformance runner reproduces the sequence through
`openScanDocument`. The initial migration recorded the defect. The subsequent implementation
refinement fixes scan ownership and checks preservation through the real editor.
See [the refinement report](quint-implementation-refinement.md) for the current
results and remaining obligations.

### Final evidence

The final inventory contains 58 model files and 396 registered scenarios. The
application, service, native and legacy families contain 20, 14, 17 and seven
models respectively. The integrated Quint gate passed 174 typecheck, scenario
and simulation phases. All 51 runtime models have current-hash four-transition
safety evidence, and the seven migrated designs retain exhaustive finite checks.

See `specs/quint/verification.md` for the completed check results, command bounds,
Android build blockers and the distinction between model coverage and full
implementation refinement.

## Reconciliation with current main on November 8

PR 825 was retargeted on GitHub to `main` while implementation refinement was
running. The checked source revision `796880e9ec` remains preserved on the PR
branch. Current main is `f2a0eb035da9c8ede24efe735d981a27dd403283` and consumes
upstream `475a8d59dc1811c2cde093613519906a5a3f6457`. The common-ancestor diff
contains 2,162 changed files, including moved shared controllers and generated
Android host ownership. A merge-tree check reports conflicts across product
sources, tests, build policy and the upstream pin.

The reconciliation worktree starts from current main's product sources. The
Quint artifacts and their historical evidence are carried forward. Each source
adapter must be reviewed against the new implementation before its result can
become current evidence. Historical receipts keep their recorded hashes.

### Additional authored TLA+ discovered on main

| Main source | Required conversion |
| --- | --- |
| `design/view-refresh-2026-11/tla/camera-session/Spec.tla` | Preserve camera focus, capture/leave, lens, chat grace and queued-agent design comparisons and each configuration. |
| `design/view-refresh-2026-11/tla/files-browser/Spec.tla` | Preserve folder/category/identity behavior, conflict and restore comparisons, finite budgets and fairness. |
| `design/view-refresh-2026-11/tla/notes-view/Spec.tla` | Preserve recording/ASR, segment, visibility, draft capacity, folder restoration and rename comparisons with fairness. |
| `design/view-refresh-2026-11/tla/photos-library/Spec.tla` | Preserve patch, favorite, capacity and window comparisons, store revisions and queued-agent fairness. |

The four specifications and their configurations are new migration inputs. A
tracked-file search at the new upstream commit finds no authored `.tla` or
`.qnt` files there. The existing seven converted legacy designs remain historical
Quint models.

### Revised parallel work packages

1. The application owner converts the four additional TLA+ designs, then ports
   the UI state models and source adapters. The current shell and Apps drawer use
   the shared mobile-shell launcher. Notes has pinned and ordinary rows, Files
   uses `files-browser-adapter.ts`, and mutable template lists still require
   source-backed identity review. Old UI patches are applied only where the
   corresponding current implementation exhibits the same defect.
2. The native owner maps reset, sign-in and deletion to the shared classes at
   the new pin. Activity and connection remain product wrappers. Shared behavior
   repairs use authenticated patches or reviewed upstream commits. Credential
   refinement includes the new shutdown-lease and provider-request lifecycle.
3. The services owner ports account, Calendar, Inbox, workflow, Maps and cache
   adapters and the new provider-draft/forward campaign. Removed local code is
   mapped to its actual shared successor, with current source hashes and ordinary
   entry points.
4. The coordinator preserves current main's product identity and build policy,
   integrates Quint tooling, inventories all current source and consumed shared
   state, composes the family models, and runs repository and Android gates.
   Current runtime-state reporting follows parsed Quint declarations, nested
   record aliases and imported instances so omitted fields stay visible.

### Exit conditions

All authored TLA+ is converted with its comparison configurations and temporal
properties retained. Every registered runtime model has current source-bound
receipts, with unobserved fields, unexecuted actions and external contracts
listed. The merged product passes repository verification and production bundle
admission. Android distribution, native installation, AOSP and real-provider
results retain their own qualification requirements. The PR becomes mergeable
against current main after the reconciled implementation is validated.

## Current-main reconciliation inventory

The PR base changed to current `main` during implementation. The reconciliation
starts at `f2a0eb035da9c8ede24efe735d981a27dd403283`, with shared upstream
`475a8d59dc1811c2cde093613519906a5a3f6457`. The earlier branch's successful
verification remains evidence for that earlier source. Its product source is
being ported selectively so current-main ownership and behavior are preserved.

The current inventory discovers 5,653 product and shared-source inputs. This
includes 4,813 upstream inputs selected by the client/native projections, direct
model dependencies and an authenticated Android bundle graph. The successful
producer parsed 4,338 first-party inputs, including 248 generated inputs with
origin mappings. The graph and its generator are bound as configuration inputs.
All tracked inputs and generated-source origins are checked against current
source bytes before coverage admission.

There are 83 registered models. The source ledger retains 5,288
`state-audit-required` rows and 1,533 rows with only the general application
domain allocation. These rows identify unfinished review. They do not establish
state-machine coverage or an implementation relation. The worker bundle,
runtime-computed imports, enabled feature paths and external providers remain
separate discovery and contract obligations.
The four newly discovered view-refresh TLA+ designs and their 22 configurations
now have Quint translations. There are no tracked `.tla` or `.cfg` files in the
product tree or its pinned upstream checkout. Historical design comparisons
retain their original source references as historical metadata. Their references
to deleted implementations are excluded from current runtime conformance.

Current-main work includes shared sign-in ownership, linked Calendar sync,
Inbox review/provider-draft flows, native task/recovery/credential coordinators,
renderer recovery, seven-step native and four-step browser permissions, canonical
Notes controller/draft state, segmented recording and live capture admission.
The actual core runtime now has separate retirement, service lifecycle and
shutdown models. Their bounded source campaigns record their remaining actions,
fields and composition obligations.

Further work includes Notes deletion/restore and UI joining, folders and recorder
UI, current Files and Photos controllers, launcher coordination, piped ASR and
frame buffering, media/device/listener owners, TaskService and trigger dispatch,
room leases and turn ownership, model/provider state, deferred boot and plugin
registration, and workflow process/worker lifecycles. The source graph provides
a file-level backlog for the remaining unclassified modules. The aggregate
report uses parsed Quint declarations to list unobserved fields and unexecuted
transitions, including nested records and imported instances.

PR 825 is mergeable against main after the reconciliation merge at `2f14ad0302`.
The frozen 76-model formal phases passed. Its full application test run remains
in progress and has exposed fixture/environment failures. Follow-up fixes are
being checked in the 83-model integration tree. Fourteen Cloud profile tests pass
when supplied the exact verified SDK tree and pinned Bun used by CI. Eight
background-restore tests pass after their fixture includes the actual operation
settlement helper. Full repository and distribution acceptance remain open.
The current-main Android build preflight rejects the voice qualification pin
`47982b8f49d16d520990e14e07cdeb5c6931df81` against the application's `475a8d5`
pin. APK verification then reports missing distribution artifacts. No Android
build, emulator role test, AOSP boot or device/provider acceptance is claimed for
this reconciliation.
