# Application state models

These modules describe the current product shell and its storage and review
boundaries. The exact entry-point paths are recorded in `manifest.json`.

| Module | Source symbols | Modeled state and abstraction |
| --- | --- | --- |
| `Application` | `AlphaClient.attachVerifiedTransport`, `disconnect`, `setViewContext`, native startup/reset gates | Two owners, three non-reused epochs, lifecycle, sensitive observation, pending work, reviewed dispatch, voice and owner-scoped visible cache |
| `DeviceActionReview` | Current `DeviceActions` binding and shared `DeviceActionCoordinator.pendingReview`, `performRequested`, `approve` | One focused proposal at a time with its operation class (direct, reviewed, workflow step, outside the contract), request-message binding, typed-address grounding for Browser, the Review-first preference (off, on, unreadable), one direct pass of at most four approvals that stops on the first non-success, exact context, expiry, consumed card, durable reservation identity, server decision/claim, applying marker, one effect per proposal, terminal journal and receipt. `UnknownOnlyAfterDispatch` is a registered expected violation (the public call answers `unknown` for a failure before any dispatch) |
| `BrowserAgentOpen` | `BrowserAdapter.browserNavigateApproved`, `browserCommand`, `ViewNavigationClient.receiveInteraction`, shared `browserAllowed`/`consumeBrowserRequest` | One Browser proposal with destination class and typed-address match, one automatic open per message, presentation only after the journal and receipt attempt, and one unjournaled back/forward/reload command bound to the exact tab navigation with review-first refusal. Model-only; `OpenedClaimMeansShown` is a registered expected violation |
| `CameraAgentCapture` | camera adapter `takeRequestedPhoto`, `active`, phone executor camera branch | One agent photo request: visible Camera required, chat closed on admission, preview hold, queued start, second check before the shutter, unknown only after the shutter. Model-only; `ShutterNeverCovered` is a registered expected violation (owner reopens chat while the preview starts) |
| `FilesAgentActions` | phone executor Files branch, shared Files runner `run`/`reviewedIdentities`, `filesContextAllowed` | Direct filter/open (may bring Files forward) versus reviewed share, new folder, move and trash; move/trash bound to the identity read when the card was built. Model-only |
| `NotesAgentSource` | phone executor `create_note`, Notes query and selected-note branches | Phone-side Notes operations act only on Previous notes; selected-note binding, trash copy before tombstone, reviewed reads. The canonical Notes write outside the Review-first preference is an explicit assumption and a registered expected violation. Model-only |
| `CalendarAgentWrites` | phone executor Calendar branch | No direct Calendar operation, native review after the card, selected-record binding, queued delete reported unknown until its Undo window settles. `UnknownOnlyAfterNativeCall` is a registered expected violation. Model-only |
| `MapsSelectedRead` | `readMapsSelection`, `validateMapsSelectedObject`, shared `assertMapsContext` | Selected place/route read bound on the card, in the executor and before the receipt; search results are not readable. `UnknownOnlyAfterRead` is a registered expected violation. Model-only |
| `CalendarApprovalReview` | `CalendarApprovalClient.read`, `resolve`, exact Calendar DTO and finite result parsers | One authenticated read object and revision, captured owner/context, consumed admission before typed POST, cancellation and late-result fencing |
| `ShellNavigation` | `ViewNavigationClient.capture`, `deliver`, `cancel`, shell `back`, `goHome`, `openView` | All 19 `AlphaView` values, modal/shade/composer ordering, focus, draft and one completed-action claim. View-specific record bodies use their domain models |
| `StartupPermissions` | `createStartupPermissionFlow`, `readStartupPermissionMemory`, `readStartupPermissionProgress`, `writeStartupPermissionProgress` | One representative permission transaction, seven ordered native setup steps, durable prompt attempt and progress, legacy completed installation |
| `PermissionWalkthrough` | `StartupPermissions.allow`, `advance`, `finish`, `savedProgress` | Seven independent permission maps, owner/sequence fences, read-only reactivation, targeted Settings review, durable choices and historical completed records |
| `AssistantConversation` | `AlphaClient.run`, `send`, `approve`, `cancel`, `disconnect`, `assistantDraftStore` | One foreground request and one proposal identity that survives a failed or aborted send, expiry, consumption kept across a same-session reload with an explicit agent-journal assumption for other sessions, automatic-workflow survival across ordinary navigation, sensitive-view cancellation, compare-and-exchange composer draft |
| `NotesLifecycle` | Legacy `editNotesTrash`/`planNotesTrash`, canonical `NotesController`, `NotesEditor`, `NotesSnapshotState`, `CanonicalNotesUi` and the Notes folder document | Separate legacy Trash/CAS and canonical owner/read/write generations, dirty-draft preservation, queued edits, uncertain writes, current selection, stable folder identity and deleted-folder projection |
| `CanonicalNotesFeedback` | Canonical Notes UI, controller and editor callbacks | Read errors, save review and uncertain mutation outcomes |
| `CanonicalNotesMutation` | Prepared shared Notes editor and the Alpha host binding | Save-before-delete, queued edits, restore and owner fencing |
| `CanonicalNotesView` | Canonical Notes UI collection and navigation | Draft projection, Trash, owner visibility and navigation waiters |
| `DurableStore` | `BrowserDomainDocument.load`, `edit`, `capture`, `restore`, `reset` | One document transaction, two distinct revisions, preserved legacy bytes, corrupt metadata, explicit recovery and persistence failure |
| `BrowserSession` | `browsingSnapshot`, `restoreBrowsing`, adapter `restoreSession`, `clearBrowsingData`, `forgetTabs`, `tabOpened`, native `BrowserSessionStore` | Three-tab limit over two normal tabs and one private tab, history only from committed pages, hydration-gated saving, replacing and adding restore of a saved record, clear browsing data, pop-up and close paths, row focus, navigation epoch. `privateHistory` is the private tab's own native session history. The write queue and native tab creation have their own models |
| `CredentialVault` | `passwordSurfaceOpen`, `refresh`, `lockState`, `locked`, `clearSecrets`, `leavePasswordManager`, `shown`, native origin-bound autofill | One ephemeral secret, listing reads fenced by a counter that every lock, leave and background advance, origin review, damaged-vault reset confirmation disarmed by a new read or a refused authentication, immutable test-only transfer admission. Native encryption and authentication are external inputs |
| `DevelopmentSurfaces` | `testMocksEnabled`, `devSurfacesEnabled`, `mock-admission`, browser profile selection, `BrowserDeviceControls` | Compile-time switch combinations, explicit fixture/remote/tool admission with the recorded tools query, runtime profile switching that admits nothing, and separation of synthetic events |
| `DevelopmentDevice` | Prototype call functions (`pnStart`, `pnEnd`, `pnDecline`), browser incoming-event and location simulators | Mock-only call screening, voicemail left only by a plain decline, mute/speaker/hold from the moment the call screen opens, message/notification counts, route position and explicitly simulated payment state |
| `DevelopmentHost` | `createBrowserCloudDevHandler`, `createCloudResidentHost`, local launcher scripts | Private credential claims that only succeed the credential they were requested against, serialized replacement, owned active requests, resident binding/expiry, a quiet closed host and coordinated child-process shutdown |
| `PermanentVoiceDeletion` | `planInterruptedPermanentDeletion`, `leasedDeletionRow`, `claimDeletion`, `changeAudioDeletion` | Separate note and recording effects, exact ownership, external references, shared-lock/renderer-lease admission, restore versus erase and interrupted recovery |
| `DraftDispatch` | `AssistantDraftController.hold`, `release`, `commit`, `open` | Text retained through dispatch, newer typing, per-conversation queues, reopened pending drafts and failed durable clears. `A+B` represents the ordered newline concatenation |
| `FilesTree` | Current volume browser, `files-storage`, `files-agent-contract`, `StorageBrowser` and `StorageCatalog` | Categories query storage, collisions keep both files, Trash retains origins, refresh prunes missing selections, agent moves check reviewed identity and permanent deletion requires review |
| `FilesBrowserController` | Prepared shared Files browser installed by the Alpha host | Folder read generations, access and volume readback, agent share admission and stale completion |
| `FilesFilter` | Prepared Files browser agent runner and shared matching | Filter admission, access readback, query ownership, result counts and cancellation |
| `PhotosWindow` | Native catalog reads in the Alpha Photos adapter and shared window helper | Paginated window merge, reload coalescing and hidden/disposed read fencing |
| `PhotosTrash` | Native Trash reads in the Alpha Photos adapter | Coalesced pagination, resume reload and stale completion fencing |
| `CalendarPresentation` | `calendar-adapter` `refresh(request, force)`, `generation`, `calendarReturnDay`, `calendarFormCommitted`, `calendar-month-focus`, Google Calendar selection | Selected month/day, views and menu/delete/search Back order, query-range generations with forced reads where the newest wins, visible calendars, owner-scoped rows, creation draft identity and a confirmed save closing the form |
| `CanonicalCalendarDraft` | Canonical Calendar editor and shared durable draft | Bound slot ownership, stale reads/writes, held clears, same-account replacement and recovery |
| `AgentCalendarRefresh` | Current Agent Calendar read controller | Range and session fencing, coalesced readback, legacy gate and next-event freshness |
| `AgentCalendarMutation` | Current Agent Calendar write controller | Edit admission, preservation and owner checks, exact dispatch and deferred refresh |
| `AgentCalendarSyncControl` | Current Agent Calendar linked control client | Captured review, selected source version, current draft and owner fence, exact control dispatch and linked-event read |
| `AgentCalendarEventReturn` | Canonical Calendar selection, origin and exact readback | Captured event and source revisions, independent reads, same-epoch re-selection and owner fencing |
| `MapsEventReturn` | Maps renderer and Calendar origin helpers | Visit-owned attempts, visible pagehide and leave retirement, exact Calendar navigation and notices |
| `GoogleConsentAdmission` | Mounted Google connections panel and shared Gmail grant rules | Verified account readback, preserved Gmail tier, stale permission continuation and revoke readback |
| `GoogleCalendarLinkFlow` | Current Connect Google Calendar orchestration | Verified account, select/resume, pending and conflict readback, latest review ownership and exact operation key |
| `GoogleCalendarLinkPublication` | Mounted Google account panel for Calendar | Independent read and link ownership, host admission, exact current notice and retained review |
| `GoogleCalendarAccessChoice` | Mounted Google Calendar access prompt | Exact verified read and intent, stale Ask and Allow receipts, current consent and link admission |
| `GoogleCalendarDisconnect` | Current Calendar-aware Google disconnect helper | Exact pause admission and readback, independently authorized revoke, callback retirement and bounded cleanup |
| `NotificationCollection` | `notification-store`, `notifications-adapter`, `AlphaNotificationListener`, `BrowserNotifications.dismiss`, `clear`, `external`, `noticeRoute`, `NotificationAccess.pause` | Opt-in external collection, package/signature/preview consent, lock privacy, history expiry, policy epoch and independent app/channel delivery settings; own-row dismissal checked against the lock inside its edit, batch clear, and pause on the native collector only |
| `FilesAndSharing` | `reviewFileEmail`, `reviewMailAttachment`, `mediaCopyIntent`, share adapters | One exact source, owner and draft identity, initially unchecked selection, reread before local insertion, cancellation and revoked grant. Send has its own Inbox model |
| `PreferencesAndPresentation` | `keyboardFreeHeight`, `canvasGeometry`, `surfaceLayout`, `publishSurfaceLayout`, shell preferences | Representative portrait/wide geometry, keyboard exclusion, large-text result predicates and preference readback. Deliberately broken result canaries reject bad Calendar, split and agenda publications; this layout model makes no draft/selection or native-shade claim |
| `HomeFailureNotice` | Home host and the shared installed launcher | Launch and inventory failure notices, surface ownership and duplicate suppression |
| `LauncherOwnership` | Shared launcher and system bridge | Inventory and default read generations, exact component/profile handoff and retired launch fencing |
| `LauncherObserver` | Shared launcher watcher and system bridge | Package and document events, refresh debounce, late listener settlement and idempotent retirement |
| `LauncherFavorites` | Shared mobile launcher and Alpha view registry | Ordered favorites, legacy migration, storage refusal, external choice ownership and visible reordering |
| `HomeGesture` | Alpha Home adapter and shared launcher | Pointer ownership, held and dragged activation, keyboard focus and edit-layer retirement |
| `DrawerInteraction` | Mounted Alpha Apps drawer | Current press, query and menu identity, focus restoration and exact App Info handoff |
| `CallbackLanding` | Static delegation-return page | Query multiplicity, state shape, result exclusivity, size/description limits, early URL scrubbing and exact app-link exposure |
| `ListFocus` | `createKeyedListFocus`, current Notes/Photos bindings | Two captures and roots, semantic identity, focus movement, discarded renders and current visibility |
| `RendererFailureUI` | `RootErrorBoundary`, global startup recovery and shared crash classification | One recovery surface, fixed diagnostic classes, modal retirement and explicit reload |
| `ComposerSend` | `p.send`, `SendAttempt`, `trackDispatch`, `transportSettled`, `dispatched` | Two overlapping send attempts, composer sends and prompts sent from elsewhere, the bounded wait for the transport result, restored versus unconfirmed text, and typing-indicator ownership across a session change |
| `RecorderStage` | voice-adapter `stage`, `generation`, `busy`, `transcribeClip`; `createNativeLiveDictation` | Recorder stages closed to review, generation-fenced tasks, the dictation driver recording, failed stop and lost capture, maximum-duration stop |
| `StoppedReplyReconciliation` | `scheduleStoppedReply`, `cancelStoppedReply`, `findStoppedUserTurn` | One later read per stopped reply, the cancel attempt, busy deferral, the reply notice, the confirmed-stop message and a refused new request after a retired check |
| `ApprovalRoutes` | `cardAct`, `AlphaClient.approve`, `approvePendingAction`, `recoverPendingActions` | Client and recovered approval routes for one proposal, consumption kept across a same-session reload, one tap in flight, lost responses, and one execution under the agent-journal assumption |
| `ReadReplyLease` | `retainReadReply`, `completeReadReply`, `cancelReadReplyCompletions` | One read-reply lease through pending, completing, done, cancelled and unconfirmed; at most one answer and one voice resume |
| `PendingActionRecovery` | `recoverPendingActions`, `scheduleExpiry`, `pendingActionRecoveryKey`, `pendingActionRecoveryFailedKey` | One pending-action read per session, history revision and screen context, stale results, a remembered failed read that is not retried, blocked states and the expiry timer |
| `OwnNoticeQuestion` | `reviewOwnNoticeQuestion` | Review sheet, recheck and consumption of one notification tap, dismissal and release, Home or blur during each step, one closed callback |
| `ReadAloud` | `installLocalSpeechPlayback` `listen`, `readNoteAloud`, `stopSpeaking`, `stopLocalSpeechPlayback` | One message reading and one note reading that replace each other, the wait for the previous audio to stop, toggle, lost context and the note outcome |
| `VoiceSurfaceRetirement` | voice-adapter `cleanup`, `retirement`, `stopVoiceConversation`, `dismissRetirement`, `startVoice`, `startTranscription`; `p.send` | The stopping chain after leaving voice, the chat retirement and its dismissal, refused voice starts, a typed message that waits for the chain, unconfirmed media that keeps voice closed |
| `BrowserTabLifecycle` | adapter `ensure`, `navigate`, `restored`, `restoreAttempts`, `forgetTabs`, `tabOpened`/`tabClosed` listeners, shared `BrowserTabSession` | Renderer tabs against native tabs, creation in flight, the limit on New tab, new-tab navigation, pop-up and after-create recheck, withdrawal when the tab closed or selection moved, two retries of an unloaded restored tab. One navigation in flight |
| `BrowserSessionPersistence` | `createSessionSaver`, `saveRetryDelay`, adapter `restoreSession`, `saveSession`, `clearBrowsingData` | Hydration gate, change detection, one write in flight with one queued, rejected-write backoff in ticks, priming after restore and clear, writes refused while clearing |
| `BookmarksHydration` | adapter `loadBookmarks`, `refreshBookmarks`, `saveBookmark`, `checkBookmarkRecovery`, `openBookmarkRecovery` | Serial queue of refreshes and writes, one waiting refresh, read-before-write, damaged-list recovery offer reported once per episode, disposal. The list is a version number |
| `FindInPage` | adapter `openFind`, `closeFind`, `findQuery`, `findStep`, `findResult` listener, native `clearFind` | Find bar and its tab, debounced native search fenced by selected tab, native clearing on navigation and un-presenting, delayed events, closed tabs. Two tabs |
| `BrowserReviews` | `BrowserReviews.confirm`, `cancel`, `browserScreenLocked` | Two review identities, refusal of a duplicate or hidden request, approval rechecked at the click, one settlement per request, listener cleanup |
| `AddressInput` | adapter `navigate`, shared `parseBrowserAddressInput`, `browserNavigateApproved` | The shared parser verdict and the product's corrections to it: time-like, scheme-like, email and short-decimal text searched, credentials refused, approved destinations never reread. Text is a record of tested properties |
| `PasswordProviderDialog` | `openPasswordProvider`, `passwordProviderStatus`, `browserDevProfile`, `passwordProviderDocument` | Development-only provider dialog: profile admission, abortable opening, one dialog bound to its settings revision, compare-and-set edits, sample sign-in only after unlock for the selected provider |
| `BrowserSurfaceNavigation` | web `BrowserSurface.load`, `navigate`, `command`, frame `load` listener | One web-build tab: a fresh frame per host navigation, commit only from the current loading frame, stop, inner navigation, close and re-create. Three history entries, six frames |
| `BrowserSurfacePresentation` | adapter `update`, `presentBrowser`, `hide`, `blockPageInput`, `surfacePollIdle` | Show and withdraw requests sent only when changed, answers applied only for the latest request, acknowledged geometry dropped on withdrawal, one failure report per episode with resend, hidden app left alone. Two geometries, one covering-layer flag |
| `CalendarDeviceWrites` | `readCreations`, `checkCreations`, `separateCreation`, `calendarSaving`, `calendarWriteUncertain`, `deleteSelection` | creation receipts unknown/saved/acknowledged, explicit separate creation, the single write, the superseded-form fence, the per-event unconfirmed-write latch and its confirming read, inspect-then-delete |
| `CalendarAgentSelection` | `calendarSelection`, `agentSelection`, `agentSelectionKey`, `agentSelectionEpoch`, `prepareAgentSource` | inspected open event or prepared calendar source exposed to the assistant, retired by reads, close and a new form, kept across a commit to another event |
| `ReminderIntents` | `retainReminderCreation`, `checkReminderCreation`, `retireRefusedCreation`, `reconcileReminderCreations`, `retainReminderDeletion`, `acknowledgeReminderDeletion`, `reconcileReminderDeletions` | creation records pending/found within a bounded history, operation records retained before dispatch and acknowledged by receipt, read-only reconciliation, unresolvable records as witnesses |
| `ReminderTapTokens` | `checkReminderTap`, `tapBusy`, `tapRequested`, `tapInteraction` | native pending tap token, one check with a queued rerun, interaction fence, consume after the exact detail is visible, question consume or release |
| `ReminderRefresh` | `refreshReminders`, `reminderRefreshGeneration`, `pendingReminderOpen`, `reminderStale` | newest refresh publishes, device rows published when the reminder store fails, stale marking, navigation intent opened or dropped by the newest refresh |
| `BrowserAlarmRinging` | `BrowserClock.poll`, `retire`, `ring`, `allowed` | two pages, the alarm-owner Web Lock, owns/ringing, release on hide or nothing ringing, sound per ring |
| `DayAnchor` | `msToLocalMidnight`, `calendarMidnight`, `calendarFormDayShift`, `calendarDraftAnchor`, `calendarEditDraftAnchor` | local-midnight tick against row offsets, the midnight read, re-anchoring of retained and plain forms |
| `ReminderTodoAttempt` | `addTodo`, `todoDecision`, `todoAttempt`, `reminderSaving` | one reminder write at a time, readback-decided to-do save, attempt id reused by an identical retry |
| `SignInChooser` | `connectionController.signInGoogle`, `signInEmail`, `signInPhone`, `resendSignInCode`, `verifySignInCode`, `cancelSignIn`, `signInFailed`, `showGoogleMfa`, `CloudSignInPanel` | Sign-in step machine with one step in flight, the stale code step that only Resend continues, a failed resend keeping the earlier attempt, and Back during Google with and without a commit boundary so a stored key is never left behind the chooser |
| `ConnectionController` | `work`, `releaseOperation`, `manageProviderKey`, `runQueuedSignInReturn`, `runQueuedResidentRebind`, `signInReturned`, `signInIncomplete`, `showSignInIncomplete` | The single operation slot, the one queued native sign-in return, the queued sign-in-incomplete notice fenced by connection and view, the wanted rebind, and the order in which a release runs them |
| `DelegationReceiver` | `CloudDelegationPanel` (`run`, `callback`, `recover`, `cancelPending`), `delegationCancelStep`, `AlphaConnectionPlugin.captureDelegationCallback`, `readDelegationCallback`, `clearDelegationCallback` | Retained native return read under a one-step gate or deferred behind it, pending authorization moved to finishing by a code, one completion per code or status check, and Cancel that adopts, clears or cancels by Cloud state |
| `ViewAdmission` | `applyImageContacts`, `admitImageContacts`, `ENABLED_MVP_VIEWS`, `DEFERRED_MVP_VIEWS`, `refreshImage` | Runtime Contacts admission against the stored shell view: an open view leaves before it is deferred, the view order follows admission, and re-admission never restores a masked view |
| `SettingsListenerReads` | `listenerReadGate` (`beginAction`, `endAction`, `beginRead`, `readApplies`), `listenerAction`, `refreshCapabilities` | Listener status reads ordered against Pause and Turn off: none starts during an action, an older read is dropped, and the action result is always applied |
| `NotesTrashSession` | `installNotesTrashAdapter`, `runMaintenance`, `moveToTrash`, `erase`, `deleteForever`, `restore` | Single-flight Trash maintenance joined by foreground callers, one destructive action at a time, erase refused on failed storage, and permanent deletion only for the exact note a full Trash refused |
| `MediaCopyIntent` | `admitMediaCopyIntent`, `acknowledgeMediaCopyIntent`, `readMediaCopyIntent` | One pending saved-copy request: compare-and-swap admission from empty, exact acknowledgement, recovery after restart, browser revision identity versus Android token-only identity |
| `FilesRecentIndex` | `createFilesIndex().record`, `revokeTree`, `recentKey`, selection adapter `accept` and `clear`, `exportScanPdf` | Bounded Recent rows, replacement by key and by revoked folder name, grant release on eviction and Forget, grants kept for Recent on close, and the grant an exported scan leaves held |
| `PhotoLibraryAgentReview` | `createDeviceLibrary().agent.run`, `confirmReview`, `validCurrent`, `reviewCard`, `leave` | One pending assistant review over the visible library, provider validation fenced by the visit epoch, re-validation at confirm, single dispatch under repeated confirms, Android refusal of a changed item |
| `AgentPhotoRequest` | `takeRequestedPhoto`, `untilSettled`, `agentRequest` | Assistant photo request joining a preview start in flight, refusal when a recording starts first, exclusive shutter, failed only without dispatch, unknown only after dispatch |
| `CameraFocusWrites` | `BrowserCameraFocus.select`, `clear` | Per-track serialized focus writes, taps retired while waiting never reaching the driver, applied target only for the latest tap |
| `DomainDocumentCreation` | `BrowserDomainDocument.load`, `read`, `edit` | First access to a domain: empty read writes nothing, legacy bytes imported once with their baseline, first edit creates, later legacy write stops access |
| `NotesDocumentTransfer` | `installNotesDocumentAdapter`, `perform`, `receipt`, `whenVisible` | One document import or export at a time, results dropped after Notes is left, receipts held until the page is visible and shown only in their own visit |
| `BackDispatch` | `updateBackAvailability`, `alphaCanGoBack`, `backHandler`, `modalPanels`, `p.back`, `closeEdit`, `openAllApps`, `back()`, `shellNavigate`, `closeAssistant`, `stopVoice`, `handleOnBackPressed`, `showsHome`, `moveTaskToBack` | host, popover/dialog/panel/inert, view/inner/stack/chat/drawer/shade/voice, menu/homeEdit/homeAdd, outcome/closed/removed/lostLayer |
| `ChatDock` | `chatRelease`, `settleChatMotion`, `tapChatMotion`, `paintChatMotion`, `retire`, `chatDraggedAt`, `chatSheetShare`, `grabTap`, `closeChat`, `swallowed()`, `openSheet`, `toInput`, `rest()`, `chatPullBinding` | view/chat/voice, drag, swallowAge/dragAge, ghost/ghostLabel, remembered, dismissed |
| `KeyboardGeometry` | `canvasGeometry`, `keyboardFreeHeight`, `WIDE_CANVAS`, `isEditing` | portrait/keyboard/focused, baseWidth/baseHeight, free/landscape/wide/canvasWidth, primed |
| `ShellScreen` | `runBoot`, `unlock()`, `power()`, P-23 lock-frame Camera control absence, `openView(k, patch, chat, opts)`, `keepState`, `keepStack`, `goHome(chat)`, `startVoice()`, `stopVoice()`, `leave()` | screen/bootPending, view/viewTimers, secure stays false, kept, voice/voiceTimers |
| `SettingsSession` | `mergeDeviceFacts`, `scaleGeneration`, `generation !== token`, `setTextScale`, `async function refresh()` | owner/mounts, generation/scaleGeneration, queue/results, shownScale/shownOther/shownToken, writeFailed/keptSize/regressed |
| `HomeSurface` | `createHomeAgenda`, `homeAgendaCandidates`, `createStorageAccessCheck`, `selectHomeAgenda` | now/input, built/memoInput/at/until/agenda/following, storageWorks/available/probeAt/probed, rendered/checked/changedSince/selections/probes |
| `PhoneCall` | `function pnStart`, `function pnEnd`, `function pnRingEnd`, `function pnDecline`, `function pnCallId`, `function pnWant`, `PN.live`, `PN.boot`, `callWho` | live/want/callWho, boot/active, connected/min/kp/hold/ret, connectFor/tickFor, started/ended/rings/ringRows/accepted/dropped/orphaned |
| `PhoneRecents` | `installPhoneAdapter`, `available`, `clear`, `sync`, `async function refresh`, `async function dial`, `epoch`, `needsAccess`, `createAospTelephony`, `normalizePhoneNumber` | mounted/phoneView/hidden/active, epoch/busy/rows/needsAccess/notice, access/reads/dials, requests/prompts/discarded/handoffs |
| `InertHold` | `holdPhoneInert`, `released`, `previous`, `createInlineModal` | inert/previous/count, holding/released, outside |
| `ShadePull` | `installSystemShade`, `expandAndroidShade`, `alphaShadeAsking`, `shadePortWithin`, `SHADE_REQUEST_TIMEOUT`, `alphaOverflowPull`, `installOverflowPull`, `openSystemShade`, `simulatedShade` | surface, mounted/home/secure/listening, asking/waiting/late, standIn/requests/fallbacks/opened/ignoredPulls |

## Notes lifecycle modes

`NotesLifecycle` starts either the legacy local Trash/CAS contract or a canonical
resident Notes contract. The canonical mode has one existing note, one editor
draft, one current owner, a distinct foreign callback identity and two successive
folder identities. Three read generations and two writes bound the exploration.
The legacy mode retains eight storage, queued-write, retained-draft, deletion and restore scenarios.

Canonical scenarios exercise owner retirement, superseded reads, clean and dirty
refreshes, selection validity and edits typed during a pending save. A queued save
captures the edit version that requested it. Only an acknowledged write can start
that captured newer edit automatically. An uncertain write keeps the draft for
review, while a subsequent explicit save remains available through the public
editor API. Read completion and a coalesced invalidation's next refresh are
separate model actions.

The folder contract uses document identity as its compare-and-exchange revision.
Rename keeps a folder ID. Deletion leaves the note's stored reference intact and
projects it as unfiled. A newly created folder has a distinct ID and cannot adopt
that reference. Rich authored values, folder names and content are equality
classes. New-note creation, canonical Trash operations and complete implementation
refinement remain outside this bounded variant.

## Trace conformance

`test/quint-conformance.test.mjs` generates ITF traces directly from the pinned
Quint implementation and checks corresponding real TypeScript entry points for
permission denial/restart, private-tab persistence, large-text layout and draft
conflicts. It also compares every one of the 240 finite voice-deletion evidence
combinations from a Quint-generated table with the actual TypeScript planner.
The delegation-return cases execute the real page script in an isolated DOM and
compare its URL clearing and link exposure with Quint traces.
These checks exercise selected contracts. General implementation refinement
remains unproved.

## Bounds and exclusions

`DeviceActionReview` replays the real coordinator with recording transport,
journal, preference and executor ports. Thirty-six schedules include exact-screen
changes (also for the direct pass), foreign owners, expiration before approval and
after the claim, double taps, failed reservation/decision/claim, changed digest or
journal identity, cancellation before and after dispatch, unsynced receipts, a
terminal journal refusing replay after coordinator recreation, and the direct
pass: ask-first, an unreadable preference, an old request, a reviewed type, a
workflow-bound step that is never listed, `open_view` to Settings beside an
operation outside the contract, five current-request notes of which four run, a
failure that ends the pass, a mixed listing with one automatic Browser open, a
Browser proposal without a matching typed address or without request proof, and
a second pass for the same message. Port calls, each `allowed` call and
public-method settlement are observation boundaries; the pass counters are
inferred from those and asserted against the returned receipts. Context changes
before approval are compared exactly; host retirement during approval is supplied
through its AbortSignal. Crypto hashing is real and time is held constant across
each synchronous port observation.

Known divergence, kept visible rather than weakened: the intended rule
`UnknownOnlyAfterDispatch` is false of the pinned coordinator. A reservation,
decision or claim failure returns `unknown` from the public call although nothing
was dispatched (app review AGENT-06; the journal itself records `failed` or stays
reserved, so `UnknownJournalOnlyAfterDispatch` holds). The manifest lists it under
`expectedViolations`, requires the witness `UnknownWithoutDispatch`, and six
replayed schedules reproduce it. A product executor that throws for a pre-effect
guard after it was entered is likewise journaled `unknown`; that is executor
behaviour outside this model's ports. Remove the registration when the shared
coordinator answers `failed` for a not-dispatched attempt.

Camera, Files, Photos, Notes-organise and SMS-reply direct types, workflow-run
review, navigation-only review destinations, domain-specific result validators,
Files identities, capability negotiation and native persistence remain separate
obligations. `Application.ReviewedDispatch` is scoped to the review-first path;
it must not be used to infer that current-request execution requires a second
user tap.

The per-view agent modules `BrowserAgentOpen`, `CameraAgentCapture`,
`FilesAgentActions`, `NotesAgentSource`, `CalendarAgentWrites` and
`MapsSelectedRead` are model-only: their rules were read from the listed
sources at the pinned revision and no refinement adapter drives that source.
They add the view-specific admission each operation needs on top of the
proposal custody that `DeviceActionReview` replays against the real coordinator.
Each known divergence between an intended rule and the code is kept as a named
property outside `safety`, listed under `expectedViolations` in the manifest,
with its counterexample required as a witness by the default gate:
`BrowserAgentOpen.OpenedClaimMeansShown`, `CameraAgentCapture.ShutterNeverCovered`,
`NotesAgentSource.ReviewFirstCoversCanonicalNotes`,
`CalendarAgentWrites.UnknownOnlyAfterNativeCall` and
`MapsSelectedRead.UnknownOnlyAfterRead`. Photos agent operations are not modeled:
the Photos view capability is not negotiated by `phone-context.ts`, and the
pinned server device-action contract, action, service and tools files name no
`photo_library_*` operation, so no such proposal can reach the phone.

`CalendarApprovalReview` executes the actual typed client and parsers over
controlled authenticated transport. Twenty-nine schedules cover exact-object
and immutable-byte admission, copied and foreign rows, expired and terminal requests, matching finite
results, malformed receipts, a concurrent tap, lost reply, AbortSignal and owner
retirement including A–B–A. Same-object field mutations cannot authorize a changed
request, and a post-dispatch mutation cannot change the captured receipt identity.
A row that names another owner may be displayed as
unverified, but cannot authorize a decision. The DOM review's second read and
presentation comparison, server revision CAS and Calendar effects have separate
tests; client dispatch evidence does not establish a provider change.

Record bodies, message text, byte hashes, provider IDs and time values use finite
equality classes. A counter distinguishes old and current callbacks and is never
wrapped into a reused generation. The event loop can stutter. Real encryption,
provider behavior, OS scheduling, network transport and human action arrive as
environment inputs and require separate acceptance evidence.

`Application` projects the shared ownership and lifecycle contract explicitly.
The other modules decompose domain state so each can be explored independently.
The complete Cartesian product of all domain variables is not enumerated by
these checks. The inventory records domain allocation, not a proof that every
source variable or every possible implementation behavior refines its model.

`AccessibleToastLifetime` checks native timeout refresh ownership and the shell's toast timer replacement and expiration.

## Alpha OS defaults and first-run staging

`OSDefaults` covers one-time layout persistence and existing permission choices.
The Java policy matrix separately checks the exact installed package, Home role,
system installation and requested permission predicates. `OSProvisioning` covers
three request generations, late callbacks, authority loss, preserved keyboard
selection and explicit appearance application. `OSSourceStaging` separates
all-file admission, preserved preimages, partial failure and final readback.

The source cache contains hash-verified AOSP baseline inputs, not authored
application code. `.cache` is excluded from the source inventory; the staging
and policy tests verify those inputs. Models use finite layout classes and
serialized persistence steps. Eventual completion assumes stable eligible state
and fair successful callbacks/writes; permanent platform or I/O failure stays
open. These checks do not prove an image boot, update, rollback or device UX.
