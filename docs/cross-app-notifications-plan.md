# Opt-in cross-app Notifications plan

Source implementation added September 30; **not yet built or device accepted**. Existing Build75 channel recovery remains acceptance for Alpha Phone's own notifications only. New source implements opt-in listener access, selected app signing identities, transient previews, active snapshot actions, separately consented encrypted metadata history, and native mock pause before activation. The synthetic companion flow and runner below are pending root-owned execution. This source status must not be reported as cross-app acceptance.

October 7 engineering disposition ([decisions](decisions.md#october-7-owner-product-decisions), P-03): keep this feature strictly opt-in and off by default, outside onboarding, limited to user-selected apps with previews hidden when locked, and clearly disclosed. It is not an MVP acceptance gate. Re-evaluate it before any Play Store distribution because of notification-listener policy.

## Current implementation and exact prototype

`AlphaNotificationsPlugin.java` uses `NotificationManager.getActiveNotifications()` for this package, process-scoped opaque IDs, lock/secret redaction, explicit PendingIntent open, clearable dismiss, and own-channel delivery diagnostics. It has no listener service, cross-app access, or durable history. `notifications-adapter.ts` refreshes only while the shade is open, drops rendered rows on background, and preserves the reference row/swipe/open/Clear all controls. `main.tsx` installs native adapters only outside fixture/mock mode. Fixture and mock mode exist only in `ELIZA_DEV_ALLOW_TEST_MOCKS=1` builds; distribution APKs cannot enter them. A future background listener still needs its own native mock-mode guard for test-mocks builds; renderer omission alone would not stop capture.

The exact shade in `template.html` (around3621–3647) has quick tiles, brightness, app/title/text/time notification rows, swipe dismissal, Clear all, Close and Settings. Reuse these rows and actions unchanged. Setup belongs in the existing Settings→Notifications detail row language, with an explicit consent/detail screen reached only on request. No default banner, synthetic messages, autonomous actions, new global overlay, or notification text appended to the agent prompt.

A no-ignore search across the pinned `plugin-native-*` Java/Kotlin/manifests found no `NotificationListenerService` or `BIND_NOTIFICATION_LISTENER_SERVICE` implementation. `plugin-native-mobile-signals` advertises notification capability/permissions/settings, not a notification-feed listener. Keep the product implementation under `android/` and the existing product adapter; do not edit vendor. Existing reminder scheduling remains separate.

## Platform boundary

Android's supported cross-app boundary is a user-enabled `NotificationListenerService`, protected in the service declaration by `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`. Calls must await `onListenerConnected`; disconnection is an unavailable state, not an empty inbox. Individual-key cancellation and lifecycle callbacks support the existing swipe/open behavior. [Android listener API](https://developer.android.com/reference/android/service/notification/NotificationListenerService)

Use the listener-specific Android settings screen (`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS`, component extra) with a general listener settings fallback if unavailable. Check actual access after return; opening Settings does not imply consent. Keep notification access separate from this app's POST_NOTIFICATIONS permission and DND settings. [Android Settings API](https://developer.android.com/reference/android/provider/Settings#ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)

Android15 redacts detected OTP content from untrusted listeners. Accept the platform's redacted payload; never seek sensitive-notification privileges, companion exemptions, accessibility scraping, or system-image workarounds. [Android15 changes](https://developer.android.com/about/versions/15/behavior-changes-all#otp-redaction)

## Consent and lifecycle flow

1. Default: own notifications continue working; cross-app capture disabled, allowlist empty, history off. Setup explains that Android grants broad notification access but Alpha filters to selected apps before reading text or retaining anything. It must not promise Android only delivers selected packages: filtering occurs inside Alpha.
2. User chooses apps from visible launcher applications in the current personal profile, with exact package identity and app label. Declare narrow launcher-intent package visibility; do not request QUERY_ALL_PACKAGES. Apps not discoverable through this bounded list are explicitly unsupported initially. Bind entries to package/signing identity; reinstall/signature change requires fresh selection.
3. Default per-app mode is redacted metadata. A separate explicit choice permits current notification title/text preview. No images, RemoteViews, messaging history, extras dumps, reply actions, conversation person data, or attachments are parsed. Package/identity/allowlist checks precede accessing Notification.extras.
4. User explicitly enables collection and opens Android's consent screen. Denial/cancel retains setup, shows access-not-granted, and captures nothing. Granted-but-not-connected is distinct from connected. On connection, reconcile only allowed current-profile active notifications; never backfill unallowed content.
5. Screen lock immediately drops in-memory preview text and opaque action capabilities. Secret notifications always remain generic. Private notifications remain redacted unless unlocked and preview explicitly allowed. Recheck actual lock/access/allowlist at every list/open/dismiss, not merely callback time. Preserve OS redaction without attempting content recovery.
6. Changing/disabling an app invalidates its capabilities and purges its cache/history synchronously under the same policy generation before acknowledging success. Disabling cross-app collection clears content/cache/history and requests listener unbind; show that Android access remains enabled until user revokes it in Settings. External revoke is detected by access readback on every bridge call and listener disconnect; purge even after a cold start. A transient disconnect without revoke invalidates actionable state and shows unavailable; it does not claim permanent permission loss.
7. Native mock entry pauses collection and clears ephemeral previews, even if the OS listener remains granted. Persist the pause across process restart and reject late callbacks with the prior policy generation. Leaving mock requires explicit Resume collection; it must not silently re-enable. Temporary Activity background does not revoke deliberate background capture, but renderer snapshots and capabilities are cleared.

## Native implementation contract

Add `AlphaNotificationListener` plus a product-owned repository shared with `AlphaNotificationsPlugin`. Service is bound only by Android, no custom exported receiver or renderer-accessible Binder. Use a serialized bounded worker/repository; callback payloads are not logged. Policy generations prevent queued work from persisting after revoke/allowlist changes. Keys and PendingIntent objects stay native; bridge returns UUID+revision capabilities only.

Proposed additive methods:

- `crossAppStatus()` → enabled/accessGranted/connected/mockPaused, policyRevision, selected app metadata, redaction/history settings. No notification content in status.
- `notificationApps()` → bounded visible same-profile launcher app identities; not the entire installed-package inventory.
- `setNotificationPolicy({expectedRevision,apps,preview,history})` → compare-and-set receipt. Cap20 selected apps. Validate package/signature identities natively, never accept arbitrary user/profile IDs.
- `openNotificationAccess()` → opened/unavailable, followed by explicit actual status refresh.
- `pauseCrossApp()` / explicit `resumeCrossApp()` → durable policy receipt; resume cannot grant Android access.
- Extend `list({cursor?})` with up to100 active allowed rows, `{id,revision,appLabel,title,text,at,clearable,canOpen,redacted,source}`. Reconcile own rows once, without duplicate own/listener entries. Live cursor/revision invalidates on updates/revoke; old capabilities cannot target replacement notifications that reuse a key.
- `open({id,revision})` re-resolves the current allowed active notification, same post/update revision, unlocked foreground host and current contentIntent. Invoke only on the user's actual tap. For an initial conservative boundary, require creator UID matches posting UID and same profile; delegated creator cases return unsupported. Do not enumerate arbitrary action/reply intents. Auto-cancel only the exact current row after successful intent dispatch. Dispatch acceptance is not proof the destination completed work.
- `dismiss({id,revision})` requires current clearable row and reports requested until removal callback/readback verifies removal; never optimistic permanent history deletion. Own notifications continue to use the existing local manager.
- Replace cross-app Clear all with `dismissMany({items:[{id,revision}]})` over the displayed immutable snapshot, max100, independent per-item outcomes. Never call listener cancelNotifications(null): that would include unselected/new/unallowed notifications. Ongoing rows remain visible.

## Durable history boundary

History is a distinct explicit opt-in; active shade remains active notifications, not a mixture implying removed rows still act. First slice stores only redacted event metadata (opaque ID, selected app identity, post/update/removal time, local status), maximum100 records/24hours, in a dedicated Android Keystore-encrypted file excluded from backup. No title/text/body/URI/PendingIntent or foreign key is persisted. Preview remains ephemeral even with history enabled. Reuse the project's encryption/atomic-write pattern, not connection credential slots. Purge at read/write/startup and on per-app removal/revoke/disable; key loss/corruption yields unavailable/reset disclosure, never plaintext fallback.

History can be reached explicitly from Settings→Notifications with existing list style; label rows "Removed" or "No longer active" and provide clear-local-history confirmation. It must never replay a historical open/dismiss capability. A fuller searchable content history would need a new specific consent and acceptance slice. This plan does not claim it from redacted retention.

## Agent boundary

No automatic notification bodies, app inventory, or history reach the agent. Existing all-view agent access remains available independently. A future explicit "Use this notification" action must separately review the exact disclosed text and bind to notification revision/session before sending; do not infer this consent from OS listener access. Initial implementation may expose only an opaque notification selection context after adding its type to validated context schemas, with no preview in the envelope. Agent-controlled dismiss/reply/send is outside this slice.

## Synthetic other-package acceptance

Create a test-only companion APK with a different package/UID and unique signer identity, no network permission, one launcher Activity, and nonce-bound fixture controls. Its explicit Activity posts PUBLIC, PRIVATE, SECRET, ongoing, replacement and auto-cancel notifications; a package-owned content Activity records a receipt for exact nonce on actual tap. It must never send messages or operate on real user notifications. Keep a second synthetic package or independently unselected fixture app for allowlist exclusion; own Alpha notices cannot substitute for cross-UID proof.

The immutable-archive runner hashes app/test/companion APKs and verifies package/signer before install. Require a disposable device with no pre-existing Alpha listener grant/policy; refuse instead of overwriting unknown consent. Snapshot companion install/permission state; unique fixture namespace and exact cleanup only. Use genuine Android consent UI, not shell grant. Tests must show:

- Before access, after denial, and with empty allowlist: no foreign content/cache/history. Grant alone still captures no unselected content.
- Explicit single-app selection/preview shows only synthetic allowed content. The unselected package's canary never appears in renderer/store/network/agent envelope.
- Real row tap reaches the companion Activity and records exactly one nonce; replacement/stale capability never opens the new notification. Swipe and Clear all remove only selected clearable snapshot rows, leaving ongoing/unallowed/newly posted notices.
- Lock/private/secret boundaries, absent PendingIntent, removed/updated notifications, disconnect/reconnect and stale actions fail truthfully. No raw bodies in diagnostics.
- App deselection and actual Android revoke purge selected previews/history/capabilities, including queued callback races. Native mock entry/cold restart remains paused and does not read foreign content.
- History opt-in persists redacted metadata across distinct process IDs; current active feed reconciles; history-off/clear/revoke erases it. Exact synthetic canaries are absent from encrypted file bytes and all logs; encryption alone is not proof of no disclosure, so inspect bounded bridge envelopes separately.
- Restore original fixture permission/install policy when owned; any interrupted cleanup is failure with retained exact recovery manifest, not a green result.

Stage implementation: (1) consent/allowlist/service + exact active feed/open/dismiss/revoke and synthetic cross-UID proof; (2) explicit encrypted redacted history and process restart; (3) separately reviewed explicit agent context and supported actions. Both standalone and launcher must run each stage. Android API/build success does not prove another app's notification behavior, OTP classifier accuracy, work-profile support, physical OEM behavior, full AOSP image acceptance or production listener eligibility.

## Implementation and pending execution (September 30)

Product source: `NotificationAccess.java`, `AlphaNotificationListener.java`, additive `AlphaNotificationsPlugin` methods, existing shade and Settings→Notifications adapters. The listener is Android-bound, with a single bounded worker queue (64 callbacks). A policy generation invalidates queued work before a policy acknowledgement or mock entry; external key replacement invalidates action capabilities immediately before callback work. No external content enters agent context. Collection defaults off, app selection empty, preview off per app and history off. Existing channel recovery controls remain separate.

In test-mocks builds only (`ELIZA_DEV_ALLOW_TEST_MOCKS=1`), both `connectionController.mock()` and a direct/cold Android mock URL await `AlphaConnection.pauseNotificationCollection` before saving/mounting mock mode. Distribution APKs have no mock entry; after an upgrade from an earlier build that paused collection, a saved mock selection is rewritten to no selection and the pause is kept until the user makes an explicit connection choice and resumes. The pause is durable; returning to live mode does not automatically resume. Settings provides explicit Resume. Title/text are only read from currently allowed, same-profile, signer-matching notifications while unlocked and preview-enabled; SECRET rows remain generic. History stores only encrypted app identity/status/time, capped at 100 records and 24 hours. It never stores raw notification key, PendingIntent, title or body. Corruption remains unavailable with an explicit clear/reset action. App deselection, access revoke, disable and mock pause purge retained records.

The `notification-fixture` Gradle module is not a dependency of Alpha and has no Internet permission. Its two variants use separate package/UID identities, exact UUID notification namespaces, synthetic-only posting and an actual content-Activity tap receipt. Build the witnesses separately with:

```sh
node scripts/build-notification-fixture.ts test-results/notification-fixture-NN
```

That script generates an owner-only disposable test signer distinct from Alpha. The test refuses a matching Alpha signer, existing listener grant, enabled/nonempty/history policy, or preinstalled witness packages. Root alone runs:

```sh
ANDROID_SERIAL=emulator-5554 node scripts/test-cross-app-notifications.ts \
  test-results/prototype-buildNN/standalone-debug.apk \
  test-results/prototype-buildNN/standalone-androidTest.apk \
  test-results/notification-fixture-NN test-results/prototype-buildNN/cross-notifications-standalone
```

Pass `--restart` to run the process-restart campaign with the same arguments and a new output directory.

Repeat the corresponding launcher pair only after inspecting the first result. The test uses actual Android consent UI, confirms empty selection after grant, redaction/default previews, excludes the unselected package, rejects a stale replacement action, dispatches a real PendingIntent, clears only an immutable synthetic external snapshot, preserves ongoing/unselected notices, reads encrypted redacted metadata after Activity recreation, verifies durable pause and explicit resume, deselects and revokes. Its runner preserves exact APK/signer hashes and cleanup evidence; a failed cleanup remains failure. The runner never shell-grants notification listener access. Runtime POST_NOTIFICATIONS grants apply only to newly installed disposable synthetic packages, which the runner removes.

Still unverified: all new native source/build/lint/runtime behavior, exact Android consent UI labels, real distinct-process retention/mock pause, screen-lock transitions, queue overflow and revoke races under service pressure, provider/OEM quirks, physical device, signed OS image and visible Computer Use. Activity recreation is not process restart. No real third-party app is selected or tested by this fixture. No blanket “all notification flows pass” claim is supported until these remaining cases are executed.

### History-clear race repair for the next archive

Explicit Clear now advances the notification generation and deletes history under one lock before returning its acknowledgement. Internal pruning remains separate. The gated cross-UID test holds the actual listener worker using test-only reflection, posts a real synthetic companion notification, requires its callback to be queued, clears through the production bridge, releases the worker, and asserts that the earlier event cannot repopulate the history. A subsequent real post must still be recorded. The barrier is bounded and released in `finally`; no production test hook or fabricated callback is added. Native execution remains pending.
