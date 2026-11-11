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
```

Instrumentation uses an owned disposable emulator. Image staging emits an AOSP
vendor add-on under `artifacts/aosp/`. APK builds, emulator HOME-role behavior,
full AOSP boot, real integrations, physical-device testing and user acceptance
are independent results.

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

An automatic attempt that loses idle HOME after verifying its APK can retain
that one file for a later attempt in the same process. Reuse checks the complete
bytes and current package, version, variant and signer again. A process restart
discards the cache hint; the durable installer journal still owns recovery.

Main pushes automatically build unsigned native candidates in the existing
Resident Android workflow. The separate `app-native-candidate-*` artifact holds
the genuine distribution archive and `app-update-candidate.json`, which binds
source, SDK, run/attempt, profile, channel and actual APK hashes. Test-mocks stay
in the qualification archive. Primary main-push attempts share a canceling group;
reruns use their own run ID group and do not cancel running work. GitHub does not
guarantee commit order. Completion needs a quiet main, build capacity and admitted
native inputs.

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

Run `python3 -B scripts/ci/hosted-native-inputs.py --check` to validate the
manifest against the checkout without downloading. Automatic runs fail early
when input pins are missing, stale or expired. They download through the
workflow's read-only token, stage with the existing voice and embedding tools,
and retain the input IDs, hashes and sizes in `native-input-admission.json`.
The candidate receipt binds its digest to the exact source, SDK and run attempt.
The build evidence records the uploaded candidate's ID and compressed size
from GitHub, expanded file bytes, and both unsigned APK hashes and sizes.
Refresh the reviewed pins before an artifact expires or a bound source record
changes. The candidate archive retains the distribution producer evidence
before the test-mocks build can replace it.

The existing workflow run number is the candidate versionCode, checked against
both releases' retained APKs and public pointers, and the committed version floors.
Failed or canceled runs consume their number. A manual release or workflow
migration that exceeds this number stops candidate creation and needs a reviewed
version migration. Manual builds keep their explicit version input.
Candidates are unsigned build evidence. To promote a native candidate, use
the existing protected signing workflow with a reviewed plan whose
`producerKind` is `github-main-candidate`. Pin the exact successful
main-push run ID, numeric run attempt, artifact ID, source and SDK commits,
version, public channel, outer archive bytes and SHA-256, candidate receipt
and producer manifest SHA-256, and both unsigned APK SHA-256 values.
Use the artifact's original ZIP bytes and the existing private storage path
`unsigned/<archiveSHA256>.zip`. Pin its generation and a fresh exclusive
`signed/<archiveSHA256>/<32-hex-id>/signed-apks.tar` destination in
`privateStorage`. Keep the Actions artifact available through both signing
admissions.

The preflight checks the official Actions ZIP. The protected job checks the
same run attempt and artifact again, then stages the byte-identical private
generation before accessing the signing key. The qualified publication workflow
restores the same private mirror and exact signed output. Complete the reviewed
voice checks for both signed APK digests before dispatching publication.
The existing reviewed Cloud producer routes remain available for their
approved package and profile.

The native route keeps the 1.5 GB limit on the producer ZIP and signed TAR.
The two unsigned APKs and the two debug APKs each have a separate 1.5 GB
expanded pair limit. Admission checks exact member lengths against the
reviewed archives and verifies the APK digests when streaming the bytes.

Release approval, signed-byte voice tests, publication and both sideload and
image-preinstalled phone drills remain required for this batch.

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
3. Qualify the exact signed APK bytes, publish the admitted launcher and
   manifest, and verify anonymous full-byte readback. Then install the initial
   baseline with the new package ID on each distribution form and run #889 on
   the machine with the phone. Verify the manifest and APK on
   `app-stable-alphacompute` before testing wireless delivery.
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
