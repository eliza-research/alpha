# #672 Pixel 10a production image, OTA and release-candidate Cuttlefish boot (A-01, H-21, H-22, H-23)

Owner preparation for [issue #672](https://github.com/eliza-research/alphaphone/issues/672). The
commands are those of [Pixel 10a staging](../pixel10a-staging.md) and
[human actions](../human-actions.md) H-21 to H-23, in execution order, with the checks that can be
run beforehand. Nothing here builds, signs or boots anything. The results this procedure produces
are **image-build, image-signing and virtual-target boot evidence only**; they are not device
acceptance (#673) and do not prove each other.

## Prepared on this branch

- `scripts/owner/production-staging-preflight.mjs`: read-only. Lists every `UNSET` or placeholder
  field in `android/aosp/product.json`, its brand config and shared Cuttlefish lock profile,
  `android/aosp/pixel10a-product.json`, the Pixel 10a source lock, `android/release-signer.json`
  and `android/aosp/pixel10a-ota-channel.json`, with the step that fills each; checks the source
  lock pin and flags, `downgradeAllowed`, drills and gates; and prints the authoritative shared
  staging checks (`pixel10aProductProblems`, `cuttlefishProductProblems`). `--json`, `--strict`
  (exit 1 while anything is open). Test: `test/owner-production-staging-preflight.test.mjs`.
- `test/owner-sign-aosp-release-edges.test.mjs`: extra mocked-releasetools tests of Alpha's
  `sign-aosp-release.mjs` binding: managed signing with a re-signed APEX (SunPKCS11 keystore
  arguments, the AVB helper on vbmeta, `vbmeta_system`, `vbmeta_vendor` and APEX payloads, the
  payload signer on both tools, token labels, `signingMode: managed` in the record); managed option
  refusals (partial set, relative or shell-unsafe paths, non-executable helper, bad signature
  size, unsafe signer argument); managed key directory refusals (a `.pk8`, a private or mismatched
  `avb.pem`, a private or mismatched `apex_payload.pem`, a missing certificate); APEX key-file
  refusals (each missing APEX key file, an unreviewed `apex` certificate, a partly presigned APEX),
  presigned-only APEX builds needing no APEX key; and the post-signing refusal of an APEX that still
  carries the test payload key, before any OTA is built. One `todo` test records the gap below.
  These use the upstream releasetools test doubles and throwaway keys; they are not a signature.

## Read-only state on 2026-10-28 (main 94676c82, Eliza pin 1f2a922f)

`node scripts/owner/production-staging-preflight.mjs` reports **20 UNSET fields in 4 records**:

| Record | UNSET fields | Filled by |
| --- | --- | --- |
| `android/aosp/product.json` | `hostPackages[0..1].version`, `hostPackages[0..1].sha256` (cuttlefish-base, cuttlefish-user) | A-01 / H-23 image host operator |
| `android/aosp/product.json` | `signer.platformCertificateSha256` | H-09, **by hand** (enrollment does not write this file) |
| `android/aosp/pixel10a-product.json` | `signer.platformCertificateSha256`, `signer.releaseCertificates.{shared, media, networkstack, sdk_sandbox, bluetooth, nfc, apex}`, `avb.publicKeySha256` | H-09 `enroll-release-keys.mjs --write` |
| `android/release-signer.json` | `signerSha256` | H-09 |
| `android/aosp/pixel10a-ota-channel.json` | `otaCertificateSha256`, `avbPublicKeySha256` | H-09 |
| `android/aosp/pixel10a-ota-channel.json` | `recovery.knownGoodRelease.{buildFingerprint, otaSha256, recordFile}` | H-22 |

No placeholder in the brand config, the shared Cuttlefish lock profile or the Pixel 10a source lock.
The Pixel 10a lock matches `sourceLock.sha256` (`760a7184...`) and is not `developmentOnly`.
Gates: `sourceAdmission` and `apkVariants` passed; `cuttlefishBoot` and `physicalDevice`
`development`; `signedUpdateRecovery` and `userAcceptance` `not run`; all four drills `not run`.
`npm run human:status`: H-21 `external`, H-22 `open` (known-good release unset), H-23 `open`
(`cuttlefishBoot gate: development`).

## Findings for the owner

1. **`android/aosp/product.json` platform digest is not enrolled.** `enroll-release-keys.mjs`
   writes `pixel10a-product.json`, `release-signer.json` and the channel only, and `human:status`
   H-09 does not read `product.json`. After H-09 shows `done`, Cuttlefish production staging still
   refuses until `signer.platformCertificateSha256` in `product.json` is set by hand to the same
   `platform` digest. Either do that in the enrollment review, or add `product.json` to
   `ENROLLMENT` in a follow-up change.
2. **The APEX payload key has no reviewed digest.** The ceremony's `fingerprints.json` carries
   `apex_payload.avbPublicKeySha256` and enrollment checks it is well formed, but nothing records
   it: the signing job compares re-signed APEXes only with the key directory's own
   `apex_payload.avbpubkey`. A different payload key pair placed in the key directory is accepted
   (the `todo` test). The image is still AVB-signed with the pinned `avb` key and APEX containers
   with the pinned `apex` certificate, so this is a key-continuity risk (future APEX updates must use
   the same payload key), not a verified-boot bypass. Fix upstream (shared `keyDirectoryProblems`
   plus a descriptor field) or check `apex_payload.avbpubkey` against the signed printout by hand
   before each signing.
3. **Managed signing has missing pieces.** The AVB signing helper and the OTA payload signer are
   not in this repository; signapk needs a token that exposes keys without a PIN. See #661 D1.
4. `sign-aosp-release.mjs` and `aosp-release-record.mjs` have still only run against mocked
   releasetools; no real stallion target-files or APEX has been signed.

## Decisions for the owner

### D1 (A-01). Which Linux image host, and which Cuttlefish host packages?

Record the host and the exact `cuttlefish-base` and `cuttlefish-user` versions and SHA-256s in
`android/aosp/product.json` `hostPackages` (the last unset Cuttlefish inputs). Default: none
recorded. What it changes: Cuttlefish production staging is refused until both are set, and every
later Cuttlefish boot record must name the same packages. The 2026-10-25 development observation ran
on this workstation's local Cuttlefish; reusing it as the image host is possible only if its
packages are the ones recorded.

### D2. Managed or key-file image signing. Settled 2026-10-29: key files, in CI

H-01 is decided ([#661 D1](661-release-key-custody-ceremony.md#d1-h-01-where-do-the-release-keys-live-after-the-ceremony-decided-2026-10-29)):
the keys are GitHub Actions secrets, and signing happens in the draft `sign-image` job of
[drafts/661-release-signing.workflow.yml](drafts/661-release-signing.workflow.yml). That job
uses key-file mode (`--keys-dir` only). It decrypts the eleven image keys into tmpfs, sets them
to 0600, runs a `--dry-run` and then the real run, and shreds the keys. The managed options
(`--pkcs11-config`, `--avb-signing-helper`, `--payload-signer`,
`--payload-signer-signature-size 512`) stay available for a later move to custody B or C.

Open points the owner should know before enabling `sign-image`:
- Disk space on a hosted runner for the target-files zip plus otatools has not been checked.
- Releasetools has only run against mocks (`test/owner-sign-aosp-release-edges.test.mjs`).
- Input transport is [#661 D2](661-release-key-custody-ceremony.md#d2-how-do-unsigned-inputs-reach-the-ci-signing-job):
  a target-files zip may exceed the 2 GB release-asset cap, so a URL plus SHA-256 is the default.

### D3. Full or incremental OTA for the known-good release

The first release has no predecessor: sign a **full** OTA (no `--incremental-from`). Later
releases may add `--incremental-from <previous signed-target_files.zip>`. Default: full.

### D4. Same candidate for Pixel and Cuttlefish

H-23 must boot "the same candidate": the same Alpha commit, Eliza pin, distributable launcher APK
and descriptor. Recommendation: record those identities in the Cuttlefish boot record
(`docs/runbooks/templates/cuttlefish-boot-evidence.template.json`, field
`candidate.sameCandidateAsPixelSignedRelease`).

## Procedure

### 0. Before the image host (anyone, read-only)

```sh
node scripts/owner/production-staging-preflight.mjs           # expect only H-22/A-01 rows after #661
node --test test/aosp-release-signing.test.mjs test/pixel10a-gates.test.mjs test/owner-sign-aosp-release-edges.test.mjs
```

### 1. A-01 Cuttlefish pins (image host operator)

Fill `hostPackages` in `android/aosp/product.json` with the installed package versions and the
SHA-256 of each package file, in a reviewed change. Rerun the preflight.

### 2. H-21 Stage and build (image host operator)

Inputs: the distributable launcher APK and `apk-manifest.json` from #662, its reviewed launcher
descriptor, the qualified Sense listener APK and descriptor (H-20), the admitted stallion source
and the factory archive `stallion-cp3a.261005.005-factory-d1d25502.zip`.

```sh
git -C "$AOSP_SOURCE/build/soong" apply --check "$PWD/vendor/eliza/packages/os/android/patches/soong-app-native/soong-app-native.patch"
git -C "$AOSP_SOURCE/build/soong" apply "$PWD/vendor/eliza/packages/os/android/patches/soong-app-native/soong-app-native.patch"
npm run aosp:stage -- --target pixel10a --production \
  --applied-build-patch soong-app-native \
  --apk /absolute/launcher-release.apk --apk-manifest /absolute/apk-manifest.json \
  --descriptor /absolute/reviewed-launcher.json \
  --listener-apk /absolute/sense-release.apk --listener-descriptor /absolute/reviewed-listener.json \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --output /absolute/new-alpha-overlay
```

Add `--applied-systemui-patch chip` when the source carries the reviewed SystemUI listener chip.
Place the overlay under `vendor/alphaphone`, select `alpha_stallion_phone-cp2a-user` and build the
target-files package with the tree's normal tools. Keep `physical-product.json` (descriptor hash)
and record the **unsigned target-files SHA-256** in the build record.

### 3. H-22 Sign the image and the OTA (release owner)

Under the 2026-10-29 decision, this runs inside the CI `sign-image` job (D2). The commands
below are what that job does, and the manual equivalent on a trusted host if the owner ever
signs outside CI:

```sh
# key-file custody: decrypt into a new tmpfs directory, then tighten every file the job reads
node vendor/eliza/packages/os/scripts/android/decrypt-release-keys.ts --input <bundle> \
  --output /dev/shm/keys --passphrase-file /dev/shm/pass
chmod 600 /dev/shm/keys/*          # public certificates and avb_pkmd.bin too: the job requires 0600
node scripts/sign-aosp-release.mjs \
  --target-files /absolute/unsigned-target_files.zip --target-files-sha256 <from the build record> \
  --keys-dir /dev/shm/keys --releasetools /absolute/otatools/bin \
  --apk-manifest /absolute/apk-manifest.json --out /absolute/new-release-dir --dry-run
node scripts/sign-aosp-release.mjs ...same options without --dry-run
shred -u /dev/shm/keys/* /dev/shm/pass; rmdir /dev/shm/keys
```

Before the real run, compare `apex_payload.avbpubkey` in the key directory with the ceremony's
signed `fingerprints.json` printout (finding 2). The output directory holds
`signed-target_files.zip`, `ota.zip`, `avb_pkmd.bin` and `release-record.json`; the job prints
`NOT DISTRIBUTABLE` while drills or the known-good release are unset, which is expected here.

Record the known-good release in `android/aosp/pixel10a-ota-channel.json`
`recovery.knownGoodRelease` (`buildFingerprint`, `otaSha256`, `recordFile`) in a reviewed change,
and retain the signed release directory off-repo. `npm run human:status` H-22 must show `done`.

### 4. H-23 Boot the release candidate on Cuttlefish (image host operator)

Stage the Cuttlefish product with `--production` from the same candidate (D4), build, boot, then:

```sh
node scripts/verify-cuttlefish-launcher.mjs <options of the shared launcher image verifier>
```

It must show the system Alpha APK (not a `/data/app` override) as HOME, a recovery HOME and
enforcing SELinux. Fill `docs/runbooks/templates/cuttlefish-boot-evidence.template.json` into
`docs/evidence/cuttlefish-release-boot-<date>.json`, add a `level: "release"` entry to the
`cuttlefishBoot` gate and set it `passed`, then run
`node scripts/owner/evidence-class-check.mjs` and `node --test test/pixel10a-gates.test.mjs`.
This record never satisfies `physicalDevice`.

## Draft decision entries

```markdown
- **P-5x — A-01 ([#672](https://github.com/eliza-research/alphaphone/issues/672)), decided <YYYY-MM-DD>:**
  The Linux image host is <host>. Cuttlefish host packages: cuttlefish-base <version> (<sha256>),
  cuttlefish-user <version> (<sha256>), recorded in android/aosp/product.json. The first Pixel 10a
  release ships a full OTA. Policy only, not image evidence.
```

## Remaining human steps

1. #661 and #662 finished; H-20 listener qualified.
2. Image host operator: A-01 pins (D1), then H-21 staging and the `cp2a-user` build.
3. Release owner: H-22 signing (dry run first), record `knownGoodRelease`.
4. Image host operator: H-23 boot and the `cuttlefishBoot` gate.
5. Owner: decide whether to fix findings 1 and 2 in code (follow-up) or by the manual checks above.
