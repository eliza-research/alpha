# Alpha Phone (alphaphone)

## Shared application direction — October 27

The owner has requested one upstream Eliza mobile application and AOSP target,
with Alpha supplying its character, theme and product registration. Shared views,
plugins, agent context, action contracts and native behavior must move upstream;
the separate renderer described below is the current implementation, not the target.
The native profile uses libelizainference for local models (Paradee speech,
Phonon-2 recognition and local embeddings), with Cerebras for Cloud text inference.
Both branded images target Pixel 10a / Android 17. Package IDs, signing, callbacks
and existing storage namespaces remain explicit compatibility inputs.

See the [consolidation audit](docs/unification-audit-2026-10-27.md) for discrepancies,
migration order and separate source, APK, image and device acceptance gates.

Independent Android UI on Eliza, using the Alpha Phone prototype as its design
reference. The current renderer includes native browser, camera,
calendar, reminders, selected files and local notes. Phone, Contacts and SMS/MMS are
AOSP-only capabilities; standalone APKs do not expose them. Wallet is outside MVP.
Production Android starts with Eliza Cloud sign-in, followed by device-access
setup, Ready, and Home. Notifications, microphone, camera and location retain the original
sequence; Android then reviews Calendar and Photos access. Denied access stays on its
Settings/check-access step without repeating blocked prompts. Every access step offers
Skip for now after 20 seconds, including an unavailable or pending browser permission.
Reviewed choices persist across refresh; skipping never grants OS/browser access, and
each feature still checks its current permission when used. Google connects separately
in Settings. Previously completed installations remain completed.
Cloud inference has a separate entitlement/binding check; a signed-in account does not
by itself prove that AI is ready, and genuine plan or connection notices remain visible
through setup. The agent runs on the phone. Eliza Cloud supplies text inference,
subscriptions, Gmail and shared Maps services. The native default profile stages local
STT/TTS; browser development can explicitly select local-host or owner-bound Cloud speech.
Each route needs its own microphone, response and playback acceptance. Complete
voice/device acceptance remains open. Remote pairing and hosted agents are unavailable in every production build. Explicit test-mocks tooling
retains remote connections as non-product development infrastructure. Mock mode, prototype
fixture data, developer device controls and the local development endpoint are
development surfaces that exist only when the build-time switch
`ELIZA_DEV_ALLOW_TEST_MOCKS=1` is set (see [build-time switch](#build-time-test-mock-switch)).
Production web builds and all four distribution APKs start as the live app with honest
empty or unconnected states. The real local Eliza/Cerebras
protocol is verified; live provider login, Gmail, voice and
complete workflow execution remain acceptance work. The primary architecture is now an
[Android-resident agent](docs/on-device-agent-plan.md), replacing Nitro/TEE hosting;
the native bridge, reproducible mobile payload staging and browser development host are now implemented. See [local agent setup](docs/local-agent-development.md) and the [verification guide](docs/verification.md) for
the required evidence rather than treating a successful APK build as acceptance.

- [Account-bound local Inbox drafts](docs/inbox-local-drafts.md)
- [Browser implementation and acceptance review](docs/mvp-browser-review.md)
- [Browser speech: local agent or Eliza Cloud](docs/browser-speech-recognition.md)
- [Fused speech on libelizainference](docs/fused-speech.md)
- [MVP scope and gap report](docs/mvp-scope-and-gap-report.md)
- [MVP completion plan](docs/mvp-completion-plan.md)
- [Remaining MVP work after PR 373](docs/mvp-remaining-work-2026-10-09.md)

- [Current flow research](docs/research-report.md)
- [Detailed flow PRD](docs/flow-audit-and-prd.md)
- [Current implementation plan](docs/flow-implementation-plan.md)
- [current product status](docs/mvp-current-status.md)
- [Production readiness record, 2026-10-04](https://github.com/AlphaCompute/alphaphone/blob/51c8157533353a805afd2811f4e3f41b66b7b9fa/docs/production-readiness-2026-10-04.md)
- [Cloud deployment and authentication findings](docs/cloud-production-validation.md)
- [Browser autofill and Proton integration](docs/browser-autofill-integration.md)
- [Calendar and reminder contracts](docs/calendar-reminder-contract.md)
- [Gesture zones and the notifications panel](docs/gesture-zones.md)

- [Working PRD](docs/prd.md)
- [Detailed implementation plan](docs/implementation-plan.md)
- [Architecture and upstream ownership](docs/architecture.md)
- [Requirements and open decisions](docs/decisions.md)
- [Verification gates and evidence](docs/verification.md)
- [Source/design provenance](docs/sources.md)

## Approved MVP direction — October 12

The [implementation plan](docs/implementation-plan.md) and
[32 implementation TODOs](docs/owner-approved-mvp-plan-2026-10-12.md) supersede older
scope wording above. Agent execution is local only; Eliza Cloud provides inference,
subscription billing, Gmail and shared Maps. In the native default profile, STT/TTS must move to the native
on-device route. Chat has one microphone control for the interruptible voice assistant. Active chat
shows the inline blue synth, Mute/Unmute and Stop. Notes dictation remains separate;
the retained chat-dictation API is not a second user-facing chat control.
Always-on listening is required in the Pixel 10a / Android 17 AOSP MVP. Phone,
Contacts and SMS are AOSP-only; Wallet is removed. Full permitted Photos access and
reset-only data management are planned. These are requirements, not claims that the
current Cloud voice/credit UI or other source already implements them.
See [speech research](docs/local-speech-research-2026-10-12.md) for native candidates.

## Explicit Cloud QA profile — October 18

The owner-approved `cloud` runtime profile supersedes the local-speech-only wording
above for this explicit QA configuration. It keeps the genuine Bun/PGlite resident
agent, history and approvals on the phone, uses authenticated Eliza Cloud for
Cerebras text inference, embeddings, speech input and Cartesia speech output, and
packages no local inference models. Voice requires visible upload/plan disclosure
and an explicit start; account changes retire the bound voice session.

Select it explicitly with `--runtime-profile=cloud` for runtime staging and Android
builds (`agent:stage-android` and `android:build`). Renderer, native and packaged
runtime admission must agree on the profile; test mocks and unpackaged runtimes
are rejected. The default remains `native` with its existing qualification gates.
The Talk button is the explicit voice start; it opens the voice surface and starts
the microphone without a second Start Cloud voice button. The active surface keeps
the Cloud upload and plan-usage disclosure visible. Account and conversation binding,
permission failures, and explicit Stop remain enforced.

Cloud QA builds do not establish offline/native-speech, AOSP or release acceptance;
real account, inference, microphone and playback evidence is still required.

For a hosted build, dispatch `resident-android.yml` on the reviewed ref with
`runtime_profile=cloud`. It prepares the exact SDK and workflow worker, stages the
Cloud profile and archives all four flag-off APKs, including standalone and launcher
debug APKs. The `resident-cloud-archive-<sha>-<run>` artifact retains source and APK
verification records for three days. This choice skips the separate test-mocks
build and native/recovery qualification campaigns; it does not run Cloud providers.
The default manual profile and automatic resident qualification remain `native`.

## Setup

```sh
git clone --recurse-submodules https://github.com/AlphaCompute/alphaphone.git
cd alphaphone
npm ci
npm run verify
npm run dev
```

## Build-time test-mock switch

One build-time switch, the upstream elizaOS name `ELIZA_DEV_ALLOW_TEST_MOCKS`, controls
every mock, fixture and developer surface. It is **off unless set to exactly `1`**.

When it is off (the default for `npm run build`, `npm run android:sync`,
`npm run android:build` and therefore the production web build and all four
distribution APKs: standalone and launcher, debug and release), the build does not
contain or expose mock mode, prototype fixture data or fixture images, the "mock"
connection choice, the flag-only `?mode=mock`, `?fixture=1`, `?mode=dev` and `?start=`
entry points, developer device controls, the simulated apps, the local development agent
(`10.0.2.2:2138`) option, the Cloud Staging environment, the DevelopmentAgent fallback
transport or the debug-only native hooks (synthetic autofill service, development
agent and voice plugins, cleartext network configuration and fixture-package
permissions/queries). Upgraded installs that had saved the old mock selection start at
the connection chooser instead; a saved Cloud Staging service is treated as signed out;
paused notification collection resumes only through an explicit connection choice.

It is turned on explicitly by:

- `npm run dev` (which also starts the local agent; the default `npx vite` without the
  script stays off), `npm run dev:ui` (renderer only) and `npm run dev:maps`;
- the Playwright web server used by `npm run test:browser`, and the browser CI job;
- an explicit test-mocks web build: `ELIZA_DEV_ALLOW_TEST_MOCKS=1 npm run build`;
- an explicit test-mocks Android build: `npm run android:build -- --test-mocks`, which
  writes only to `artifacts/test-mocks/` and never replaces the distribution APKs in
  `artifacts/`.

The renderer reads the switch through `apps/app/src/build-flags.ts`; Vite folds it to a
constant, so gated code is removed from production bundles. The envPrefix is not widened
to `ELIZA_`; no other `ELIZA_*` value reaches the bundle. On Android the same name is
passed as the Gradle property `-PELIZA_DEV_ALLOW_TEST_MOCKS=1`, exposed as
`BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS`, and attaches the `src/testMocks` source set to
debug variants only when on. A web build writes `web-dist/build-flags.json`
(`{"testMocks": false}` for production).

`node scripts/audit-production-bundle.mjs web-dist` fails on any mock/developer string,
fixture name, `img/` fixture image or source map in a production bundle;
`--expect-test-mocks` audits a deliberate test-mocks build instead. The Android
verification applies the same audit to the extracted web assets of every distribution APK.

## Browser development and verification

```sh
npm ci
npx playwright install chromium
npm run verify
npm run test:browser              # development surfaces on (switch set by Playwright)
npm run test:browser:production   # production build, switch off: no mock/dev surfaces
npm run dev                       # local agent + development server, switch on
npm run dev:ui                    # renderer-only development server, switch on
```

`npm run dev` shows the product connection sheet, **Alpha connection** (connected, connecting
or couldn't connect, **Try again**, conversation history), and attaches to the local agent in
the background, so loading the page while the agent restarts leaves Home recovering instead of
opening the sheet. Set `ALPHA_DEV_CONNECTION_TOOLS=1` for the development connection sheet:
development profiles (`?mode=dev`), mock mode, subscription gate QA and the development Cloud
and pairing tools. `npm run dev:ui` keeps the development connection sheet.

For configured regional Maps, prepare the data once as described in
[regional Maps setup](docs/maps-regional-validation.md), then run `npm run dev:maps`.
This starts the local router, gateway and app together; use `-- --port 5194` to
choose the app port. Ctrl-C stops the services owned by that command.

The desktop browser shows a fitted phone preview; mobile widths fill the viewport.
Use `?theme=dark` to inspect dark layouts. The following entry points exist only in
`npm run dev` and other builds with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`; production builds
ignore them and open the live app:

- `?mode=mock` (switch on only) opens the clearly labeled design fixture. It is a
  development/test surface, not a product connection choice.
- `?fixture=1` (switch on, development server only) renders prototype fixture data for
  visual snapshots.
- `?mode=dev` (switch on, development server only) opens the browser development
  profile with durable local app data and device controls.

For the complete capability matrix and current verification results, see
[browser development parity](docs/browser-dev-parity.md). Developer controls are hidden by default, including with `bun run dev`. Add `?tools=1` (or `&tools=1`) to an explicitly enabled development-server URL to show **Tools**. The same query is the one Developer gate in Settings: the Developer page, Try mock mode, saved-data recovery rows, Calendar backups and the update channel row appear only with it. This query cannot enable controls in production builds or on Android. Add `?shell=launcher` only to preview the launcher system presentation; the default preview is the standalone app. In the development profile with tools enabled, open **Device controls** with the sliders button beside **Tools** or **Dev data** below the phone preview. Its profile buttons switch between app and development data. In **Device controls**, use
Home, Back, Power, Background and Resume to exercise device lifecycle; use Incoming
call/message/email and Post notification to drive incoming events. Location controls
provide a saved Home place and manual movement for location-triggered workflows.
The role buttons persist the development device's selected Home, assistant, dialer
and SMS roles.

On the development server (switch on; with `npm run dev`, also `ALPHA_DEV_CONNECTION_TOOLS=1`),
**Settings → Agent connection** offers development profiles to exercise conversations,
approvals and durable receipts without credentials.
Use `?mode=dev&workflows=agent` (switch on, development server only) to exercise the
agent workflow UI with that profile.
For real host inference and speech, follow the separate [local agent setup](docs/local-agent-development.md).
**Settings → Character → Wake assistant** opens the recording UI; recording starts
only after Start recording is selected.

The web build has no speech engine of its own. Local speech in a browser runs on the private
local agent on the same computer, which uses the native llama.cpp-based libelizainference
engine (Paradee-8M speech and the voice bundle's ASR); without the agent, local transcription
reports that the agent is required and the recording is kept. Eliza Cloud speech is only an
explicit, disclosed opt-in (P-07); there is no Web Speech or automatic network fallback. The
transcript is always reviewed before it is saved or used. See
[browser recording and transcription](docs/browser-speech-recognition.md) and
[fused speech](docs/fused-speech.md).

Deleted notes, including voice notes, move to a Trash inside Notes and are erased
automatically 3 days after deletion; Undo, Restore, Delete forever and Empty Trash are
available. The web build uses browser-local Notes. Notes text import and export use the browser
file picker and downloads; browser note storage is unencrypted and is not synced. On
Android, Notes use the native Keystore-backed secure store.
The web build is a development and preview surface and the payload packaged into the
APKs; it is not a standalone product distribution.
The browser suite covers production navigation, durable note editing, exact-byte
file flows, dialog accessibility, disclosed adapter fixtures and reference design
states. Reports/screenshots are in `test-results/browser-report` and
`test-results/browser`. Browser CI runs independently of Android qualification.

Use Node 24.15.0 and JDK 21. Resident preparation requires Bun 1.4.2, matching
the pinned upstream package manager and CI. Put that version on `PATH` or set
`ALPHA_BUN` to its absolute executable path; an older Bun can emit incompatible
plugin imports during the runtime build. Native builds require Android SDK platform 36 and
build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` on Linux; the scripts also
recognize the usual macOS Homebrew JDK/Android SDK locations. The Gradle 8.13
wrapper is hash-pinned. No Eliza root dependency installation or package
publication is required for this shell.

On-device speech uses only the llama.cpp-based libelizainference engine (decision P-42) through
the shared elizaOS paradee-voice library: Paradee-8M speech output (P-54) and the voice bundle's
model-agnostic ASR slot (P-55; Phonon-2 is the intended model). Build and stage it as described in
[fused speech](docs/fused-speech.md): `node scripts/android-stage-voice-models.mjs --from <dir>`
writes the engine and the bundle (about 1.1 GB, shipped in the APK assets) to the ignored
`.eliza/paradee-voice/native`, checked against `android/voice-host/qualified-voice-host.json`
and `android/paradee-voice/asr-inputs.json` by Gradle (`:local-speech:verifySpeechInputs`,
`:app:verifyParadeeAppLinkage`, `:app:verifyVoiceHost`). A distribution build needs them; the
`--allow-unpackaged-runtime` developer lane may omit them, and local speech then reports
unavailable. The record is not qualified: a release is distributable only after on-device
qualification on both ABIs and device acceptance.

An explicit Cloud resident build runs the genuine agent, workflow worker and database on the
phone while Eliza Cloud supplies Cerebras text inference and embeddings. It packages no local
inference engine or model. This profile requires the complete resident payload and cannot be
combined with test mocks or the unpackaged developer option:

```sh
npm run agent:prepare
npm run agent:build-workflow-worker
npm run agent:stage-android -- --runtime-profile=cloud
npm run licenses:packaged-runtime
npm run android:build -- --runtime-profile=cloud
```

The original upstream runtime provenance stays intact. The Cloud profile receipt records the
exact verified BGE model omitted after staging. Packaging checks verify Bun against the pinned
artifact lock, the database and bundle against their prepared build, and the worker against its
source receipt. Cloud profile verification rejects local inference and speech assets. The default
native profile retains its existing qualification requirements. Build evidence alone does not
establish Cloud account, chat, voice or device acceptance.

Every Android build also needs the prepared resident runtime source in
`artifacts/local-agent-resident-<commit>` (from `upstream.lock.json`): Gradle's
`stageLocalAgentSources` step generates the native agent service classes from it.
Distribution builds also need the staged runtime payload, which in turn needs the
workflow-worker artifact (`artifacts/mobile-workflow-worker-<commit>`). On a clean
checkout, one command does all of it:

```sh
# What the strict build needs, what is there, and whether a script or a person supplies
# each missing input. Reads files only; always exits 0.
npm run android:build:inputs
# Strict distribution chain: check inputs, the embedding host, prepare, build the worker,
# stage the runtime, regenerate the notices for it, then build and verify all four APKs.
# Safe to rerun: preparation and the worker artifact are reused only when they verify
# against the current source.
npm run android:build:local
# The same chain step by step:
npm run agent:build-embedding-host
npm run agent:prepare
npm run agent:build-workflow-worker
npm run agent:stage-android
npm run licenses:packaged-runtime   # rewrites apps/app/public/licenses/* for this build; do not commit
npm run android:build
# Developer APKs without the runtime payload (releases recorded distributable:false):
npm run agent:prepare -- --source-only
npm run android:build -- --allow-unpackaged-runtime
```

`npm run android:build` first runs `scripts/android-build-preflight.mjs` and stops
(exit 2), before the web sync and Gradle, naming the command to run when the pinned
`vendor/eliza` checkout, the prepared runtime source or (for distribution builds) the staged
runtime payload is missing or stale, or when the on-device voice outputs are missing (distribution
builds) or not admitted by the voice-host record.

Three inputs of a distributable build cannot come from a script, and
`npm run android:build:inputs` names each with who supplies it:

- **The reviewed ARM64 embedding host** (`android/embedding-host/qualified-host.json`). Its
  three native libraries are ignored by Git. `npm run agent:build-embedding-host` passes
  when they are staged and otherwise stops (exit 3) before any long step. The reviewed
  bytes were built without a build-path remap, so they contain the absolute directory of
  that build, which only the qualification receipt records; a rebuild elsewhere has the
  same source and toolchain and different bytes
  (`android/embedding-host/build-toolchain.json` records the measurement). A person
  therefore has to either stage the reviewed libraries
  (`node scripts/stage-embedding-host.mjs --receipt <QUALIFICATION.json>`) or qualify a
  rebuilt candidate: `node scripts/build-embedding-host.mjs --candidate` fetches the pinned
  engine, builds with NDK `29.0.13113456` and CMake `4.0.3` using
  `prepare-embedding-host.mjs --remap-build-path`, and never stages the result. The staging
  command checks the staged embedding model, so run `agent:prepare`,
  `agent:build-workflow-worker` and `agent:stage-android` before it; and it refuses to
  replace a differing `qualified-host.json`, so a new qualification removes the old one in
  the same reviewed change. Three remapped builds in three directories on one macOS arm64
  host were byte-identical; no other host has been tried. Once a candidate is qualified and
  `remapBuildPath` is set to `true` in the same commit, the step rebuilds the libraries and
  stages them only when they are byte-identical to the reviewed ones, and stops (exit 3)
  when they are not. Gradle's `:app:verifyEmbeddingHost` requires them for every
  distribution and test-mocks build. The unpackaged developer build
  (`--allow-unpackaged-runtime`, which `--test-mocks` may be combined with) passes only
  while no resident payload is staged at all: once `agent:stage-android` has run, remove
  `android/app/src/main/assets/agent` and `android/app/src/main/jniLibs` or stage the host.
- **A qualified speech runtime** (decision A-24). A local rebuild installs only with
  `--allow-unqualified-runtime`. The chain still completes with it; `verify-apks` records
  the releases `distributable:false` and names the speech reasons.
- **The release signer** (decision P-16; [human actions](docs/human-actions.md) H-08 to H-10).
  `node scripts/enroll-release-keys.mjs` records the key ceremony's certificate digest in
  `android/release-signer.json`; releases are then signed by Gradle with the `ELIZAOS_KEYSTORE_*`
  values or afterwards with `node scripts/sign-release-apks.mjs` (ceremony key files or a PKCS#11
  token). Without either the chain completes with unsigned, non-distributable releases.
  `npm run human:status` lists every step only a person can take and what this checkout records.

Gradle verifies every plugin and dependency artifact against
`android/gradle/verification-metadata.xml` (SHA-256) in every build of the `android/`
project; an artifact that is not listed fails the build. After changing an Android
dependency or the Gradle plugins, run `npm run android:deps:write-verification` (a full
build with network access), review the diff and the publisher groups in
`android/gradle/verification-reviewed-groups.json`, and commit both.
`npm run android:deps:check` and `npm test` read the committed file offline. A
distribution build also writes `artifacts/sbom/alphaphone.cdx.json` beside its APKs
(see [the dependency audit](docs/dependency-audit.md)).

Preparation, worker build and staging run the upstream Turborepo build inside the
immutable prepared checkout. Turborepo appends an agent-guidance block to a
repository's `AGENTS.md` when it detects an AI coding agent; these scripts therefore
start their children without the variables it detects (`AI_AGENT`, `CLAUDECODE`,
`CLAUDE_CODE`, `CODEX_SANDBOX`, `CURSOR_AGENT`, `CURSOR_TRACE_ID`, `GEMINI_CLI`,
`AUGMENT_AGENT`, `OPENCODE`, `OPENCODE_CLIENT`, `REPL_ID`), so no manual `unset` is
needed. Its other detector, a `/opt/.devin` directory, cannot be cleared this way; there
the source check still rejects the modified checkout.

For genuine browser Cloud QA with a resident running on your computer, prepare the
pinned Eliza source and dependencies, then run `npm run dev:cloud`. This explicit
mode disables simulated surfaces and direct-provider credentials. Sign in and
activate or redeem a plan through Alpha; the host binds the admitted account to
its local resident for Cloud inference. It never sends the Cloud bearer to the
renderer. The default page is `http://127.0.0.1:5318`.

Use `ALPHA_CLOUD_ENVIRONMENT=staging npm run dev:cloud` for staging, or leave it
unset for production. The selected issuer is fixed for the server lifetime and
shown in the connection UI. Each issuer has separate private account and resident
profiles under `~/.local/share/alphaphone/`. The host stores its Linux vault
passphrase there with owner-only permissions; resident Cloud credentials stay in
process memory and the private account store. Sign-out retires the bound process.
`ALPHA_ELIZA_SOURCE` can select an already prepared source at the exact pinned
commit; `ALPHA_CLOUD_UI_PORT` and `ALPHA_REMOTE_PORT` select free loopback ports.
This browser check exercises real login, subscription and inference only after
those actions are completed; it does not establish Android or device acceptance.

The default resident remains the lean chat profile. For full application QA, use
`ALPHA_CLOUD_RESIDENT_PROFILE=full npm run dev:cloud` with an explicitly selected,
separate Cloud-only `ALPHA_REMOTE_PROFILE`. A new full profile enables the
canonical personal assistant and uses the normal SDK plugin set, including Notes
and Calendar. It uses the same account-bound Cloud inference and speech routes;
it does not impersonate Android or enable mocks.

Full mode refuses an existing profile whose personal assistant is disabled or
not explicitly enabled. It never reverses that saved choice or converts a direct
provider profile. Existing accounts, credentials and histories are not copied or
reset. Verify the running Notes and Calendar services and real Cloud requests
before treating the preview as full application acceptance.

```sh
npm run android:build
# Distribution APKs (switch off) are in artifacts/: debug-signed debug APKs and
# release APKs that are signed only when the release signing variables below are set.
# Install either standalone-debug.apk or launcher-debug.apk for this product.
adb install -r artifacts/standalone-debug.apk
# The launcher flavor can be selected from Android's default Home app settings.
adb install -r artifacts/launcher-debug.apk

# Development/test APKs with mocks and debug-only native hooks (never distributed):
npm run android:build -- --test-mocks   # writes only to artifacts/test-mocks/; web-dist is restored flag-off afterwards
```

`npm run android:build` removes `ELIZA_DEV_ALLOW_TEST_MOCKS` and
`VITE_ELIZA_DEV_ALLOW_TEST_MOCKS` from its child environment unless `--test-mocks` is
passed, so a value exported in your shell cannot leak mocks into distribution APKs.
Native instrumentation that depends on the debug-only hooks (development agent bridge,
synthetic autofill, development voice capture, cleartext host access) needs the
`artifacts/test-mocks/` APKs.

Release signing and version use the upstream elizaOS names:

| Variable | Purpose |
| --- | --- |
| `ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`, `ELIZAOS_KEY_ALIAS`, `ELIZAOS_KEY_PASSWORD` | Release signing. Release APKs are signed only when all four are set; otherwise the build produces `*-release-unsigned.apk`. Keep the keystore and passwords in the signing service or CI secret store, never in the repository. |
| `ELIZAOS_VERSION_CODE`, `ELIZAOS_VERSION_NAME` | Override `versionCode`/`versionName` (defaults from `app.config.json`). |
| `VITE_MAPS_BASE_URL` | Regional Maps gateway for test-mocks builds only (development prototype). Other builds ignore it and use Eliza Cloud Maps after Cloud sign-in. |

`node scripts/verify-apks.mjs` (`npm run android:verify`) inspects APK bytes: package
IDs, HOME/LAUNCHER filters, debug flags and signatures, the absence of test-mock
native classes, cleartext configuration and fixture-package queries in distribution
APKs, and the production bundle audit of each APK's `assets/public`.
`node scripts/qualify-head.mjs` is the entry point for qualifying the checked-out
commit (repository verification, distribution builds and their audits); it is source/build evidence for that
exact commit only and does not stand in for emulator, AOSP image, real-integration or
device acceptance.

For constrained disks, `ALPHA_ANDROID_LOW_DISK=1 npm run android:build` packages
one APK at a time and removes only reproducible packaging intermediates between
variants. Source, generated provenance and finished APKs are retained.

When a resident runtime is staged, APK verification checks its source stamp,
agent bundle, hash-bound agent dependency inventory, complete workflow-worker inventory
and both native runtime ABIs against the staged inputs. Packaged notices use that
inventory and verify package metadata in the prepared source; compact bundle text
is not a dependency list. A stale stamp requires fresh preparation and staging.
A developer APK without runtime payload is reported as `NOT_PACKAGED`; this is
not proof of resident runtime execution or device acceptance.

The variants intentionally share `ai.elizaresearch.alphaphone` and replace one another.
The other product uses a different package and can be installed alongside this one.
Release APKs are unsigned unless the `ELIZAOS_*` signing variables are supplied; do not distribute
debug-signed or test-mocks builds as production.

## Emulator verification

The aggregate smoke suites, their npm entry point and their CI jobs were removed on
October 8 at the owner's request. APK builds and bundle audits remain required. The
current entry point for native instrumentation is
`npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN`
(per-class results bound to the commit and the installed APK hashes; see the
[verification guide](docs/verification.md)). It and the focused campaigns below run on an
owned disposable emulator; a build does not establish native behavior or HOME-role
acceptance. Two emulator jobs remain in CI: `native` and `recovery-ui` in
`.github/workflows/resident-android.yml`, which run only when the workflow is dispatched
or the repository variable `ELIZA_RESIDENT_QUALIFICATION` enables it. No emulator or CI
result is recorded for the current source ([current status](docs/mvp-current-status.md#current-qualification-evidence)).

The independent native Calendar consumer comes from the pinned upstream source.
Build its app and instrumentation APKs with
`node scripts/test-native-calendar-consumer.mjs --build-only` using JDK 21 and
`ANDROID_HOME`. Outputs remain under `artifacts/`, outside source. To run recovery,
set `ALPHA_CALENDAR_TEST_SERIAL`, `ALPHA_CALENDAR_TEST_AVD` and
`ALPHA_CALENDAR_TEST_ABI` (`x86_64` or `arm64-v8a`), then omit `--build-only`.
Use `--bridge` or `--workflow-permission` for separate permission-dialog cases.
The runner requires an owned disposable emulator, leases it, uses fresh secondary
users and retains uncertain cleanup for explicit recovery. Reports are under
`test-results/native-calendar-consumer`; fixture builds alone do not prove native acceptance.

The camera denial/retry campaign uses the same leased emulator and disposable-user
harness. Set `ANDROID_SERIAL`, `ALPHA_NATIVE_TEST_AVD` and
`ALPHA_NATIVE_TEST_ABI`, then run
`node scripts/test-native-permissions.mjs camera APP.apk MATCHING_TEST.apk NEW_OUTPUT`.
Use `settings` or `channels` in place of `camera` for location/Accounts settings
or notification-channel recovery with the same archived pair and emulator inputs;
`voice`, `voice-revoke` and `voice-limit` for the denied, revoked-while-recording and
granted microphone cases; and `notice` or `notice-denied` for the hosted result notice
with notifications allowed or denied (see the [verification guide](docs/verification.md)).
The APKs must be a matching archived standalone or launcher pair with their
`apk-manifest.json`. Existing package registrations are refused.
For Google APIs images, set `ALPHA_TEST_HOME_PACKAGE=com.google.android.apps.nexuslauncher`;
the default stock HOME package is `com.android.launcher3`. The runner verifies the
selected HOME is available before installing fixtures. Permission
changes affect only the fixture user; unproven package cleanup retains that user
for recovery. The output records APK admission, test identities and user cleanup.

Process-restart acceptance for Inbox, Notes and selected Files uses
`node scripts/test-native-restart.mjs inbox|notes|document APP.apk TEST.apk NEW_OUTPUT`
with the same archive, owned-emulator environment and HOME configuration as the
permission campaign. The shared harness authenticates both APKs, runs exact
prepare/restore/cleanup methods in a disposable user and records strict phase
results. Inbox uses a closed synthetic provider transport in the test APK and exercises the production sign-in control.
These checks do not establish physical-device or real-provider acceptance.

Installed Calendar and reminder upgrade acceptance uses
`node scripts/test-calendar-upgrade.mjs` or `node scripts/test-reminder-upgrade.mjs`.
Set `ANDROID_HOME` and the matching `ALPHA_CALENDAR_` or `ALPHA_REMINDER_` variables:
`BASELINE_DIR` (absolute), `TEST_SERIAL`, `TEST_AVD`, and `TEST_ABI`. Baselines contain
`standalone-debug.apk` and `launcher-debug.apk`; reminder baselines also require
`standalone-test.apk` and `launcher-test.apk`. Historical reminder test APKs
are admitted with AndroidJUnitRunner only; pass `--baseline-process-runner` when
the archived pair also declares Alpha's WorkflowNoticeProcessRunner. Current test
APKs must declare both known runners. Build current product and
instrumentation APKs first. Calendar accepts `--bridge` for its additional native
CRUD check. The shared runner admits both APK pairs, verifies installed hashes,
uses fresh secondary users and preserves uncertain cleanup for explicit recovery.
Reports go to `test-results/calendar-upgrade-*` or `test-results/reminder-upgrade-*`.
Secondary-user setup and teardown use the upstream lifecycle helper under the same
emulator lease. Missing package-cleanup proof retains the test user for recovery.
These campaigns require an owned disposable emulator and do not prove device acceptance.

The browser storage-format campaign uses the same archived APK and owned-emulator
inputs: `node scripts/test-browser-storage-format.mjs APP.apk TEST.apk NEW_OUTPUT`.
It runs in a fresh disposable user and checks the real product stores against the
deployed Keystore ciphertext format in both directions, including bookmarks,
tabs/history and site permissions. It does not open a website or establish browser
UI, process-death or physical-device acceptance.

## AOSP integration

The explicit [Cuttlefish x86_64 staging lane](docs/aosp-cuttlefish-native-staging.md)
installs the resident JNI files and executable modes required by a system APK.

```sh
npm run aosp:stage -- --apk artifacts/launcher-debug.apk --development
```

This invokes the Eliza OS custom-launcher admission helper and emits a new vendor
add-on under `artifacts/aosp/`. Copy that directory under an AOSP `vendor/` directory
and inherit its `product.mk` from the selected product. See [build instructions](docs/android-and-aosp.md)
for signing, default-home policy and the full image verification boundary.

The opt-in always-on listener ships only in the image. Build it with `./gradlew :sense:assembleRelease`
(in `android/` after `npm run android:host`, same signing variables as the APKs, after the speech model bundle is prepared) and pass
it with `--listener-apk FILE`. Production staging requires it together with `--listener-descriptor FILE`, an
independently reviewed JSON record of `packageName`, `apkSha256` and `certificateSha256`, and refuses a
listener APK without the qualified speech bundle. `node scripts/verify-aosp-listener.mjs --serial SERIAL --user 0` is a read-only
check of a booted image. See [ADR 0001](docs/adr/0001-privileged-listener.md) for the privilege
boundary and the remaining device gates.

## Layout

`apps/app` owns this product's UI. `android` owns its packaging and launcher bridge.
`vendor/eliza` pins shared platform/native/OS code. `design` preserves the supplied references. Use root npm scripts.

## Android host

The upstream Eliza consumer-host generator owns the Android Gradle setup: toolchain and
wrapper, SDK levels, modules, dependency versions, the standalone/launcher flavors, debug
and release build types, release signing and version overrides, test-mocks source sets and
admission hooks. `android/consumer-host.json` is Alpha's only Gradle input: identity comes
from `app.config.json`; the descriptor names modules, dependencies, the four signing and two
version environment variables, test-only sources and installed-data compatibility names
(resident socket namespaces, notification resources and the environment hook used when the
upstream resident classes are staged into Alpha's package). `android/app/product.gradle`
keeps Alpha's Gradle-time product admission (runtime profile, App Links, voice and embedding
hosts). `npm run android:host` writes the generated, git-ignored `settings.gradle`,
`build.gradle`, `app/build.gradle`, `gradle.properties` and wrapper into `android/`; every
`npm run android:build` regenerates them, and a host whose inputs changed refuses to
configure. Run it before opening `android/` in Android Studio or invoking `./gradlew` directly.
To add a module or dependency, edit the descriptor rather than a Gradle file; a shared native
plugin Java source compiled beside the staged resident classes is a path in
`residentHost.helpers` (staged verbatim from the pin unless upstream reviews a rewrite for it).

For affected pull requests, GitHub Actions builds both variants and uploads artifacts. Repository verification runs once per change;
main-branch pushes repeat only that inexpensive integration check. Full resident
qualification and Firefox/macOS WebKit runs are explicit dispatches. See
[CI cost and qualification policy](docs/ci-cost-policy.md) for selection and commands. A successful APK job does not establish full AOSP image or physical
hardware acceptance. Use revision-bound CI artifacts and test reports to establish what was actually run.
