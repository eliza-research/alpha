# Formal model audit: Quint and LemmaScript vs. every view and the launcher

Audit date 2026-11-09, branch `shaw-cleanups` at `b2bfdf8762`. This issue is the research report and the tracking list for the implementation wave. The full per-slice evidence is in the comments below and in `docs/formal-model-audit-2026-11/`.

## Summary

- **There are no LemmaScript models.** The tracked tree outside `vendor/` has no LemmaScript file, annotation or dependency. The formal layer is Quint only: 58 models (7,372 lines), 396 scenarios. Function-level verification is entirely missing and is treated here as work to add.
- **The Quint gate is narrower than it reads.** `npm run verify` typechecks, runs scenarios and samples 80 traces of 40 steps per model. Model checking, temporal properties and the current-design comparisons are never run by `verify` or CI. Only 11 of 58 models have a conformance adapter. Several manifest fields that describe bounds and extra proof inits are read by nothing.
- **Some invariants cannot fail.** `PreferencesAndPresentation` has four tautological invariants, `ShellNavigation.DraftBound` is trivially true, and `ResidentScheduling.NoOccurrenceReplay` guards a variable no action writes.
- **Four views have no production-behaviour model**: apps, phone, messages (beyond the SMS journal) and contacts (beyond one read fence). Settings and home navigation are covered only by historical "legacy" comparisons. In `ShellNavigation` the 19 views are interchangeable enum values.
- **About 100 state machines in the code have no model.** The comments list each with its states, events and the invariant at risk.
- **105 claimed defects were adversarially re-derived from the code**: 61 confirmed, 40 partly confirmed (real, but narrower than first claimed), 3 refuted, 1 needs a device. A second pass over files the first pass did not read in full added about 60 more findings; those are single-pass and are re-verified before any fix.
- **172 model-vs-code discrepancies were checked**: 122 confirmed, 47 partly (often a legitimate abstraction), 3 refuted.

## Method

1. Eight read-only auditors, one per slice (shell/launcher, assistant/voice, notes/files/media, calendar/inbox/workflows, browser/passwords/maps, identity/comms/dev, Android native, Quint gate + LemmaScript), each read the models and the code and reported discrepancies, unmodeled state machines, defects and modeling opportunities.
2. Sixteen skeptics, two per slice, were told to refute every defect and every discrepancy by re-reading the cited code and models.
3. Six gap auditors covered what the first pass read only in part: `connection-ui.tsx`, camera/video, Inbox, Workflows/Notifications, the remaining native Java, and all of `prototype/model.js`.

Nothing was executed during the audit. Every finding is from reading. Device and platform behaviour (for example whether Android crashes on a missed `startForeground`) is marked where it matters.

## Highest-impact verified defects

| # | Where | Defect |
| --- | --- | --- |
| 1 | `prototype/agent-adapter.ts:1177` | Sends that pass explicit text (Maps choices, Calendar approval, reviewed mail) are silently dropped; the UI shows them as done. |
| 2 | `maps/cloud-maps.ts:53`, `cloud-provider.ts:107` | Regaining connectivity uninstalls the Maps provider and ends active navigation. |
| 3 | `AlphaVoiceCloudPlugin.java:414-461` | Live capture always fails on the first microphone grant: the permission dialog's pause cancels the admission. |
| 4 | `prototype/scan-document.ts:40,49` | A loaded or explicitly saved scan draft is deleted after export (wider than the recorded known defect). |
| 5 | `prototype/agent-adapter.ts:120` + `MainActivity.java:328` | Back with the All-apps drawer open finishes the standalone activity. |
| 6 | `startup-permissions.tsx:110-130` | Overlapping resume refreshes regress walkthrough progress; "Finish setup" reopens a modal with no exit. |
| 7 | `AlphaCloudSignInPlugin.java:446-555` | A failed resend destroys the working sign-in attempt; a transport blip during verify kills it while the UI keeps the code step; cooldown is stamped before the send succeeds. |
| 8 | `prototype/sms-adapter.ts:19` | An SMS send cannot be retried after `denied`/`cancelled` without editing the draft. |
| 9 | `runtime/voice-assistant.ts:594-684` | During streamed playback the echo gate has no reference, so the reply's own audio can confirm a barge-in; the mic can open during the owner-review pause; a resumed reply loses leading sentences. |
| 10 | `maps/cloud-maps.ts:25-40` | Maps can stay in error after a transient failure while hidden. |
| 11 | `prototype/browser-adapter.ts:172` | Address-bar queries whose first token ends in a colon (`site:example.com cats`) are rejected instead of searched. |
| 12 | `runtime/google-calendar-outbox.ts:150-180` | An own-holder `dispatching` op is never recovered in-process and blocks its event. |
| 13 | `prototype/camera-adapter.ts:702` | Agent capture fails while the preview is starting. |
| 14 | `prototype/scan-document.ts:46` | Searchable export locks the document on definite non-writes. |

Performance findings that are confirmed: a 10 Hz browser poll that also retries failed saves with no backoff, a 500 ms deletion-undo poll, a 250 ms share-panel `JSON.stringify`, per-token whole-history work on the streaming path, uncached `parseStyle`, a 1 Hz clock poll, per-keystroke draft serialisation with attachments, and whole-journal rewrites per SMS callback.

## View coverage

| View | Models | Depth |
| --- | --- | --- |
| home | HomeLayout (legacy), PreferencesAndPresentation (vacuous) | partial, legacy only |
| assistant | AssistantConversation, DraftDispatch, VoiceSession, ChatInput (legacy) | substantial; `DraftDispatch` models methods with no production caller |
| apps | none | navigation only |
| maps | MapsNavigation, NavigationProgress, Maps (legacy) | substantial; connection retry and guidance session unmodeled |
| camera | ScanDocument, MediaLifecycle | partial |
| photos | MediaLifecycle | partial |
| notes | NotesLifecycle, PermanentVoiceDeletion, DeletionJournal | partial (one note, weak invariants) |
| calendar | CalendarPresentation, CalendarSync, Calendar (legacy) | substantial |
| notifications | NotificationCollection, NoticesAndCaches | substantial |
| reminders | DeviceActions, DeletionJournal | partial; intents unmodeled |
| workflows | WorkflowExecution | partial (one submission) |
| files | FilesTree, FilesAndSharing, PdfWorker | substantial |
| inbox | InboxDelivery, GoogleAccounts | substantial for send; drafts and list paging unmodeled |
| browser | BrowserSession, BrowserSiteState, BrowserReadingState, BrowserDownloads | substantial |
| phone | DevelopmentDevice (mock only) | none for production |
| messages | DeviceActions (SMS journal) | partial (send only) |
| contacts | DeviceActions (one read fence) | navigation plus one fence |
| passwords | CredentialVault, NativeCredentialMutation | substantial |
| settings | SettingsNav (legacy), ResetRecovery, PermissionWalkthrough | partial |

## Gate and documentation gaps

- Model checking (`quint:verify`, `quint:temporal`, `quint:compare`) is in no gate; ScanDocument's expected violation and ChatInput's four required counterexamples are unenforced.
- Temporal properties exist only on four legacy models. No runtime model states liveness.
- No reachability witnesses, so a vacuous invariant passes silently.
- Manifest fields `bounds`, `additionalProofInit`, `invariants`, `stateMapping`, `components` and `temporalProperties` are read by no script.
- The source ledger (`coverage.json`, 1.3 MB) only compares hashes and has no regeneration tool; any source edit fails every Quint command until the JSON is hand-edited.
- Shared code under `.eliza/client-features` is outside the ledger.
- `AGENTS.md` names `docs/architecture.md`, `docs/implementation-plan.md` and `docs/fused-speech.md`; `specs/quint/README.md` links `docs/quint-migration-report.md`; the legacy manifest points at `docs/*/tla/*.tla`. None exist: `docs/` contains only `prd.md`.
- `verification.md` cites about 15 receipts under gitignored `test-results/`.

## LemmaScript

LemmaScript (`lemmascript` 0.6.6 on npm, MIT, bin `lsc`, github.com/midspiral/LemmaScript) verifies annotated TypeScript through Dafny (default) or Lean. Specs are `//@ requires`, `//@ ensures`, `//@ invariant`, `//@ decreases` comments inside the function body. It models `number` as a mathematical integer or real and does not support `await`, regex, `JSON.*`, `Date`, or `Math.round`.

Neither Dafny nor a .NET SDK is installed on the development machine, so the adoption has to pin and fetch the backend, and the check must record a skip as a skip, never as a pass.

First targets (all pure, integer or enum logic): `planInterruptedPermanentDeletion`, `deletionLeaseDue`, `leasedDeletionRow`, `deletionDeadline`, `deletionWindow`, `claimDeletion`, `surfaceLayout`, `keyboardFreeHeight`, `canvasGeometry`, `usableNavigationFix`, `atStep`, `nextRefreshDelay`, `retryDuration`, `googleCalendarEvents`, `mergeNotesDrafts`, `applyNotesDraft`, `notesDraftConflicts`, `chatRelease`, `restingHeight`, and the launcher `cleanKeys`/`moveFavorite`. Poor fits (floats, trigonometry, regex, `URL`) stay with property tests.

## Implementation wave

- [ ] **W0 Tooling.** Ledger regeneration tool; gate reads `bounds` and `additionalProofInit`; canary covers `quint test`; model-count floor; fix or remove broken doc references.
- [ ] **W1 Defect fixes.** Every confirmed and partly-confirmed defect in the comments, each with a regression test, plus the gap-pass findings after re-verification.
- [ ] **W2 Model corrections.** Every confirmed discrepancy: change the model, the code or the manifest as the verdict says; replace vacuous invariants with ones that can fail.
- [ ] **W3 New models.** Per-view and launcher models for the unmodeled state machines (BackDispatch, LauncherInventory, ChatDock, ComposerSend, SegmentAccounting, RecorderStage, MapsConnection, GuidanceSession, SmsSend, ContactsSession, ViewAdmission, SignInChooser, ReminderIntents, ClockHandoff, DeviceLibrary, NotesDraftSlot, CameraPreview, VideoRecorder, InboxDrafts, AutomationIntent, TriggerCursor, HomeInstanceHandoff, ListenerServiceLifecycle, and the rest listed per slice).
- [ ] **W4 LemmaScript.** Pinned dependency, `specs/lemma/`, `lemma:check` in `verify`, annotated first targets with Dafny proofs.
- [ ] **W5 Conformance.** ITF trace adapters for the pure Java policies and TypeScript entry points listed per slice.
- [ ] **W6 Gates.** `bun run verify`, model checking for changed models, and `bun run android:build:local` plus `bun run android:verify` for the one launcher product (debug, release and instrumentation evidence remain distinct). An APK build, emulator HOME-role test, AOSP boot, real integrations and device acceptance are separate claims and are reported separately.

Limits known before starting: `vendor/eliza` and `.eliza/client-features` are not edited in place, so findings in shared code become upstream patches or `patches/eliza` entries; the Android build currently exits before Gradle because the staged native engine needs requalification.
