# Alpha Phone (alphaphone)

Alpha Phone is an Android application with a locally resident Eliza agent.
Eliza Cloud supplies managed inference, subscriptions, Gmail, optional Google
Calendar and Maps services. The [PRD](docs/prd.md) records product requirements;
implementation and device acceptance are separate.

`apps/app` owns the product renderer and registration. `android` owns product
packaging and installed identity. Shared runtime, native plugins and OS tooling
come from the exact `vendor/eliza` revision in `upstream.lock.json`. Make shared
changes upstream and consume a reviewed commit; never edit the vendor checkout.

## Setup

Use Node 26.13.0 (`.nvmrc`), Bun 1.4.2 for resident-agent preparation, and JDK 21.
Native builds need Android SDK platform 36 and build-tools 36.0.0. Set
`JAVA_HOME` and `ANDROID_HOME`; standard macOS SDK/JDK locations are also detected.

```sh
git clone --recurse-submodules https://github.com/eliza-research/alpha.git
cd alpha
npm ci
npm run verify
npm run dev
```

`npm run verify` runs deployment-output checks, source preparation, executable
Quint models, LemmaScript function proofs, TypeScript, host tests, the production web build and its bundle audit.
Host scripts use native TypeScript. `npm run typecheck:scripts` checks their interfaces.
Host contract tests need a JDK and the `sqlite3` command-line tool on `PATH`
for native Calendar queries. Archive builds check SQLite before verification.
Tests that load the real SDK require the pinned Bun and a prepared SDK; set
`ALPHA_REQUIRE_PREPARED_SDK=1` to fail instead of skipping when preparation is missing.
Function proofs require Dafny 4.11.0 on `PATH`; `LEMMA_REQUIRE_BACKEND=1` makes a
missing backend fail. A generation-only run records a skipped proof. CI installs the
hash-pinned backend and requires proofs. `npm run quint:changed -- --base=<commit>`
also model-checks changed models and their importing compositions, including their
declared temporal checks and required historical counterexamples.

## Development

```sh
npm run dev                       # local agent and renderer
npm run dev:ui                    # renderer only
npm run dev:cloud                 # genuine account-bound Cloud development
npm run test:browser              # Chromium, development surfaces enabled
npm run test:browser:production   # production bundle
```

The web build is a development preview and the payload packaged into the APKs.
Production builds start with live, empty or unconnected states. Mock data,
fixtures and developer controls require exactly `ELIZA_DEV_ALLOW_TEST_MOCKS=1`.
`npm run dev`, Playwright and explicit test-mocks builds enable this switch.
Add `?tools=1` to an enabled development server to show developer controls;
the query cannot enable them in production or on Android.

`npm run dev:cloud` uses a local resident with real Cloud sign-in and service
requests. Its default URL is `http://127.0.0.1:5318`.
`ALPHA_CLOUD_ENVIRONMENT=staging` explicitly selects staging. Private account and
resident profiles live under `~/.local/share/alphaphone/`. Existing accounts,
credentials and histories are not copied or reset.

## Android builds

```sh
npm run android:build:inputs       # report missing build inputs
npm run android:build:local        # prepare, build worker, stage runtime and build
npm run android:verify            # inspect APK contents and signatures
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
`node scripts/android-stage-voice-models.ts --from <directory>`.
The resident source and workflow worker are prepared from the locked upstream
revision. Build inputs must agree with the staged runtime and native libraries.

Speech is routed at run time, not at build time: the owner's Cartesia key when
their own provider is selected, Eliza Cloud speech when signed in to Cloud with
no plan limit in force, otherwise on-device speech. A Cloud or provider speech
request that fails before audio plays falls back to on-device speech. The
`--runtime-profile` and `--local-embeddings` options are gone; the scripts
refuse them with a one-line message.

Developer APKs may explicitly omit the runtime:

```sh
npm run agent:prepare -- --source-only
npm run android:build -- --allow-unpackaged-runtime
npm run android:build -- --test-mocks
```

Test-mocks APKs go to `artifacts/test-mocks/`. Production Android builds remove
mock flags from child environments. `scripts/audit-production-bundle.ts` checks
the web output and APK assets for developer code, fixtures and source maps.

Release signing uses `ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`,
`ELIZAOS_KEY_ALIAS` and `ELIZAOS_KEY_PASSWORD`. Without signing inputs, release
outputs are unsigned. `ELIZAOS_VERSION_CODE` and `ELIZAOS_VERSION_NAME` override
versions from `app.config.json`. Keep signing secrets outside the repository.

The upstream consumer-host generator creates the ignored Gradle host from
`android/consumer-host.json`. Run `npm run android:host` before direct Gradle or
Android Studio use. Edit the descriptor and `android/app/product.gradle` for
product build configuration. Dependency checksums remain in
`android/gradle/verification-metadata.xml`; regenerate and review them with
`npm run android:deps:write-verification` after dependency changes.

## Device and image tooling

```sh
npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN
npm run aosp:stage -- --apk artifacts/launcher-debug.apk --development
node scripts/verify-aosp-listener.ts --serial <serial> --user 0
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
New builds use the canonical `eliza-research/alpha` URL. Previously issued
GitHub release URLs rely on the redirect from the former repository name.
Protected release jobs check the immutable repository and owner IDs. The
release owner applies the reviewed workflow reference allowlist in
[`scripts/ci/private-artifact-identity.json`](scripts/ci/private-artifact-identity.json)
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
in the qualification archive. Each main-push run has its own concurrency group,
including its reruns, so an older push queued later cannot cancel a newer one.
GitHub can complete builds out of order. Select the successful candidate for the
reviewed source commit. Each build needs runner capacity and admitted native inputs.

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
Record the packet SHA-256 on the provisioned host. On the receiving host, use
the reviewed Alpha checkout and the digest supplied by the producer.

```sh
python3 -B scripts/ci/stage-native-input-packet.py \
  --packet /absolute/alpha-native-inputs.zip --sha256 "$packet_sha256" \
  --out /absolute/new-staging-directory
```

The command verifies the packet against the committed package, SDK, voice
and embedding records before creating the output directory. Keep its original
`packet.json` with the handoff. Once the owner approves the transfer and
redistribution, upload the contents of `voice/`, `embedding-component/` and
`embedding-qualification/` as three separate artifacts through the approved
path. Use the resulting GitHub artifact IDs and archive digests in the hosted
manifest. Signed-in readers can download Actions artifacts from the public
Alpha repository.
[GitHub artifact access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)
· [Artifact custody #978](https://github.com/eliza-research/alpha/issues/978)

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
Install the Launcher OTA native input expiry workflow on the repository's
default branch, currently `develop`, after the expiry checker lands on `main`.
Scheduled runs read the reviewed pins on `main`. Manual dispatch from
`main` checks the commit selected at dispatch. Each run records the exact
`main` commit checked and names each pin that expires within four days.
Renew through the approved supplier while the old artifacts are available.
Keep the original qualification receipts for unchanged native bytes and review
the new artifact IDs and archive digests before updating the manifest. A changed
native file or source record requires a new admission. Confirm a successful
automatic candidate at the replacement pins before recording the rollover.
The candidate archive retains the distribution producer evidence before the
test-mocks build can replace it.

The existing workflow run number is the candidate versionCode, checked against
both releases' retained APKs and public pointers, and the committed version floors.
Failed or canceled runs consume their number. A manual release or workflow
migration that exceeds this number stops candidate creation and needs a reviewed
version migration. Manual builds keep their explicit version input.

To prepare a candidate for protected signing, set `artifact_id` to the numeric
ID of the `app-native-candidate-*` artifact from a successful main-push run.
Use the reviewed checkout to check the exact producer attempt, archive size,
and digest before downloading. The command verifies the ZIP and its producer
evidence before making it available at the requested path. The candidate is
retained for three days and must remain available through signing admission.
If a downstream job failed after the candidate uploaded, rerun all jobs to
produce a candidate for the new attempt. A failed-jobs-only rerun can reuse the
earlier build output, which remains bound to the earlier attempt.

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

Review the plan and retain its exact bytes. Set `signing_commit` to the exact
reviewed signing workflow commit on `main`. The release operator dispatches
protected signing using the file input, which preserves the final newline.

```sh
gh workflow run release-cloud-app-signing.yml -R eliza-research/alpha --ref main \
  -f "workflow_commit=$signing_commit" -F signing_plan=@signing-plan.json
```

Preflight checks the official
Actions ZIP. The protected job checks the same run attempt and artifact again,
then stages the pinned private generation before accessing the signing key.
[Protected signing workflow](.github/workflows/release-cloud-app-signing.yml)

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

Review `qualification.json` and dispatch the reviewed publication workflow.

```sh
gh workflow run publish-qualified-app-update.yml -R eliza-research/alpha --ref main \
  -f "workflow_commit=$publication_commit" -F qualification=@qualification.json
```

Complete both admissions before the one-day signing delivery receipt expires. The protected
job restores the same private mirror and exact signed output before publication.
[Qualified publication workflow](.github/workflows/publish-qualified-app-update.yml)

The existing reviewed Cloud producer routes remain available for their
approved package and profile.

The native route keeps the 1.5 GB limit on the producer ZIP and signed TAR.
The two unsigned APKs and the two debug APKs each have a separate 1.5 GB
expanded pair limit. Admission checks exact member lengths against the
reviewed archives and verifies the APK digests when streaming the bytes.

Release approval, signed-byte voice tests, publication and both sideload and
image-preinstalled phone drills remain required for this batch.

Keep `apk-manifest.json` from the `qualified-launcher-publication-<run>-<attempt>`
artifact for each qualified Alpha Compute launcher version. On the machine
with the phone, keep each manifest in its own directory beside the exact
`launcher-release.apk` from the signed delivery. If using the public APK
asset, save it under that same filename. For an image baseline, use the
post-signing verification manifest for the exact APK baked into the image.

Record each [wireless drill](https://github.com/eliza-research/alpha/issues/889)
with the release APK and its verification manifest available locally. Both captures
verify the installed bytes against the reviewed `android/release-signer.json`
signing policy, including for versions already recorded as released. This
capture requires Android 14 or later for package installer provenance. Keep the phone
offline from baseline installation through HOME selection, any one-time Android
installation permission, and the `before` capture. Keep the host online and
connect the phone by USB. The host verifies the anonymous offer and its APK
while the phone is still offline. For the update, keep the screen unlocked and
leave Alpha idle in the foreground. Allow one full 15-minute check interval
plus download time.

```sh
node scripts/verify-wireless-launcher-update.ts before --serial <serial> \
  --distribution sideload --apk-manifest <baseline>/apk-manifest.json --out <new-before.json>
# Disconnect USB/ADB, restore the phone's network, and return to idle HOME.
# Let Alpha discover and install the update. Reconnect after the observed result.
node scripts/verify-wireless-launcher-update.ts after --serial <serial> \
  --before <before.json> --apk-manifest <update>/apk-manifest.json --out <new-after.json>
```

Repeat with `--distribution image-preinstalled` on the signed image while
the launcher baked into the image is still active. For its first `before` capture
pass `--image-release-record <release-record.json>` and
`--image-vbmeta-digest <digest>`. On the image build host, verify that the signed
target-files ZIP matches the record's SHA-256. Extract `IMAGES/vbmeta.img` and
the recorded chained partition images together, then run
`avbtool calculate_vbmeta_digest --hash_algorithm sha256 --image <vbmeta.img>`.
Use that digest from the build host. The receipt checks it and the release
fingerprint against the locked Pixel, and checks the baked launcher against the
record. The first replacement must
move the active APK to Android's app data while retaining its system-app
provenance. For the next advancing release, use `before --previous <after.json>`
with the same distribution and the previous release's APK manifest. This
binds the next drill to the exact phone, image, HOME and APK of the previous
replacement and carries forward the image evidence. Start the drill with a new
baseline receipt from this checkout. Keep the first drill signed out. For the
signed-in follow-up, seed the account and data before the next offer goes live, then take the phone
offline again for baseline capture. Keep each public offer stable until both
distribution paths have saved their `after` receipts.

After both rounds, verify the eight saved receipts together. For each
distribution, pass the first before and after receipts followed by the
second before and after receipts.

```sh
node scripts/verify-wireless-launcher-update.ts matrix \
  --sideload stock-1-before.json --sideload stock-1-after.json \
  --sideload stock-2-before.json --sideload stock-2-after.json \
  --image-preinstalled image-1-before.json --image-preinstalled image-1-after.json \
  --image-preinstalled image-2-before.json --image-preinstalled image-2-after.json \
  --out wireless-launcher-matrix.json
```

The matrix checks the links, signing family, installed SDK revision and
the exact same two offers across both distributions. It reads saved
evidence offline, so the public channel may already have advanced.

The readback uses the primary user and records the actual APK digest, update
initiator, install identity, HOME, signing family, boot state and SDK revision.
Retain the protected `qualification-summary.json` and
`app-update-delivery.json` with each published APK and its verification manifest
to bind the exact producer commit to the launcher digest. Keep the signed
image's `release-record.json` with its baseline. Capture `after` promptly,
before rebooting. It requires the matching completed Android install session
to identify the automatic mode and show no manual approval. The receipt keeps
only the matching session facts. A device that omits or has discarded that
history cannot supply this receipt. Observe the disconnected update without
tapping Check, Install or Continue in Alpha or approving an Android prompt.
Record those observations along with retained data, Keystore, resident, voice
and recovery.

The remaining release work is tracked in [native promotion #888](https://github.com/eliza-research/alphaphone/issues/888)
and [wireless launcher acceptance #889](https://github.com/eliza-research/alphaphone/issues/889).
Complete it in this order:

1. Admit native voice inputs for the exact SDK, then build and sign both
   distribution variants. Preserve advancing versions and the enrolled signer.
   The protected [release custody workflow](.github/workflows/release-custody-proof.yml)
   exports the verified public certificates and fingerprints under
   `artifacts/release-public-identities/` for enrollment.
2. Register `ai.alphacompute.alphaphone` in production and staging. Run
   `node scripts/cloud-readiness.ts registration --environment <environment>`
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
     `node scripts/render-assetlinks.ts --cloud-config --published https://eliza.app/.well-known/assetlinks.json`.
     Preserve existing grants and other products' entries. Deploy and verify
     the published file with `node scripts/render-assetlinks.ts --check <web-origin>/.well-known/assetlinks.json`.
   - Use `node scripts/cloud-deployment.ts --pages-registration` to update
     Alpha's entry in the protected Cloud release Environment variable
     `ELIZA_NATIVE_AUTH_CALLBACKS_JSON` for production and staging. Keep one
     entry per callback URI and preserve the other products' entries. Verify
     the new Android target in the deployed Pages
     callback page, run `node scripts/cloud-readiness.ts probe --environment <environment>`,
     then complete sign-in on the intended APK. Test with the new package
     selected to open its supported links if the old package is also installed.
     [Cloud registration #666](https://github.com/eliza-research/alphaphone/issues/666),
     [App Links #670](https://github.com/eliza-research/alphaphone/issues/670).

   For a debug-signed Pixel, use an explicit `--test-mocks` APK on an owned
   test device and select **Staging** in **Subscription gate QA**. The staging
   App Links filter is part of that build. Use the staging URL
   `https://staging.eliza.app/.well-known/assetlinks.json` and pass
   `--keep-fingerprint <debug-SHA256>` to the asset-link config generator.
   For native Google sign-in, add the package and that signer's SHA-1 in
   the staging Steward project. After deploying, run
   `node scripts/cloud-readiness.ts probe --environment staging --signer <debug-SHA256>`.
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
[cache retention #890](https://github.com/eliza-research/alphaphone/issues/890)
and [applied-candidate recovery #891](https://github.com/eliza-research/alphaphone/issues/891)
before enrollment. [#400](https://github.com/eliza-research/alphaphone/issues/400)
tracks the overall release gate. A successful host test or model does not close
these release and device gates. Alpha consumes the reviewed rejected-download
retry repair [eliza#39235](https://github.com/elizaOS/eliza/pull/39235) and the
reviewed Maps and speech changes through [eliza#39255](https://github.com/elizaOS/eliza/pull/39255)
at `8876e369ca00d82f334e604aba3763a3998a854e`. This pin adds only the reviewed
OS descriptor admission changes from [eliza#39291](https://github.com/elizaOS/eliza/pull/39291)
to `06e268c7ecdc1a6451bfa1a0ad9665461a7f7d2b`; the core, runtime, mobile builder,
Bun lock and recorded native producer inputs are unchanged. The exact pin is
reachable from upstream develop through [eliza#39298](https://github.com/elizaOS/eliza/pull/39298).
Earlier APK, voice and device evidence does not qualify this pin; rebuild and
qualify the exact product inputs before OS enrollment.

The protected [preserving OS OTA signing workflow](.github/workflows/release-os-ota-signing.yml)
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
renderer and Android bindings with `node scripts/cloud-deployment.ts`.
`node scripts/cloud-deployment.ts --pages-registration` prints the public Pages
callback registration for an operator without creating a `config/` directory.
