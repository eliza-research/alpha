> Current renderer supersession: the authoritative fourteen-app prototype replaces the earlier seventeen-route implementation. This plan retains prior implementation history; [current capability status](mvp-current-status.md) is the current source-level gap ledger. Agent sending auto-connects the provisioned development transport; the former Settings-connect control is historical.

> Policy update 2026-10-12: [owner-approved TODOs](owner-approved-mvp-plan-2026-10-12.md)
> and [active implementation plan](implementation-plan.md) supersede conflicting
> requirements below. Local agent only; all speech on-device; subscription services;
> Pixel 10a Android 17; Phone/Contacts/SMS and always-on listening in AOSP MVP only;
> no Wallet or app-data import/export. Historical implementation evidence is unchanged.


# Flow implementation plan and acceptance ledger

Date: 2026-09-29. Target correction: Pixel 10 or similar **phone**, not tablet. (Superseded by decision P-15: the hardware target is Pixel 10a, codename stallion, on Android 17.) The available Pixel 9 emulator profile is a development approximation; it does not establish physical Pixel 10 support or acceptance. Read with `flow-audit-and-prd.md`, `native-capability-research.md`, `agent-integration.md`, and the existing implementation plan. This plan records a source inspection of the expanded app while implementation is underway. It deliberately makes no APK, emulator, provider, or physical-device passing claim. Later test reports should record the exact tested commit/artifact and update evidence without turning planned behavior into results.

## Source milestone

The expanded `apps/app/src/main.tsx` introduces navigation for Home, Maps, Camera, Photos, Notes, Calendar, Notifications, Reminders, Workflows, Files, Inbox, Browser, Phone, Messages, Contacts, Passwords and Settings. It provides contextual assistant entry, local note CRUD, manual workflow checklists, native operation receipts, Android handoff forms, native local reminders, notification history and scoped document text reading/opening. `daily.ts` contains local-storage data and the DailyApps bridge declaration. `DailyAppsPlugin.java` dispatches Android intents and returns speech/document selections. `runtime/alpha-client.ts` supplies the production transport boundary; `runtime/development-transport.ts`, the debug-source-set `DevelopmentAgentPlugin.java`, and `scripts/dev-agent.mjs` additionally implement an explicitly configured development session to a real model provider. That session is not production account authentication. The only executable development proposals are reviewed local-note creation and local-view navigation.

These are useful local and native-handoff foundations. They do not constitute a full mail/calendar client, recurring-reminder/task suite, browser automation, media library, audio recorder, credential manager or remote workflow engine. The native one-shot inexact reminder scheduler is now implemented in source; its operating-system delivery path still requires the separate native test evidence. The UI should keep those distinctions visible. The existing fourteen prototype views remain reference evidence; copied prototype success strings are never acceptance evidence.

## PRD coverage by source inspection

Status terms: **source present** means code inspected, **partial** means a narrower useful behavior exists, **missing** means implementation work remains, **provider blocked** means a real external deployment/account/provider is needed in addition to code, and **release blocked** means OS/hardware/signing acceptance remains. A source-present entry is not a test pass.

| PRD ID | Current implemented source scope | Incomplete work and dependency | Required next evidence |
| --- | --- | --- | --- |
| F01 setup/recovery | Existing HOME role request and Android app inventory; local data load; standalone/HOME architecture | Missing product onboarding, real auth, durable task/history restore and production callback registration | Both-flavor install/HOME loops; real owned account login/revoke/restart |
| F02 home/apps | Expanded navigation, real clock, saved-note/checklist counts, installed app launch | Partial: no data-backed agenda, favorites/search, ongoing native activity model | Add/remove application, return/HOME, empty/stale inventory, local counts after restart |
| F03 assistant/voice | All routes expose context; native recognition drafts; production client boundary; debug real-provider transport and exact approved create-note/open-view proposals | Partial: production pairing/authentication and durable remote history missing; no installed speech recognizer established; no continuous recording/playback or full four-size conversation | Debug actual provider response and approved local-note readback; real production auth/recovery later; speech unavailable remains explicit |
| F04 phone | ACTION_DIAL with number | Partial: no recents, voicemail, incoming/in-call, screening/recording | Correct number dispatch, no-handler phone path, authorized physical telecom suite |
| F05 messages | ACTION_SENDTO smsto handoff | Partial: no native thread list/read access, attachment flow or delivery confirmation | Compose recipient/body dispatch and return; delivery only with owned telecom endpoints |
| F06 inbox | Email-app handoff and To/subject/body draft | Missing built-in inbox, official OAuth, folders/thread/search, attachments, real send reconciliation; provider blocked | Owned account read/draft/send/readback, wrong-account/revoke/unknown-outcome |
| F07 calendar | Calendar-app opening; native insert with title/body/start/end | Partial: no calendar data readback, account/calendar selector, all-day/recurrence/invites or timezone conflict UI | Verify insert payload and cancellation; provider readback for actual saved event |
| F08 browser | HTTP(S) native dispatch; official Chromium development snapshot installed for testing; embedded credentials rejected | Partial: no owned browser bridge/tab UI/observation/proposals; development snapshot is not approved production browser; default-handler selection must be verified | Native Chromium page flow now; production signed native-host handshake later |
| F09 passwords | Native provider-settings entry; official Proton Pass installed on disposable emulator with publisher fingerprint match | Partial: provider account, enablement and actual password save/fill not performed; passkeys deferred under #402; production preinstall policy unresolved | User/provider-owned setup, owned test password save/fill and no secret in logs/model |
| F10 camera | Opens Android still-camera app | Partial: no capture-result attachment, review/retake, video/scan/OCR or embedded preview | Real camera opens; future captured bytes/URI readback and hardware matrix |
| F11 photos | ACTION_OPEN_DOCUMENT restricted to images; returned URI/name/type visible | Partial: document picker selection is not full photo library; no image rendering/edit/delete/albums/semantic search | Pick/cancel and readable URI, provider revoke; later actual preview/edit/export |
| F12 notes | Local CRUD, persisted unsaved-note draft recovery, dirty-navigation review, note-revision context invalidation, explicit note-text-to-request draft; approved development-agent create-note path saves locally and checks readback | Partial: no recording/transcript timeline, export/search/checklists or remote sync; native recognition needs provider | Save/edit/delete/restart, dirty navigation/storage failure, approve exact note once; real dictation when supported |
| F13 reminders | Native persisted one-shot reminder records; inexact AlarmManager scheduling; notification permission/channel checks; cancellation; boot/package-update restore; latest-deadline and duplicate guards | Implemented bounded local feature, not full F13: recurrence, snooze/complete, location triggers, exact timing and explicit timezone-change semantics missing; actual delivery tests pending | Schedule/background/post/tap/cancel/restart/reboot/denied-channel results on both flavors; posted is not seen or delivered-to-user |
| F14 notifications | Local reminder channel, private lock-screen/public-version notification, native tap event, posted-history UI and permission state | Partial: no remote push, cross-app listener, source summaries or exact reminder-detail selection on tap | Real notification post and tap, channel disablement, cold/warm start, duplicate suppression and locked-screen behavior |
| F15 workflows | Locally persisted three-step manual daily checklist, open step and manually mark done | Partial: no remote triggers, scheduler, real run execution, approval/cancel/retry/reconciliation | Checklist persistence/navigation now; real backend multistep run later |
| F16 files | Scoped picker; opaque native selection capability; text/JSON/XML UTF-8 preview bounded to 64 KiB; native viewer open; forget/reselect handling | Partial: no export/share/edit/directory manager; capabilities intentionally expire with process; selected text can be explicitly copied into a request draft and submitted by the user, not automatically transmitted | Actual chosen bytes/read/open, oversized/invalid UTF-8/unsupported type/revoked grant, process recreation and reselection |
| F17 contacts | Opens native contacts app | Partial: no contact result selection, built-in read/edit/search or disambiguation | Native dispatch/return now; contacts picker and provider readback later |
| F18 settings | Native settings/notification/autofill entries, handler availability, operation receipt list | Partial: no real account scopes, configurable appearance/voice policy, export/delete controls, updater | Honest availability and result labels; dynamic return/readback and preferences when implemented |
| F19 wallet | No wallet route or credential collection in expanded renderer | Intentionally deferred; payment/provider/security architecture and release blocked | Verify no fake payment success; qualified installed-wallet handoff only if added |
| A11Y-01–04 | Semantic buttons/forms/labels and responsive layout in source | Requires TalkBack, modal focus/Back, keyboard/text-scale/rotation and native-surface inspection | Actual phone interaction and screenshots, not DOM-only assertions |

## Current stopping points by flow

This is the final source-review status for this document update, not a native-test result. **Implemented** means source exists for the stated bounded behavior. **Incomplete** means more implementation is required. **External blocker** means a real service/account/image/operator step is additionally required; it must not hide remaining engineering work. No flow is promoted to native-tested here.

| Flows | Implemented bounded behavior | Terminal blocker or remaining work |
| --- | --- | --- |
| F01–F02 | Shell/HOME/apps/navigation/local persistence | Production registration/pairing, durable session recovery, account-backed overview; signed image/hardware acceptance external |
| F03 | Development real-provider calls, cancellation/context checks and reviewed local proposals; native recognition intent | Production owner authentication/history missing; speech recognizer absent on current image; production provider setup external |
| F04–F05, F17 | Native dialer/SMS/contacts handoff | Built-in provider/role integration incomplete; real telecom acceptance external |
| F06–F07 | Installed native mail/calendar entry and reviewed compose/event handoff | Live test accounts/OAuth external; full inbox/calendar UI/data adapters and readback incomplete |
| F08 | Native HTTP(S) dispatch and installed test Chromium | Owned Chromium component/native-host build and signer registration missing; snapshot is not the agent browser |
| F09 | Installed verified Proton provider and settings entry | Account/provider enablement and password save/fill acceptance external; passkeys deferred under #402; production redistribution/update decision open |
| F10–F11 | Camera handoff, scoped selection/photo preview | Capture-result/video/OCR/full gallery incomplete; actual capture/hardware acceptance pending |
| F12 | Local note CRUD and approval-bound development create-note readback | Native ASR provider external; audio recorder/transcription store/search/export/sync incomplete |
| F13–F14 | Native one-shot inexact reminders, cancellation, restore, notification posting/tap/history | Native execution evidence pending; recurrence/snooze/complete and remote/cross-app notification features incomplete |
| F15 | Manual multi-app checklist | Real scheduler/workflow integration incomplete; actual backend/provider run acceptance external |
| F16 | Opaque selected-file authorization, bounded UTF-8 text read, native open | Export/share/editor/directory operations incomplete; process death requires explicit reselection by design |
| F18 | Settings handoffs/capability status/development-connect UI/local history | Production account/privacy lifecycle/update controls incomplete; live status and native tests pending |
| F19 | Explicit deferral | Payment provider/custody/hardware design and approval external; no payment implementation claimed |
| A11Y/J01–J10 | Underlying local routes and contracts progressively implemented | Full cross-app and accessible phone execution pending; no composite journey passes merely because child routes exist |

The prototype target requirements remain unchanged. In particular, native one-shot reminder source does not close every F13 branch, and a development provider session does not close production authentication. Installed third-party app details and signature evidence are in `native-app-distribution.md`.

## Immediate integrity fixes before expanding scope

The review of the first expanded source identified these concrete risks; the parent implementation may already have addressed them. Verify the latest source and exercise them rather than assuming they remain or are fixed.

1. **Async receipt can overwrite newer local data.** `perform` awaits Android and `receipt` initially persisted a captured `data` object. A note saved or checklist changed during the pending native action could be lost. Use latest-state transactional mutation for receipt append and all asynchronous writes. Reproduce with a delayed bridge result and an intervening note save.
2. **Native result can land in the wrong editor.** A dictation initiated for note A initially appended to current editor state after await. Bind result to operation/context/selected-note revision; discard or explicitly recover the old result after a route or note switch. Never inject it into note B or the agent draft unexpectedly.
3. **Shared form fields cross domain boundaries.** The initial query/title/body values were shared by Maps, Phone, Messages, Inbox, Calendar and Workflows. A map query could appear as an email recipient or phone number. Separate per-domain drafts and intentional prefill actions; clear only the intended fields on an explicit new draft.
4. **Navigation completion bypasses cleanup.** Save/discard-and-leave initially called setView directly rather than the normal path, leaving selected-object/context state behind. Use one navigation completion function with predictable context and selection reset.
5. **Modal Back/focus needs priority.** Back initially collapses the assistant or navigates home while note dialogs remain open. Close/retain the topmost dialog first; trap/restore focus and make HOME behavior explicit without losing the draft.
6. **Stored data needs complete shape validation.** Initial `loadData` checked only top-level arrays. Malformed workflow steps or note fields can crash render. Validate bounded object shapes, versions, IDs, enums and timestamps before use; preserve unreadable raw data and expose an export/recovery path rather than overwrite.
7. **Capability state can change while outside Alpha.** The latest source adds refresh paths; verify them on resumed focus and after settings/provider changes. “Native handler available” is not provider account setup, permission grant, actual task completion or agent access.
8. **Restored native selection must be consumed deliberately.** Android can restore a picker/recognizer result after Activity/process recreation. Native restoredResult events need a subscribed, identity-bound recovery path. Native code emitting the event alone does not restore the user's selected file or transcript in the UI.
9. **Picker metadata is not file access evidence.** Verify bytes can be opened with bounded reads; persist only intended URI grants and handle grant revocation/reselection. The selected name alone cannot be used to promise preview/upload/export.
10. **Receipts must distinguish handoff and completion.** An intent dispatched to Calendar, Camera, Mail or Browser warrants “opened”; it never implies saved event, captured photo, sent message or loaded page. A receipt write failure must not reclassify an already-dispatched native action as never performed.

## Phone source review: remaining local flow risks

This review is source-only while separate phone smoke testing runs. Findings describe the inspected snapshot and must be rechecked against subsequent fixes; they are not assertions of a reproduced native failure.

- **Selected-file identity and stale text:** starting a new picker selection must clear the previous file preview immediately. An asynchronous read must apply only if its captured selection ID and route epoch still match. Otherwise file A content can be shown or copied into a request under file B metadata. Test A-read → B-select and slow A-read → clear/navigation.
- **Assistant height on a phone:** the total assistant history/proposals needs one bounded scroll region. Individual 35dvh response/proposal limits do not bound several cards plus input within a shrinking IME viewport. Minimize must actually collapse history; input, stop/cancel and the active tool must stay reachable. Test a long response plus four proposals with the keyboard open.
- **Reviewable outbound draft:** both assistant composers now use bounded multiline editors with internal scrolling. Shift+Enter inserts a line; Enter sends only outside IME composition. Chromium checks cover light/dark themes, 915px and 420px viewports, expanded conversation, contraction after shortening and one explicit send. Copying to a draft is not sending. Physical keyboard/IME and current native geometry remain separate acceptance, and restart retention remains open below.
- **Notification object return:** consume the native reminder ID in the tap event, select and scroll/focus its record, and handle a missing/cancelled record. Routing every tap to the generic list is an incomplete deep link.
- **Revision invalidation on all edits:** discard/revert and recovered text must invalidate old note proposals just as typing and dictation do. Verify after editing → asking → reverting that the old proposal cannot mutate a different revision.
- **Draft availability:** Notes retain local drafts. Inbox has an explicit owner-scoped Save/Restore flow using compare-and-swap storage (`prototype/inbox-drafts.ts`); edits after the last save now have a separate account-bound recovery copy. Calendar creation and inline existing-item forms retain local drafts. The assistant now retains conversation-bound text drafts with explicit conflict recovery; selected-source authority is never restored from a saved draft. Calendar/Reminder creation forms now have explicit retained-form recovery with original creation identities and civil dates. Inline existing-item edits retain their original revision targets; the separate recurring/all-day editor also retains per-event drafts with original revisions and explicit recovery. Post-save Inbox edits now restore explicitly with their original saved revision and no retained provider approvals. Saved Inbox draft support must not be reported as missing, and its native process-death acceptance remains separate from browser recovery evidence. This is a current source observation, not a process-death acceptance result. A malformed draft record must not prevent access to valid saved records or overwrite their store.

These are local engineering/UX gaps, not account-provider blockers. Phone-native visual acceptance must verify them through actual scrolling, keyboard and Back/Home actions; DOM-driven clicks may bypass offscreen controls.

### Assistant draft recovery

The composer saves text plus binding/revision metadata. Binding uses origin, verified
owner, agent and authoritative conversation selection; offline text has a separate
identity. Browser writes use the upstream transactional document store, while the
Android adapter admits a narrowly named encrypted draft slot. Revisioned empty records
prevent stale writes after clearing. No selected-file handles, proposal authority or
message receipts are serialized into a draft.

The UI shows saving, saved, restored and failure states. Competing edits retain the
current text and display the saved copy for an explicit Restore or Replace choice.
Late reads cannot populate a retired binding. Send waits for pending saves, checks the
current screen/session and clears the saved draft before dispatch; invalidating a known
clear restores its original text only while that clear's revision remains current.
Restoring a draft never sends it. Browser corruption recovery downloads original saved
bytes plus current text before a confirmed revision-checked reset. Android now exposes the same explicit recovery for readable records with invalid
draft schemas. It retains the exact secure-slot bytes as the reset receipt and exports
backups through the existing reviewed document picker. Unreadable ciphertext remains
untouched and cannot be reset through this flow. Native/device lifecycle and document
provider acceptance remain unqualified.

Controller/storage and rendered browser campaigns cover the implemented boundaries;
full repository verification is tracked on the PR. No APK build or physical keyboard,
process-death, encrypted-storage or device acceptance is implied by browser evidence.

October 27 source move: the controller, the draft row and its compare-and-exchange stores
are shared Eliza code (`packages/ui/src/state/durable-draft-controller.ts` and
`durable-draft.ts`, consumed through the pin's client projection). Alpha keeps only its
installed identities and adapters: `assistant-draft:v1:` plus the binding hash as the
Android secure slot, `alpha.browser.` documents in the browser, and the recovery dialog's
capture shape (`runtime/assistant-draft-store.ts`, `native-assistant-draft-recovery.ts`).
`prototype/assistant-draft-controller.ts` and `runtime/assistant-draft-record.ts` only
re-export the shared code under their existing names. The send protocol is unchanged:
hold keeps the saved copy while a message is in flight, release returns it only when
dispatch certainly did not happen, and commit clears it after a dispatch or an unknown
outcome, so an uncertain message is never offered for a second send.
`test/browser/chat-continuity.production.spec.ts` runs the flag-off bundle with the
resident stub: the device draft slot survives HOME, Back, a keyboard-sized resize (same
field, focus and selection) and a restart; a held reply survives Back from full to sheet
and HOME on Home and is shown once; the transcript keeps its reading position through the
same steps. That is renderer source evidence only (class S), not IME, Android Back/HOME or
device acceptance.

The in-flight copy is also durable across process death: hold writes the saved row with
`sending: true` (rows without the mark, including every installed one, read as before), and
release and commit write it without the mark. A start that finds a marked row it did not
write (after the app was killed during a send, or in another window) never restores it into
the composer; it shows "This message may already have been sent. Check the conversation
before sending it again." with the saved copy, Restore saved draft and Replace saved draft
with this text, and refuses to send until one is chosen. The production and development
continuity specs restart during a held reply and check that nothing is posted again.

A prompt sent from outside the composer (a suggestion, a Calendar decision, a reviewed
email) no longer holds, clears or commits the composer's draft, reply target or reviewed
source: the person's unsent words stay in the composer and in their saved copy
(`context-selection.spec.ts`, mail).

The phone canvas's keyboard-free height, its soft-keyboard test and the list-detail and
calendar layout decisions (`runtime/canvas-geometry.ts`) and the dock-clearance publisher
(`runtime/dock-clearance.ts`) are shared Eliza code as well
(`packages/ui/src/components/shell/responsive-layout.ts` and `dock-clearance.ts`); Alpha
supplies its breakpoints, selectors and installed custom-property names.

## Upstream extraction and native integration packages

Do not modify `vendor/eliza` as a shortcut or activate `base/eliza-app` as the product. Generic additions are reviewed upstream commits that reach this repository through a reviewed pin move in `upstream.lock.json` (the `patches/eliza` series is historical, retired in `34b3c82a`). Keep `upstream.lock.json` consistent with an intentional submodule upgrade. The local DailyApps intent dispatcher is an interim product handoff adapter; avoid expanding it into a second shared platform implementation.

| Package | Exact existing source to extract/extend | Required change | Exit condition |
| --- | --- | --- | --- |
| U01 consumer auth | `vendor/eliza/packages/ui/src/android-cloud/android-cloud-client.ts`, `android-cloud-auth.ts`; `packages/app/src/api/auth-pairing-routes.ts` | Parameterize registered mobile client identity and callback, export narrow dependency-safe interface, bind owner/agent/origin; preserve actual upstream conversation protocol | Alpha registered package/signer callback, wrong-origin/state/replay rejection, real conversation result |
| U02 secret storage | `vendor/eliza/plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/SecureStorePlugin.kt`; upstream `ElizaSecureCredentials` registration used by auth | Align real native registration/method contract; protected pending/staged/active token and PKCE storage; lifecycle cleanup | No renderer token storage; interrupted login recovery; revoked token rejected |
| U03 launcher/app inventory | `vendor/eliza/plugins/plugin-native-system`; local `DeviceAppsPlugin.java` | Move generic launchable-app enumeration/explicit launch/package changes into upstream platform interface; keep product ordering/identity local | Removed/disabled/work-profile/duplicate-label cases; no broad package-query privilege |
| U04 camera/media | `vendor/eliza/plugins/plugin-native-camera/src/definitions.ts`; Android `CameraPlugin.kt`, `GalleryImageWriter.kt`, `CameraDeviceReader.kt` | Consumer-safe registration/build; actual photo/video result URI, lifecycle cancellation, media permissions and bounded capture metadata | Both consumer variants compile and capture/reopen actual media; physical optics tests separate |
| U05 files/photos | `vendor/eliza/plugins/plugin-native-filesystem/src/services/device-filesystem-bridge.ts`, `src/path.ts`, `src/types.ts`; local DailyApps selection callback | Native SAF open/read/export/share with persistable grant lifecycle and bounded streams; photo-selection adapter; product preview and selected-artifact store | Revoked/missing/cloud-offline/large/malicious file suite and export bytes verified |
| U06 voice | `vendor/eliza/plugins/plugin-native-talkmode/src/definitions.ts`, Android `TalkModePlugin.kt`; `packages/ui/src/voice`; `packages/agent/src/services/audio-redaction-service.ts` | Foreground capture/stop/cancel/playback, audio focus, ASR adapter and declared processing destination; product transcript review | Actual recording and real transcription; interruption/offline/no-service behaviors; no secret echo |
| U07 Android calendar | `vendor/eliza/plugins/plugin-native-calendar/src/definitions.ts` currently Apple API; `plugin-google-workspace` server calendar integration | Add true Android CalendarContract adapter or product-neutral interface with capability differences; use remote OAuth connector separately | Correct account/calendar IDs, read/write scopes, recurrence/timezone/readback; no Apple-only import assumed Android |
| U08 reminders/notifications | `vendor/eliza/plugins/plugin-native-reminders/src/index.ts` currently macOS policy; `plugin-native-mobile-signals` does not provide full notification inbox | Extract product ReminderStore/ReminderReceiver/DailyApps scheduler into reviewed generic Android interface after qualification; extend one-shot support with recurrence/snooze/complete and explicit timezone semantics; optional listener separately | Real background fire, snooze/complete/cancel, denied permission, reboot and duplicate callback tests |
| U09 browser | `vendor/eliza/plugins/plugin-native-browser-surface/android/.../BrowserSurfacePlugin.kt`, `ChromiumBrowserIdentity.java`, `ChromiumBrowserLauncher.kt`; `packages/os/browser` | Consumer native-host identity/certificate adaptation, build-pinned browser signer, native messaging ownership, frame/context epoch and sensitive-screen pause | Signed owned browser handshake and real observe/propose/approve/execute/fresh-observe cycle |
| U10 browser provisioning | `vendor/eliza/packages/os/scripts/distro-android/prepare-chromium-browser.ts`, `packages/os/browser/scripts/chromium-component.mjs`, its `scripts/chromium/upstream.json` pin | Product release configuration and signed native-host/browser artifacts; explicit update/rollback chain | Reproducible build and boot, browser package signer and ABI compatibility on target image |
| U11 notes | `vendor/eliza/plugins/plugin-notes/src/browser.ts` and server notes routes | Revision-aware account-scoped sync behind renderer-safe adapter; local drafts stay independent and conflict review preserves both versions | Real sync/revoke/offline conflict tests with no lost note |
| U12 inbox/calendar connectors | `vendor/eliza/plugins/plugin-google-workspace` | Node-only provider code stays backend; expose account-scoped route contracts, read/write scopes, attachment stream IDs and reconciliation | Owned mailbox/calendar full flows and no tokens/provider SDK in renderer |
| U13 task policy/workflows | `vendor/eliza/plugins/plugin-workflow/src/routes`, `src/services`, `src/db`, `src/actions`; `packages/core/src/services/approval.ts`; `plugin-personal-assistant/src/actions/lib/approval-execution.ts` | Durable proposal/version binding, run-state API, cancellation epoch, unknown-outcome reconciliation, deduplication and explicit product permissions | One real approved multistep workflow, kill/restart and duplicate trigger produce one effect |
| U14 phone/messages/contacts | `vendor/eliza/plugins/plugin-native-phone`, `plugin-native-messages`, `plugin-native-contacts` | Validate actual Android role/permission support before importing; separate dispatch, selection, provider reads and delivery evidence | Native selection/account disambiguation plus physical telecom tests for call/SMS features |

Source paths above identify inspected packages, not guarantees that every proposed method already exists. U07 and U08 specifically require new Android implementation. Official API and provider source references live in `native-capability-research.md`; do not substitute guesses about plugin names for consumer build evidence.

## Dependency-ordered delivery slices

**S0 — reliable local shell:** repair integrity findings; preserve independent Alpha visuals; implement per-view drafts, latest-state transactions, selected-object binding, modal navigation, corrupt-store recovery and capability refresh. Run complete Notes/checklist/native-handoff journeys before increasing integration scope.

**S1 — useful native artifacts:** return actual captures, render selected photos, preview bounded documents, export/share notes, add real recorder/playback. Keep all cross-app effects user-reviewed and results scoped to actual native completion.

**S2 — connected agent:** U01/U02 plus alpha-client composition, approved deployment registration, actual owner account, native token storage and durable history. Route current opaque context from every view; reject stale results. Implement visible real streaming/cancel/error states. This is a prerequisite for claiming agent integration rather than contextual UI affordances.

**S3 — mail and calendar:** U07/U11/U12 plus inbox threads, note sync and full event editor. Complete J01/J03/J04 with provider readback. Recurrence/attendee external effects require exact preview, source identity and outcome reconciliation.

**S4 — scheduling and notifications:** the product now implements one-shot native scheduling/history/post/cancel/restore. Qualify that path, consolidate generic pieces into U08, then add reminder detail/recurrence/snooze/complete and U13 true workflow runs. Manual checklists can remain a distinct feature, not a fake workflow execution engine. Complete J02/J07 with actual background results.

**S5 — owned browser and credentials:** U09/U10, provider provisioning and user enablement, real observation/action controls, native credential wait/resume, tabs and download/upload. Complete J05/J08 without exposing secrets to the model. Settings launch alone does not establish autofill.

**S6 — qualify product:** every applicable F/J/A11Y case on both APK modes, actual AOSP image boot with required default apps/services, physical hardware and provider acceptance, signed upgrade/rollback and user pilot. Keep non-GMS dependencies explicit. Record unavailable services rather than silently fall back to simulations.

## End-to-end execution matrix

All native execution rows below are **not run by this document's author**. Official third-party APK installation and read-only package-resolution evidence is separately recorded in native-app-distribution.md; that does not pass the full-flow rows. Parent test evidence may independently supersede them. Use a disposable phone emulator; prohibit accidental outbound communication to real contacts. Native app dispatch checks should inspect the resolved Activity and encoded payload, then also use the visible UI to verify the intended screen. When no installed handler exists, exercise the unavailable branch and retain the incomplete capability in the report.

| Suite | Steps and assertions | IDs | Needed environment |
| --- | --- | --- | --- |
| Local persistence | Create note → save → navigate → reopen → edit → restart app → exact body preserved → delete/cancel and delete/confirm | F12, F18 | Web and both APKs |
| Local concurrency | Delay voice/file result → save different note or checklist state → return result → new data remains and wrong editor is untouched | F03, F12, F15 | Controllable contract adapter, then actual Android lifecycle |
| Dirty/modal navigation | Edit note → switch view → keep/save/discard; press Back/HOME; focus stays correct; selection/context resets after leave | F01, F02, F12, A11Y | Phone UI with keyboard and TalkBack |
| Manual checklist | Create → open calendar step → return → mark done → reopen → restart → remove | F15 partial | Web and both APKs |
| Native handoffs | Map address, phone number, SMS, inbox, mail draft, calendar insert, browser HTTP(S), settings, autofill settings | F04–F09, F13 partial, F18 | Emulator handlers; do not claim send/save |
| Native selection | Pick image/file → exact metadata and readable URI → cancel → external revoke → recover; Activity recreation consumes restored result | F11, F16 | DocumentsUI and controlled test files |
| Real capture/voice | Capture/retake/open pixels; record/playback; dictate actual phrase → review/save; deny/no recognizer/audio interruption | F03, F10, F12 | Emulator camera/audio + qualified services; hardware follow-up |
| Credential/browser | Default provider setup → owned test site → password unlock/save/fill → HTTP authentication manual entry (provider fill disabled pending authenticated origin) → cancel/wrong origin → agent resumes sanitized context | F08, F09, J08 | Signed target Chromium, test vault/provider |
| Agent ownership | First qualify debug real-provider response and exact approved local create-note/open-view; separately pair production owner A → send → result → cancel → sleep/network off/kill → recover once; switch owner B rejects late A result | F01, F03, J10 | Approved real endpoint and owned test accounts |
| Mail/calendar | Real read/write with source account, attachments, invitations, recurrence/DST; lose response → provider reconcile without duplicate | F06, F07, J01, J03, J04 | Owned mailbox/calendar and safe recipient |
| Reminder/notification | Near-term schedule → background → actual alert → deep link → snooze/complete; deny/channel off/reboot/timezone/duplicate | F13, F14, J02 | Real native scheduler and notification service |
| Remote workflow | Reviewed trigger/version → actual run → wait/approve → one harmless provider effect → cancel/fail/restart/duplicate trigger | F15, J07 | Real workflow backend and owned provider |
| Resilience/accessibility | Portrait/landscape, text enlargement, keyboard, TalkBack, offline, low storage, corrupt data, app removal and permission revocation | A11Y, all applicable F | Disposable phone; explicit destructive fixture only |
| Distribution | `npm run verify`; `npm run android:build`; exact APK hashes/manifests; both modes install and HOME behavior; AOSP boot separately | F01, release | Build toolchain, emulator, then image build/hardware |

Passkeys are outside MVP completion under the approved #402 policy. Keep password
unlock, save, fill, cancellation and wrong-origin checks in the credential suite.
A separate post-MVP system-provider follow-up must qualify browser/image support,
passkey creation/use, origin binding and private-profile behavior before enabling
WebAuthn; Alpha does not currently provide passkeys. The MVP browser must state
that limitation and offer an explicit external-browser handoff when available.

## Completion reporting

The next report should contain the exact changes, the useful narrower behaviors that actually work, and a table separating source present, local E2E pass, Android native pass, computer-use pass, real provider pass, AOSP boot and physical acceptance. Tests that require unconfigured providers are blocked or not run, never green. If a native handler is unavailable, the unavailable-state test may pass while the requested integration remains incomplete. Record that distinction explicitly.
