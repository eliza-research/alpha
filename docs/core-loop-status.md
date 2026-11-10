# Core loop status in the browser build

This records whether each core MVP loop completes start to finish through the rendered
UI of the browser build, as driven by one journey spec per loop in `test/browser`.
Loop definitions: [completion plan](mvp-completion-plan.md) journeys A–F and
[flow audit](flow-audit-and-prd.md) J01–J05.

The independent audit of these claims, the flag-off (production) path of each loop and the
remaining work are in [core loop audit](core-loop-audit.md).

**Evidence class: source/test (S) only.** Every journey runs the development profile
(`?mode=dev`, test mocks on) with the development agent profile where an agent is needed.
The agent answers with a saved scripted reply and its proposals are authored through the
"Development device actions" control; providers (microphone, Cloud transcription, speech
output, mail provider, Maps provider, web pages, camera) are synthetic fixtures. A passing
journey is not APK, emulator, AOSP image, real-integration or physical-device evidence and
does not qualify any row in [current status](mvp-current-status.md) beyond class S. Where a
section below names an emulator result, it is class E on developer APKs (round 7 at `6dcdde34`,
pin `40dbe96bd1`, or round 8 at `2961bd9e`/`9a1ca161`, pin `13c9857598`; see
[verification](verification.md)).

Run one journey at a time: `npx playwright test test/browser/journey-<id>-<slug>.spec.ts --project=chromium --workers=2`.

Column meaning: **Browser** = the step completes through rendered controls in the named
spec (yes / partial / no). **Native-only** = the step, or the part named, cannot be
exercised in the browser build by design. **Human or device** = what still needs a person
(sign-in, keys, owner decision) or physical hardware.

## A. Boot, connection choice and retained conversation

Spec: `journey-a-conversation.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Boot to Home with typed and talk entry points, resident agent starting | yes | Cold boot into Alpha HOME, HOME role, recovery/emergency routes | Device boot and HOME-role selection |
| Connection choice (Settings → Agent connection → development profile) | yes (development profile only); the flag-off Android "Your agent" dialog's sign-in, Cancel, expired session, refused key and zero-balance branches (the resident starts and keeps running in each, P-43) (`resident-first-run.production.spec.ts`) and the start-failure branch (`connection-boundaries.production.spec.ts`) are covered on the production bundle with the bridge stubbed | Native `AlphaConnection` bridge | Cloud sign-in, agent selection/provisioning, remote pairing with a real account (A-02) |
| Typed conversation | yes | — | Real model quality |
| Switch Notes / Calendar / Browser and keep the same conversation | yes | — | — |
| Cancel a pending reply (Stop): the chat says once that the agent may still finish, the composer stays empty and nothing is resent | yes | — | — |
| One automatic check about 15 s after Stop reads the agent's history exactly once and reports the outcome (here: the agent did not record the message); the Check for reply card re-reads history and never posts | yes | Explicit cancel on the resident runtime | A real agent that finishes or confirms the cancel after Stop (controlled-transport cases are in `chat-continuity.spec.ts`; no real agent is exercised) |
| Send again after cancelling | yes | — | — |
| Reload and recover exactly one result per accepted request, none for the cancelled one | yes, after an explicit history restore | Process kill/restart, resident runtime restart | Network switch, token expiry/revocation, account change |

Open items:

- With the development profile, the visible chat is not restored by itself after reload;
  the user restores it with Load conversations → Restore conversation (asserted in the
  journey). The flag-off Android build restores the saved conversation by itself
  (`journey-core-loops.production.spec.ts`, stubbed bridge). Restoring a saved remote conversation on reconnect is covered with a
  controlled transport by `chat-continuity.spec.ts`, not by this journey, and no real
  remote or Cloud agent is exercised.
- One spoken request is part of this journey: a synthetic microphone (a Web Audio oscillator
  through the browser's real recorder) and the closed Cloud transcription fixture; the request
  is transcribed, sent once, answered once and read back, and silence sends nothing (class S).
  A physically spoken request, microphone quality and a real transcription service are not
  exercised (see B for recording).

## B. Voice → note → calendar event and reminder (J02)

Spec: `journey-b-voice-note-actions.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Record in Notes (synthetic microphone, real recorder and retained-audio store) | yes | Native recorder and permission | A physically spoken note, microphone quality |
| Transcribe, correct the transcript, Save note | yes (closed Cloud transcription fixture) | On-device Whisper | Real recognition quality; Cloud account sign-in |
| Reload, reopen, read aloud / stop reading | yes (synthetic speech output) | Native synthesis | Audible playback, interruption, latency (A-10) |
| Review transcript with the agent, save reviewed summary note | yes | — | Real agent answer quality |
| Reminder from the note ("Review reminder draft" → Calendar form → Save) | yes | Native reminder scheduling | OS notification delivery, snooze from the notification, reboot |
| Calendar event from the note ("Review calendar event draft" → Calendar form → Save; nothing is written before Save) | yes | Android CalendarProvider accounts | Provider read-back, attendees |
| Saved reminder and event show "From note: <current title>" and "Open note" opens that exact recording, after reload and after an edit | yes (`note-calendar-handoff.spec.ts` covers a deleted, replaced, renamed or edited note) | The link for a device-calendar event (see open items) | — |
| Agent-proposed reminder and event, each reviewed and approved, with receipts | yes | Native action journal | A real agent choosing to propose them |
| Reload: every record exists exactly once | yes | — | — |
| Edit and delete the event and the reminder; the event deletion has one review step and Cancel deletes nothing | yes | The Android "Delete calendar event?" dialog | — |

Closed in the browser build:

- Notes → Calendar event: a saved voice note offers "Review calendar event draft"
  beside "Review reminder draft". Both open a Calendar draft only; nothing is written
  until Save in Calendar.
- Back-reference: a reminder or event saved from a note draft is linked to that note
  (note id, recording id and the reviewed revision; no note content and no title).
  Calendar shows "From note: <title>" with "Open note", where the title is read from
  the note as it is now, so a renamed note is shown under its current name. The action
  opens that note only if exactly one note still has that id and recording; otherwise
  it opens nothing and says so. A note that is in Trash, deleted or replaced is shown
  as "From a note that is no longer in Notes" with no title. A note
  edited since is opened with a notice. The link is created once at Save, is never
  changed by a later hand-off, and is removed when the record is deleted.
- Browser "Delete event" now shows one review step that names the event, like the
  Android plugin's "Delete calendar event?" dialog. Cancel, Back, Escape, hiding or
  locking the app delete nothing, and an event changed during the review is not deleted.

Still open:

- Device-calendar events created from a note are linked to it in the Android build since the
  pin `bc71e21f3b`, by the creation id Alpha saves the event with: CalendarProvider row ids are
  assigned by the provider and can be reused, so the link is not keyed by them, and the pinned
  reader now returns `creationId` on events this app created (elizaOS/eliza#35912). The link is
  remembered at save and dropped when the event is deleted (`calendar-adapter.ts`,
  `note-origin-adapter.ts`; `scripts/test-calendar-crud-review.ts`, class S); no Android run.
  It names a link, not ownership: another app with calendar write access can set the same
  fields. An event that Android Calendar saves (the guests, video or alert hand-off) carries no
  creation id and is not linked, and its draft says so before Save. Reminder links use
  the reminder's own id; on Android the link is written to the native slot
  `note-origins:v1:device`, whose native compare-and-exchange refused it until the MVP
  completion integration admitted it. `NoteOriginInstrumentedTest` reads it back at storage
  level and has not run, so no Android reminder or event link is shown to work.
- The contract documents ([notes document flows](notes-document-flows.md),
  [calendar contract](calendar-reminder-contract.md), flow audit J02) do not describe a
  note back-reference or a calendar-event hand-off from a note. The behavior above is
  implemented from the J02 loop description and should be written into the contract
  by its owner.
- Reminder deletion from the detail page is still immediate ("Reminder cancelled").
  It was not changed.

Decided since as [P-30](decisions.md#october-12-owner-decisions) (A-25): a short durable Undo window
and one review step for events and reminders. The October finding that led to it:

- **Calendar deletion recoverability.** PRD AP-15 / MVP-48 suggest "no unrecoverable
  user-data loss" as P0, and Notes has a Trash. Calendar has neither a Trash nor Undo
  for provider-backed events. What was implemented is only parity with the existing
  Android behavior (one review step before an irreversible delete), using the review
  dialog Calendar already uses for "Delete repeating series". No retention window,
  Trash or Undo was added. The owner should decide whether deleted events and
  reminders need a recoverable state, for how long, and whether reminder deletion
  needs the same review step.

## C. Alarms

Spec: `journey-c-alarms.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Agent proposes a Clock handoff; review shows the exact request and no result claim | yes | — | — |
| Approve once; receipt records only that the handoff was opened | yes | The Android Clock intent (set/show/snooze/dismiss) and its "Alpha cannot confirm an alarm was changed" wording | Whether an installed Clock app created the alarm |
| Second reviewed handoff (show) opens the browser Clock on that alarm | yes (browser Clock) | Android Clock UI | — |
| Reload: exactly one alarm | yes (browser Clock record) | — | Reboot persistence |
| Ring, snooze, ring again, dismiss | yes (foreground page, fixed clock) | Actual ringing, snooze, dismiss in Android Clock | Sound, vibration, DND, Doze, DST/time-zone change, no-handler and denied cases |
| Restart: dismissed alarm stays dismissed; receipts retained | yes | — | — |

Alarm ownership is pending owner decision A-11; the journey asserts the current handoff
behavior and decides nothing. The alarm list in this journey is the browser build's own
Clock (`apps/app/src/browser/clock.ts`), which also exists in the flag-off web build. It
does not exist on Android, where every request is a reviewed handoff to the installed
Clock app and "Alarm saved." is never shown.

## D. Scheduled digests

Spec: `journey-d-digests.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Create morning and evening schedules from a reviewed snapshot (Settings → Scheduled digests) | yes | — | Real provider sources and their consent |
| Morning occurrence runs once; result retained, shown once, acknowledged | yes (development scheduler; output is the scripted reply) | Resident and hosted workers | Real model output |
| Restart inside the scheduled minute does not admit the occurrence twice | yes | Resident restart at an admission boundary (`scripts/test-local-digest-restart.ts`) | Worker crash on a device |
| Evening occurrence runs once for the evening schedule only | yes | — | — |
| App closed across a scheduled time: no backlog replay, never run late | yes | — | Power loss, Doze, battery |
| The missed time leaves exactly one explicit `missed` record, labelled "Missed — not run", acknowledged once, unchanged by later ticks and restart | yes | — | — |
| A missed record does not replace the last real brief that Home reads; a schedule with only a missed record has no brief | yes (asserted on the retained value Home reads, and on Home's dedicated Latest brief card: absent with no brief or only a missed record, present with the retained brief) | — | — |
| Final restart: history and acknowledgement retained; nothing runs again | yes | — | — |
| Two hosted loops complete while the phone is powered off and deliver once on reconnect | not coverable | — | Owner decision A-09, then a hosted service and a powered-off phone |
| Phone sources (calendars on the phone) feed a digest after consent, within the 16-calendar and 1–168 h bounds, and can be revoked and renewed | flag-off spec, bridge stubbed (`digest-native-sources.production.spec.ts`) | The native source path (`test/native-digest-sources.test.mjs`, host JVM; no emulator run) | Real calendars on a phone |
| A dossier is offered only with native phone sources on the resident agent; Cancel sends nothing | flag-off spec, bridge stubbed (`digest-native-sources.production.spec.ts`, `test/digest-route-registration.test.mjs`, `test/digest-capabilities.test.mjs`) | — | The pinned agent registers the dossier route since `bc71e21f3b` (elizaOS/eliza#35906); no dossier has run on an emulator (EMULATOR) |

Open items:

- After a long absence the development scheduler records one missed occurrence (the most
  recent). The panel now says "one is recorded below as missed", which matches.
- The development scheduler runs only while the page is open ("Schedules run while this
  app is open"). This is not evidence for resident or hosted scheduling.

## E. Browser and credentials

Spec: `journey-e-browser-credentials.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Navigate, search, Back, Forward (test-owned local pages; search results fulfilled by the test) | yes | Isolated native WebView | Real sites |
| Second tab and switching tabs | yes | — | — |
| Reviewed page reading: only reviewed text reaches speech | yes (recording speech fixture) | Native reading and consent | Audible read-aloud |
| A page with a credential field is refused for reading and for questions | yes | Native sensitive-source checks | Real vault, OTP and recovery pages |
| Private tab is marked, kept out of history and gone after reload | yes | Ephemeral WebView profile | Sign-in does not persist after a private tab closes, on a device |
| Password manager from the Browser menu: honest "Autofill unavailable" state, development vault | yes (development vault) | Android Autofill, BiometricPrompt, Keystore vault | Enabling autofill in Android settings; save/fill on a real site |
| Development provider: install, select, unlock, fill the disposable sample, lock | yes | Proton Pass and other real providers | Provider sign-in |
| Reload: only the provider choice persists; no sample value is stored | yes | — | — |
| Sign-in persists in a normal tab across a cold start (P-04) | not coverable | yes | Emulator and device runs |
| Upload/download and external handoff | not in this journey (owning specs exist) | Android download and app-link handoff | — |

## F. Email and reconnect notifications

Spec: `journey-f-email-notifications.spec.ts` (small serial group)

`journey-f-reviewed-send.spec.ts` covers the reviewed provider operations the first spec does
not: Cc, Bcc and attachments in the review with a byte-for-byte dispatch, an email edited
after its review, Trash and undo, an unknown Trash outcome, and paging while the mailbox
changes. `inbox-hostile-attachment.spec.ts` covers hostile attachments.

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Inbox load and open a message (development mailbox) | yes | — | Real mailbox |
| Local draft survives reload; one local send ("Sent locally", no receipt by design) | yes | Keystore-encrypted draft slots | — |
| Reviewed send against the synthetic provider: exactly one receipt and one message after reload | yes | — | Real Google OAuth grant (code exchange currently returns 401), managed Cloud routes, a real authorized send |
| Lost send response: outcome unknown, never sent again | yes | — | Real response loss against Gmail |
| A due reminder notice tapped after reload opens exactly its own event, once | yes (simulated shade) | OS notification delivery, system shade, lock-screen tap, process death between delivery and tap | Notification permission and channel settings on a device |
| A provider-confirmed send removes the saved local draft, the retained unsaved copy and the open composer of exactly that email; unknown and failed outcomes keep them | yes | Keystore-encrypted draft slots | A real authorized send |
| Two hosted digest result notices, each tapped after a restart, reach exactly their own retained result, once | yes, in `journey-f-hosted-result.spec.ts` (local-agent build on its own server; routed fixture service) | OS notification delivery, system shade, process death between delivery and tap | A real hosted worker (owner decision A-09) |

Open items:

- Closed in the browser build: a send records the local draft it came from (draft id,
  kept only on the device and never sent to the provider). When the provider confirms
  that send, each local copy of that draft that still holds exactly the sent content is
  removed and the receipt says so. A copy edited after Send, a different draft with the
  same text, a draft changed in another window, another account's draft, and every
  unknown, rejected or unsent outcome are left alone; the receipt then says a copy
  remains. A succeeded receipt that names no provider message clears nothing. When the
  open or retained copy was edited after Send, or the retained copy cannot be cleared,
  the saved draft those edits are based on is kept too. Comparison is exact (recipients,
  subject, body, attachments, reply target, forwarded originals); a copy restored to
  exactly the sent content counts as the sent email and is removed. A reload between the
  confirmation and the cleanup finishes the cleanup from the saved receipt. Cases:
  `scripts/test-inbox-sent-cleanup.ts`. Both that script and the journey supply their
  own slot store; the removal of the saved draft relies on the platform store's
  compare-exchange (Android Keystore slots), which no run here exercises. The saved
  receipt is trusted to the same degree as the drafts stored beside it: it is not
  re-confirmed with the provider before a cleanup that resumes after a reload.
- Still open: a saved local draft that is an older version of the sent email (the user
  edited after saving, then sent) is kept and still offered, because it does not hold
  the sent content. Operations saved before this change carry no source draft and
  clear nothing.
- Closed in the browser build: the hosted result tap after a restart is a journey-level
  spec (`journey-f-hosted-result.spec.ts`) that shares the harness of
  `dev-hosted-journey.spec.ts` (`hosted-harness.ts`). It needs a local-agent build, so
  it is a separate file from the mail journey. The hosted service is a routed fixture.
- New-mail notifications are not implemented (pending decision A-05).

## J01. Poster → Calendar

Spec: `journey-j01-poster-calendar.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Scan a poster (canvas camera stream, real local English OCR) | yes | Physical camera capture | Real printed posters: focus, glare, skew, handwriting |
| Review suggestions; Cancel saves nothing | yes | — | — |
| Edit a suggestion, hand off to the separate Calendar review, leave without saving: nothing saved | yes | — | — |
| Hand off and Save in Calendar: exactly one event | yes (browser-local calendar) | Android CalendarProvider, calendar selection, scope denial | Provider account |
| Reload: the event persists once with the reviewed fields | yes | — | — |
| Home agenda card shows it and opens the same event; day view lists it once | yes | — | — |

## J03. Document analysis

Spec: `journey-j03-document-analysis.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Development incoming email with a text attachment; review it; Save to Files | yes (development mail simulator) | — | A real mailbox attachment |
| Files → open the saved document → Ask → review/trim excerpt → Use in conversation → Send | yes | Android document-provider grants | Real agent answer quality |
| Review summary note: Cancel saves nothing; edit and Save reviewed note | yes | — | — |
| Reload: one note with its source reference; Open linked source opens the exact document | yes | — | — |
| Source bytes change: the reference fails closed | yes (bytes changed directly in the Files database; no rendered control edits stored bytes) | A provider file changing under a persisted URI grant | — |
| Source deleted in Files: the reference fails closed, note unchanged | yes | Expired URI, revoked account | — |

## J04. Schedule → travel

Spec: `journey-j04-schedule-travel.spec.ts`

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Create an event with a location through the editor | yes | — | — |
| Reopen after reload; hand its location to Maps exactly once | yes (synthetic Maps provider) | — | Production Maps gateway, licensed data |
| Explicit destination, explicit origin (manual), explicit route choice | yes | Device location as origin, turn-by-turn Start | Location permission, GPS, physical navigation |
| Return to the same event without another hand-off: "Back to event" in Maps, and system Back | yes (`maps-event-return.spec.ts` covers two events with one address, a deleted or moved event, double activation and reload) | Android system Back | — |
| Travel-mode buttons expose the selected mode (`aria-pressed`); a refused mode is not selected | yes | — | Screen-reader check on a device |
| Reload does not replay the hand-off; a new tap is one new hand-off | yes | — | — |

Closed in the browser build:

- Maps shows "Back to event" only while it was opened from an event's location and
  Calendar is the view beneath it. It checks that the exact event (id and start) still
  exists, returns to that event and removes the cross-app step, so system Back does not
  reopen Maps. It never sets a search. If the event was deleted or moved, Maps stays
  open, says so and withdraws the control. The origin is view state only: it is gone
  after a reload, after Home, and when Maps is opened from the launcher.
- The travel-mode buttons expose `aria-pressed`. Round 2's accessibility branch did not
  change these buttons, so there is no overlap.

Still open:

- The control is not offered during active guidance.
- No Android run: the return uses the same `list` call the Calendar adapter uses, but
  only the browser build was exercised. `MapsInstrumentedTest`'s event-return method has not run.
- On a flag-off Android build with an installed map app, Maps opened from an event offers
  "Open in maps app" and hands the exact location text over once per tap
  (`journey-j04-android.production.spec.ts`, bridge stubbed). The journey's 8 of 8 in the
  core loop audit excludes a production route, which needs a Maps provider (A-23).

## J05. Web research → note

Spec: `journey-j05-web-research-note.spec.ts` (two serial tests)

| Step | Browser | Native-only | Human or device |
| --- | --- | --- | --- |
| Bounded review of a public HTTPS page excerpt (test-owned page fulfilled by the test) | yes | Excerpt extraction from the isolated native WebView and its revision binding | Real-site coverage |
| Ask with the development agent; answer shown | yes | — | Real agent answer quality |
| Explicit Save: exactly one note with a source link; reopen after reload | yes | Encrypted native Notes storage | — |
| Cross-origin reading denied: pasted text is reviewed instead and still saves one linked note | yes | On Android without isolated-world injection the review opens with an empty excerpt for pasted text, Continue disabled until text is entered (`browser-paste-fallback.production.spec.ts`, bridge stubbed) | — |

Native: `BrowserPageQuestionInstrumentedTest` ran in round 7 (`6dcdde34`): one of its four
methods passed on both flavors and three stopped because no WebView on that machine has
isolated-world injection. CI-2 (`android-emulator.yml`, WebView 157) has not been dispatched,
and `JourneyJ05InstrumentedTest` has not run.

## Breaks found by the audit and their disposition

| Loop | Break | Class | Disposition |
| --- | --- | --- | --- |
| A | Stop was not offered until the first streamed text arrived | product bug | Fixed in `agent-adapter.ts` (re-render once the request is pending) |
| B | A saved voice note had no Read aloud control | missing hand-off | Fixed in `voice-adapter.ts` and `template.html` |
| B | The reminder draft opened from a recording had zero duration, so Save reported a clock change | product bug | Fixed: the draft has a one-hour duration, and a form whose end is not after its start now says so (`calendar-end-after-start.spec.ts`) |
| J03 | A development Inbox attachment could be reviewed but not saved to Files | missing hand-off | Fixed in `mail-attachments.ts` and `simulated-inbox.ts` |
| E | A refused page question left the Browser menu open over the error | product bug | Fixed in `browser-adapter.ts` |
| J04 | An unavailable Bike mode reported that transit schedules were unavailable | product bug | Fixed in `maps-adapter.ts` |
| D | No explicit missed record in the browser development scheduler | gap versus proposed policy | Implemented by the workflows and digests package; journey D now asserts it |
| B | No direct calendar-event hand-off from a note; no link back to the note | missing hand-off | Fixed in `voice-adapter.ts`, `note-origin-adapter.ts`, `runtime/note-origin.ts` (browser build; device-calendar event link still open) |
| B | Browser "Delete event" deleted with no review, unlike the Android plugin | parity gap | Fixed in `browser/calendar.ts`; recoverability is a pending owner decision |
| F | A confirmed send left its local draft and unsaved copy on offer | missing hand-off | Fixed in `inbox-drafts.ts`, `inbox-provider-controls.ts`, `runtime/inbox-operation.ts` |
| F | Hosted result tap after restart had no journey-level spec | coverage gap | Added `journey-f-hosted-result.spec.ts` |
| J04 | No in-app return from Maps to the originating event; travel mode shown by color only | missing hand-off | Fixed in `maps-adapter.ts`, `calendar-adapter.ts`, `runtime/maps-event-return.ts`, `template.html` |
| F | Send after editing a reviewed email reopened the earlier review, so the earlier text could be sent | product bug | Fixed in `inbox-provider-controls.ts`: the stale review is discarded and the email is reviewed again (`journey-f-reviewed-send.spec.ts`, `mail-review.production.spec.ts`) |
| F | A forward's original attachments were not listed in the send review | product bug | Fixed in `inbox-provider-controls.ts` (`journey-f-reviewed-send.spec.ts`) |
| F | A double tap on Confirm landed on the Undo control that replaced it | product bug | Fixed in `inbox-provider-controls.ts` (`journey-f-reviewed-send.spec.ts`) |
| F | A later page that repeated a loaded message was joined without saying that newer mail was missing from the list | product gap | Fixed in `inbox-cloud-adapter.ts`: a notice and a "Load newer mail" control |
| J03 | "No preview · Save to Files" failed in the browser build | product bug | Fixed in `browser/mail-attachments.ts` (`inbox-hostile-attachment.spec.ts`) |
| B | The agent calendar review showed raw UTC timestamps and neither the calendar, the account nor attendees | product gap | Fixed in `browser/calendar-agent-review.ts` and `device-record-presentation.ts` (journey B, `calendar-proposal-review.production.spec.ts`) |
| A | A spoken turn with the development profile always stopped after the reply: the development agent returned no message identities | development fixture | Fixed in `development-connection.ts`; journey A now has a spoken request |
| D | The development profile's Home never showed a brief | development profile | It now reads the retained brief; journey D asserts the rendered card |
| E | Read aloud on a page whose address is no longer known was refused behind the open menu | product bug | Fixed in `browser-adapter.ts`; journey E navigates during the review |
| F | A saved review could still be sent after a reload with the edit only in the retained copy, or after the email was moved to another From account and sent there | product bug | Fixed in `runtime/inbox-operation.ts` and `inbox-provider-controls.ts`: a review is bound to its local draft and to the exact content in the composer when Send is confirmed (`journey-f-reviewed-send.spec.ts`, `scripts/test-inbox-sent-cleanup.ts`) |
| F | A message listed twice in one provider page was shown twice | product bug | Fixed in `inbox-cloud-adapter.ts` (`journey-f-reviewed-send.spec.ts`) |
| B | An agent update to an all-day event was saved with instants that are not whole dates | product bug | Refused before review in `browser/calendar.ts` (`calendar-agent-all-day-review.spec.ts`) |

## Gesture zones and the notifications panel (round 8)

Behaviour and tests are in [gesture zones](gesture-zones.md). The top-edge swipe is Android's
and Alpha's notifications open only from the "Notifications" handle on Home; that follows the
PRD ("Android status shade … is OS/role work, not CSS inside a launcher") and the flow audit
(F14: "not a replacement system shade"), so it was implemented, not decided here.

Owner decisions this leaves open. Neither is decided and the current behaviour stays until one
is recorded in [decisions](decisions.md#pending-owner-decisions):

| Question | Options | Current behaviour |
| --- | --- | --- |
| On the AOSP image, where do Alpha's own notices and the quick-settings tiles live? | (a) In Alpha's panel on Home, as now. (b) In Android's shade, through a SystemUI change in the image; Alpha's panel is removed. (c) Both. | (a). The panel lists Alpha's own notices, and on the launcher flavor the tiles that open Android's settings pages. |
| Should a downward swipe on Alpha Home open Android's shade, as stock launchers do? | (a) No Home swipe; the top edge only. (b) Home swipe expands Android's shade (needs `EXPAND_STATUS_BAR`). | (a). A downward swipe on Home away from the handle does nothing. |

The remaining "Still open" notes in this document, re-read in round 8 for plain defects:

| Note | Class |
| --- | --- |
| Reminder deletion from the detail page is immediate | Owner decision A-25 (reminders: review before deletion or not). Not changed. |
| A saved local draft that is an older version of the sent email is kept and offered | By design: the draft does not hold the sent content, so removing it would delete text the owner never sent. Not a defect. |
| The Maps "Back to event" control is not offered during active guidance | By design: leaving guidance is its own explicit action. Not a defect. |
| Device-calendar events from the Android Calendar hand-off are not linked to their note | They carry no Alpha creation id; the draft says so before Save. Events Alpha saves are linked by creation id since the pin `bc71e21f3b`. |
| The contract documents do not describe the note back-reference | Documentation owed by the contract's owner. Not product behaviour. |

## What no browser journey can establish

- Sign-in and keys: Eliza Cloud sign-in, Google OAuth, Cerebras key provisioning, real
  password-provider accounts, release signing.
- Owner decisions: A-09 (powered-off scheduling), A-11 (alarm ownership), A-05
  (background notification policy), A-10 (voice latency method) and the other entries
  under [pending owner decisions](decisions.md#pending-owner-decisions).
- Hardware: microphone and speaker quality, camera capture, GPS and navigation, ringing,
  Doze and battery, reboot, lock screen, HOME role and full-image boot.
