# #664 Qualify the always-on listener (gates G1 to G6)

Owner prep for [#664](https://github.com/eliza-research/alphaphone/issues/664) (checklist step
H-20 in [human actions](../human-actions.md), P-40, requirements AP-06 and AP-14, umbrellas #377
and #424). It turns the gate table of [ADR 0001](../adr/0001-privileged-listener.md) into device
steps with adb commands and expected results, and adds a read-only evidence capture script,
`scripts/owner/listener-evidence.mjs`. It also records read-only checks of the SystemUI bundles
against the pinned Android tree. Nothing here built an image or an APK, booted anything or
touched a device.

Evidence classes stay separate. G1 is an **image build**. G2 is an **image boot**, on Cuttlefish
or the Pixel. G3 to G6 are **device acceptance** on a physical Pixel 10a. The capture script
refuses to count a virtual device or another model as device evidence. It can earn only G2
(`evidence.aospImage`) from `--class image`.

## Read-only findings (2026-10-28, `origin/main` 94676c82, eliza pin `1f2a922f86e2`)

**`npm run human:status` reports H-20** as open:
`qualified: false; G1 open, G2 open, G3 open, G4 open, G5 open, G6 open, G7 deferred`.
`android/sense/qualified-listener.json` also says `evidence.apkBuild.current: false`, which is the
2026-10-12 developer build from before the indicator lease. No emulator, image or device
evidence exists, and `indicatorLease.systemUiCompiled` is `false`.

**The SystemUI bundles apply to the pinned tree.** The local AOSP tree `/home/shaw/aosp` has
`frameworks/base` at `94b4c163b7dfe5ce3607f7bb8456f9573f7de57d`, the revision all three bundle
manifests name, and `git status` shows no change under `packages/SystemUI`. The checks below
were read-only: preimages were read with `git show <rev>:<path>`, and the patches were applied
with `git apply` to copies in a scratch directory. The AOSP tree was not written.

| Bundle (`vendor/eliza/packages/os/android/sense/systemui/…`) | Patch hash vs manifest | Preimages at the revision and in the worktree | `git apply` on copies | Postimages |
| --- | --- | --- | --- | --- |
| `microphone-ops.patch` (`ops`) | match `8cf2ae55…` | 2/2 `before` | clean | 2/2 match |
| `chip/listening-chip.patch` (`chip`) | match `0ac55675…` | 3/3 `before`, 6 new files absent | clean | 9/9 match |
| `assist/assist-identity.patch` (`assist`) | match `3d9c19ad…` | 1/1 `before` | clean | 1/1 match |

All three manifests' `baselineLockSha256` (`760a7184…`) equals the SHA-256 of the pinned
`packages/os/android/sources/pixel10a-stallion.json`, and that lock pins `frameworks/base` at the
same revision. This checks only the listed SystemUI files. It is not a full-tree verification,
a SystemUI compile or an image build.

**Wiring into listener staging.** At the pin, `stageSenseListener` (`scripts/aosp-listener.mjs`
calls it from `npm run aosp:stage`) handles the bundles like this:

- `chip`: copied to `listener/systemui/chip`. Staging generates the certificate overlay and
  appends `listener/listener.mk` (which adds the chip overlay and
  `ro.hotword.detection_service_required=true`) to `product.mk`. `listener/evidence.json`
  records chip as the single `requiredSourcePatches` entry, with `sourcePatched: false`.
- `ops` and `assist`: **not copied** into listener staging and **not required**. They are
  admitted only when the operator has already applied them to the build copy and passes
  `--applied-systemui-patch ops` and `--applied-systemui-patch assist`. Staging then checks the
  postimages and records the files as source overrides. A production `aosp:stage --production`
  with only the chip, or with no applied patch, is accepted.
- Without `ops`, `OP_RECORD_AUDIO_HOTWORD` is missing from the SystemUI microphone indicator op
  lists, so the G3 system microphone indicator may not show for HOTWORD capture. Without
  `assist`, press-and-hold power opens the assistant but never starts a voice turn, so G4 fails.
- Two docs say more than the code does. [`aosp-listener-systemui.md`](../aosp-listener-systemui.md)
  step 1 says staging copies "the entire listener configuration, including this patch", and
  [`aosp-listening-chip.md`](../aosp-listening-chip.md) says it "copies both bundles". The code
  copies only `chip`. Doc fix and enforcement are left to the owner (D-1 below).

**Privapp enforcement is not set by any Alpha or shared listener file.** At the pinned
`frameworks/base`, an unset `ro.control_privapp_permissions` means
`CONTROL_PRIVAPP_PERMISSIONS_DISABLE` (`RoSystemProperties`). The only setter in the local tree
is `device/google/cuttlefish/shared/device.mk` (`?=enforce`, so Cuttlefish enforces). The local
tree has no Pixel (`stallion`) device tree, so whether the Pixel 10a image enforces is unknown.
G1 needs "privapp enforcement accepts the allowlist". Check
`adb shell getprop ro.control_privapp_permissions` on the booted image (the capture script
records it as `gates.G2.g1Observation`), and see D-2.

## The capture script

`scripts/owner/listener-evidence.mjs` (tests: `test/owner-listener-evidence.test.mjs`, fixtures in
`test/fixtures/owner-listener-evidence`, all synthetic).

- It talks only to the `--serial` the operator names. It sends only read-only commands
  (`getprop`, `pm list`, `dumpsys`, `settings get`, `device_config get`,
  `cmd role get-role-holders`, `am get-current-user`, `logcat -d`), checked against an
  allowlist before each call. It never presses keys, starts activities, changes settings,
  resets batterystats or kills processes. The operator sets up each scenario by hand.
- It keeps only the listener's lines: its package and UID, the `SenseListener` tag,
  `AlphaAssistActivity` launches, audio mode and focus owners, battery, thermal and
  wakefulness. It drops other apps' notification text, user names and unrelated logcat, and
  hashes the serial.
- G2 runs the existing upstream verifier (`verifyAospListener`, the same check as
  `node scripts/verify-aosp-listener.mjs`). It needs `vendor/eliza` at the pin.
- It writes a **new** file (never overwrites, never `android/sense/qualified-listener.json`).
  The file holds per-gate automated checks, the manual items with the operator's attestations,
  and `candidateRecord`: the committed record with only this run's earned gates applied,
  validated by `listenerRecordProblems`. `qualified` and `distributable` are never changed.
- A gate is `passed` in the candidate only when every automated check passes, every manual item
  for that gate is attested `pass` in `--attest` (template:
  [`664-listener-attest.template.json`](664-listener-attest.template.json)), a reviewer is named,
  and the evidence class is allowed for that gate.

```sh
node scripts/owner/listener-evidence.mjs --dry-run --gates G2,G3,G4,G5,G6        # prints every command, contacts nothing
node scripts/owner/listener-evidence.mjs --serial <serial> --user 0 --class device --gates G3 \
  --label "G3 lock screen + AOD" --attest /abs/attest-G3.json --out docs/evidence/listener-<date>/g3.json
```

Expected console output: `Wrote …`, then one line per gate, for example
`G3 passed automated 6/6, manual 13/13`. A virtual device given `--class device` prints the class
problem, and every gate stays `open`.

## Gate runbook

Hardware: a physical Pixel 10a (`ro.product.device` `stallion`), unlocked bootloader, flashed
with the Alpha image built in G1. Use wireless debugging for G6 so USB does not charge the phone.
A second phone (for calls), a Bluetooth headset and another recorder app are needed for G5.
Abbreviations: `S` is the serial, `PKG` is `ai.elizaresearch.alphaphone.sense`.

### G1 Image build (image-build evidence)

1. Prepare the three SystemUI overlays from the original, verified source (each `--output` is new
   and outside the source):
   ```sh
   node scripts/aosp-listener-systemui.mjs --source /abs/aosp --output /abs/ovl-ops
   node scripts/aosp-listener-systemui.mjs --source /abs/aosp --chip --output /abs/ovl-chip
   node scripts/aosp-listener-systemui.mjs --source /abs/aosp --assist --output /abs/ovl-assist
   ```
   Expected: JSON with each file's before and after hashes, plus `derived-source.json` in each
   output.
2. In a separate disposable build copy, check the preimages
   (`--source /abs/build-copy`, `… --chip`, `… --assist`), copy only the listed
   `frameworks/base/packages/SystemUI` files, then check each bundle with `--after`.
3. Check the build copy against the lock:
   `node scripts/verify-pixel10a-source.mjs --aosp-source /abs/build-copy --factory-image /abs/stallion-….zip --applied-systemui-patch chip --applied-systemui-patch ops --applied-systemui-patch assist --out /abs/new-source-receipt.json`.
4. Build the listener APK (`HEAVY_ANDROID=1 heavy ./gradlew :sense:assembleRelease --no-daemon`
   from `android/`), then preprocess and sign it with the launcher certificate as the ADR
   Consequences describe. Check it with `python3 scripts/verify-aosp-listener-apk.py <apk>`.
   Write the reviewed listener descriptor (`packageName`, `apkSha256`, `certificateSha256`).
5. Stage:
   ```sh
   npm run aosp:stage -- --target pixel10a --factory-image /abs/stallion-….zip --aosp-source /abs/build-copy \
     --apk <launcher-release.apk> --descriptor <descriptor.json> --production \
     --listener-apk <sense-release.apk> --listener-descriptor <listener-descriptor.json> \
     --applied-systemui-patch chip --applied-systemui-patch ops --applied-systemui-patch assist --output /abs/new-stage
   ```
   Expected: `Always-on listener staged: ai.elizaresearch.alphaphone.sense (privileged, no network)`.
   `listener/evidence.json` should have `speechIncluded: true` and a chip `requiredSourcePatches`
   entry.
6. Build the image. Expected: the build succeeds and the SystemUI module compiles with the chip
   sources (this is the first SystemUI compile). Keep the build log and the unsigned target-files
   SHA-256.
7. Privapp enforcement (D-2): on the first boot, `adb -s S shell getprop ro.control_privapp_permissions`
   must print `enforce`. Also `adb -s S logcat -d | grep -i "privapp"` must show no "Privileged
   permission … not in privapp-permissions allowlist" for PKG.
8. Record: `gates.G1 = "passed"`, `evidence.apkBuild` = current build record with `current: true`,
   `indicatorLease.systemUiCompiled = true` (reviewer).

### G2 Boot and grants (image-boot evidence; Cuttlefish or Pixel)

1. Before turning listening on:
   `node scripts/verify-aosp-listener.mjs --serial S --user 0`. Expected JSON:
   `privileged: true`, `persistent: true`, `captureHotwordGranted: true`,
   `recordAudioGranted: false`, `indicatorVerified: false`. Any refusal (not system, not
   privileged, forbidden permission, Alpha privileged, `ro.hotword.detection_service_required`
   not `true`, `camera_mic_icons_enabled` `false`, an indicator-exempt role held) fails G2.
2. Same state:
   `node scripts/owner/listener-evidence.mjs --serial S --user 0 --class image --gates G2 --label "G2 pre-consent" --attest … --out …/g2.json`.
   Expected: 5/5 automated checks pass (`G2.verifyAospListener`, hotword property, mic icons, roles
   empty, verified boot `green` or `yellow`). `facts.audio.listenerRecording` must be `false`.
   `gates.G2.g1Observation.enforced` must be `true`.
3. Manual items: `G2.noCaptureBeforeConsent` (no microphone indicator, no listener recording
   before opt-in). `G2.consentRequestsRecordAudioAndNotifications` (the consent screen asks for
   both, and declining leaves listening off).

### G3 Indicator (device acceptance, Pixel 10a)

Turn listening on through consent, unlock, confirm the notification reads "Say “…” to ask. Audio
stays on this phone and is not saved." Then capture with `--class device --gates G3` while
listening. Expected automated checks:

- `G3.listenerRecordingObserved`: a `dumpsys audio` recording configuration for the listener
  UID, not silenced.
- `G3.hotwordSource`: `source:HOTWORD`.
- `G3.appopsRecordAudioRunning`: `dumpsys appops --package PKG` shows the `RECORD_AUDIO` op
  `Running`.
- `G3.listenerNotificationPosted`: a `NotificationRecord` for PKG on channel
  `listening-indicator`.
- `G3.lockScreenNotificationsOn`: `lock_screen_show_notifications` is not `0`.
- `G3.noListenerCrash`.

Manual items (attest each one, with a photo or screen recording path; no audio):

| Item | Do | Expect |
| --- | --- | --- |
| `G3.micIndicatorUnlocked` | Unlocked home screen | System microphone dot or chip visible |
| `G3.chipStatusBar` | Unlocked | "Listening · Pause" chip in the status bar |
| `G3.chipLockScreen` | Press power, then wake to the lock screen | Keyguard chip and listener notification visible |
| `G3.chipAod` | Always-on display on, screen off | AOD shows the chip; listening continues |
| `G3.hideSilentNotificationsOn` | Settings › Notifications › hide silent notifications on | Indicator still visible; otherwise state is `NOTIFICATIONS_REQUIRED` |
| `G3.notificationLockScreenControls` | On the lock screen tap Pause, then Turn off | Both work without unlock; Resume asks for unlock |
| `G3.systemUiKillStops` | On a userdebug image of the same source (record the build type): `adb root; adb shell pkill -f com.android.systemui` | Capture stops within about 3 s (lease TTL); state `STOPPED_INDICATOR_LOST`; it does not resume after SystemUI restarts |
| `G3.immersivePauses` | Fullscreen video app | "Paused while an app is fullscreen"; resumes on exit |
| `G3.shadePauses` | Expand the shade | Pauses unless the dedicated shade chip is measured visible ("Paused while the notification shade is open") |
| `G3.unattributedRecordingStops` | A recording SystemUI cannot attribute (per [listening chip](../aosp-listening-chip.md)); record how it was produced | Stops and latches |
| `G3.aodOffPausesAndResumes` | AOD off, screen off, then wake | "Paused — screen off without Always-on display"; resumes when the lock-screen chip shows |
| `G3.noResumeAfterLoss` | After any latched loss | Stays stopped until an explicit Resume |
| `G3.senseConsentText` | Read the consent screen | Says the indicator is *expected* to show until G3 passes, then the owner updates it |

Also record HOTWORD attribution under `ro.hotword.detection_service_required` at the pinned tag,
and check that `PixelConfigOverlay*` does not reassign the cleared roles (G2 role check on the
Pixel).

### G4 Hardware invocation (device acceptance, Pixel 10a)

Unlocked and signed in. Press and hold power, then capture with `--gates G4`. Expected automated
checks:

- `G4.longPressPowerIsAssistant`: `power_button_long_press` is `5`, or `null` (the overlay
  default).
- `G4.powerVolumeUpIsPowerMenu`: `key_chord_power_volume_up` is `2` or `null`.
- `G4.assistantRoleIsAlpha`: the `ASSISTANT` role holder is `ai.elizaresearch.alphaphone`.
- `G4.emergencyGestureNotDisabled` and `G4.cameraDoubleTapNotDisabled`.
- `G4.assistLaunchLogged`: logcat
  `START u0 {act=android.intent.action.ASSIST … cmp=ai.elizaresearch.alphaphone/.AlphaAssistActivity}`.

`gates.G4.facts.activity.launchedFromSystemUi` shows `launchedFromPackage=com.android.systemui`.
That is the activity record only, not proof that identity was shared.

| Item | Do | Expect |
| --- | --- | --- |
| `G4.pressHoldStartsOneVoiceTurn` | Press and hold power | Assistant opens and starts exactly one voice turn (needs `assist` applied) |
| `G4.appSentAssistOnlyOpens` | `adb -s S shell am start -a android.intent.action.ASSIST` (operator action) | Assistant opens with the microphone closed |
| `G4.powerVolumeUpPowerMenu` | Power + volume up | Power menu with shutdown, restart and Emergency |
| `G4.emergencySosUnchanged` | Five quick presses (cancel before the call) | Emergency SOS countdown starts as on stock |
| `G4.doublePressCameraUnchanged` | Double press power | Camera opens |
| `G4.coldStartWakeOwnerAdmission` | Force-stop Alpha, say the wake phrase | Assistant opens with the microphone closed unless the same owner binding already exists; never across owners |
| `G4.lockedWakeIgnored` | Locked, say the wake phrase | Nothing opens; logcat `SenseListener: Wake phrase ignored while locked` |

### G5 Coexistence (device acceptance, Pixel 10a)

Capture one snapshot (`--gates G5 --label "<scenario>"`) in each scenario while it is active, and
once after it ends. Expected: in the "during" snapshot `facts.audio.listenerRecording` is `false`
(or the listener is in a paused state). It returns to `true` afterwards, except for the user and
reset cases.

| Item | Scenario (operator) | Expect |
| --- | --- | --- |
| `G5.guestSwitchStops` | Switch to a guest user | Capture stops (`PAUSED_OTHER_USER`); nothing processed for the guest; `am get-current-user` ≠ 0 |
| `G5.secondaryUserStops` | Switch to a secondary user | Same |
| `G5.ringingPauses` | Incoming call ringing (second phone) | Paused while ringing |
| `G5.callPauses` | Answer the call | `PAUSED_CALL`; `dumpsys audio` mode `IN_CALL` |
| `G5.otherRecorderReleases` | Start a recorder app | Listener releases the microphone (`PAUSED_MIC_IN_USE`); the recorder gets audio |
| `G5.alphaVoiceTurnReleases` | Alpha voice turn | Listener releases while Alpha records |
| `G5.mediaSuppressesWake` | Play media and say the wake phrase | No invocation |
| `G5.bluetoothRouting` | Bluetooth headset connected, call and media | Pauses and recovers as above |
| `G5.noEchoReinvocation` | Alpha speaks a reply containing the wake phrase | No new invocation |
| `G5.recoversAfterEach` | After each scenario ends | Returns to `LISTENING` without user action (except a latched stop) |
| `G5.revocationOnReset` | Settings › Apps › Sense › Microphone: Don't allow; Reset app preferences; factory reset | Capture stops (`PERMISSION_REQUIRED`); after reset `recordAudioGranted: false` and listening is off until a new opt-in |

### G6 Reliability and power (device acceptance, Pixel 10a)

Stop items, each followed by a G6 snapshot (`--gates G6`):

| Item | Do | Expect |
| --- | --- | --- |
| `G6.pauseFromNotification` / `G6.turnOffFromNotification` | Notification actions | Stops at once; Turn off survives restart |
| `G6.tilePause` | Quick Settings tile | Pauses |
| `G6.lockScreenPause` | Pause on the lock screen without unlock | Pauses; Resume asks for unlock |
| `G6.rebootBeforeUnlockNoCapture` | `adb -s S reboot`, capture before the first unlock | No listener recording; "Listening starts after unlock"; a new opt-in is needed after restart (ADR persistence rule) |
| `G6.crashLoopStops` | Crash the listener 3 times within 10 minutes (`adb shell am crash PKG`; on a user build, use a userdebug image of the same source and record that) | `STOPPED_AFTER_ERRORS`, sticky until the user turns it back on; shutdown and reboot are not counted |

Power runs:

1. Charge to 100%. Pair wireless debugging (`adb pair`, `adb connect`) and unplug USB. As an
   operator action, reset the counters: `adb -s S shell dumpsys batterystats --reset`. The
   script never does this.
2. Multi-hour run (`G6.multiHourRun`), for example 4 h:
   `--gates G6 --samples 9 --interval-min 30`.
3. 24-hour run (`G6.twentyFourHourRun`):
   `node scripts/owner/listener-evidence.mjs --serial S --user 0 --class device --gates G6 --samples 49 --interval-min 30 --label "24h listening" --attest … --out …/g6-24h.json`.
   Expected automated checks: `G6.unpluggedThroughout`, `G6.listeningThroughout`,
   `G6.thermalBelowSevere` (thermal status below 3), and `G6.twentyFourHourSpan` (at least 24 h).
   The file reports `drainPercentPerHour`, `maxSkinC` and the listener's batterystats lines.
4. Recommended baseline: the same 24 h with listening turned off, so the listener's cost is the
   difference. The owner sets the acceptance threshold (D-3); no threshold is documented today.

### Recording the result

For each passed gate, the reviewer copies the earned fields from the evidence files'
`candidateRecord.record` into `android/sense/qualified-listener.json`: `gates`,
`evidence.aospImage`, `evidence.deviceAcceptance`, and from G1 `evidence.apkBuild` and
`indicatorLease`. Commit the evidence files under `docs/evidence/listener-<date>/`. After G3,
`indicatorLease.qualified` may be set true. `qualified: true` needs every gate passed, a current
APK build, image and device evidence, and a compiled and qualified lease
(`listenerRecordProblems`). Then:

```sh
node --test test/owner-listener-evidence.test.mjs test/human-actions.test.mjs
npm run human:status        # H-20 done
```

`scripts/verify-apks.mjs` copies the record into each listener row. That is still APK-build
evidence, and a listener row is distributable only once the record says so.

## Decisions for the owner

### D-1 Require the `ops` and `assist` SystemUI bundles in production listener staging

- Options: (a) keep today's behaviour, where they are optional and admitted only with
  `--applied-systemui-patch`; (b) make production staging with `--listener-apk` refuse unless
  `ops` and `assist` are applied, and record them in `listener/evidence.json`.
- Default today: (a).
- Recommendation: (b), because G3 and G4 depend on them. The change belongs upstream in the
  shared `stageSenseListener` and in Alpha's `scripts/stage-aosp.mjs`, plus a doc fix for the two
  pages that say staging copies them.
- What changes: (b) makes a production image without them unstageable. (a) relies on the
  operator remembering both flags.

### D-2 Set privapp enforcement on the Pixel 10a product

- Options: (a) rely on the Pixel base product; (b) add
  `PRODUCT_PRODUCT_PROPERTIES += ro.control_privapp_permissions=enforce`, or the vendor
  equivalent, to the shared `listener.mk` or Alpha's product.
- Default: none. No Alpha or listener file sets it, and unset means disabled at the pinned
  framework.
- Recommendation: check on the first G1 boot. If it is not `enforce`, choose (b), since G1 cannot
  pass without enforcement.
- What changes: (b) makes boot fail if any privileged permission is outside the allowlist, which
  is the point of G1.

### D-3 Power and thermal acceptance threshold for G6

- Options: a maximum listener drain per hour above the listening-off baseline, and a maximum skin
  temperature or thermal status.
- Default: none documented. The script reports numbers only.
- Recommendation: set it before the 24-hour run, so the run is judged against a value fixed in
  advance.

### D-4 G7 dedicated SELinux domain

- Options: keep deferred (stock `priv_app`), or schedule `alpha_sense_app` after G1 and G2.
- Default: deferred (ADR 0001). This does not block H-20.

### D-5 Who reviews

A named reviewer and a device operator (H-20). There is no default.

## Draft decision entries

Only if the owner chooses the recommended options (number assigned at merge time):

> - **P-xx — listener staging (#664, #424):** Production image staging with the always-on listener requires the reviewed `ops` (HOTWORD microphone indicator op list) and `assist` (SystemUI identity on assistant launch) SystemUI bundles as well as the chip, and records all three in `listener/evidence.json` (owner, 2026-10-__). Without `ops` the G3 system indicator is not guaranteed for HOTWORD capture. Without `assist` the press-and-hold power gesture of G4 cannot start a voice turn.

> - **P-xx — privapp enforcement (#664):** The Alpha Pixel 10a image sets `ro.control_privapp_permissions=enforce` (owner, 2026-10-__). At the pinned framework an unset value disables enforcement, and G1 requires the privapp allowlist to be enforced.

> - **P-xx — G6 power budget (#664):** The always-on listener passes G6 when, over a 24-hour unplugged run on a Pixel 10a with listening on, the battery drain exceeds a listening-off baseline run by no more than `__ %/h`, and thermal status stays below SEVERE (owner, 2026-10-__).

## Remaining human steps

1. Owner: decide D-1 to D-5. The recommendations above unblock G1 to G4 without guesswork.
2. Image operator: G1 (steps 1 to 8) on the build host. No image with the staged listener and
   patched SystemUI has been built yet.
3. Device operator, with a Pixel 10a flashed with that image: G2 to G6 with the capture script
   and attestation files, including the 24-hour run.
4. Reviewer: copy the earned fields into `android/sense/qualified-listener.json`, commit the
   evidence, and confirm `npm run human:status` shows H-20 done. G7 stays optional.
