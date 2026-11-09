# Launcher application updates

This is the APK update path for both the Alpha AOSP launcher and the same launcher
APK installed on stock Android. A released APK contains the renderer, styles,
icons, native bridge and packaged resident runtime. Changes to any of those ship
together in a signed APK with a higher `versionCode`. A Git commit or web build
alone does not reach a phone.

No phones have been distributed or installed yet (owner clarification, November 9,
2026). Start the batch on one admitted production-signed launcher baseline. The
pending lab-to-production signing rotation is not permission to sign a rotating
release; newly provisioned phones can start directly with the production family.

```mermaid
flowchart LR
  A[Reviewed source] --> B[Build and qualify signed APK]
  B --> C[Upload versioned APK]
  C --> D[Verify anonymous HTTPS bytes]
  D --> E[Publish stable manifest]
  E --> F[Active launcher checks periodically]
  F --> G[Verify package, flavor, version, signer and hash]
  G --> H[Idle check, retain drafts, stop resident]
  H --> I[Android self-update]
  I --> J[Reconcile installed APK and restart]
```

## Phone behavior

Production Android checks at startup/resume and while the app remains active,
with a 15-minute answered-check interval. Failed upkeep retries after 1, 2, 4, 8
and then 15 minutes. One owner runs at a time. Backgrounding invalidates pending
renderer reads; disposal cancels its timer. This is foreground launcher upkeep,
not an OS background scheduler or an independent recovery supervisor.

The shared scheduler and mounted update gate are implemented in
[Eliza PR 39166](https://github.com/elizaOS/eliza/pull/39166). The original OTA branch pinned the
reviewed, source-identical commit `099e2d27ad7268fac0832c4a7e84cc707d2cf03e`; the
[source comparison receipt](evidence/launcher-ota-upstream-source-20261109.json)
and [Cloud APK build receipt](evidence/launcher-ota-cloud-apk-build-20261109.json)
remain historical evidence: the APK receipt names product commit `e359d8d928`
and upstream `b1817660a0`, while the source comparison names `099e2d27ad`.
Neither describes the integrated package identity. The integrated
Alpha Compute branch pins `6f414658b08cf8075d8fb12ece2ec968a221af7e`, which contains
the final reviewed scheduler and mounted gate directly. The earlier authenticated
`app-update-resume-client` patch is retired. The shared gate captures focused
editing before modal focus changes and keeps automatic refusal quiet while
retaining exact native activation acknowledgements. Earlier build evidence does
not transfer native, APK or device qualification to this integration.

Automatic installation requires Android 12/API 31 or newer and Android's existing
**Install unknown apps → Alpha Phone** permission. Provision that permission once
before distributing the batch. The automatic path never opens Android Settings or
an install dialog by itself. The manual Settings update action remains available
to enable permission and to support older versions of Android.

The launcher waits for idle Home, without voice, a focused editor, a review,
an open app, Home editing, drawer or shade. It checks again at native preparation after the
download: beginning work during a download prevents automatic activation. Every
live renderer must retain its drafts before the resident stops. Existing native
session binding and durable runtime-pause admission remain the authority across
process death and APK replacement. A download, status request or retry does not
authorize another commit of an uncertain session.
Native admission also requires a focused, resumed and unlocked main activity.
On the Alpha image, an active or unknown Telecom call state defers automatic
activation. These checks repeat after staging and after resident shutdown.

Android owns the final unattended-install decision. The app requests
`USER_ACTION_NOT_REQUIRED` and declares the normal
`UPDATE_PACKAGES_WITHOUT_USER_ACTION` permission; it remains nonprivileged.
Android can still require user action, including developer verification. The
existing update gate then offers **Continue update** and keeps the resident paused
until the session settles. An Android confirmation lost with process death can
remain fenced until Android settles/expires that session. This does not establish
unattended delivery on every OEM/version or automatic recovery from a broken
launcher. [Android self-update conditions](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)).

APKs must be HTTPS, exactly the declared SHA-256 and size, at most 2 GiB,
this package, the installed flavor and signing family, and exactly the offered
newer version. Android verifies installation signatures. The temporary download
and PackageInstaller copy can require twice the APK size in free storage.
The native speech payload can exceed the former 1 GiB bound; qualify the actual
compressed APK size and slow-network behavior for each release.

## Publishing

The public channel is the `app-stable` release in the public Alpha repository;
the configured manifest is
`https://github.com/eliza-research/alphaphone/releases/download/app-stable/alpha-update-stable.json`.
No such release existed when this work began. Do not use a private repository or
a temporary signed QA URL for distributed phones.

Build the strict native chain with `npm run android:build:local`, or select the
already documented explicit Cloud profile and its genuine resident payload.
Run APK verification on the signed files, including the required exact-APK voice
qualification evidence. Both standalone and launcher distribution variants remain
build/verification obligations. For these two delivery surfaces, publish the
**launcher** variant: a standalone APK over the image would remove HOME behavior.

To inspect a candidate without uploading:

```sh
node scripts/publish-update-manifest.mjs --variant launcher \
  --apk-manifest /absolute/qualified/apk-manifest.json
```

To deliver that admitted candidate with the existing GitHub CLI authentication:

```sh
node scripts/deliver-app-update.mjs --variant launcher \
  --apk-manifest /absolute/qualified/apk-manifest.json --notes 'Release notes'
```

Preparation refuses a non-distributable/private-QA/test-mocks release, mismatched
bytes, signer or archive identity. Publication creates the public rolling release
only after candidate admission, uploads an immutable versioned APK, anonymously
streams/hashes its public download, and then replaces the manifest. It verifies
the public manifest after replacement and writes
`artifacts/app-update-delivery.json`. Hashing uses bounded memory for large native
APKs. No bearer token is sent to the phone's public download URL.
The receipt's `publisherCommit` identifies the tooling checkout, not APK source
provenance. Retain the independently verified producer/runtime records beside it;
creating the rolling Git tag does not prove the APK was built from that tag.

One publisher must own the channel at a time. GitHub release replacement is not
atomic and has no compare-and-swap operation. The command refuses a channel that
changed during delivery, older versions than the current pointer **or retained
APK inventory**, a changed offer at an existing version, or a different
flavor/signing family. A manifest replacement can briefly return 404. An upload
failure is a failure; retry the identical candidate and inspect the release.
Never overwrite a versioned APK or delete newer retained APKs to lower the floor.
Preserve older releases and the last working launcher as recovery inputs.

The shared URL currently publishes a single launcher offer. The reader supports
a multi-family/flavor index, but this publisher deliberately refuses index
transitions. Publishing standalone and launcher simultaneously requires a reviewed
index publisher; the two deployment methods requested here both use launcher.

The current protected signing jobs require reviewed producer/signing inputs and
the release environment. This change does not bypass their independent approval
or exact-APK qualification. A fully automatic merge-to-production release must
connect those existing gates before enabling continuous publication. Merging
source alone is not currently a production release trigger.
The [qualified publication workflow](runbooks/publish-qualified-app-update.md)
provides the protected bridge from exact private Cloud signing output and reviewed
voice evidence to public delivery. Its existing producer limits differ from the
application's 2 GiB update limit; native speech releases use the admitted local
delivery path until a native producer bridge is separately qualified.

## Disposable Android platform probe

Run `node scripts/test-automatic-update-platform.mjs --owned-emulator --serial=emulator-5554 --output=/absolute/new-output`
only for a disposable, owned API 36 emulator. The script builds and installs its
separate fixture package, exercises PackageInstaller self-update and retained
state, writes receipts, and removes the package afterward. It requires the
Android SDK/build tools and Java 21 described in the build setup. This measures
the platform API; product APK, HOME, AOSP image, real-service and physical-device
acceptance remain separate.

## Acceptance on the phone host

Retain a baseline and candidate with the same production signing family, launcher
flavor and runtime profile; the candidate has a strictly higher code. Store their
APK hashes, source pins and verification receipts. Use an owned test unit before
the batch. The phone is on another machine; no physical-device acceptance has
been observed from this workspace.

Use the integrity readback helpers from `scripts/pilot-update.mjs` for the
before/after receipts. That script's complete command uses `adb install -r`;
running it instead of step 2 proves an ADB replacement, not the OTA path.

1. Install the admitted baseline and select it as HOME. Enable install permission.
   Read back package, signer, code, source path and HOME. Save a local note, an
   unsent draft, settings and a resident conversation; retain content-free
   integrity receipts with `scripts/pilot-update.mjs`'s per-domain readback tools.
2. Deliver the candidate through the real anonymous channel. Leave Home active
   without tapping Install. Observe automatic discovery, native preparation,
   Android replacement and return to HOME. Independently read the installed APK
   hash/code/signer, role holder and resident runtime identity.
3. Confirm notes, drafts, preferences, credentials and conversation history remain
   usable. Exercise genuine sign-in/inference/voice against the installed signed
   candidate. A fixture or an OS-only installer probe cannot establish these.
4. Exercise offline discovery, interrupted download, an edit/voice session begun
   during download, low storage, permission revoked, process death, reboot and
   Android confirmation fallback. Restore connectivity and verify progress or
   an honest pending outcome, with no repeated commit or lost state.
5. Reject wrong signer, package, flavor, hash, size, same/older version and malformed
   manifest. Verify a later higher-code release reaches a phone that skipped one.
   Repeat for an image-preinstalled launcher and a sideloaded launcher.

APK recovery is a separately qualified, higher-version installation with compatible
data schemas, not an Android downgrade. The AOSP OS OTA requirement P-75 still
needs the separate signed-channel `update_engine` client, image/slot/reboot and
stock-recovery drills. APK self-update does not update OS partitions or prove those
gates. [Grace review](ota-grace-review-2026-11-09.md) records which upstream mechanisms
exist and which production paths are disabled.
