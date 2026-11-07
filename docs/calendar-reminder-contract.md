# Calendar and reminder contracts

AlphaPhone owns Calendar presentation and product choices. The pinned upstream
native Calendar and Reminders plugins own provider access and scheduling. Device
calendars require an installed sync provider for account synchronization; a local
calendar or an external editor does not establish a connected account.

## Calendar data and navigation

Calendar access is requested by an explicit user action. Typing an event does not
persist it. Save validates the selected destination and reads back the provider
result; an uncertain write must not be repeated automatically. Selected event
identity does not authorize an assistant to read or mutate its contents.

The renderer queries the visible month and adjacent months, discards superseded
responses, and distinguishes incomplete, loading, denied, stale, and failed data
from an empty day. All-day provider boundaries use UTC calendar dates rather than
local-hour conversion. Initial nonexistent civil times are rejected. See the
[range and text-size contracts](calendar-range-and-text-size.md) for limits and
native verification commands.

A late save or deletion must not close a newer event, a new unsaved form, or a
screen reached through Home. Refreshing provider data remains independent of
that navigation guard. Existing complex events use the explicit external-editor
handoff described in [external Calendar verification](calendar-external-editor-test.md).
That guide owns the editor artifact/signer pins, implicit-intent checks, exact
provider-field readback, and cleanup requirements. AlphaPhone retains its own UI
and visibly identifies the external editor.

## Reminder identity and completion

Once, Daily, Weekdays, and Weekly use native reminders. Repeated reminders retain
a pinned IANA timezone, civil date/time, and separate alert lead. The first
Weekdays occurrence must be a weekday; an initially nonexistent time is rejected.
A future spring gap uses the first valid instant after the gap, and an overlapping
hour uses the earlier offset once. Editing creates a new revision.

There is one unresolved occurrence. Posting or dismissing a notification, opening
the app, rebooting, or re-posting after reboot must not advance recurrence. Done durably records completion
and schedules the next future occurrence; elapsed dates skipped after late
completion are counted as skipped, not completed. Snooze 10 minutes preserves the
occurrence and original due time; repeating a pending snooze does not extend it.
The last 32 completion receipts are retained without discarding an unresolved
current occurrence. [One-off completion](reminder-one-off-completion.md) specifies
the corresponding non-recurring behavior.

Decisions and taps carry occurrence/revision identity. Stale actions cannot
mutate a replacement occurrence; stale taps return to a safe Calendar destination.
Permission-denied occurrences remain visible. Granting permission alone must not
redeliver or advance them; retry requires an explicit action. Malformed neighboring
records remain available for recovery without preventing healthy records from
being restored. Scheduling failure is distinct from durable storage success.

## One-off time zone policy

A one-off reminder is an absolute instant (`dueAt`, epoch milliseconds). It is not
a civil time. When the phone's time zone changes, the reminder keeps the same
instant and alarm; only its rendered wall time and Calendar day follow the new
zone (`reminderEvents` in `apps/app/src/runtime/reminder-creations.ts`). A 09:00 reminder created in New
York shows as 06:00 after moving to Los Angeles and still fires at the same moment.
Repeats are different: they keep their pinned IANA `recurrence.zone` and civil
date/time, as described above. Reschedule a one-off explicitly to keep a local
clock time after travel.

## Refusals, overdue items, reopen and to-dos

`scheduleReminder` resolves stable refusal codes: `past`, `permission-denied`,
`storage-full` and `failed` (historical patch `0040-reminders-lifecycle`; the codes now come from the pinned upstream reminders plugin, and the patch series was retired in `34b3c82a`). A full store reports
`storage-full`; it is never reported as `failed`. The renderer shows the specific
reason. It retires the pending creation only after a definite refusal **and** a
readback that confirms the ID is absent (`retireRefusedCreation`). A refused
request is never retried automatically. Refusals therefore do not accumulate toward
the 32-entry pending-creation limit. A saved row with a `permission-denied`
status is found by readback and is not retired.

`overdueReminders()` lists reminders that are due and not done, oldest first:
`posted` rows, and `scheduled` rows whose due instant has passed (delayed or
snoozed). The Calendar adapter exposes them as `overdueReminders` for an Overdue
section; the template rendering and the Home agenda rows are not added yet.

A completed one-off can be reopened through a reviewed `reminder_update`. The
renderer then reads the reminder back and requires a new open occurrence at the
reviewed due time. "Reopen" keeps it open with no alert. "Reopen tomorrow" alerts
at the original local clock time tomorrow. The adapter exposes these as
`reminderReopen` and `reminderReopenTomorrow`; the detail-sheet buttons are not
rendered yet.

Undated to-dos (`reminderTodoVersion` 1) have no `at`, no AlarmManager entry and no
notification. They are listed without a Calendar day and can be completed,
reopened or deleted through the exact reviewed target (`todoDecision`). Reviewed
`operateReminder` operations and notification decisions (`reminderDecision`) refuse
them. A retried save with the same ID and text is idempotent. The adapter exposes
`todos` and `addTodo`; the to-do list is not rendered in the template yet.

## Note origin and the note hand-offs

A reminder or calendar event saved from a voice note's draft keeps a back-reference to that
note (`NoteOrigin`; the link rules are the elizaOS Notes client's
`plugins/plugin-notes/src/client/note-origin.ts`, re-exported under Alpha's import names by
`apps/app/src/runtime/note-origin.ts`):

- It is identity only: note id, recording id and the hash of the whole note record at review.
  It grants no access to the note and carries none of its content, not even its title; the
  title shown beside a link is read from the note as it is now.
- It is created once, at Save, and an existing link for a record is never replaced. Deleting the
  record removes its link. At most 200 links are kept; the oldest make room.
- It fails closed: the open-note action works only when exactly one note with that id still
  holds the same recording, and it says when the note was edited after the link was made. A
  malformed index is reported as needing recovery, never guessed.
- Hand-offs: "Review event draft" and the reminder draft on a saved note write nothing until
  Save in Calendar or Reminders; a double activation or a reload mid hand-off saves once
  (`test/browser/note-calendar-handoff.spec.ts`).
- Android: reminder links are stored in the native slot `note-origins:v1:device`, which the
  native compare-and-exchange admits since the MVP completion integration
  (`AlphaConnectionPlugin`). `NoteOriginInstrumentedTest` reads a link back at storage level and
  has not run. A device-calendar event carries no link back: CalendarProvider row ids can be
  reused and the pinned Calendar plugin stores no Alpha field, so the event draft opened from a note
  says "This event will not link back to the note on this phone." before Save. NEEDS upstream: a stable per-event identity.

## Reboot re-post and due channel

Android clears posted notifications on reboot. `restore` re-posts each `posted`
record once per boot (`Settings.Global.BOOT_COUNT`). The re-post uses the same
occurrence, exact target and Done/Snooze actions, and the same tap route while that
route is unconsumed (a consumed tap gets a fresh route). It never advances
recurrence. Only a simulated boot-ID change is covered on the emulator; an actual
reboot has not been run. If a posted notice cannot be re-posted, for example while notifications
are disabled, the boot is not marked and a later restore retries it.

Due reminders post on a separate high-importance channel, `alpha-local-reminders-due`.
The original `alpha-local-reminders` channel is kept. When the due channel is
first created, it keeps an owner's opt-out (a blocked original channel creates a
blocked due channel), sound and vibration. The heads-up check is emulator evidence
only.

## Native verification

Use the [verification guide](verification.md) for owned-emulator configuration,
archived app/test APKs, isolated-user runners, and retained cleanup evidence.
Run `scripts/test-reminder-one-off.mjs` and `scripts/test-reminder-recurrence.mjs`
for both distributions. The latter runs the real alarm/Snooze/visible Done flow
and the civil-time/edit-invalidation flow. Inexact delivery has a bounded native
wait of up to 13 minutes and a 16-minute instrumentation deadline; a skipped test
or a saved schedule is not delivery evidence.

The separate recovery scenarios are `scripts/test-reminder-recovery.mjs` and
`scripts/test-reminder-recurrence-recovery.mjs`. They require their own dedicated
disposable emulator and matching archived APKs. Set `ANDROID_SERIAL`,
`ALPHA_NATIVE_TEST_AVD`, and `ALPHA_NATIVE_TEST_ABI` explicitly, plus
`ALPHA_TEST_HOME_PACKAGE` for a non-default stock HOME. Pass the matching app APK,
instrumentation APK, and a new output directory to each runner. The shared harness
leases the emulator, verifies archived and installed bytes, refuses existing
packages, and scopes installation and permission changes to a fresh secondary
user. Both recovery scenarios read the current reminder envelope and witness the
real permission-denied alarm externally before starting the UI assertion phase.
Before reboot, require a scheduled,
unposted fixture with the package not stopped. Require a changed kernel boot ID
and resume the same fixture user unlocked. Observe only the named fixture's
stored receipt and notification key, including its Android user ID.
Do not start instrumentation, explicitly launch the app, or manually invoke a
restore/boot broadcast before the external delivery witness: instrumentation
startup can stop the package and cancel the alarm being measured. The recurring
permission-denial witness additionally follows the same no-instrumentation rule and must
preserve revision, occurrence, and zero completion advancement. Run the subsequent
Done/stale-action phase and fixture cleanup only after that observation.

Notification posting and receipt persistence are not atomic; these checks do not
establish exactly-once delivery. APK builds, emulator flows, HOME-role boot,
locked-boot/Doze/OEM behavior, live provider integration, a user seeing/hearing an
alert, and physical-device acceptance require distinct evidence. Record current
source and artifact identities; historical runs do not qualify newer APKs.

## Native Google sync completion contract

The browser controller does not qualify Android CalendarProvider sync. The native port must use a dedicated, owner-bound bridge capability; the existing manual `CalendarEventGuard.direct` restriction must remain intact. That writer deliberately refuses alarms, guests, all-day events and recurring/exception metadata.

The native implementation must meet these boundaries before Settings enables it:

- Review the exact Google account/calendar and Alpha-owned local calendar, then bind opt-in to the established native owner/agent, service-account generation, source identity and foreground lifetime. Keep inference availability distinct from owner authority. An unverifiable or changed context pauses sync.
- Read an exact event ID from its verified owned source. A null provider cursor, revoked permission or changed source is an error. Absence from the existing 370-day/2,000-instance view is never evidence of deletion.
- Return a complete event/source revision covering the fields and child rows that a write depends on. Keep source generation distinct from display changes so a rename cannot generate duplicate Google creates. Never reuse another source or agent's checkpoint.
- Preserve raw recurrence/exclusion/exception metadata, all-day civil dates, timezone/duration, attendee identity/optional/response fields and reminders. Apply only semantics the native model can represent; preserve and report unsupported data instead of flattening it.
- Apply Google changes with native source/event/child-row compare-and-swap assertions and provider readback. Preserve unedited fields and local alerts. Stage deletions through Alpha's existing authenticated-owner Undo coordinator; do not call an immediate-delete path.
- Retain the shared reconciliation journal, stable create key, exact Google ETag, uncertain-outcome readback and explicit conflict handling. No automatic retry of a provider write and no approval inferred from a successful read.

Qualify the real bridge through the normal native producer and an authorized disposable fixture first. Source/JVM tests, four APK builds, installed source identity, Google write/readback and physical-device acceptance are separate receipts. The retained Seeker publication/install hold is not waived by a browser test or USB connection. No audio, account reset, unlock or phone install is implied by this contract.

The native source now implements this boundary in `CalendarSyncBridge`,
`CalendarSyncSnapshot` and `CalendarSyncMutation`, with the shared renderer
controller wired through `native-calendar-sync.ts`. The native confirmation reads
Cloud identity and Google capabilities itself. Its grant/dispatch journal is an
encrypted native-only namespace; renderer storage cannot enable it. Only the
verified Alpha-owned LOCAL calendar is eligible. Its source generation is set at
native opt-in using a source-asserted, account-scoped CalendarProvider operation;
ordinary event changes keep the normal application permission path. Exact reads
and transaction assertions include recurrence families, attendees, reminders and
extended properties. Unsupported fields are refused, not reconstructed.

Google-origin deletions use the existing ten-second Undo coordinator. Pausing
sync prevents queued sync deletions from dispatching. An observed Undo keeps the
event and pauses that event's retained Google link, avoiding an automatic second
deletion. Unknown native writes retain their dispatch claim and are not repeated.
Only acknowledged, definite receipts can be retired from bounded native history.

Host-JVM snapshot/mutation/owner/slot checks, native-port tests and renderer
Settings tests exercise synthetic boundaries. `CalendarSyncProviderInstrumentedTest`
is the disposable real-CalendarProvider follow-up; adding it does not run it.
Normal native producer/build qualification, installed identity, actual owner
consent, Google write/readback, Undo/restart and physical acceptance remain
separate gates. Do not mark those complete from browser tests or source compilation.

The native journal uses encrypted-slot compare-and-exchange across Activity
instances. Pause revokes the grant immediately, independently of a pending
network read, and retains reserved storage capacity for revocation. Queued calls
from a retired view are refused before new reads. Historical write receipts stay
bound to stable owner/device/source identity; a credential generation still
requires fresh write admission. After an interrupted update, an exact native
read can confirm the intended semantic result and settle/acknowledge its receipt
without applying the update again. Definite acknowledged response bodies are
compacted; uncertain claims remain retained.
