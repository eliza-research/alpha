# Application state models

These modules describe the current product shell and its storage and review
boundaries. The exact entry-point paths are recorded in `manifest.json`. The
repository-wide allocation and source hashes are recorded in `../coverage.json`.

| Module | Source symbols | Modeled state and abstraction |
| --- | --- | --- |
| `Application` | `AlphaClient.attachVerifiedTransport`, `disconnect`, `setViewContext`, native startup/reset gates | Two owners, three non-reused epochs, lifecycle, sensitive observation, pending work, reviewed dispatch, voice and owner-scoped visible cache |
| `ShellNavigation` | `ViewNavigationClient.capture`, `deliver`, `cancel`, shell `back`, `goHome`, `openView` | All 19 `AlphaView` values, modal/shade/composer ordering, focus, draft and one completed-action claim. View-specific record bodies use their domain models |
| `StartupPermissions` | `createStartupPermissionFlow`, `readStartupPermissionMemory`, `readStartupPermissionProgress`, `writeStartupPermissionProgress` | One representative permission transaction, seven ordered native setup steps, durable prompt attempt and progress, legacy completed installation |
| `PermissionWalkthrough` | `StartupPermissions.allow`, `advance`, `finish`, `savedProgress` | Seven independent permission maps, owner/sequence fences, read-only reactivation, targeted Settings review, durable choices and historical completed records |
| `AssistantConversation` | `AlphaClient.run`, `send`, `approve`, `cancel`, `replaceAssistantDraft` | One foreground request and one proposal identity, consumption before dispatch, automatic-workflow survival across ordinary navigation, sensitive-view cancellation, compare-and-exchange composer draft |
| `NotesLifecycle` | Legacy `editNotesTrash`/`planNotesTrash`, canonical `NotesController`, `NotesEditor`, `NotesSnapshotState`, `CanonicalNotesUi` and the Notes folder document | Separate legacy Trash/CAS and canonical owner/read/write generations, dirty-draft preservation, queued edits, uncertain writes, current selection, stable folder identity and deleted-folder projection |
| `CanonicalNotesFeedback` | Canonical Notes UI, controller and editor callbacks | Read errors, save review and uncertain mutation outcomes |
| `CanonicalNotesMutation` | Prepared shared Notes editor and the Alpha host binding | Save-before-delete, queued edits, restore and owner fencing |
| `CanonicalNotesView` | Canonical Notes UI collection and navigation | Draft projection, Trash, owner visibility and navigation waiters |
| `DurableStore` | `BrowserDomainDocument.load`, `edit`, `capture`, `restore`, `reset` | One document transaction, two distinct revisions, preserved legacy bytes, corrupt metadata, explicit recovery and persistence failure |
| `BrowserSession` | `browsingSnapshot`, `restoreBrowsing`, native `BrowserSessionStore` | Two normal tabs and one private tab, history privacy, pristine restore, navigation epoch. URL parsing, cookie machinery and actual WebView execution retain their implementation contracts |
| `CredentialVault` | `passwordSurfaceOpen`, `refresh`, `locked`, `clearSecrets`, native origin-bound autofill | One ephemeral secret, lock/foreground/generation, origin review, damaged-vault confirmed fresh-unlock reset and immutable test-only transfer admission. Native encryption and authentication are external inputs |
| `DevelopmentSurfaces` | `testMocksEnabled`, `devSurfacesEnabled`, `mock-admission`, browser profile selection | Compile-time switch combinations, explicit fixture/remote/tool admission and separation of synthetic events |
| `DevelopmentDevice` | Prototype call functions, browser incoming-event and location simulators | Mock-only call screening, voicemail, mute/speaker, message/notification counts, route position and explicitly simulated payment state |
| `DevelopmentHost` | `createBrowserCloudDevHandler`, `createCloudResidentHost`, local launcher scripts | Private credential claims and serialized replacement, active request fencing, resident binding/expiry and coordinated child-process shutdown |
| `PermanentVoiceDeletion` | `planInterruptedPermanentDeletion`, `leasedDeletionRow`, `claimDeletion`, `changeAudioDeletion` | Separate note and recording effects, exact ownership, external references, shared-lock/renderer-lease admission, restore versus erase and interrupted recovery |
| `DraftDispatch` | `AssistantDraftController.hold`, `release`, `commit`, `open` | Text retained through dispatch, newer typing, per-conversation queues, reopened pending drafts and failed durable clears. `A+B` represents the ordered newline concatenation |
| `FilesTree` | Current volume browser, `files-storage`, `files-agent-contract`, `StorageBrowser` and `StorageCatalog` | Categories query storage, collisions keep both files, Trash retains origins, refresh prunes missing selections, agent moves check reviewed identity and permanent deletion requires review |
| `FilesBrowserController` | Prepared shared Files browser installed by the Alpha host | Folder read generations, access and volume readback, agent share admission and stale completion |
| `FilesFilter` | Prepared Files browser agent runner and shared matching | Filter admission, access readback, query ownership, result counts and cancellation |
| `PhotosWindow` | Native catalog reads in the Alpha Photos adapter and shared window helper | Paginated window merge, reload coalescing and hidden/disposed read fencing |
| `PhotosTrash` | Native Trash reads in the Alpha Photos adapter | Coalesced pagination, resume reload and stale completion fencing |
| `CalendarPresentation` | `calendar-views`, `calendar-month-focus`, Google Calendar selection | Selected month/day, menu/delete/search Back order, query-range generations, visible calendars and captured edit identity |
| `CanonicalCalendarDraft` | Canonical Calendar editor and shared durable draft | Bound slot ownership, stale reads/writes, held clears, same-account replacement and recovery |
| `AgentCalendarRefresh` | Current Agent Calendar read controller | Range and session fencing, coalesced readback, legacy gate and next-event freshness |
| `GoogleConsentAdmission` | Mounted Google connections panel and shared Gmail grant rules | Verified account readback, preserved Gmail tier, stale permission continuation and revoke readback |
| `NotificationCollection` | `notification-store`, `notifications-adapter`, `AlphaNotificationListener` | Opt-in external collection, package/signature/preview consent, lock privacy, history expiry, policy epoch and independent app/channel delivery settings |
| `FilesAndSharing` | `reviewFileEmail`, `reviewMailAttachment`, `mediaCopyIntent`, share adapters | One exact source, owner and draft identity, initially unchecked selection, reread before local insertion, cancellation and revoked grant. Send has its own Inbox model |
| `PreferencesAndPresentation` | `keyboardFreeHeight`, `canvasGeometry`, `surfaceLayout`, `publishSurfaceLayout`, shell preferences | Representative portrait/wide geometry, keyboard exclusion, large-text fallback, preference readback, draft/selection continuity and one system shade |
| `HomeFailureNotice` | Home host and the shared installed launcher | Launch and inventory failure notices, surface ownership and duplicate suppression |
| `LauncherOwnership` | Shared launcher and system bridge | Inventory and default read generations, exact component/profile handoff and retired launch fencing |
| `LauncherObserver` | Shared launcher watcher and system bridge | Package and document events, refresh debounce, late listener settlement and idempotent retirement |
| `LauncherFavorites` | Shared mobile launcher and Alpha view registry | Ordered favorites, legacy migration, storage refusal, external choice ownership and visible reordering |
| `HomeGesture` | Alpha Home adapter and shared launcher | Pointer ownership, held and dragged activation, keyboard focus and edit-layer retirement |
| `DrawerInteraction` | Mounted Alpha Apps drawer | Current press, query and menu identity, focus restoration and exact App Info handoff |
| `CallbackLanding` | Static delegation-return page | Query multiplicity, state shape, result exclusivity, size/description limits, early URL scrubbing and exact app-link exposure |
| `ListFocus` | `createKeyedListFocus`, current Notes/Photos bindings | Two captures and roots, semantic identity, focus movement, discarded renders and current visibility |
| `RendererFailureUI` | `RootErrorBoundary`, global startup recovery and shared crash classification | One recovery surface, fixed diagnostic classes, modal retirement and explicit reload |

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
`test/quint-coverage.test.mjs` rejects missing models, missing source
allocation, changed hashes and inconsistent source links. These checks exercise
selected contracts. General implementation refinement remains unproved.

## Bounds and exclusions

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
