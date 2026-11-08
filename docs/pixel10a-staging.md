# Pixel 10a staging and release signing

The physical product is `alpha_stallion_phone`, for the exact Android 17 stallion
source and factory inputs in [the source contract](pixel10a-source-contract.md).
Before image staging, apply the exact recorded Soong app-native patch to its
manifest's `build/soong` revision. From this repository, after setting `AOSP_SOURCE`
to the admitted source checkout:

```sh
git -C "$AOSP_SOURCE/build/soong" apply --check "$PWD/vendor/eliza/packages/os/android/patches/soong-app-native/soong-app-native.patch"
git -C "$AOSP_SOURCE/build/soong" apply "$PWD/vendor/eliza/packages/os/android/patches/soong-app-native/soong-app-native.patch"
```

The following stages a new directory; it does not patch the source, build or flash
an image, or admit a production release:

```sh
npm run aosp:stage -- --target pixel10a --development \
  --applied-build-patch soong-app-native \
  --apk /absolute/admitted-launcher-debug.apk \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --output /absolute/new-alpha-overlay
```

The input must be a flag-off launcher APK. Existing packaged test-mock exclusion,
APK manifest admission, verified APK hash and signer, product identity, lock-screen
surface checks, clock and image capability declarations remain in force. Optional
listener inputs use the same signer and speech payload checks as other development
staging. Always-on listener acceptance is still required for the MVP; omitting it
from a development overlay does not meet that requirement. Production Pixel staging
is described below. Omitting `--target` retains the existing product staging
behavior and production gates.

Source verification runs before staging. Secure camera verification independently
checks its existing pinned module revisions and Camera2/SystemUI/manifest hashes.
It accepts only the exact source lock's recorded overrides; within these monitored
modules the overrides are extraction-tool files under `frameworks/base/tools/aapt2`.
It still rejects changed override bytes, additional changes, hidden index flags and
ignored source inputs. This is not an exception for camera behavior changes.

The generated overlay belongs under `vendor/alphaphone` in the already verified
source. Select `alpha_stallion_phone-cp2a-userdebug` using that source's normal
build tools. The source contract already covers the patched generated vendor files;
staging copies reference patches for review and does not apply them again.
The product retains fallback HOME during bring-up and a nonprivileged presigned
Alpha app. The read-only system eSIM flags provider accepts only system UID, itself,
or the installed system eSIM clients; it does not implement Google services.

Native staging installs byte-exact stored ARM64 JNI libraries next to the APK and
emits `config.fs` with executable modes for Bun and its loader. A resident payload
must match the current source stamp, stable Bun binary pin, complete runtime
provenance, workflow-worker closure, and native-view policy. A self-consistent
replacement Bun cannot bypass its independent binary pin. The original APK is not
rewritten. For an explicitly built Cloud QA APK, the packaged renderer profile and
exact `alpha-runtime-profile.json` receipt must agree. Staging verifies every retained
resident provenance entry and the original pinned BGE omission record, while requiring
that BGE and all other local inference/speech payloads are absent. Unknown profiles,
missing resident components and mixed native/Cloud packages are refused. The native
profile still requires its original local model. This permits Cloud QA image staging;
it does not qualify offline speech, the image boot, Cloud services or release signing. A compressed or malformed native payload is refused. Failed physical
staging removes its temporary output and leaves an existing destination untouched.

After source admission and before any output is written, staging runs the shared
stock-vendor check (`vendor/eliza/packages/os/scripts/android/vendor-api.mjs`): the
composition's release configuration (`cp2a`) and the generated stallion vendor VINTF
manifest must both carry the shared profile's locked `vendorApiLevel`. A mismatch is
refused, never rewritten. The shared composition also declares the launcher's
`<package>.aosp_image` system feature (`image-capability.mjs`); `physical-product.json`
records both as `vendorApi` and `imageFeature`. Only an image boot shows Android
reporting the feature.

`physical-product.json`, `native-libraries.json` and the camera receipt distinguish
source/staging evidence from execution. None asserts image build, runtime execution,
release qualification or device acceptance. Full current APK verification, both
distribution variants, image build/boot, actual native speech/runtime, hardware,
update/recovery and user acceptance remain separate requirements.

Offline tests run with `node --test test/aosp-pixel10a.test.mjs` (including Python
native fixtures) and `node --test test/aosp-secure-camera.test.mjs
 test/pixel10a-source.test.mjs`. Synthetic binaries in these tests establish checks
and generated file contents, never executable APK or image acceptance.

## Production staging

`--target pixel10a --production` stages the `alpha_stallion_phone-cp2a-user` product
from the production descriptor `android/aosp/pixel10a-product.json`. Before any source,
factory archive or APK is read it refuses, naming each gap, while:

- any descriptor value is `UNSET` or a placeholder;
- `sourceLock.sha256` does not pin the exact bytes of `vendor/eliza/packages/os/android/sources/pixel10a-stallion.json`,
  or that lock is still marked `developmentOnly` (admitting the inputs for release is a
  reviewed change to both files);
- `android/release-signer.json` has no reviewed APK release signer, or
  `signer.platformCertificateSha256` is not the reviewed image platform certificate;
- the descriptor claims `releaseQualified` or `deviceAcceptanceVerified`. Both stay `false`:
  they are release and device evidence, never staging inputs.

```sh
npm run aosp:stage -- --target pixel10a --production \
  --applied-build-patch soong-app-native \
  --apk /absolute/launcher-release.apk --apk-manifest /absolute/apk-manifest.json \
  --descriptor /absolute/reviewed-launcher.json \
  --listener-apk /absolute/sense-release.apk --listener-descriptor /absolute/reviewed-listener.json \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --output /absolute/new-alpha-overlay
```

The launcher must be a release that `verify-apks` recorded as distributable, and it is
re-judged against the committed release signer at staging time; the source verification,
listener, camera and provisioning checks of production staging all apply. Staging sets no
`BOARD_AVB_*` variable: board configuration belongs to the device's locked `BoardConfig.mk`,
not to product makefiles. The image builds with the device's AVB configuration and test key,
and release signing below re-signs vbmeta and every chained partition with the release `avb`
key and the descriptor's algorithm.
`physical-product.json` records the descriptor hash with `imageBuilt`, `imageSigned`,
`releaseQualified` and `deviceAcceptanceVerified` all `false`.
The shared composition keeps the system Clock (`DeskClock`) in the product. A brand boot
animation is staged only when `vendor/eliza/packages/os/android/products/pixel10a-alpha.json`
pins its SHA-256 (`brandAssets.bootAnimation`); then pass the reviewed stored
`bootanimation.zip` with `--boot-animation`. Alpha's composition pins none, so the stock
animation remains.

## Release signing, OTA and compatibility record

The signing job, compatibility record, update client and recovery tooling are shared Pixel 10a
tooling in `vendor/eliza/packages/os/scripts/android` (`aosp-release-signing.mjs`,
`aosp-release-record.mjs`, `aosp-ota-update.mjs`; see `vendor/eliza/packages/os/android/releases/README.md`).
Alpha keeps only its inputs: `android/aosp/pixel10a-product.json`, the update channel, the
qualification gates and `android/release-signer.json`. The scripts below bind those inputs.

On the Linux image host, after the production image build, sign the unsigned target-files
and build the OTA with the AOSP releasetools (`otatools` `bin/`) and a decrypted release key
directory in the upstream layout (`vendor/eliza/packages/os/android/signing`: `<name>.pk8`
plus `<name>.x509.pem` for `releasekey`, `platform`, `shared`, `media`, `networkstack`,
`sdk_sandbox`, `bluetooth` and `nfc`; `avb.pem` and `avb_pkmd.bin`; and, when the build has
APEXes it re-signs, `apex.pk8`/`apex.x509.pem`, `apex_payload.pem` and `apex_payload.avbpubkey`):

```sh
node scripts/sign-aosp-release.mjs \
  --target-files /absolute/unsigned-target_files.zip --target-files-sha256 <from the build record> \
  --keys-dir /dev/shm/keys --releasetools /absolute/otatools/bin \
  --apk-manifest /absolute/apk-manifest.json --out /absolute/new-release-dir \
  [--apksigner /absolute/apksigner] [--map-key vendor/x/certs/foo=foo ...] \
  [--incremental-from /absolute/previous-signed-target_files.zip] [--dry-run]
```

Before running anything it reads the unsigned target-files' `META/misc_info.txt`,
`META/apkcerts.txt` and `META/apexkeys.txt`. It refuses a build without AVB, any chained AVB
partition (every `avb_<partition>_key_path`, for example `boot`, `init_boot`, `vendor_boot`,
`vbmeta_system`, `vbmeta_vendor`) that `avb.chainedPartitions` in the product descriptor does
not map, a mapped partition the build does not chain, an APK certificate that no release key
mapping covers (the `-d` defaults, `bluetooth`, `nfc`, or an explicit `--map-key SOURCE=NAME`
for a key `NAME.pk8`/`NAME.x509.pem` in the key directory), externally signed APKs, and a
partly presigned APEX. Every certificate it signs with must match a reviewed digest:
`platform` matches `signer.platformCertificateSha256`, `releasekey` matches the channel's
`otaCertificateSha256`, and every other one (`shared`, `media`, `networkstack`, `sdk_sandbox`,
`bluetooth`, `nfc`, `apex` when an APEX is re-signed, and each `--map-key` name) matches
`signer.releaseCertificates.<name>`. All of these are `UNSET` until reviewed, so a key bundle
carrying a public AOSP test key under a release name is refused. It then runs `sign_target_files_apks -o -d KEYS` with
`-k build/make/target/product/security/bluetooth=KEYS/bluetooth` and the same for `nfc`, an
`--extra_apex_payload_key NAME=KEYS/apex_payload.pem` and `--extra_apks NAME=KEYS/apex` for
every APEX that is not presigned, and the `avb` key and algorithm for vbmeta and each chained
partition. Before any OTA is built it runs `apksigner verify --print-certs` on every APK and
APEX in the signed target-files that is not presigned and refuses any signer that is not a
release certificate from the key directory (a remaining test, development or unknown key), and
any re-signed APEX without the release payload public key. `sign_target_files_apks` also receives `--package_key KEYS/releasekey` (and, under managed
signing, the payload signer), so an embedded boot OTA (`VENDOR/` or `SYSTEM/boot_otas/*.zip`)
is re-signed with the release key rather than the build's development certificate. Only APKs
packaged in the target-files need a key mapping; `apkcerts.txt` also lists test and CTS packages
the image does not contain. Then it runs
`ota_from_target_files -k KEYS/releasekey`, copies the public `avb_pkmd.bin`
(enrolled on a device with `fastboot flash avb_custom_key avb_pkmd.bin` before
`fastboot flashing lock`), and writes `release-record.json`: build fingerprints and versions,
security patch levels, the hashes of vbmeta and of each chained partition image the signed
build's `misc_info.txt` lists with the AVB rollback index at each location (from the vbmeta
headers and chain descriptors), payload hash and OTA metadata, release
certificate digests and the APK signer digests from `apk-manifest.json`. The record
generator also runs on its own: `node scripts/aosp-release-record.mjs --signed-target-files
ZIP --ota ZIP --out NEW_FILE`.

Keys are supplied only at signing time and never committed. The key directory must be an
absolute path outside every Git working tree (a `git` that cannot run counts as a refusal)
with mode 0700, and every key file it uses must be a regular file, not a symbolic link, with
mode 0600 or stricter. Commands receive the key directory's real path. Private keys are passed
to the releasetools by path and never read by the script. It refuses, before running any tool, on
any `UNSET` descriptor or channel value, a target-files hash that differs from the build
record, a missing key file, or a platform certificate, OTA certificate or AVB public key that
differs from the reviewed digests in the product descriptor and
`android/aosp/pixel10a-ota-channel.json`. `--dry-run` prints the exact commands and every
problem and runs nothing. None of this has run against a real stallion target-files or real
APEXes. The chained partitions in `avb.chainedPartitions` must be ones `sign_target_files_apks`
can re-sign (`boot`, `dtbo`, `init_boot`, `recovery`, `system`, `system_other`,
`vbmeta_system`, `vbmeta_vendor`, `vendor`); any other is refused before signing.

### Managed (hardware-backed) signing

Decision P-16 calls for managed or hardware-backed release signing. With the four managed
options the job keeps every private key in a PKCS#11 token (an HSM, or a managed key service's
PKCS#11 library) and the key directory holds only public material:

```sh
node scripts/sign-aosp-release.mjs ...the options above... \
  --pkcs11-config /absolute/sunpkcs11.cfg --avb-signing-helper /absolute/avb-helper \
  --payload-signer /absolute/payload-signer [--payload-signer-arg ARG ...] \
  --payload-signer-signature-size 512
```

The options are given together or not at all; private key files and token keys are never
mixed. The key directory then holds every `<name>.x509.pem`, `avb_pkmd.bin`, and for re-signed
APEXes `apex.x509.pem` and `apex_payload.avbpubkey`, with `avb.pem` and `apex_payload.pem` as
**public** keys (`-----BEGIN PUBLIC KEY-----`). Any `.pk8` file in it, or a non-public `avb.pem`
or `apex_payload.pem`, is refused. The same location, permission and reviewed-digest checks
apply, and the same post-signing `apksigner` check refuses an APK or APEX whose signature does
not verify against a release certificate, so a token key that does not match its certificate
stops the job before any OTA is built.

- **APK, APEX container and OTA package keys**: signapk loads them from the token through
  SunPKCS11 (`--extra_signapk_args "-providerClass sun.security.pkcs11.SunPKCS11 -providerArg
  CONFIG -loadPrivateKeysFromKeyStore PKCS11"`, with `--java_args` adding the
  `jdk.crypto.cryptoki/sun.security.pkcs11` export a JDK 9+ needs). signapk looks each key up
  by the private-key path it would otherwise read, so the token's key labels are
  `<key-dir real path>/<name>.pk8` (for example `/run/alpha-release-keys/platform.pk8`): use a
  stable key-directory path. `--dry-run` prints every label as `tokenLabels`.
- **AVB (vbmeta, each chained partition, APEX payloads)**: avbtool calls
  `--avb-signing-helper` through `--signing_helper_with_files` as
  `HELPER ALGORITHM PUBLIC_KEY_PATH FILE`. The helper must sign the padded hash in `FILE` with
  the token key for that public key and **overwrite `FILE` in place**: avbtool rereads the file
  it already has open, so a helper that replaces the file (`mv`) leaves the hash unsigned and
  the image fails verification.
- **OTA payload**: `ota_from_target_files --payload_signer` runs
  `SIGNER ARGS... -in HASH_FILE -out SIGNATURE_FILE`; the arguments name the token key.
  `--payload-signer-signature-size` is the signature size in bytes (512 for RSA-4096).

signapk opens the PKCS#11 keystore without a PIN (it passes none, and this job never puts one
on a command line), so the token must expose its signing keys without a login, as a managed key
service's PKCS#11 library authenticated by its own credentials does. A token that requires a
user PIN makes every key lookup fail with `Key ... not found`.

In managed mode the public `avb.pem` must encode to exactly `avb_pkmd.bin`, and
`apex_payload.pem` to `apex_payload.avbpubkey` (the shared `encodeAvbPublicKey`, byte-identical
to `avbtool extract_public_key`); a mismatched public key is refused.

Paths and signer arguments must be plain words (no spaces, quotes or shell characters), because
the releasetools split them with `shlex`. A token PIN or service credential belongs in the
token's own configuration or environment, never on a command line, where any local user can
read it. `release-record.json` records `inputs.signingMode` as `managed` or `key-files`.

These argument vectors were parsed by the AOSP 17 (`android-17.0.0_r1`)
`sign_target_files_apks` and `ota_from_target_files` option parsers. On 2026-10-25, the built
stallion-tree `avbtool` signed a vbmeta image and a hash-footer image through a
`--signing_helper_with_files` helper with only a public key on disk, and both verified. The
built `signapk.jar` loaded SunPKCS11 with these arguments and looked up `<key-dir>/platform.pk8`
in the token. No signing ran with a real token or managed service, and no stallion
target-files was signed.

`android/aosp/pixel10a-ota-channel.json` is the one signed update channel: authority, release
owner, the OTA certificate and AVB key digests, `downgradeAllowed: false`, the stock factory
image for recovery, a known-good release slot and the drill record. A signed release is not
distributable while the known-good release is unset or any signed-update, interrupted-update,
compatible-rollback or stock-recovery drill is not `passed`; the script prints those as
`NOT DISTRIBUTABLE`. Drill results are recorded from executed drills, never by software.

The shared refusals, command lines (key-file and managed), record and update client are tested
upstream with releasetools test doubles, throwaway certificates and a simulated device
(`vendor/eliza/packages/os/scripts/__tests__/aosp-release-signing.node.test.ts`,
`aosp-ota-update.node.test.ts`); `node --test test/aosp-release-signing.test.mjs test/pixel10a-gates.test.mjs`
checks that Alpha's descriptors, channel and signer are what they receive. None of it is a
signed image, an image boot, an applied OTA, or a rollback or recovery drill.

## Update, interruption, rollback and recovery

`scripts/aosp-ota-update.mjs` is the operator update client for one serial-bound Pixel 10a; it
defaults to Alpha's channel and the shared stallion source lock:

```sh
node scripts/aosp-ota-update.mjs check --from installed/release-record.json --to candidate/release-record.json
node scripts/aosp-ota-update.mjs apply --serial SERIAL --from installed/release-record.json \
  --to candidate/release-record.json --ota candidate/ota.zip --journal /abs/new-journal.json \
  [--execute --confirm-update]
node scripts/aosp-ota-update.mjs status --serial SERIAL --journal /abs/journal.json
node scripts/aosp-ota-update.mjs fallback --serial SERIAL --journal /abs/journal.json [--execute --confirm-fallback]
node scripts/aosp-ota-update.mjs stock-archive --archive /abs/stallion-cp3a.261005.005-factory-d1d25502.zip
node scripts/aosp-ota-update.mjs verify-stock --serial SERIAL
```

`check` refuses a candidate that is not newer, lowers the security patch level or any AVB
rollback index, changes the OTA certificate or AVB key, or (incremental) does not start from the
installed build. `apply` verifies the package against the candidate record and the device
against the installed record, then sends the package through the device's own recovery
(`adb reboot recovery`, then `adb sideload`; a locked user build verifies it against its
otacerts) and verifies the candidate on the other slot, with verified boot no weaker than
before. A user build's adbd cannot enter sideload itself (`adb reboot sideload` needs
`adb root`), so the operator chooses "Apply update from ADB" in recovery when asked, and
"Reboot system now" if recovery stays in its menu after the installation. Each step is
journaled. An interrupted run keeps the journal and the device lock; `status` classifies the
observed device and a repeated `apply` resumes from it without assuming success. `fallback`
returns to the original slot only before the updated slot is marked successful and, because
Pixel 10a uses Virtual A/B, only while the bootloader reports a `snapshotted` update (a
recovery that could not create snapshots overwrites the original slot's dynamic partitions;
then a compatible release or stock recovery restores the device). `stock-archive` verifies the locked
factory archive and prints the fastboot plan, which unlocks the bootloader and wipes data and
is run by the operator; `verify-stock` checks the restored stock build. The unlock is refused
unless OEM unlocking was enabled from the running image's developer options, which a device that
no longer boots cannot do: whether released units keep it enabled is a release decision that the
stock-recovery drill must exercise.
`scripts/verify-pixel10a-image.mjs` checks a booted image read-only (exact fingerprint, Alpha's
system launcher bytes as HOME, recovery HOME, Clock handlers, WebView, a green or yellow verified boot state and,
with `--listener`, the listener's privileges). These are drill tools: drill results and the
known-good release are recorded in the channel by the release owner from executed drills.


When the source tree already carries the reviewed SystemUI listener chip, pass
`--applied-systemui-patch chip` to Pixel `aosp:stage`. Use `ops` for the other
reviewed bundle. The option is repeatable, rejects duplicates and unknown names,
and requires an explicit Pixel or Cuttlefish target. Each patch still requires the
locked project revision, exact preimages and exact installed postimages; unrelated
source changes remain rejected. This only admits staging and is not image or
device acceptance.
