# Owner-approved MVP implementation backlog — October 12, 2026

The product owner approved/corrected all 32 decision issues in chat on 2026-10-12
and requested implementation TODOs. These are **approved requirements, not shipped
features or acceptance evidence**. Each issue stays open until its checklist and
source-bound acceptance pass. This document supersedes conflicting earlier options,
P-01/P-07 voice policy, credit billing, optional hosted agents and the October 11
Wallet expansion. The source baseline reviewed was main `f3ccefd3`, Eliza pin
`13c98575987a121decc45b161b0c8a4ee698554e`; the pin is unchanged by this planning work.

See [implementation order and responsive matrix](implementation-plan.md),
[decision record](decisions.md#october-12-owner-decisions),
and [speech research and native integration](local-speech-research-2026-10-12.md).
All checklist entries below intentionally start unchecked. Owner areas identify
responsibility, not evidence that someone has accepted an assignment.
Subscription price/quotas and final speech model/quantization are engineering and
commercial deliverables to establish with evidence, not decisions silently invented here.

## #394 — A-09: Enforce powered-on resident scheduling and missed-occurrence recovery

**Status:** TODO · **Policy:** P-10 · **Owner area:** Eliza runtime/workflow + Alpha mobile

Schedules run only while the phone is powered on; the agent is local. Remove powered-off hosted-loop acceptance. Record missed occurrences once; do not automatically replay overdue effects. Offer an explicit Run now action where useful.

- [ ] Reconcile scheduler, digests UI and journey D with powered-on-only execution
- [ ] Persist occurrence identity, missed status and future schedule across restart, reboot and clock/time-zone changes
- [ ] Test screen-off/Doze delivery separately from powered-off missed recovery; no duplicate results or automatic overdue writes

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/394)

## #395 — A-10: Measure last-input-audio to first-response-audio latency

**Status:** TODO · **Policy:** P-11 · **Owner area:** Alpha voice/QA

Voice-assistant latency is the elapsed time from the last user speech audio sample to the first audible response sample. Include end-of-turn detection, final STT, inference, TTS and playback buffering. Do not subtract silence detection or report a sum of selected stages as the end-to-end result. Dictation reports stop-to-editable-text separately; manual user think time is not a voice-assistant benchmark.

- [ ] Instrument monotonic capture, endpoint, transcript, request, first-token, first-PCM and audible-playback timestamps
- [ ] Report cold/warm p50/p95, failures, sample count, engine/model/hash, network and thermal state; use at least 50 simple-query trials
- [ ] Retain the existing six-second simple-query target as an upper acceptance budget and pursue the tighter engineering budgets in the speech research; no latency acceptance before real audio evidence

Dependencies: #397, #413, #423.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/395)

## #396 — A-02: Use Eliza Cloud services with a strictly local agent

**Status:** TODO · **Policy:** P-12 · **Owner area:** Eliza Cloud + Alpha runtime

Eliza Cloud is the managed account, inference, subscription and Maps service endpoint. Agent orchestration, state, scheduling and approvals remain on the phone. No Cloud/hosted agent exists as a product connection, upgrade or fallback.

- [ ] Bind managed service credentials to authenticated owner and generation in native secure storage
- [ ] Remove agent pairing/provisioning from production onboarding and recover saved legacy selections without connecting or deleting history
- [ ] Verify sign-in, expiry, revoke, wrong-origin callbacks and account isolation with the resident agent

Dependencies: #406, #410, #415.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/396)

## #397 — A-04: Build native on-device STT and TTS through Eliza inference

**Status:** TODO · **Policy:** P-13 · **Owner area:** Eliza local-inference/native + Alpha voice

All speech recognition and synthesis run locally on the device, always. Replace Cloud/paired-host speech policy. Use the Android native bridge to the reviewed Eliza llama.cpp/libelizainference build, extending shared upstream speech support where necessary. Research candidate models on Hugging Face and select by measured device speed and quality, not advertised desktop throughput.

- [ ] Execute the candidate comparison and native integration plan in local-speech-research-2026-10-12.md; pin source, model and phonemizer assets
- [ ] Expose persistent native streaming STT/TTS, cancellation, capability/version checks and bounded PCM buffers through JNI; no per-turn model reload or renderer audio round trips
- [ ] Remove Cloud speech selection, upload and billing dependencies from chat, Notes, read-aloud, Browser and Maps guidance
- [ ] Keep ordinary speech audio transient; explicitly saved voice-note audio follows the note and three-day Trash
- [ ] Test offline/signed-out speech, denied microphone, stop, echo, audio focus, restart and both shipped ABIs

Dependencies: #413, #423.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/397)

## #398 — A-05: Deliver background notices with durable reconciliation

**Status:** TODO · **Policy:** P-14 · **Owner area:** Alpha native/runtime

Use periodic background work and immediate reconciliation at resume/start. Doze delays are honest; a permanent connection solely for mail is not required. Stable event identities prevent duplicate user-visible alerts.

- [ ] Implement account-bound Gmail/result reconciliation, backoff and last-sync state
- [ ] Qualify notification permission, channel denial, Doze, battery saver, lock, reboot and process death
- [ ] Suppress stale owner events and reconcile missed results without repeating external effects

Dependencies: #421, #425.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/398)

## #399 — A-01: Pin and qualify Pixel 10a Android 17 distributions

**Status:** TODO · **Policy:** P-15 · **Owner area:** Shaw / mobile release

Target Pixel 10a on Android 17. Ship standalone APK and Alpha AOSP image/launcher; Cuttlefish is the image integration test target. Other Pixels are not alternate promised hardware.

- [ ] Admit exact Pixel 10a SKU/codename and platform/kernel/vendor/firmware source and hash lock; reconcile older Pixel 10/11 wording
- [ ] Build standalone/launcher debug and release variants and verify package contents independently of image qualification
- [ ] Record Cuttlefish boot, physical device functions, signed update/recovery and user acceptance as distinct gates; development boot evidence is not release qualification

Dependencies: #400.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/399)

## #400 — A-06: Establish Alpha release signing, updates and recovery ownership

**Status:** TODO · **Policy:** P-16 · **Owner area:** Shaw / release security

Alpha Compute controls signing and update authority; Shaw is the accountable release/support/rollback owner. Use managed or hardware-backed release signing, distinct from developer keys.

- [ ] Record release certificates, protected key custody, operator recovery and one signed update channel without committing secrets
- [ ] Publish version/hash compatibility records and retain a known-good recovery image
- [ ] Complete signed update, interrupted-update and compatible rollback/stock-recovery drills before distribution

Dependencies: #399.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/400)

## #401 — A-11: Integrate Android Clock alarms with Alpha and the AOSP image

**Status:** TODO · **Policy:** P-17 · **Owner area:** Alpha native/AOSP

Android Clock owns alarms, conditional on a usable integration in the app and AOSP image. Alpha owns reminders. A dispatch receipt may state that Clock opened, not that an alarm was created.

- [ ] Ship DeskClock and wire reviewed create/show handoffs with clear return-to-Alpha behavior
- [ ] Verify final creation in Clock, ringing, snooze, dismiss, reboot, time-zone/DST and DND on the target image/device
- [ ] Keep alarm handoff and reminder status distinct; fix integration gaps before accepting this route

Dependencies: #399.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/401)

## #402 — A-12: Keep passkeys outside MVP and provide honest unsupported handling

**Status:** TODO · **Policy:** P-18 · **Owner area:** Alpha product/mobile

Passkeys are outside MVP acceptance. Integrated passwords remain in scope. A later release may use the system credential provider after actual browser/image qualification; Alpha is not a new passkey provider now.

- [ ] Remove passkey implementation from MVP completion gates while retaining password save/fill tests
- [ ] Mark unsupported passkey-only flows truthfully and provide an available external browser handoff
- [ ] Keep a separately scoped system-provider follow-up without advertising current passkey support

Dependencies: #404.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/402)

## #403 — A-13: Allow third-party cookies in the normal isolated browser profile

**Status:** TODO · **Policy:** P-19 · **Owner area:** Alpha product/mobile

Third-party cookies are allowed in normal browsing. Persistent first-party sign-ins remain. Private tabs remain ephemeral and strict; browser storage stays separate from the privileged app WebView.

- [ ] Enable third-party cookies on normal Alpha browser tabs and reconcile settings/policy/tests
- [ ] Verify embedded sign-in/session behavior across tabs and restart, plus explicit clearing
- [ ] Keep private-tab cookies ephemeral, block cross-profile leakage and preserve Capacitor isolation

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/403)

## #404 — A-14: Enable secure autofill across eligible Alpha app surfaces

**Status:** TODO · **Policy:** P-20 · **Owner area:** Alpha product/mobile

Every eligible login surface in Alpha should support password-manager fill. The isolated Browser is currently the website-login surface; future Alpha-owned login forms must also be covered. This is not blanket trust of arbitrary external browsers and does not expose passwords to the agent.

- [ ] Inventory current website and native/app login surfaces and wire provider-owned unlock/save/fill
- [ ] Bind website fills to committed HTTPS origin and native fills to verified app identity; exclude secrets from observations, transcripts and logs
- [ ] Test redirects, frames, wrong origin, lock/cancel, app-owned fields and release-signing identity with both integrated vault and optional Proton provider

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/404)

## #405 — A-15: Complete Gmail attachments and reviewed mailbox actions

**Status:** TODO · **Policy:** P-21 · **Owner area:** Eliza Cloud integrations + Alpha Inbox

Include reading, read/unread, archive, drafts, reply/forward, reviewed send, opening/saving attachments and user-selected outbound attachments. Defer custom label management.

- [ ] Implement/qualify attachment identity, MIME/size limits and exact-byte open/save/send flows
- [ ] Show account, recipients and each attachment in final send review
- [ ] Exercise authorized real-mailbox operations, revoke/account changes and ambiguous-send reconciliation; no automatic resend

Dependencies: #419, #421.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/405)

## #406 — A-16: Remove hosted-agent onboarding from every product path

**Status:** TODO · **Policy:** P-22 · **Owner area:** Alpha onboarding/runtime

Only the local resident agent is supported. No hosted agent, dedicated-agent purchase, remote pairing or Cloud-agent fallback is a product option, now or as an advanced setting.

- [ ] Make Welcome and Settings select local agent plus managed services only
- [ ] Remove hosted provisioning/adoption/select-agent journeys and production controls; mark shared remote fixtures as non-product development infrastructure
- [ ] Test cold start, upgrade from saved remote selection and signed-out local tools without reconnecting a hosted agent or erasing history

Dependencies: #396, #415.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/406)

## #407 — A-17: Preserve system secure-camera entry on the lock screen

**Status:** TODO · **Policy:** P-23 · **Owner area:** Alpha AOSP/native

Use the system secure camera and its AOSP lock-screen gesture. Alpha does not implement its own secure camera; agent/library/account access stays behind unlock.

- [ ] Include and route the secure camera activity and supported hardware gesture in the image
- [ ] Verify locked capture cannot expose prior gallery, agent context, accounts or app navigation
- [ ] Verify unlock and return behavior and camera permission/absence handling

Dependencies: #399.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/407)

## #408 — A-18: Give the local agent full permitted photo-library access

**Status:** TODO · **Policy:** P-24 · **Owner area:** Eliza media/native + Alpha Photos

Provide full device photo/video library access to the local agent where Android permits and the user grants it, rather than limiting the product to owned captures or picker selections. Handle partial/denied access honestly. Full local access does not imply automatic upload of the entire library.

- [ ] Request appropriate full media permissions and build a paged MediaStore catalog/index with stable IDs, thumbnails and change/revoke handling
- [ ] Expose agent search, inspect, select and supported edit/organize operations over the full permitted library; keep destructive/share actions reviewed
- [ ] Show actual full/selected/denied permission scope; protect locked/work-profile/restricted media and bound indexing memory/battery
- [ ] Test large catalogs, external edits/deletes, reboot, permission downgrade and selected outbound model context

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/408)

## #409 — A-19: Provide reset only and remove data import/export backup scope

**Status:** TODO · **Policy:** P-25 · **Owner area:** Alpha storage/native

No app-data import/export, backup or device-transfer product workflow. Provide a confirmed Reset Alpha data option. Keep Android backup disabled. Ordinary Files opening/saving and Gmail attachments are separate daily-tool operations, not app-data migration.

- [ ] Remove Notes/app-data import/export and backup/migration controls and acceptance tasks from MVP
- [ ] Implement authenticated/confirmed local reset: stop agent/listener/workers, cancel pending actions/notices, delete private stores, caches and relevant Keystore aliases, return to first run
- [ ] Explain that device-wide photos/files and remote Gmail/Cloud data and subscription are not erased/cancelled by a local reset
- [ ] Test interruption/restart during reset, no resurrection from late callbacks and no cross-app deletion

Dependencies: #424, #425.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/409)

## #410 — A-20: Implement subscription entitlement with low-latency rate limiting

**Status:** TODO · **Policy:** P-26 · **Owner area:** Eliza Cloud billing/inference

Use subscription billing with reasonable rate limits rather than a user-facing credit top-up/per-token meter. Billing checks must not add a billing-service round trip to each assistant turn. Local speech and local tools do not depend on an online billing check.

- [ ] Design Cloud-issued short-lived signed entitlements, asynchronous refresh/revocation propagation, account binding and explicit expiry/outage behavior
- [ ] Enforce server-side cached quotas/token buckets on existing inference and Maps requests; emit usage asynchronously with idempotent accounting
- [ ] Replace credit/top-up UI with subscription state, plan allowance and clear rate-limit retry information; no automatic overage purchase
- [ ] Benchmark added p50/p95 latency under normal, cache-miss, exhausted, expired and billing-outage conditions; maintain limits without blocking audio capture/playback
- [ ] Propose numerical burst/sustained limits and subscription price from measured provider cost and pilot traffic; values remain unselected, not invented as owner decisions

Dependencies: #396, #412.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/410)

## #411 — A-22: Implement intentional responsive layouts and rotation continuity

**Status:** TODO · **Policy:** P-27 · **Owner area:** Alpha design/UI/native

Support portrait and landscape, adapting each surface by its purpose. Do not stretch every panel or change sensitive/native UI ownership. Preserve drafts, scroll, selection, task and capture state.

- [ ] Apply the responsive-surface matrix in implementation-plan.md to Home, chat, lists/editors, Calendar, Maps, media, camera, reviews and voice controls
- [ ] Use measured width/height and keyboard/insets, not orientation alone; preserve tap targets, reading width and media aspect ratio
- [ ] Qualify both distributions at small landscape, portrait, large text, keyboard, screen reader and process recreation; native/system screens remain native

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/411)

## #412 — A-23: Deliver shared Eliza Cloud Maps service and full local-agent tools

**Status:** TODO · **Policy:** P-28 · **Owner area:** Eliza Cloud Maps + Eliza plugin-maps + Alpha native

Maps belongs in Eliza Cloud as a reusable managed service for agents, with full supported search, place, route and navigation control from Alpha’s local agent. The regional development gateway is a prototype adapter, not the production coverage promise. No hosted agent is introduced.

- [ ] Build provider-neutral Cloud Maps APIs/tools for geocode/reverse geocode, place search/details, routes/modes, alternatives and coverage metadata; reuse OSM/GraphHopper components where suitable
- [ ] Choose and provision production datasets/provider coverage, freshness and operations in Cloud; require attribution and honest unsupported/outage responses
- [ ] Expose agent search/select/plan/start/stop/reroute/save/share through typed contracts and Alpha UI; native phone owns GPS, active navigation and local TTS
- [ ] Bind subscriptions, account isolation, rate limits and location disclosure; avoid a separate billing hop or raw-location logs
- [ ] Qualify real Cloud routes and continuous Calendar-to-Maps journeys, cancellation, stale location, region limits and physical navigation separately

Dependencies: #410, #397.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/412)

## #413 — A-24: Qualify always-local speech on both Android ABIs

**Status:** TODO · **Policy:** P-29 · **Owner area:** Alpha speech qualification + Eliza native

On-device STT and TTS are mandatory for every production speech entrypoint, including signed-out and offline use. No Cloud speech fallback. A failed local engine must surface recovery and typing, not switch routes.

- [ ] Consume the reviewed native engine/model choice from #397 and package all required runtime/model/tokenizer/voice assets reproducibly
- [ ] Replace stale speech admission with functional and speed evidence at the exact current source/model hashes for ARM64 and x86_64
- [ ] Verify no speech network egress and actual device microphone/speaker quality, sustained throughput, thermal behavior and cancellation
- [ ] Keep APK packaging, emulator execution and Pixel 10a physical acceptance distinct

Dependencies: #397.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/413)

## #414 — A-25: Add reviewed deletion with durable Undo for Calendar and reminders

**Status:** TODO · **Policy:** P-30 · **Owner area:** Eliza Calendar/reminders + Alpha UI

Use a short durable Undo window and one review step for events and reminders. Initial engineering value: ten seconds. Delay provider deletion until expiry when possible; never call a recreated invitation a lossless restore. Suspend pending-deletion reminder delivery immediately.

- [ ] Persist pending-delete intent, exact object/revision/recurrence scope and expiry; restore after restart without double deletion
- [ ] Implement Undo and final provider readback; handle concurrent edits, permission loss, organizer effects and unknown outcomes
- [ ] Test process death before/after expiry, recurrence, notification suppression and failed restoration

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/414)

## #415 — A-26: Reject all hosted-agent origins and remove remote connection restore

**Status:** TODO · **Policy:** P-31 · **Owner area:** Alpha native security/runtime

No Cloud-agent host is admitted. The resident agent uses the local native bridge. Cloud inference, subscription, Gmail and Maps are managed services, not agent hosts.

- [ ] Keep exact managed-service origin/path admission and reject dedicated-agent hosts, wildcard host matching, redirects and production pairing routes
- [ ] Remove hosted-agent restore/discovery/fallback from production code paths and capability declarations
- [ ] Test owner/audience isolation and saved legacy URLs; allow only separately admitted managed-service APIs needed for Maps and billing

Dependencies: #396, #406, #412.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/415)

## #416 — A-32: Unify notices and quick settings in the Android shade

**Status:** TODO · **Policy:** P-32 · **Owner area:** Alpha UI/AOSP/native

Use Android’s shade as the single notification/quick-settings surface if it integrates correctly and matches the product design. Keep workflow history in Alpha; remove the competing imitation shade. Use normal notifications/tiles before custom SystemUI changes.

- [ ] Route Alpha notices/actions and supported tiles through native channels with owner-bound taps
- [ ] Remove duplicate Alpha shade UI while preserving accessible entry to task history/settings
- [ ] Review actual AOSP portrait/landscape/lock screenshots, branding, insets, DND, clear/tap behavior and listening indicator integration

Dependencies: #417, #424, #425.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/416)

## #417 — A-33: Open the Android shade with a launcher Home swipe

**Status:** TODO · **Policy:** P-33 · **Owner area:** Alpha launcher/native

A downward swipe on empty launcher Home opens Android’s shade. Preserve top-edge Android behavior and content/conversation scrolling. Standalone follows ordinary app behavior.

- [ ] Implement the supported launcher permission/native mechanism with a truthful unavailable fallback
- [ ] Disambiguate empty-Home gesture from vertical content and keyboard gestures
- [ ] Test swipe/tap accessibility and return behavior on AOSP; no duplicate panel opens

Dependencies: #416.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/417)

## #418 — A-34: Finalize Calendar availability semantics

**Status:** TODO · **Policy:** P-34 · **Owner area:** Eliza Calendar + Alpha UI

Free, cancelled and declined entries are not busy. Offer owner-selected free/busy-only calendars without exposing details. Tentative/unanswered blocking entries count conservatively; unavailable/stale reads are unknown, never free.

- [ ] Apply rules across native/browser contracts and show selected-source provenance
- [ ] Preserve review/re-read consistency before sharing intervals with the agent
- [ ] Test real synced invitations, free/busy-only permission, stale/revoked sources, all-day/DST and conflict updates

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/418)

## #419 — A-35: Attach selected Files and Photos through reviewed email drafts

**Status:** TODO · **Policy:** P-35 · **Owner area:** Alpha Inbox/media

A reviewed Use in email suggestion may attach items selected in Files or Photos. Context selection is not itself permission to attach. Insert into a draft; final Send is separate.

- [ ] Add explicit attach choice with per-item name/type/size and removal controls
- [ ] Resolve stable selected content and permissions, preserving exact bytes through draft/restart
- [ ] Review recipients/body/attachments at send and test revoked/changed files, duplicates, cancellation and account switch

Dependencies: #405, #408.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/419)

## #420 — A-03: Expose Phone, Contacts and SMS only in the Alpha AOSP image

**Status:** TODO · **Policy:** P-36 · **Owner area:** Alpha AOSP/telephony/UI

Phone, Contacts and SMS are included only in the AOSP fork. Hide and capability-gate them in standalone APKs and other non-AOSP product installs. The launcher flavor alone is not proof of an Alpha image. Wallet is outside MVP.

- [ ] Add a trustworthy AOSP provisioning/build capability distinct from launcher and test-mocks; gate icons, routes, deep links, restored state, agent tools and native permissions
- [ ] Implement Contacts first, then Telecom/default dialer and SMS/MMS adapters with user-selected roles, carrier/account identity and system emergency fallback
- [ ] Verify real calls/messages using owned endpoints on the image, permission/role loss and unknown-send recovery; standalone has no Phone/Contacts/SMS UI or agent bypass

Dependencies: #399, #421, #422.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/420)

## #421 — A-07: Integrate Gmail and AOSP text messaging as communication providers

**Status:** TODO · **Policy:** P-37 · **Owner area:** Eliza Cloud Gmail + Alpha telephony

Communication providers are Gmail and text messaging. Gmail is available in both product distributions; SMS/MMS is device/SIM based and only exposed on the Alpha AOSP image. Telegram, Discord and additional mail providers stay deferred. Device Calendar/Contacts sources remain separate native permissions.

- [ ] Use incremental Gmail readonly then modify grants as needed for approved mailbox actions, with account revoke/stale cache isolation
- [ ] Implement AOSP SMS/MMS provider/Telecom contracts and SIM selection, incoming/outgoing status and reviewed sends; no invented SMS OAuth account
- [ ] Keep standalone SMS/Contacts/Phone unavailable at UI, agent and native boundaries
- [ ] Qualify authorized live Gmail and owned SMS/MMS endpoints; synthetic fixtures do not establish delivery

Dependencies: #405, #420.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/421)

## #422 — A-08: Remove Wallet from MVP scope and acceptance

**Status:** TODO · **Policy:** P-38 · **Owner area:** Alpha product/mobile

Wallet is removed from the MVP plan. No custody, payment, pass-wallet, NFC payment integration or wallet-provider activation is required for MVP. Preserve unrelated user data; do not activate prototype transfers.

- [ ] Remove Wallet work packages and acceptance blockers from current plans/requirements
- [ ] Keep Wallet views, deep links, agent actions and native/payment adapters disabled in both distributions including AOSP
- [ ] Test saved route recovery and requests to open/pay so they cannot expose simulated success or payment side effects

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/422)

## #423 — MVP-01: Deliver separate dictation and interruptible voice-assistant controls

**Status:** TODO · **Policy:** P-39 · **Owner area:** Eliza voice/runtime + Alpha UI

Transcribe records locally and on Stop inserts editable text; the user sends it. Voice assistant listens and submits automatically: after a short gap evaluate semantic turn completion with Clef; after a longer gap submit. Resumed speech cancels pending submit or the in-flight response/playback and continues the utterance/conversation. All STT/TTS remains local.

- [ ] Implement separate visible Transcribe and Voice assistant buttons, states and accessible stop/mute controls
- [ ] Build the native VAD/streaming-STT/semantic-endpoint pipeline with Clef feasibility verified; initial tunable gaps are engineering defaults, not owner-set constants
- [ ] Use generation IDs and native cancellation to drop late model/TTS callbacks and clear unplayed audio; append continuation without duplicate committed turns
- [ ] Preserve only actually heard assistant content in conversation state after interruption; never interpret automatic voice submission as approval of external side effects
- [ ] Test hesitation, long pause, false starts, echo, barge-in before dispatch/during inference/during playback, offline and account changes

Dependencies: #397, #395, #413.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/423)

## #424 — MVP-52: Deliver opt-in always-on listening and hardware invocation in AOSP MVP

**Status:** TODO · **Policy:** P-40 · **Owner area:** Eliza native voice + Alpha AOSP

Always-on listening and supported hardware-key invocation are required in the AOSP MVP, not a later milestone. Use a narrowly privileged isolated listener only; the ordinary Alpha app remains nonprivileged. Listening is off until consent, local, visibly indicated and immediately stoppable.

- [ ] Adopt the listener ADR and exact image privilege/SELinux/IPC boundary; local VAD/turn/STT/TTS, no raw audio upload or default audio retention
- [ ] Implement consent, persistent lock/AOD indicator, notification/QS pause, mic sensor-privacy, revoke, reboot-before-unlock and crash-loop behavior
- [ ] Wire supported hardware invocation without taking emergency/camera gestures; standalone uses only permitted foreground/assistant entrypoints
- [ ] Qualify real hardware lock/background, audio focus/call coexistence, echo, stop reliability, battery/thermal and long-running listening; include in final MVP acceptance

Dependencies: #399, #397, #413, #423, #416.

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/424)

## #425 — OWNER-NOTICE: Restore valid approval notices when their owner reconnects

**Status:** TODO · **Policy:** P-41 · **Owner area:** Eliza notice delivery + Alpha native

Withdraw owner-specific approval notices on owner change. Repost quietly when the original owner returns only if the approval remains pending, valid and unexpired. Keep workflow state; revalidate the target and create a fresh tap binding. Apply the same privacy boundary to owner-specific result notices.

- [ ] Persist owner-scoped notice/repost state and invalidate stale PendingIntents
- [ ] Revalidate approval expiry, decision, cancellation and source revision before quiet repost; no repeated sound/vibration on account toggles
- [ ] Test A-to-B-to-A, process death, lock previews, expired/decided approvals and result notices without cross-owner disclosure

[Implementation issue](https://github.com/eliza-research/alphaphone/issues/425)
