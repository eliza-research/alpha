# Service and data state models

These modules model product-owned service boundaries in the current working
tree. `manifest.json` registers every module of the family with its source-to-state
map, exact source paths, checked source symbols and finite-domain choices; the
table below covers the domain, adapter, controller and dialog models described in
this guide. All transitions are local specification execution.

## Domain coverage

| Module | Main state | Safety properties |
| --- | --- | --- |
| [IdentitySession](IdentitySession.qnt) | phase/method/pending/consumed, receipt/key/acknowledged/ackTries, epoch/attemptOwner/owner | `KeyBeforeAck`, `DurableReceiptBeforeKey`, `SingleUseGoogleReturn`, `MatchedReturnBurned`, `BoundedAttempts`, `AuthenticatedKey` |
| [ServiceAuthorization](ServiceAuthorization.qnt) | plan/validFor/refresh/failures, signedRefusal/credits, owner/epoch/requestOwner/requestEpoch, request/dispatched/refusedRequests | `RefusalNotUpgraded`, `ExpiryHonest`, `SnapshotHasNoSignedLifetime`, `CanonicalCreditView`, `UndispatchedRequestWasRefused`, `ExactManagedRoute`, `CurrentDispatch` |
| [GoogleAccounts](GoogleAccounts.qnt) | attempt/pendingEpoch/phase/returnMatched, account/readGrant/modifyGrant/calendarGrant, cacheVisible/review, disconnectSent/revoked | `ReviewNeedsCurrentModify`, `CacheNeedsRead`, `ModifyIncludesRead`, `RevokedAccountEmpty` |
| [CalendarSync](CalendarSync.qnt) | phase/kind/holder/instance, undoOpen/clockKnown, baseRevision/remoteRevision/checked, retryAuthorized/applied/sends, consent/localRevision/consentReview | `NoAutomaticUnknownWrite`, `UndoBeforeDispatch`, `PausedNeedsDecision`, `DurableClaim`, `VisibleOwnerBound` |
| [InboxDelivery](InboxDelivery.qnt) | phase/durable/opOwner/opGrant, reviewedRevision/reviewedAttachments/exactReview, outcome/providerConfirmed/draftExists, dispatches | `AtMostOneDispatch`, `PersistBeforeDispatch`, `CacheBound`, `SuccessfulCleanup`, `UnknownCannotRearm` |
| [MapsNavigation](MapsNavigation.qnt) | generation/requestGeneration/requestEpoch, locationGranted/fixFresh/located, route/previousRoute/guidance/rerouting, screenOff/foreground, assistant | `GuidanceHasRoute`, `RerouteKeepsRoute`, `RetiredRouteHidden`, `FailedRerouteEndsGuidance`, `GuidancePhase`, `GuidanceFixNeedsPermission`, `ScreenOffNeedsGuidance`, `HiddenKeepsOnlyScreenOffGuidance` |
| [WorkflowExecution](WorkflowExecution.qnt) | Reviewed submission with one admission per identity, owner-confirmed resend, a known non-run, legacy agents, approval bound to the request digest, and the development trigger queue | `AtMostOneExecution`, `DurableSubmission`, `AcceptedRunIsReviewedVersion`, `ProtocolAdmitsReviewedVersion`, `AbandonedNeverRan`, `OwnerConfirmsRepeat`, `ReviewedEffect`, `CancelNeedsReceipt`, `TriggerDispatchEnabled`, `ProductionTriggerGate` |
| [NoticesAndCaches](NoticesAndCaches.qnt) | epoch/phase/retry, notice/claim/posted/consumed/acknowledgements, cacheOwner/cacheEpoch/cacheAge/cacheWritePending | `CacheOwnerIsolation`, `PostedOwnerIsolation`, `OneAcknowledgement`, `ClaimExclusive`, `NoPostAfterConsume` |
| [BrowserSiteState](BrowserSiteState.qnt) | privateTab/thirdParty/phase, decisions/prompt/permissionChoice/androidAllowed, authAttempts/passwordPresent/passwordSubmitted. A runtime permission dialog survives pause and tab deselection; site and sign-in prompts need the shown tab | `PrivateCookiePolicy`, `PrivatePermissionPolicy`, `CurrentPermission`, `PromptNeedsShownTab`, `PasswordLifetime` |
| [BrowserReadingState](BrowserReadingState.qnt) | phase/isolated/ready/sensitive (per page), token/approved/reviewedExcerpt/consumed, owner/epoch/navigation/capturedEpoch/capturedNavigation, draft/userText with the empty-excerpt Ask fallback | `ReviewedSpeech`, `CurrentReading`, `SingleUseToken`, `SensitiveRefused`, `DraftHasReviewedContent`, `FallbackNeverSpeaks` |
| [BrowserDownloads](BrowserDownloads.qnt) | phase/kind/reviewed/reviewedNavigation, cookieSent/targetOrigin/sourceOrigin/redirects, captureToken/nextChunk/chunks/pendingFile, published/completed/entry/persisted, including a removal that lands after the copy finished | `CookieOrigin`, `PrivateListNeverPersisted`, `ReviewedPublication`, `CompletedFromEvidence`, `CapturedBytesOrdered`, `CancelledCaptureCleaned`, `CancelledLeavesNoEntry`, `OrphanFileWasReviewed` |
| [ScanDocument](ScanDocument.qnt) | ordered pages/text layers, serialized CAS saves, visibility, export retry lock | `TextStaysWithPage`, `WriterSerialized`, `ImmutableExport`, `UnknownExportLocked`, `ClosedNoWriter` |
| [NativeCredentialMutation](NativeCredentialMutation.qnt) | operation/phase/before/capturedProvider, requestedStop/acknowledgedStop/stopped, ownerEpoch/capturedEpoch, oldSize/newSize/admissionInvalidated, productionSlot/observerNotified | `LeaseBounds`, `BegunRequestIsKnown`, `ShutdownBeforeCriticalWrite`, `AdmissionInvalidated`, `CurrentMutation`, `RejectedWriteRetainsBytes`, `Bounded`, `CloudChangeObserved`, `ObserverOnlyForReplacedCloudKey` |
| [PdfWorker](PdfWorker.qnt) | isolated/busy/request, descriptor/bitmap/shared/mapped/readOnly, elapsed/phase, recipientHandle/publishedReadOnly | `IsolatedAdmission`, `ActiveRequestOwned`, `MappingHasStorage`, `ReadyResourcesClosed`, `PublishedReadOnly`, `ReadOnlyNotMapped` |
| [WebReadingReview](WebReadingReview.qnt) | Web read-aloud excerpt dialog: sensitive refusal, page text that never replaces typed text, Read only after the text settled and while the page is current, one generation-fenced local speech, closing stops everything | `SpeechNeedsOpenReview`, `ReadWaitsForSource`, `SensitiveNeverSpoken`, `BlockedHoldsNoText`, `ClosedIsInert`, `TypedTextKept`, `OnlyCurrentSpeechEnds` |
| [SmsSend](SmsSend.qnt) | Visit and draft tokens, one operation ID per reviewed draft, the native answer for a repeated ID, release of the ID after cancelled, denied or pre-journal refusals, and stale answers dropped | `AtMostOneDispatchPerOperation`, `DispatchJournaled`, `ClosedAnswerReleasesId`, `HeldIdWasMinted`, `StaleResultNeverShown`, `InactiveHoldsNothing`, `BusyHasCall` |
| [ContactsSession](ContactsSession.qnt) | Availability, epoch-fenced reads, rows kept until the current read answers, loading always owned by a current read or the open editor, and rows cleared on leave or withdrawn admission | `ActiveMatchesAvailability`, `InactiveHoldsNoRows`, `RowsNeedAccess`, `MoreNeedsRows`, `LoadingHasCurrentWork`, `DeferredViewNotOpen` |
| [PhoneSession](PhoneSession.qnt) | Foreground-only recent-calls read with an epoch fence, the busy flag shared by the read and the dial handoff, access request state, and dial answers dropped after a re-read or a left visit | `ActiveMatchesAvailability`, `InactiveHoldsNothing`, `BusyHasCurrentWork`, `RowsNeedAccess`, `DialNoticeIsCurrentVisit`, `OneDialInFlight` |
| [PlanAdmissionGrace](PlanAdmissionGrace.qnt) | Stored plan admission record bound to one sign-in, offline and billing-outage admission from a recent record, the plan-end choice (redeemed, recent record, memory; never a past end for an active plan), and record removal on a refused sign-in or ended plan | `EndsAtNotPast`, `GraceBoundToCredential`, `KeptOnlyOffline`, `CloudBindingHasBasis`, `PlanEndedRemovesRecord`, `SignedOutUnbound`, `RedeemedEndBelongsToSignIn` |
| [InboxListPaging](InboxListPaging.qnt) | Single-flight list reads fenced by generation, account and query, cursors used once, a repeated cursor ending the list, and the saved folder list | `ShownBelongsToSelection`, `SingleFlight`, `CursorUsedOnce`, `CursorNeedsList`, `SavedListMarked` |
| [ServiceReadCache](ServiceReadCache.qnt) | One document per account identity and service, the clear fence on queued writes, bounded entries and snapshots shown per account | `ShownOwnerIsolation`, `ShownHasEntry`, `ClearIsolated`, `ClearFencesPut` |
| [WorkflowAuthoring](WorkflowAuthoring.qnt) | Typed draft review, one stored mutation identity, receipt recovery, confirmed exact resend and a refused edit | `OneSavePerDraft`, `PendingNeverEdited`, `AppliedNeverAbandoned`, `ResendNeedsNoRecord`, `UnreceiptedMeansPending`, `CommittedClearsDraft`, `WireNeedsIdentity` |
| [ApprovalDecision](ApprovalDecision.qnt) | One retained decision per approval request digest, released by the receipt or when the run no longer accepts decisions | `AtMostOneDecisionPerRequest`, `RecordedNeedsDecision`, `RetainedBlocksReview`, `BusyMeansRetained`, `WireNeedsDecision` |
| [TriggerCursor](TriggerCursor.qnt) | Development trigger runtime: scan and dispatch latches, per-workflow error isolation, the location cursor across position gaps and the pruned seen set | `LatchNeedsRuntimeFault`, `LeaveFiredOncePerObservation`, `CursorKeepsLastKnownSide`, `SeenBounded`, `QueueBounded`, `ReportMeansBroken` |
| [WorkflowNoticeTaps](WorkflowNoticeTaps.qnt) | A pending tap read against the view generation, deferred behind operations, opened once, and released or consumed by an Ask review | `OpenedOncePerTap`, `ConsumedWasHandled`, `RememberedTapIsPending`, `QuestionReviewHasTap`, `ComposeNeedsConsume`, `StaleCheckRepeats` |
| [InboxEditCoalescer](InboxEditCoalescer.qnt) | One waiting copy of the retained email edits, written once per pause and within the burst limit, held behind a store write in flight, with the not-retained status for a copy too large to encode | `WaitingIsLatest`, `NoSilentLoss`, `WaitingHasDriver`, `BurstBounded`, `HeldBlocksDueWrite`, `OneWritePerBurst`, `StoredWasPushed` |
| [WorkflowLifecycleChange](WorkflowLifecycleChange.qnt) | Reviewed removal and restore: interrupted runs cancelled first, one retained request per change, release by reply, receipt or a moved version, and a late request that can no longer apply | `OneSendPerIntent`, `AppliedOncePerIntent`, `ReleasedRequestCannotApply`, `UnseenChangeStaysRetained`, `ReviewNeedsUnlocked`, `UnknownReviewIsReview`, `BusyStage` |
| [MapsConnection](MapsConnection.qnt) | bound account and client, the launch coverage reader's owed read, read generations in flight, diagnostics, the installed provider and its owner, guidance and why it ended | `InstalledIsHealthy`, `InstalledForSignedInAccount`, `CurrentReadHasNoProvider`, `ReadsAreIssuedInOrder`, `GuidanceNeedsProvider`, `ReadKeepsGuidance`, `CoverageReaderSeesBinding`, `CoverageWaitsForResident`, `RequestOutcomeNeedsProvider` |
| [MapsScreenModes](MapsScreenModes.qnt) | the six screen modes from searching/selected/directions/originMode/navigating, Back unwinding, the location busy flag and watch, origin text and route, screen-off guidance when hidden, the one-use cross-app search | `NavigationNeedsRouteSheet`, `DirectionsNeedDestination`, `OriginPickNeedsRouteSheet`, `ReadyRouteNeedsOrigin`, `ScreenOffNeedsGuidance`, `HiddenGuidanceHasScreenOffSession`, `HandoffNeedsQuery`, `HandoffAppliedOncePerRequest` |
| [SystemPickerVisibility](SystemPickerVisibility.qnt) | Picker counter against hidden-page dialog closure for exempt and non-exempt scan dialogs, nested dialog closure, and one owned browser file picker whose retired results are never delivered | `CounterBalanced`, `UnexemptDialogsCloseWhenHidden`, `HiddenDialogStartedUnderPicker`, `NestedDialogsNeedDocument`, `RetiredPickerNeverDelivers`, `OneFilePickerConsumer` |
| [ScanReviewDialogs](ScanReviewDialogs.qnt) | One-shot Notes save, retryable photo PDF and Keep photo, searchable review outcomes before and after the provider request, preview bound to current corners, and a capture kept when the camera stops | `NotesSavedOnce`, `KeepRetryNeedsRetryableFailure`, `PdfRetryNeedsNonWrite`, `DocumentNeedsOpenReview`, `UnconfirmedNeedsProviderRequest`, `SearchableResultNeedsReadyText`, `PreviewMatchesCorners`, `AppliedCorrectionWasPreviewed`, `UsedPageWasReviewed`, `StoppedCameraKeepsCapture` |

The adapter, controller and dialog models, and the domain models revised with
them, follow these source symbols. Each module's manifest entry holds the exact
paths and the checked `symbols`.

| Module | Source symbols |
| --- | --- |
| [WebReadingReview](WebReadingReview.qnt) | `reviewBrowserReading`, adapter `readPage`, `stopReading` |
| [BrowserSiteState](BrowserSiteState.qnt) | shared `BrowserTabHostPlugin` site permission, runtime permission and HTTP auth prompts, `BrowserSitePermissionRecord` |
| [BrowserReadingState](BrowserReadingState.qnt) | adapter `readPage`, `askPage`, `reviewContentQuestion`, shared `pageQuestionExcerpt`, native reviewed reading |
| [BrowserDownloads](BrowserDownloads.qnt) | shared `BrowserDownloads`, `BrowserDownloadPolicy` |
| [SmsSend](SmsSend.qnt) | `installSmsAdapter` (`send`, `reconcile`, `sync`, `edit`), `SMS_NOT_SENT`, `createSmsSession`, `receiptLabel` |
| [ContactsSession](ContactsSession.qnt) | `installContactsAdapter` (`refresh`, `sync`, `clear`, `editor`), `applyImageContacts`, `isMvpView` |
| [PhoneSession](PhoneSession.qnt) | `installPhoneAdapter` (`refresh`, `dial`, `sync`, `clear`), `phoneRows`, `normalizePhoneNumber` |
| [PlanAdmissionGrace](PlanAdmissionGrace.qnt) | `residentAdmissionOutcome`, `residentBindingController` (`checkPlan`), `readPlanAdmission`, `writePlanAdmission`, `redeemedPlanEnd`, `residentPlanEnded`, `residentRefreshRefused` |
| [ServiceAuthorization](ServiceAuthorization.qnt) | `EntitlementRefresher`, `checkEntitlement`, `planAdmission`, `managedServiceRequest` |
| [NativeCredentialMutation](NativeCredentialMutation.qnt) | `AlphaCredentialStore.mutateSlotOnce`, `commit`, `observeCloudChanges`, `LocalAgentProviderAdmission.sameCloudCredential` |
| [InboxListPaging](InboxListPaging.qnt) | `load`, `loadDrafts`, `nextPageToken`, `seenCursors`, `rememberList`, `restoreList` |
| [ServiceReadCache](ServiceReadCache.qnt) | `ServiceReadCache.put`, `clear`, `get`, `readCacheIdentity`, `serviceReadCache`, `retireSharedMail` |
| [WorkflowExecution](WorkflowExecution.qnt) | `WorkflowProtocol.run`, `runIntentReconcilable`, `unadmitted`, `unverifiable`, `clearRunRequest`, `reviewResend`, `decideApproval` |
| [WorkflowAuthoring](WorkflowAuthoring.qnt) | `createWorkflowAuthoring`: `save`, `recover`, `resend`, `refused`, `committed`, `discardDraft` |
| [ApprovalDecision](ApprovalDecision.qnt) | `decide`, `read`, `approvalKey`, `approvalLocked`, `decideApproval` |
| [TriggerCursor](TriggerCursor.qnt) | `WorkflowTriggerRuntime.tick`, `wake`, `triggerTickPlan`, `detectWorkflowTriggers`, `placeChanged` |
| [WorkflowNoticeTaps](WorkflowNoticeTaps.qnt) | `checkNotice`, `resolveWorkflowTap`, `readyTapStep`, `tapRecheck`, `reviewWorkflowNoticeQuestion`, `consumeWorkflowTap` |
| [InboxEditCoalescer](InboxEditCoalescer.qnt) | `editCoalescer`: `push`, `flush`, `hold`, `release`, `discard`; `inboxUnsaved.edit`, `peek`, `retire` |
| [WorkflowLifecycleChange](WorkflowLifecycleChange.qnt) | `lifecycle`, `open`, `lifecycleLocked`, `lifecycleKey`, `reconcileLifecycle`, `beforeDispatch`, `WorkflowLifecycleRejected` |
| [MapsConnection](MapsConnection.qnt) | `keepCloudMapsCoverage`, `readCloudMaps`, `retireCloudMaps`, `initializeCloudMaps`, `captureMapsSession` |
| [MapsScreenModes](MapsScreenModes.qnt) | `MapsScreenController`, `view.mode`, `pendingHandoff`, `discardHandoff`, `screen.handoff`, `screen.back`, `screen.hidden` |
| [MapsNavigation](MapsNavigation.qnt) | `DeviceMapsNavigation`, `MapsController`, `MapsScreenController`, `captureMapsSession`, `BackgroundNavigation` |
| [SystemPickerVisibility](SystemPickerVisibility.qnt) | `systemPickerActive`, `duringSystemPicker`, `runFilePicker`, scan dialog visibility handlers |
| [ScanReviewDialogs](ScanReviewDialogs.qnt) | `openScanReview`, `reviewSearchableScan`, scan correction review, `captureScanPage` |

## Model boundaries

The models collapse opaque identifiers and bytes into finite equality classes.
Account, session and revision fields stay separate wherever an asynchronous
completion relies on them. Every module includes `TypeOK`, `safety`, explicit
stuttering and executable scenario tests.

`CalendarSync` represents a canonical Calendar mutation and reviewed linked-sync
admission. The current shared mutation ledger quarantines every unknown write,
including updates and deletes. Restart cannot rearm an ambiguous operation.
Only an explicit non-acceptance or read-only preflight failure permits retry.
An exact source-bound receipt/readback can settle linked-sync recovery. Hiding a
result preserves the durable unknown state. Native deletion timers are a
separate subcontract composed at the same admission boundary. The manifest
records this composition and the finite limits.

`InboxDelivery` follows the durable `preparing`, `review`, `dispatching` and
`observed` phases. Restart recovery reads the original operation identity.
Local source-draft cleanup requires the provider to confirm the saved successful
receipt again. It never rearms a send after an unknown outcome.

`WorkflowExecution` models one reviewed submission and one effect. The production
authoring path has manual triggers. Automatic browser triggers belong to an
explicit test-mocks configuration. The shared engine still owns graph execution
and provider-level idempotency.

`MapsNavigation` keeps the navigation route while assistant UI changes and while
a reroute is in flight. A failed reroute ends guidance with a network error. Geometry, detailed maneuver selection and map rendering are
outside this state abstraction.

`NoticesAndCaches` models delivery ownership, consumption and cache invalidation.
Platform notification delivery, uncertain native posting, provider history cursors
and multi-entry byte budgets retain their implementation tests. The one-notice
model does not establish exactly-once operating-system notification display.

These models are manually derived contracts. The existing application tests run
against source entry points and provide complementary evidence. There is no
automatically proved refinement between TypeScript/Java execution and Quint.

## Reproduction

Run from the repository root with the pinned development dependency installed.

```sh
node_modules/.bin/quint typecheck specs/quint/services/CalendarSync.qnt
node_modules/.bin/quint test specs/quint/services/CalendarSync.qnt --backend=typescript --seed=123 --max-samples=20
node_modules/.bin/quint run specs/quint/services/CalendarSync.qnt --backend=typescript --seed=123 --max-samples=1000 --max-steps=60 --invariant=safety
```

Apply the same commands to each module in the manifest. Runtime model-checking
commands and aggregate verification are documented in the parent Quint guide.

## Validation record

On 2026-11-07, Quint 0.33.1 parsed and typechecked all fourteen modules. All 84
scenario tests passed with the TypeScript backend and seed 123. Safety simulation
passed for 1,000 traces per module, up to 60 steps per trace, with the same seed.
This record describes sampled bounded exploration.

The existing focused source suites also passed 43 tests. They covered
`cloud-sign-in-flow`, `google-accounts`, `gmail-grants`,
`google-calendar-outbox`, `google-calendar-writer`, `maps-navigation`,
`notice-owner-coordinator` and `service-read-cache`.
These include plain-JVM parser checks and synthetic provider/runtime tests.
No provider login, message dispatch, device acceptance or APK build is established
by this service-model validation.

## Additional browser state coverage

`BrowserSiteState` checks policy readback before a native isolated tab can load,
normal/private cookie separation, selected top-origin permission review followed
by Android permission, and the current engine's manual-only HTTP authentication.
A runtime permission dialog survives pause and tab deselection, while site and
sign-in prompts need the shown tab. Passkey state is not part of this model: the
host relies on the fresh WebView default WebAuthn NONE, and no platform readback
is established here. Two origins and one sensor kind represent the per-origin
permission record.

`BrowserReadingState` models isolated extraction, sensitive-page refusal, an
expiring one-use token, owner/navigation fences and cancellation. Question review
releases a local draft that keeps the user's typed text, with an Ask fallback when
the excerpt is empty; sending is outside this model. Browser DOM heuristic correctness
and extraction limits retain their source tests.

`BrowserDownloads` separates OS public transfers, signed in-app fetches, and local
blob/data captures. It checks every redirect's cookie origin, captured chunk order,
review identity, temporary-file cleanup, private history and publication receipts.
Closing a private tab cancels its active signed transfer. A published file remains
in Downloads when its browser-history entry is removed.

## Symbolic checks

On 2026-11-07, the original eight service modules also passed Apalache 0.62.4
bounded symbolic safety checking through four transitions with Quint 0.33.1.
The initial shared-port sequence encountered connection failures for GoogleAccounts,
CalendarSync, MapsNavigation and NoticesAndCaches. Each failed invocation was
retried successfully on a dedicated local endpoint. No failing invocation is
counted as a pass. Run the following per module to reproduce the bounded check.

```sh
node_modules/.bin/quint verify specs/quint/services/CalendarSync.qnt --max-steps=4 --invariant=safety --server-endpoint=localhost:8891
```

The four-step bound checks only those finite executions. Longer behavior is covered
by the separately recorded sampled simulations, not by this symbolic result.

The additional browser source suites passed 18 tests covering site permissions,
reading capability/codes, native web features and external-page/passkey admission.
These are plain-JVM and source-level checks. They do not execute installed Android
WebView interactions.

## Scan document state

`ScanDocument` models ordered page/text-layer pairs, correction and replacement,
serialized snapshot autosaves with compare-and-set revisions, explicit saved-draft
load/delete, system-picker visibility, and immutable PDF export. It distinguishes
retryable known non-writes from the `requested`, `exported` and `unverified` results
that lock the current review. Two pages and four opaque non-reused revisions keep
the model finite while preserving ordering and concurrency distinctions.

The current shared Save draft implementation clears `autoSaved`, so an
explicitly saved draft survives confirmed export even when autosave ran first.
The model's `explicitSaveAfterAutosavePreservedTest` records that behavior. Loaded drafts
also survive export. This mapping follows the current shared owner instead of
the historical native implementation removed during the upstream migration.

The existing `scan-review-pdf-errors` tests passed all three cases for conversion
failure, unknown export failure and resolved status retry behavior.

The desired `ExplicitlySavedDraftPreserved` predicate is kept separately from
runtime `safety`. `explicitSaveAfterAutosaveCounterexampleTest` reproduces its
violation. A controlled execution of the actual `openScanDocument` source entry
point also reproduces the same sequence with in-memory draft storage and a
synthetic successful export receipt.

```sh
node specs/quint/services/scan-source-conformance.mjs
```

The script succeeds when it observes the documented discrepancy. It creates no
PDF or external side effect. It is a source-level counterexample reproduction,
not an assertion that the desired preservation contract passes.

## Native credential and isolated PDF lifecycles

`NativeCredentialMutation` follows `AlphaCredentialStore.mutateSlotOnce` and
`AlphaLocalAgentPlugin.mutateCredentials`. Critical changes capture both slot
contents and provider revision, retire the resident, require the exact shutdown
acknowledgement, and recheck ownership before commit. Retained-cap data can shrink.
An over-cap growth refusal preserves credential bytes while an already-invalidated
provider admission stays invalidated. Provider rollback refuses a newer revision.

`PdfWorker` follows `IsolatedPdfService`. Its single busy-CAS owner releases the
input descriptor, bitmap and mapping before a main-thread reply. Successful output
is protected read-only before descriptor transfer. Invalid bounds, failed memory
protection, timeout and memory pressure have distinct cleanup scenarios. A rejected
second request leaves the first request's resources owned by that worker.

The three additional browser modules and ScanDocument also passed the same
four-step Apalache safety check. Their ordered-chunk, empty-blob, isolated-world
handshake and queued-autosave cases are included in the scenario tests.

`NativeCredentialMutation` and `PdfWorker` passed Apalache 0.62.4 through four
transitions as well. All fourteen service-family models therefore have passing
bounded symbolic safety evidence in addition to the seeded simulations. The
separate expected scan draft counterexample remains intentionally reproducible.

## Reviewed sign-in and entitlement sequencing

`IdentitySession` keeps the native transient Steward session until a separate
cleanup step after authentication delivery. A cancellation before mobile-key
persistence ends the attempt. Cancellation after persistence records the UI
request and allows key acknowledgement to finish. An authentication result says
nothing about whether the best-effort remote Steward logout has completed.

`ServiceAuthorization` distinguishes signed entitlements, unsigned active billing
snapshots and organization-credit mode. Signed no-plan evidence admits only the
explicit credit fallback. A canceled or invalid signed response ends that check.
Unsigned active snapshots carry no modeled signed expiration and may have a zero
period end in source. A refresh outage clears the displayed snapshot/credit
admission while retaining retries. A still-valid signed entitlement retains its
active view during a refresh outage and expires at its signed deadline.

After the sign-in and entitlement sequencing review, both corrected modules
passed typechecking, all 14 of their scenarios, 1,000 traces of up to 60 steps
with seed 123, and four-step Apalache checks. The existing
`cloud-sign-in-flow` and `subscription-entitlement` source suites passed 38 tests.
The family contains 14 modules and 90 scenarios after the grant-restoration review.

## Grant restoration

`CalendarSync.restorePermission` updates current permission admission while
retaining the durable operation owner, revision, uncertain outcome and retry
authorization. `InboxDelivery.restoreGrants` enables current capabilities while
retaining dispatch/receipt state and leaving retired review and cache contents
cleared. Both actions preserve older operations.

The six added scenarios cover new review after restored access, unknown-outcome
preservation and stale-owner rejection. Both updated models passed typechecking,
all scenarios, 1,000 traces of up to 80 transitions and four-transition symbolic
safety checking. Their current receipts are in
`test-results/quint-native/producer-validation.json`. The earlier Calendar/Inbox
receipts remain historical evidence for their previous revisions.

## November 8 coordinator integration

`InboxCoordinator` composes two retained `InboxDelivery` slots with current shared review and draft controllers. Eighteen coordination schedules and nine cleanup schedules preserve grant changes, current capability checks, queued cleanup, lost persistence replies and the original dispatch identity. The source bundles bind the SDK99 pin and explicit confirmation/cleanup patch inputs.

`IdentitySession` separates the live interactive intent from an encrypted pending record. A cold browser return cannot recreate that intent. A cancelled post-commit interaction can leave a successful acknowledgment receipt for startup cleanup. `NativeCredentialMutation` also distinguishes a durable commit from its reported result. The corresponding native drivers execute current shared Java owners under controlled storage and transport ports.

## Named embedding provenance at the SQL boundary

On product revision `5a672102dd` with upstream pin `99b49439ce9`, a held
`updateMemoryEmbedding` could pass its width check, wait at PGlite
initialization, and resume after named activation. The row received the new
space label and nonce even though the input had no provider marker. The same
barrier allowed an earlier 768-wide resize to overwrite the active BGE384
column after named activation.

`NamedEmbeddingProvenance` checks the authenticated replacement against real
PGlite transactions. A single live snapshot controls vector admission, column
selection, the named label and nonce, and vector searches. The exact source
CAS still distinguishes an obsolete text or owner from a refused vector.
Rejected atomic text-and-vector replacements leave the stored text and vector
unchanged. Conversation reconciliation and Experience metadata writes omit
the stored vector when they are only publishing content or metadata.

The current model has seven scenarios and checks eight source schedules.
It uses a synthetic marked provider through the real model dispatcher and
observes actual SQL text, space, column and write outcomes. The proof covers
new writes by one active PGlite adapter. Existing named rows, independent
database processes and physical BGE execution have separate evidence
requirements. `EmbeddingStoreIdentity` retains the unlabelled probe model and
`CoreEmbeddingDimension` retains the historical translation and counterexamples.
