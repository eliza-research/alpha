# Native app distribution and disposable-emulator provisioning

Date: 2026-09-29. This is a reproducible test-device staging record and proposed production packaging plan. Installing an app does not accept its terms, create an account, grant sensitive permissions, enable autofill, or establish integration with Alpha's agent. None of those actions was performed by this staging work.

## Current test-device result

The disposable `emulator-5554` returned `sys.boot_completed=1` before installation. Initial packages included AOSP Camera, Gallery, Contacts, Calendar, Messaging, DocumentsUI, and `org.chromium.webview_shell`, but no Organic Maps, Thunderbird, Proton Pass, or full Chromium browser. WebView Shell is an engine test host, not qualification of the requested full native browser.

Three unmodified official APKs were downloaded over HTTPS, verified and installed with `adb install -r`. Each installation returned `Success`, and each package path was read back. No app data, account or security setting was configured. Read-only package-manager resolution also confirmed `geo:` dispatch to `app.organicmaps.web/app.organicmaps.SplashActivity`, `CATEGORY_APP_EMAIL` to `net.thunderbird.android/net.thunderbird.app.common.MainActivity`, and the presence of `proton.android.pass/.autofill.ProtonPassAutofillService`. These checks establish registered entrypoints, not completed first-run or authenticated functionality. Files, raw signature/badging evidence and machine-readable manifest are in ignored `artifacts/native-apps/`; APKs must not be committed to Git.

| App | Installed package/version | Official source | Verification |
| --- | --- | --- | --- |
| Organic Maps | `app.organicmaps.web`, `2026.09.29-32-Web`, versionCode `26092932` | [Publisher release 2026.09.29-32-android](https://github.com/organicmaps/organicmaps/releases/tag/2026.09.29-32-android) | Download SHA-256 matches both publisher release checksum and GitHub asset digest; Android APK signature verifies |
| Thunderbird | `net.thunderbird.android`, `23.1`, versionCode `32` | [Publisher release THUNDERBIRD_23_1](https://github.com/thunderbird/thunderbird-android/releases/tag/THUNDERBIRD_23_1) | Download SHA-256 matches publisher GitHub asset digest; Android APK signature verifies |
| Proton Pass | `proton.android.pass`, `1.40.3`, versionCode `14003373` | [Official APK download page](https://protonapps.com/protonpass-android), [vendor APK](https://proton.me/download/PassAndroid/ProtonPass-Android.apk) | APK signature verifies and signing certificate SHA-256 exactly matches fingerprint published on official APK page |

Pinned download hashes:

| Artifact | SHA-256 |
| --- | --- |
| `OrganicMaps-26092932-web-release.apk` | `d7dbdfc3cbfdbcce6d437f11147f2cd15384c03052d2b4594fd8c1c7777dd497` |
| `thunderbird-23.1.apk` | `9f503a2e35d4764b1f614efcb666b07fde8f12b69f42c692e417439a31c5a434` |
| `ProtonPass-Android.apk` | `4d82ed1101af49085908733a392acb5d13d1f9dac5e58849fa7519b95045a297` |

Recorded APK signing certificate SHA-256 values:

| App | Signing certificate |
| --- | --- |
| Organic Maps | `b9c7ae79a5a90270df08a132e536b9c666f5bef1f59b304fcecf8687865e4b5b` |
| Thunderbird | `b6524779b3dbbc5ac17a5ac271ddb29dcfbf723578c238e03c3c217811356dd1` |
| Proton Pass | `dcc9439ec1a6c6a8d0203f3423ee42bcc8b970628e53cb73a0393f398dd5b853` |

Organic Maps/Thunderbird certificate values were observed from the publisher-downloaded, checksum-matched APKs; they were not independently matched against a separate published fingerprint. Proton's certificate was independently compared with its official page. The APK verifier reported valid signatures; Organic Maps/Thunderbird also emitted META-INF entry warnings preserved in their raw logs. The checked full-file publisher digest covers the downloaded bytes; do not edit those archives or suppress the raw evidence.

## Production recommendations and constraints

Use these exact unmodified official releases as test candidates, not an unreviewed production support promise. Before production, refresh security/release status, confirm licensing and trademark requirements for device bundling, select a maintained update channel, and test all flows on the target image. “Latest” URLs such as Proton's are mutable: pin the version, artifact hash and signer recorded at release time, then verify any update deliberately.

**Organic Maps:** source is Apache-2.0; map binary data has a separate license, and its project README requires visible Organic Maps Project attribution for derivatives using source/UI/data. Preserve original app identity for unmodified bundling. If copying UI or shipping offline map datasets, include required data attribution and review the separate data license. No map region was downloaded during staging. Search/routing acceptance still requires map-data availability and actual native UX. [Source and attribution](https://github.com/organicmaps/organicmaps), [source license](https://github.com/organicmaps/organicmaps/blob/master/LICENSE), [data license](https://github.com/organicmaps/organicmaps/blob/master/DATA_LICENSE.txt).

**Thunderbird:** repository license is Apache-2.0, with third-party notices and Mozilla/Thunderbird trademark considerations distinct from source licensing. An official binary retains its original identity/signature. A branded source fork needs its own app identity/update chain and its own OAuth configuration/redirects; the repository specifically documents replacing upstream OAuth configuration when forking. Installing Thunderbird makes native email handling available but does not grant Alpha inbox API access or provision an email account. [Source and fork guidance](https://github.com/thunderbird/thunderbird-android), [license](https://github.com/thunderbird/thunderbird-android/blob/main/LICENSE).

**Proton Pass:** Android source is GPL-3.0-or-later. Do not assume open source grants unrestricted trademark use or permission to claim an official partnership. Distribution of a modified product requires the applicable corresponding-source obligations and a deliberate signing/update plan. Prefer unmodified official app with Alpha-owned setup/status styling. Autofill and credential-provider enablement remain Android/user-owned; no vault is unlocked and no credentials are exposed to the agent. [Source/license](https://github.com/protonpass/android-pass), [Android distribution](https://proton.me/pass/download/android).

## Chromium source and staging policy

Chromium's official download guidance links its Google-hosted snapshot bucket. No maintained standalone stable Android Chromium APK channel was established during this research. Official Android snapshots are useful for disposable integration testing, but are development builds and are not a production browser/update policy. The upstream owned browser still needs its component patch, build-pinned certificate and Alpha native-host registration; an arbitrary official snapshot does not provide that integration. [Official download guidance](https://www.chromium.org/getting-involved/download-chromium/), [Android build instructions](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/android_build_instructions.md).

An official ARM64 development snapshot at revision `1707416` was selected from `Android_Arm64/LAST_CHANGE`. The source object is [chrome-android.zip](https://commondatastorage.googleapis.com/chromium-browser-snapshots/Android_Arm64/1707416/chrome-android.zip), generation `1790716146257440`, published `2026-09-29T21:09:06.350Z`, size `432114383`, object MD5/ETag `4558baa120baaf49ae16cb3ab4a80102`. Download completed, its MD5 matched the recorded object value, `ChromePublic.apk` passed APK v2 signature verification, and `adb install -r` returned `Success`. Only the full browser APK was installed; bundled ContentShell and SystemWebView APKs were not installed. The GCS MD5 is transfer-integrity evidence, not an independent publisher-signing identity proof; verify APK signature and retain provenance as development-only.

The installed development browser is `org.chromium.chrome`, versionName `157.0.8079.0`, versionCode `807900004`, source revision `8ed882cd6c272c527574e554e8fba023a60e629d`. Extracted APK SHA-256 is `2cc5f7e36f53d78ce157bac16e3f698a4bb72b29d451bb61f66c969d11201827`; observed signing certificate SHA-256 is `32a2fc74d731105859e5a85df16d95f102d85b22099b8064c5d8915c61dad1e0`. The certificate DN uses Unknown fields, as recorded in the signature log; source trust here derives from the official Chromium-linked storage provenance and verified object transfer, not a claim of a separately established production signer. No agent browser trust allowlist was changed to admit it. The system WebView remains unchanged. Browser first-run, page load, autofill and agent control require separate tests.

## Proposed AOSP product manifest

Do not put third-party binaries in the application source or rewrite them with Alpha branding. Resolve approved artifacts into a release artifact store by pinned SHA-256, carry source/release/license records, and generate a reviewed vendor add-on such as:

```text
vendor/alphaphone/native-apps/
  Android.bp
  product.mk
  distribution-manifest.json
  licenses/
  prebuilts/OrganicMaps.apk
  prebuilts/Thunderbird.apk
  prebuilts/ProtonPass.apk
```

Each approved app uses a distinct `android_app_import` with `presigned: true`, `preprocessed: true`, `product_specific: true`, and its original signing certificate. Add its module through `PRODUCT_PACKAGES` in the product fragment. Keep ordinary third-party apps nonprivileged. Include the fragment from the selected device product; do not pretend this staging record has modified or booted a real image. Existing `stage-launcher-overlay.ts` demonstrates additive presigned packaging for the launcher, but does not itself provision these apps.

`distribution-manifest.json` should record package, versionName/versionCode, source/release URL, immutable object/revision where available, full APK hash, signer fingerprint, license/notices, source-offer location when applicable, update authority and support status. Device policy/default-role choices belong in a separate explicit provisioning profile. Preinstallation must not silently set sensitive permissions, accept provider terms, grant notification-listener access or unlock a vault.

Owned Chromium stays in the dedicated upstream `packages/os/scripts/distro-android/prepare-chromium-browser.ts` path and associated browser build/signing configuration. Do not replace the pinned owned-browser package with the development snapshot in a production manifest or disable package/certificate checks to make the snapshot pass.

## Alpha Phone's own release packaging (October 4)

This document concerns third-party native apps. Alpha Phone's own APKs follow
[the Android build contract](android-and-aosp.md): distribution builds exclude every
mock, fixture and developer surface (`ELIZA_DEV_ALLOW_TEST_MOCKS` off); release signing
uses `ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`, `ELIZAOS_KEY_ALIAS` and
`ELIZAOS_KEY_PASSWORD`, or `scripts/sign-release-apks.mjs` with the ceremony key files or a
PKCS#11 token after an unsigned build; version comes from `ELIZAOS_VERSION_CODE`/`ELIZAOS_VERSION_NAME`
or `app.config.json`; release variants are R8-minified with retained mapping files; and
App Links stay inactive until the release signer is enrolled and the Eliza Cloud web host
lists it ([human actions](human-actions.md) H-09 and H-13). Alpha's in-app third-party notices
(`apps/app/public/licenses/third-party-notices.json` and `THIRD_PARTY_NOTICES.txt`) cover
the app's own dependencies only; the native apps staged here need their own notices in
the image's license bundle. Under decision P-09 those in-app notices include every
dependency's licence text and flag copyleft, unknown and unverified entries instead of
stopping the build; verify-apks records the flags per APK (`licenceFlags`). A flag is not
a release blocker and not legal review. The proprietary Denton typeface is recorded on the
owner's statement that its licence is held outside the repository; the check
`unresolved-font-licence` reports it on each release row and blocks nothing (decision
A-21, closed). P-09 concerns the app's own open-source dependencies: it does not change
what the separately signed native apps on this page require.

## Required post-install tests

1. Native intent resolution from Alpha reaches the intended installed app, including first-run screens, and returns through Android Back/Home without losing Alpha's draft.
2. Organic Maps has an explicit map-download/setup state; a test region and route are confirmed only after approved setup.
3. Thunderbird exposes inbox/compose entrypoints before and after an operator-configured test account. No sending or account login is implied by installation.
4. Proton appears as an available native provider; enablement, test account/vault and owned test login/passkey flows remain separate steps.
5. Chromium opens a harmless HTTPS page, handles tabs/navigation and permits native provider integration where supported; agent observation is separately tested only with the owned bridge.
6. Confirm provider updates preserve package/certificate identity and user data; exercise rollback policy and first-run onboarding on the actual AOSP image.

## Phone test-target correction

The target is a phone, not tablet; the hardware target is now Pixel 10a on Android 17 (P-15). The prior install evidence records the earlier disposable emulator. The same four verified artifacts were installed successfully onto `alpha_flow_pixel_20260929` after `sys.boot_completed=1` and AVD-name verification, using the available Pixel 9 hardware definition and API 35 AOSP ARM64 image. Each artifact SHA-256 was rechecked before installation. All four `adb install -r` commands returned `Success`; results are in ignored `artifacts/native-apps/phone-install-results.json`. Phone geometry is 1080 × 2424 pixels at 420 dpi. No account, provider default or permission was configured. No Pixel 10 definition was installed. Physical Pixel 10 compatibility remains unverified.

## Reproducible offline AOSP staging

The checked-in [pinned candidate manifest](../config/native-apps.json) records the three official native apps above. The [staging script](../scripts/stage-native-apps.mjs) accepts an operator-supplied directory containing those exact approved APK filenames; it never downloads artifacts or follows mutable release URLs. It uses the project's Android SDK build-tools 36.0.0 and JDK configuration from `scripts/toolchain.mjs`.

```sh
node scripts/stage-native-apps.mjs \
  --apk-dir /path/to/approved-native-apks \
  --output /path/to/existing-parent/new-native-apps
```

The output directory must not already exist, and its parent must exist. Output inside the pinned `vendor/eliza` checkout is rejected. All three files must match their pinned full SHA-256, package ID, versionName, versionCode and verified single signing certificate. Debuggable APKs are rejected. Verification happens on the staged copy before the final output directory is published. Failure removes only the script's temporary staging directory. No APK bytes are modified.

Generated output contains nonprivileged, product-specific `android_app_import` modules with `presigned: true`, `preprocessed: true` and dex preoptimization disabled; a `product.mk` adding those modules; the pinned distribution manifest; and raw signature/badging evidence. Place the generated directory at `vendor/alphaphone/native-apps` in a separately selected AOSP checkout and add this line to its device product definition:

```make
$(call inherit-product, vendor/alphaphone/native-apps/product.mk)
```

The script does not select default apps, grant privileges, configure accounts, enable autofill, alter update authorities, or include the Chromium development snapshot. It stages candidates, not a production release approval. License/source URLs are provenance metadata: the release process must still supply required license texts, third-party notices and exact corresponding source where applicable, confirm trademark/distribution rights, define publisher-compatible updates, and build/boot/test the selected phone image. The owned Chromium distribution requires its independent upstream build and signing flow.

Staging verification on 2026-09-29: `node --check scripts/stage-native-apps.mjs` passed. Running the script against the three actual verified artifacts in `artifacts/native-apps` completed successfully and produced `/private/tmp/alpha-native-apps-verified-20260929`; generated `Android.bp` and `product.mk` were inspected. A second run refused the existing output directory. A deliberately altered fixture failed the SHA-256 check, produced no output directory and removed its temporary staging directory. These checks exercise artifact validation and packaging generation only. AOSP Soong validation (including preprocessed APK compression/alignment constraints), target image build/boot and device acceptance have not been performed by this staging task; an official APK that cannot pass the selected branch's presigned-preprocessed checks must be resolved without silently rewriting its signature.
