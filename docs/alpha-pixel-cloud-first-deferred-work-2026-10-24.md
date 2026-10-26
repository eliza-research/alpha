# Alpha Pixel: cloud first, deferred on-device work

Recorded October 24, 2026 (America/Los_Angeles), at the user's explicit request to keep a local completion checklist. Deferred items remain open for a later implementation pass.

## Current user decisions

- First device: Pixel 10a, `stallion`, SKU `GE1GQ`; Android 17 development image.
- Inference and speech: **Eliza Cloud Gateway → Cerebras text/LLM, Cartesia STT and TTS**.
- Initial activation: **tap / power button**. The user explicitly chose to defer always-on activation to a later build for faster bring-up.
- Select the existing **`cloud` runtime profile** explicitly for runtime staging and Android builds. The repository's default `native` profile remains a separate configuration with its own prerequisites.
- The resident Eliza agent, PGlite history, approvals, native adapters and device actions still execute on the phone. Cloud selection moves model and speech inference to the gateway.
- Continue implementation in this chat/workspace; no handoff to Shaw was requested.

Source baseline for this preparation: Alpha `9f94a486367ba56d687665b8a6599863772fa5c9`, pinned Eliza `58dfddf87ee5adec414746a86a23dada124fbbae`, OS tooling `b7366b138498d0544433689589e585f24badc87c`. These identify the inspected inputs and do not establish release acceptance.

## Deferred implementation checklist

| ID | Open work | Resume inputs and completion evidence |
| --- | --- | --- |
| LOCAL-01 | Offline speech assets and native speech libraries | Produce the pinned Paradee TTS, Phonon-2 STT, VAD, lexicon, eSpeak data and notices; build the pinned native engine for ARM64 and x86_64; verify every size and SHA-256 in `android/voice-host/qualified-voice-host.json`. Stage with `scripts/android-stage-voice-models.mjs`. Artifact integrity and device qualification are separate. |
| LOCAL-02 | Native inference / local embeddings configuration | Reproduce or obtain the exact reviewed embedding-host libraries and BGE model; use `scripts/build-embedding-host.mjs`, `scripts/stage-embedding-host.mjs` and the `native` runtime profile. Preserve source/worker/model provenance. A fully offline LLM is a separate product decision; this checklist does not promise one. |
| LOCAL-03 | Always-on activation | Resume `android/sense` and `android/aosp/listener`, governed by ADR 0001. The existing listener uses local speech and has no network access. Build it separately with the same app signer and admitted speech assets; retain explicit consent, visible notification, signature-protected IPC and user boundaries. |
| LOCAL-04 | SystemUI listening indicator and lease | Compile the reviewed SystemUI op-list/chip changes into the actual image. Verify visible indicator leases across lock screen, AOD, display-off, fullscreen, shade and SystemUI restart; capture must stop when the lease is lost. Source and host tests alone leave this open. |
| LOCAL-05 | Integrated speech and listener device qualification | Execute microphone capture, recognition, speech playback, streaming/cancellation, barge-in, transcript retirement, permission revocation and restart tests. Then prove listener stop/pause, before-first-unlock, foreground-user isolation, calls, competing recording, Bluetooth/media coexistence, crash-loop handling, echo suppression, battery and thermal behavior on the exact Pixel image, including the multi-hour and 24-hour checks in ADR 0001. |
| LOCAL-06 | Listener isolation hardening | Evaluate ADR gate G7: dedicated SELinux domain / isolated speech process with appropriate network boundaries. The current source uses `priv_app`; G7 remains explicitly deferred. |

The initial cloud build omits the always-on listener. Its absence must remain visible as unavailable in the product. Tap/power activation and cloud voice need their own actual device evidence.

## Resume sequence

1. Retain the accepted cloud APK/image hashes, source receipts and device evidence before starting a separate native artifact workspace.
2. Read `docs/fused-speech.md`, `android/voice-host/qualified-voice-host.json`, `android/embedding-host/qualified-host.json`, `docs/adr/0001-privileged-listener.md` and `android/sense/qualified-listener.json` at the source revision being resumed.
3. Enumerate native prerequisites:

   ```sh
   npm run android:build:inputs
   node scripts/android-stage-voice-models.mjs --plan
   ```

4. Use the canonical pinned native builders in a dedicated prepared source/output tree. The current voice host pins native fork `6003a10368d8a6d5fb1f70fe9c63a70866e8bcff`; re-check the record when resuming. The inspected native toolchain is Node 24.15.0, Bun 1.4.2, NDK 28.2.13676358, CMake 4.0.3 and JDK 21. Retain candidate provenance and compare rebuilt bytes before staging.
5. Stage recorded voice output with `node scripts/android-stage-voice-models.mjs --from /absolute/verified-output`. Build/stage the embedding host through the existing commands. Differing candidate binaries require their own review and execution evidence. Keep qualification false while acceptance is missing; the hosted-only unrecorded-engine path is not release admission.
6. Prepare the exact resident source and workflow worker, stage the explicit native profile, build both Android distributions, and run the product's verification gates. Use fresh artifact directories so the accepted cloud baseline remains reproducible.
7. Build the separate listener, apply its exact source-bound SystemUI changes, stage a new development image, then execute ADR gates G1–G6. Revisit G7 separately.
8. Mark an item complete only with retained evidence for that exact source/APK/image/device. Record user acceptance separately from component, APK and image tests.

## First cloud Pixel bring-up still to finish

- [x] Complete the cloud-profile APK archive and verify standalone + launcher variants with test mocks off. Retained locally under `builder/cloud-build-archive/test-results/gcp-cloud-20261024-json`; 1,804 tests passed, 6 skipped, source-input digests unchanged. Release variants are unsigned and non-distributable.
- [x] Produce the unsigned debug launcher with the same payload as the verified archive; normalize native ZIP storage/alignment and sign locally with the lab identity. `builder/launcher-cloud-lab/SIGNED-LAUNCHER.json` records signature, unchanged 2,032-entry payload, stored native libraries/DEX and 16 KiB ZIP alignment. The exact Android 17 Soong presigned checker passed; no private lab key was uploaded.
- [x] Complete the Pixel source checkout, exact 16 source overrides and vendor generation; compare all 6,360 recorded generated files. All 1,087 project revisions, 16 overrides and 6,360 vendor files passed on the reconstructed development source. See `builder/STALLION-VENDOR-COMPARISON.json` and `builder/STALLION-RECONSTRUCTION-DELTA.json`.
- [x] Resolve and document source-contract metadata differences before staging. The reconstructed development lock records current manifest serialization and the actual pinned extraction-tool dependency closure; source project revisions, override bytes and vendor bytes are unchanged. Registered project sets were separately checked equal (1,087, no extra or missing). The candidate remains development-only, with no release qualification.
- [x] Stage the admitted cloud launcher into the Pixel development product; the no-listener overlay passed physical source and native payload admission.
- [x] Finish the exact image compilation and retain build/artifact receipts. Compilation completed October 25 at 13:05 PDT; the canonical development install package was subsequently verified. `alpha-pixel-image.service` writes `/aosp/receipts/PIXEL-IMAGE-COMPILE.json`; `alpha-pixel-artifact-verification.service` waits for success, checks archive CRCs, embedded APK identity, matching image hashes and AVB, then writes `/aosp/receipts/PIXEL-ARTIFACT-VERIFICATION.json`. Automatic shutdown waits for both services. After the first run stopped at 144,200/181,733 steps, the user authorized removal of the premature time limits. The GCP eight-hour cap and service runtime limits were removed on October 25; completion-based automatic shutdown remains enabled.
- [ ] Boot and verify the exact image, then exercise real Eliza Cloud sign-in, Cerebras inference, Cartesia microphone transcription / playback, HOME and power-button invocation on the intended hardware.
- [ ] Obtain explicit approval for phone unlock/wipe/flash after the build, recovery inputs and data-loss implications are concrete. No bootloader unlock, wipe, flash or persistent settings change has been made. A read-only Developer options inspection confirmed OEM unlocking is available and off; a user-requested temporary keep-awake session is running during development.

## Signing, updates and release work retained for later

Encrypted **development lab** keys and an APK keystore were generated locally, outside Git. Twelve signature round trips and AVB public serialization were verified. Public metadata is in the local preparation directory's `builder/LAB-SIGNING-READY.json` and `builder/LAB-KEY-FINGERPRINTS.json`; private lab keys have not been uploaded to the VM.

- [x] Sign and verify the normalized development launcher APK with the separate lab identity.
- [ ] Complete development image signing/verification and retain exact boot evidence.
- [ ] Select and enroll the authorized company production identity through the existing A-06 policy and `vendor/eliza/packages/os/android/signing/README.md` ceremony, custody and recovery requirements. Lab key generation does not fill this requirement.
- [ ] Record reviewed APK, platform, AVB and OTA public identities in the production descriptors only when authorized; retain independent release/qualification roles where required.
- [ ] Complete signed update, interrupted update, compatible rollback and stock recovery drills with known-good release evidence.
- [ ] Retain hardware, privacy, power and user acceptance evidence before changing release qualification status. Current production trust descriptors and qualification flags remain unfulfilled.

## Local preparation records

Preparation directory:

```text
/Users/nubs/.local/state/alpha-aosp-pixel10a-20261025
```

Useful records under `builder/`:

- `ALPHA-PIXEL-BUILD-INTENT.json`: user-selected providers, profile and activation scope.
- `SOURCE-SYNC.json`: completed pinned AOSP platform sync and resolved-manifest digest.
- `ANDROID-SDK.json`: selected SDK/NDK/CMake and approved SDK license installation.
- `VERIFICATION.json`: local Alpha source/web verification; separate from a cloud APK/image result.
- `LAB-SIGNING-READY.json`, `LAB-KEY-FINGERPRINTS.json`: public lab signer metadata and checks.
- `STALLION-SOURCE-MAP.json`: exact platform/device project mapping and manifest serialization comparison.
- `FACTORY-DOWNLOAD-PINS.json`: factory inputs approved for download/extraction and recovery retention.
- `*.sh`, provisioning receipts and service logs: actual builder preparation and build commands.

Cloud receipts live under `/aosp/receipts` on `alpha-aosp-builder` in GCP project `alpha-aosp-lab-20261024`. Read their current status before continuing: queued or running jobs are not completed builds. The original eight-hour cap was removed on October 25 at the user's request. Completion-based automatic stop remains enabled; persistent disks continue to consume credits after compute stops.

Resume instruction: **After the cloud Pixel build is accepted, reopen this checklist and complete LOCAL-01 through LOCAL-06 in order of dependency, preserving the accepted cloud baseline and recording exact new evidence.**

## Verified development package — October 25

The full image compile passed. Initial byte-for-byte comparison found standalone and target-files `vendor_boot.img` differed. Inspection proved all 523 ramdisk paths, content hashes, ownership, mode, link count, timestamps and special-device numbers equal; 40 CPIO inode identifiers, entry ordering, compression and AVB salt differed. AOSP `GetVendorBootImage` rebuilds the archive image from `VENDOR_BOOT/RAMDISK`. No platform source or firmware file was patched to hide this difference.

The fix is to use one coherent target-files image set, packaged with AOSP `img_from_target_files.py`. Full archive CRC, unchanged Alpha APK, every packaged image identity, A/B partition presence and AVB signature/hash/hash-tree verification passed. The original mismatch receipt remains retained.

- Local package: `pixel-install/alpha-stallion-cloud-userdebug-images.zip` under the preparation directory.
- Package SHA-256: `2e120780a56d55d4edf0683a6b933cd4d01fb72297066071ba0abacf4c258d14`.
- Target-files SHA-256: `42080c18fb237c52a625610e643e3d404f9c96d7e7ec181664926de17ae24daf`.
- Verification: `pixel-install/PIXEL-CANONICAL-PACKAGE-VERIFICATION.json`.
- Matching firmware: Google bootloader `stallion-17.0-15819938` and modem `g5400i-260604-260807-B-16035863`; local hashes matched the extracted factory inputs.
- Install plan: `pixel-install/INSTALL-PLAN.json`; no device commands executed.

The Alpha APK is lab-signed; platform/AVB use development test identities. Company production trust is still unenrolled. Do not relock this development image. Initial OEM enablement, bootloader unlock, wipe and flash await explicit approval; the Pixel was absent from ADB at the latest check. Hardware boot and Cloud voice acceptance remain open.

## First physical installation — October 25

The user explicitly approved OEM unlocking, bootloader unlock with data wipe, and flashing this Pixel. OEM unlocking was enabled with UI readback; fastboot reported `get_unlock_ability: 1`. The user confirmed the bootloader unlock on the phone; subsequent readback was `unlocked: yes`. Device serial `67091JEA315441` and product `stallion` were checked before firmware installation.

The exact Google bootloader and modem were flashed and their required versions read back. `fastboot --skip-reboot -w update` of the verified canonical image package completed with exit 0; all 12 sparse super chunks wrote successfully. The bootloader remains unlocked, slot a was selected, and reboot was requested. Logs and `FLASH-RESULT.json` are retained in `pixel-install/`. First boot and provider acceptance are still pending; successful flashing is not boot acceptance.

Both original Android 16 and matching Android 17 factory recovery archives are retained locally and SHA-256 verified. A downgrade to Android 16 is not guaranteed after the firmware update. The GCP builder was stopped after downloads; persistent source/output disks and build cache remain retained.

## Latest app update and native sign-in — October 25

The cloud-profile launcher from Alpha PR621 product `b88796bd9372daca69fe203be9a70fb85b3e183d` and SDK349235f was built on GCP, with one verification-only correction for the existing legacyNotes accessibility helper. Full verification: 1,943 pass, six skip, zero fail; typecheck/web/audit and all four Android variants/lint passed. The identical unsigned launcher payload was normalized and signed with the existing Pixel lab identity, then installed in place as version11.

Initial inspection found the automatically resumed Home process still mapped the ROM base APK and old JS bundle despite PackageManager reporting the update. Cancelling the old attempt and performing a normal force-stop/cold launch loaded the `/data/app` APK and `index-CHIxMR3D.js`. The current Alpha mark/Google/email chooser is visible directly. This was a loaded-process identity problem; no product auth patch was applied.

The native readiness cache initially reported false. After natural expiry, a fresh 3,863ms probe returned inApp/email/google true; retry cleared the unavailable message. Initial probe failure cause remains unproven. No cache, DAL, registration or credential security gate was forced. User sign-in and real voice acceptance remain pending. Detailed receipt: `builder/pr621-cloud-update/SIGNED-UPDATE.json`.

Branding now uses existing Alpha assets, the pinned generic elizaOS/os boot packer and native Android DeviceDefault/Material roles. All native Settings/controller/navigation trees are retained. Compile/image/device acceptance remains separate; current broader scope is recorded in `android/aosp/branding/README.md`. No extra data wipe is planned.

## Current decisions and acceptance order — October 26

The earlier pending states above are historical. The Pixel has booted Alpha Android 17,
Alpha is its default Home, the user is signed in, and the single requested $10 credit
was verified on the backend and phone. Do not replay that grant. The current receipt is
`pixel-install/CREDIT-GRANT-COMPLETED.json`.

The user explicitly selected **Home and Back only**, without Recents or quick-switch.
This is the intended exception to preserving existing features. Keep Android's gesture,
security, accessibility and input engines; apply the product policy in
`android/aosp/branding/home-back-keyboard.patch`. The keyboard gets Alpha colors and
labels, while an existing selected theme and all typing features remain intact.

The user then requested **Mac/browser-first development**, with the physical Pixel used
for final device acceptance. Reuse the already working Eliza Cloud Gateway path for
Cerebras and Cartesia; do not create a new voice stack or repeat provider setup.
The Home drag fix and one-tap Cloud voice entry were committed as `5a3b9a962` and
integrated by the coordinator as `6c1e160`. Browser regression and focused checks pass;
current Cloud voice and final device acceptance must remain explicitly separate.

Current owners: coordinator for canonical app integration and audit/source metadata;
local QA for the integrated browser flow; this lane for OS branding, Home/Back,
keyboard, packaging and final Pixel checks. Leave the simulator owner's manual QA alone.
The live completion checklist is `pixel-polish/COMPLETION-CHECKLIST.json` under the
preparation directory. Final packaging must embed the accepted Cloud launcher APK with
the Pixel's existing signer and preserve the phone's signed-in data.
