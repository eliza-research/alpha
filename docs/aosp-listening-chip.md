# Independent Listening chip: source candidate, required by staged listener images

Issue #424 and ADR 0001 require an indicator independent of listener self-report
and the normal AppOps privacy animation. This source candidate connects the
listener's existing Pause capability to a product-owned SystemUI recording-state
monitor and separate status-bar/keyguard views, and holds the listener's
[indicator health lease](#indicator-health-lease), so capture fails closed when
this indicator cannot be shown. It is **not qualified** and does not complete G3.
No SystemUI compilation, image build, boot or device test is recorded. The actual
pinned AOSP source is unchanged.

## Trust and data flow

`SenseListeningController` is a SystemUI `CoreStartable`, bound in the existing
privacy Dagger module. It registers an `AudioManager.AudioRecordingCallback` and
reads active recording configurations on startup. The pinned SystemUI already
requests `MODIFY_AUDIO_ROUTING`; no permission is added. Visibility comes from
an unsilenced platform recording configuration for the verified sense UID, not
from a notification, broadcast, service status, transcript or app-provided UID.

Before attribution, the monitor requires the foreground primary user, a normal
application UID in user 0, system/privileged installation, one current APK signer
matching the image-generated certificate resource, matching Alpha/sense signatures,
and an unambiguous single package for that UID. The generated resource comes only
from the listener signer already admitted by `stageListener`; its unconfigured
default is empty and admits nothing. Package changes trigger fresh checks. User
switching clears state and prevents admission until the current user is settled.
Unknown isolated or shared UIDs are refused; ADR 0001 has no isolated capture
process today. Adding one requires a reviewed platform ownership mapping.

The monitor receives metadata only. It never reads audio, transcript, model state,
or the listener's signature-protected control provider. Its only call into the
listener is the separate lease provider below, which accepts visibility facts. PCM capture and recognition
stay in their existing processes.

## Pause capability

`ListenerNotifications` marks only the existing Pause action with a versioned
action extra. Resume, Turn off and notification dismissal are never marked.
The existing token is an immutable broadcast PendingIntent to the non-exported
`ListenerActionReceiver`; the receiver and provider permissions are unchanged.

On a user tap, SystemUI rechecks capture and identity, reads its existing
NotificationListener's active notifications, and requires all of:

- The expected sense package, verified UID, active notification ID and channel.
- Exactly one matching marked action, from that same creator UID/package.
- An immutable broadcast token that does not request unlock.
- The exact Pause action and explicit listener receiver, with no data, ClipData
  or extras in the underlying Intent.

SystemUI sends the token without fill-in data. It does not invoke Resume or call
the control provider. Successful token delivery does not immediately hide the
chip: the platform must report that recording has stopped. A missing, ambiguous,
canceled or invalid token is refused and the view announces that Pause is
unavailable. No capture state or audio is transferred by this action.

## Surfaces and remaining blockers

The status-bar view is a sibling of ordinary status-bar contents, outside their
clock/notification disable flags. The keyguard view is a separate sibling of the
rotating indication area in `DefaultIndicationAreaSection`, so battery, biometric
and transient text do not replace its content. It follows the existing keyguard
indication burn-in X/Y flows. The fixed text is “Listening · Pause”; no transcript
appears on the lock screen. Strings are product-owned resources.

These are source hooks, **not proof of persistent visibility**. In particular:

- Immersive status-bar hiding, the selected keyguard blueprint/scene flags,
  notification shade/QS coverage, doze scheduling, AOD burn-in behavior and tap
  handling need image tests. Layout/cutout overlap and large-font behavior are
  unqualified. This candidate does not override emergency, camera or power gestures.
- Identity failure refuses attribution and Pause. Through the lease it now also
  stops a recording listener (see below), without granting a resume capability.
- Native SystemUI compilation and Android tests of recording callback ordering,
  package replacement, user switch, token selection, view disposal and the lease
  remain open.

## Indicator health lease

The listener requires a fresh lease from SystemUI to start capture and to keep
capturing. It fails closed: SystemUI death, a hidden, detached or faded Listening
surface, a chip SystemUI does not show while it observes the recording, a
recording SystemUI cannot attribute, an expired lease or an explicit revoke stop
capture, and capture does **not** resume by itself afterwards.

**SystemUI side** (`SenseListeningLease`, driven by `SenseListeningController`).
Every second (`LEASE_RENEW_MS`), and at once when a chip view is attached,
detached, re-rendered or changes window or aggregated visibility, SystemUI
measures its own views on the main thread and sends one acknowledgement on its
background executor:

- `surfaceVisible`: a chip view or its host (status bar or keyguard indication
  area) is attached, its window is visible, it is shown through every ancestor,
  aggregated-visible, at least 50% effective alpha along the ancestor chain and at
  least 90% inside its global visible rectangle (`SenseListeningPolicy.effectivelyVisible`).
- `chipVisible`: the rendered chip itself passes the same test, and is sent as
  true only while SystemUI itself observes the listener's unsilenced recording.
- `recordingObserved`: SystemUI's own `AudioRecordingCallback` attribution.
- `display`: the default display state from `DisplayManager` (`Display.STATE_ON`
  and `ON_SUSPEND` are `on`; `DOZE` and `DOZE_SUSPEND` are `doze`, i.e. AOD; `OFF` is
  `off`; `UNKNOWN`, `VR` and anything else are `unknown`).
- `hiddenReason`: why the indicator is not shown (below), or `none`.

Which views count depends on what SystemUI positively reports, not only on view
measurement (`SenseListeningPolicy.statusBarCounts`/`keyguardCounts` and the dedicated shade surface):

- **Lock screen and AOD.** The keyguard indication-area chip (created in code by
  `DefaultIndicationAreaSection`) counts while `KeyguardStateController.isShowing()`
  and the shade is collapsed. It is the surface on the lock screen and in doze;
  in AOD it is measured like any other view. The keyguard status bar
  (`KeyguardStatusBarView`) is not patched: that needs an exact preimage of
  another pinned file, and the indication-area chip already covers keyguard and AOD.
- **Unlocked status bar.** The status-bar chip (inflated from `status_bar.xml`)
  counts only while the keyguard is not showing, the shade is collapsed and no app
  has hidden the status bar. Immersive mode is read from
  `CommandQueue.Callbacks.onSystemBarAttributesChanged` (`requestedVisibleTypes`
  without `WindowInsets.Type.statusBars()` on the default display), with
  `showTransient`/`abortTransient` for a swipe reveal. A hidden status bar counts
  as not visible even though its views still measure visible.
- **Expanded shade and QS.** A dedicated, non-scrolling Listening/Pause chip is
  attached to the common `WindowRootView`, outside both notification rows and QS.
  Active notifications are Pause capabilities only; their existence is not visibility
  evidence. The chip uses system-bar/cutout insets and a minimum 48 dp touch target.
  Before drawing it is ordered above later Compose children, with matching maximum
  sibling elevation; reordering cancels that frame. Lease acknowledgement independently
  checks current ordering, attachment, window focus, root insets and measured visibility.
  Scene teardown removes the chip; the next attached frame restores it. Root attachment
  renews the pre-draw observer. No full-screen touch interceptor is installed.
  Keyguard, occlusion, bouncer, unlock transition, doze, dreaming and communal states
  suppress this shade surface. Existing keyguard/AOD surfaces retain their own contract.
  A missing, clipped or covered chip cannot be rescued by an active notification.
  These are source and host-test guarantees, not evidence of a compiled or booted
  SystemUI; actual QS, touch, rotation and security-window acceptance remains required.

Shade, doze, keyguard, display and system-bar callbacks trigger an immediate
acknowledgement.

It acknowledges nothing (and revokes) while the listener identity is unverified,
the foreground user is not user 0 or a user switch is in progress, and it sends
acknowledgements only to the lease provider resolved for the already admitted
listener UID and package. Acquiring passes a SystemUI-owned `Binder` token.

**Listener side** (`IndicatorLease`, `IndicatorLeaseProvider`, `ListeningService`).
The provider `ai.elizaresearch.alphaphone.sense.indicator` is exported only behind
the platform signature permission `STATUS_BAR_SERVICE`; `call()` re-checks that
permission, a user-0 caller UID that maps to exactly `com.android.systemui`, and
that this package is signed with the platform certificate. Alpha holds only
`LISTENER_CONTROL` and stays nonprivileged; it cannot reach this provider, and
the lease cannot be renewed through the existing control provider. The lease:

- is stamped with the listener's own monotonic clock, never SystemUI's;
- starts a new generation on each acquire, which is not fresh until SystemUI
  acknowledges a visible surface; an expired, revoked, replaced, dead or
  other-boot generation is never renewed again (SystemUI must acquire anew);
- expires 3 s (`TTL_MS`) after the last visible acknowledgement;
- ends at once when SystemUI's token binder dies (`linkToDeath`);
- after 2.5 s of unsilenced capture (`ATTRIBUTION_GRACE_MS`) also requires
  SystemUI to report that it observes the recording and shows the chip;
- carries visibility facts only. It returns only the generation and whether an
  acknowledgement was accepted; it carries no audio, transcript, consent, status
  or resume command, and it cannot start, resume or enable listening.

**Explained pauses and unexplained losses.** When the indicator is not shown,
SystemUI attaches `hiddenReason` (`SenseListeningPolicy.hiddenReason`), saying why
from what it positively knows. The reasons, in order:

| SystemUI report | Listener state | Status text |
| --- | --- | --- |
| Display fully off (`display_off`) | `PAUSED_DISPLAY_OFF` | "Paused — screen off without Always-on display" |
| Dozing, AOD not showing the chip (`aod`) | `PAUSED_DISPLAY_OFF` | same; the notification asks for Always-on display |
| Hidden within 1 s (`TRANSITION_DEBOUNCE_MS`) of a reported keyguard, doze, status-bar-state or display change (`transition`) | `PAUSED_TRANSITION` | "Paused while the screen changes" |
| Shade expanded without the measured indicator (`shade`) | `PAUSED_SHADE` | "Paused while the notification shade is open" |
| An app hid the unlocked status bar (`fullscreen`) | `PAUSED_FULLSCREEN` | "Paused while an app is fullscreen" |

Any explained pause releases the microphone (`AudioRecord` stopped and released;
no frame or utterance is analysed). It is not latched. Explained reports prove
SystemUI is alive and extend the lease. Capture resumes by itself only on a fresh
acknowledgement of a visible surface: the AOD or lock-screen chip, the status bar,
or the shade showing its measured dedicated chip. With AOD showing the chip,
listening simply continues with the screen off.

**Unexplained losses** latch `STOPPED_INDICATOR_LOST`, both while capturing and
during an explained pause. One exception: when the phone sleeps through a
display-off pause, SystemUI's renewals stop with its main thread, so the lease
lapses, and on wake SystemUI acquires a new generation that starts pending. With
the microphone already released by the pause, that lapse and the pending
re-acquire do not latch (`IndicatorLease.sleepLapse`). Capture still waits for a
fresh acknowledgement of a visible surface. SystemUI or binder death, a revoke,
or any lapse while the microphone is held still latches. The latch-worthy losses are:

- expiry with no report;
- SystemUI or binder death;
- an explicit revoke, which is what SystemUI sends when listener identity is
  unverified or during a user switch;
- an unattributed recording;
- a hidden surface or chip with no or an unknown reason, for example a detached
  chip or a hidden lock-screen chip more than 1 s after the transition;
- an unknown or missing display state while the listener itself sees the screen
  on. The listener tracks the screen through `ACTION_SCREEN_ON`/`OFF` and
  `PowerManager.isInteractive`. With the screen off, an unknown display state is a
  display-off pause.

A later explained or visible report does not turn such a loss into a pause. The
consent screen explains screen-off listening and links the Always-on display
setting (the AOSP lock-screen settings page, with display settings as fallback).

`ListenerPolicy` adds the four pause states above, `INDICATOR_UNAVAILABLE` and `STOPPED_INDICATOR_LOST`. Without a fresh lease every microphone-holding
state becomes `INDICATOR_UNAVAILABLE` (no capture; "Listening waits for the
system indicator"). Losing the lease while an `AudioRecord` is open latches
`STOPPED_INDICATOR_LOST`: capture stops and a returning lease does not restart
it. Only an explicit user Resume (notification Resume needs unlock; the listener
settings and tile also run after unlock), turn-on or new consent clears it. A
pause does not. While the microphone is held the service re-checks the lease no
later than its expiry and at least every second, and every audio frame and
utterance is dropped without a fresh lease. So capture stops within the TTL plus
one main-thread dispatch after SystemUI stops renewing or hangs, and immediately
(one binder call plus one main-thread dispatch) on a hidden-surface
acknowledgement, binder death or revoke. Lease loss is a clean stop (the open-
session marker is closed), so it never counts toward the crash-loop breaker, and
a tripped breaker, missing consent or before-first-unlock state are never
overridden by a fresh lease. The lease lives only in process memory, so it never
outlives a reboot or listener restart, which already require a fresh opt-in.

**Consequence.** A listener on an image without this chip patch never receives a
lease and never captures; it reports "Listening waits for the system indicator".
This is intended: the independent indicator is a precondition, not an extra.
Listener staging therefore includes the chip in every staged product, production
included (see below).

**Limits.** Measured: view attachment, window and aggregated visibility,
ancestor visibility, effective alpha, the global visible rectangle, keyguard
showing, shade expansion, status-bar state, doze, the default display state,
immersive status-bar requests and the time since the last such change. Not
measured: an arbitrary third-party window drawn above the status bar or keyguard,
partial shade drags short of `isExpanded()`, QS-only states and rotation/cutout
overlap. These look visible and keep capture running. A keyguard or screen
transition whose chip stays hidden for longer than the 1 s debounce becomes an
unexplained loss and stops listening until the user resumes. Whether real SystemUI
delivers these callbacks in time, the 1 s value, and the exact callback signatures
at the pinned revision are unverified until SystemUI compiles and runs on an image.
The lease also does not prove that a person can see the chip.

**Host checks only.** `test/aosp-listening-chip.test.mjs` type-checks the four
Java chip sources (`-Werror`) against hand-written Android/SystemUI stubs in
`test/fixtures/systemui-chip-jvm` (including hidden APIs SystemUI uses), runs the
SystemUI lease client against the listener's real `IndicatorLease` rules (renewal,
hidden chip/surface, hang, binder death, identity loss, provider substitution,
unavailable provider, display off/AOD, fullscreen and shade pause and resume) and the controller's
acknowledgement composition (`SystemUiAcknowledgementTest`: unlocked status bar,
immersive with transient reveal, expanded shade with and without its measured dedicated chip, lock-screen transition debounce, lock screen, AOD with and without
the chip, display off, unknown state, detached chip, and the reason each report
carries). It also checks that the exact patch creates the staged chip
sources byte for byte. These stubs mirror reviewed signatures; they are **not**
the pinned SystemUI tree, so Dagger wiring (the new `@Background Executor`
constructor argument), resources and the Kotlin binder are compiled only by a
real SystemUI build. `test/always-on-listener.test.mjs` runs the listener-side
lease and policy rules on the JVM and type-checks every listener source against
the Android 36 platform jar. None of this executes Android, SystemUI or an image.

## Exact source application

The chip bundle is separate from the microphone-op patch in
[SystemUI source preparation](aosp-listener-systemui.md). Both target the same
locked `frameworks/base` revision and touch disjoint files. Listener staging
(`stageListener`, used by `scripts/stage-aosp.mjs` in production and development)
copies both bundles, generates the exact certificate resource overlay in
`listener/systemui/chip/overlay`, appends an include of
`listener/listener.mk` to the staged `product.mk` **by default**, and
writes `listener/evidence.json`. That file records the
chip bundle (project, revision, patch hash) as a required SystemUI source patch,
with `sourcePatched: false` and `imageBuilt: false`. The overlay names a resource
that only the patched SystemUI defines, so the image's SystemUI must be built with
the chip patch. Staging never patches AOSP source. Only a development caller that
explicitly passes `systemuiChip: false` to `stageListener` omits it; the record
then says the listener will never capture. There is no command-line opt-out.

First verify/stage the original complete source as documented there. Then prepare
the chip overlay outside that source:

```sh
node scripts/aosp-listener-systemui.mjs --source /absolute/original-aosp --chip --output /absolute/new-chip-overlay
```

Copy its manifest-listed files only into the separate disposable build copy,
after checking that copy's preimages with `--source … --chip`. Verify the resulting
files with `--source … --chip --after`. Prepare/copy/verify the separate op-list
overlay as well. The staged product already includes
`vendor/alphaphone/listener/listener.mk`, which activates the generated
certificate overlay. Without it the empty resource refuses identity, the chip stays
inactive and the listener never captures. Never replace the complete baseline receipt with either derived
receipt. The chip receipt verifies only its nine listed files; all other files
in the build copy remain outside its verification scope. Newly added source files
must be absent in the original input; collisions and changed bytes are refused.
The ordinary full-source verifier still rejects this modified build tree. To check that
such a copy is otherwise the exact locked baseline, run `scripts/verify-pixel10a-source.mjs`
with `--applied-systemui-patch chip` (and `ops` when applied): only the bundle's listed files
may differ, each preimage at the pinned revision and each postimage must match its manifest,
and every other check is unchanged.

The manifest and derived receipts keep `fullTreeVerified`, `imageBuilt` and
`lockAodIndicatorQualified` false. `indicatorHealthLeaseImplemented` is true for
the chip bundle and means **source only**: the manifest's `indicatorHealthLease`
records `scope: "source"`, `systemUiCompiled: false` and `qualified: false`, and
derived receipts add `indicatorHealthLeaseQualified: false` and
`systemUiCompiled: false`. The listener's own record,
`android/sense/qualified-listener.json`, keeps the listener not device-qualified.
Production and device acceptance gates remain unchanged.

Host validation runs the actual staged pure policy on the JVM against wrong user,
isolated/shared UID, signer substitution, silenced/wrong-UID capture, forged action
ownership, mutable/non-broadcast tokens and Resume markers. The producer's marker
contract is checked against the consumer. With `ALPHA_SYSTEMUI_TEST_SOURCE` set to
the pinned AOSP root, the host test applies the exact patch to copies and checks
postimage hashes, collisions and mutation rejection. None of these tests executes
Android SystemUI or demonstrates a visible indicator.
