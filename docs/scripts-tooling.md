# Repository tooling

JavaScript host tooling under `scripts/` is TypeScript, executed directly by the
repository's Node 26 runtime. Use the commands in `package.json` or the relevant
runbook. `npm run typecheck:scripts` checks the retained host modules and their
fixture ports with strict TypeScript settings. The product typecheck remains
separate; `npm run typecheck` runs both.

Pinned upstream tooling is loaded from its original reviewed path at runtime.
Its implementation and native dependencies remain upstream-owned; this product
checks its own call boundaries without editing the vendor checkout.

The unused combined-agent device/proxy helpers and local ASR wrapper had only
their isolated unit suites as consumers; they and those suites were removed.
The redundant combined-agent fingerprint CLI and Calendar mutation import alias
were also removed. Active callers use the canonical source manifest and pinned
Calendar service directly. Declaration-only companions for Cloud modules now
live beside their implementations in the same TypeScript files.

## Python and shell consolidation review

The 43 Python files and two shell entrypoints were reviewed for callers, shared
helpers and runtime requirements. They remain in their existing languages.
The unused `verify-aosp-listener-apk.py` alias was removed; the canonical verifier
is `vendor/eliza/packages/os/scripts/android/verify-sense-apk.py`. The remaining
42 Python files and both shell entrypoints retain their native dependencies and
separate qualification gates.

| Group | Consolidation assessment |
| --- | --- |
| Resident CI and recovery | `resident_fixture.py`, `resident_native_source.py`, `resident_absence.py` and `recovery_ui_guard.py` share frozen APK/source admission, absence and UI admission logic. Keep the campaign entrypoints separate: they supervise different process, permission, ownership and recovery phases. |
| Signing and artifact admission | Acquisition, private storage, signing-input admission, sealing, custody proof and qualified publication enforce different trust boundaries. Keep their independently pinned workflow entrypoints and inert refusal tests; combining them would broaden authority rather than remove an unused caller. |
| Regional Maps | `dataset_manifest.py` is already the common inventory/sealing guard. Preparation, PyOsmium indexing and the SQLite/HTTP gateway have different dependencies and lifetimes. Their scripts and tests remain used by `dev:maps` and regional dataset diagnostics. |
| Native/AOSP adapters | Thin adapters delegate generic verification/staging to the pinned upstream Python tools while retaining Alpha policy and stable documented commands. Keep that boundary instead of duplicating the upstream implementation. |
| Audio, image and reproduction tools | Emulator gRPC, image comparison, model conversion and Linux seccomp reproduction have explicit native/runtime dependencies and documented or campaign callers. They are manual diagnostics, not production startup code. |
| Shell bootstrap | Host JSON preparation runs before the repository dependencies are installed; Cloud signing-input admission preserves a separate protected workflow entrypoint. These are not interchangeable bootstrap commands. |

The Java and Gradle files below are native parser/compiler inputs:

| Input | Consumer |
| --- | --- |
| `scripts/owner/InspectUpdateApk.java` | `update-apk-admission.ts` runs Android's APK signature verifier. |
| `scripts/owner/VerifyApkRotation.java` | APK signing, pilot rotation and release CI verify Android signing lineage. |
| `scripts/aosp-unsigned-debug.init.gradle` | The documented AOSP developer build passes it to Gradle. |
| `scripts/ci/calendar-bridge.init.gradle` | The Calendar bridge build passes it to Gradle. |

Fixtures in `scripts/fixtures/`, JSON configuration, HTML entrypoints and the
GraphHopper YAML configuration are data or application fixture assets.

## Android JSON serializer diagnostic

The portable `test/native-notification-device-slot.test.mjs` checks the enrollment
key contract. The separate Android serializer causality diagnostic needs a
reviewed SDK source directory containing `org/json/*.java` and a JDK:

```sh
ALPHA_ANDROID_JSON_SOURCE=/absolute/reviewed/android-sdk/sources/android-36.1 \
  node --test scripts/test-android-notification-device-slot.ts
```

It compiles the Android JSON serializers and checks the native owner lookup and
review fence against independently generated renderer key bytes. Unavailable
annotation/context types use closed test stubs. This is a host JVM diagnostic;
it does not establish APK, emulator, real-service or physical-device acceptance.
