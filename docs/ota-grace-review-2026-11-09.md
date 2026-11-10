# OTA review: Grace and Alpha Phone — November 9, 2026

## Result and scope

Grace has substantial OTA trust, installer, recovery and test infrastructure, but
its production discovery and automatic activation are disabled. It is a useful
reference for mechanisms and failure cases, not evidence that unattended updates
already work on distributed phones.

This review inspected Grace commit
[`b25d728686715987cbb01b5cadb8aed031a96393`](https://github.com/gracefultechnology/grace/tree/b25d728686715987cbb01b5cadb8aed031a96393)
through authenticated GitHub read access and a separate, unmodified reference
checkout. Grace is private. Its public repository URL returned 404; no visibility,
signing, enrollment or publication settings were changed. Paths below refer to
that exact Grace commit unless explicitly identified as Alpha paths.

The Alpha comparison began at
`335a1f8f5fde3a5254862e5ace80d5defa4af6cb`, with shared upstream pin
`b1817660a0347ae19551b9ee296410fe55f02d59`. Grace's upstream pin is
`7743504b7c936a764b3938a44cad918808b621df`. A mechanism in one pin must not be
assumed present or equivalent in the other. No Grace identity, UI, signer, trust
root or owner-specific policy is imported by this review.

The owner subsequently clarified that the planned batch includes both AOSP
images and sideloaded launcher APKs, and that no phones have been distributed or
installed yet. Both delivery surfaces use the launcher flavor; a single launcher
feed therefore covers this batch. A fresh production signing family can be
chosen for its baseline. Retained laboratory signing/rotation records do not
establish a deployed-user migration requirement or approve the pending rotation.

## Findings in Grace

| Area | Source evidence | Consequence |
| --- | --- | --- |
| Production discovery and activation | `apps/updater/android/src/main/java/technology/graceful/grace/updater/OtaPolicyRuntime.java:23-34,61-63` defines and wires `UNCONFIGURED` discovery and `NOT_ENABLED` activation. `apps/updater/trust/README.md:23-33,185-189` confirms no production controller calls preparation. | There is no working automatic production update loop to copy or claim qualified. |
| Independent supervisor | `apps/updater/android/src/main/AndroidManifest.xml` declares a separate updater application, jobs, boot/package-replacement receivers and device-admin receiver. `PackageInstallCoordinator.java:13-38` injects product package/distribution/signer into shared mechanics. | A separate supervisor can survive a broken launcher and observe replacement independently. A self-updating launcher alone cannot provide the same failure independence. |
| Silent-install authority | Updater manifest requests `UPDATE_PACKAGES_WITHOUT_USER_ACTION`; `apps/updater/scripts/test-android-ota-installer.mjs:78-96` explicitly provisions Device Owner on a disposable emulator. | A HOME role or system installation alone is not proof of silent-install authority. Grace's Device Owner fixture does not qualify Alpha's distinct API 31+ self-update route; Android's exact conditions and any required owner consent must be tested. |
| Scheduling | `OtaPolicyScheduler.java:10-20,32-42` uses persisted discovery/download/activation jobs; `policy/ApprovedPolicy.java:18-28` specifies six-hour discovery with jitter, unmetered downloads, charging, battery/thermal/idle gates and a local maintenance window. | Native scheduling can operate without reopening Settings. Grace's owner-approved intervals are product policy, not Alpha defaults or authorization. |
| Active-use gates | `AndroidDeviceSignals.java:30-62` observes network, power, temperature, screen-off duration, calls, media, recording, camera, cast, navigation and critical-task state. Exceptions or unknown observations defer. | Installation must respect active voice, calls, edits and workflows; background timing alone does not establish safe activation. |
| Trust and channels | `apps/updater/trust/README.md:3-33,68-75` composes commit-pinned upstream TUF trust, separate Stable/Beta authorities, distinct-signature thresholds and enrolled identity. `docs/implementation/ota-release-contract.md:9-17` distinguishes descriptor validation from authentication. | HTTPS plus a descriptor hash is not authenticated channel policy. Signatures, sequence/floor persistence, enrollment, expiry and revocation add protections beyond APK signing. |
| Commit freshness | `CommitFreshness.java:6-15,33-61` accepts only exact `eligible` under current signed-time bounds. `PackageInstallCoordinator.java:58-69` reads current observations and evaluates freshness under the journal lock immediately before commit. | A staged candidate must not bypass current revocation, channel or security-floor state. Missing freshness inputs refuse activation. |
| Signed time | `apps/updater/trust/README.md:173-189` requires signed Roughtime acquisition; unavailable quorum may reuse only a still-qualified same-boot anchor. Other refusals stop that run before preparation. | Metadata expiry and rollout windows need a trustworthy time strategy; clock values supplied in JSON do not authenticate time. Production hardware drift/suspend/power behavior remains separate qualification. |
| Artifact checks | `docs/implementation/ota-release-contract.md:63-69` snapshots bounded descriptor/APK inputs and checks signatures, manifest/package/distribution/version and packaged runtime inventory against independent expectations. | Successful release build or source review alone is insufficient. Inspect the exact uploaded and installed bytes. |
| Recovery pair | `docs/implementation/ota-release-contract.md:13,49-55`; `PackageInstallCoordinator.java:40-48` require retained, authenticated candidate/recovery identities, same signer, higher recovery versionCode and compatible writable database schemas. | Recovery is a forward installation, not an Android downgrade. A previous APK is not automatically a compatible recovery package. |
| Durable installer readback | `SupervisorScheduler.java:9-42` arms independent readback before handoff and reconciles pending/unreadable journals. `PackageInstallCoordinator.java:55-69` refuses handoff if scheduling fails. | Unknown installation outcomes must be read back, not treated as failure and blindly retried. Reboot/process death must retain session and artifact binding. |
| Native health | `apps/app/native/java/technology/graceful/grace/OtaHealthService.java:4-15` provides product observation ports. `docs/implementation/ota-native-health.md:8-43` documents signature permission, actual sender UID/package/signer, fresh nonce/deadline and installed/process/runtime identity binding. | Health observations must name the exact installed subject and runtime lifetime; stale observations cannot authorize a verdict. |
| Health limitations | `docs/implementation/ota-native-health.md:73-81,152-180` says no production complete renderer/persistence probation verdict, production policy/scheduler or crash-attributed watchdog is enabled. | Existing health APIs do not establish automatic rollback/recovery. Cloud/network unavailability must not count as local corruption. |
| Release publication | `apps/updater/release/publication-authorization.mjs:9-50` binds graph verification, independent source/signer inputs, fresh APK preflight and durable floors. `docs/implementation/ota-release-contract.md:98-126` describes durable journal and atomic timestamp compare-and-swap. | Publish immutable artifacts/dependencies first, verify readback, then atomically advance the discovery pointer. Reconcile uncertain publication writes; do not overwrite blindly. |
| Missing production infrastructure | `apps/updater/trust/README.md:53-67,94-111` says signing keys, publication storage/CAS adapter and public release readback are not configured, and no OTA release can be published. | Grace's proposed destination is not an operational release channel. Alpha needs its own real publication authority and anonymously readable download path. |

Grace's implementation docs explicitly mark several older local JavaScript tools
and old artifact reports as historical and absent from the current tree
(`docs/implementation/ota-release-contract.md:3`). Those descriptions are not
current executable pipeline evidence.

## Tests and models: what they do and do not establish

Grace's installer runner declares its scope precisely at
`apps/updater/scripts/test-android-ota-installer.mjs:58-62`: real
disposable-emulator Device Owner silent update and cached recovery, with an
**injected health decision**; no automatic watchdog, fallback HOME, product
runtime, AOSP image or physical acceptance. The runner also checks recovered
activity rendering and persisted readback after reboot. These are useful test
designs, but were not executed by this review.

Health runners separately exercise stopped and running local agent/gateway
observations, process/runtime lifetime changes, actual WebView visibility and
diagnostic SQLite behavior (`docs/implementation/ota-native-health.md:52-71,84-150`).
Structural database checks do not prove semantic data preservation, credential
durability, schema compatibility or side-effect reconciliation.

The TLA models in `apps/app/formal/updater` cover installer-journal interleavings
and fresh admission. `manifest.json` includes positive configurations, seeded
failure cases and reachability witnesses. Several `today.*` configurations
deliberately retain counterexamples; repair configurations use `allFixes` and
forward variants. The manifest is recorded model evidence, not a fresh model run
or proof that production controller wiring is enabled. The important modeled
cases include write-ahead install handoff, competing workers, lost callbacks,
evidence ordering, torn/lost state, freshness expiry, revocation, sequence
equivocation and recovery liveness.

No Grace tests, models, APK builds, emulator sessions, image boots or physical
phone updates were run by this source review. No new Grace qualification is
claimed.

## Alpha baseline and concrete gaps

At the inspected Alpha baseline:

- `apps/app/src/prototype/settings-adapter.ts:219-238,694-695` checks on app
  start/resume and offers an explicit Install update action. It does not itself
  provide background autonomous installation.
- `android/app/src/main/AndroidManifest.xml:19-20` documents ordinary Android
  owner-confirmed installation. `AlphaDevicePlugin` already validates package,
  version, signer, bounded APK length and hash and coordinates session/pause
  recovery; preserve those checks and its mounted/startup barriers.
- `scripts/publish-update-manifest.mjs:7-13,75-87` writes a locally admitted
  release APK and manifest, then instructs the operator to upload them. It
  performs no publication or remote readback.
- `app.config.json:8` selects the public GitHub `app-stable` manifest URL. On
  November 9, `gh release view app-stable --repo eliza-research/alphaphone`
  returned `release not found`, and an anonymous HTTPS GET of the configured
  manifest URL returned **404**. Therefore no usable public stable update was
  available at that endpoint during this review. This is a timestamped
  observation, not a permanent assertion about hosting.
- Standalone and launcher share a package ID and replace one another. Channel
  publication and client admission must keep their artifacts separate and must
  not silently switch an installed user's distribution.
- `app.config.json` defaults to versionCode 1. Published release versions must
  advance from the actual installed/publication inventory, including retained
  recoveries, rather than reuse this source default.

The remaining implementation and qualification work is:

1. Publish only an admitted, exact signed release; verify anonymous remote APK
   and manifest bytes before exposing the update pointer. Enforce monotonic
   versions and isolate launcher/standalone selection.
2. Add autonomous native scheduling/discovery with retry/backoff and lifecycle
   recovery. Keep the manual Settings path useful for status and immediate
   checks. Keep production mocks disabled.
3. Define and test the exact permitted installation route. Ordinary APKs may
   require Android confirmation; unattended managed or image delivery requires
   its independently provisioned authority and qualification.
4. Reuse the existing mounted dirty-state flush and resident pause/startup
   admission. Verify all relevant bridges are quiescent before commit and that
   failure/cancellation restores the correct prior runtime state.
5. Read back installed version/hash/signer and HOME after replacement and
   reboot. Verify local account binding, notes, history and resident restart
   without reading content into the evidence report.
6. Before claiming autonomous recovery, provide an independent supervisor,
   qualified candidate/recovery pair, compatible migrations, subject-bound
   health/probation verdicts and reliable recovery HOME behavior.
7. Exercise happy path plus interrupted transfer, installer cancellation,
   process death, reboot, unknown callbacks, wrong signer/hash/version/variant,
   unavailable network and active-use deferrals. Bind reports to exact APK
   hashes and source commits. Model the behavior actually implemented and
   execute refinement/conformance checks against real boundaries.
8. Run repository verification and both Android distributions; then record
   emulator/HOME, full-image, physical-device, real-service and user acceptance
   independently. A host test or emulator fixture cannot close the distributed
   phone acceptance gate.

This document is a source-review artifact. The implementation campaign's fresh
tests, build outputs and end-to-end evidence must be recorded separately against
the resulting source revision.

The Alpha publication inspector also checks the candidate's binary target SDK.
Android API 37 requires target SDK 35 or higher for the self-update route without
user action; Alpha's current target is 36. This requirement advances with Android,
and the installer can still request user action. See the official
[PackageInstaller session policy](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)).
