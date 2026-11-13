# Alpha developer guide

The complete build, test and release reference for Alpha. New here? Start with the
[README](../README.md) for a five-minute tour, then come back for the details.

The [PRD](prd.md) records product requirements; implementation and device
acceptance are separate.

`apps/app` owns the product renderer and registration. `android` owns product
packaging and installed identity. Shared runtime, native plugins and OS tooling
come from the exact `vendor/eliza` revision in `upstream.lock.json`. Make shared
changes upstream and consume a reviewed commit; never edit the vendor checkout.

## Setup

Use Bun 1.4.2 (`packageManager` in `package.json`), Node 26.13.0 for the pinned
upstream tools and Node-only host tests, and JDK 21.
Native builds need Android SDK platform 36 and build-tools 36.0.0. Set
`JAVA_HOME` and `ANDROID_HOME`; standard macOS SDK/JDK locations are also detected.

```sh
git clone --recurse-submodules https://github.com/eliza-research/alpha.git
cd alpha
bun install --frozen-lockfile
bun run verify
bun run dev
```

`bun run verify` runs deployment-output checks, source preparation, TypeScript, host tests,
the production web build and its bundle audit.
Host scripts use native TypeScript. `bun run typecheck:scripts` checks their interfaces.
Host contract tests need a JDK and the `sqlite3` command-line tool on `PATH`
for native Calendar queries. Archive builds check SQLite before verification.
Tests that load the real SDK require the pinned Bun and a prepared SDK; set
`ALPHA_REQUIRE_PREPARED_SDK=1` to fail instead of skipping when preparation is missing.

The Quint models and LemmaScript function proofs are not part of `bun run verify`. Run
`bun run quint:check`, `bun run quint:tests` and `bun run lemma:check` before merging a PR;
CI runs them only when `develop` is promoted to `main`. See [CONTRIBUTING.md](../CONTRIBUTING.md).
Function proofs require Dafny 4.11.0 on `PATH`; `LEMMA_REQUIRE_BACKEND=1` makes a
missing backend fail. A generation-only run records a skipped proof. Promotion CI installs the
hash-pinned backend and requires proofs.

A pull request runs one CI job, `bun run verify`. The Android build also runs when a pull
request changes Android, renderer, script, lockfile or upstream-pin paths. The browser tests
are not run by PR CI: run `bun run test:browser` and `bun run test:browser:production` before
finalising a PR and say so in its description. CI runs them with the formal models when
`develop` is promoted to `main`.

On a heavily loaded machine, `ALPHA_TIMEOUT_SCALE=3` (1–10) lengthens subprocess
deadlines for refinement, host JVM fixtures and LemmaScript, and Playwright server
startup. CI uses 1. Dafny's per-proof limits and the update deadlines measured by
fixtures stay the same.

## Development

```sh
bun run dev                       # local agent and renderer
bun run dev:ui                    # renderer only
bun run dev:cloud                 # genuine account-bound Cloud development
bun run test:browser              # Chromium, development surfaces enabled
bun run test:browser:production   # production bundle
```

The web build is a development preview and the payload packaged into the APKs.
Production builds start with live, empty or unconnected states. Mock data,
fixtures and developer controls require exactly `ELIZA_DEV_ALLOW_TEST_MOCKS=1`.
`bun run dev`, Playwright and explicit test-mocks builds enable this switch.
Add `?tools=1` to an enabled development server to show developer controls;
the query cannot enable them in production or on Android.

`bun run dev:cloud` uses a local resident with real Cloud sign-in and service
requests. Its default URL is `http://127.0.0.1:5318`.
`ALPHA_CLOUD_ENVIRONMENT=staging` explicitly selects staging. Private account and
resident profiles live under `~/.local/share/alphaphone/`. Existing accounts,
credentials and histories are not copied or reset.

### Standalone Cloud (development)

Distributed builds use the Cloud in `scripts/cloud-deployment-policy.ts` (Eliza Cloud
today). The product's own Cloud is being prepared; see `docs/standalone-cloud-plan.md`.

```sh
bun run cloud:local -- prepare                              # export the pinned upstream source and install it (slow, once per pin)
ELIZA_DEV_ALLOW_TEST_MOCKS=1 bun run cloud:local -- start   # Steward, Cloud API and a TLS front door on https://127.0.0.1:8787
ELIZA_DEV_ALLOW_TEST_MOCKS=1 bun run cloud:local -- check   # email-code sign-in, credential, account, entitlement, revocation
```

The local Cloud runs from the pinned `vendor/eliza` source with Alpha's own tenant,
client registration, entitlement key and service documents. It lives in
`~/.cache/alphaphone-local-cloud` (`--dir` or `ALPHA_LOCAL_CLOUD_DIR` to change) and
never contacts a deployed Cloud. `check` fails if any answer names an Eliza Cloud
host. A pass is a local source-build result only, not a deployed Cloud, an APK or a
device result.

`ALPHA_CLOUD_DEPLOYMENT_FILE=<file.json>` points the build and operator tools at a
candidate Cloud (the same `production` and `staging` rows as the policy). Run
`bun scripts/cloud-deployment.ts` with it set to regenerate the authorities. A
candidate build has its own credential namespace, and the production bundle audit
refuses it.

`cloud/` holds the product Cloud's data: `policy.example.json` (the same rows the app
is built with) and `resources.example.json` (the operator's Cloudflare ids). There is
no route code here.

```sh
bun run cloud:worker -- check --policy cloud/policy.example.json --resources cloud/resources.example.json \
  --upstream <upstream checkout with packages/cloud/deploy> --out <dir>
```

This renders the Worker configuration and bundles it with `wrangler deploy --dry-run`.
Nothing is deployed, and it needs an upstream revision that carries the deployment
tool, which is not merged upstream yet.

## Android builds

```sh
bun run android:build:inputs       # report missing build inputs
bun run android:build:local        # prepare, build worker, stage runtime and build
bun run android:verify            # inspect APK contents and signatures
```

The build produces standalone and launcher, debug and release APKs under
`artifacts/`. The variants share `ai.alphacompute.alphaphone` and can replace one
another with an admitted version and signer. The launcher declares HOME.
Phone, Contacts and SMS/MMS require an admitted AOSP image capability.

Alpha Compute builds use the same ID for the installed package and native
namespace. The retained Pixel v44 uses the former package ID. Android
installs the new package separately, with its own private data, Keystore,
permissions and roles. Establish a fresh baseline on each distribution form,
then verify updates and data retention between builds with the new package ID.
Qualify the native libraries and APKs for the exact product and SDK revisions.

There is one runtime profile. Every build packages libelizainference with the
on-device speech models and local embeddings. Stage on-device voice inputs with
`bun scripts/android-stage-voice-models.ts --from <directory>`.
The resident source and workflow worker are prepared from the locked upstream
revision. Build inputs must agree with the staged runtime and native libraries.

Speech is routed at run time, not at build time: the owner's Cartesia key when
their own provider is selected, Eliza Cloud speech when signed in to Cloud with
no plan limit in force, otherwise on-device speech. A Cloud or provider speech
request that fails before audio plays falls back to on-device speech.

Developer APKs may explicitly omit the runtime:

```sh
bun run agent:prepare -- --source-only
bun run android:build -- --allow-unpackaged-runtime
bun run android:build -- --test-mocks --allow-unpackaged-runtime
```

Test-mocks APKs go to `artifacts/test-mocks/`. Production Android builds remove
mock flags from child environments. `scripts/audit-production-bundle.ts` checks
the web output and APK assets for developer code, fixtures and source maps.

Release signing uses `ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`,
`ELIZAOS_KEY_ALIAS` and `ELIZAOS_KEY_PASSWORD`. Without signing inputs, release
outputs are unsigned. `ELIZAOS_VERSION_CODE` and `ELIZAOS_VERSION_NAME` override
versions from `app.config.json`. Keep signing secrets outside the repository.

The upstream consumer-host generator creates the ignored Gradle host from
`android/consumer-host.json`. Run `bun run android:host` before direct Gradle or
Android Studio use. Edit the descriptor and `android/app/product.gradle` for
product build configuration. Dependency checksums remain in
`android/gradle/verification-metadata.xml`; regenerate and review them with
`bun run android:deps:write-verification` after dependency changes.

## Device and image tooling

```sh
bun run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN
bun run aosp:stage -- --apk artifacts/launcher-debug.apk --development
bun scripts/verify-aosp-listener.ts --serial <serial> --user 0
```

Instrumentation uses an owned disposable emulator. Image staging emits an AOSP
vendor add-on under `artifacts/aosp/`. APK builds, emulator HOME-role behavior,
full AOSP boot, real integrations, physical-device testing and user acceptance
are independent results.

The listener verifier reads the installed package grants, privapp enforcement,
and the running listener's SELinux domain. Pass `--launcher-descriptor` with
the reviewed launcher descriptor when the image provisions a privileged launcher.

Pixel 10a Sense images take `--listener-apk`, `--listener-descriptor` and
`--listener-qualification`. Enroll the reviewed qualification file's SHA-256 as
`listenerQualificationSha256` in `android/aosp/pixel10a-product.json`. The record
binds the exact signed APKs, staging descriptors, signer, SDK, source inventory,
applied patches and SELinux policy. Apply and name the `chip`, `ops`, `alpha-protected-power` and
`alpha-sense-policy` patches in addition to `soong-app-native`.

An enrolled record with `qualified: false` stages only with `--development`,
using the signed inputs and the Pixel 10a `userdebug` target. Production staging
requires `qualified: true` and passing evidence digests for G1–G7. Keep the
candidate, signed release and physical acceptance receipts with their exact builds.

`scripts/deliver-app-update.ts` publishes an admitted signed launcher APK and
checks anonymous readback. Merging source does not publish an application update.
New builds read the `app-stable-alphacompute` release. The previous package
reads `app-stable`. Publication keeps each package on its own release and
checks retained versions on both. Android may require installation confirmation.
New builds use the live `eliza-research/alpha` URL. Previously issued
`eliza-research/alphaphone` GitHub release URLs use its redirect.
Protected release jobs check the immutable repository and owner IDs and bind
dispatches to the reviewed commit on `main`. The
release owner applies the reviewed workflow reference allowlist in
[`scripts/ci/private-artifact-identity.json`](../scripts/ci/private-artifact-identity.json)
to the existing Workload Identity Federation provider before protected signing
or publication uses private artifact storage.

On both sideloaded and image-preinstalled phones, check the update controls in
**Settings → General** before distributing the unit. If **Allow automatic
updates** appears beside **Check for updates**, use it to open Android's
permission page and let the owner choose **Allow from this source** for Alpha.
On return, Alpha rereads the permission. This setup works before an update is
offered.

An automatic attempt that loses idle HOME after verifying its APK can retain
that one file for a later attempt in the same process. Reuse checks the complete
bytes and current package, version, variant and signer again. A process restart
discards the cache hint; the durable installer journal still owns recovery.

Main pushes automatically build unsigned native candidates in the existing
Resident Android workflow. The separate `app-native-candidate-*` artifact holds
the genuine distribution archive and `app-update-candidate.json`, which binds
source, SDK, run/attempt, profile, channel and actual APK hashes. Test-mocks stay
in the qualification archive. Each main-push run and its reruns share a group
keyed by run ID. Builds can complete out of order, so select the successful
candidate for the reviewed source commit.

Before enabling a successful automatic build, a maintainer supplies
`android/hosted-native-inputs.json` in the reviewed checkout. Use these exact
fields and replace every placeholder with the reviewed value.

```json
{
  "schema": "alpha-hosted-native-inputs/v1",
  "packageName": "ai.alphacompute.alphaphone",
  "sdkCommit": "<upstream.lock.json commit>",
  "voiceRecordSha256": "<SHA-256 of android/voice-host/qualified-voice-host.json>",
  "embeddingRecordSha256": "<SHA-256 of android/embedding-host/qualified-host.json>",
  "artifacts": {
    "voice": {"id": "<artifact ID>", "sha256": "<archive SHA-256>"},
    "embeddingComponent": {"id": "<artifact ID>", "sha256": "<archive SHA-256>"},
    "embeddingQualification": {"id": "<artifact ID>", "sha256": "<archive SHA-256>"}
  }
}
```

Use three distinct, unexpired GitHub Actions artifact IDs from successful runs
in this repository. Use the artifact metadata's digest without its `sha256:`
prefix. The voice artifact contains the reviewed model, data and notice files at
`assets/paradee-voice/v1/<path>` and the two recorded libraries per ABI at
`jniLibs/<abi>/<name>`. Upload those files with their relative paths and omit
generated manifests, APKs and logs. The embedding component contains
`component-output/INTENT.json`, `component-output/export/PREPARATION.json` and
the three reviewed ARM64 libraries alongside the preparation receipt. The
qualification artifact contains `QUALIFICATION.json` and
`embedding-qualification.json` at its root. These receipts must describe those
same reviewed component bytes. The two hosts share the exact ARM64 engine and
C++ runtime. Obtain the recorded bytes from the provisioned host or review and
admit a reproducible replacement before updating the records and artifact IDs.

On the provisioned host, prepare an operator handoff from the reviewed Alpha
checkout. Use physical paths and an existing output directory owned and
writable only by your account.

```sh
python3 -B scripts/ci/export-native-inputs.py \
  --voice /absolute/staged-voice-root \
  --embedding-component /absolute/directory-containing-component-output \
  --embedding-qualification /absolute/directory-containing-qualification-files \
  --out /absolute/output-directory
```

The exporter creates `alpha-native-inputs.zip` after verifying the copied
files against the committed records and existing embedding qualification.
The component receipts preserve their original build provenance and paths.
Record the packet SHA-256 on the producer host and supply it with the handoff.
On the receiving host, set `packet_sha256` to that digest. Choose a fresh
destination inside a directory owned and writable only by your account.

```sh
python3 -B scripts/ci/stage-native-input-packet.py \
  --packet /absolute/alpha-native-inputs.zip --sha256 "$packet_sha256" \
  --out /absolute/private/new-staging-directory
```

The receiver checks the complete ZIP, member hashes and qualification evidence
against the package, SDK, voice and embedding records in the reviewed checkout
before publishing the staged directory. Keep its original `packet.json`.
After approval for transfer and redistribution, upload the contents of
`voice/`, `embedding-component/` and `embedding-qualification/` as three
separate artifacts. Record their GitHub artifact IDs and archive digests in
the hosted manifest. Signed-in users with read access can download Actions
artifacts from the repository. [GitHub artifact access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)

Run `python3 -B scripts/ci/hosted-native-inputs.py --check` to validate the
manifest against the checkout without downloading. Automatic runs check the
three pins against GitHub metadata before setting up the Android toolchain.
The check names each unavailable input and reports the expiry of admitted pins
so the maintainer can renew them before a build fails. Acquisition checks the
metadata again and verifies the exact archive bytes through the workflow's
read-only token. The build stages with the existing voice and embedding tools
and retains the input IDs, hashes and sizes in `native-input-admission.json`.
The candidate receipt binds its digest to the exact source, SDK and run attempt.
The build evidence records the uploaded candidate's ID and compressed size
from GitHub, expanded file bytes, and both unsigned APK hashes and sizes.
The expiry workflow on the default branch checks `main` on schedule and on
manual dispatch from `develop`. A manual dispatch from `main` checks the
selected commit. Its summary records the inspected revision and identifies
pins expiring within four days. Renew the artifact IDs and digests while the
old inputs remain available. Retain qualification receipts for identical
files and review changed native bytes or source records before admission.
The candidate archive retains the distribution producer evidence before
the test-mocks build can replace it.

The existing workflow run number is the candidate versionCode, checked against
both releases' retained APKs and public pointers, and the committed version floors.
Failed or canceled runs consume their number. A manual release or workflow
migration that exceeds this number stops candidate creation and needs a reviewed
version migration. Manual builds keep their explicit version input.

To prepare a candidate for protected signing, set `artifact_id` to the numeric
ID of the `app-native-candidate-*` artifact from a successful main-push run.
From the reviewed checkout, fetch it into a new file. The command checks the
producer attempt and archive limits before download, verifies the ZIP digest
and producer evidence, and writes the mirror request. Keep the three-day
candidate artifact available through signing admission. If a downstream job
failed after upload, rerun all jobs to obtain a candidate bound to the new
attempt.

```sh
python3 -B scripts/ci/admit-cloud-signing-input.py fetch-candidate \
  candidate.zip "$artifact_id" > mirror-request.json
```

An authorized storage operator copies those exact bytes to the private object
named in `mirror-request.json`. Use a generation-match precondition of zero to
create the object only if no live generation exists. [Cloud Storage preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions#the_0_value_in_a_generation-match_precondition)

```sh
mirror_uri=$(jq -er '"gs://" + .mirror.bucket + "/" + .mirror.object' mirror-request.json) &&
gcloud storage cp candidate.zip "$mirror_uri" --if-generation-match=0 --print-created-message
```

Set `mirror_generation` to the generation in the created object's versioned
URL. If the object already exists, inspect its generation and verify its bytes
before reusing it. Read back the generation-qualified object and compare it to
the original ZIP. After the comparison succeeds, create the reviewable plan
with a fresh 32-character lowercase hexadecimal delivery ID. [Cloud Storage object versions](https://docs.cloud.google.com/storage/docs/using-versioned-objects)

```sh
gcloud storage cp "$mirror_uri#$mirror_generation" candidate-readback.zip &&
cmp candidate.zip candidate-readback.zip &&
delivery_id=$(openssl rand -hex 16) &&
python3 -B scripts/ci/admit-cloud-signing-input.py prepare-candidate \
  candidate.zip "$artifact_id" --input-generation "$mirror_generation" \
  --delivery-id "$delivery_id" > signing-plan.json
```

Review the plan and retain its exact bytes. The release operator dispatches
protected signing on `main` with the exact reviewed `workflow_commit` and
`signing-plan.json` as the `signing_plan` input. Preflight checks the official
Actions ZIP. The protected job checks the same run attempt and artifact again,
then stages the pinned private generation before accessing the signing key.
[Protected signing workflow](../.github/workflows/release-cloud-app-signing.yml)

For publication, set `delivery_artifact_id` to the numeric ID of the original
`private-cloud-apk-delivery-*` artifact from the successful signing attempt.
Save its ZIP.

```sh
gh api "repos/eliza-research/alpha/actions/artifacts/$delivery_artifact_id/zip" > delivery.zip
```

Read `private-storage-receipt.json` from the ZIP and confirm its
bucket and object match the signed destination in the reviewed plan. An authorized
operator sets `signed_uri` to the receipt's `gs://BUCKET/OBJECT#GENERATION` and
retrieves that generation.

```sh
gcloud storage cp "$signed_uri" signed.tar
```

Complete Cartesia qualification on each exact signed APK. Record a content-free
`alpha-cloud-voice-qualification-v1` JSON receipt with two `results` rows. Each
row names the observed `apkSha256`, `provider` and `outcome`, and records the
observed booleans in `checks` for `consent`, `session`, `acousticInput`,
`blueBar`, `transcript`, `audibleSpeakerReply`, `mute`, `unmute` and
`stopReleased`. Record only the check outcomes and omit transcripts, recordings
and credentials. The workflow admits passing Cartesia checks for both APKs.

Set `publication_commit` to the exact reviewed commit currently on `main`.
Prepare the qualification using the original plan bytes and the reviewed voice
receipt. The command checks the official signing attempt and delivery ZIP,
streams both APKs from the local signed TAR and retains the original evidence bytes.

```sh
python3 -B scripts/ci/qualified-app-update.py prepare-qualification \
  --signing-plan signing-plan.json --voice-evidence cartesia-voice.json \
  --signed-tar signed.tar --delivery-zip delivery.zip \
  --delivery-artifact-id "$delivery_artifact_id" --workflow-commit "$publication_commit" \
  > qualification.json
```

Review `qualification.json` and supply it as the protected workflow's
`qualification` input with the reviewed `workflow_commit`. Complete both
admissions before the one-day signing delivery receipt expires. The protected
job restores the same private mirror and exact signed output before publication.
[Qualified publication workflow](../.github/workflows/publish-qualified-app-update.yml)

The existing reviewed Cloud producer routes remain available for their
approved package and profile.

The native route keeps the 1.5 GB limit on the producer ZIP and signed TAR.
The two unsigned APKs and the two debug APKs each have a separate 1.5 GB
expanded pair limit. Admission checks exact member lengths against the
reviewed archives and verifies the APK digests when streaming the bytes.

Release approval, signed-byte voice tests, publication and both sideload and
image-preinstalled phone drills remain required for this batch.

On the machine with the phone, keep each version's `apk-manifest.json` from its
`qualified-launcher-publication-<run>-<attempt>` artifact beside the exact
signed `launcher-release.apk`. If you download the public APK asset, save it
under that filename. For the baked launcher, use the post-signing manifest for
the exact APK in the image. Both wireless captures verify the installed bytes
against the reviewed `android/release-signer.json` policy, including for
versions already recorded as released. The [wireless drill](https://github.com/eliza-research/alpha/issues/889)
requires Android 14 or later for package installer provenance. Keep the phone
offline from baseline installation through HOME selection, any one-time Android
installation permission, and the `before` capture. Keep the host online and
connect the phone by USB. The host verifies the anonymous offer and its APK
while the phone is still offline. For the update, keep the screen unlocked and
leave Alpha idle in the foreground. Allow one full 15-minute check interval
plus download time.

```sh
bun scripts/verify-wireless-launcher-update.ts before --serial <serial> \
  --distribution sideload --apk-manifest <baseline>/apk-manifest.json --out <new-before.json>
# Disconnect USB/ADB, restore the phone's network, and return to idle HOME.
# Let Alpha discover and install the update. Reconnect after the observed result.
bun scripts/verify-wireless-launcher-update.ts after --serial <serial> \
  --before <before.json> --apk-manifest <update>/apk-manifest.json --out <new-after.json>
```

Repeat with `--distribution image-preinstalled` while the baked launcher is
active on the locked Pixel 10a. For its first `before` capture also pass
`--image-release-record <release-record.json>` and
`--image-vbmeta-digest <digest>`. On the image build host, verify the signed
target-files ZIP against the release record. Extract `IMAGES/vbmeta.img`
and the recorded chained partition images together, then calculate the digest
with `avbtool calculate_vbmeta_digest --hash_algorithm sha256 --image <vbmeta.img>`.
The capture compares the installed launcher, build fingerprint and chained
VBMeta digest to the reviewed image. After replacement the active APK must
reside in Android's app data and retain its system-app provenance.

Start each distribution chain with fresh v2 receipts. Keep the first drill
signed out. For the signed-in follow-up, seed the account and data before the
next offer goes live, take the phone offline, then use
`before --previous <first-after.json>` with the same distribution and the
previous release's APK manifest. This binds both drills to the same phone,
image, HOME and launcher history. Keep each public offer stable until both
distribution paths have saved their `after` receipts.

Capture `after` as soon as the disconnected update completes, before reboot.
It needs one matching completed Android PackageInstaller session that identifies
Alpha as the installer for the primary user, records automatic installation
and shows no manual approval. Missing or ambiguous history prevents a receipt.
Retain the protected `qualification-summary.json`, `app-update-delivery.json`
and verification manifest with each published APK, and the signed image's
`release-record.json` with its baseline. Record the observed hands-free update
and the separate data, Keystore, resident, voice and recovery checks.

After both rounds, compare the eight receipts offline. For each distribution
supply the first before/after pair followed by the second before/after pair.

```sh
bun scripts/verify-wireless-launcher-update.ts matrix \
  --sideload stock-1-before.json --sideload stock-1-after.json \
  --sideload stock-2-before.json --sideload stock-2-after.json \
  --image-preinstalled image-1-before.json --image-preinstalled image-1-after.json \
  --image-preinstalled image-2-before.json --image-preinstalled image-2-after.json \
  --out wireless-launcher-matrix.json
```

The matrix checks the receipt links, signing family, installed SDK revision
and the same two offered releases across both distributions. It reads the saved
receipts offline, so the public channel may already have advanced.

The remaining release work is tracked in [native promotion #888](https://github.com/alphacompute/alphaphone/issues/888)
and [wireless launcher acceptance #889](https://github.com/alphacompute/alphaphone/issues/889).
Complete it in this order:

1. Admit native voice inputs for the exact SDK, then build and sign both
   distribution variants. Preserve advancing versions and the enrolled signer.
   The protected [release custody workflow](../.github/workflows/release-custody-proof.yml)
   exports the verified public certificates and fingerprints under
   `artifacts/release-public-identities/` for enrollment.
2. Register `ai.alphacompute.alphaphone` in production and staging. Run
   `bun scripts/cloud-readiness.ts registration --environment <environment>`
   to print each environment's operator inputs. Keep the existing
   `/alphaphone/auth/callback` URLs and entitlement audience.

   - In `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON`, replace the former Alpha row's
     `clientId` with `ai.alphacompute.alphaphone`. Keep its active, approved
     app UUID, exact callback, and other settings. Preserve all other rows.
     Cloud requires unique app UUIDs and callback URLs, so this change switches
     new sign-ins on that environment from the old app to the new one. Run the
     Cloud **Mobile App Auth Registration Admin** workflow in diagnose
     mode for the new client. Use repair mode if diagnosis finds a missing
     approved app binding. Verify the callback remains on that environment's
     Steward redirect allowlist.
   - For native Google sign-in, create an Android OAuth client for the new
     package and admitted release certificate SHA-1 in the Google Cloud
     project for Steward's web client. Add it under `alpha-phone` in
     `STEWARD_GOOGLE_NATIVE_CLIENT_IDS`. Keep any active Android client IDs.
   - Add the new package and its release certificate SHA-256 to the production
     `ELIZA_ANDROID_ASSET_LINKS_JSON`. Generate the merged value with
     `bun scripts/render-assetlinks.ts --cloud-config --published https://eliza.app/.well-known/assetlinks.json`.
     Preserve existing grants and other products' entries. Deploy and verify
     the published file with `bun scripts/render-assetlinks.ts --check <web-origin>/.well-known/assetlinks.json`.
   - Use `bun scripts/cloud-deployment.ts --pages-registration` to update
     Alpha's entry in the protected Cloud release Environment variable
     `ELIZA_NATIVE_AUTH_CALLBACKS_JSON` for production and staging. Keep one
     entry per callback URI and preserve the other products' entries. Verify
     the new Android target in the deployed Pages
     callback page, run `bun scripts/cloud-readiness.ts probe --environment <environment>`,
     then complete sign-in on the intended APK. Test with the new package
     selected to open its supported links if the old package is also installed.
     [Cloud registration #666](https://github.com/alphacompute/alphaphone/issues/666),
     [App Links #670](https://github.com/alphacompute/alphaphone/issues/670).

   For a debug-signed Pixel, use an explicit `--test-mocks` APK on an owned
   test device and select **Staging** in **Subscription gate QA**. The staging
   App Links filter is part of that build. Use the staging URL
   `https://staging.eliza.app/.well-known/assetlinks.json` and pass
   `--keep-fingerprint <debug-SHA256>` to the asset-link config generator.
   For native Google sign-in, add the package and that signer's SHA-1 in
   the staging Steward project. After deploying, run
   `bun scripts/cloud-readiness.ts probe --environment staging --signer <debug-SHA256>`.
   The staging phone flow ends at plan admission. For production Cloud acceptance
   on the Pixel, use the admitted release APK. Android requires a separate device
   or fresh installation when the installed copy uses an incompatible signer.
3. Qualify the exact signed baseline and establish it on both distribution
   paths before exposing the phones to a newer offer. If using
   `scripts/provision-unit.ts`, provision before recording the baseline's version
   as the release floor. Qualify and publish the first advancing launcher
   on `app-stable-alphacompute`, verify anonymous full-byte readback, and run
   #889 on the machine with the phone. Complete both captures before publishing
   the next advancing release for the follow-up.
   The update itself must use the phone's channel; `scripts/pilot-update.ts` uses
   `adb install -r` and supplies separate in-place replacement evidence.
4. Before distributing the batch, verify wireless replacement, retained data and
   Keystore, HOME, voice and recovery after interruption and process death.
   API 36 fixture results do not qualify the Android 17 image or a physical phone.

OS OTA is a separate A/B image path. The shared updater is staged disabled;
keep `os_update_enabled` false until signed image, channel, trust, SELinux,
engine and physical recovery gates pass. Resolve
[cache retention #890](https://github.com/alphacompute/alphaphone/issues/890)
and [applied-candidate recovery #891](https://github.com/alphacompute/alphaphone/issues/891)
before enrollment. [#400](https://github.com/alphacompute/alphaphone/issues/400)
tracks the overall release gate. A successful host test or model does not close
these release and device gates. Alpha consumes the reviewed rejected-download
retry repair [eliza#39235](https://github.com/elizaOS/eliza/pull/39235) and the
reviewed Maps and speech changes through [eliza#39255](https://github.com/elizaOS/eliza/pull/39255)
and the Maps opening view from [eliza#39408](https://github.com/elizaOS/eliza/pull/39408).
The current pin includes [native Android sign-in recovery and renewal](https://github.com/elizaOS/eliza/pull/39445)
and [reproducible native browser resource generation](https://github.com/elizaOS/eliza/pull/39450).
It also includes the [selected-tab permission](https://github.com/elizaOS/eliza/pull/39423),
[prepared speech](https://github.com/elizaOS/eliza/pull/39424), [download publication](https://github.com/elizaOS/eliza/pull/39425),
[held update offer](https://github.com/elizaOS/eliza/pull/39440) and [updater scratch storage](https://github.com/elizaOS/eliza/pull/39446) changes
and [bounded secure-store allocations](https://github.com/elizaOS/eliza/pull/39461)
at `37af7168b139b92f9e3b978546c97fb3e61870dc` on upstream develop. This
also consumes the reviewed [Bun and ABI cleanup](https://github.com/elizaOS/eliza/pull/39420),
[Cloud, Files and Sense fixes](https://github.com/elizaOS/eliza/pull/39444),
[Calendar provider timestamps](https://github.com/elizaOS/eliza/pull/39467),
[owner-clock scheduling](https://github.com/elizaOS/eliza/pull/39470) and
[model-generated morning summaries](https://github.com/elizaOS/eliza/pull/39471).
The native engine gitlink is unchanged, but the producer scripts and package
manifests differ from the retained `c9247e6966` native records. Those records
remain attributed to their original inputs; no new native build or qualification
is claimed. Strict embedding admission refuses this producer drift, and the
reviewed voice outputs remain unavailable. Rebuild and qualify both distribution
variants from the exact current inputs before distribution or OS enrollment.

The protected [preserving OS OTA signing workflow](../.github/workflows/release-os-ota-signing.yml)
signs only an admitted OTA package with the existing release key. Its committed
`android/signing/ota-tools.json` currently has `reviewedTargets: []`: validation,
private input downloads and signing remain disabled before signing keys are read.
Enabling a target requires an independently reviewed record binding its exact
target-files SHA-256, producer source commit, SDK commit, fingerprint and build
timestamp together. APK signer-map paths and AVB configuration paths alone do
not establish the identities embedded in an image; review the exact target's
APK, APEX and boot signing identities and producer lineage before committing
that record. A qualified tools archive does not admit a target image. This
operator does not enable OS enrollment or establish device acceptance.

## Generated files

Build output belongs in ignored `web-dist/`, `artifacts/`, `test-results/` and
`.eliza/` directories. Android host and Capacitor sync output are ignored too.
Cloud deployment source is `scripts/cloud-deployment-policy.ts`; regenerate its
renderer and Android bindings with `bun scripts/cloud-deployment.ts`.
`bun scripts/cloud-deployment.ts --pages-registration` prints the public Pages
callback registration for an operator without creating a `config/` directory.
