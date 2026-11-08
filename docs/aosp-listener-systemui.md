# Listener SystemUI source work — issue #424

This is partial source implementation of ADR 0001, not an image build, boot,
indicator observation or device acceptance. The independently controlled Listening
chip and lock/AOD acceptance remain open. Alpha remains nonprivileged; no other
product's UI is imported.

## Exact source and implemented patch

The inspected Pixel source has `frameworks/base` revision
`94b4c163b7dfe5ce3607f7bb8456f9573f7de57d`. The two original files are bound by
SHA-256 in `vendor/eliza/packages/os/android/sense/systemui/manifest.json`, together with the current
Pixel source-lock hash. `microphone-ops.patch` adds `OP_RECORD_AUDIO_HOTWORD` and
`OP_RECORD_AUDIO_SANDBOXED` at exactly three sites:

- `AppOpsControllerImpl.OPS_MIC`, which also feeds subscription and microphone
  paused/sensor-privacy handling through `isOpMicrophone`.
- `AppOpsPrivacyItemMonitor.OPS_MIC_CAMERA`, which admits microphone events.
- The same monitor's `toPrivacyItemLocked` mapping to `TYPE_MICROPHONE`.

Existing camera, ordinary microphone, call and trigger operations are retained.
The existing visibility exemptions and muted/silenced-client filtering are
unchanged. The listener image overlay still clears the six intelligence roles and
sets `ro.hotword.detection_service_required=true`; it does not grant Alpha new
permissions. No AppOps policy remapping or framework audio semantics are changed.

## Assistant gesture identity

`vendor/eliza/packages/os/android/sense/systemui/assist` is a separate one-file bundle for
hardware invocation. It adds `opts.setShareIdentityEnabled(true)` to
`AssistManager.startAssistActivity` (preimage SHA-256 `6ee15ad5…cb176`, postimage
`66c7a2ff…92b45`) so the assistant activity that SystemUI launches for press-and-hold power can
read SystemUI as its caller. It grants no permission and changes no other launch. Prepare and
verify it like the other bundles with `--assist`:

```sh
node scripts/aosp-listener-systemui.mjs --source /absolute/original-aosp --assist --output /absolute/new-assist-overlay
node scripts/aosp-listener-systemui.mjs --source /absolute/disposable-build-copy --assist --after
```

Image staging and the Pixel source check record it with `--applied-systemui-patch assist`. Without
it, press-and-hold power still opens Alpha's assistant but does not start a voice turn. It has not
been compiled or booted.

## Development build procedure

1. Verify the original complete Pixel source and factory image with the existing
   source contract, and stage the product using the existing Pixel development
   procedure in [Pixel staging](pixel10a-staging.md). Retain that original receipt.
   When a listener APK is staged, `stageListener` copies the entire listener
   configuration, including this patch and manifest, into `listener/systemui` in
   the staged output. It does not apply patches to the input source.
2. Produce a separate two-file overlay from the original source:

   ```sh
   node scripts/aosp-listener-systemui.mjs --source /absolute/original-aosp --output /absolute/new-systemui-overlay
   ```

   The destination must be new and outside the source. The tool validates exact
   preimages, patch and baseline-lock hashes, runs `git apply` on temporary copies,
   validates exact postimages, then emits the files and `derived-source.json`.
   It never changes the supplied AOSP source. A changed baseline requires review.
3. Create a separate disposable build copy of the fully verified source. Before
   copying the two overlay files into it, run the CLI with `--source` pointing to
   that copy (without `--output`) to check its preimages. Copy only the generated
   `frameworks/base/packages/SystemUI` files into the build copy. Verify with:

   ```sh
   node scripts/aosp-listener-systemui.mjs --source /absolute/disposable-build-copy --after
   ```

4. Keep both original and derived receipts with build inputs. The derived receipt
   verifies **only the two patched files**, not the remaining source tree. It is
   not interchangeable with the complete Pixel source receipt. The ordinary
   source-lock verifier intentionally rejects this modified tree; no overrides
   are added to that lock, and its historical receipt is not relabeled. Re-staging
   still uses the original verified tree. Build the disposable copy with the
   staged development product and retain the exact patch and all other changes.
   Production staging and all app/listener/image qualification gates remain in force.

## Remaining implementation and acceptance

The pinned SystemUI already has `MODIFY_AUDIO_ROUTING` and `GET_APP_OPS_STATS`.
A separate system-owned monitor can observe `AudioManager` recording
configurations rather than trust a listener broadcast. The next implementation
must bind the sense package to its verified installed UID/current user and track
unsilenced recording sessions, including any future isolated UID ownership.
It must not infer active listening from consent or a foreground notification.
There is currently no isolated speech process in ADR 0001; do not fabricate that
mapping or accept caller-provided UIDs.

That monitor needs a persistent surface independent of the normal privacy event
animation, with explicit keyguard and doze/AOD integration. The existing
`PrivacyDotViewController.shouldShowDot` suppresses the dot while shade or QS is
expanded or an AV control chip duplicates it. Adding AppOps codes does not prove
any lock/AOD rendering or an unhideable independent indicator. Test recording,
pause, muted/silenced capture, screen off, keyguard, shade, QS, rotation, user
switch, process death, and indicator render failure against actual SystemUI.

Pause must use an authenticated action and must never enable or resume listening
while locked. The listener control provider is protected by the Alpha signature
permission; platform-signed SystemUI cannot simply call it as though it shared
Alpha's signer. Use a narrowly scoped existing listener-issued pause action or a
separately reviewed image IPC contract. Keep resume behind unlock and consent.
Do not add research-only audio retention or deletion controls: ADR 0001 keeps no
recorded audio.

Required next evidence: compile SystemUI at the pinned source with both additions;
run native SystemUI active/noted, muted/silenced and user-boundary tests for both
operations; then image boot and physical Pixel visual checks of all indicator
surfaces, pause reliability, audio coexistence and battery/thermal gates G1–G6.
The current host regression applies the real patch, checks all three mappings,
and, when `ALPHA_SYSTEMUI_TEST_SOURCE` names the pinned source, verifies original
and patched hashes and mutation rejection. These are source tests only.

The separate [Listening chip source candidate](aosp-listening-chip.md) adds a `--chip` preparation bundle, required by every staged listener product (staging includes its overlay and records it in `listener/evidence.json`). Its independent monitor/views, Pause action and indicator health lease (source and host tests only) do not complete G3: SystemUI compilation and image/device qualification remain blockers. The original two-file microphone-op bundle and its receipt retain their original scope.
