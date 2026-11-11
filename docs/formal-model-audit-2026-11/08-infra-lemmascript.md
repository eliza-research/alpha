# 8. Quint gate and LemmaScript

## Verified defects

Each row was re-derived from the code by a second reader told to refute it.

| ID | Verdict | Severity | Finding | Evidence re-read by the verifier | Fix |
| --- | --- | --- | --- | --- | --- |
| G1 | confirmed | medium | Model checking (verify/temporal/compare) is never gated | check-quint.mjs:116-138: `check` runs only typecheck/test/run. package.json:18 verify calls quint:check only; no `quint` string under .github/. .gitignore has test-results/. Corrections: manifests hold 43 legacy currentChecks (28 expected violations), not 37; ChatInput 6 with 4 violations and 12 currentTemporalChecks are right. ScanDocument's counterexample is still partly gated through its registered scenario and test/quint-scan-conformance.test.mjs. | Add a CI job (own timeout, Apalache/TLC available) running `quint:compare` and `quint:temporal` for legacy plus `quint:verify` on a rotating or changed-model subset; commit a hash-indexed proof receipt or fail when a model hash has no receipt. |
| G2 | confirmed | low | Temporal properties exist only on legacy models | Manifest `temporal` is non-empty only for SignIn, GoogleConnect, Calendar, Maps (CheckedTemporal); ChatInput/HomeLayout/SettingsNav have empty lists. grep for temporal\|eventually\|always(\|weakFair\|strongFair over application/, services/, native/ .qnt returns no file. This is a modelling gap, not a wrong result; check-quint.mjs:30 already refuses `temporal` on models without it. | Add fairness-guarded `temporal` properties to a few runtime models (DraftDispatch held-draft release, ResetRecovery completion) and list them in manifest `temporal` so `quint:temporal` covers them. |
| G3 | partly | low | No witnesses or reachability evidence | check-quint.mjs:119 passes no --witnesses although quint 0.33.1 supports it (dist/src/cli.js:267); simulation is 80x40 (lines 19-20). But 'nothing shows guarded states are reached' is overstated: 396 registered `run` scenarios with .expect() execute in the gate (line 117) and reach specific guarded states. Vacuous invariants do pass silently (see G6). | Add an optional manifest `witnesses` list per model and pass `--witnesses=` on the simulation run; fail when a declared witness count is 0. |
| G4 | confirmed | medium | Manifest fields bounds/additionalProofInit/invariants/stateMapping/components/temporalProperties are dead data | grep of those names over scripts/check-quint.mjs, quint-lib.mjs, scripts/ci/affected.mjs, test/quint-*.mjs and specs/quint/**/*.mjs finds only expectedViolations. bounds {1000,60,'123'} on 14 services + 2 native models vs gate 80/40. budgetInit/counterInit referenced by no script. ListenerLeaseRecovery.qnt:59,83,84,98-100 are action-local vals; safety (130) has five conjuncts. Only CallbackLanding has `invariants` in application. | In loadModels validate each `invariants` name as a top-level `val` in the model text; in `verify` run an extra one-step check per `additionalProofInit`; either honour `bounds` in simulate or delete the field. |
| G5 | partly | low | Symbolic bound shallower than scenarios | check-quint.mjs:20 default verify depth is 6; verification.md records four-transition evidence. NotesLifecycle.expiryTest (qnt:38-39) is exactly 6 transitions, so the default bound reaches it; only the recorded 4-step receipts do not. VAD's long boundary depends on counterInit, which nothing runs (G4). Verify is ungated anyway (G1). | Record evidence at the script default (6) or higher, and wire `additionalProofInit` checks so long-counter boundaries are covered without deep bounds. |
| G6 | confirmed | medium | Vacuous or trivially true invariants in three application models | PreferencesAndPresentation.qnt:9,25,28-32: nativeShade never assigned so webShade action is disabled; draft/selection never assigned; split (12) includes textScale<150; ReadableCalendar restates clamp (14). ShellNavigation.qnt: drawer only ever set false (branch 20 dead), DraftBound (39) is a value-domain check, revision<2 at 11 and 23. NotesLifecycle.qnt:31 holds since only commitDeletion sets deleted with live:false; revision conflict only in concurrentEditTest. | Model the real hazards: let nativeShade toggle and draft/selection be written by rotate/restart; add a drawer-open action; add a NotesLifecycle invariant such as `s.expected != s.revision implies` save disabled / draft retained; raise the revision bound. |
| G7 | confirmed | low | Conformance adapters cover 11 of 58 models | test/quint-conformance.test.mjs covers seven application models; native conformance.mjs:12 loads only AlwaysOnListener.qnt and lines 114-135 are hand-written Java assertions; recovery-vad covers RendererRecovery and VadSegmentation; scan adapter covers ScanDocument. Correction: CallbackLanding replays eight scenarios (lines 33-42) and StartupPermissions checks an intermediate state (72-74), not one final state each. verification.md openly states refinement is not proved. | Prioritise trace-replay adapters for pure policies already importable in Node (NotesLifecycle via notes-trash policy, ShellNavigation back ordering, CredentialVault), reusing modelTrace(). |
| G8 | confirmed | low | Source ledger is a hash-bump gate with no regeneration tool | quint-lib.mjs:68-77 compares sha256, model names, treatment/scope only. check-quint.mjs:32-34 runs checkCoverage(allModels) before every command regardless of --models. No file under scripts/ or test/ writes specs/quint/coverage.json; stateAnchors appears only in the ledger. Behaviour is intentional (coverageMeaning says 'source-drift ledger') and pinned by test/quint-coverage.test.mjs 'coverage admission detects changed...'. | Add a `quint:coverage -- --accept=<path,...>` mode that rewrites only the named entries' hashes and prints the allocated models for review, keeping the fail-closed default. |
| G9 | confirmed | low | Shared .eliza/client-features code is outside the ledger | quint-lib.mjs:8 sourceRoots omit .eliza; .gitignore lists `.eliza/`. apps/app/src/runtime/notes-trash-policy.ts:3 imports createNotesTrashPolicy from .eliza/client-features/plugins/plugin-notes/src/client/notes-trash-policy.ts (plan at 239). Drift is caught only coarsely: quint-lib.mjs:78-79 fails when upstream.lock.json commit differs from the ledger. ScanDocument `sharedSources` is unread by any script. | Hash the manifest `sharedSources` (and a new list for notes/maps policies) from .eliza/client-features in checkCoverage, after upstream:prepare-client, so model-relevant upstream files are allocated individually. |
| G10 | partly | low | Scenario registration is weak | quint-lib.mjs:52 is a text regex and the runner trusts exit status. But quint's default matcher is name.endsWith('Test') (dist/src/cliHelpers.js:127-133) and all 396 registered names end in Test, so they execute. The four ApplicationComposition runs (qnt:831,849,877,879) are setup prefixes, not tests, and are not run by default. The --max-samples=1 point is real: e.g. FilesTree.qnt:19-20 has nondet init, so its scenarios check one resolution. | Parse `quint test` output and assert every manifest test name is reported ok; raise --max-samples for models whose init or scenario actions contain `nondet`; reject manifest tests not ending in `Test`. |
| K1 | confirmed | low | Redundant typecheck phase | check-quint.mjs:116-119 spawns typecheck, test and run sequentially per model (58x3 = 174 Node starts); test and run also parse and typecheck. test-results/quint/check.json sums scenarios 106.5 s and simulation 138.9 s, consistent with the report's ~28% typecheck share. Cost only; the phase does give a clearer early failure and skips later phases. | Drop the typecheck phase from `check` (keep `quint:typecheck`), or run models with bounded concurrency. |
| K2 | confirmed | low | Canary only exercises quint run | check-quint.mjs:140-151 writes one canary module and invokes only `run ... --invariant=safety`. No canary for a failing `quint test` scenario or for verify. Mitigation: scenario failure relies on plain non-zero exit (line 104), and detectedCounterexample string forms are unit-tested in test/quint-coverage.test.mjs:9-16. | Add `run failingTest = init.expect(n == 1)` to the canary and require `quint test` to exit non-zero on it. |
| K3 | refuted | none | Unconditional verify flags and array mutation | check-quint.mjs:96 does append all three flags, but quint 0.33.1 `verify` declares apalache-version, server-endpoint, backend and tlc-config (dist/src/cli.js:347-365), so both backends accept them under .strict(). Each `options` array is a fresh literal at lines 122-136, so the push has no aliasing effect and makes the receipt's `argv` (line 108) record the real flags. |  |
| K4 | partly | none | Signal handling leaves status: running | check-quint.mjs:66 exits 130 without the finally block, leaving the line-50 receipt `status:'running', passed:false`. That is fail-closed and explicitly pinned by test/quint-coverage.test.mjs:59-64 (asserts status 'running', passed false after timeout). Handlers use process.once and are removed on child close (lines 87-88), so they do not accumulate across sequential children. | Optional: write `status:'interrupted'` synchronously in `interrupt` before process.exit(130) and update the test. |
| K5 | partly | none | Receipt stores full checker output | check-quint.mjs:108 stores `output` per result, but line 76 kills the child and fails the phase above 8 MB, and runs use --verbosity=1. In the current test-results/quint/check.json (159 results) the largest stored output is 743 characters. The 8 MB figure is a failure cap, not a typical size. |  |
| K6 | confirmed | low | sources validation only checks readability | quint-lib.mjs:53 is `readFileSync(join(repositoryRoot, source))` with the result discarded; manifests carry paths only and symbols live in README prose. checkCoverage 84-88 additionally requires the ledger to allocate the file to the model, and a rename changes the hash, but no symbol-level link is checked. | Allow `sources` entries of the form `path#symbol` and assert the symbol matches an export/declaration regex in the file. |
| K7 | confirmed | low | Ledger linkage is one-way | quint-lib.mjs:84-88 iterates model.sources and checks the ledger entry includes the model; nothing checks the reverse. Measured: coverage.json allocates 93 files to `Application` while its manifest lists 4 sources. This matches the ledger's stated meaning (allocation, treatment 'domain-contract-or-support'), so it is a looseness rather than a wrong result. | Require reverse linkage only for ledger entries whose treatment marks them as modelled state (non-empty stateAnchors), not for support allocations. |
| K8 | confirmed | low | Weak model-count floor in coverage test | test/quint-coverage.test.mjs:74 is `assert.ok(models.length >= 34)`; manifests currently hold 20+14+17+7 = 58. loadModels (quint-lib.mjs:57-59) enforces manifest/.qnt bijection, so only a coordinated deletion of a model, its manifest entry and its ledger references would pass unnoticed. | Assert the exact per-family counts (20/14/17/7) or a checked-in list of module names. |

## Verified model-vs-code discrepancies

| ID | Verdict | Severity | Finding | Evidence re-read by the verifier | Fix |
| --- | --- | --- | --- | --- | --- |
| S0 | confirmed | low | Manifests have no sourceEntryPoints/symbol field although README promises exact source entry points | specs/quint/README.md:16-17 says each manifest names "exact source entry points". application/manifest.json entries carry only `sources` (file paths); symbols exist only in the README tables (application/README.md:7-28). grep for sourceEntryPoints in scripts/, test/ and the spec READMEs returns nothing. I did not re-check all 66 symbols, only the five listed. | MANIFEST: add a per-model `symbols` list (file#symbol) and have quint-lib validate each by grep; or reword README.md:16-17 to say "source files". |
| S1 | refuted | none | editNotesTrash claimed to live in prototype/notes-trash-adapter.ts, outside NotesLifecycle sources | Definition is apps/app/src/runtime/notes-trash.ts:31 (`export async function editNotesTrash`). That file IS in NotesLifecycle `sources` (runtime/notes-trash.ts). prototype/notes-trash-adapter.ts:2 only imports and calls it. Reporter mistook a call site for the definition. |  |
| S2 | refuted | none | reviewMailAttachment claimed to live in browser/mail-attachments.ts, outside FilesAndSharing sources | Definition is apps/app/src/runtime/inbox-attachment.ts:14 (`export async function reviewMailAttachment`). FilesAndSharing `sources` includes apps/app/src/runtime/inbox-attachment.ts. browser/mail-attachments.ts:3 merely imports it. |  |
| S3 | confirmed | low | savedProgress is a private function; README calls it StartupPermissions.savedProgress | apps/app/src/startup-permissions.tsx:36 `function savedProgress(native = false)` is module-private, not a member. `advance` (156), `allow` (162), `finish` (175) are closures inside the exported component StartupPermissions (55), so the dotted notation is loose for all four. File is in PermissionWalkthrough sources. Documentation imprecision only. | MANIFEST/README: in application/README.md PermissionWalkthrough row write `startup-permissions.tsx: savedProgress (module-private), allow/advance/finish (component closures)`. |
| S4 | confirmed | low | mediaCopyIntent is not a real symbol | apps/app/src/runtime/media-copy-intent.ts exports mediaCopyIntentKey (3), type MediaCopyIntent (4), mediaCopyIntentDocument (12), readMediaCopyIntent (16), admitMediaCopyIntent (26), acknowledgeMediaCopyIntent (29). No `mediaCopyIntent` identifier. README FilesAndSharing row names the module loosely; the file is in the model's sources. | MANIFEST/README: replace `mediaCopyIntent` with `readMediaCopyIntent`, `admitMediaCopyIntent`, `acknowledgeMediaCopyIntent`. |
| S5 | partly | low | claimDeletion is ambiguous between two files | Both exist: runtime/permanent-voice-deletion.ts:97 `claimDeletion(id:string):void` and runtime/deletion-window.ts:17 `claimDeletion<T>(entry,owner,clock,action):boolean`. But PermanentVoiceDeletion sources list permanent-voice-deletion.ts and not deletion-window.ts (that one is in DeletionJournal sources), so the manifest disambiguates. Ambiguity is only in README prose. | MANIFEST/README: qualify as `permanent-voice-deletion.ts#claimDeletion`; optionally name `deletion-window.ts#claimDeletion` in the DeletionJournal row. |
| S6 | confirmed | medium | legacySource.path missing for 7 of 7 legacy models | legacy/manifest.json:103,265,422,614,754,860,979 point to docs/flow-redesign-2026-11/tla/{SignIn,GoogleConnect,Calendar,Maps}.tla and docs/ui-refresh-2026-11/tla/{ChatInput,HomeLayout,SettingsNav}.tla with sha256. Neither directory exists; `git ls-files docs` is only docs/prd.md. No script or test reads `legacySource`, so the hashes are unverifiable and unchecked. | MANIFEST: restore the seven .tla files (pin by commit) and validate path+sha256 in checkCoverage, or replace `path` with a commit-qualified reference and mark it historical/unavailable. |
| R1 | confirmed | medium | docs/ contains only prd.md | `ls docs` and `git ls-files docs` both return only docs/prd.md. Beyond the report: root README.md:27-50 also links about 20 missing docs/*.md files (on-device-agent-plan, verification, fused-speech, implementation-plan, etc.). | CODE (docs): restore the documents or remove/redirect the links; none of this is a model change. |
| R1a | confirmed | medium | AGENTS.md names three missing docs | AGENTS.md:3 names docs/architecture.md and docs/implementation-plan.md as required reading, :7 says docs/architecture.md defines ownership, :11 cites docs/fused-speech.md. None exist in docs/. | CODE (docs): restore the three files or edit AGENTS.md to point at existing sources (README.md, docs/prd.md). |
| R1b | confirmed | low | specs/quint/README.md:3 links missing docs/quint-migration-report.md | specs/quint/README.md:3: "The migration began with the [detailed report](../../docs/quint-migration-report.md)". File absent from docs/. | CODE (docs): restore the report or drop the sentence/link. |
| R1c | confirmed | low | README says historical TLC tables remain in design directories; they do not | specs/quint/README.md:116-117: "Historical TLC tables remain under their original design directories". docs/flow-redesign-2026-11 and docs/ui-refresh-2026-11 do not exist. | CODE (docs): restore the directories or change the sentence to state the tables were removed and cite the commit that held them. |
| R1d | confirmed | low | legacy/README.md:112-113 links two missing results.md files | specs/quint/legacy/README.md:111-113 links ../../../docs/flow-redesign-2026-11/tla/results.md and ../../../docs/ui-refresh-2026-11/tla/results.md; both parent directories are absent. | CODE (docs): restore results.md files or replace links with commit-pinned URLs. |
| R2 | confirmed | medium | verification.md cites ~15 receipts under gitignored test-results/ | verification.md has 17 distinct test-results/ references (16 files plus the test-results/quint-services/ directory). .gitignore:4 ignores test-results/; `git ls-files test-results` is empty. All 17 exist on this machine. Count is 17, not about 15. | MANIFEST: commit a small digest (receipt name, sha256, command, exit status) under specs/quint/, or upload receipts as CI artifacts and cite those. |
| R3 | confirmed | high | verification.md records npm run verify exit 1 / 63 minutes; browser.yml verify job has a 25-minute timeout | verification.md:113-115: verify "completed with exit 1", 1,953 tests, 32 failed, "in 63 minutes". .github/workflows/browser.yml:22-43: job `verify` has timeout-minutes: 25 and runs `npm run verify`. Caveat: 63 minutes was measured locally under load; CI duration was not measured by me. | CODE (CI): raise the verify job timeout or split quint:check and the Node suite into separate jobs; fix or quarantine the 32 failures before treating the record as a pass. |
| V-home | confirmed | medium | home: HomeLayout (legacy) + PreferencesAndPresentation (vacuous); partial, legacy only | PreferencesAndPresentation.qnt: nativeShade, webShade, draft, selection are only assigned in init (7-9); every action uses `...s`; webShade (25) is guarded by not(nativeShade), never enabled. So OneShade (28) and StatePreserved (31) are vacuous; LargeTextSinglePane (30) and ReadableCalendar (29) follow from the definitions at 12-14. Definitions do match surfaceLayout (canvas-geometry.ts:103-110). home-cards.ts/home-launcher.ts are sources but nothing home-specific is modeled. | MODEL: add actions that change draft/selection (edit, rotate loss) and nativeShade (web fallback), and state layout properties against independent inputs; add a current-design home model (cards, dock clearance). |
| V-assistant | confirmed | none | assistant: AssistantConversation, DraftDispatch, VoiceSession, ChatInput (legacy); substantial | Ledger allocates assistant-* files to AssistantConversation (4), DraftDispatch (3), VoiceSession (1), ApplicationComposition (1). AssistantConversation.qnt:14-16 guards send/reply on not(s.sensitive); DraftDispatch sources are assistant-draft-controller/record/store. ChatInput legacy sources model.js and chat-overlay-motion-adapter.ts. Application (setViewContext) also touches it; omission is harmless. |  |
| V-apps | confirmed | low | apps: no model; home-launcher allocated to PreferencesAndPresentation; navigation-only | coverage.json allocates prototype/home-launcher.ts to PreferencesAndPresentation, and it is in that model's sources, but PreferencesAndPresentation.qnt has no launcher state (only geometry, theme, shade). "apps" appears only as a member of ShellNavigation Views (line 6). No other model mentions launcher/app list. | MODEL: add a small launcher model (app list, launch intent, search/filter) or MANIFEST: record home-launcher.ts as support-only rather than as PreferencesAndPresentation coverage. |
| V-maps | confirmed | none | maps: MapsNavigation, NavigationProgress, Maps (legacy); substantial | Sources: MapsNavigation (device-navigation, agent-navigation, cloud-maps, navigation-fix, guidance, maps-adapter, AlphaNavigationService), NavigationProgress (maps-adapter, guidance, navigation-fix, route-distance, background-navigation), legacy Maps (cloud-provider, agent-navigation, maps-adapter). Ledger: maps-named files map to MapsNavigation 7, NavigationProgress 1, Maps 1. I did not read the three models line by line, so depth "substantial" is taken from size (94/236/165 lines) only. |  |
| V-camera | partly | low | camera: ScanDocument, MediaLifecycle; partial (scan and edit; no capture) | "No capture" is wrong. MediaLifecycle.qnt:52-56 has action `capture` (ownedCapture, temporaryBytes), publish clears them (43-51), and invariant IdleHasNoTemporaryCapture (89) covers cancelled capture. camera-adapter.ts, browser-camera.ts, camera-focus.ts, camera-frame.ts, scan-page-camera.ts are ledgered to MediaLifecycle. Capture is one atomic step: no shutter/focus/mode/recording state. ScanDocument sources are scan-*.ts. | MANIFEST (report): reword to "capture modeled as one atomic owned-temporary step". MODEL: optionally add recording start/stop and capture failure to MediaLifecycle. |
| V-photos | confirmed | none | photos: MediaLifecycle; partial | MediaLifecycle sources: photo-library.ts, photo-library-adapter.ts, video-edit-review.ts, PhotoLibraryAccess.java, PermittedMediaCatalog.java, VideoCopyEdits.java. Model has grant/select/read/review/publish/playback/invalidate and six invariants (84-90), one selected item. FilesAndSharing also lists media-copy-intent.ts (saved-copy intent) but its model was not checked for that state. |  |
| V-notes | confirmed | medium | notes: NotesLifecycle, PermanentVoiceDeletion, DeletionJournal; partial (one note, weak invariants) | NotesLifecycle.qnt is one note (line 1) with three invariants (30-32). Revision conflict (save guard line 9) and draft retention are asserted only in runs (34-35, 40-41), not in `safety`. TombstoneMeaning is a real but shallow inductive invariant (deleted set only with live:false at 18, cleared at 20-21), not vacuous. Ledger: 21 notes files to NotesLifecycle, 3 to DeletionJournal, 2 to PermanentVoiceDeletion. | MODEL: add invariants such as `content changes only via save with revision==expected` (needs a history variable) and `draft=="edited"` survives fault/concurrentSave until restart; add a second note for cross-note trash. |
| V-calendar | confirmed | none | calendar: CalendarPresentation, CalendarSync, Calendar (legacy); substantial | CalendarPresentation sources: calendar-adapter, calendar-month-focus, calendar-views, calendar-days, google-calendar-view-adapter, google-calendar-selection, calendar-form-draft. CalendarSync sources: outbox, writer, sync-controller, linked-store, CalendarSync*.java. Ledger: calendar files map to CalendarSync 41, CalendarPresentation 7, Calendar 3. Models (141/165/161 lines) not read line by line. |  |
| V-notifications | confirmed | none | notifications: NotificationCollection, NoticesAndCaches; substantial | NotificationCollection sources: notification-store.ts, notifications.ts, notifications-adapter.ts, AlphaNotificationListener.java, NotificationMirror*.java (186 lines). NoticesAndCaches sources: notice-owner-coordinator, workflow-notice-taps, hosted-result-notices, WorkflowNotice*.java. Ledger agrees (3 and 4 files). DevelopmentDevice.qnt:31-34 also models mock notification counts; omission is immaterial. |  |
| V-reminders | confirmed | low | reminders: DeviceActions (reminder actions), DeletionJournal; partial | DeviceActions.qnt:86-121 has scheduleReminder, stageReminder, reminderResult, reconcileReminder, completeReminder, reminderFires, snooze, stopReminder; invariants ReminderCurrent (141) and ReminderCreationDoesNotReplay (144). One reminder, no edit/list. Sources include reminder-creations.ts and reminder-deletions.ts; ledger maps 8 reminder files to DeviceActions, 2 to DeletionJournal. | MODEL: optional; add reminder edit and multi-reminder identity if list behavior matters. |
| V-workflows | confirmed | low | workflows: WorkflowExecution; partial (one submission, one effect) | WorkflowExecution.qnt (109 lines): single-phase state; invariants AtMostOneExecution `s.executions <= 1` (91), ReviewedEffect (93), DurableSubmission (92), ProductionTriggerGate (95). One workflow, one submission. Ledger maps 26 workflow files to it. NoticesAndCaches covers workflow notice taps separately. | MODEL: optional; add a second submission/run identity so AtMostOneExecution is per-submission rather than global. |
| V-files | confirmed | none | files: FilesTree, FilesAndSharing, PdfWorker; substantial | FilesTree (152 lines) sources files-tree-adapter.ts, files-index.ts, context-selection.ts, AlphaFilesPlugin.java. FilesAndSharing (36 lines) sources file-email-review.ts, inbox-attachment.ts, share-panel-adapter.ts. PdfWorker sources IsolatedPdfService.java. "Substantial" rests mainly on FilesTree; FilesAndSharing is thin. Models not read line by line. |  |
| V-inbox | partly | low | inbox: InboxDelivery, GoogleAccounts, GoogleConnect (legacy); substantial for send, reading/list none | "Reading and list are none" is overstated. InboxDelivery.qnt:17-19 has `cacheRead`, withdrawRead (72), and invariant CacheBound (92): visible cache implies read grant and matching owner/grant. That is a read-visibility fence, but there is no message list, thread, paging or read/unread state. Send path (prepare/review/confirm/providerReply, AtMostOneDispatch 90) is as described. | MANIFEST (report): reword to "read modeled only as owner/grant-bound cache visibility". MODEL: add list generation/paging and stale-reply fencing if required. |
| V-browser | confirmed | none | browser: BrowserSession, BrowserSiteState, BrowserReadingState, BrowserDownloads; substantial | BrowserSession sources browsing-session.ts, browser-surface.ts, browser-adapter.ts, BrowserSessionStore.java; BrowserSiteState sources BrowserPermissionRecords/Passkeys/HttpAuth*.java; BrowserReadingState sources BrowserReading*.java, reading-review.ts; BrowserDownloads sources BrowserDownloads.java. Sizes 41/121/88/133 lines. Not read line by line. |  |
| V-phone | confirmed | medium | phone: DevelopmentDevice (mock calls only); navigation-only for production | DevelopmentDevice.qnt:16-31: every call action (incomingCall, screenCall, answer, dial, hangup, decline, mute, speaker) is guarded by s.mocks; ProductionInert (50). DeviceActions.qnt has SMS, contacts and reminders but no call/dial state. Ledger maps phone-context.ts to ShellNavigation only. Additionally NoRealEffects (48) is vacuous: realEffects is assigned only in init. | MODEL: add a production call model (role/permission gate, dial review, in-call state) to DeviceActions or a new module; drop or wire realEffects. |
| V-messages | partly | low | messages: DeviceActions (SMS journal); partial (send only) | Send is as described: DeviceActions.qnt:24-83 review/dispatch/sentCallback/reportDelivery/retire with SingleSmsDispatch, SmsNeedsReviewAndJournal (133-139). Omitted: DevelopmentDevice.qnt:31-33 models mock incoming message/unread counts (incomingMessage, readMessage), and simulated-messages.ts is ledgered there. No production thread list or receive model, so "send only" holds for production. | MANIFEST (report): add DevelopmentDevice (mock incoming). MODEL: add production receive/thread read fence if needed (SmsRecords/SmsPageCursor are sources but paging is not modeled). |
| V-contacts | confirmed | low | contacts: DeviceActions ContactReadCurrent, one invariant; navigation-only plus one read fence | DeviceActions.qnt:44-52 beginContactsRead/contactsReply with epoch ticket; permissionLost and pause reset contacts to "none" (35-42); ContactReadCurrent (142-143) is the only contacts invariant; run staleContactsReplyAfterPauseTest (162). contacts-adapter.ts is ledgered to DeviceActions. No contact list, search or edit state. | MODEL: optional; nothing inconsistent with code found. |
| V-passwords | partly | low | passwords: CredentialVault, NativeCredentialMutation; substantial | CredentialVault (64 lines) sources password-manager.ts, dev-vault.ts, password-provider.ts, PasswordProviderSupport.java: correct for the passwords view. NativeCredentialMutation sources are AlphaCredentialStore.java, AlphaLocalAgentPlugin.java, LocalAgentProviderAdmission.java, ResidentCredentialShutdownRetry.java: agent/provider credentials, not the password-manager surface. BrowserSiteState (BrowserHttpAuthAutofill, BrowserPasskeys) is the closer second model. | MANIFEST (report): replace NativeCredentialMutation with BrowserSiteState (autofill/passkeys) for this view; depth then rests on one 64-line model. |
| V-settings | confirmed | low | settings: SettingsNav (legacy), ResetRecovery, PermissionWalkthrough; partial, navigation legacy only | SettingsNav is in legacy/manifest.json with sources model.js and settings-adapter.ts (379 lines, historical comparison). ResetRecovery sources are AlphaDataReset/ResetAuthorization/ResetRecoveryActivity.java. PermissionWalkthrough sources startup-permissions.tsx. settings-adapter.ts is also ledgered to PreferencesAndPresentation, whose only settings behavior is saveTheme/restart (22-24). No runtime model of settings navigation. | MODEL: promote SettingsNav's proposed design to a runtime-family model once it matches current code, or add settings subview/Back to ShellNavigation. |
| V-shell | confirmed | medium | ShellNavigation treats the 19 views as interchangeable; no per-view Back stack, subview or sensitive-view rule | ShellNavigation.qnt:6-8 Views equals AlphaView (alpha-client.ts:5-24, 19 values). open (11) tests only membership; back (23) distinguishes only "home". `drawer` is set false in init/open and never true, so line 20 is dead, while code has a real drawer (prototype/model.js:5147 `drawer`, `stack: []`). `revision < 2` (11, 23) caps navigation at two. DraftBound (39) is trivial: draft is only "" or "draft". | MODEL: add openDrawer, a per-view subview stack mirroring model.js `stack`, and a sensitive-view flag that cancels claims; raise the revision bound; replace DraftBound with `draft survives open/back/hide`. |

## First-pass report (gate inventory, LemmaScript research and adoption plan)

# Formal-verification audit: Quint gate and LemmaScript adoption

No repo files were changed and no `quint:*`, build or test suite was run. I only ran the read-only `loadModels` + `checkCoverage` (0 errors, 408 ms).

## Part 1: Quint infrastructure

**Inventory.** 58 models (application 20, services 14, native 17, legacy 7), 396 registered scenarios, 858 ledger files. `npm run verify` runs `quint:check` (package.json:18,61), and `.github/workflows/browser.yml:43` runs `npm run verify` on JDK 21. The last local `check` receipt took about 6 minutes: typecheck 96 s, scenarios 106 s, simulation 139 s.

### Gate gaps

1. **Model checking is never gated.** `verify`, `temporal` and `compare` are outside `check` (check-quint.mjs:116-120), outside `npm run verify`, and no workflow under `.github/` mentions quint. Apalache/TLC evidence exists only as gitignored receipts in `test-results/` (.gitignore:4). This leaves unenforced:
   - all 37 legacy `currentChecks`, including ChatInput's four required counterexamples;
   - all 12 `currentTemporalChecks`;
   - ScanDocument's `expectedViolations` (`ExplicitlySavedDraftPreserved`).
2. **Temporal properties exist only on legacy models.** Manifest `temporal` is set for SignIn, GoogleConnect, Calendar and Maps only (`CheckedTemporal`). The 51 runtime models contain no `temporal`, fairness or `eventually` definitions, so no liveness is stated (e.g. "held draft is eventually released", "reset eventually completes").
3. **No witnesses anywhere.** No `--witnesses` flag and no reachability predicates. Simulation is 80 samples × 40 steps with a stutter branch in every `step`, and nothing shows that guarded states are reached. A vacuous invariant passes silently.
4. **Several manifest fields are dead data.** `bounds`, `additionalProofInit`, `invariants`, `stateMapping`, `components` and `temporalProperties` are never read by `scripts/`.
   - `bounds` (1000 samples / 60 steps / seed 123 on services) is ignored; the gate uses 80/40 (check-quint.mjs:19-20).
   - `additionalProofInit` (`RendererRecovery:budgetInit`, `VadSegmentation:counterInit`) is run by nothing in `scripts/` or `test/`. verification.md:91-93 relies on those checks to reach the loss budget and the 16-low-window boundary.
   - `invariants` is not validated. ListenerLeaseRecovery lists six names that are not conjuncts of `safety`: `updated`, `needsAttribution`, `answer`, `kept`, `appended`, `bounded`.
   - 19 of 20 application models have no `invariants` list at all.
5. **Symbolic bound is shallower than the scenarios.** `verify` defaults to 6 steps (check-quint.mjs:20); the recorded evidence used 4 (verification.md:61,96). `NotesLifecycle.expiryTest` alone needs 6 transitions, and VAD needs 16 or more.
6. **Vacuous or trivially true invariants** (found by reading three small application models; the other 55 were not read line by line):
   - `PreferencesAndPresentation.qnt:28-32`: all four conjuncts are tautologies.
     - `OneShade`: `nativeShade` is initialised true and never assigned, so `webShade` (line 25) is never enabled.
     - `StatePreserved`: `draft` and `selection` are never assigned.
     - `LargeTextSinglePane`: `split` is defined with `textScale < 150`.
     - `ReadableCalendar`: restates the clamp on line 14.
   - `ShellNavigation.qnt:39`: `DraftBound` is trivially true. `drawer` is never set true, so the branch at line 20 is dead. `s.revision < 2` (lines 11, 23) permits only two navigations in total.
   - `NotesLifecycle.qnt:31`: `TombstoneMeaning` holds by construction. The revision-conflict and draft-retention behaviours are asserted only in scenarios, not as invariants.
   - Application models are 34-80 lines for most domains (FilesAndSharing 36, DevelopmentSurfaces 34).
7. **Conformance adapters cover 11 of 58 models.**
   - Application (final state of one scenario each, `test/quint-conformance.test.mjs:45-125`): CallbackLanding, StartupPermissions, BrowserSession, PreferencesAndPresentation, AssistantConversation, PermanentVoiceDeletion (240-row table), DraftDispatch.
   - Native: AlwaysOnListener, RendererRecovery, VadSegmentation. `conformance.mjs:12` loads only `AlwaysOnListener.qnt`; the ResetAuthorization, SpeechAudioFocusPolicy and navigation checks in that file are hand-written assertions, not trace replay.
   - Services: ScanDocument.
   - No adapter: 13 application models (including ShellNavigation, NotesLifecycle, CredentialVault, FilesTree, CalendarPresentation, NotificationCollection), 13 services models, 14 native models, and all legacy models.
8. **The source ledger is a hash-bump gate.** `checkCoverage` only compares sha256 and model names (quint-lib.mjs:68-74). No tracked script regenerates `coverage.json` or its `stateAnchors` (`git grep stateAnchors` hits only the ledger). Any edit to one of 858 files fails every quint command, including `typecheck --models=X` (check-quint.mjs:33-34). The fix is hand-editing a 1.3 MB JSON hash, which enforces nothing semantic.
9. **Shared code is outside the ledger.** `sourceRoots` (quint-lib.mjs:8) excludes the gitignored `.eliza/client-features`. The real `planNotesTrash` logic (`plugin-notes/src/client/notes-trash-policy.ts:239`) and all of `route-distance.ts` live there, covered only by the upstream commit pin.
10. **Scenario registration is weak.** The check is a regex over file text (quint-lib.mjs:52). The runner never confirms that the listed tests actually executed. `--max-samples=1` (check-quint.mjs:117) gives a nondeterministic scenario one sample. `ApplicationComposition` has four unregistered `run` helpers (`replacementSetup`, `resetSetup`, `signedInSetup`, `readySetup`). Unverified: whether `quint test` 0.33.1 also executes those by default.

### Source-symbol spot-check

The manifests have no `sourceEntryPoints` field, although README.md:16-17 says they name "exact source entry points". They have `sources` (paths, existence-checked) and symbols live in family README prose, which nothing checks. I checked 66 README symbols:

- **All resolve somewhere**, but several are not in the model's own `sources` list:
  - `editNotesTrash` is in `prototype/notes-trash-adapter.ts`, not in NotesLifecycle sources.
  - `reviewMailAttachment` is in `browser/mail-attachments.ts`, not in FilesAndSharing sources.
  - `savedProgress` is a private function in `startup-permissions.tsx:36`; the README calls it `StartupPermissions.savedProgress`.
  - `mediaCopyIntent` is not a symbol; the real ones are `readMediaCopyIntent`, `admitMediaCopyIntent` and `acknowledgeMediaCopyIntent`.
  - `claimDeletion` is ambiguous: it exists in both `permanent-voice-deletion.ts:97` and `deletion-window.ts:17`.
- **Legacy `legacySource.path` is missing for 7 of 7 models** (`docs/flow-redesign-2026-11/tla/*.tla`, `docs/ui-refresh-2026-11/tla/*.tla`).

### Broken references

- `docs/` contains only `prd.md`.
  - AGENTS.md names `docs/architecture.md`, `docs/implementation-plan.md` and `docs/fused-speech.md`; none exist.
  - specs/quint/README.md:3 links `docs/quint-migration-report.md`, which does not exist.
  - specs/quint/README.md:116-117 says historical TLC tables remain in their design directories; they do not.
  - specs/quint/legacy/README.md:112-113 links two missing `results.md` files.
- verification.md cites about 15 receipts under gitignored `test-results/`. They exist on this machine only.
- verification.md:113-115 records `npm run verify` exiting 1 (32 failures, 63 minutes). `browser.yml` gives the job `timeout-minutes: 25`.

### AlphaView coverage

| View | Models | Depth |
| --- | --- | --- |
| home | HomeLayout (legacy), PreferencesAndPresentation (vacuous) | partial, legacy only |
| assistant | AssistantConversation, DraftDispatch, VoiceSession, ChatInput (legacy) | substantial |
| apps | none (home-launcher is allocated to PreferencesAndPresentation) | navigation-only |
| maps | MapsNavigation, NavigationProgress, Maps (legacy) | substantial |
| camera | ScanDocument, MediaLifecycle | partial (scan and edit; no capture) |
| photos | MediaLifecycle | partial |
| notes | NotesLifecycle, PermanentVoiceDeletion, DeletionJournal | partial (one note, weak invariants) |
| calendar | CalendarPresentation, CalendarSync, Calendar (legacy) | substantial |
| notifications | NotificationCollection, NoticesAndCaches | substantial |
| reminders | DeviceActions (reminder actions), DeletionJournal | partial |
| workflows | WorkflowExecution | partial (one submission, one effect) |
| files | FilesTree, FilesAndSharing, PdfWorker | substantial |
| inbox | InboxDelivery, GoogleAccounts, GoogleConnect (legacy) | substantial for send; reading and list are none |
| browser | BrowserSession, BrowserSiteState, BrowserReadingState, BrowserDownloads | substantial |
| phone | DevelopmentDevice (mock calls only) | navigation-only for the production surface |
| messages | DeviceActions (SMS journal) | partial (send only) |
| contacts | DeviceActions (`ContactReadCurrent`, one invariant) | navigation-only plus one read fence |
| passwords | CredentialVault, NativeCredentialMutation | substantial |
| settings | SettingsNav (legacy), ResetRecovery, PermissionWalkthrough | partial, navigation is legacy only |

In `ShellNavigation` the 19 views are interchangeable: `open(view)` only tests membership (line 11). There is no per-view Back stack, subview or sensitive-view rule.

### Checker script problems

- **Redundant typecheck phase** (check-quint.mjs:116): `test` and `run` already parse and typecheck. That is 58 of 174 Node cold starts, about 28% of gate time. Everything is sequential.
- **Canary is too narrow** (lines 140-151): it exercises only `quint run`. Nothing shows that a failing `quint test` scenario or a verify violation is detected.
- **Unconditional verify flags** (line 96): every `verify` gets `--tlc-config` and `--apalache-version`, including Apalache runs. It also mutates the caller's array.
- **Signal handling** (line 66): SIGINT/SIGTERM exits 130 without a final receipt, leaving `status: running`. Handlers are re-registered per child.
- **Receipt size**: complete checker output is stored per phase, up to 8 MB each.
- **`sources` validation** (quint-lib.mjs:53): only checks the file is readable. A symbol can be renamed with no failure beyond the hash bump.
- **Ledger linkage is one-way** (quint-lib.mjs:84-88): model to ledger only. A ledger entry naming a model whose `sources` omits that file is accepted. Example: the `Application` model has 93 ledger files but 4 sources.
- **Weak floor in the coverage test** (`test/quint-coverage.test.mjs:74`): asserts `models.length >= 34` when there are 58.

## Part 2: LemmaScript

**Local state.**
- `git grep -il lemmascript` returns no hits; package.json has no such dependency.
- No sibling checkout under `*` (top two levels) mentions it.
- `dafny`, `lean`, `lake`, `elan` and `z3` are not installed.
- `/usr/bin/dotnet` exists but reports "No .NET SDKs were found"; the runtime version is unverified.
- Java is present.

**Upstream facts** (researched by a subagent on 2026-11-09; I did not re-fetch the pages myself):

- **Project:** github.com/midspiral/LemmaScript, MIT, a "Tech Preview" led by Nada Amin, 158 stars.
- **npm:** package `lemmascript` 0.6.6 (2026-11-04), bin `lsc`, Node >= 18. `@midspiral/lemmascript` does not exist, and npm `lsc` is an unrelated package, so never run bare `npx lsc`.
- **Backends:** Dafny is the default and recommended ("When in doubt, target Dafny"); upstream CI pins Dafny 4.11.0 with .NET 8. Lean 4.34 with Mathlib and Velvet 2 is the alternative.
- **Dafny files:** `foo.dfy.gen` is generated; `foo.dfy` is seeded from it and hand-edited with proofs. "The diff between them must be additions-only."
- **CLI:** `lsc gen|gen-check|check|regen|extract|info|config|claimcheck|runs|version`. Flags are `--backend=dafny|lean`, `--config=`, `--time-limit=`, `--extra-flags=`, `--slow`. `lsc check` with no file reads `LemmaScript-files.txt` (`filepath [timeout] [flags]` per line). Config is `lemmascript.json` (`proof-dir`, `extern-default`, `unread-annotations`, and others).
- **CI:** reusable workflow `midspiral/LemmaScript/.github/workflows/verify.yml@main` with `backend: dafny`.
- **Annotation syntax** (SPEC.md §2), placed before the first statement of a function or loop body:
  - Contracts: `//@ verify`, `//@ requires P`, `//@ ensures P` with `\result`.
  - Loops: `//@ invariant P`, `//@ decreases D`, `//@ done_with P`.
  - Types and ghosts: `//@ type i nat`, `//@ ghost let x = ...`, `//@ assert P`, `//@ assume P`.
  - Out-of-model code: `//@ extern`, `//@ impure`, `//@ havoc`, `//@ skip`, `//@ pure`.
  - Quantifiers and operators: `forall(k, P)`, `exists(k: nat, P)`, `==>`, `<==>`, `===`.
  - No `old()` and no lemma annotation; lemmas are written by hand in the `.dfy`.

  Verbatim upstream example (SUBSET.md):
  ```ts
  export function clamp(x: number, lo: number, hi: number): number {
    //@ verify
    //@ requires lo <= hi
    //@ ensures lo <= \result && \result <= hi
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }
  ```
  A loop looks like: `//@ invariant 0 <= i && i <= arr.length`, then `//@ decreases arr.length - i`.
- **Supported subset:**
  - `number` is a mathematical int (non-integer literals are exact reals).
  - Strings, arrays, Map/Set/Record, optionals, discriminated and string-literal unions.
  - `if`, `while`, `for`, `for…of`, `switch`.
  - `.map`, `.filter`, `.some`, `.every`, `.find`.
  - `Math.abs`, `min`, `max`, `floor`, `ceil`.
  - `throw` becomes `assert false`.
- **Not supported:** `await`, IEEE-754 semantics, `**`, `>>>`, `Math.round`/`sqrt`/trig, regex, `JSON.*`, try/catch (undocumented). `Date` is presumably out. Classes are Dafny-only.
- **Trust boundary:** proofs cover the integer/real model, not JS doubles. `extern`, `assume` and type overrides are trusted.

**Unverified:** GitHub release tags; whether `lsc gen-check` needs Dafny installed; whether `Number.isFinite` and template literals are in the subset.

### Adoption plan

- **Dependency:** `devDependencies: "lemmascript": "0.6.6"` (exact pin).
- **Layout:**
  - `lemmascript.json` at the root, with `proof-dir: "specs/lemma/proofs"` and `unread-annotations: error`.
  - `specs/lemma/LemmaScript-files.txt`, `specs/lemma/proofs/*.dfy` and `*.dfy.gen`, `specs/lemma/README.md`.
  - Annotations stay as comments in `apps/app/src`; there is no runtime effect.
- **Scripts:**
  - `lemma:gen-check`: `lsc gen-check --backend=dafny`.
  - `lemma:check`: `node scripts/check-lemma.mjs`.
  - `lemma:regen`.
- **`check-lemma.mjs` behaviour:**
  - Always run gen-check, so stale `.dfy.gen` fails.
  - Run `lsc check` only if `dafny --version` reports 4.11.0.
  - Otherwise write a `test-results/lemma/check.json` receipt with `status: "skipped-no-backend"`, print a loud warning and exit 0. With `LEMMA_REQUIRE_BACKEND=1` (set in `browser.yml`), exit 2 instead.
  - Never report a skip as a pass.
- **Wiring:** add `npm run lemma:check` to `verify` after `quint:check`. CI needs a Dafny 4.11.0 + .NET 8 setup step (the upstream `setup-dafny` action or the reusable workflow).
- **Interaction with Quint:** every annotated file changes its sha256 and trips the Quint ledger. Annotate in one batch and refresh `coverage.json` once. Add `specs/lemma` inputs to `inputPaths`.
- **`.eliza` targets:** `planNotesTrash`, `expired`, `daysLeft`, `distanceToRoute` and `routeProgress` live in gitignored `.eliza/client-features`. They must be annotated upstream or contracted with `//@ extern`, not edited locally.

### First targets

All paths are under `apps/app/src`.

1. `runtime/permanent-voice-deletion.ts:44` `planInterruptedPermanentDeletion` — ideal fit.
   - ensures: `note==='changed' || receipt===null || !recording.ownedByNote ==> \result==='review'`.
   - ensures: `\result==='erase' ==> note==='deleted' && !referencedElsewhere && inAudioTrash`.
   - ensures: `\result==='delete-note' ==> receipt==='purged' && note!=='deleted'`.
   - ensures: totality.
2. `permanent-voice-deletion.ts:84` `deletionLeaseDue` — requires finite; ensures `until-now >= LEASE/2 ==> !\result`.
3. `permanent-voice-deletion.ts:76` `leasedDeletionRow` — ensures `\result.lease.until === now + 1200000`.
4. `runtime/deletion-window.ts:8` `deletionDeadline` — ensures `expiresElapsed === createdElapsed + 10000`.
5. `deletion-window.ts:12` `deletionWindow` — with `clockValid` extern or precondition.
   - ensures: `\result==='open' ==> clock.elapsed < deadline.expiresElapsed && same continuity`.
   - ensures: never `'open'` when elapsed went backwards.
6. `deletion-window.ts:17` `claimDeletion` — refactor to return the next phase.
   - ensures: `dispatch ==> window==='expired' && phase==='queued' && owner matches`.
   - ensures: undo and dispatch cannot both succeed for one (entry, clock).
7. `runtime/canvas-geometry.ts:103` `surfaceLayout`.
   - ensures: `1 <= calendarDays <= 7`.
   - ensures: `agenda ==> !split && calendarDays===1`.
   - ensures: `desktop ==> !split`.
   - This also replaces the vacuous Quint invariants.
8. `canvas-geometry.ts:51` `keyboardFreeHeight` — extract a pure `nextBase(base,width,height,editing)`.
   - ensures: same width while editing never shrinks height.
   - ensures: `\result.width === width`.
9. `canvas-geometry.ts:64` `canvasGeometry` — numeric core only (the string `width` is havoc).
   - requires: `width>0 && available>0 && screenShort>0`.
   - ensures: `scale>0`, `desktop ==> scale<=1`, `landscape ==> scale>=0.1` (non-fluid), `top>=banner`.
10. `maps/navigation-fix.ts:5` `usableNavigationFix` — ensures `\result ==> now - fix.timestamp <= maxFixAgeMs && fix.timestamp <= now+5000 && 0 <= accuracy <= max`.
11. `maps/guidance.ts:36` `atStep`.
    - ensures: `next.distanceMeters >= 0`.
    - ensures: `index >= steps.length ==> next undefined`.
    - ensures: `then` is defined iff `index+1 < steps.length`.
12. `runtime/subscription-entitlement.ts:352` `nextRefreshDelay` — replace `2 ** n` with a loop.
    - ensures: `failures>0 ==> MIN <= \result <= MAX`.
    - ensures: never 0.
13. `subscription-entitlement.ts:549` `retryDuration` — numeric core; ensures `secs >= 1` and monotone units.
14. `runtime/managed-service-routes.ts:9` `googleCalendarEvents` — regex extern.
    - ensures: `\result===true && method==='DELETE' ==> query!=='' && !hasBody`.
    - ensures: POST only on the exact path.
15. `runtime/notes-secure-store.ts:81` `mergeNotesDrafts` — `JSON.stringify` extern.
    - ensures: every id in `next.records` or `next.removed` takes `next`'s value.
    - ensures: no kept id is dropped unless touched.
16. `notes-secure-store.ts:70` `applyNotesDraft`.
    - ensures: a note absent from `list` appears only if it is in `added`.
    - ensures: a changed note is never replaced or removed.
17. `notes-secure-store.ts:57` `notesDraftConflicts` — ensures the result is a subset of `list` ids.
18. `runtime/notes-trash-policy.ts:36-38` `expired`/`daysLeft` (upstream).
    - ensures: `expired <==> now >= deletedAt + 259200000`.
    - ensures: `0 <= daysLeft <= 3`.
    - ensures: `daysLeft===0 <==> expired`.
    - `plan`: ensures `stale`, `expired`, `kept` partition the entries.

**Poor fits, do not start here:**
- `distanceToRoute`/`routeProgress`: trigonometry and floats.
- `guidanceDistance`/`guidanceDuration`: `Math.round`, `toFixed`.
- `smsSubscriptionRevision`: `Math.imul`, `>>>`.
- `planCloudSpeechChunks`, `savedBrowserUrl`: regex and `URL`.
- `replaceAssistantDraft`: `TextEncoder`, `JSON`.
- `AssistantDraftController`: async class.

**URLs**
- https://github.com/midspiral/LemmaScript (README.md, SPEC.md, SUBSET.md, DESIGN_NUMBERS.md, LICENSE, examples/, .github/)
- https://api.github.com/repos/midspiral/LemmaScript
- https://registry.npmjs.org/lemmascript
- https://lemmascript.org
- https://midspiral.com/blog/lemmascript-a-verification-toolchain-for-typescript/ (reachable, not read)

