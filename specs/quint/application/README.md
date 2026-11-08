# Application state models

These modules describe product shell, storage and review contracts. Current-main
refinement is partial, and the source-bound adapters list their remaining
field and transition obligations. The exact entry-point paths are recorded in `manifest.json`. The
repository-wide allocation and source hashes are recorded in `../coverage.json`.

| Module | Source symbols | Modeled state and abstraction |
| --- | --- | --- |
| `Application` | `AlphaClient.attachVerifiedTransport`, `disconnect`, `setViewContext`, native startup/reset gates | Two owners, three non-reused epochs, lifecycle, sensitive observation, pending work, reviewed dispatch, voice and owner-scoped visible cache |
| `ShellNavigation` | `ViewNavigationClient.capture`, `deliver`, `cancel`, shell `back`, `goHome`, `openView` | All 19 `AlphaView` values, modal/shade/composer ordering, focus, draft and one completed-action claim. View-specific record bodies use their domain models |
| `StartupPermissions` | `createStartupPermissionFlow`, `readStartupPermissionMemory`, `readStartupPermissionProgress`, `writeStartupPermissionProgress` | One representative permission transaction, durable or failed prompt-attempt persistence and legacy completed installation |
| `PermissionWalkthrough` | `StartupPermissions.allow`, `advance`, `finish`, `savedProgress` | Seven native or four browser permission steps, independent platform-call/UI ownership, sequential and targeted review, cancellation, owner invalidation, final readback and historical completion records |
| `AssistantConversation` | `AlphaClient.run`, `send`, `approve`, `cancel`, `replaceAssistantDraft` | One foreground request and one proposal identity, consumption before dispatch, automatic-workflow survival across ordinary navigation, sensitive-view cancellation, compare-and-exchange composer draft |
| `NotesLifecycle` | `editNotesTrash`, `planNotesTrash`, Notes document adapter and secure store | One representative note, opaque record content, dirty draft, revision conflict, write-ahead Trash, three-day boundary, restore and storage failure |
| `DurableStore` | `BrowserDomainDocument.load`, `edit`, `capture`, `restore`, `reset` | One document transaction, two distinct revisions, preserved legacy bytes, corrupt metadata, explicit recovery and persistence failure |
| `BrowserSession` | `browsingSnapshot`, `restoreBrowsing`, native `BrowserSessionStore` | Two normal tabs and one private tab, history privacy, pristine restore, navigation epoch. URL parsing, cookie machinery and actual WebView execution retain their implementation contracts |
| `CredentialVault` | `passwordSurfaceOpen`, `refresh`, `locked`, `clearSecrets`, native origin-bound autofill | One ephemeral secret, lock/foreground/generation, origin review, damaged-vault confirmed fresh-unlock reset and immutable test-only transfer admission. Native encryption and authentication are external inputs |
| `DevelopmentSurfaces` | `testMocksEnabled`, `devSurfacesEnabled`, `mock-admission`, browser profile selection | Compile-time switch combinations, explicit fixture/remote/tool admission and separation of synthetic events |
| `DevelopmentDevice` | Prototype call functions, browser incoming-event and location simulators | Mock-only call screening, voicemail, mute/speaker, message/notification counts, route position and explicitly simulated payment state |
| `DevelopmentHost` | `createBrowserCloudDevHandler`, `createCloudResidentHost`, local launcher scripts | Private credential claims and serialized replacement, active request fencing, resident binding/expiry and coordinated child-process shutdown |
| `PermanentVoiceDeletion` | `planInterruptedPermanentDeletion`, `leasedDeletionRow`, `claimDeletion`, `changeAudioDeletion` | Separate note and recording effects, exact ownership, external references, shared-lock/renderer-lease admission, restore versus erase and interrupted recovery |
| `DraftDispatch` | `AssistantDraftController.hold`, `release`, `commit`, `open` | Text retained through dispatch, newer typing, per-conversation queues, reopened pending drafts and failed durable clears. `A+B` represents the ordered newline concatenation |
| `FilesPreview` | `installFilesBrowserAdapter`, `storageSelect`, `onLeave` | One current per-volume preview callback, non-reused owner epochs, late selected-capability release and leave/return fencing. Full Files browser state remains an explicit obligation |
| `CalendarPresentation` | Current `calendar-form-draft` plus partially retained presentation contract | Creation identity and authority-free draft restoration have current source traces. Removed Google display toggles and old range-loader behavior remain unrefined, pending a separate current Calendar UI model |
| `NotificationCollection` | `notification-store`, `notifications-adapter`, `AlphaNotificationListener` | Opt-in external collection, package/signature/preview consent, lock privacy, history expiry, policy epoch and independent app/channel delivery settings |
| `FilesAndSharing` | `reviewFileEmail`, `reviewMailAttachment`, `mediaCopyIntent`, share adapters | One exact source, owner and draft identity, initially unchecked selection, reread before local insertion, cancellation and revoked grant. Send has its own Inbox model |
| `PreferencesAndPresentation` | `keyboardFreeHeight`, `canvasGeometry`, `surfaceLayout`, `publishSurfaceLayout`, shell preferences | Representative portrait/wide geometry, keyboard exclusion, large-text fallback, preference readback, draft/selection continuity and one system shade |
| `CallbackLanding` | Static delegation-return page | Query multiplicity, state shape, result exclusivity, size/description limits, early URL scrubbing and exact app-link exposure |
| `ListFocus` | `createKeyedListFocus.capture`, committed ref callbacks, queued expiry and restoration | Two render captures, two root identities, five DOM nodes, FIFO microtasks, generation fencing, intentional focus movement and visibility/identity guards |

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

`RendererFailureUI` models global startup recovery and the React root boundary,
including panel ownership, modal dismissal, focus, reload requests and bounded
class-only logging. Its source driver and Chromium regressions are described in
[the recovery refinement notes](../refinement/application/recovery-ui.md).

`FilesTree` and `ListFocus` are retained under the legacy family after current
main removed their source protocols. Their historical results do not establish
current Files browser or mutable-list refinement. The current reconciliation
status and required controller work are listed in
[the application gap report](../refinement/application/current-main-gaps.md).
