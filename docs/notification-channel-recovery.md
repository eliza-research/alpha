# Notification channel recovery

The native bridge provides read-only app permission, each existing own channel's importance and group-blocked state, and Android interruption-filter readback. Existing Notifications settings rows display the limitation; an enabled app no longer implies its reminder channel is enabled. DND status describes interruption policy, not guaranteed delivery. No DND mutation, notification-listener access or content upload is added.

`AlphaNotifications.status()` issues opaque current-process channel capabilities. `openChannelSettings({id})` accepts only one of those IDs and rechecks the channel still exists before opening Android's channel settings for this package. The app cannot silently re-enable channels. Settings refreshes on return and reentry; query failures show unavailable. Existing prototype components supply the layout without template changes.

Official platform contracts: [NotificationManager](https://developer.android.com/reference/android/app/NotificationManager), [channel settings intent](https://developer.android.com/reference/android/provider/Settings#ACTION_CHANNEL_NOTIFICATION_SETTINGS). App access is confined to its own channels. Other-app notification collection and redaction are separate from this channel-settings contract.

Run each immutable distribution separately:

```sh
ANDROID_SERIAL=emulator-N ALPHA_NATIVE_TEST_AVD=owned-avd-name ALPHA_NATIVE_TEST_ABI=x86_64 node scripts/test-native-permissions.ts channels ARCHIVE/standalone-debug.apk ARCHIVE/standalone-androidTest.apk OUTPUT
```

The shared runner validates both archived hashes, leases the emulator, and refuses existing product packages. It grants POST_NOTIFICATIONS only in a fresh secondary user, runs the exact opt-in method, and verifies owned package/user cleanup. Uncertain termination preserves the fixture for recovery. The test creates one UUID synthetic channel; it changes that channel through real Android Settings, observes blocked status while app permission stays allowed, explicitly restores it through Settings, then posts a real notification and taps its actual prototype shade row. An exact package-scoped synthetic broadcast receipt proves the original PendingIntent target was invoked; no real mail/message or user reminder is sent. Unknown channel IDs are rejected. Cleanup cancels only its notification and deletes only the newly-created channel; existing user channels are never changed. Android may internally retain a tombstone for deleted channel IDs; no claim of removing platform audit history is made.

Qualify both current distributions and retain raw method completion and cleanup evidence. Source checks and APK compilation do not prove the Settings/shade interaction. This campaign does not establish DND manipulation, physical delivery timing, full AOSP boot or third-party notification behavior.
