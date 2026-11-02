# Android and AOSP build contract

> Policy update 2026-10-12: [owner-approved TODOs](owner-approved-mvp-plan-2026-10-12.md)
> and [active implementation plan](implementation-plan.md) supersede conflicting
> requirements below. Local agent only; all speech on-device; subscription services;
> Pixel 10a Android 17; Phone/Contacts/SMS and always-on listening in AOSP MVP only;
> no Wallet or app-data import/export. Historical implementation evidence is unchanged.


## Artifact identities

Package: `ai.elizaresearch.alphaphone`. Version source: `app.config.json`, overridden by
`ELIZAOS_VERSION_CODE` (positive integer) and `ELIZAOS_VERSION_NAME` when set. AOSP module: `AlphaPhone`.
Standalone and launcher variants share data and signing identity within this product.
Use `adb install -r` to replace them. Do not uninstall a real user's app to switch variants.

`npm run android:build` builds debug-signed debug artifacts and release artifacts for both
flavors, Android instrumentation APKs and Android lint, all with
`ELIZA_DEV_ALLOW_TEST_MOCKS` off. Release APKs are signed only when all four `ELIZAOS_*`
signing values below are present; otherwise they are `*-release-unsigned.apk`.
`android:verify` (`scripts/verify-apks.mjs`) inspects compiled package IDs, HOME/LAUNCHER
filters, debug flags and signatures, the absence of test-mock classes, cleartext network
configuration and fixture-package queries, and runs `scripts/audit-production-bundle.mjs`
on each APK's extracted `assets/public`. These checks inspect APK bytes, not source
strings alone.

Gradle's `stageLocalAgentSources` step reads the prepared resident runtime source in
`artifacts/local-agent-resident-<commit>`, and release verification requires the staged
runtime payload (without it `scripts/verify-packaged-runtime.py` exits 3). On a clean
checkout `npm run android:build:local` runs the whole chain: an input check,
`agent:build-embedding-host`, `agent:prepare`, `agent:build-workflow-worker`,
`agent:stage-android`, `licenses:packaged-runtime` and `android:build`. It stops at the second
step until a person supplies the reviewed embedding host libraries; `npm run
android:build:inputs` lists every input and who supplies it (see the README). On-device speech
uses only the libelizainference voice host ([fused speech](fused-speech.md), decision P-42); an
APK without a voice bundle is valid. `npm run android:build` checks all of
these first (`scripts/android-build-preflight.mjs`) and exits 2 with the command to run instead
of failing inside Gradle. `npm run android:build -- --allow-unpackaged-runtime` is the developer
path: it needs only `agent:prepare` and records release APKs without the payload as
`distributable: false`.

`npm run android:build -- --test-mocks` passes `-PELIZA_DEV_ALLOW_TEST_MOCKS=1` and writes
only to `artifacts/test-mocks/`. It attaches `android/app/src/testMocks` (DevelopmentAgent
and voice plugins, synthetic autofill service, loopback cleartext config, fixture-package
permission and queries) to debug variants and sets `BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS`;
`DailyApps.surfaceInfo().developmentBuild` reports that field. Release variants never
receive the source set. Without `--test-mocks` the build script removes both
`ELIZA_DEV_ALLOW_TEST_MOCKS` and `VITE_ELIZA_DEV_ALLOW_TEST_MOCKS` from its child
environment. Test-mocks APKs are never distribution or acceptance artifacts.
Instrumentation cases that need a loopback HTTP fixture server or the DevelopmentAgent
plugin assume `BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS`: flag-off distribution debug
APKs skip them. The CI job that ran them on test-mocks APKs was removed on October 8 with
the other smoke suites, so they now run only in a direct instrumentation run of a
test-mocks build on an owned disposable emulator.

Release variants are minified and resource-shrunk with R8 using
`android/app/proguard-rules.pro`, which keeps Capacitor plugin reflection targets,
upstream native plugins and manifest-instantiated components. Retain each release's
`android/app/build/outputs/mapping/<variant>Release/mapping.txt` with the distributed APK
to symbolicate crashes. An R8 build passing APK verification is not installed-release
behavior evidence: exercise the signed release on an emulator and a device as separate
gates.

## Preparing a development APK for AOSP

Normal APK builds retain `useLegacyPackaging=true`: Android extracts the Bun
executable into the native library directory. Presigned AOSP imports additionally
require stored, page-aligned JNI entries. Do not turn off extraction or disable the
AOSP checks to accommodate a compressed APK.

After the normal packaged-runtime build and APK verification have passed, build an
unsigned **debug** launcher with the same runtime profile, version overrides and
web assets. The init script changes only debug signing. The Gradle wrapper and build
files are generated from `android/consumer-host.json` (`npm run android:host`; the
packaged-runtime build has already done this). For an explicit Cloud QA
build, run from the repository root:

```sh
./android/gradlew -p android --no-daemon \
  -I "$PWD/scripts/aosp-unsigned-debug.init.gradle" \
  -PELIZA_RUNTIME_PROFILE=cloud -PELIZA_DEV_ALLOW_TEST_MOCKS=0 \
  :app:assembleLauncherDebug
python3 scripts/prepare-aosp-apk.py \
  --input android/app/build/outputs/apk/launcher/debug/app-launcher-debug-unsigned.apk \
  --output artifacts/aosp-debug-prepared \
  --zipalign "$ANDROID_HOME/build-tools/36.0.0/zipalign"
```

Use a fresh output directory. The preparer rejects signed inputs, stores JNI and DEX
entries, runs the SDK's 16 KiB alignment and verification, and compares every entry's
payload hash, including the manifest, against the unsigned input. Its receipt records
unsigned bytes and does not establish deployment readiness. Sign the resulting
`launcher-aosp-unsigned.apk` with the existing development application key outside
this script; preserve that key and versionCode for device updates. Verify the signed
APK with `apksigner verify --print-certs` and `zipalign -c -P 16 4`, then use the normal
`aosp:stage --development` path with the resulting debuggable APK. Preserve the
original build manifest and preparation receipt; preparation does not relabel a
release, edit its blockers, or claim release/runtime/device acceptance.

For the native profile, retain its normal qualified runtime inputs and omit the Cloud
property. Release preparation still requires the separate production signing and
release-admission workflow below; signing a release with a debug key does not make
it eligible for development staging.

## Signing

Development uses the Android debug keystore outside the repository. Release signing uses
the upstream names `ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`,
`ELIZAOS_KEY_ALIAS` and `ELIZAOS_KEY_PASSWORD`, supplied by the signing service or CI
secret store. Gradle signs only when all four are set (a partial set is reported by name
and produces unsigned APKs); values are never printed. Alternatively, a release owner
may zipalign/sign the unsigned release APK with the controlled application key. Either
way, verify with `apksigner` and supply an independently reviewed descriptor. Keep keys
in the signing service/CI secret store. No production signing material is created
by setup. Pin app certificate and versionCode across APK and OS releases.

```json
{
  "schemaVersion": 1,
  "brand": "alphaphone",
  "moduleName": "AlphaPhone",
  "packageName": "ai.elizaresearch.alphaphone",
  "apkSha256": "64 lowercase hex characters from the signed APK",
  "certificateSha256": "64 lowercase hex characters from the approved signer"
}
```

```sh
npm run aosp:stage -- --apk /absolute/signed-launcher.apk \
  --descriptor /absolute/reviewed-launcher.json --aosp-source /absolute/reviewed-aosp \
  --output /absolute/new-overlay
```

The upstream helper rejects a package/hash/signer mismatch, absent HOME filter,
existing output directory and debug APK without the explicit development flag.
Unsigned release APKs cannot pass signature verification. It inspects a private copy
of the same bytes it stages and writes a presigned/preprocessed nonprivileged Soong
`android_app_import` plus a `PRODUCT_PACKAGES` fragment. No local-agent marker or
privileged permission whitelist is fabricated for a thin launcher.

## App Links

**Build configuration.** `android/app/product.gradle` defaults to the configured production web
host and overlays verified filters on that host for
`/alphaphone/cloud-delegation` (prefix), `/alphaphone/auth/callback` (exact path, the in-app
Eliza Cloud sign-in return) and `/alphaphone/gmail/callback` (exact path, the Google Workspace
consent return). Steward returns sign-in only to `eliza.app`, so the sign-in return
works with the default configuration. `ELIZAOS_APP_LINK_HOST`, if set, must match it. Test-mocks builds always add
`https://staging.eliza.app/alphaphone/auth/callback` from `src/testMocks/AndroidManifest.xml`.
The release fingerprint must be listed at `/.well-known/assetlinks.json` on the host before a
release build can receive the return (never a debug or placeholder fingerprint). On `eliza.app` Cloud
serves that file from `ELIZA_ANDROID_ASSET_LINKS_JSON`: `node scripts/render-assetlinks.mjs --cloud-config`
prints the value with Alpha's entry, and `--check <url>` verifies the published file
([human actions](human-actions.md) H-13). For a host Alpha controls, publish the file the default
mode renders.

**In-app Eliza Cloud sign-in return.** Steward returns Google sign-in to the callback with a
one-time code in the fragment. AlphaCloudSignInPlugin validates it under the shared callback
contract and exchanges the code natively (docs/architecture.md, "Eliza Cloud sign-in ownership").
Alpha offers its in-app sign-in only after its readiness probe sees the client registration, the
redirect allowlist, `assetlinks.json` listing this package and its signing certificate, and (for
Google) Android reporting the return host verified for Alpha. Email code sign-in stays in Alpha
while readiness is unavailable; product builds have no browser sign-in hand-off (it is a test-mocks
diagnostic only). If the link is not handed to Alpha, Cloud's fallback page brings Alpha
forward without parameters and Alpha asks the owner to start again; no code is forwarded.

Check verification with `adb shell pm get-app-links ai.elizaresearch.alphaphone` on an installed
signed build ([runbook](pilot-acceptance-runbook.md#external-integration-runbooks)).

An APK build, an emulator verification, the AOSP image and the owner's device acceptance are
separate evidence levels; none of them proves another.

**AOSP image requirements for sign-in:**

- Include `com.android.statementservice` (the App Link verifier, IntentFilterVerifier). Without it
  `autoVerify` never succeeds, the readiness probe reports Google unavailable, and only email
  in-app sign-in (or the hand-off) is offered.
- Include a browser that provides Custom Tabs (the Alpha Chromium, which answers
  `android.support.customtabs.action.CustomTabsService`). Without one, Alpha falls back to a plain
  `ACTION_VIEW` browser.
- Neither component needs GMS.

**Cloud delegation return.** The `alphaphone://cloud-delegation` custom scheme remains the active
delegation return path; the https delegation filter exists only in builds with
`ELIZAOS_APP_LINK_HOST`, and moving the renderer to it is a separate reviewed change.

## Full AOSP product integration

The selected validation target is Cuttlefish; the hardware target is **Pixel 10a
(stallion) on Android 17**, product `alpha_stallion_phone`. Other Pixels are not promised
hardware. Keep their source locks and evidence separate. A Cuttlefish pass does not establish
Pixel radio/hardware or verified-boot/rollback behavior. Do not publish a Pixel 10a installer
before its production inputs are admitted and a release-signed image passes the device,
update and recovery gates below.

1. Allocate a Linux x86_64 AOSP builder with the storage/RAM required by the selected
   pinned source tree. macOS SDK builds are sufficient for APKs, not this image lane.
2. Select exact hardware/SKU, Android branch, kernel/vendor inputs and compatible
   WebView/browser. Validate upstream source locks; do not infer support from a mockup.
3. Build/sign this product's launcher; admit it with the descriptor above. Copy the
   generated directory to `vendor/alphaphone` in a clean AOSP checkout.
4. In the selected product makefile add:
   `$(call inherit-product, vendor/alphaphone/product.mk)`.
   Use the existing `packages/os/android` source locks, environment and build tooling
   for the base image. Do not claim the custom launcher satisfies the existing full
   Eliza local-inference payload validator.
5. The add-on keeps other launchers intact. Choose this app as default HOME through
   explicit device provisioning. In disposable userdebug validation,
   `adb shell cmd package set-home-activity ai.elizaresearch.alphaphone/.MainActivity` demonstrates
   selection; production must use the enrolled-device/default-role policy.
6. Build the actual product with `source build/envsetup.sh`, its pinned `lunch` target
   and `m`. No generic lunch command can substitute for an approved hardware target.
7. Boot the exact image in Cuttlefish, verify package path under `/product`, signer,
   HOME resolution after reboot, screen/IME/native bridge behavior and absence of crashes.
8. Validate the same signed release on physical hardware: radios, audio/mic, touch,
   camera, suspend/resume, charging, keys, auth/agent reconnect, accessibility and
   recovery. Record image/APK/source hashes. Image signing, the OTA package and its
   version/hash compatibility record come from `scripts/sign-aosp-release.mjs` on the image
   host ([Pixel 10a staging and release signing](pixel10a-staging.md)); the one update channel
   is `android/aosp/pixel10a-ota-channel.json`. The operator update client, interrupted-update
   resume, slot fallback and stock-recovery checks are `scripts/aosp-ota-update.mjs`, and
   `scripts/verify-pixel10a-image.mjs` checks a booted image; all are bindings of shared
   Pixel 10a tooling. `scripts/aosp-retain-known-good.mjs` (the shared `retain-known-good`
   command) archives and hash-records a verified signed image and its target-files, refusing
   placeholders, test-keys builds and inputs that differ from the release record;
   `aosp-ota-update.mjs stock-archive --known-good DIR` re-verifies that archive and offers
   its reflash plan beside the stock plan. The shared read-only update-channel client
   (`packages/os/scripts/android/update-channel-client.mjs`) is registered off in Alpha
   (`updateChannelCheckEnabled`); only a development build shows its state in About. No
   release key, signed image, applied OTA, interrupted-update, rollback, known-good or
   stock-recovery drill exists yet, and `scripts/pilot-update.mjs` (shared signer-equal,
   higher-versionCode and per-domain readback checks) still refuses a lower APK versionCode.

An SDK emulator with an installed launcher is useful HOME/app evidence, but is not
proof that this product makefile built or booted in a custom AOSP image.

## Cuttlefish and Pixel 10a handoff

Track image work in [Alpha #377](https://github.com/AlphaCompute/alphaphone/issues/377)
and app acceptance in [Alpha #378](https://github.com/AlphaCompute/alphaphone/issues/378).
The image build and Cuttlefish run will be completed on the separate Linux builder.

On that builder, check out the reviewed Alpha commit and its exact `vendor/eliza`
pin, install the pinned Node/JDK/Android toolchain, then run the speech preparation
and `npm run android:build:local` commands above. Preserve the four APKs, instrumentation
APKs, lint results, runtime provenance and `artifacts/apk-manifest.json`. Current speech
functional acceptance is a separate gate; do not bypass APK admission to stage a release.

Use `npm run aosp:stage` with the admitted launcher, reviewed signer descriptor and
explicit `--aosp-source` path to the reviewed source checkout.
Inherit the generated Alpha product fragment in the pinned Cuttlefish product, build
the image and use its matching Cuttlefish host package. Verify boot, `/product` package
placement, signer, HOME routing, resident startup, authenticated inference, native
approvals, saved history and lifecycle recovery. Preserve build IDs, hashes and logs.
The [Cuttlefish host instructions](https://source.android.com/docs/devices/cuttlefish/get-started)
require KVM and a host package matching the image build.

The approved physical target is **Pixel 10a (stallion), Android 17**. The
[Pixel 10a source contract](pixel10a-source-contract.md) records the exact AOSP manifest,
device-tool revisions, factory archive, kernel and generated vendor inputs of the inspected
development baseline. Licensed binaries stay outside Git. The owner has built a development
AOSP image for stallion from these inputs. The [October 19 code6 evidence](pixel10a-code6-boot-evidence.md)
records a verified Cloud-profile image and initial physical boot at the exact e240 Alpha
commit and 0296 Eliza pin; it does not qualify a production release or device integrations. The former
all-UNSET Pixel 10 placeholder lock is retired. Production staging uses
`android/aosp/pixel10a-product.json` and refuses while its release inputs are unset
([Pixel 10a staging](pixel10a-staging.md)). Cuttlefish boot, source-input verification, a
development image boot, physical device functions, release signing, signed update/recovery
drills and user acceptance are separate gates; none of them proves another.

## Distribution boundaries

HOME is not device owner, accessibility service, overlay permission, SMS/dialer or
assistant role. Do not add a broad `privapp-permissions` list to make a test pass.
A persistent cross-app helper and secure Chromium component require their explicit
native/OS integration and signer-admission work in the implementation plan. Managed
kiosk is not enabled by default; preserve a recovery route and normal Android settings.

## One live MainActivity on the launcher flavor

`MainActivity` is `singleTask` and, on the launcher flavor, also answers `ACTION_MAIN` /
`CATEGORY_HOME`. Android keeps the two kinds of start apart. A HOME start (the HOME key, the
start Android makes when the role is granted, boot) has `ACTION_MAIN` with HOME as its only
category, no data and no type, and either names no component or is made by the system itself;
Android gives the activity the home activity type in the display's home task. Every other
start (the app icon, a notification tap, the `alphaphone://cloud-delegation` sign-in return, an
explicit component from another app) has the standard type. A task's activity type never
changes, and the task lookup that makes `singleTask` reuse an instance only matches a task of a
compatible type. So a HOME start cannot reuse a standard-type instance and the reverse, and
Android creates a second `MainActivity`. Round 7 measured this on the API 36 emulator when the
HOME role was accepted.

Two instances mean two pages over one store, with the draft, the open conversation and pending
approvals in whichever page is hidden. The product keeps the first live instance, whichever
kind it is (`MainActivity`, "One live MainActivity"):

- A second instance creates no Capacitor bridge and loads no page. It delivers its intent to
  the live instance through `onNewIntent`, the path Android itself uses for a reused
  `singleTask` activity, so a HOME start shows Alpha Home and a notice tap or sign-in return
  reaches the plugins that handle it.
- It then brings the live instance's task to the front and finishes. A standard live task is
  one of the app's own tasks and is moved by its id (`ActivityManager.AppTask.moveToFront`, no
  permission). A home-type live instance is reached with the implicit HOME intent restricted to
  this package. An explicit-component start is kept only as the fallback for a standard task
  Android does not list among the app's tasks; it is not the way to raise one. Measured on the
  API 36 emulator in round 8: made by the instance Android had just created in the home task,
  that start was matched to the home task itself and came back to the instance that asked, the
  live task stayed behind, the home-type instance finished and the stock launcher was in front
  (`SettingsRoles` and `LauncherHome` both failed on it; logcat "Front start returned to the
  handed-off instance"). A standard task created for the start is removed; Android's home task
  is left alone.
- If a front start ever created another instance instead of reaching the live one, that
  instance finishes without starting anything, and the process stops handing starts off. The
  same happens when the front start cannot be made, or when the live instance does not come
  forward (resume, or receive the front start) three hand-offs in a row. With the live instance
  not coming forward, the instance in the home task would finish and
  leave it empty, Android would start HOME again and the hand-off would repeat without end.
  From then on a new start keeps its own instance: two instances, which is what round 7
  measured and is stable. logcat tag `AlphaInstance` says "Front start created an instance" or
  "Front start is not reaching the live instance" when this happens; neither is expected and
  either should be reported if seen.
- Which kind the live instance is belongs to its task and is read from the start intent once,
  for the first instance in that task. Android hands a relaunched activity (renderer recovery,
  a system font-size change; `fontScale` is not in `configChanges`) the last intent given to
  `setIntent`, and `AlphaConnectionPlugin` keeps the Cloud sign-in return there
  (`CloudDelegationCallbackInstrumentedTest` relies on exactly that). Reading the kind again
  after a relaunch would call a home-type instance standard; the front start would then come
  back to the instance that asked, and a later notice tap or sign-in return would be delivered
  without Alpha coming to the front. The round-8 review found this in the first version of the
  hand-off and changed it to keep the kind per task id.
- `MainActivity` is exported, so the marker extra of the front start is read inside a
  `try`/`catch`: an intent whose extras do not unparcel in this process is treated as not ours.
  The instance that hands off never removes a task it shares with the live instance.

What follows from keeping the first instance:

- When the role is granted to an Alpha that is already running, the running standard-type
  instance stays the page owner until its task or the process ends. During that time each HOME
  press creates and immediately finishes a home-type instance; the next cold start (after a
  reboot, or after the task is removed) is a home-type instance from the beginning. On an
  image where Alpha is HOME from boot this transitional state does not arise.
- The standalone flavor has no HOME filter and is unchanged: `singleTask` already guarantees
  one instance there.

Evidence: `SettingsRolesInstrumentedTest` (one resumed instance, the same object and page with
its unsent draft, and one `MainActivity` record in `dumpsys activity activities`, after the
role is accepted, after three HOME presses and after an explicit start) and
`LauncherHomeInstrumentedTest` (one resumed instance after every HOME return; and
`aRelaunchHoldingAReplacedIntentKeepsOneInstanceThatLaterStartsBringToTheFront`: after a
relaunch that holds an intent of the other kind, the kind is unchanged and an explicit start
and the HOME key each bring the one instance to the front over Android Settings). Both were
compiled when this was written and then run once on an API 36 emulator with developer APKs
([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9),
class E). SettingsRoles first passed in 2 of 7 runs; the cause was in the test (a HOME key
injected before the page owner's window had input focus again starts nothing, and the
navigation helper's pending step reopened Settings after a HOME start), not in the hand-off.
With both awaited and every press required to reach the page as a HOME start, SettingsRoles
passed in 8 of 8 runs and both classes in 3 of 3 on the final APKs. LauncherHome crashed the
process once in 25 runs, through a problem-log call that arrived after its worker had
stopped; that call is now rejected. `test/gesture-zones-single-instance.test.mjs` holds the
source shape (class S); it shows nothing about Android's behaviour. The second instance is what round 7 observed; the
explanation by activity type is how AOSP assigns the home type to a HOME start and matches
tasks for `singleTask`, which is platform implementation, not a public API contract, and was
not re-measured here. The hand-off itself therefore has an emulator result on one API 36 image
and no device result. Whether the short-lived
HOME instance is visible as a flicker during the transitional state is a device observation.

## Required Clock provider

The Alpha overlay explicitly includes AOSP `DeskClock` alongside its launcher. Keep this module in the selected product even when generic upstream de-bloating changes. A missing Clock handler is not successful MVP alarm acceptance. Both standalone and launcher APKs use the installed provider and expose honest unavailable results; neither bundles Clock inside its APK or owns exact-alarm delivery.

After booting the exact signed image, perform read-only handler admission for the intended Android user:

```sh
ANDROID_SERIAL=<exact-serial> ALPHA_ANDROID_USER=<user-id> \
  ALPHA_EXPECTED_IMAGE_FINGERPRINT=<exact-fingerprint> node scripts/verify-aosp-clock.mjs
```

The check requires the exact expected build fingerprint, enabled system-installed `com.android.deskclock`, and its set/show/snooze/dismiss activity handlers. It does not launch an alarm, change permissions, provision a device, or prove ringing. Alpha's shared manifest declares the caller SET_ALARM permission and visibility queries; Clock's own notifications/exact-alarm access remains separately verified on the image. Confirm actual set/fire/snooze/dismiss, permission denial, reboot, time-zone/DST, cancellation and DND/physical audio before claiming alarm MVP completion.

DeskClock is the real AOSP module defined in `packages/apps/DeskClock/Android.bp` and included by the standard handheld product. Pin its source through the selected image manifest; do not substitute an unreviewed downloaded APK.

## Read-only Cuttlefish launcher verification

After booting a development image, bind the observation to its independently retained
staging descriptor and expected build fingerprint:

```sh
node scripts/verify-cuttlefish-launcher.mjs --serial 127.0.0.1:6520 --user 0 \
  --descriptor /absolute/staged-overlay/launcher.json \
  --fingerprint 'exact expected build fingerprint' \
  --apk-path /product/app/AlphaPhone/AlphaPhone.apk --out /absolute/new-report.json
```

This makes no device changes. It requires a booted Cuttlefish image, the selected
foreground user in Android’s `RUNNING_UNLOCKED` lifecycle state, enforcing SELinux, exact system APK bytes, Alpha HOME,
an enabled system recovery HOME, DeskClock handlers and a current WebView provider.
A data-installed override, wrong image or APK, missing recovery launcher, or a reboot
or replacement during observation fails. HOME, SELinux and user running state are checked again before reporting success. These are sequential observations, not an atomic device snapshot; `RUNNING_UNLOCKED` does not prove the keyguard is dismissed. Keep the descriptor from staging rather
than creating the expected hash from whatever happens to be installed. The reported
certificate is inherited from that descriptor via identical APK bytes, not a fresh
signature check. The output file must be new; failures are retained too.

This checks installed image configuration only. It does not qualify resident-agent
execution, live accounts, alarm ringing, browser security/provider freshness,
physical hardware, production signing or update/rollback. A pass on an older image
cannot qualify a newer app revision.

## AOSP product capability admission

The approved Phone/Contacts/SMS scope (#420) is restricted to the Alpha AOSP
image. A launcher APK or HOME role does not establish that capability. Native
admission requires all of: launcher distribution, a non-debug build with test
mocks off, Android's system-installed package flag, and the production image
resource marker. A standalone APK fails even if installed as an update on the
image. Every call reads the marker again; missing resources fail closed.

`aosp:stage --production` emits `AlphaImageCapabilityOverlay`, a product-partition
runtime resource overlay targeting `AlphaImageProvisioning`. The APK's marker
is false by default and is overlayable only from system/product partitions.
A runtime overlay is needed because the launcher APK is presigned/preprocessed;
an ordinary source resource overlay cannot modify that prebuilt APK. Existing
release, signing and reviewed descriptor gates apply before staging. Development
staging never emits this capability overlay. The overlay generator and the
default-resource check are the shared `image-capability.mjs` in
`packages/os/scripts/android`; Alpha supplies only its installed identifiers
(`scripts/aosp-capability-overlay.mjs`). For Pixel 10a the shared composition
writes it from `launcher.imageProvisioning` in `products/pixel10a-alpha.json`.

The capability is an OS-provisioning boundary, not remote image attestation or
proof that an image was built and booted. A privileged image builder can control
its system/product partitions. A real image must separately verify installation,
RRO activation, signing and the expected build fingerprint.

Telecom and SMS adapters remain unavailable on all images. Alpha's shared System bridge hides and refuses dialer/SMS roles;
its role callback rechecks the product policy. Product-owned empty-dial-pad
shortcuts and both native default-app bridge entry points require image
admission. The ordinary installed-app drawer and Android's own emergency access
are preserved. Agent view/workflow and native DailyApps routes continue to deny
Phone/SMS. Contacts navigation is admitted only by the native image capability;
READ_CONTACTS is requested explicitly inside that admitted view. No phone permission is
declared. The launcher flavor alone declares `READ_SMS` and `SEND_SMS` for the image-only SMS/MMS
reads and reviewed sends described in [architecture](architecture.md#smsmms-on-the-image-421);
the standalone flavor removes them and no flavor declares `RECEIVE_SMS`, `RECEIVE_MMS` or `CALL_PHONE`.

The shared extension is an explicit hash-admitted patch in
`patches/eliza/system-product-capabilities.patch`; default hooks preserve
upstream behavior for other products. Kotlin targets receive the same source,
patch, output and packaged-receipt verification as Java targets. The vendor
checkout remains pristine. `ImageCapabilitiesInstrumentedTest` exercises
ordinary-APK denials without performing a call, message or role selection.
Positive image admission and real Contacts/Telecom/SMS behavior remain open in
#420, including roles, owned endpoints, carrier identity and unknown-send recovery.

Contacts adapter work adds same-profile, permission-gated bounded provider reads only
inside the admitted image. Contact rows remain in renderer memory. Creation and editing
use a pinned system Contacts editor with account selection and save handled by Android;
Alpha has no WRITE_CONTACTS permission or import/export path. Native selection checks bind
provider ID, lookup key and last-update revision before edit handoff. Phone and SMS views
remain disabled; the native SMS contract exists only behind the image capability. The ContactsCatalog instrumentation class creates and cleans only its
own synthetic contacts in a disposable profile; this provider test is not image admission,
real address-book acceptance, or a Telecom/SMS result.
## System secure camera

The approved lockscreen camera is AOSP Camera2, reached through the standard
SystemUI double-press-power gesture. Alpha does not own a lockscreen camera
activity. Staging adds `Camera2` and resource overlays selecting
`com.android.camera2` and enabling the framework gesture. User settings can
still disable the gesture.

All non-development staging requires `--aosp-source PATH` in addition to the
existing distributable APK and reviewed descriptor gates. The source verifier
checks the exact module revisions and selected file hashes in
the shared contract
`vendor/eliza/packages/os/android/sources/secure-camera.json` (checked by
`packages/os/scripts/android/secure-camera.mjs`; Alpha binds only its package), and rejects dirty, untracked or ignored module
inputs and index flags that can hide tracked edits. Linked module roots in repo shadow workspaces are supported; files
must remain inside each resolved module. Source revisions and byte checks are
recorded in the staged `secure-camera/source-evidence.json`. Development
staging without a source path records `sourceVerified: false` explicitly.

```sh
node scripts/verify-aosp-secure-camera.mjs --aosp-source /path/to/aosp
# On a separately authorized booted target, read-only checks:
ANDROID_SERIAL=explicit-serial ALPHA_ANDROID_USER=10 \
  ALPHA_EXPECTED_FINGERPRINT='exact/reviewed/image/fingerprint' \
  node scripts/verify-aosp-secure-camera.mjs
```

The image check requires enabled system Camera2, both secure intent handlers,
the effective framework/SystemUI gesture resources, a camera feature and an
enabled gesture for the selected user. It launches nothing and changes no
permissions, settings or files. A caller-supplied fingerprint binds the check
to a target; it does not authenticate that target's build inputs.

The pinned local AOSP source is evidence for the source contract only. Neither
that check nor staging proves that an image consumed the overlay. The local
Cuttlefish baseline is not approved Pixel 10a Android 17 device acceptance.
Locked capture, absence of pre-unlock gallery/account access, return after
unlock, permission denial and physical gesture behavior require separate
image/device tests. These remain open acceptance work for issue #407.


## Building on a memory-constrained host

The recorded `android/aosp/build-host/soong-memory.patch` forwards only `GOGC`
and `GOMEMLIMIT` into Soong's otherwise empty bootstrap environment. It changes
host graph generation, not device code, and leaves default behavior unchanged
when those variables are unset. Apply it only to the exact `build/soong` revision
in its manifest. Source verification and staging must then include
`--applied-build-patch soong-memory` alongside any applied SystemUI patch.
The patch is bound to the existing Pixel source lock by its before/after hashes;
unrecorded source changes are still refused.

For this host, the image campaign uses `GOMEMLIMIT=18GiB GOGC=50`, two build jobs,
and a separate systemd user service with a 22-GiB RAM and 32-GiB swap limit.
These settings are build-host controls, not device qualification. The first
unbounded-heap attempt was killed by systemd-oomd during graph generation; its
logs remain in the campaign artifacts and do not count as a completed image.

## Soong-only image packaging

Cuttlefish's Android 17 product ignores all legacy `Android.mk` modules. Image
staging therefore emits an `android_app_import` plus required `prebuilt_app_native`
modules. The recorded `vendor/eliza/packages/os/android/patches/soong-app-native/soong-app-native.patch` adds that
module type to install the admitted ABI payloads under
`/product/app/AlphaPhone/lib/<arch>`; `config.fs` preserves executable modes for
the runtime and loader. APK bytes remain unchanged. Apply this exact patch and
include `--applied-build-patch soong-app-native` for either image target. Staging
refuses to proceed without that explicit source admission. ELF-copy checks are
not disabled. Verify the built APK and each native payload against the staging
hashes before treating a successful image build as a candidate.
