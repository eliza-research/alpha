# Foreground Calendar availability (MVP-12)

"Am I free at 3pm Tuesday?" is a `calendar_availability` device operation. The phone
answers it in a foreground review and shares busy times only. This page records what is
implemented and what is still unproven. It is not acceptance evidence.

## Flow

1. The agent proposes `calendar_availability` with an exact UTC window (at most seven
   days) and the phone's time zone. The phone offers the capability
   `calendar.availability-read.v1` only when the agent lists it.
2. The proposal card is shown on Home or Calendar while the phone is unlocked and the
   request's time zone equals the phone's. Otherwise the owner sees a notice naming the
   reason, and the action cannot be approved.
3. After approval and the journal claim, the phone asks for calendar read permission and
   lists the calendars it may read. Nothing is preselected. The owner ticks one to
   sixteen calendars; unticked calendars are not read.
4. The phone reads only those calendars, bound to the source revisions the owner saw,
   and shows the exact answer: free or busy, each busy time, and how many events marked
   free were ignored. The result identifies each selected calendar by name and account
   on the phone, so identically named calendars remain distinguishable.
5. On "Share with agent" the same read runs again. If the answer differs, nothing is
   shared and the owner is asked to review again. Otherwise the reviewed result is
   journaled and uploaded as the receipt.

Cancelling, pressing Back, leaving the app, locking the phone, changing screen,
reconnecting or changing time zone ends the review with a failed receipt that carries no
result.

## What is shared

The receipt is the shared `CalendarAvailabilityResult`: the window, `free` or `busy`,
busy intervals with `allDay` and `tentative` flags, the number of calendars read and the
number of ignored free events. Calendar names, accounts, event titles, descriptions,
places and attendees are not in it. The Android reader does not query those columns, and
the renderer rejects any provider row that has a field other than `start`, `end`,
`allDay` and `availability`.

## Rules

- Events marked free are ignored and counted. Tentative events are busy and flagged.
- An all-day event blocks the owner's whole local date, not the UTC date.
- Cancelled events and invitations the owner declined do not count as busy. This follows
  the owner-approved policy for #418 (2026-10-12). Unanswered blocking entries
  remain busy.
- More than 200 events in the window, or more than 64 readable calendars, fails the
  check instead of returning a partial answer.
- The Android journal keeps a succeeded check only with its exact answer (window, counts
  and busy times, at most 200 intervals and 32768 bytes) and refuses any other field. A
  failed or cancelled check keeps no answer. The journal's default bound for other
  results is 8000 bytes, which about 80 busy intervals would exceed.
- If the calendar list is unavailable, the phone asks again up to three more times,
  300 ms apart, re-checking the reviewed screen each time. Nothing is read while it waits.
- In the browser the only source is the in-app calendar. Its events have no "show as
  free" setting, so each one is busy.

## Source

| Part | Path |
| --- | --- |
| Executor and provider boundary | `apps/app/src/runtime/calendar-availability.ts` |
| Review dialogs | `apps/app/src/prototype/calendar-availability-review.ts` |
| Android provider read | Upstream `SelectedCalendarReader.availabilitySources` and `readAvailability` (`vendor/eliza/plugins/plugin-native-calendar/android/src/main/java/ai/eliza/plugins/calendar/read/SelectedCalendarReader.java`, elizaOS/eliza#35911, at the pin); the time-zone check is Alpha's `CalendarZones.java`, and Alpha's `CalendarSyncFreshness.java` refuses a selection with any non-`LOCAL` calendar before the upstream read. `CalendarSyncFreshness.readAvailability` is that whole provider read, in order; the plugin and the JVM test both call it |
| Android bridge methods | `availabilitySources` and `readAvailability` in `AlphaCalendarPlugin.java` |
| Android journal policy | `CalendarAvailabilityJournalResult.java`, called from `AlphaActionJournal.java` |
| Browser provider read | `apps/app/src/browser/calendar.ts` |
| Contract and result computation | `vendor/eliza/packages/contracts/src/device-reviews.ts` (pinned, unchanged) |

## Tests

- `test/calendar-availability.test.mjs` runs `scripts/test-calendar-availability-flow.ts`:
  the executor and the real `DeviceActions` client over a synthetic provider.
- `test/browser/calendar-availability.spec.ts`: the renderer, review dialogs, journal
  orchestration and the browser in-app calendar, with synthetic agent routes.
- `test/calendar-availability-reader.test.mjs` compiles the pinned upstream reader
  (`SelectedCalendarReader`), Alpha's `CalendarZones`, `CalendarSyncFreshness` and the journal policy for the JVM and
  runs `test/fixtures/CalendarAvailabilityReaderTest.java`. The reader's exact projection,
  selection and sort order are executed by the `sqlite3` shell (the shared
  `test/fixtures/SqliteCalendarProvider.java`) over tables that use
  CalendarProvider's column names, in five time zones from UTC-11 to UTC+14. The rows
  then go through the renderer parser and the shared contract computation
  (`scripts/test-calendar-availability-provider-rows.ts`). This checks the reader's SQL
  and row handling. It is not CalendarProvider and not a device run. The same run checks
  the journal policy on the JVM: the largest answer is accepted and extra fields, a
  changed window and an answer on a failed check are refused. The Keystore-backed journal
  itself is not exercised.
- `CalendarAvailabilityInstrumentedTest`: the Android reader against the device
  CalendarProvider with calendars the test creates. `scripts/test-calendar-regression.mjs --case=CalendarAvailabilityInstrumentedTest` grants
  the calendar permissions. It passed 4 of 4 on both flavors at `2961bd9e` (pin `13c9857598`),
  class E on developer APKs ([verification](verification.md)).

## Still open

- The Android reader ran on an emulator (above). The permission dialog and the review inside
  the Android WebView have no emulator test: the read is a device action an agent requests
  over a negotiated connection, and a bundled APK has no agent session to script it. Synced
  accounts, a declined invitation and a mid-review time-zone change are unverified.
- The bridge methods ask for window focus, as the shared calendar reads do. Whether focus
  has returned by the time the calendars are listed, straight after the owner answers the
  first permission prompt, is unverified. The phone asks for the list again for about a
  second (see Rules); whether that is long enough on a device is also unverified. If it
  is not, that first check fails with nothing read and the owner has to ask again.
- Whether the Android WebView reports the page as hidden while the system permission
  prompt is shown is unverified. If it does, the first check ends as a stale screen with
  nothing read.
- A pending action that cannot be reviewed from the current screen is named again after
  each reply until it expires. The notices are not de-duplicated.
- The other foreground reviews (`notes_search`, `notes_named`, `calendar_named`,
  `reminder_named`) are not negotiated by the phone. Their results would also need a
  journal bound of their own before they are.
- No real agent has produced or consumed an availability receipt against this build.
- The provider read lives in the Alpha app because the pinned shared calendar readers do
  not return availability. Moving it into the shared calendar plugin needs an upstream
  change.
- Device and owner acceptance of the wording and flow are separate gates.

## Issue #418 acceptance boundary (2026-10-12)

The executor refuses every non-ready read (including stale, unavailable, changed and
permission-required), both before review and on the final re-read. These paths produce
no availability result; an empty payload on a failed read is never interpreted as free.
Synthetic executor tests cover these states before and after a reviewed empty result.

This does not establish remote sync freshness. The native source revision covers
calendar identity/access metadata, and the final re-read detects changed local answers;
neither proves that CalendarProvider has received the latest remote invitation or
conflict update. Native availability now refuses any selected calendar whose account type is not
Android's `LOCAL` (`CalendarSyncFreshness`, after the source-identity check and before the
upstream reader queries event instances), with `freshness-unknown` and no
intervals. A mixed selection also fails as a whole. Such calendars remain offered,
including free/busy-only sources; choosing them produces unknown availability until
remote freshness can be established. Local native and browser reads explicitly return
`freshness: local`; the renderer refuses a ready response with missing or unknown
freshness, including on the final re-read. This provider marker stays on the phone and
is not added to the shared receipt.

Provider-specific freshness evidence and real synced invitation, free/busy-only, revoked-source and
conflict-update qualification remain required before #418 can close. Local browser
storage has no remote sync freshness claim. APK compilation, synthetic provider tests
and browser tests cannot satisfy those live-provider gates.
