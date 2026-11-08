# Alpha Phone MVP completion plan

Updated 2026-10-12. The [implementation plan](implementation-plan.md) is the active
work order and the [32 approved TODOs](owner-approved-mvp-plan-2026-10-12.md) are the
checklists. The [earlier plan](https://github.com/eliza-research/alphaphone/blob/f3ccefd382bd40b29b06117c97da366c1e9b75a7/docs/mvp-completion-plan.md)
preserves historical evidence and superseded requirements. None of the journeys
below is accepted merely because its policy is now approved.

## Production surfaces

Qualify standalone and launcher debug/release APKs with mocks off. Qualify the
Alpha AOSP image separately; only it exposes Phone, Contacts, SMS and the privileged
always-on listener. The launcher flavor alone cannot enable image-only features.
Production has no hosted-agent connection, Cloud speech, wallet or app-data export.
Developer fixtures do not grant production capabilities.

## A. Boot, authenticate and keep a conversation

Boot into the real HOME or standalone app, start the resident agent and authenticate
Eliza Cloud service/subscription access without provisioning an agent. Send a real
request and verify local process execution, history and streamed answer. Repeat
network loss, background/restart, token expiry/revoke and account switch. Local
speech/tools work signed out; Cloud inference availability is explicit. No balance
or billing-service network preflight is added to each turn.

## B. Local speech, Notes, Calendar and reminders

Use Transcribe: Stop inserts editable text and never submits. Use Voice assistant:
short-gap semantic/Clef decision and long-gap automatic submit; continuing speech
cancels pending/in-flight response and playback without duplicate turns. Save and
read a voice note, create/read/update Calendar and a reminder through reviewed
operations, test ten-second deletion Undo and Notes three-day Trash. Measure last
speech sample to first audible response including endpoint delay. Verify local
speech offline on both ABIs and physical microphone/speaker acceptance separately.

## C. Alarms

Review an alarm handoff and open Android Clock on the actual AOSP image. Confirm
final alarm state in Clock; observe ring, snooze/dismiss, DND, reboot and time-zone
behavior. Alpha reports dispatch only unless creation is verified. Clock usability
and return-to-Alpha are part of acceptance, not assumed from an intent test.

## D. Two resident loops with the phone powered on

Run morning/evening loops from actual permitted sources while the phone is on.
Verify screen-off/Doze behavior, worker interruption and one user-visible result per
occurrence. When the phone was off at a scheduled time, record one missed occurrence
on restart, preserve the prior result and resume future times without overdue writes.
A deliberate Run now is a new authorized run. No hosted powered-off service is needed.

## E. Browser and password fill

Exercise persistent sign-in and allowed third-party cookies in normal isolated tabs,
ephemeral private tabs and clearing. Save/unlock/fill through the integrated vault
or optional provider, on each eligible Alpha login surface. Verify wrong-origin,
redirect/frame, lock/cancel and secret exclusion. Passkeys are not an MVP gate.

## F. Gmail, AOSP text messaging and notices

Use real Gmail incremental scopes, read/reply/draft/archive and authorized send with
exact reviewed attachments. Selected Files/Photos may become attachments only through
explicit review, then final Send. On AOSP, test Contacts and owned SMS/MMS/call
endpoints, SIM/role/permission denial and uncertain-send recovery; standalone has no
entry or agent bypass. System shade notices dedupe on reconciliation, disappear on
owner change, and valid pending approvals return quietly when their owner returns.

## G. Full library and Cloud Maps

Grant full media scope and let the local agent search/inspect the permitted library;
exercise partial access, downgrade, large catalogs and external changes. Follow an
actual Calendar address into Eliza Cloud Maps through agent search/place/route tools,
then start/stop/reroute native navigation with local TTS. Show coverage/freshness and
outage limits. Physical GPS/navigation is separate from simulated location tests.

## H. AOSP listening, presentation and reset

Opt in to always-on local listening; verify hardware invocation, visible lock/AOD
indicator, pause/revoke/mic toggle, reboot-before-unlock, call/audio focus and reliable
barge-in/stop. Record battery/thermal behavior. Review system shade and every responsive
surface on the image. Reset Alpha private data with confirmation, including workers,
listener, credentials and caches; verify no late callback restores erased state.
No backup/import/export feature or Wallet is part of this journey.

## Release acceptance

Use exact app, runtime, model, image and config revisions. Run `npm run verify` and
the strict Android build chain for both variants. Record APK packaging, emulator
HOME-role checks, Cuttlefish image boot, real Cloud/provider integrations, Pixel 10a
physical tests and target-user acceptance separately. Finish controlled signing,
updates, recovery and support handoff under Shaw. Keep failed/unrun evidence visible.
