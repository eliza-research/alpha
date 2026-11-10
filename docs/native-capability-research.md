# Alpha Phone native capability research

Research date: 2026-09-29. Source baseline inspected: `vendor/eliza` commit `760ad0f18ad6e34581f696642434215e397ccbc5`. This report separates source availability, product integration, and installed-device acceptance. None of its proposed acceptance tests are claimed to have passed by this report.

## Findings and decisions

The product should own accessible task views, selected-object context, drafts, and approval/result presentation. Android should own permission prompts, credential selection, media/document selection, secure storage, notifications, camera capture, location, and app handoff. Cloud Eliza should own account-scoped connectors, agent orchestration, durable workflow execution, and remote notes. AOSP should own browser provisioning, OS updates, default-role policy and hardware qualification.

The initial product only registers `SystemPlugin` and `DeviceAppsPlugin` in `android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java`; `android/settings.gradle` only includes the upstream system plugin. A plugin folder existing upstream does not make its capability available in Alpha. “Open app” proves dispatch, not task completion.

Two important gaps invalidate a naive “wire every native plugin” plan: `plugin-native-calendar` exposes `AppleCalendarPlugin` and has no Android directory; `plugin-native-reminders/src/index.ts` exports macOS policy only. Android calendar/reminders require a real Android implementation or supported platform adapter. `plugin-native-filesystem` is an agent runtime service delegating to Capacitor Filesystem, not a drop-in independent Android plugin.

## Capability ownership and source map

Paths below are relative to the repository root; plugin paths start under `vendor/eliza/plugins/`.

| Capability | Existing source / actual status | Chosen ownership and missing work |
| --- | --- | --- |
| Installed apps / Home | `android/app/src/main/java/ai/elizaresearch/alphaphone/DeviceAppsPlugin.java`; system plugin is compiled | Product grid and ordering; native package lookup and safe launch. Verify missing/disabled handlers, package changes, return and HOME separately. |
| Camera | `plugin-native-camera/src/definitions.ts`; `android/src/main/java/ai/eliza/plugins/camera/CameraPlugin.kt`, `GalleryImageWriter.kt`, `CameraDeviceReader.kt`; capture/preview/recording API and instrumentation exist | Reuse upstream camera after consumer build. Product framing, review, retake and attach; native capture and MediaStore writes. Intent capture is a valid first handoff but not an in-app camera. |
| Photos | No separate native photos plugin in inventory; camera has gallery writing | Android photo picker for user-selected media; product recent attachments and selected-media detail. Custom full gallery requires MediaStore/limited-photo permissions, pagination and deletion requests. Do not equate pick-one with a photo manager. |
| Files | `plugin-native-filesystem/src/services/device-filesystem-bridge.ts`, `src/path.ts`, `src/types.ts` | App-private drafts via local persistence; user files via Storage Access Framework (SAF), content URI grants, streaming and MIME validation. Runtime file bridge is not permission to crawl device storage. |
| Location / maps | `plugin-native-location/android/src/main/java/ai/eliza/plugins/location/LocationFixReader.kt` uses Android LocationManager without Google Play Services | Native foreground coordinates; product search, destination preview and chosen mode; navigation via installed map handler initially. AOSP supplies neither map tiles nor a routing service. Real embedded maps need a separately selected/licensed tile, geocode and routing provider. |
| Notes / transcription | `plugin-notes/README.md`, `src/browser.ts`; revision-checked cloud note mutations. `plugin-native-talkmode/src/definitions.ts`; Android `TalkModePlugin.kt` and audio-frame support | Product editor, local draft and recording review; remote Notes API as synced authority; native mic/audio; approved transcription service. Never bundle runtime actions into renderer. Local drafts must clearly distinguish saved-on-device from synced. |
| Calendar / schedule | `plugin-native-calendar/src/definitions.ts` is Apple-only; `plugin-google-workspace/README.md` provides server Google Calendar integration | Cloud connector for synced calendar, account/source identity and remote mutations. Native CalendarContract adapter for device calendar if needed, or ACTION_INSERT handoff. Deduplicate cloud/device copies by source identity. |
| Reminders | `plugin-native-reminders/src/index.ts` has no Android implementation | Product reminder records and states; native notification scheduling adapter; remote workflow for cloud actions. AlarmManager for time-sensitive user reminders; background work for deferrable sync. No JavaScript timer as durable reminder scheduler. |
| Notifications | `plugin-native-mobile-signals` monitors device signals; this does not establish a general notification inbox or reliable delivery service | Android channels and runtime permission; product activity feed and routing; server durable event IDs. Access to other apps' notifications requires a separate NotificationListenerService and user setting, and is outside own-app notification delivery. |
| Workflows | `plugin-workflow/src/routes`, `src/services`, `src/db`, `src/actions` | Reuse backend scheduler/history. Product recipe editor, permission review, pause/resume/cancel and receipts. Device unavailable must be an explicit deferred/failed condition, never silent success. |
| Email / inbox | `plugin-google-workspace/README.md` explicitly Node-only, account-scoped OAuth, Gmail/Calendar/Drive/People | Connector executes server-side; product list, thread, compose/reply, attachment, search and exact send approval. Android email intent fallback opens compose only; it cannot confirm delivery. |
| Settings | `plugin-native-system`; `plugin-native-settings` is a settings integration package, not evidence of unrestricted Android settings mutation | Product preference/connection controls; native settings deep links and capability readback. System security, accounts, VPN, accessibility and default roles remain OS-owned. |
| Secrets | `plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/SecureStorePlugin.kt` | Store product session secrets in native secure storage. A credential vault is a separate component (the integrated elizaOS password manager decided October 7, or an optional provider such as Proton Pass); never put passwords, refresh tokens or private keys in localStorage, agent context or screenshots. |
| Browser | `plugin-native-browser-surface/android/.../BrowserSurfacePlugin.kt`, `ChromiumBrowserIdentity.java`, `ChromiumBrowserLauncher.kt`; `vendor/eliza/packages/os/browser` | Prefer signed owned Chromium plus native bridge for complete browser tasks; isolated surface for bounded in-app pages only. Product owns navigation/task UI; browser owns web profile, credentials and rendering. |

## Browser architecture decision

`vendor/eliza/packages/os/browser/README.md` documents an existing component extension/native-messaging implementation, explicit tab IDs, frame-bound snapshots, invalidation after effects, chunked Android Binder transport, duplicate request rejection and no replay after interruption. Its pinned Chromium patch is generated by `scripts/chromium-component.mjs` using `scripts/chromium/upstream.json`. Android requires `is_desktop_android=true`; this is not evidence that an arbitrary stock Chrome APK supports this bridge.

The documented Android native host is `ai.elizaos.app`. Alpha's package is `ai.elizaresearch.alphaphone`. Treat host registration/manifest/certificate adaptation as upstream E3/E6 work, not a product string replacement. `ChromiumBrowserIdentity.java` accepts only `org.chromium.chrome` or `ai.elizaos.chromium` plus a 64-hex signing digest; preserve that trust boundary. `vendor/eliza/packages/os/scripts/distro-android/prepare-chromium-browser.ts` owns signed provisioning. No fallback to an unverified browser should quietly retain agent automation privileges.

The embedded `BrowserSurfacePlugin.kt` supports owner/session/epoch identity, per-surface profiles and process/storage isolation checks. It deliberately fails when isolation requirements are unsupported. Do not replace those failures with the app's privileged Capacitor WebView. Chromium documents WebView as a distinct embedding platform, and AOSP WebView integration distinguishes browser and WebView packages. [Chromium WebView](https://www.chromium.org/developers/androidwebview/), [AOSP integration source](https://github.com/chromium/chromium/blob/main/android_webview/docs/aosp-system-integration.md).

Chosen browser flows: new tab → validated HTTPS URL/search → visible origin → load/error/retry; back/forward/reload; tab switch/close/restore; download → native files; upload → scoped picker; external scheme → user-confirmed handoff; login → credential provider; agent observe → versioned proposal → approved effect → fresh observation. Preserve URL, selected tab, draft and task when returning from native screens. Reject stale frame/owner/epoch references. Downloads, permission prompts, certificate errors, OAuth redirects, file upload and passkey dialogs are required installed-browser tests, not screenshots of the web shell.

A universal assistant panel above arbitrary apps is separate OS/window/accessibility work. A launcher Activity cannot guarantee that behavior. Until qualified, return users to the product's assistant and expose share-to-agent or browser-bridge context explicitly.

## Password manager recommendation

Default candidate: preinstall the unmodified Proton Pass Android app in an owned AOSP image, subject to distribution/update integration, then guide the user through its own sign-in/unlock and Android's default-provider selection. Keep ordinary app installs user-selectable. “Force on” is a managed provisioning policy requiring a separate proof on the chosen image; it must not mean bypassing vault unlock or capturing a password. Android's documented normal mechanism is user-enabled AutofillService, with a settings intent for selection. [Android autofill service](https://developer.android.com/identity/autofill/autofill-services).

Proton documents Android autofill after selecting it as the default service and user selection of a matching login. Its Android app is offered on Google Play and F-Droid. These sources support native provider integration, not an embedded SDK or permission to read vault contents. [Proton Android usage](https://proton.me/support/use-pass-android), [Android distribution](https://proton.me/pass/download/android). Proton documents third-party passkeys on Android 14 and later after provider selection; test the exact Chromium image because API availability alone is insufficient. [Proton passkeys](https://proton.me/support/pass-use-passkeys), [Android Credential Manager](https://developer.android.com/identity/credential-manager).

Styling decision: style Alpha's setup, provider status, browser chrome and return flows. Keep credential picker/unlock UI provider-owned. Arbitrary restyling of the installed Proton app is not a supported integration shown by these sources. Its published Android source uses GPL-3.0-or-later; a branded fork needs source-license and trademark/distribution review, a separate signing/update chain and ongoing security maintenance. It is a distinct product investment. [Proton Android source/license declaration](https://github.com/protonpass/android-pass/blob/main/README.md).

Alternative: KeePassDX for users requiring a local KeePass-file vault. Its source describes local encrypted-file management and form filling; evaluate separately for recovery/sync usability before making it a default. [KeePassDX source](https://github.com/Kunzisoft/KeePassDX). Bitwarden is another candidate, but its official Android autofill page failed retrieval during this pass; no unverified feature/licensing comparison is used to make the default decision.

Agent integration contract: agent can identify that a login is needed and request the user to choose a credential; it receives only origin, provider availability, waiting/unlocked/completed/cancelled status and a fresh post-login page observation. It never receives password, OTP, recovery code, passkey private material or vault database. Do not use a password-manager CLI to export secrets into model context. Pause observation on sensitive provider UI and redact web password/OTP fields. Missing provider, locked vault, no match, multiple accounts, biometric cancellation, expired session and phishing/lookalike domain must remain explicit states.

## Platform details that affect complete flows

**Files/photos.** SAF permits access to explicitly selected documents/providers; persist URI grants when durable access is required, handle revoke/delete/move, and copy only when attachment retention needs it. Photo picker selection reduces permission scope. AOSP image/provider availability still needs testing. [Android SAF](https://developer.android.com/training/data-storage/shared/documents-files), [permission minimization](https://developer.android.com/privacy-and-security/minimize-permission-requests).

**Calendar.** CalendarContract offers device calendar data; intents can hand event creation to the installed calendar application. Empty device accounts and missing calendar UI are normal on bare AOSP. A successful insert intent is not a saved event. Require returned/provider readback before marking saved; otherwise say “Opened calendar.” [Calendar provider](https://developer.android.com/identity/providers/calendar-provider).

**Reminders.** Exact alarm access and notification permission are separate. Check scheduling capability before promising punctual alerts, maintain a durable native record, and restore eligible alarms after boot/timezone changes. Delivery may be affected by power policy; force-stop behavior must be documented rather than bypassed. User-visible state should distinguish stored, scheduled, delivered, snoozed, completed and failed. [Android alarms](https://developer.android.com/develop/background-work/services/alarms).

**Notifications.** Android 13+ generally requires POST_NOTIFICATIONS for own-app notifications. Offer setup at first reminder/task subscription, not a blanket initial permission wall. Denial leaves an in-app activity feed and a clear “notifications off” status; channel disablement must also be read back. [Notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

**Voice.** Native SpeechRecognizer may require an installed recognition service and may use remote processing. Check recognition availability; do not infer offline transcription from Android alone. Choose server transcription through the approved cloud endpoint if native service is unavailable, only after telling the user which path is used. Always preserve typed input and the recording/draft during recoverable failure. [SpeechRecognizer API](https://developer.android.com/reference/android/speech/SpeechRecognizer).

**Maps.** Use geo: intents and explicitly handle absent handlers. Location coordinates are not route computation. Manual destination entry must work with location denied. Navigation dispatch should say “Opened maps,” not “Route started” unless the provider confirms it. [Android common intents](https://developer.android.com/guide/components/intents-common#Maps).

## Unknowns and best-guess decisions

| Unknown | Working decision | Evidence needed to close |
| --- | --- | --- |
| Exact AOSP target, GMS presence and device SKU | Test the Pixel 9 phone AVD as the closest installed approximation to the Pixel 10a (Android 17) target; no GMS-only requirement in core flows | Boot manifest, WebView/provider versions, hardware/peripheral matrix |
| Production agent endpoint/account provisioning | Approved fixed origin, existing owner-scoped pairing; never arbitrary user URL | Actual test account, callback and transport contract, expired/revoked tests |
| Browser host identity and signing | Upstream consumer-configurable identity with existing checks intact | Reviewed patch/commit, signed browser + Alpha install, real bridge exchange |
| Browser update authority | Independent patch cadence and signed OTA compatibility | Named owner, reproducible browser build, update/rollback drill |
| Map data provider | Native installed-app handoff first, no invented embedded map | Licensed provider decision and route/geocode quotas if embedding |
| Calendar authoritative store | Account-scoped cloud calendar; explicit optional local calendars | OAuth permissions, source IDs, timezone/recurrence reconciliation tests |
| Voice provider and languages | Foreground press-to-record, review transcript before consequential action | Supported language/accent tests, latency/cost/retention policy, real audio |
| Non-GMS push | Durable cloud inbox + reconnect; choose qualified non-GMS transport later | Sleep/doze/offline/reboot delivery evidence; no claim of real-time push yet |
| Proton provisioning/customization | Unmodified provider, branded Alpha setup; no raw vault API | Exact APK/signature/update provenance, default-provider flow, provider collaboration if deeper integration desired |
| Native calendar/reminder plugins | Add tested Android adapters upstream or explicit product patches | Consumer build plus installed full-flow verification; no vendor edits |
| Sensitive screen agent policy | Pause capture and communicate waiting-for-user | Adversarial login/OTP/screenshots/log inspection on installed browser |

## Acceptance matrix

Run on both standalone and launcher variants, portrait/landscape Pixel-class phone geometry, large text, keyboard open/closed, Android Back/Home and process recreation. Record package SHA/version, OS image, selected provider and evidence path for every run.

| Flow | Required end-to-end evidence |
| --- | --- |
| Camera → photos → note | Grant/deny camera; capture actual image; retake; save; reopen pixels; attach only selected URI; cancel without ghost attachment; return HOME |
| Files | Pick local/cloud file; cancel; revoked grant; missing/large/unsupported file; export edited note; reopen exact exported bytes |
| Notes + voice | Record actual audio; stop/cancel; transcript edit; save; restart; sync revision conflict; offline draft recovery; no fake transcript on failure |
| Maps | Manual search with permission denied; location request/timeout; encoded destination; missing maps app; native handoff and return; real route provider only when installed |
| Calendar | Choose account/calendar; create timed/all-day/recurring event; timezone/DST; invite review; save/readback; edit/delete; revoked account; intent-only status stays handoff |
| Reminder | Grant/deny notification and alarm access separately; fire while backgrounded; tap correct object; snooze; complete; timezone change; reboot; duplicate prevention; cancel before delivery |
| Notifications | Disabled channel, denied permission, cold/warm deep links, stale deleted object, lock-screen redaction, duplicate remote delivery |
| Inbox | Actual test account pagination/search/thread; attachment; draft/restart; exact recipient review; send once; ambiguous transport result reconciled with provider; revoke |
| Workflow | Review triggers/scopes; enable; actual run; approval wait; pause/cancel; process death; offline native step; persisted receipt; no duplicate external writes |
| Browser | Signed native host handshake; tab lifecycle; fresh snapshot; stale target rejection; upload/download; auth callback; external scheme; malicious page cannot approve action |
| Password provider | User-select default, locked/no-match/multi-match; actual test login; save new login; passkey registration/login; cancellation; reboot; no secret in model, logs or screenshots |
| Settings/agent context | Change setting/read back actual OS value; selected object reflected in agent; switch account invalidates old context; denied action explains recovery; every route exposes assistant without fabricated connection |

An APK compile proves packaging. Emulator instrumentation proves those exercised paths on that image. A full AOSP boot proves image composition. Real provider tests prove their exercised account flows. Physical-device and target-user acceptance are separate gates. No table row is complete solely because its screen renders or a button opens another application.
