# Native Alpha lockscreen and shade entry

This is an additive source patch for `platform/frameworks/base` revision
`94b4c163b7dfe5ce3607f7bb8456f9573f7de57d` (Android 17). Its reviewed patch hash is
recorded in `manifest.json`. This package does not claim a completed SystemUI build,
image boot, or physical acceptance; those belong to separate build and device receipts.

The Alpha shortcut adds an entry in Android's existing lockscreen picker and is preset
at Start for an unset slot on a fresh device, with Camera preset at End.
It resolves the installed system Alpha assistant for the current user, rejects disabled
or suspended targets and user-switch transitions, and requests the existing unlock-gated
assist activity path. The defaults use Android's existing fallback: any stored slot choice,
including an explicit “None,” wins. This does not write or migrate saved selections or replace camera,
emergency, clock, notification-privacy, permissions, or account behavior.

The expanded shade gains a static, noninteractive Alpha wordmark in both Compose and
legacy paths. The decoration yields to privacy indicators and actual transformed clock
bounds, and disappears if it cannot fit the current text size. Compact, single-row
large-screen and collapsed headers retain their existing controls and layout. The header
is text-only in Android's serif family; the lockscreen affordance reuses the exact path
from `apps/app/public/logo-mark.svg`, with the existing native product tint. No new font
payload, activity indicator, microphone capture, Cloud request, or connection claim is added.

## Reproduce source preparation

Python 3, Git, an existing JDK 17 or newer, and an existing Android API 36 SDK are required.
Java is discovered through `JAVA_HOME`, macOS `java_home`, or PATH. The SDK is discovered
through `ANDROID_SDK_ROOT`, `ANDROID_HOME`, or standard home-directory SDK locations;
`ALPHA_ANDROID_API_JAR` can identify the existing API jar explicitly. No compiler or SDK
is downloaded by the tests.

Run from this directory:

```sh
python3 fetch.py
python3 prepare.py
python3 test_native_plan.py
```

`fetch.py` fetches only the official URLs in `SOURCE-INPUTS.json` and requires the exact
recorded SHA-256 for every file. Existing correct inputs are reused without network access.
`prepare.py` reproduces the candidate and requires its bytes to match the reviewed patch
hash. Generated source, assets, manifest copies and patch copies go under ignored `.cache/`;
none of the downloaded baseline or staged source needs to be committed.

To reuse an existing offline input directory:

```sh
python3 fetch.py --inputs-root /path/to/existing-inputs
python3 prepare.py --inputs-root /path/to/existing-inputs
ALPHA_SYSTEM_ENTRY_INPUTS=/path/to/existing-inputs python3 test_native_plan.py
```

The tests check exact patch application and staged hashes, unchanged selection/unlock and
camera sources, original header controls and constraints after removing the new node,
exact SVG path reuse, current-user admission and fit policies on the JVM, and the new Java
view against Android API 36 with SystemUI symbols stubbed. **These are not a Kotlin,
Dagger, or complete SystemUI compilation.**

## Apply after owner review

`apply.py /path/to/frameworks/base` performs read-only source admission. It requires the
exact Git revision, patch hash and affected-file preimages. Symlink targets, unreviewed
drift and partially applied states fail closed. Add `--apply` only after reviewing the
candidate and preparing the actual component-build checkout. Repeating an exact prior
application is identified without changing source.

Merge `product-overlay/values/alpha-system-entry.xml` into the existing unique
`AlphaSystemUIOverlay` resource directory. Both the Alpha entry bool and Android's existing
`custom_lockscreen_shortcuts_enabled` picker flag must be enabled: the pinned platform
defaults the latter to false. Their source defaults remain off outside the Alpha product.
Android's device-policy restriction still gates picker availability independently, and the
Alpha shortcut retains its current-user, installed-system-app and unlock checks. The same
overlay supplies `config_keyguardQuickAffordanceDefaults` as Alpha Start and Camera End.
Fresh customers therefore receive the presets without choosing them in Settings. A previously
unset slot also uses the standard fallback; any stored choice remains authoritative. Do not create a
second competing overlay, overwrite saved shortcut/tile preferences, or reset provisioning.
This patch does not auto-add the app's Quick Settings tile; its separately reviewed service
and notification changes keep their own packaging and device acceptance.

Before image delivery, compile full SystemUI and its overlay on the pinned Android tree,
including the Kotlin/Dagger/resource graph; read back packaged resources and enforced
idmap mappings while preserving factory overlays. Then verify locked/cancelled unlock and
strong-auth launch, picker choices and existing selections, multi-user/missing/disabled
Alpha, clock/alarm/emergency/secure camera, privacy indicators, gestures, compact/landscape,
RTL and 200% text. The decorative collision rule must be checked on the real expanded shade.
No deferred listening-indicator code is reused or presented as activity state.

## OS17 runtime correction and next image

OS17's factory image did **not** include the custom-shortcut picker flag override. The
device owner reported that its picker feature flag was false even though Alpha's separate
entry flag was true. During physical QA the owner enabled the single-bool fabricated
overlay `com.android.shell:AlphaLockscreenShortcuts`, targeting SystemUI's
`custom_lockscreen_shortcuts_enabled`, through the supported overlay manager. No
`ignore-overlayable` or exclusive overlay mode was used. This runtime overlay persists
under device data; it is separate from OS17's factory image.

The owner then reported that the correct provider URI
`lockscreen_quickaffordance/affordances` exposed **Open Alpha** as enabled, and explicitly
selected Alpha at Start and Camera at End in place of the disabled default Home Controls
row. That selection is physical QA state, not a default written by this source package.

To remove only that temporary feature override, the device owner can run:

```sh
adb -s <pixel-serial> shell cmd overlay disable --user current com.android.shell:AlphaLockscreenShortcuts
```

This does not delete stored shortcut choices. While OS17 still supplies the false factory
default, removing the override can make the picker unavailable again. This package now
enables the same existing bool and the Alpha/Camera unset-slot defaults through the normal
Alpha product overlay for the **next** image. OS17's runtime selections and fabricated bool
overlay do not establish that its factory image contains either correction. Verify the next
image's packaged values and provider flag before removing the temporary overlay
after an update. Do not describe that future default correction as already present in OS17.
