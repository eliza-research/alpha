# Visible Calendar ranges and real text size

Native provider, external calendar synchronization and physical-device accessibility are separate acceptance gates.

Calendar queries Android CalendarProvider around the visible selected month, including adjacent month-grid dates, rather than a fixed window relative to today. Queries remain bounded to approximately three months and the native370-day/2,000-instance limits remain. Navigation invalidates older responses and coalesces rapid range changes. Unknown, loading, denied and failed ranges cannot say “Free all day.” An explicit device-calendar refresh retries failure. Local reminders remain distinct from provider events. Saving a new event refreshes its actual selected date range.

`CalendarRangeInstrumentedTest#distantDatesLoadRealRowsAndNewestNavigationWins` creates only its own CalendarProvider calendar and real fixture events120days before and430days after today, uses the reference month/day controls, changes months around each query, and verifies the correct actual event without a stale event from another date. Cleanup deletes only the owned calendar. Existing calendar timeline/edit tests must also pass the new query lifecycle.

Settings Text size now changes the actual host WebView text zoom, persisted in Alpha's private Android preferences. The existing slider maps to75–150% relative to Android's accessibility font scale; default100% preserves normal reference sizing. Effective zoom is recomputed from the preference and current Configuration.fontScale, never multiplied into an already-scaled value. Activity creation/resume/configuration reapplies it. Browser child WebViews and external Android apps keep their own settings; the Alpha preference does not override website or external-editor sizing. There is no CSS transform of the entire screen.

Android documents [WebSettings.setTextZoom](https://developer.android.com/reference/android/webkit/WebSettings#setTextZoom(int)) as a percentage. Chromium's [AwSettings implementation](https://chromium.googlesource.com/chromium/src/+/main/android_webview/java/src/org/chromium/android_webview/AwSettings.java) records an explicit embedder zoom and skips its automatic fontScale update afterward. Alpha therefore includes Android fontScale exactly once when applying its own relative preference. Different WebView releases and physical large-font layouts still require qualification.

`TextScaleInstrumentedTest#textSizeChangesRealNotesAndSurvivesActivityRecreation` changes the actual Settings slider, verifies native persisted/effective zoom and enlarged rendered Notes glyph bounds, recreates the Activity and verifies again, then restores the prior preference. The separate gated `textScaleProcessRestartPhase` uses prepare/verify/cleanup and `scripts/test-native-restart.ts text-scale APP.apk MATCHING_TEST.apk OUTPUT` with the [owned-emulator configuration](verification.md) and matching archived APKs; the shared upstream lifecycle isolates a fresh user and force-stops between phases, verifies real glyph geometry in the new process, records matching APK hashes and restores only the fixture's prior preference. Current-source native execution must be recorded separately from fixture compilation.

## Completeness and recovery

The 2,000-instance bound is this product's read policy. `AlphaCalendarPlugin.CONFIGURATION`
sets `maximumReadEvents` to 2,000, and the shared `list` then returns the first 2,000
non-deleted instances by start and reports `truncated` when the provider held at least one
more (exactly 2,000 is a complete result). The bound is not journal identity, so changing it
is not a storage migration. The shared `list` also returns `creationId` on events this app
saved through its timed creation journal, which is what the Calendar view keys the
"From note" link by. Until this change Alpha overrode `list` with its own reader
(`CalendarRangeReader`), whose rows had no `creationId`, so on Android an event saved from a
note never showed its note link. Events saved through the option journal (all-day, zoned or
repeating saves) are stored under `alphaphone://calendar-creation/options/`, which the pinned
shared reader does not return as a `creationId`; those events still show no note link.
`test/calendar-range-reader.test.mjs` runs the pinned shared reader with Alpha's configuration
on the JVM against a stand-in provider. It is not a device run; the truncation fixture and a
"From note" check on the emulator have not been rerun since this change.

Truncated provider results retain an incomplete-results warning and explicit retry;
unreturned dates cannot say “Free all day.” The truncation fixture creates 2,001
distinct events plus a sentinel in its own calendar, checks all 2,002 provider rows
before UI assertions, and deletes only that calendar. Inserts use batches of at
most 200 and require a URI for every result. Do not assume recurrence expansion
will produce enough rows to exercise the limit.

Run `node scripts/test-calendar-regression.ts --case=CalendarRangeInstrumentedTest`
and `node scripts/test-calendar-regression.ts --case=CalendarTruncationInstrumentedTest`
after `npm run android:build -- --test-mocks` (the runner installs the verified
`artifacts/test-mocks/` pair). Set `ALPHA_CALENDAR_TEST_SERIAL`,
`ALPHA_CALENDAR_TEST_AVD` and `ALPHA_CALENDAR_TEST_ABI` (`x86_64` or `arm64-v8a`).
Each command checks both distributions unless `--variant=standalone` or
`--variant=launcher` is supplied. The upstream harness leases the emulator,
refuses existing package registrations, verifies installed APK bytes and runs the
exact method in a fresh secondary user. Calendar grants affect only that user;
uncertain cleanup retains the fixture for recovery. Reports are written beneath
`test-results/calendar-regression-*`.
Both range navigation and truncation methods must pass. Rapid A→B→A navigation
must discard the retired query and issue a fresh query for the final range.

Failed reminder refresh keeps a warning across navigation. Existing reminder
mutations first refresh stale data and require the user to retry explicitly.
The bridge-rejection fixture proves that transport boundary, not disk-corruption
recovery.

Settings Accounts opens Android synchronization settings. Location status must
distinguish precise, approximate and denied grants. The Settings native runner
snapshots and restores grants and flags, verifies restoration, and refuses states
it cannot safely restore.
