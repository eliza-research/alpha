# Service and data state models

These fourteen modules model product-owned service boundaries in the current working
tree. The source-to-state map, exact source paths and finite-domain choices are
listed in `manifest.json`. All transitions are local specification execution.

## Domain coverage

| Module | Main state | Safety properties |
| --- | --- | --- |
| [IdentitySession](IdentitySession.qnt) | phase/method/pending/consumed, receipt/key/acknowledged/ackTries, epoch/attemptOwner/owner | `KeyBeforeAck`, `DurableReceiptBeforeKey`, `SingleUseGoogleReturn`, `MatchedReturnBurned`, `BoundedAttempts`, `AuthenticatedKey` |
| [ServiceAuthorization](ServiceAuthorization.qnt) | plan/validFor/refresh/failures, signedRefusal/credits, owner/epoch/requestOwner/requestEpoch, request/dispatched | `RefusalNotUpgraded`, `ExpiryHonest`, `LocalIndependent`, `ExactManagedRoute`, `CurrentDispatch` |
| [GoogleAccounts](GoogleAccounts.qnt) | attempt/pendingEpoch/phase/returnMatched, account/readGrant/modifyGrant/calendarGrant, cacheVisible/review, disconnectSent/revoked | `ReviewNeedsCurrentModify`, `CacheNeedsRead`, `ModifyIncludesRead`, `RevokedAccountEmpty` |
| [CalendarSync](CalendarSync.qnt) | phase/kind/holder/instance, undoOpen/clockKnown, baseRevision/remoteRevision/checked, retryAuthorized/applied/sends, consent/localRevision/consentReview | `NoAutomaticUnknownWrite`, `UndoBeforeDispatch`, `PausedNeedsDecision`, `DurableClaim`, `VisibleOwnerBound` |
| [InboxDelivery](InboxDelivery.qnt) | phase/durable/opOwner/opGrant, reviewedRevision/reviewedAttachments/exactReview, outcome/providerConfirmed/draftExists, dispatches | `AtMostOneDispatch`, `PersistBeforeDispatch`, `CacheBound`, `SuccessfulCleanup`, `UnknownCannotRearm` |
| [MapsNavigation](MapsNavigation.qnt) | generation/requestGeneration/requestEpoch, locationGranted/fixFresh, route/previousRoute/guidance/rerouting, assistant/foreground | `GuidanceHasRoute`, `RerouteKeepsRoute`, `RetiredRouteHidden`, `FailedRerouteKept` |
| [WorkflowExecution](WorkflowExecution.qnt) | version/reviewedVersion/phase, queued/sourceCurrent/enabled/mocks, intentSaved/submission/admittedSubmission/executions, approval/requestDigest/reviewedDigest/effects, cancelRequested/outcome | `AtMostOneExecution`, `DurableSubmission`, `ReviewedEffect`, `DisabledTriggersEmpty`, `ProductionTriggerGate` |
| [NoticesAndCaches](NoticesAndCaches.qnt) | epoch/phase/retry, notice/claim/posted/consumed/acknowledgements, cacheOwner/cacheEpoch/cacheAge/cacheWritePending | `CacheOwnerIsolation`, `PostedOwnerIsolation`, `OneAcknowledgement`, `ClaimExclusive`, `NoPostAfterConsume` |

| [BrowserSiteState](BrowserSiteState.qnt) | privateTab/thirdParty/passkeys/phase, decisions/prompt/permissionChoice/androidAllowed, authAttempts/passwordPresent/passwordSubmitted, autofillExposed/authSave | `PrivateCookiePolicy`, `PrivatePermissionPolicy`, `CurrentPermission`, `PasskeysDisabled`, `StandardHttpAuthManual`, `PasswordLifetime` |
| [BrowserReadingState](BrowserReadingState.qnt) | phase/isolated/ready/sensitive, token/approved/reviewedExcerpt/consumed, owner/epoch/navigation/capturedEpoch/capturedNavigation, draft/sent | `ReviewedSpeech`, `CurrentReading`, `SingleUseToken`, `SensitiveRefused`, `QuestionDoesNotSend` |
| [BrowserDownloads](BrowserDownloads.qnt) | phase/kind/reviewed/reviewedNavigation, cookieSent/targetOrigin/sourceOrigin/redirects, captureToken/nextChunk/chunks/pendingFile, published/completed/entry/persisted | `CookieOrigin`, `PrivateListNeverPersisted`, `ReviewedPublication`, `CompletedFromEvidence`, `CapturedBytesOrdered`, `CancelledCaptureCleaned` |
| [ScanDocument](ScanDocument.qnt) | ordered pages/text layers, serialized CAS saves, visibility, export retry lock | `TextStaysWithPage`, `WriterSerialized`, `ImmutableExport`, `UnknownExportLocked`, `ClosedNoWriter` |

| [NativeCredentialMutation](NativeCredentialMutation.qnt) | operation/phase/before/capturedProvider, requestedStop/acknowledgedStop/stopped, ownerEpoch/capturedEpoch, oldSize/newSize/admissionInvalidated | `ShutdownBeforeCriticalWrite`, `AdmissionInvalidated`, `CurrentMutation`, `RejectedWriteRetainsBytes`, `Bounded` |
| [PdfWorker](PdfWorker.qnt) | isolated/busy/request, descriptor/bitmap/shared/mapped/readOnly, elapsed/phase, recipientHandle/publishedReadOnly | `IsolatedAdmission`, `ActiveRequestOwned`, `MappingHasStorage`, `ReadyResourcesClosed`, `PublishedReadOnly`, `ReadOnlyNotMapped` |

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

`MapsNavigation` preserves a navigation route while assistant UI changes or a
reroute fails. Geometry, detailed maneuver selection and map rendering are
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
Passkeys remain disabled through the provider readback gate. Two origins and one
sensor kind represent the per-origin permission record.

`BrowserReadingState` models isolated extraction, sensitive-page refusal, an
expiring one-use token, owner/navigation fences and cancellation. Question review
releases a local draft and keeps Send separate. Browser DOM heuristic correctness
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
