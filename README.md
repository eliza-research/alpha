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
git clone --recurse-submodules https://github.com/eliza-research/alphaphone.git
cd alphaphone
npm ci
npm run verify
npm run dev
```

`npm run verify` runs deployment-output checks, source preparation, executable
Quint models, TypeScript, host tests, the production web build and its bundle audit.
Host contract tests need a JDK. Tests that load the real SDK require the pinned Bun
and a prepared SDK; set `ALPHA_REQUIRE_PREPARED_SDK=1` to fail instead of skipping
when that preparation is missing.

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
`artifacts/`. The variants share `ai.alphacompute.alphaphone` and replace one
another; only the launcher declares HOME. Phone, Contacts and SMS/MMS require
an admitted AOSP image capability; a launcher APK alone does not supply it.

The package and native namespace are `ai.alphacompute.alphaphone`. This identity
requires matching signing, callback registrations and native-library qualification.
An installation using the previous package ID is a separate application; this
rename does not migrate its private data. Native qualification remains pending.

The default native runtime uses libelizainference for local speech and embeddings.
Stage on-device voice inputs with
`node scripts/android-stage-voice-models.mjs --from <directory>`.
The resident source and workflow worker are prepared from the locked upstream
revision. Build inputs must agree with the staged runtime and native libraries.

The explicit Cloud profile keeps the resident agent and database on the phone
and uses Cloud inference, embeddings and speech, without local model payloads:

```sh
npm run agent:prepare
npm run agent:build-workflow-worker
npm run agent:stage-android -- --runtime-profile=cloud
npm run licenses:packaged-runtime
npm run android:build -- --runtime-profile=cloud
```

Developer APKs may explicitly omit the runtime:

```sh
npm run agent:prepare -- --source-only
npm run android:build -- --allow-unpackaged-runtime
npm run android:build -- --test-mocks
```

Test-mocks APKs go to `artifacts/test-mocks/`. Production Android builds remove
mock flags from child environments. `scripts/audit-production-bundle.mjs` checks
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

`scripts/deliver-app-update.mjs` publishes an admitted signed launcher APK and
checks anonymous readback. Merging source does not publish an application update.
Android may require confirmation for installation.

## Generated files

Build output belongs in ignored `web-dist/`, `artifacts/`, `test-results/` and
`.eliza/` directories. Android host and Capacitor sync output are ignored too.
Cloud deployment source is `scripts/cloud-deployment-policy.mjs`; regenerate its
renderer and Android bindings with `node scripts/cloud-deployment.mjs`.
`node scripts/cloud-deployment.mjs --pages-registration` prints the public Pages
callback registration for an operator without creating a `config/` directory.
