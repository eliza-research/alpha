# Alpha Phone — complete flow audit and product requirements

Date: 2026-09-29. Target correction: Pixel 10 or similar **phone**, not tablet. (Superseded by decision P-15: the hardware target is Pixel 10a, codename stallion, on Android 17.) The available Pixel 9 emulator profile is a development approximation; it does not establish physical Pixel 10 support or acceptance. Scope: Alpha Phone only, its fourteen designed built-in experiences, shared launcher/assistant flows, and the requested reminders, notification, credential, and transcription journeys. This is a requirements and source-audit document, not evidence that those experiences are implemented or have passed acceptance. Native/API/vendor research accompanies this document separately.

> October 12 scope update: approved [#402](https://github.com/eliza-research/alphaphone/issues/402)
> defers passkeys outside MVP. Historical F09 passkey requirements below belong to
> a separate system-provider/browser/image qualification follow-up. Password
> unlock, save, fill, wrong-origin refusal and cancellation remain MVP gates.

## Evidence and audit finding

The audited baseline is `apps/app/src/main.tsx`, `native.ts`, `useDevice.ts`, the fourteen `registerView` declarations and their state/back/actions in the [archived prototype](https://github.com/eliza-research/alphaphone/blob/bfb0c54abff6c18035f58a554c68f096b3918b75/design/prototype/index.html), `docs/prd.md`, `architecture.md`, `implementation-plan.md`, `decisions.md`, and `requirements.json`. The design HTML is reference data. Its simulated sign-in forms, timers, seeded messages, bookings, calls, balances, transcripts, memory sizes, battery statistics, model downloads, and security claims are not implementation contracts or real service results.

At audit time the active renderer has one home screen, a clock, installed-app grid, a collapsed/expanded unconnected composer, Talk unavailable notice, Android settings handoff, and HOME selection. Only `DeviceApps` and `plugin-native-system` are registered in its TypeScript native adapter. No active domain view, pairing session, cloud response, recording, calendar, mail, browser engine, persisted notes, reminder scheduler, or credential provider is wired there. Existing APK/instrumentation evidence proves only the recorded foundation behavior.

The prototype's fourteen registered views are Phone, Messages, Inbox, Calendar, Browser, Camera, Photos, Maps, Notes, Contacts, Files, Wallet, Workflows, and Settings. Reminders and notification history need explicit product routes. Passwords need a provider setup/status route and native credential interaction; they do not need a second Alpha vault. The prototype also has boot/lock, shade, home, ongoing-activity chips, cross-app navigation, and four assistant sizes.

Critical design gaps:

1. Every simulated success currently outruns the active implementation. A route existing must never imply its capability works.
2. Authentication, account ownership, session recovery, consent boundaries, cancellation, and uncertain remote results lack implemented flows.
3. The prototype hides the assistant on many detail and immersive views. Every view needs an accessible contextual invocation; third-party apps need a separately qualified native assistance surface.
4. Native app handoff is not the same as embedding, observing, or controlling that app. Display those capabilities separately.
5. Reminders have no dedicated designed home; notification permissions, listener access, background reliability, and reconciliation need explicit flows.
6. Camera/photo/file actions require durable content URIs and permission/lifecycle handling, not seeded objects or base64 screenshots passed indiscriminately to an agent.
7. Voice requires actual captured audio and editable transcription, with interruptions and retention handled independently of generated text.
8. Browser and credential work require origin-bound native boundaries. The production WebView must not navigate to arbitrary third-party pages while retaining the app bridge.
9. Prototype claims about local models, enclave privacy, attestation, Android version, and available battery are unverified. The agent now runs on the phone while text inference is hosted (Cerebras, Qwen), so local-model and enclave claims remain false. Replace them with actual capability/status evidence.
10. Calendar/workflow/reminder time semantics, drafts, account switching, duplicate results, and lost responses need first-class states.

## Product decisions for implementation

These are best-guess working decisions so engineering can proceed. They do not claim provider contracts, provisioning rights, hardware support, credentials, or security certification already exist.

| Decision | Chosen working behavior | Revisit when |
| --- | --- | --- |
| Product identity | One Alpha Phone renderer and package; lowercase `a` brand mark, Alpha visual language, no sibling-product UI imports | Brand owner deliberately revises identity |
| Distribution | Standalone and HOME flavors remain alternative installs of the same package | Release strategy changes |
| Supported development target | Pixel 10a on Android 17 (P-15; originally "Pixel 10 or similar phone"); use installed Pixel 9 emulator definition as the closest available test profile, with actual geometry recorded per run | Hardware selection adds a distinct target |
| Agent location | Cloud execution through approved owner/agent-scoped Eliza transport | An explicit reviewed architecture changes it |
| Native strategy | Android owns lock, shade, permission dialogs, role selection, secure prompts, picker, camera/handoff and default apps; Alpha owns orchestration and task views | A qualified native plugin provides embedded functionality |
| Local data | Offline-first user-created notes and drafts, durable IDs and schema migrations; no raw credentials in renderer storage | Account-backed synchronization is implemented |
| Calendar | Android calendar integration where usable; account-backed API for remote provider support; identify one authoritative calendar for every write | Provider research/qualification narrows supported calendars |
| Email | Official OAuth and account-scoped provider adapters; native email compose handoff remains useful independently | Additional providers pass full tests |
| Maps | Search/destination handoff to an installed map application first; no invented routes/ETA; embedded map is a separately configured capability | A licensed, functioning tiles/search/routes provider is selected |
| Browser | Qualified native Chromium-based browser or isolated native surface; approved bridge for agent observation/action | Exact engine/build/signature contract is verified |
| Password manager | Provider-managed vault/autofill with explicit Android enablement; evaluate Proton Pass alongside compatible alternatives in research | Redistribution, branding, managed provisioning and bridge support are verified |
| Notifications | Own-app notifications first; cross-app notification access optional and separately granted | Listener implementation and privacy controls pass tests |
| Reminders | App-owned reminder records with real native scheduling, timezone rules and delivery evidence; remote agent scheduler is distinct | Scheduler ownership is intentionally unified |
| Automation | Reuse Eliza workflow execution and run history; local prototype builders never pretend to run remote steps | Shared contracts are qualified |
| Wallet | No card capture, fake payment, or security assertion. Native wallet handoff may be exposed if installed | Provider/custody/payment architecture is approved and verified |
| Defaults | Setup recommends useful providers and explains enablement; no hidden privilege escalation or silently accepted provider terms | Managed-device provisioning is explicitly in scope and supported |

## Universal interaction and agent contract

Every built-in route has a title, predictable Back destination, Home access, visible capability status and an “Ask Alpha about this” affordance. On the phone, the assistant expands without losing the source view; landscape adapts to the available width. Camera, recording, photos, video, compose, browser, permission, and error states retain an accessible invocation or an explicit native-system boundary. Do not place controls under gesture insets, a keyboard, another native surface, or secure prompts.

The four assistant presentations are pill, input, overlay, and full conversation. Resizing preserves draft, selection, scroll, active task, and keyboard focus. Back closes the innermost picker/dialog/keyboard first, then collapses assistant, then navigates the domain stack; HOME returns to home without restarting work. Android HOME behavior and browser Back behavior must be tested independently. A full-screen call, navigation or recording continues under its native lifecycle and exposes a factual ongoing-activity entry.

Every agent request carries a typed context envelope: route and subview; owner/session epoch; selected account; stable object ID; object revision; source/provider; user-visible title; approved content/reference; allowed capability set; sensitivity flags; timestamp; and navigation return target. Context is refreshed when selection changes. No stale conversation proposal may act on a new account or a changed object. “This” with multiple selected objects requires visible disambiguation. The UI shows which object/context is attached and permits removing it before sending. Account passwords, passkeys, OTPs, private tokens, secure fields and unapproved attachments never enter the model context.

A request is `draft → submitted → working → result`, with independent `approval-needed`, `cancel-requested`, `cancelled`, `failed`, `offline`, `expired-auth`, and `outcome-unknown` branches. Cancellation stops future work; it cannot promise rollback of a completed external effect. Reconnecting fetches authoritative state by task/operation ID and deduplicates events. Never retry an ambiguous send, booking, deletion, event creation, or payment automatically.

An action proposal shows exact operation, selected account, target/recipient, relevant content, consequences, and source object revision. Local navigation/search need no confirmation. External sends, destructive changes, sharing/upload, credential fill, new recurring automation, and account access use explicit contextual approval. User edits invalidate the previous proposal. Results say “Opened Camera”, “Draft prepared”, or “Request sent” when that is all that is known; “Saved”, “Sent”, “Delivered”, and “Scheduled” require corresponding evidence.

Every data view handles loading, empty, ready, stale, partial, offline, permission denied, permission permanently denied, not installed, unsupported, authentication expired, rate limited, failed, and cancelled when applicable. Unknown is different from empty. The error appears near the affected control with a recoverable action; global notices must not require returning home to discover a failure.

## Flow specifications and end-to-end acceptance

IDs below are stable acceptance identifiers. A test can exercise several IDs but each ID needs a result and evidence reference. All flows are planned unless a current implementation run independently verifies them.

### F01 — first launch, HOME setup, and recovery

Entry: installing either flavor, first launch, a setup reminder, or Android changing the default HOME application.

1. Explain Alpha and cloud assistance; offer “Continue without connecting” for local/home use.
2. Identify actual flavor/capabilities. Offer HOME role only in launcher flavor through Android's role UI.
3. Pair the owner and agent using the approved authorization flow; display the returned identity and connected state.
4. Offer optional microphone, notification and provider setup at their first meaningful use, not as an all-or-nothing permission wall.
5. Reach home with genuine date/time and actual apps; incomplete setup remains accessible from Settings.
6. Restart/resume reconciles actual HOME role, app inventory, account session, outstanding tasks, URI grants and schedules.

Branches: role denied/revoked; callback cancelled/expired/replayed/wrong origin; no network; no agent assigned; stale token; wrong owner; application upgraded; process killed; restored data with invalid credentials. A declined HOME role must not trap the user. Standalone Back exits naturally. Stock settings and emergency/system access remain reachable.

Agent context: setup progress and capability flags, never authentication secrets. Acceptance F01: fresh install both flavors, skip/pair, decline/accept HOME, switch HOME externally, upgrade/restart, then verify truthful state and no repeated effect. Real auth requires a real test identity; a mock transport passes only contract tests.

### F02 — home, app library, search, and ongoing activities

Home shows actual time and source-attributed agenda/attention cards only when connected. Unconnected cards explain setup rather than presenting fake appointments. App library searches installed labels, supports empty results, refreshes after install/remove, handles duplicate labels by package identity, and launches the intended component. Opening a nonexistent/disabled/work-profile-locked application produces a useful error. Favorites/order persist locally. Do not infer availability of a browser, map app, camera or mail handler from its branded name alone.

Ongoing chips represent native recording/navigation/call or agent tasks only when their status is known. Tapping returns to the exact activity or run. Dismissing a chip does not silently cancel a recording or send. Agenda cards expose source account and freshness and deep-link to the object. Contextual home assistant can navigate or summarize granted sources; search text alone never authorizes an external action.

Acceptance F02: installed-app add/remove/duplicate labels, rotation, no apps, no data, stale data, return from three native apps, HOME while a task runs, and reopen the same task without duplication.

### F03 — agent conversation, voice request, and lifecycle

Typed request: invoke from any route, inspect attached context, enter text, submit once, observe streamed progress, optionally stop, read final source-backed response, follow result link, and return to original view. Multiturn replies preserve session/task identity and can switch context deliberately. Attachment selection is explicit.

Voice request: tap microphone, explain processing destination, grant recording access, show listening indicator/time, capture audio, stop or cancel, show editable transcript, then submit according to chosen explicit send preference. Continuous talk mode must visibly distinguish listening, thinking and speaking. TTS can be stopped; barge-in stops playback before recording. Audio-focus loss, call, Bluetooth changes and screen lock have defined stop/pause behavior. No silent always-on recording.

Branches: microphone denied/permanently denied, service unavailable, ASR error/partial transcript, no speech, long silence, network loss, duplicate stream event, application death, delayed result from old account, revoked session, TTS failure. Preserve typed/approved transcript drafts; never fabricate a transcript. Cancelled audio is deleted according to displayed retention policy.

Acceptance F03: send and receive via real configured agent, reconnect with exactly one result, background/kill/reopen, cancel in every state, real microphone transcription with correction, headphone/audio-focus changes, and typed fallback. Each of the fourteen domain views plus reminders/notifications/password setup supplies correct context in a contract test and is exercised manually in the emulator where feasible.

### F04 — Phone

Designed subflows: recents, favorites, keypad, contact lookup, outgoing call, incoming call, in-call controls, voicemail, call screening, transcript/notes, minimized call and return.

Initial implementation uses native dialer handoff with a reviewed number; opening the dialer is not a completed call. Real recents/voicemail/incoming/in-call UI is shown only when a qualified role/provider exists. Device lacks telephony or SIM: explain and retain number copy/contact options. Emergency access remains Android-owned. The agent can prepare a call, identify a selected contact, or summarize an explicitly available transcript; it cannot claim call screening or recording from a UI timer.

Acceptance F04: pick a contact with multiple numbers, cancel selection, open correct dialer number, return, deny role, phone without telephony. Test real calls, voicemail and audio only in a dedicated authorized telecom environment; emulator dialer handoff does not satisfy that gate.

### F05 — Messages

Designed subflows: thread list, unread/search, thread, new recipient, group/multiple recipient disambiguation, compose, attachment selection, draft, send, failed/retry, incoming notification and return.

Initial behavior prepares SMS in the native message handler. A full built-in thread requires the proper native role/data adapter. Preserve composition across navigation; verify all recipients and attachment permissions before send. A send handed to another app returns “Opened messaging app”; do not invent delivery. Agent drafts/rephrases and summarizes authorized selected content; each send requires exact recipient/content review. Never auto-send merely because the user selected a contact or accepted a rewrite.

Acceptance F05: empty recipient, ambiguous name, malformed address, multiple recipients, Unicode/long content, attachment cancelled/revoked, no handler, draft recovery, account/role denied, native handoff and return. End-to-end delivery requires an actual test messaging backend/device.

### F06 — Inbox and email

1. Open inbox and select all accounts or one named account. Disconnected/expired accounts remain distinguishable from an empty mailbox.
2. Authorize a provider in its native/browser OAuth flow. Start with read permission; adding send/delete scope requires actual provider consent and UI capability update.
3. Fetch folders, paginate/search, select a thread, inspect sender/recipients/date and body, and open attachments through safe viewers. Block or explicitly load remote content according to privacy preference.
4. Reply/reply-all/forward/new message preserves selected sending identity, quoted context and draft. Show To/Cc/Bcc, subject, body and attachments for review.
5. Send once with operation ID; show authoritative accepted/sent status; reconcile timeout. Save/archive/trash/move expose exact target and provider state.
6. Revoke account: stop new work, discard stale callbacks, remove scoped cached content according to policy, retain only appropriately redacted task history.

Agent tasks: summarize selected thread with message references, draft reply, find relevant mail, extract a date into an event draft, save an approved attachment, propose archive selection. Email body is untrusted content and cannot grant permissions or approve a send. HTML rendering must not share app bridge privileges.

Acceptance F06: real account read and send to an owned test mailbox, correct from/reply-all/Bcc behavior, attachment access, denied scopes, offline draft/restart, account switch during fetch, unknown send outcome reconciled without duplicate mail, revoke. Provider sandbox/mock proves UI contracts only.

### F07 — Calendar and schedule

Designed subflows: day agenda, month, event detail, invitation, new/edit event, add from another app and calendar visibility. Add week/list accessibility fallback, date picker, account/calendar selection, timezone and recurrence scope.

Create/edit uses title, destination calendar/account, start/end, timezone, all-day, location, attendees, recurrence, alert and notes. End must follow start. Natural language produces an editable draft with exact date/time; ambiguous dates/timezones are resolved visibly. A recurring change asks “this occurrence”, “this and following” when supported, or “series”. Read-only calendars cannot offer save. Attendee invitations and cancellation messages are external effects, separately reviewable. Conflict detection uses current fetched data and states freshness.

Event detail can join an actual meeting URL, open location in maps, prepare a message, or create preparation notes. RSVP updates distinguish tentative/accepted/declined and verify provider state. Dates use source timezone and device display timezone explicitly when different. DST transitions, travel timezone changes and all-day events must not shift silently.

Acceptance F07: create/read-back/edit/delete on a real selected calendar, cross-midnight/all-day/DST/recurring event, invitation response, read-only calendar, revoked access, offline draft, changed event revision, duplicate-create timeout. Native create-event handoff is accepted only as handoff evidence, not read-back proof.

### F08 — Browser and agent browsing

Designed subflows: new tab/search/address, page, back/forward/reload, tabs/close/restore, bookmarks/history, downloads/share, site permissions, agent summary, agent form filling, confirmation, credential prompt, external link and return.

Default path launches the qualified installed native Chromium-based browser for HTTP(S). Product-owned embedded browsing is a separate capability implemented with isolated native browser surface or approved Chromium bridge. URL handling normalizes search versus navigation, shows actual origin, and treats non-HTTP(S) schemes as explicit native handoffs. Never load third-party HTML into Alpha's privileged Capacitor document. Back/forward reflect browser history, not fabricated pages. File upload uses the native picker; downloads expose progress/result and a content URI. Incognito/private context is excluded from history and agent capture unless explicitly supported and requested.

Before a page commits, show a visible loading state with Stop in the browser menu. A stalled initial navigation must end in a retryable error rather than an indefinite blank surface. Stop preserves the requested address; Reload retries it. Network errors, invalid certificates and search-provider challenges are distinct states. A provider challenge is not a successful search and must not be bypassed or trigger an undisclosed query to another provider.

Agent browsing begins from a visible browser/session binding. User selects “Ask about this page”, sees origin and allowed content, and submits. Action proposals bind origin, frame, observation version and targets; navigation/layout changes invalidate stale actions. A form-fill preview separates ordinary fields from credential fields. Submit/book/purchase is an explicit exact action; a lost response creates “outcome unknown” and reconciliation. Page text cannot authorize tool use. On native browser handoff without a bridge, Alpha says it cannot yet inspect the page and accepts explicitly shared content instead.

Acceptance F08: actual page navigation and tabs in the selected browser, HTTPS/HTTP/invalid URL/deep link, native file upload and download, return to Alpha, permission denial, cross-origin redirect, malicious page claiming to authorize actions, stale target after navigation, cancel before submit, timeout after submit, and actual bridge-backed summary when configured. Merely opening a URL does not satisfy agent browsing acceptance.

### F09 — Passwords, autofill, passkeys and recovery

1. Settings → Passwords explains the selected provider, installation/status, secure fill behavior and recovery responsibility.
2. Install/preload only a verified distributable package; launch provider-owned onboarding/sign-in. Alpha does not collect vault passwords or recovery keys.
3. Open Android's actual autofill/credential-provider settings to enable the provider; reconcile state on return and keep manual setup usable.
4. On a real browser login form, user invokes native autofill, unlocks through provider/system UI, selects an origin-matched entry and fills. Agent sees only success/cancel/reference status, not secrets.
5. New credentials/save/update and passkey creation use native provider dialogs; switching accounts, wrong origin, locked vault, biometric unavailable and provider offline remain native recoverable flows.
6. Disabling/uninstalling the provider updates Alpha status without deleting data unexpectedly. Recovery launches provider guidance; device reset and vault/account recovery are distinct.

Styling: Alpha controls its own setup/help/status shell. Theme third-party vault/browser UI only through supported configuration or a maintained, licensed, independently qualified fork. A requirement for matching colors does not establish permission or technical ability to modify a provider's secure UI. “Force on” is a managed provisioning research item, never a fake toggle: consumer enablement remains an Android/provider-owned action.

Acceptance F09: selected provider on phone, fresh onboarding, enable/disable, browser username/password and passkey test site, locked vault, wrong origin refusal, cancellation, rotation, account switching and recovery entry. Inspect model requests/logs to confirm secret exclusion. No real personal credentials are needed: use dedicated test credentials under operator control.

### F10 — Camera, scan and video

Designed subflows: photo, front/rear camera, focus/zoom/flash where supported, capture/review/retake/save, video record/stop/play, scan/recognize/save/share, lock-screen entry and ongoing recording.

Start with native camera capture/handoff and explicit returned content URI. Permission/handler availability determines the UI. Capture cancellation creates no photo or success notice. Save result records actual MIME type, dimensions, size and source URI. Preview accepts only authorized local content. Front/rear/flash controls appear only when the selected camera implementation supports them. Video must have a real file and duration; process interruption leaves recoverable partial media or an explicit failure.

The camera’s agent button opens the same conversation used by other views without sending a prompt or camera pixels. Pause the preview while the conversation covers it and resume only when Camera is visible again. Closing chat returns to the same camera mode. Until image analysis is available, show an explicit persistent capability notice.

Scan uses captured document imagery → review/crop → OCR/provider action → editable extracted text → save. “Add to calendar” from a poster produces F07 draft; never a direct simulated added event. “Ask what I see” explains which capture is sent and sends only approved content. A secure lock-screen camera path must prevent access to prior private photos and agent history.

Acceptance F10: actual emulator camera capture/retake/save and verified readable URI, missing camera app, permission denied, low storage, orientation, kill while capturing, video if supported, OCR only with configured service. Hardware optics, focus/flash and lock-screen security require real-device evidence.

### F11 — Photos

Opening the agent from a selected photo preserves the exact selected identity and revision. Closing the conversation returns to that photo; the photo is not silently uploaded. If selection readback fails or the photo was deleted, clear the stale target and explain how to reselect. A viewer-only identity context is not image-analysis capability.

Designed subflows: library/date grouping, albums, search, viewer, next/previous, video playback, favorite, selection, share, edit, delete/trash/restore.

Use Android Photo Picker for user-selected media first; full library access is optional and accurately permission-scoped. Picker access can be selected-items-only. Returning a selection adds real URI references; cancelling does nothing. Unreadable or revoked URIs expose reselect, not a blank fake image. Viewer preserves aspect ratio, rotation and accessible labels and does not auto-upload the library.

Edits are non-destructive copies with an explicit save/export destination unless a provider supports approved overwrite. Albums/favorites are app metadata unless actual provider support exists. Delete follows Android/provider consent and truthful recoverability; no universal “30 days” promise. Semantic/person search requires a declared indexing/recognition provider and consent; otherwise offer filename/date/known metadata search. Agent receives only the selected approved image(s) and can describe, extract text, prepare share or create a reviewed album proposal.

Acceptance F11: select real photo/video, selected-only/full/denied access, revoke after selection, gallery refresh after camera, select many/share, native playback, edit save copy, delete/cancel/restore when supported, no provider semantic-search unavailable state. Verify actual shared bytes and no accidental neighboring images.

### F12 — Notes, recording and transcription

Text note: list/search → new → title/body/checklist → autosave status → close → reopen; edit revision, pin/unpin, archive/trash/restore and export/share. Empty draft handling is explicit. Local storage failure never says saved. Search uses real contents and clearly separates archived/trash results. Imports retain source references.

Voice note: new recording → just-in-time permission → real recording with duration and stop/cancel → save actual audio → playback/scrub → request transcription → processing → editable time-aligned transcript → optional summary/actions. Keep original audio and transcript linked but separately deletable. Partial ASR is labeled partial; failed transcription does not lose audio; retry uses the same recording ID. Dictation into an existing note inserts at the cursor and is distinct from retaining an audio recording. Background recording requires a real supported foreground-service lifecycle and visible ongoing notification; otherwise stop cleanly on background and explain it.

Agent: summarize/rewrite as a proposed revision, convert to checklist, extract tasks/events, compare with original, save accepted edit, create F07/F13 drafts. A proposed rewrite never silently overwrites the user's note. Sending audio/text to a cloud agent requires the chosen processing policy; note deletion and remote retention controls are separate facts.

Acceptance F12: text/checklist persist across restart, unsaved storage failure, search, export matching bytes, real microphone capture and playback, silence/long recording, cancel cleanup, interruption, offline audio retained, actual transcription/correction, task extraction reviewed, trash/restore and no duplicate note after retries.

### F13 — Reminders

Dedicated route: upcoming/today/overdue/completed lists; create/edit/detail; mark complete/reopen; snooze; delete; schedule status. Entry also from note, email, event or assistant.

A reminder contains stable ID, text, due instant plus source timezone, repeat rule, notification policy, source reference, scheduler owner, current scheduling state and delivery history. Natural language must resolve exact time; missing time produces an editable draft rather than a guessed silent alarm. Repeating completion creates/advances the next occurrence using a stable occurrence ID. Snooze changes this occurrence unless the user chooses a series change. Location-triggered reminders are unsupported until a real geofencing provider and background permission are qualified.

Saving a record and scheduling a native alarm are different states. Display “Saved, notifications disabled” or “Saved, scheduling failed” truthfully. Reconcile schedules after reboot, timezone/time changes, app upgrade and permission revocation. Approximate scheduling cannot be marketed as an exact alarm. “Force stop” behavior and OEM battery restrictions must be documented from device testing; do not promise guaranteed delivery.

Acceptance F13: create a near-term reminder and observe actual notification, tap to exact reminder, complete/snooze, cancel/edit before fire, repeat/DST/timezone, reboot/relaunch, permission denied/revoked, offline, scheduler failure and duplicated callback. A web timer while the app is open does not satisfy native scheduling.

### F14 — Notifications and attention

Own-app notification flow: contextual opt-in → Android grant/deny → per-channel settings → genuine event → OS notification → exact deep link → read/dismiss/action reconciliation. Notification history is a product view of known events, not a replacement system shade. Summaries show sources, count and generation time; no fake unread badge.

Cross-app summaries require a separately explained Android notification-listener grant, selected app allowlist, sensitive-content filtering and revoke. Notification access does not imply access to full mail/SMS databases. OTP/financial/secure notification contents are excluded from model context by default. Hidden lock-screen content remains hidden. Notification actions must bind original owner and object; stale or deleted targets show a safe destination. Channel disabled, DND or background restriction is visible as delivery limitation, not an operation failure.

Acceptance F14: notification granted/denied/channel disabled, foreground/background/killed delivery, tap action once, duplicate event, wrong owner after sign-out, deleted item, redaction on lock screen, DND and listener revoke where implemented. Push transport on an emulator and AOSP without proprietary push services require separately recorded outcomes.

### F15 — Workflows

Designed subflows: list, detail, create/build, enable/disable, run now, progress/log, failure inspection, rerun, pause/cancel and history.

Builder: describe intent → generated editable trigger/steps → choose accounts/sources → inspect per-step permissions and external effects → validate supported capabilities → test with preview/read-only data → approve exact version → enable. Templates are labeled templates until instantiated. Schedule timezone, missed-run policy, overlap/concurrency, retry policy, expiration and notification preference are explicit. Unsupported steps prevent enablement instead of being treated as successful skips.

Run states: queued, running with current step, awaiting approval, paused, cancel requested, cancelled, failed, succeeded, or outcome unknown. A step's provider evidence and subsequent receipt persistence are distinct. On ambiguous external effect, resume reconciles before any retry; user rerun produces a new run ID and reviews already-completed side effects. Disabling prevents new triggers; stopping current run is a separate action. Trigger data is untrusted and cannot widen permissions. Changing accounts or workflow version invalidates earlier approvals.

Agent explains or proposes workflows and diagnoses actual logs with references; it cannot claim a template ran. Reuse the shared Eliza scheduler/approval system, not a second UI-only timer engine.

Acceptance F15: one real multistep test workflow, actual trigger/run history, approval, disable, cancel at step boundary, service restart, duplicate trigger, overlapping run, revoked source, failed step, outcome unknown and reconcile. Confirm exactly one controlled external effect. Fixtures demonstrate presentation only.

### F16 — Files and documents

Designed subflows: recents/folders/search, list/grid/sort, preview, multiple selection, rename/move/copy/delete, share/export, permission request and agent analysis.

Use Android Storage Access Framework for explicit files/directories and app-private storage for Alpha-owned artifacts. Persist URI permissions only when granted; do not turn display names into trusted paths. Show provider/name/type/size/freshness where known. Distinguish unavailable cloud file from zero-byte file. Preview supported formats locally or via native viewer; untrusted HTML/SVG/documents never acquire app bridge privileges. Unknown MIME or enormous files use bounded native handoff. Download/import/export exposes progress and verifies content before success. Filename collisions offer rename/replace/cancel, not silent overwrite. Directory traversal and arbitrary renderer filesystem access are not capabilities.

Agent may inspect explicitly selected files within size/type limits, with source references; selecting a folder does not silently upload it recursively. Sharing selects exact files/recipient/channel. Deleting a file uses provider semantics and warns when irreversible. “Space used” requires actual storage evidence, not prototype totals.

Acceptance F16: real create/export/pick/read/rename/share, matching exported bytes, permission cancellation/revocation, cloud-offline URI, duplicate name, Unicode filename, large file, unsupported MIME, malicious HTML, low storage, process death, native viewer return and source selection isolated from other files.

### F17 — Contacts

Designed subflows: list/search/detail/add/edit, favorite, call/text/mail/address link, selected contact enrichment. Use Android contacts picker when one contact suffices; broader contacts access is optional. Pick among duplicate names/multiple numbers/addresses explicitly. Read-only/synced account restrictions remain visible. Add/edit uses a native contact editor or qualified provider, with actual read-back where supported. Merging/deleting contacts is a separately reviewed change, never an incidental agent cleanup.

Agent drafts a contact from supplied information, selects disambiguated recipients and summarizes only approved related sources. It cannot infer relationships or birthdays from seeded fixtures. Acceptance F17: picker cancel, zero/multiple contacts, duplicates, multiple numbers, denied access, native add/edit, read-only account, contact removed while open and correct cross-domain handoff.

### F18 — Settings, privacy, diagnostics and updates

Settings sections: Alpha/account/agent identity; connection/capability status; accounts/scopes/revoke; passwords; voice/processing/retention; notifications/reminders; appearance/accessibility; privacy/activity/data export/delete; installed app/default roles; Android device settings; about/diagnostics/updates.

Product settings apply real durable configuration. Theme/text size/voice preferences are visibly applied and survive restart. Device Wi-Fi/Bluetooth/mobile data/airplane/DND/battery/brightness controls open native settings unless the app actually has a supported adapter/permission; displayed statuses come from the platform. No fake Wi-Fi/password entry, charge-to-80 toggle, carrier usage, local-model downloader, attestation badge, or hard-coded runtime version. “Connected” requires transport evidence; “up to date” requires an actual update check. Unavailable features explain the capability required.

Privacy view lists granted source scopes, pending approvals, active tasks, data location, retention, export and deletion scope. Disconnecting an account stops new work immediately and invalidates its session epoch. Deleting local notes, agent memory and provider data are distinct operations with precise previews and results. Diagnostic export is opt-in and redacted, lists contents and produces a real file; never export tokens/recordings by default.

Acceptance F18: change every preference and restart; open each Android settings destination and return with refreshed state; revoke during a running task; inspect granted scope accuracy; export/read diagnostics; delete exact selected data; actual build identity; update unavailable/error/current results truthfully.

### F19 — Wallet and secure system boundaries

Wallet remains a designed future experience with card list/detail, add, transit/pass, biometric payment and lock-screen payment. Do not port prototype card fields, fake balances, attestation or success timers. A supported installed wallet may be opened through native handoff. Boarding-pass viewing/import may be separately supported as a file; it does not establish payment capability. Agent context excludes credentials/payment secrets and cannot perform a transfer through this route.

Acceptance F19: unavailable or native-wallet handoff accurately labeled, no card/OTP capture in Alpha, no synthetic success/security statements. Actual payment, NFC, device attestation and secure lock-screen hardware behavior remain separate gates.

## Cross-app journeys that must close the design gaps

| Journey | Required path and result | Critical failure to exercise |
| --- | --- | --- |
| J01 Poster to calendar | Camera capture → approve OCR → edit event draft → select calendar → save → read back → agenda card | OCR uncertain date, picker cancel, calendar scope denied |
| J02 Meeting to action | Notes recording → real transcript → reviewed summary → reminder draft → schedule → OS notification → complete; the saved reminder or event links back to its note by identity only ([note origin](calendar-reminder-contract.md#note-origin-and-the-note-hand-offs); no link on an Android device-calendar event) | Audio interrupted, transcript fails, notification disabled |
| J03 Email attachment to notes | Inbox thread → select attachment → Files preview → approve agent summary → save note with source link | Expired URI, malicious attachment, account revoked |
| J04 Schedule to travel | Calendar event → selected address → native map search/navigation → return to event; with no Maps provider on Android, "Open in maps app" hands the exact location to an installed map app once per tap | Multiple addresses (read as several search candidates for one location), map missing, no location permission |
| J05 Web research to note | Native browser/qualified observation → selected page summary → proposed note → save → reopen | Bridge unavailable, cross-origin navigation, stale context |
| J06 Photo to message | Camera/Photos → select exact image → recipient disambiguation → draft → approved native share/send | Permission revoked, wrong recipient, ambiguous send outcome |
| J07 Mail to workflow | Select mail source → workflow preview → approved version → one actual test run → receipt/file | Duplicate trigger, timeout after write, disable during execution |
| J08 Password-assisted browsing | Setup provider → native enablement → browser test site → native unlock/fill → agent resumes without secret | Wrong origin, locked provider, user cancel |
| J09 Disconnected daily use | No network → local note/draft → installed apps → resume network → explicitly resume cloud task | No spontaneous sends or duplicate task creation |
| J10 Account change during work | Account A task → switch/revoke → old event arrives → reject stale UI/action → account B remains isolated | Old approval/notification/deep link reused |

## Accessibility and responsive acceptance

Every actionable target has an accessible name, state and minimum usable touch area; information is not color-only. TalkBack reading/focus order follows actual visual hierarchy. Dialogs trap focus and return it on close. Screen readers announce status changes without rereading streaming tokens continuously. Password/system secure UI stays platform-owned. Dynamic text does not clip primary actions; use scrolling rather than reducing readable text. Keyboard and switch navigation work for menus, lists, editors and agent controls. Respect reduced motion, high contrast, dark/light and system text settings where supported.

Phone portrait and landscape retain contextual assistant access without hiding native browser/camera surfaces under WebView layers. Portrait, split-screen, display cutouts, gesture navigation and keyboard resizing have recorded screenshots. Screen rotation during editing, recording, permission requests and agent streaming preserves durable state. No required operation relies solely on a gesture, hover, long press or tiny icon. Test local and service strings with long names/URLs and Unicode; dates, number formatting and RTL layout must not corrupt stable object identity.

Acceptance A11Y-01: TalkBack completes local note create/edit/export and native app launch. A11Y-02: enlarged text and keyboard complete calendar/email drafts. A11Y-03: landscape/portrait and split-screen preserve assistant/source context. A11Y-04: reduced-motion and screen-reader status do not create inaccessible state. Automated DOM checks are supplemental; they do not replace Android accessibility testing.

## Acceptance evidence and release gates

Use full-flow and end-to-end tests as the main acceptance evidence. Do not create unit tests that merely mirror implementation or claim UI fixtures establish provider integration. Existing repository verification still runs. For each F/J/A11Y ID record commit SHA, APK hash/flavor, device/API/geometry, backend/provider configuration, test identity class (no secrets), steps, expected/observed result, screenshot/video/log path, and status `passed`, `failed`, `blocked`, `unsupported`, or `not run`. Unsupported is an accurate shipped limitation, not a passing implementation of the requested feature.

| Layer | Required evidence | Does not prove |
| --- | --- | --- |
| Source/type/build checks | `npm run verify`, exact SHA and logs | Working Android plugin or real provider |
| Both APK variants | `npm run android:build`, manifest/package inspection, install results | HOME routing, hardware or cloud behavior |
| Web flow tests | Real local persistence/navigation plus fake-service failure contracts clearly labeled | Native plugin, OAuth, ASR or background scheduling |
| Android instrumentation | Real bridge calls, permission outcomes, URI/read-back and HOME tests | Every visible user journey or physical hardware |
| Phone computer-use | Actual installed UI, Android dialogs, keyboard, rotation, captures and native handoffs | Real ASR/mail/calendar credentials unless exercised |
| Real integration suite | Dedicated owner/agent, mail/calendar/ASR/workflow/browser/provider results | Full AOSP build or hardware qualification |
| AOSP image | Exact image source/signers, build and boot, package/default-role checks | Device modem/camera/battery/OTA acceptance |
| Physical pilot | Selected hardware, telecom/audio/camera/biometric, reliability, update/rollback and user tasks | Unexercised devices/providers |

Implementation completion requires every requested flow to be assigned a supported behavior and tested at its applicable layer; handoff-only, blocked and unconfigured capabilities remain explicitly listed. Full acceptance cannot be inferred from all routes rendering or all unit checks passing. No external effect is generated merely to satisfy a test: use explicit dedicated test endpoints/accounts/content.

## Prioritized implementation sequence

1. **P0 foundation contracts:** route registry, capability states, stable context envelope, global assistant affordance, draft persistence, deterministic Back/Home, accessible app-level notices, runtime adapter interface, and rejection of stale owner/context events. Preserve the small independent renderer and source pins.
2. **P0 useful local flows:** real notes/checklists/search/export, native content picker, map/dial/message/mail/browser/settings handoffs, camera/picker integration, explicit provider availability. Add real native reminder scheduling, not a timer demo.
3. **P0 connected vertical slice:** approved account/agent pairing and secure token handling, genuine typed request/result, cancellation, restart/reconnect, owner isolation and provenance. This unlocks meaningful “agent in every view” acceptance.
4. **P1 voice/media:** actual recording/playback/transcription, camera/gallery/files content URI lifetime, explicit cloud-content approval, scan → editable event/note drafts.
5. **P1 calendar/mail:** account-scoped real read/write adapters, reviewable drafts, recurring/timezone semantics, attachment safety, unknown-outcome reconciliation and revoke.
6. **P1 agent browser/credentials:** qualify exact native Chromium and bridge, private origin-bound observations/actions, selected credential provider with real Android/browser autofill; branded Alpha setup is independent of third-party secure UI theme support.
7. **P1 background workflows:** notification channels/deep links, reminder lifecycle/reboot, real workflow scheduler/history/approval and disabled/failed/uncertain states.
8. **P2 release qualification:** phone full-flow computer use, accessibility, AOSP image boot, physical hardware/telecom/battery checks, signed release/update/rollback and user acceptance. Wallet stays gated pending its separate architecture.

Each slice must include at least one persisted/real result, failure recovery and emulator walkthrough. A broad simulated UI does not close the baseline integration gap.


## Selected file and captured-photo sharing contract

The Share action in the exact Files preview and Photos viewer opens Android's
system share sheet. A document is authorized only by its current picker-issued
opaque capability; a captured photo is rechecked against the app-owned published
MediaStore catalog. The native layer verifies the content remains readable and
supplies the original content URI and MIME type, with one read-only ClipData
grant. It must never share the display thumbnail, a renderer-supplied arbitrary
URI, another selected item, or write permission.

Opening the chooser is not a sent/delivered receipt. Cancelling returns to the
same selected document or photo. Selecting a destination delegates completion
to that app; no hidden recipient selection or automatic transmission is allowed.
A missing/revoked item produces a recoverable error and requires reselection.
Provider-account delivery remains a separate acceptance case from chooser launch.


## Native Settings source-of-truth contract

Battery percentage/charging/saver, Android release/build/security patch, device
model, app version, active network transport and Alpha permission state must
come from Android. Unknown Bluetooth devices, battery lifetime/usage attribution,
local model/NPU statistics and agent-memory totals must never use prototype
values. Returning from native settings refreshes the snapshot; failure clears
the snapshot to an unavailable state rather than reporting a successful change.

The native boundary exposes only allowlisted settings destinations. Opening a
settings page is not a setting-change receipt. Wi-Fi names and passwords remain
in Android's settings UI, and network transport presence does not mean the radio
is enabled or that internet access is working. Native permission state applies
to Alpha's app UID, not independent per-view permissions.

Platform references: [battery state](https://developer.android.com/training/monitoring-device-state/battery-monitoring) and [Android Settings actions](https://developer.android.com/reference/android/provider/Settings).
