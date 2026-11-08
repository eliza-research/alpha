# Browser storage

The browser MVP must retain every committed change and its matching receipt across
tabs, reload and cancellation. Web Locks around localStorage do not establish that
property: the retained rapid-edit regression reproduced a lost WebKit update.
The browser document store admitted from upstream uses IndexedDB transactions and
revision compare-and-swap. Atomic first imports preserve one revision across concurrent
readers. Alpha supplies domain names and legacy recovery policy.

## Domain contracts

| Domain | Source integration | Behavior and verification scope |
| --- | --- | --- |
| Calendar | `browser/calendar-store.ts`; async Calendar and digest reads; revision-checked backup/reset and reviewed event-copy restore with explicit partial recovery of valid independent events and series groups; cross-tab refresh | Creation/recovery, queued-read cancellation, transaction abort and stable-read-revision browser suites; domain import/recovery unit tests. |
| Hosted digest result notices | `browser/hosted-results.ts`; durable rows and pending-tap token move together; cross-tab notice invalidation | Hosted-result browser suite covers notice flows, duplicate publication, pending taps and failed IndexedDB writes. |
| Media saved-copy request | `runtime/media-copy-intent.ts`; transactional admission and exact cleanup for photo/video copy receipt recovery | Cancelling before dispatch clears only its own request. Recovery preserves legacy bytes and never deletes or recreates media. |
| Workflow client pending requests | `runtime/workflow-intents.ts`; captured account document, atomic admission and exact acknowledgement for run, metadata, lifecycle and approval requests | Legacy request bytes remain recoverable; reset does not replay or undo effects. Concurrency and lifecycle cases belong to the owning browser suite. |
| Owner-bound workflow drafts | `browser/workflow-drafts.ts`; awaited reads and serialized expected-value updates | Workflow-authoring browser suite covers two-tab conflicts and owner changes during pending reads. |
| Reminders and alarms | `browser/reminder-store.ts`; `browser/daily.ts` readers, writes and operation receipts; Calendar/Clock cross-tab refresh; shared backup/reset UI | Empty and unchanged polling retains document revisions. Owning Chromium and Firefox suites cover concurrent writes, atomic receipts, stale resets and interrupted recovery. Alert-sound history has its own migration and recovery boundary below. |
| Reminder creation and action history | `browser/reminder-creation-document.ts`, `browser/reminder-action-document.ts`; shared JSON archive handling over canonical documents | Pending creation, edit, cancellation, completion and snooze identities survive uncertain outcomes. Expected-value acknowledgement refuses replacement records. Separate backup/reset controls never replay actions or undo their effects. Android retains secure compare-exchange. |
| Notification policy, access and history | `browser/notification-store.ts`; policy, device events and redacted history migrate together; reminder delivery and workflow-focus epoch readers await canonical policy | Preserves the active v2 or older partial v1 source for backup/reset. Unchanged reads retain authority and document revision. First reads serialize initialization across tabs. Chromium and Firefox suites cover concurrent initialization, backup/reset, failed writes, and external/focus/Calendar/hosted-result cancellation before and after commit. |
| Workflow notifications | `browser/workflow-notices.ts`, `browser/workflow-history.ts`; async canonical list/history/export and transactional delivery/compaction receipts | Owning history, lifecycle and receipt suites cover stale compaction (including identical-byte restoration), cancellation, concurrent publication and canonical/changed-legacy backups. Changed workflow callers have integration coverage; current-source hosted and engine qualification remain separate gates. |
| Development agent conversations | `browser/development-agent-document.ts`; conversations, scripted replies and message receipts migrate together; protocol, workflow and digest consumers await canonical reads; selected-profile backup/reset | Queued account changes, Home cancellation, two-tab messages, receipt rollback and malformed backup/reset are exercised by the owning browser cases. Real local-agent host data uses its separate runtime store. |
| Development workflows, action proposals and receipts | `browser/development-execution-document.ts`, `browser/development-workflows.ts`, `browser/development-actions.ts`; one owner document for both execution parts | Admission checks read workflow and proposal state from the same transactional snapshot. Captured old-owner journals can finish existing receipts after retirement, but cannot reserve or begin another action. Backup/reset retains or clears both parts together. |
| Development digest execution | `browser/development-digest-document.ts`, `browser/development-digests.ts`; grants, sources, loops, results and acknowledgements in one owner document | Empty/unchanged schedule polling does not create records or advance recovery revisions. Occurrence markers and output cursors commit with results. Read-only lists await canonical data, and late operations recheck connection ownership. Selected-profile backup/reset is available. |
| Development digest authorization UI | `browser/digest-authorization-document.ts`, `browser/digest-delegation-ui.tsx`; owner-scoped pending request with expected-value saves and cross-tab invalidation | Exact legacy bytes remain available for backup; unreadable requests disable new authorization until recovery. Closing or backgrounding the panel aborts pending work while retaining durable requests for recovery. Revision-checked reset does not revoke completed grants. |
| Development digest inbox | `browser/digest-storage.ts`; one account-scoped document containing the result index, saved results and pending request slots; selected-inbox backup/reset in Scheduled digests | Exact older slot bytes are retained inside a JSON archive. Expected-value writes remain serialized; late reads and recovery are bound to the connection. |
| Development Cloud setup | `browser/development-cloud-document.ts`, `browser/development-cloud.ts`; one provisioning document per sample account, shared quote/receipt protocol, selected-account backup/reset | Reads and mutations recheck the captured account session. Atomic edits preserve provisioning receipts, refuse stale quotes and retain exact legacy backups. Empty reads do not claim a revision. |
| Real Cloud setup intents | `runtime/cloud-personal-intent.ts`, `runtime/connection-ui.tsx`; browser owner-scoped activation/cutover intent with revision-bound admission and acknowledgement | Status queries capture the prior intent; late responses cannot clear a replacement request. Failed first writes prevent dispatch; cancelled undispatched admissions can clear only their own revision. Exact legacy backup and reviewed reset are available. Android retains its renderer slot and now compares the expected intent before updates. Real-provider qualification remains a separate gate. |
| Development Cloud account selection | `browser/development-account-document.ts`, `browser/development-identity.ts`; canonical account/session document, invalidated identity snapshot, async admission and restore | Selection publishes only after a committed write. Canonical checks reject stale sessions even without a cross-tab event; delayed hydration cannot replace a newer selection. Exact legacy bytes, malformed-state backup and revision-checked reset remain available. Captured old journals may finish existing receipts but cannot admit new effects. |
| Conversation restart choices | `runtime/conversation-selection.ts`, history restoration and new conversation creation in `runtime/connection-ui.tsx` | Atomic owner-key updates retain other owners, unique revisions refuse stale same-owner completion, and queued writes recheck connection authority. Exact legacy bytes and browser backup/reset are retained. Active chats stay tab-local until retirement. Owning cases cover competing owners, stale same-owner completions, queued cancellation, recovery and history restoration. Native storage keeps its installed format; native and full-product qualification remain separate. |
| Device preferences and roles | `browser/device-preferences.ts`, `browser/device.ts`; canonical writes/readback, ordered cache hydration for synchronous rendering/audio, asynchronous sensor admission and role documents | Unavailable settings keep recovery reachable, mute audio and disable sensor access. Device/storage suites cover ordered hydration, concurrent changes and cancellation during settings or location reads. Simulated battery, network, sensor and role values are used only in test-mocks builds; without the switch the browser device reports real facts (Battery Status API where offered, `navigator.onLine`), omits uptime and transports, and its role methods reject. |
| Browser saved tabs and history | `browser/preference-documents.ts` `alpha.browser.session.v1` (development surface), `BrowserSessionStore` on Android; normal tabs (last committed address, title) and history only, never private tabs | Product decision: tabs keep sign-ins and restore after a cold start. `browser-signins.spec.ts` covers restore, private exclusion and confirmed Clear browsing data. The development frames are sandboxed with opaque origins and keep no cookies; Android site data is covered by native instrumentation. |
| Browser bookmarks and notification sound history | `browser/preference-documents.ts`; awaited bookmark reads/writes, cross-tab bookmark refresh and transactional sound claims; separate backup/reset controls | Clock/storage suites cover bookmark refresh, sound receipts and recovery. Empty reads and unchanged sound polling do not initialize records; older bytes remain available for backup. |
| Development password provider | `browser/password-provider.ts`, `browser/preference-documents.ts`; asynchronous device status, canonical provider selection, cross-tab retirement and backup/reset | Provider lifecycle, storage and compact large-text suites cover pending dialog cancellation, retired sample fills and recovery. This is the development sample provider, not real Proton credentials or native autofill acceptance. |
| Photo albums | `prototype/browser-camera.ts`, `browser/preference-documents.ts`; canonical album names/membership and revision checks, cross-tab catalogue refresh, exact-byte backup/reset | Album/storage suites cover concurrent creation, cross-tab refresh, failed writes and stale recovery. Saved media remains in its existing IndexedDB database; album reset does not delete photos/videos. Album metadata and media bytes are separate transaction domains. `alpha.browser.albums.v1` holds album names and media membership; photo/video payloads already use a separate IndexedDB store. |

This table describes implemented contracts and test scope, not a consolidated passing
report. Consult revision-bound results using the [verification guide](verification.md).
It covers the canonical browser domains, not every localStorage key.
The preference contracts and native Clock gap below cover independent stores;
[simulator ownership](#development-simulator-ownership) and
[Notes and audio deletion](#notes-and-audio-deletion) describe their separate
boundaries. Do not change a writer while leaving its synchronous reader pointed
at retired bytes. Never add a writable localStorage mirror to make fixtures pass.

## Independent preferences

These single-value preferences deliberately use last-writer-wins storage. They
are not multi-record operation journals and do not inherit IndexedDB transaction
guarantees. Credential storage remains separate from renderer preferences.

| Domain | Current contract | Owning browser suites |
| --- | --- | --- |
| Connection selection and Cloud environment (`runtime/connection-ui.tsx`) | In normal and development browser use, another tab's preference change cancels pending connection work and retires the affected target without writing over the winner or starting another login. Cloud-environment changes detach Cloud services and the Cloud agent, leaving an independent local/remote agent intact. Offline selection and storage clearing also detach Cloud services. Late authentication cannot reopen a retired chooser. | `connection-preference-storage.spec.ts`; synthetic identity boundary, independent tabs and delayed completions. No provider requests or native credential qualification. |
| Appearance (`prototype/settings-adapter.ts`, `alpha.appearance.v1`) | Storage events, removal, clearing and page restoration refresh the visible theme without echoing external reads as new writes. Malformed bytes remain untouched while the UI uses light mode. Explicit theme previews stay independent. Failed writes retain the session theme and its persistence error. | `appearance-storage.spec.ts`; independent tabs, rapid writes, remove/clear, malformed values, previews and write failure. |
| Development location (`browser/location-simulation.ts`, `browser/location.ts`) | A validated complete snapshot is written and read back. Changes cancel pending prompts and invalidate delayed permission reads; compatible coordinate watches receive the new fix. Unreadable settings retire watches with UNAVAILABLE and reject late fixes. | `dev-location.spec.ts`, `location-settings-recovery.spec.ts`; settings changes, pending sensor cancellation, late callbacks and recovery. No physical GPS or Android permission qualification. |

The location editor opens even when saved JSON is empty, malformed or
structurally invalid. It offers an exact UTF-8 backup and leaves the original
untouched until explicit replacement confirmation. Every field is validated;
edits require fresh confirmation. The editor refuses a changed starting snapshot,
and navigation or write failure preserves the original. If saved Maps places
cannot be read, place selection is disabled while existing Home/Work bindings
remain intact. The starting-value check is not an atomic cross-process
compare-and-exchange operation.

## Test-mocks switch and renderer keys

Builds without `ELIZA_DEV_ALLOW_TEST_MOCKS=1` read none of the development keys
(`alpha.dev.location.v1`, `alpha.dev.app.<view>`, the `alpha.browser.agent.*`,
`alpha.browser.cloud.*`, `alpha.browser.digests.*` and `alpha.browser.workflows.*`
development documents), and the development location editor is not shipped. When the
switch is off, startup rewrites a saved `{kind:'mock'}` connection selection to
`{kind:'none'}` once and opens the chooser, a stored `staging` Cloud service value is
treated as signed out, and a Clock request made in mock mode fails closed without
writing handoff history or opening Clock. These are migration rules for older saved
state, not new storage domains.

## Local problem log

`runtime/crash-log.ts` keeps failure classes only: renderer failure kind
(`render`/`startup`/`uncaught`) and error class name, never messages, stacks, URLs or
content. The web build stores them in `alpha.crash-log.v1` in this browser profile (best
effort: 50 entries, 30 days, unreadable bytes read as empty and storage failures are
ignored). Android keeps the log natively in the shared `plugin-native-system`
`crash.CrashLog` (no-backup `crash-log/v1.json`, the same installed path), adding uncaught exception classes and Android's recorded process
exit reasons (`getHistoricalProcessExitReasons`, Android 11+). Settings > About shows
it, and Export diagnostics (`runtime/diagnostics-export.ts`) shares or saves an
allowlisted JSON report (versions, pin, runtime hashes, permission and role state,
recent failure classes) with no content, keys or account identifiers.

## Native Clock handoff history

`prototype/clock-adapter.ts` uses the existing encrypted Android storage API for
`clock-handoff:v1:device`. A reviewed request captures the displayed history;
compare-and-exchange and readback must confirm its admission before Clock can
open. A conflicting update or failed retention prevents dispatch. After the
awaited admission, the UI rechecks review ownership, visibility, mode and time
zone. Retired requests are recorded as undispatched failures. Completion can
replace only its exact admitted record; a lost native response remains unknown.
No history read or recovery automatically replays a handoff.

The previous `alphaphone:clock-handoff:v1` bytes are retained verbatim in the
encrypted envelope and left untouched in localStorage. Later changes to that
retired source or unreadable history block new handoffs rather than discarding
an uncertain result. The record represents the latest reviewed handoff, not an
alarm database or proof that an alarm exists. The browser path opens its
simulated Clock directly; mock requests do not write native history.

The record rules (exact validation, stale-snapshot refusal, the older-build legacy
copy check and readback confirmation) are the shared
`@elizaos/plugin-assistant/device-clock-review` Clock handoff history;
`apps/app/src/runtime/clock-handoff-history.ts` binds it to Alpha's slot and
legacy key. `scripts/test-clock-handoff-flow.mjs` covers competing admissions, lost writes,
retained old bytes, late completion, duplicate clicks and retirement during an
awaited save. Android Clock fixtures observe encrypted completion and refuse to
delete changed or unobserved records. Those fixtures require current-source
native execution; host tests and APK compilation alone do not qualify Android
Keystore, process death or real Clock behavior.

## Android browser site permissions

The Android browser's camera, microphone and location decisions are decided by
upstream `BrowserSitePermissions` at the pin: the persistent profile only (a private
tab asks every time and stores nothing), at most 200 origins with the oldest dropped
first, and decisions cleared with the site's data or all browsing data. The prompt plan
is upstream `BrowserSitePrompt`: only a secure top-level page asks, for its own origin;
only the selected, shown page may prompt or use a stored Allow; a kind the app cannot
hold is refused with a notice. The sealed records are upstream `BrowserSessionStore`
(session and `permissions` preferences, `BrowserSitePermissionRecord` format) and
`BrowserBookmarkStore`. Alpha supplies only its installed-data names in
`AlphaBrowserStores`: the `alpha-browser-session` and `alpha-browser-bookmarks`
preference files and their `-v1` Android Keystore aliases, so records written by
earlier builds are read as they are. The stored format did not change
(`{"https://host[:port]":{"camera":true,...}}`, oldest origin first); an origin or kind
the upstream class does not recognize, or a damaged record, grants nothing and the site
is asked again. The prompt dialog, the single open-prompt slot and the chain from an Allow
to Android's runtime permission are the shared tab host's (`BrowserTabHostPlugin.sitePermission`
in plugin-native-browser-surface); `AlphaBrowserPlugin` extends it under Alpha's Capacitor name.

The rest of Alpha's installed browser identity is `AlphaBrowserStores.IDENTITY`
(`BrowserTabHostConfig`): the persistent normal-tab profile `alpha_browser_v1` (website
sign-ins), private profiles `alpha_private_<namespace>_<tab>`, leftover pre-P-04
`alpha_public_*` profiles, and the `alpha-browser` storage prefix from which the shared host
derives the installed `alpha-browser-downloads`, `alpha-browser-retired-profiles` and
`alpha-browser-notices` preference files and its activity-result keys. Keeping these names
is what keeps an existing install's sign-ins, download history and private-profile cleanup
ledger after the tab host moved upstream; nothing is migrated.
`test/browser-site-permissions.test.mjs` runs the upstream record test (allow, deny, a
damaged store, the 200-origin bound) on the host JVM against the pinned sources; it does
not exercise WebView prompts or the Keystore. `BrowserStorageFormatInstrumentedTest`
checks installed records on Android and needs a device run.

## Storage and recovery rules

- Preserve the exact legacy bytes, including malformed or empty values. Never
  reinterpret corrupt data as an empty domain or overwrite it on startup.
- Storage reads must not invent domain records. Calendar may initialize its stable
  source identity without inventing events; digest reads do not initialize it.
- Close older app tabs before migration. A later observed legacy change refuses
  access and retains both versions; legacy snapshots are not transactional.
- Reset requires reviewed captured state and a current revision. Keep a canonical
  tombstone so the retained legacy backup cannot reappear as active data.
- Edit callbacks are not replayed. Cancellation before commit aborts the pending
  transaction; an already committed result retains its receipt.
- Recheck account and UI ownership after asynchronous reads. Cross-tab notices
  invalidate views without taking over an originating action's completion UI.
- Tests must inspect the canonical store and inject actual IndexedDB failures.
  Legacy initialization fixtures should seed once, preserving reload behavior.

## Required evidence

Keep terminal results and failed reproductions, tied to source commits. Require
real multi-document concurrency, unique receipts, malformed-byte recovery,
write failure, tab death, stale reset and cancellation cases. Run the owning UI
journeys across Chromium, Firefox and WebKit, then repository verification and
current hosted checks. The shared domain atomicity suite covers rapid cross-tab
writes, unique receipts,
failed commits and tab closure against the canonical store. Domain-specific
journeys must still verify their callers; passing Calendar does not qualify
another domain. Browser CI runs the canonical domain and development Cloud
setup cases in Firefox and WebKit alongside the full Chromium shards.
Browser evidence does not prove
Android process, Keystore, reboot, Doze or physical-device acceptance.

## Development simulator ownership

The prototype application reducers intentionally use one origin-wide Web Locks
writer lease. A second development tab can inspect data but must close the writer
and reload before saving or resetting. Recovery uses the same writer instance;
reset checks the loaded and current bytes, verifies removal, then retires the
writer before reload so queued stale reducers cannot recreate the old snapshot.
Malformed bytes remain available for backup until an explicit successful reset.
This contract applies to development fixtures, not native application storage.
The reset ownership browser suite exercises the writer lifecycle. Its results apply only to the tested source and engine.

## Notes and audio deletion

Browser Notes uses upstream `DocumentNotesStore` through the product
`runtime/browser-notes-document.ts` adapter. IndexedDB owns the saved envelope; the
synchronous editor list is only an optimistic view. Collection IDs, record
revisions, deletion tombstones and metadata retain their existing format.
Original v2, v1 and daily bytes remain verbatim in the archive and localStorage.
Later changes to retired Notes sources stop normal access. Unrelated daily
receipts do not invalidate Notes. Confirmed reset creates a new empty collection
without reimporting retained sources or deleting recording bytes.

Browser recording bytes and transcripts use the shared elizaOS Notes client
`createNotesAudioStore` (one-note ownership, per-operation deletion receipts, purge
and 30-day expiry); `browser/note-audio-store.ts` binds it to Alpha's existing
`alpha.browser.audio.v1` IndexedDB database.

Audio-deletion pending records use a separate canonical document, and recovery
reads the same authoritative Notes envelope as the editor. The independent
`alpha.notes-audio-effects.v1` lock still serializes deletion, restoration and
reconciliation. Storage transactions alone do not authorize replaying an audio
effect. Exact backup and confirmed reset are available from Notes; unsaved text
must be copied or exported before a reset reloads the app.

### Notes Trash

Deleting a note from the editor, through an approved agent `notes_delete`, or as a
voice note moves it to Trash. Upstream Notes keeps content-free tombstones, so the
product keeps the restorable copy beside the store (`runtime/notes-trash.ts`): the
Keystore-encrypted no-backup slot `notes-trash:v1:device` (30 MiB, the Trash policy byte limit; a document written under the earlier 32 MiB cap stays readable) on Android and the
canonical browser document `alpha.browser.notes-trash.v1` on the web build. Each
entry holds the exact record, its reviewed revision (`target`), list position,
`deletedAt` and, for voice notes, the recording owned by the same deletion operation.
The entry is written ahead of the deletion commit under the shared
`alpha.notes-audio-effects.v1` lock, so content survives a crash or restart at any
point; maintenance drops an entry whose note is saved again (Undo, restore, or a
deletion that never committed).

Entries expire exactly 3 days (`NOTES_TRASH_RETENTION_MS`) after `deletedAt`
([decision P-06](decisions.md#october-7-owner-product-decisions)).
Maintenance runs at startup once saved Notes open, each time Notes opens, whenever the
app returns to the foreground (`visibilitychange` and the native `appResumed` event) and
every 15 minutes (`NOTES_TRASH_MAINTENANCE_INTERVAL_MS`) while the shell is alive, from
`prototype/notes-trash-adapter.ts`, so expiry never waits for the user to open Notes.
Background passes repaint Notes only when they removed something. It reads
authoritative storage, only takes the lock when there is work, and is idempotent: an
interrupted purge is simply repeated. On Android a native backstop
(`AlphaNoteAudioPlugin.sweepExpiredTrash`, run when the plugin loads and by the
`alpha-notes-trash-backstop` periodic WorkManager job every 6 hours) applies the same
rules while the renderer is not running: it erases the recording of each expired entry
whose deletion owns the audio trash, skips any entry whose note is saved again, whose
recording a saved note references or whose deletion is under review, and removes the
erased entries from `notes-trash:v1:device` by compare-and-exchange. It copies kept
entries byte for byte, so the slot stays in the renderer's exact `JSON.stringify` form
and a concurrent renderer edit wins; unreadable or unrecognized stores make it a no-op.
`notes-trash-resume.spec.ts` (fake clock: text and voice entries erased on a resume at
Home, and by the timer alone) and `NotesTrashBackstopInstrumentedTest` cover these. Restore reinserts the
byte-identical record (same id, so the same revision under the store's hash rule;
browser date stamping is skipped) and refuses to overwrite a saved note with the same
id. Voice restores use the reviewed audio-restore path; Delete forever, Empty Trash
and expiry call `AlphaNoteAudio.purge`, which erases bytes and transcript only for
the operation that trashed the recording, leaves a `purged` receipt, and makes later
restoration impossible. An unconfirmed voice deletion is never purged while its
recovery row is pending, and a recording that any saved note still references is never
erased. An approved agent `notes_delete` of a voice note follows the editor protocol:
the Trash entry and audio recovery row are written before the tombstone commit, and
the recording then moves to the audio trash under the agent's operation id, so Trash
restores or erases the note and recording together. If the recording step cannot be
confirmed after the commit, the recovery row stays for review and the entry is not
purged. A recording that is already missing or owned by another deletion is left
untouched and only the note text goes to Trash. The 3-day window uses wall-clock
epoch time (time-zone changes have no effect); a clock moved backwards delays the
purge, and a clock moved forwards can advance it.

Full Trash (MVP-15). The entry and byte limits (`NOTES_TRASH_MAX_ENTRIES`,
`NOTES_TRASH_MAX_BYTES`) and the Android slot cap admit new entries only. A refused
addition is a typed, definite refusal (`NotesTrashFull` or the native `storage-full`
code, see `isNotesTrashFull`): nothing was written and the note, its recording and every
other Trash entry are unchanged. The editor then shows a "Trash is full" dialog with three
choices: Cancel, Open Trash to make room, or "Delete forever without Trash". The last is
the only way a note skips Trash and is confirmed separately from the ordinary delete. For
a text, checklist or link note it is one saved-list commit of the exact refused record; a
note that changed since the refusal is left alone. The comparison reads saved storage, not
only the open view: if another view changed the note or already moved it to Trash, nothing
is deleted and that Trash entry is kept. This path and the voice path below first drop any
Trash row still present for that saved note (the maintenance rule for a live note), so
the erased note is not offered for restore afterwards. For a voice note the reviewed deletion
protocol runs without a Trash row: the recovery row (marked `permanent`) holds the only
copy until the tombstone commit, the move of this recording to the audio trash under the
same operation id and its erase are all confirmed. An
approved agent `notes_delete` never takes this path: it fails with "Trash is full" and
nothing is deleted.

Interrupted permanent voice deletion. A failure inside the process that started the
deletion leaves its row under review with the Restore control, and the next
deletion-status check finishes the erase only when that operation already owns the audio
trash; an effect that failed in a live process may still land, so nothing else is
inferred there. The test is "this JavaScript process did not create the row": on Android,
with one renderer, that means the creating process is dead; in the browser build a second
tab also settles a row that a first, still open tab left under review, once that tab has
released the lock. A row left by an earlier process (process death) is settled by a backstop
that is started with every Trash maintenance pass and takes the deletion-effects lock
itself: at startup once saved Notes open, on resume, on the 15-minute timer and when Notes
opens, so it never waits for Notes to be opened. With no recovery row it takes no lock and
repaints nothing. `runtime/permanent-voice-deletion.ts` decides one
step from authoritative readback of the saved note, the recording's metadata and this
operation's own receipt:

| Saved note | Recording | Step |
| --- | --- | --- |
| this operation's tombstone for the reviewed revision | never moved, no other deletion holds it | move to the audio trash under this operation, erase, retire the row |
| this operation's tombstone | in the audio trash under this operation | erase, retire the row |
| this operation's tombstone | already erased by this operation | retire the row |
| exact reviewed revision still saved | untouched, or given back by a restore | retire the row (rollback: nothing was deleted) |
| exact reviewed revision still saved | in the audio trash under this operation | restore the recording, retire the row (rollback) |
| exact reviewed revision still saved | already erased by this operation | commit the tombstone for that exact revision, retire the row |

Every other state keeps the row and the Restore control and changes nothing: a note that
was edited, saved again as another revision or deleted by another operation, a reset
collection, a recording whose metadata names another note, a recording another saved note
references, a recording another deletion holds, a restore that was already started, and
unreadable recording state. A step that cannot be confirmed by readback also keeps the row.
On Android `AlphaNoteAudioPlugin.finishPermanentDeletions` applies the three tombstone rows
of the table natively when the plugin loads and from the 6-hour
`alpha-notes-trash-backstop` job, from the encrypted Notes, pending-deletion and
recording-metadata slots, and retires the row by compare-and-exchange with the other rows
copied byte for byte. It never writes the Notes document, so the three "still saved" rows
are left to the renderer's startup pass. The native job cannot take the renderer's Web
Lock and does not know which process wrote a row, so it acts on every permanent row whose
tombstone is committed. Three consequences: if it runs in the instant a live renderer is
between its tombstone commit and its own recording steps, the deletion still completes
exactly once but that view reports it as unconfirmed until its next status check; a row
with a committed tombstone that a live renderer still shows under review after a failure
in that process is finished by the job, after which its Restore control can no longer
bring the recording back (a restore whose recording step has landed is never
overridden: its `restored` receipt is read under the recording-metadata lock); and at
process start the job can overlap the renderer's own
pass, in which case a recording the job erased under the same operation while the renderer
was moving it is confirmed by the renderer and the row retired in the same pass.
`notes-permanent-delete-backstop.spec.ts` covers the six rows and the refusals in the
browser build with a writer that holds the lock until the reload, that a deletion which
failed in the process that started it is not settled by that process even when its
tombstone lands late (and is finished by the next start), and the overlap with the erase
injected into the served recording module; `scripts/test-notes-trash-flow.ts` enumerates
the plan; four cases in `NotesTrashBackstopInstrumentedTest` cover the native pass and
have been compiled, not run. None of the three Android consequences above has run on an
emulator or a device. A Trash document that already exceeds the limits (written by a host
with larger limits) stays readable, restorable, purgeable and subject to expiry; only
additions are refused until it is below the limits again. `notes-trash-recovery.spec.ts`
and `scripts/test-notes-trash-flow.ts` cover this in the browser build and the policy, and
`notes-trash-full.spec.ts` reaches the refusal through the entry limit and, separately,
through the byte limit (encoded bytes, with the entry limit left at 10,000);
since the pin `bc71e21f3b` the shared `JsonCredentialSlots` admits reads of a slot above
its lowered limit and writes that shrink it (elizaOS/eliza#35910), so Alpha lowered
`notes-trash:v1:device` from 32 MiB to the 30 MiB policy limit with a retained limit of
32 MiB (`AlphaCredentialStore.retainedLimit`); a write that would grow such a slot is
storage-full. `NotesStorageDurabilityInstrumentedTest` covers this (older oversize Trash
readable, a shrink accepted, growth refused) and has been compiled, not run. Not yet
qualified on an emulator or a device.

The owning suites cover independent tabs, stale editors, exact archives,
malformed recovery, failed writes, lost acknowledgements, deletion receipts,
retained unknown outcomes and restoration against newer notes. Browser CI runs
the document/save-failure and audio-recovery suites across its configured
engines. Android retains the encrypted adapter and requires separate qualification.
