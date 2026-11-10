# 12 — AOSP fork: always-on listening, implementation spec

> **Superseded in part (2026-10-13, [decision P-42](../decisions.md)).** On-device and local speech and inference use only libelizainference (llama.cpp/ggml, GGUF models). ONNX Runtime, sherpa-onnx and ONNX-format models named in this section are historical research context, not a plan.

Builds on [10 — always-on technical feasibility](10-always-on-tech-feasibility.md). Audience: platform/AOSP engineering, security, product and legal.

**Decision context.** The team has decided to fork AOSP into a custom signed image for a Pixel 10-class target. Banking apps, Play Integrity and GMS are out of scope. The goal is always-on listening that works with any app in the foreground, with the screen off and while the device is locked. Audio feeds an on-device ASR → redaction pipeline. A recording indicator must be impossible to hide, and the user must consent.

**Status.** This is a specification; nothing in it has been built, booted or measured. The repository contract still applies: an APK build, an emulator HOME-role test, a full AOSP image boot, real integrations and device/user acceptance are separate gates (see [`AGENTS.md`](../../AGENTS.md) and [`docs/android-and-aosp.md`](../android-and-aosp.md)).

**This is a deliberate departure from ADR-04.** [`docs/architecture.md`](../architecture.md) ADR-04 ("no implicit privileged bundle") and [`docs/decisions.md`](../decisions.md) item 5 ("additive, nonprivileged") say Alpha is admitted as a non-privileged app. Always-on capture needs privileged components. A new ADR must approve that before any of this lands. This spec keeps the existing Alpha app non-privileged and adds a separate, small, privileged, network-less package.

**Evidence.**
- The framework claims below come from AOSP source on `android.googlesource.com` at `refs/heads/main` as of 2026-10-02, with exact file paths given.
- The repository's Pixel lock pins `android-17.0.0_r1` (`vendor/eliza/packages/os/android/pixel11pro.lock.json`). `main` can differ from that tag, so every cited line must be re-checked at the pinned tag before implementation. That re-check is item V1 in §13.
- **(unverified)** marks a claim not confirmed from a primary source. **(est.)** marks an engineering estimate.

---

## 1. Executive summary

1. **The platform already has every permission we need, but the honest path is narrow.** `CAPTURE_AUDIO_HOTWORD`, `CAPTURE_AUDIO_OUTPUT`, `MANAGE_SOUND_TRIGGER`, `EXEMPT_FROM_AUDIO_RECORD_RESTRICTIONS` and `BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION` are all `signature|privileged` (some also `|role`). A privapp allowlist grants them to a priv-app. `RECORD_BACKGROUND_AUDIO` is `internal|role`, and only the `SYSTEM_SHELL` role grants it. Do not use it.
2. **Three silent-recording traps exist in stock AOSP, and the fork must close all three:**
   - (a) The `SYSTEM_AMBIENT_AUDIO_INTELLIGENCE` (and related) role holders are **exempted from the privacy indicator** by `PermissionManager.EXEMPTED_ROLES`.
   - (b) Capture through `AUDIO_SOURCE_HOTWORD` notes `OP_RECORD_AUDIO_HOTWORD`, which is **not an indicator op**, unless `ro.hotword.detection_service_required=true`.
   - (c) HotwordDetectionService capture is remapped to `OP_RECORD_AUDIO_SANDBOXED`, which also shows **no indicator**.

   Our package must hold none of the exempt roles. We set the sysprop. SystemUI gets an independent "Listening" chip derived from AudioFlinger state, not from app self-report.
3. **Background start and boot are solvable for a system app.**
   - A system app with `android:persistent="true"` runs at `PROCESS_STATE_PERSISTENT`. That state is ≤ TOP, so `ActiveServices` grants while-in-use and a microphone FGS is allowed.
   - `START_ACTIVITIES_FROM_BACKGROUND` (privileged) is a second documented exemption.
   - The Android 14/15 `BOOT_COMPLETED` microphone-FGS ban is avoided because a persistent app is started by the system, not by a broadcast receiver. It still needs on-device confirmation (V3).
4. **Concurrency rules decide the UX.**
   - Since Android 10, only the top or latest-started ordinary client gets real audio; the rest receive silence.
   - Calls always win unless the client can bypass the concurrency policy.
   - `HOTWORD`-source clients never mask other apps. That makes `HOTWORD` the right source for a background listener that must always yield.
   - The pipeline must watch `AudioRecordingConfiguration.isClientSilenced()` and show "Paused — mic in use".
   - We do **not** grant call capture.
5. **Power is the hard limit on an AP-only design.**
   - AudioFlinger's `RecordThread` holds a wakelock while capture is active, so the AP never suspends while we listen.
   - DSP gating would fix this. Pixel's AOC DSP does run sound-trigger models: the vendor image ships `music_detector.sound_model` files for Now Playing. Those models are Google's opaque format, and no public toolchain exists to load our own **(unverified; spike S1)**.
   - Plan for AP VAD at first, budgeting ≈5–10%/day (est.), with DSP/CHRE gating as a research spike.
6. **Copy the HotwordDetectionService privacy model; do not reuse the service for continuous ASR.**
   - The framework enforces HDS isolation: it must be `isolatedProcess` (not external), and the VoiceInteractionService must **not** hold the bind permission.
   - `isolated_app_all` SELinux policy bans creating any non-`AF_UNIX` socket.
   - The `isolated_compute_app` domain adds GPU access plus a vendor-extensible `isolated_compute_allowed_device` attribute, which is our NPU route.
   - HDS egress is a single size-limited result object. That is the right pattern for our egress gate.
7. **Process architecture.**
   - A new privileged `ai.elizaresearch.alphaphone.sense` package with **no `INTERNET` permission**, a custom SELinux domain `alpha_sense_app` with network `neverallow`s, a persistent mic FGS, and AP VAD.
   - ASR and redaction run in an `isolatedProcess` child, CPU first, NPU later.
   - A single signature-protected egress binder hands **redacted text only** to the existing non-privileged Alpha app.
   - pKVM/Microdroid is not viable for the ASR path: it has no HALs, so no NPU/GPU, and device assignment needs a vendor VM DTBO that Pixel does not ship **(unverified)**. Use it only for the key/ledger.
8. **Pixel 10 is buildable without Google device trees, but through GrapheneOS's tooling.**
   - Google stopped publishing Pixel device trees and driver binaries with Android 16. It moved the AOSP reference target to Cuttlefish.
   - Pixel kernel source is now delivered via a request form, slowly, and as a single squashed file.
   - AOSP source drops happen only twice a year (Q2/Q4) from 2026.
   - GrapheneOS's `adevtool` (branch 17) already has `frankel/blazer/mustang/rango/stallion` configs. It ships stable Pixel 10 releases on Android 17 (release 2026092500). The repo's existing Pixel 11 Pro lock uses the same tooling, so a Pixel 10 lock is a mechanical extension.
9. **Distribution and legal gates are first-order risks.** They are the redistribution rights for extracted Pixel vendor blobs **(unverified, legal review)**, all-party-consent law, BIPA for diarization, and bystander signalling. Pixel 10 has no hardware mic switch. The software toggle and an always-visible chip are the honest floor, and a Motorola/GrapheneOS-class OEM could add a hardware switch (2027).
10. **Effort (est.):**
    - First userdebug always-on build with indicator and consent on Pixel 10: ~10–14 weeks for 2–3 platform engineers plus 1 ML engineer.
    - Release-signed `user` build with OTA, SELinux hardening and a 7-day dogfood: +8–12 weeks.
    - DSP/NPU/pVM spikes in parallel.

---

## 2. What the repository's image tooling already does

From `vendor/eliza` (read-only, pinned) and `android/`:

| Item | Finding | Path |
|---|---|---|
| Product layer | `eliza_common.mk` installs the Eliza APK as a **privileged, platform-signed** app (`certificate: "platform"`, `privileged: true`). It ships privapp and default-permission XML, sets roles via overlay, and adds `BOARD_VENDOR_SEPOLICY_DIRS += vendor/eliza/sepolicy`. Known gap: `PRODUCT_PACKAGES -=` is a no-op, so de-bloat relies on Soong `overrides`. | `vendor/eliza/packages/os/android/vendor/eliza/eliza_common.mk`, `apps/Eliza/Android.bp` |
| Privileged allowlist | `PACKAGE_USAGE_STATS`, `SCHEDULE_EXACT_ALARM`, `MANAGE_APP_OPS_MODES`, `MANAGE_VIRTUAL_MACHINE`, `READ_FRAME_BUFFER`, `INJECT_EVENTS`, `REAL_GET_TASKS`, `SYSTEM_ALERT_WINDOW`. No audio-capture privileges. | `.../permissions/privapp-permissions-ai.elizaos.app.xml` |
| Default grants | `RECORD_AUDIO fixed="false"` (user can revoke), plus telephony/SMS `fixed="true"` | `.../permissions/default-permissions-ai.elizaos.app.xml` |
| Roles | `config_defaultHome/Dialer/Sms/Assistant/Browser = ai.elizaos.app` | `.../overlays/frameworks/base/core/res/res/values/config.xml` |
| SELinux | One broad rule, `allow platform_app app_data_file:file { execute execute_no_trans }`, plus `platform_app_36` userdebug rules. The README records that a custom `eliza_agent` domain tripped about 30 neverallows. Custom domains must go through `seapp_contexts`/seinfo tied to a separate signing cert. | `.../sepolicy/eliza_agent.te` |
| Voice components (upstream app) | `ElizaVoiceCaptureService` (FGS `microphone`, a lifecycle anchor only), `ElizaVoiceInteractionService` (thin VIS, no HotwordDetectionService, `supportsLaunchVoiceAssistFromKeyguard=true`), `ElizaRecognitionService`, a voice IME | `vendor/eliza/packages/app/platforms/android/app/src/main/...` |
| Hardware targets | `pixel9a-tegu` (Android 15 r31, pinned) and `pixel11pro-grizzly` (`android-17.0.0_r1`, `cp2a`, generated via **GrapheneOS adevtool** `refs/heads/17` plus a stock kernel). **No Pixel 10 lock.** `decisionNote` flags this as an open owner decision. | `vendor/eliza/packages/os/android/hardware-targets.json`, `pixel11pro.lock.json` |
| AVB | Lock uses `external/avb/test/data/testkey_rsa4096.pem`, authorized as `public-aosp-userdebug-test-key`. No release key yet. | `pixel11pro.lock.json` |
| Pixel audio blobs (grizzly spec) | `android.hardware.audio.service-aidl.aoc`, `aocd`, `aoc.bin`, `libaoc.so`, the `aoc_*` kernel modules, many CHRE nanoapps (`/vendor/etc/chre/*.so`), `contexthub-service.generic`, `edgetpu` (`com.google.edgetpu.tachyon-service`, `darwinn` NNAPI). There is no separate sound-trigger VINTF fragment in the extracted list. | `vendor/eliza/packages/os/android/vendor-specs/grizzly-cd1a.260905.001.b1.yml` |
| Alpha app | Package `ai.elizaresearch.alphaphone`. Flavors `standalone`/`launcher` (same ID). Has `RECORD_AUDIO`, `INTERNET`, an `IsolatedPdfService` with `isolatedProcess="true"` (an in-repo precedent), and an `ACTION_ASSIST` activity. Admitted to AOSP as a **non-privileged presigned** import. | `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `docs/android-and-aosp.md` |

**Implications.**
- Do not make the Capacitor/WebView Alpha app privileged. It has `INTERNET` and a large attack surface.
- Put the microphone in a new, minimal priv-app with its own signing key, its own seinfo/SELinux domain, and no network.
- Reuse the upstream vendor layering pattern: product makefile, privapp XML, overlays, `BOARD_*_SEPOLICY_DIRS`. Do not edit `vendor/eliza`. Generate `vendor/alphaphone/` in the AOSP checkout.

---

## 3. Permissions, roles and framework rules (verified in source)

### 3.1 Protection levels (`frameworks/base/core/res/AndroidManifest.xml`, main)

| Permission | Protection level | Use in Alpha fork |
|---|---|---|
| `RECORD_AUDIO` | `dangerous\|instant`; `backgroundPermission=RECORD_BACKGROUND_AUDIO` | Pre-grant via default-permissions with `fixed="false"`. The user can revoke it, and revoking it stops the feature. |
| `RECORD_BACKGROUND_AUDIO` | `internal\|role`. Granted only by the `SYSTEM_SHELL` role, for CTS (`roles.xml`). | **Do not use.** |
| `CAPTURE_AUDIO_HOTWORD` | `signature\|privileged\|role` | **Grant.** Needed for the `AUDIO_SOURCE_HOTWORD` source. `AudioService.updateAssistantUIdLocked` only treats the assistant-role holder as the "assistant UID" if it holds this permission. |
| `CAPTURE_AUDIO_OUTPUT` | `signature\|privileged\|role` | **Do not grant.** Until the new bypass flag ships everywhere, it doubles as the concurrency/call-capture bypass (`AudioPolicyInterfaceImpl.cpp`: "remove forcing canBypassConcurrentPolicy to canCaptureOutput"). It would let us record calls and system output. |
| `BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION` | `signature\|privileged`, behind flag `android.media.audio.concurrent_audio_record_bypass_permission` | **Do not grant** (calls/VoIP stay unrecorded). Revisit only for an explicit, announced call-notes feature with legal sign-off. |
| `EXEMPT_FROM_AUDIO_RECORD_RESTRICTIONS` | `signature\|privileged\|role` ("Exempt this uid from restrictions to background audio recording") | Optional fallback if persistent/WIU does not cover a path (V3). Prefer not to. |
| `MANAGE_SOUND_TRIGGER` | `signature\|privileged\|role` | Grant only in Phase 3 (DSP spike). |
| `SOUND_TRIGGER_RUN_IN_BATTERY_SAVER` | `signature\|privileged` | Phase 3. |
| `BIND_HOTWORD_DETECTION_SERVICE` / `BIND_VISUAL_QUERY_DETECTION_SERVICE` | `signature`; the system binds | Declare as the service guard only. The VIS app must **not** hold it (enforced). |
| `MANAGE_HOTWORD_DETECTION` | `internal\|preinstalled` | Not needed. |
| `RECEIVE_SANDBOX_TRIGGER_AUDIO` | `signature\|privileged\|appop` | Only if we adopt VIS+HDS for a wake phrase (Phase 3). Its op **is** an indicator op. |
| `START_ACTIVITIES_FROM_BACKGROUND` | `signature\|privileged\|vendorPrivileged\|oem\|verifier\|role` | Fallback WIU exemption if we choose not to be `persistent`. |
| `START_FOREGROUND_SERVICES_FROM_BACKGROUND` | same | Optional. |
| `FOREGROUND_SERVICE_MICROPHONE` | `normal\|instant` | Required for the FGS type. |
| `ACCESS_ULTRASOUND` | `signature\|privileged` | Not needed. |
| `MANAGE_VIRTUAL_MACHINE` | privileged (already in Eliza's allowlist) | Phase 3 pVM key/ledger only. |

### 3.2 Roles (`packages/modules/Permission/PermissionController/res/xml/roles.xml`, main)

- **`android.app.role.ASSISTANT`**
  - `defaultHolders="config_defaultAssistant"`, `exclusivity="user"`, `requestable="false"`.
  - Qualifies through a VIS with `sessionService`, `recognitionService` and `supportsAssist`, or through an `ACTION_ASSIST` activity.
  - Holding it makes the app the AudioPolicy "assistant UID" **only** if it also holds `CAPTURE_AUDIO_HOTWORD` (`AudioService.updateAssistantUIdLocked`). That gives the extra capture rights in §4.
  - The assistant role and the listener should be **different packages**: the Alpha app is the visible assistant, and the sense package is the listener. If we make the sense package the VIS instead, it gains assistant concurrency privileges. Decision D2 in §12.
- **`android.app.role.SYSTEM_AMBIENT_AUDIO_INTELLIGENCE`**
  - `config_systemAmbientAudioIntelligence`, `static`, `systemOnly`, invisible.
  - Grants `CAPTURE_AUDIO_OUTPUT`, `CAPTURE_MEDIA_OUTPUT`, `CAPTURE_VOICE_COMMUNICATION_OUTPUT`, `MODIFY_AUDIO_ROUTING`, `RECORD_AUDIO`, `CAPTURE_AUDIO_HOTWORD`, `EXEMPT_FROM_AUDIO_RECORD_RESTRICTIONS`, `MANAGE_SOUND_TRIGGER`, `LOCATION_HARDWARE`, `MANAGE_MUSIC_RECOGNITION`, `OBSERVE_SENSOR_PRIVACY` and `READ_PHONE_STATE`.
  - The role comment requires CDD §9.8.6 compliance. It also says holders "MUST NOT request INTERNET permission" and may only bind to a short allowlisted set of system packages via `<allow-association>`.
  - **That is exactly our privacy model, but this role is indicator-exempt** (§3.4). **Do not assign it to our package.** Adopt its rules (no `INTERNET`, explicit `allow-association`) by construction instead.
- `SYSTEM_AUDIO_INTELLIGENCE` (`config_systemAudioIntelligence`) is similar and adds in-call/caption permissions. It is also indicator-exempt. Do not use it.
- `SYSTEM_SPEECH_RECOGNIZER` (`config_systemSpeechRecognizer`) grants `RECORD_AUDIO` and `UPDATE_APP_OPS_STATS` to a `RecognitionService` provider. It is optional: it would let the sense package serve `SpeechRecognizer` for other apps. It is not indicator-exempt.

### 3.3 Foreground-service rules (Android 14–17)

- **Microphone FGS** needs `FOREGROUND_SERVICE_MICROPHONE` plus a granted `RECORD_AUDIO`. `RECORD_AUDIO` is a while-in-use permission, so an app in the background cannot create a mic FGS (`SecurityException`). A `BOOT_COMPLETED` receiver cannot start one either: that restriction has applied to `microphone` since Android 14 and was extended to more types in 15 ([FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types), [Android 15 changes](https://developer.android.com/about/versions/15/behavior-changes-15)).
- **Documented while-in-use exemptions** ([background start](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)):
  - started by a system component;
  - started from a widget or notification;
  - a `PendingIntent` from a visible app;
  - a device-owner DPC;
  - **an app providing `VoiceInteractionService`**;
  - **an app holding `START_ACTIVITIES_FROM_BACKGROUND`**.
- **Source of truth.** `frameworks/base/services/core/java/com/android/server/am/ActiveServices.java` `shouldAllowFgsWhileInUsePermissionLocked` allows WIU, among other cases, when:
  - the caller's `uidState <= PROCESS_STATE_TOP` (comment: "PROCESS_STATE_PERSISTENT, PROCESS_STATE_PERSISTENT_UI or PROCESS_STATE_TOP");
  - the caller is ROOT/SYSTEM/NFC/SHELL uid;
  - the caller has `START_ACTIVITIES_FROM_BACKGROUND`;
  - the caller is in `mAllowListWhileInUsePermissionInFgs`, which today holds only the AttentionService and SystemCaptionsService packages;
  - the caller is the device owner.
- **Our choice.** `android:persistent="true"` on the sense priv-app. `persistent` is honoured only for system apps. The process is then started by the system at boot, runs at a persistent proc-state (≤ TOP) and is restarted if killed. AudioPolicy also maps ≤ TOP proc-states to `APP_STATE_TOP` (`apmStatFromAmState`: "include persistent services").
  - Also keep `START_ACTIVITIES_FROM_BACKGROUND` in the allowlist as a belt-and-braces exemption (V3 verifies whether it is needed).
  - **The persistent-at-TOP nuance matters for concurrency.** See §4.
- **systemExempted FGS type** is reserved for DO/PO, emergency role, exact-alarm holders, VPN and similar. It is not a mic substitute: the mic op still requires the `microphone` type.

### 3.4 Privacy indicator: how it works and how stock AOSP can hide it

- **Ops that light the mic/camera chip.**
  - `packages/SystemUI/src/com/android/systemui/privacy/AppOpsPrivacyItemMonitor.kt` `OPS_MIC_CAMERA` lists `OP_CAMERA`, `OP_PHONE_CALL_CAMERA`, `OP_RECORD_AUDIO`, `OP_PHONE_CALL_MICROPHONE`, `OP_RECEIVE_AMBIENT_TRIGGER_AUDIO`, `OP_RECEIVE_EXPLICIT_USER_INTERACTION_AUDIO` and `OP_RECEIVE_SANDBOX_TRIGGER_AUDIO`.
  - `AppOpsControllerImpl.java` has the same list. **`OP_RECORD_AUDIO_HOTWORD` and `OP_RECORD_AUDIO_SANDBOXED` are absent.**
- **Exemptions.** `AppOpsControllerImpl.isUserVisible()` → `PermissionManager.shouldShowPackageForIndicatorCached()` → `getIndicatorExemptedPackages()`, which returns the `android` system package plus the holders of `EXEMPTED_ROLES`:
  - `config_systemAmbientAudioIntelligence`
  - `config_systemUiIntelligence`
  - `config_systemAudioIntelligence`
  - `config_systemNotificationIntelligence`
  - `config_systemTextIntelligence`
  - `config_systemVisualIntelligence`

  Source: `frameworks/base/core/java/android/permission/PermissionManager.java`. The list is refreshed every ≤15 s.
- **Suppression.** `AppOpsControllerImpl.isAllRecordingPausedLocked` hides the chip if the mic is muted, or if every `AudioRecordingConfiguration` for the uid `isClientSilenced()`. That is correct behaviour: silenced clients are not receiving audio.
- **Hotword op.** `frameworks/av/media/utils/ServiceUtilities.cpp` `getOpForSource(AUDIO_SOURCE_HOTWORD)` returns `OP_RECORD_AUDIO_HOTWORD`.
  - `frameworks/base/services/core/java/com/android/server/policy/AppOpsPolicy.java` `resolveRecordAudioOp` downgrades it to `OP_RECORD_AUDIO` (indicator shown) **only if** `ro.hotword.detection_service_required=true`, and then only for non-HDS uids.
  - **With stock defaults (`false`), a privileged app capturing from the `HOTWORD` source shows no indicator.**
- **HDS remap.** `AppOpsPolicy.resolveSandboxedServiceOp` changes the HDS isolated uid's `OP_RECORD_AUDIO` to `OP_RECORD_AUDIO_SANDBOXED` ("Upgrade the op such that no indicators is shown").
- **Timing and flags.** Active means use within 5 s; recent means 15 s; minimum display is 5 s. SystemUI honours `privacy/mic_camera_indicators_enabled` (DeviceConfig namespace `privacy`; `camera_mic_icons_enabled` in `PermissionUsageHelper`) ([AOSP privacy indicators](https://source.android.com/docs/core/permissions/privacy-indicators)). The AOSP doc states, "The System UI verifies that the usage is by a system app" — this refers to the exemptions above.

**Fork rules (all mandatory; together they make the indicator impossible to suppress for our listener):**
1. Overlay `config_systemAmbientAudioIntelligence`, `config_systemAudioIntelligence`, `config_systemUiIntelligence`, `config_systemNotificationIntelligence`, `config_systemTextIntelligence` and `config_systemVisualIntelligence` to `""`.
   - AOSP defaults are empty. Pixel vendor overlays such as `PixelConfigOverlayCommon` may set them **(unverified; check the generated overlay)**.
   - Add a build-time check that none of them equals any Alpha package.
2. Set `ro.hotword.detection_service_required=true` (product property).
3. Patch `AppOpsPrivacyItemMonitor.OPS_MIC_CAMERA` and `AppOpsControllerImpl` to include `OP_RECORD_AUDIO_HOTWORD` and `OP_RECORD_AUDIO_SANDBOXED`. Or patch `AppOpsPolicy` to stop remapping. The SystemUI patch is less invasive.
4. Pin the DeviceConfig flags. Set `privacy/camera_mic_icons_enabled=true` via `PRODUCT_PRODUCT_PROPERTIES`/`DeviceConfig` defaults. Block remote changes: there is no GMS, so no Phenotype exists to push flags anyway.
5. Add an **independent "Listening" chip** (§9.4) driven by AudioFlinger recording state for the sense UIDs, including isolated UIDs. It must not depend on app-ops or app self-report.
6. CTS-style invariant test on device: start capture from every source we use and assert that the chip is visible on the status bar, lock screen and AOD within 500 ms (est. threshold).

### 3.5 HotwordDetectionService / VisualQueryDetectionService: the privacy model to copy

Verified in `frameworks/base/services/voiceinteraction/java/com/android/server/voiceinteraction/`:
- **`VoiceInteractionManagerServiceImpl.java`**
  - Rejects an HDS unless `isIsolatedProcessLocked()`, meaning `FLAG_ISOLATED_PROCESS` and **not** `FLAG_EXTERNAL_SERVICE`.
  - Rejects it unless the service is guarded by `BIND_HOTWORD_DETECTION_SERVICE`.
  - Rejects it if the VIS package **holds** that permission.
  - Applies the same isolation check to VisualQueryDetectionService.
  - Initialization `SharedMemory` is made `PROT_READ`.
- **`HotwordDetectionConnection.java`** binds via `bindIsolatedService` with `BIND_SHARED_ISOLATED_PROCESS` (when allowed), rotating isolated process names (`MAX_ISOLATED_PROCESS_NUMBER = 10`). It registers the isolated uid with AudioPolicy as an assistant-service uid (`addAssistantServiceUid`).
- **`DetectorSession.java`** is the egress point. It logs "Egressed" results, enforces `RECORD_AUDIO` and the voice-activation op (`OP_RECEIVE_SANDBOX_TRIGGER_AUDIO`, an indicator op) plus `CAPTURE_AUDIO_HOTWORD` on the **receiving** VIS identity before data delivery, and copies `HotwordAudioStream`s under app-op checks.
- **The egress payload is small by design.** `HotwordDetectedResult` extras are bounded by `config_hotwordDetectedResultMaxBundleSize` (AOSP default `0`).
- `HotwordDetectionService.java` offers three detection paths:
  - DSP trigger: `onDetect(EventPayload, timeout, cb)`.
  - Mic directly: `onDetect(Callback)`.
  - External stream: `onDetect(ParcelFileDescriptor, AudioFormat, …)`.
- **SELinux** (`system/sepolicy/private/seapp_contexts`):
  - `user=_isolated domain=isolated_app` by default.
  - `user=_isolated isIsolatedComputeApp=true domain=isolated_compute_app`. Neverallows pin those mappings. `isolated_compute_app.te` says it "restricts data egress to protect the privacy". It grants `gpu_device` rw, `hal_codec2`/`hal_allocator` client, dmabuf system heap, and `isolated_compute_allowed_service` / `isolated_compute_allowed_device` (vendor-extensible attributes in `public/attributes`). It may only *use* tcp/udp sockets **received over IPC**; creating new ones is not permitted.
  - `isolated_app_all.te`: "No creation of sockets families other than AF_UNIX sockets."
  - Which framework path sets `isIsolatedComputeApp` for HDS/VQDS hosts is **(unverified; V4)**.
  - Background: Android's Private Compute Core paper describes the same proxy-and-restrict egress design ([arXiv 2209.10317](https://arxiv.org/pdf/2209.10317)).

**Why not run continuous ASR inside the stock HDS:**
- HDS is trigger-oriented, with timeouts and auto-disconnects.
- Its egress is a detection result, not a transcript stream.
- Capture inside HDS is indicator-free by design.
- It requires our package to be the VIS, which gives it assistant concurrency privileges.

**What we copy instead:** isolated process + framework-enforced isolation checks + size-bounded typed egress + egress logging + receiving-side permission checks.

### 3.6 Sound Trigger

- **Stack** ([AOSP Sound Trigger](https://source.android.com/docs/core/audio/sound-trigger)): STHAL (`hardware/interfaces/soundtrigger/`, `ISoundTriggerHw` with `loadSoundModel`, `loadPhraseSoundModel`, `startRecognition`, `stopRecognition`, `unloadModel` and `forceRecognitionEvent`) → `SoundTriggerMiddleware` (sharing, permissions, logging) → `SoundTriggerService` → assistant/generic clients.
  - After a trigger, audio is read through `AudioRecord` with `AUDIO_SOURCE_HOTWORD`.
  - The model data is **opaque/vendor-specific**.
  - In Android 11+, HAL errors force a HAL restart.
- **Pixel.**
  - Hotword and Now Playing run on AOC (always-on compute).
  - The gs-common device config includes `/dev/acd-sound_trigger` (search result on a [gs-common diff](https://android.googlesource.com/device/google/gs-common/+/49e609ba234d9b2a723e455e5ba64b83c376cb99%5E2..49e609ba234d9b2a723e455e5ba64b83c376cb99/)).
  - GrapheneOS's adevtool **excludes** `product/etc/firmware/music_detector.sound_model{,_2,_tflite}`, `music_detector.descriptor` and `product/etc/ambient/matcher_tah.leveldb` (comment: "used by ambient music recognizer") ([file-exclusion.yml](https://github.com/GrapheneOS/adevtool/blob/17/config/device/common/file-exclusion.yml)). That is evidence that Pixel's sound-trigger path consumes Google-format model files that the system loads into AOC.
  - The public `device/google/zuma/device.mk` only has a commented-out Exynos-era `sound_trigger.primary.*` stanza. gs-common `audio/aidl/manifest.xml` is empty. The STHAL is presumably inside the proprietary `android.hardware.audio.service-aidl.aoc` **(unverified)**.
- **Conclusion.** A custom DSP model on Pixel's AOC needs Google's model compiler/format and possibly signing. **Treat it as unavailable on an AOSP/GrapheneOS-style Pixel build until spike S1 shows otherwise.**
  - CHRE on AOC (with the context-hub HAL and many nanoapps present) has a CHRE audio API. Custom nanoapp loading on Pixel likely requires Google signing **(unverified; spike S1b)**.

---

## 4. Concurrent capture

Source of truth: `frameworks/av/services/audiopolicy/service/AudioPolicyService.cpp` `updateUidStates_l()` (main). The [developer summary](https://developer.android.com/media/platform/sharing-audio-input) says: "Two ordinary apps can never capture audio at the same time"; the Assistant gets audio "unless another app using a privacy-sensitive audio source is already capturing"; during calls "The call always receives audio", and other apps can capture only with `CAPTURE_AUDIO_OUTPUT`.

How the rules apply to our listener (S):

| Situation | Rule in `updateUidStates_l` | Outcome for S (source `HOTWORD`, persistent, not assistant) | Outcome if S used `VOICE_RECOGNITION`/`MIC` |
|---|---|---|---|
| Nothing else recording | HOTWORD branch: `onlyHotwordActive && canCaptureIfInCallOrCommunication` | **Captures** | Captures (persistent = TOP) |
| Foreground app starts recording (voice memo, dictation, video) | `onlyHotwordActive` becomes false | **Silenced. Yields automatically**, and HOTWORD clients are excluded from "latest active" so they never mask others. | Both are "TOP" (persistent counts as TOP); **latest started wins**. Our restart after their start would steal audio from the user's app. **Unacceptable.** |
| VoIP (`MODE_IN_COMMUNICATION`) | `canCaptureIfInCallOrCommunication` false unless bypass or comm owner | Silenced | Silenced |
| Cellular call (`MODE_IN_CALL`) | needs `canBypassConcurrentPolicy` | **Silenced (we do not grant bypass)** | Silenced |
| Privacy-sensitive capture (`VOICE_COMMUNICATION`, `CAMCORDER`, or `setPrivacySensitive(true)`) | `allowSensitiveCapture` false | Silenced | Silenced |
| Sensor-privacy mic toggle on | `silenceAllRecordings_l()` | Silenced; chip shows "Mic off" | Silenced |
| Assistant (Alpha app as role holder with `CAPTURE_AUDIO_HOTWORD`) opens `VOICE_RECOGNITION` while on top | assistant branches | S silenced while the assistant session runs, which is fine: the assistant session is the same product | — |
| Accessibility service on top | a11y branches | S silenced unless HOTWORD/VR and a11y rules allow | — |

**Decisions.**
- **D-src.** S captures with `AUDIO_SOURCE_HOTWORD` (`MediaRecorder.AudioSource.HOTWORD` is a hidden/system constant 1999; set it via `AudioRecord.Builder` with system APIs) **if** Pixel's AOC audio HAL serves HOTWORD capture without an active sound-trigger session **(unverified; V5)**. Otherwise:
  - use `VOICE_RECOGNITION` (AGC/NS tuned for ASR; `UNPROCESSED` only if the device reports `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED`, and VAD/ASR then need their own AGC);
  - implement **cooperative yield**: register `AudioManager.AudioRecordingCallback`; stop our `AudioRecord` as soon as any other client config appears; restart only when no other client remains for ≥2 s.
- Always observe `AudioRecordingConfiguration.isClientSilenced()` for our own session and surface "Paused — microphone in use by <app>" in the chip and notification.
- **Never** grant `CAPTURE_AUDIO_OUTPUT`, `BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION`, `CAPTURE_VOICE_COMMUNICATION_OUTPUT` or `CALL_AUDIO_INTERCEPTION`. Calls and VoIP are not recorded by default. A future "call notes" feature needs explicit per-call consent, an audible announcement and legal review.
- **Never capture from `system_server` or `audioserver` context.** `ServiceUtilities.cpp` returns `PERMISSION_GRANTED` for `isAudioServerOrMediaServerOrSystemServerOrRootUid` without noting an app-op, so no indicator would appear. Capture must live in an app uid.

---

## 5. Power

**Facts.**
- `frameworks/av/services/audioflinger/Threads.cpp` `RecordThread::threadLoop()` calls `acquireWakeLock_l()`. While any capture is active, audioserver holds a partial wakelock, so the AP cannot suspend. Doze does not stop it: the wakelock belongs to audioserver.
- Pixel Now Playing reference: a DSP first stage gates the AP and averages <1% battery/day ([arXiv 1711.10958](https://arxiv.org/abs/1711.10958); see [10 §5](10-always-on-tech-feasibility.md)).

**Budget (est.).**
- Pixel 10 battery capacity is unverified here. Assume ~18–19 Wh.
- AP-awake continuous capture with little-core VAD, mic path and audio DSP path: **~30–60 mW** (est.), so **~4–8%/day** before ASR.
- ASR on speech segments only. Assume 2–4 h of speech/day at RTF ~0.1–0.2 on CPU, 1–2 W while decoding (est.): **~2–6%/day**.
- Total target ≤10%/day, matching the [doc 10 M5 gate](10-always-on-tech-feasibility.md). It must be measured (harness in Phase 1).

**Design.**
1. **Tier 0 (AP):**
   - 16 kHz mono, 20 ms frames, energy gate, then a small neural VAD (Silero-class, ~1–2 MB (est.)) on one little core with `SCHED_IDLE`/`THREAD_PRIORITY_AUDIO` for capture only.
   - Keep a 2–5 s pre-roll ring buffer in RAM. Use a large `AudioRecord` buffer (e.g. 200–400 ms) to reduce wakeups. The AP stays awake regardless.
2. **Tier 1:** speech segments are batched (e.g. ≥10 s or end-of-utterance) and passed to the isolated ASR process. Run ASR on big cores at low duty, or on the GPU/NPU later (§6).
3. **Governor:**
   - Pause at <15% battery or Battery Saver (unless the user overrides).
   - Pause at `THERMAL_STATUS_MODERATE`.
   - Pause when the proximity/pocket heuristic plus long silence holds for >N minutes (optional "smart sleep", user-visible state).
   - Schedules (work hours) and "on charger only" modes.
   - Every pause state is reflected in the chip.
4. **DSP path (Phase 3):**
   - S1: Pixel AOC STHAL generic model.
   - S1b: CHRE audio nanoapp.
   - S1c: a non-Pixel OEM with an open DSP toolchain (Qualcomm LPAI/ADSP via an OEM partner).
   - If any works, Tier 0 moves off the AP and AudioFlinger capture starts only after a trigger. That gives near-Now-Playing power.

**Doze/standby exemptions (sysconfig).** `SystemConfig.java` (`frameworks/base/services/core/java/com/android/server/SystemConfig.java`) supports `allow-in-power-save`, `allow-in-power-save-except-idle`, `allow-in-data-usage-save`, `bg-restriction-exemption`, `allow-association`, `install-in-user-type` and `prevent-disable`, among others. Use `allow-in-power-save` and `bg-restriction-exemption` for the sense package. Do **not** use `allow-in-data-usage-save` because the package has no network. Persistent system apps are not subject to app-standby buckets **(unverified for Android 17; V6)**.

---

## 6. Isolation and egress

### 6.1 Options

| Option | Isolation strength | ML acceleration | Verdict |
|---|---|---|---|
| A. Separate priv-app UID, no `INTERNET`, custom SELinux domain | Strong on Android: no inet gid, plus SELinux neverallow on sockets | CPU/GPU/NPU via normal app paths (NNAPI/LiteRT, `edgetpu` vendor service, where reachable) | **Baseline (Phase 1–2).** |
| B. `android:isolatedProcess` child of A (`isolated_app`) | Stronger: no app data, no services except those passed, no socket creation (`isolated_app_all.te`) | CPU only in practice (no GPU device access in `isolated_app`) | **ASR and redaction run here in Phase 1.** |
| C. Isolated *compute* child (`isolated_compute_app`) | Same egress guarantees as B | GPU allowed; NPU if the vendor device type is added to `isolated_compute_allowed_device` | **Phase 3.** Needs a framework patch so our service is spawned as an isolated compute app (V4), plus a vendor sepolicy line for the TPU node (Pixel device type name unverified). |
| D. pKVM protected VM (AVF/Microdroid) | Strongest: memory isolated even from a compromised host | **CPU only.** Microdroid has "no HALs" and no graphics ([Microdroid](https://source.android.com/docs/core/virtualization/microdroid)). Device assignment uses `vfio-platform` and a VM DTBO with assignable devices ([AVF device assignment](https://android.googlesource.com/platform/packages/modules/Virtualization/+/refs/heads/main/docs/device_assignment.md)). Pixel ships no TPU in a VM DTBO **(unverified)**. | **Not for ASR.** Use for the redaction-key and audit-ledger signer, and optionally text-only redaction rules. |

### 6.2 Process architecture

```
                       ┌──────────────────────── SystemUI (patched) ────────────────────────┐
                       │ Listening chip / AOD dot / lock-screen chip / QS tile / dialog     │
                       │ source of truth: AudioManager.getActiveRecordingConfigurations()   │
                       │ filtered to sense UIDs + ISenseStatus (state text only)            │
                       └────────────────────────────▲───────────────────────────────────────┘
                                                    │ (read-only status)
 mic ─► audio HAL (AOC) ─► audioserver ─► AudioRecord (HOTWORD | VOICE_RECOGNITION)
                                                    │
 ┌─────────────── ai.elizaresearch.alphaphone.sense  (priv-app, persistent, NO INTERNET) ─────┐
 │ SELinux domain: alpha_sense_app   data: alpha_sense_app_data_file                          │
 │ ListeningService (FGS type=microphone, directBootAware)                                    │
 │   ├─ ConsentStore (DE storage)  ├─ PolicyGovernor (battery/thermal/schedule/calls)         │
 │   ├─ Tier-0 VAD + RAM ring buffer (never written to disk unencrypted)                      │
 │   └─ binds ─► AsrRedactService (android:isolatedProcess=true, isolated_app)                │
 │                 in: PCM via SharedMemory/pipe, models via read-only SharedMemory/FD        │
 │                 out: TranscriptSegment{text_redacted, spans, labels, t0,t1, conf}         │
 │   EgressGate (the only exported binder; guarded by signature permission)                   │
 │     ├─ schema-checks every segment (no raw text field, no audio, size-bounded)             │
 │     ├─ policy: consent mode, all-party-consent jurisdiction, paused state                  │
 │     ├─ appends hash-chained audit record (optionally pVM-signed, Phase 3)                  │
 │     └─ delivers to subscriber                                                              │
 └──────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                            │ ITranscriptSink (redacted only)
 ┌──────────────────── ai.elizaresearch.alphaphone (existing, NON-privileged, has INTERNET) ──┐
 │ Notes/agent UI, review, rehydration (local vault), cloud agent per user approval           │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Invariants:**
- Raw audio never leaves the sense UID or its isolated child.
- Raw (unredacted) text leaves the isolated child only to the gate, inside the same app UID, and the gate never forwards it.
- Rehydration vault keys stay in the sense package. Alpha displays redacted text unless the user unlocks a span, which is a gate API with user presence. This needs alignment with the redaction design in [04-redaction.md](04-redaction.md).

### 6.3 SELinux policy sketch (system_ext private policy; unbuilt — expect neverallow iteration)

```
# system_ext/private/alpha_sense_app.te   (via SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS)
type alpha_sense_app, domain;
typeattribute alpha_sense_app coredomain;
app_domain(alpha_sense_app)          # note: deliberately NOT net_domain()
# framework services an app normally needs
allow alpha_sense_app app_api_service:service_manager find;
allow alpha_sense_app audioserver_service:service_manager find;
allow alpha_sense_app system_api_service:service_manager find;
# own data
type alpha_sense_app_data_file, file_type, data_file_type, core_data_file_type;
allow alpha_sense_app alpha_sense_app_data_file:dir create_dir_perms;
allow alpha_sense_app alpha_sense_app_data_file:file create_file_perms;

# ---- egress guarantees ----
neverallow alpha_sense_app self:{ tcp_socket udp_socket rawip_socket packet_socket
    netlink_route_socket tun_socket } create;
neverallow alpha_sense_app port_type:tcp_socket name_connect;
neverallow alpha_sense_app { dnsproxyd_socket fwmarkd_socket }:sock_file write;
neverallow alpha_sense_app { netd_service network_management_service
    connectivity_service }:service_manager find;     # (verify type names at tag)
neverallow alpha_sense_app { sdcard_type media_rw_data_file }:file { create write };
# ---- confidentiality of stored artefacts ----
neverallow { domain -alpha_sense_app -init -installd -vold_prepare_subdirs
    -system_server -zygote } alpha_sense_app_data_file:file { read open map };
neverallow { domain -alpha_sense_app } alpha_sense_app:process ptrace;
```

```
# system_ext/private/seapp_contexts
user=_app seinfo=alphasense name=ai.elizaresearch.alphaphone.sense domain=alpha_sense_app type=alpha_sense_app_data_file levelFrom=all
# system_ext/private/mac_permissions.xml (+ keys.conf tag @ALPHASENSE → release cert)
<policy><signer signature="@ALPHASENSE"><seinfo value="alphasense"/></signer></policy>
```

Notes:
- The isolated `AsrRedactService` child is automatically `isolated_app` (`seapp_contexts`: `user=_isolated domain=isolated_app`), which already cannot create sockets. No custom policy is needed for Phase 1.
- `keys.conf` maps tags like `@PLATFORM` to certificates (`system/sepolicy/private/keys.conf`). Add an `@ALPHASENSE` tag in our policy dir.
- Whether `SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS` accepts `seapp_contexts`/`mac_permissions.xml` additions for a new coredomain on Android 17 must be checked in the build (V7). The Eliza tree hit about 30 neverallows trying a custom domain from vendor policy. Core app domains belong in system_ext/product **private** policy, not vendor policy.
- Defence in depth: the package declares no `INTERNET`, so the process gets no `AID_INET` supplementary group and the kernel's paranoid-network check blocks inet sockets. Add `<allow-association>` entries so the sense package can bind only to SystemUI and Alpha (the same mechanism the ambient-audio role comment prescribes).

### 6.4 Egress gate contract

```
// ai/elizaresearch/alphaphone/sense/ITranscriptSink.aidl (implemented by Alpha app)
oneway void onSegment(in RedactedSegment s);       // size ≤ 8 KiB, no audio, no raw text
oneway void onState(in ListeningState st);         // LISTENING|PAUSED_*|MUTED|OFF
// ai/elizaresearch/alphaphone/sense/ISense.aidl (exported by sense; signature permission)
void subscribe(ITranscriptSink sink);              // caller cert must equal Alpha release cert
void pause(int reason, long untilMs); void resume();
void deleteRange(long t0, long t1);                // user right-to-delete
```

- Guard permission: `ai.elizaresearch.alphaphone.permission.SENSE_SUBSCRIBE` (`protectionLevel="signature"`). The gate also checks the caller's signing-cert digest explicitly against a pinned value, like `ChromiumBrowserIdentity`.
- Everything is logged: segment count, bytes, labels, never content. This mirrors `DetectorSession`'s "Egressed …" logs and `HOTWORD_EVENT_EGRESS_SIZE` stats.

---

## 7. Pixel 10 platform reality and alternatives

### 7.1 What changed at Google
- **Android 16 (June 2025).** Google moved AOSP's reference target from Pixel to Cuttlefish. It stopped publishing Pixel device trees, driver binaries and hardware repos. Its statement: "AOSP needs a reference target that is flexible, configurable, and affordable – independent of any particular hardware, including those from Google" ([9to5Google](https://9to5google.com/2025/06/12/android-open-source-project-pixel-change/), [Android Authority](https://www.androidauthority.com/google-pixel-kernel-code-forms-3696441/)).
- **2026.** AOSP source pushes happen **twice a year (Q2 major, Q4 minor)**. Security patches continue via a security-only branch ([Android Authority](https://www.androidauthority.com/aosp-source-code-schedule-3630018/), [PiunikaWeb](https://piunikaweb.com/2026/01/07/android-aosp-source-code-q2-and-q4-pixel-monthly-security-patches-unchanged/)).
- **Pixel kernel source.** It is now requested via a Google Form and delivered by Drive link. GrapheneOS reports this "can now take weeks", delivered "as a single file without an accessible step-by-step update history" ([OpenSourceForU, Aug 2026](https://www.opensourceforu.com/2026/08/google-makes-pixel-kernel-source-harder-to-access/)).
- Public `device/google/gs-common` last saw commits in early 2025 (observed via gitiles log), consistent with the above.

### 7.2 Working path: GrapheneOS adevtool (already used by the repo)
- adevtool branch `17` contains `frankel.yml`, `blazer.yml`, `mustang.yml`, `rango.yml`, `stallion.yml` and `pixel-gen10.yml`, plus `grizzly`/`cubs`/`yogi` for gen 11 ([GitHub API listing](https://github.com/GrapheneOS/adevtool/tree/17/config/device)). It generates device support with `adevtool generate-all -d <codename>`, with no device trees ([GrapheneOS build](https://grapheneos.org/build)).
- **Codenames:** Pixel 10 `frankel`, 10 Pro `blazer`, 10 Pro XL `mustang`, 10 Pro Fold `rango`, 10a `stallion` ([GrapheneOS build](https://grapheneos.org/build)).
- **Kernel.** Gen-10 Pixels build from `kernel_pixel_6.6` (GrapheneOS GitLab, branch `17`) with `build_codename.sh --lto=full` ([GrapheneOS build](https://grapheneos.org/build)). The repo's grizzly lock instead uses the **stock kernel** extracted from the factory image (`USE_STOCK_KERNEL := true`).
- **Status.** GrapheneOS lists the Pixel 10 family as supported, with release 2026092500 (2026-09-25) on Android 17 ([releases](https://grapheneos.org/releases), [FAQ](https://grapheneos.org/faq)).
- **Action.** Add `pixel10-frankel.lock.json` and an `eliza`-style `alphaphone_frankel_phone.mk` mirroring `pixel11pro.lock.json`: adevtool commit, vendor_state, stock factory build ID and hashed vendor spec. Keep the stock kernel for bring-up. Do not edit `vendor/eliza`: the lock and product live in our own overlay repo or a reviewed upstream PR.

### 7.3 Verified boot and OTA
- Generate an AVB key and extract the public key: `avbtool extract_public_key --key avb.pem --output avb_pkmd.bin` ([GrapheneOS build](https://grapheneos.org/build)).
- Flash it to Pixel's `avb_custom_key` partition and relock with `fastboot flashing lock`. The device then boots in the **yellow** state and shows the SHA-256 of our key, which users and Auditor-style attestation can verify ([GrapheneOS CLI install](https://grapheneos.org/install/cli)). Reverting requires `fastboot erase avb_custom_key`.
- **Signing.** Use `sign_target_files_apks` with release keys (`releasekey`, `platform`, `shared`, `media`, `networkstack`, and APEX container and payload keys via `--extra_apks` / `--extra_apex_payload_key`), then `ota_from_target_files -k` ([AOSP sign builds](https://source.android.com/docs/core/ota/sign_builds)). Add our `@ALPHASENSE` key.
- Updater: A/B `update_engine` with a full plus incremental OTA server. GrapheneOS's `generate-release.sh` / `generate-delta.sh` show the flow.
- The current lock uses the public AVB **test** key for userdebug. Production needs HSM-held keys and rollback-index management.
- Without GMS there is no Play Integrity. Key attestation still reports our verified-boot key, which suits enterprise MDM attestation (verify with the chosen MDM).

### 7.4 Alternatives

| Path | Pros | Cons |
|---|---|---|
| **AOSP plus adevtool on Pixel 10 (recommended)** | Best-in-class hardware security (Titan M2, MTE, custom AVB key); repo tooling already exists | Pixel blob redistribution rights **(unverified; legal)**; kernel source latency; no custom DSP models; Google could break extraction |
| Fork GrapheneOS as the base | Inherits hardening, monthly cadence, Pixel 10 support, and a mature OTA/updater | Must track a fast-moving upstream; check trademark and licence terms; its stance on privileged always-on mic components may conflict with its privacy defaults (cultural, not technical) |
| Motorola (GrapheneOS partnership announced MWC 2026; first device 2027) | An OEM willing to meet strict security requirements; potential hardware mic switch and DSP access by contract ([9to5Google](https://9to5google.com/2026/03/01/motorola-confirms-grapheneos-partnership-for-a-future-smartphone-porting-features/)) | Not shippable in 2026; a partnership is needed for DSP/kernel access |
| Qualcomm-based OEM ODM | Open-ish DSP toolchains (Hexagon/LPAI) and mature third-party NPU access (see [doc 10](10-always-on-tech-feasibility.md)) | Device-tree and BSP licensing via the ODM; weaker verified-boot/custom-key story on some OEMs |
| Pixel 11 / Tensor G6 (`grizzly` lock exists) | Already pinned in the repo | Same Google constraints; unvalidated |

---

## 8. Lock screen, screen-off, Bluetooth, multi-user

- **Locked / screen-off.** A persistent FGS keeps running, and audioserver's wakelock keeps the AP up (§5).
  - **Direct boot:** mark the sense package `directBootAware`. **Before first unlock (BFU) do not listen.** Consent and keys may be in credential-encrypted storage, and nobody has authenticated. Show "Listening starts after unlock".
  - **After first unlock (AFU) and locked:** listening is allowed. Write segments only under a Keystore AES-GCM key created with `setUnlockedDeviceRequired(false)`, kept in CE storage, which stays available AFU.
  - The lock screen shows the chip and a "Pause" action **without unlocking**, because pausing reduces capability.
  - "Resume" requires unlock if the user enabled "resume needs auth", following the `config_sensorPrivacyRequiresAuthentication` pattern.
  - Transcript review needs unlock.
- **AOD.** SystemUI must render the listening dot or chip on AOD (`PrivacyDotViewController` and the status-bar events path under `packages/SystemUI/src/com/android/systemui/statusbar/events/`). Verify AOD rendering (V8).
- **Bluetooth headset mics.** The HFP/SCO mic is routed for communication modes and degrades A2DP. LE Audio supports a bidirectional mic.
  - Default to **built-in mics only**. Offer "use headset mic" as an opt-in.
  - If the route changes to BT, show "Listening via <device>".
  - Stop on SCO activation by another app, because the call/comm rules apply.
  - Exact routing for `HOTWORD`/`VOICE_RECOGNITION` with an LE Audio headset is **(unverified; V9)**.
- **Multi-user.**
  - `ROLE_ASSISTANT` and the ambient roles have `exclusivity="user"`.
  - The sense package is installed for the primary/system user only (`install-in-user-type` sysconfig) in v1. Stop on `ACTION_USER_BACKGROUND` and do not run for secondary users or guests.
  - **Work profile:** capture is device-level, while the transcript belongs to the personal profile. For enterprise builds, add a managed-configuration switch so the DPC can disable listening. Honour `DISALLOW_UNMUTE_MICROPHONE` (`UserManager`), which makes the mic toggle stay on **(unverified exact semantics; V10)**.
- **Phone calls.** Calls auto-pause capture (silenced by policy). The state shows "Paused — call".

---

## 9. Implementation spec

### 9.1 New product layer: `vendor/alphaphone/` (in the AOSP checkout; generated or reviewed)

```
vendor/alphaphone/
  alphaphone_common.mk
  products/alphaphone_frankel_phone.mk          # inherit vendor/google_devices/frankel + eliza/common? (D1)
  apps/AlphaSense/Android.bp                    # android_app_import, privileged, own cert, system_ext
  permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml
  permissions/default-permissions-ai.elizaresearch.alphaphone.sense.xml
  sysconfig/alphaphone-sense.xml
  overlays/frameworks/base/core/res/res/values/config.xml
  overlays/frameworks/base/packages/SystemUI/res/values/config.xml   # chip config (new keys)
  sepolicy/system_ext/private/{alpha_sense_app.te,seapp_contexts,mac_permissions.xml,keys.conf,file_contexts}
  init/init.alphaphone.rc
  patches/frameworks_base/*.patch               # SystemUI + PermissionManager/AppOps patches (§9.5)
```

`alphaphone_common.mk` (sketch):
```make
PRODUCT_PACKAGES += AlphaSense \
    privapp-permissions-ai.elizaresearch.alphaphone.sense.xml \
    default-permissions-ai.elizaresearch.alphaphone.sense.xml alphaphone-sense-sysconfig
PRODUCT_PACKAGE_OVERLAYS += vendor/alphaphone/overlays
SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS += vendor/alphaphone/sepolicy/system_ext/private
PRODUCT_PRODUCT_PROPERTIES += ro.hotword.detection_service_required=true
PRODUCT_SYSTEM_EXT_PROPERTIES += persist.alphaphone.listening.default=off   # off until consent
```

### 9.2 Sense app manifest (key parts)

```xml
<manifest package="ai.elizaresearch.alphaphone.sense" android:sharedUserId="(none)">
  <!-- NO android.permission.INTERNET, NO ACCESS_NETWORK_STATE -->
  <uses-permission android:name="android.permission.RECORD_AUDIO"/>
  <uses-permission android:name="android.permission.CAPTURE_AUDIO_HOTWORD"/>
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
  <uses-permission android:name="android.permission.START_ACTIVITIES_FROM_BACKGROUND"/>
  <uses-permission android:name="android.permission.OBSERVE_SENSOR_PRIVACY"/>
  <uses-permission android:name="android.permission.READ_PHONE_STATE"/> <!-- call state for pause UX -->
  <permission android:name="ai.elizaresearch.alphaphone.permission.SENSE_SUBSCRIBE"
              android:protectionLevel="signature"/>
  <application android:persistent="true" android:directBootAware="true"
               android:allowBackup="false" android:debuggable="false"
               android:hasFragileUserData="true" android:usesCleartextTraffic="false">
    <service android:name=".ListeningService" android:exported="false"
             android:foregroundServiceType="microphone" android:directBootAware="true"/>
    <service android:name=".AsrRedactService" android:exported="false"
             android:isolatedProcess="true" android:process=":asr"/>
    <service android:name=".EgressGateService" android:exported="true"
             android:permission="ai.elizaresearch.alphaphone.permission.SENSE_SUBSCRIBE"/>
    <activity android:name=".ConsentActivity" android:exported="false"/>
  </application>
</manifest>
```

### 9.3 Permission and sysconfig XML

```xml
<!-- /system_ext/etc/permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml -->
<permissions>
  <privapp-permissions package="ai.elizaresearch.alphaphone.sense">
    <permission name="android.permission.CAPTURE_AUDIO_HOTWORD"/>
    <permission name="android.permission.START_ACTIVITIES_FROM_BACKGROUND"/>
    <permission name="android.permission.OBSERVE_SENSOR_PRIVACY"/>
    <!-- Phase 3 only: MANAGE_SOUND_TRIGGER, SOUND_TRIGGER_RUN_IN_BATTERY_SAVER, MANAGE_VIRTUAL_MACHINE -->
    <!-- Deliberately absent: CAPTURE_AUDIO_OUTPUT, CAPTURE_MEDIA_OUTPUT,
         CAPTURE_VOICE_COMMUNICATION_OUTPUT, BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION,
         EXEMPT_FROM_AUDIO_RECORD_RESTRICTIONS (add only if V3 proves necessary) -->
  </privapp-permissions>
</permissions>

<!-- default-permissions: granted at first boot but revocable; feature also needs in-app consent -->
<exceptions><exception package="ai.elizaresearch.alphaphone.sense">
  <permission name="android.permission.RECORD_AUDIO" fixed="false"/>
  <permission name="android.permission.POST_NOTIFICATIONS" fixed="false"/>
</exception></exceptions>

<!-- /system_ext/etc/sysconfig/alphaphone-sense.xml -->
<config>
  <allow-in-power-save package="ai.elizaresearch.alphaphone.sense"/>
  <bg-restriction-exemption package="ai.elizaresearch.alphaphone.sense"/>
  <install-in-user-type package="ai.elizaresearch.alphaphone.sense">
    <install-in user-type="FULL"/> <!-- verify: limit to system/primary user (V10) -->
  </install-in-user-type>
  <allow-association target="ai.elizaresearch.alphaphone.sense" allowed="com.android.systemui"/>
  <allow-association target="ai.elizaresearch.alphaphone.sense" allowed="ai.elizaresearch.alphaphone"/>
</config>
```

Whether to pre-grant `RECORD_AUDIO` at all is a product decision. The honest default is **not pre-granted**: the first-run consent flow requests it (D3).

### 9.4 SystemUI changes (`frameworks/base/packages/SystemUI/`)

1. `src/com/android/systemui/privacy/AppOpsPrivacyItemMonitor.kt`: add `OP_RECORD_AUDIO_HOTWORD` and `OP_RECORD_AUDIO_SANDBOXED` to `OPS_MIC_CAMERA` and map them to `TYPE_MICROPHONE`.
2. `src/com/android/systemui/appops/AppOpsControllerImpl.java`: the same op additions. Add a build-flagged assertion that `isUserVisible(sensePkg)` is always true. Log loudly and show the chip anyway if a role misconfiguration hides it.
3. New `src/com/android/systemui/privacy/ListeningPrivacyItemMonitor.kt`, a `PrivacyItemMonitor` registered in `PrivacyModule.java`:
   - It sources state from `AudioManager.getActiveRecordingConfigurations()` (client uid ∈ sense app uid or its isolated uids, resolved via `ActivityManager`) plus `ISense.getState()` for the label.
   - **If AudioFlinger reports active, unsilenced capture for a sense uid, the chip shows, whatever the app reports.** If the app says "listening" but no capture is active, it shows "Starting…".
4. `src/com/android/systemui/privacy/OngoingPrivacyChip.kt` / `PrivacyChipBuilder.kt`: a distinct persistent style ("● Listening", a brand-colour ring, with "Paused"/"Mic off" variants). It is never auto-collapsed by `SystemStatusAnimationSchedulerImpl` while active.
5. Lock screen and AOD: ensure the dot or chip renders via `statusbar/events/PrivacyDotViewController.kt` and keyguard status bar. Add a lock-screen "Pause" affordance.
6. Quick Settings tile "Listening" (pause/resume/schedule), in addition to the stock mic sensor-privacy tile. Enable `config_supportsMicToggle=true` in the framework overlay.
7. `PrivacyDialogV2.kt`: a listening row with "Pause 15 min / 1 h / until tomorrow", "Delete last 5 min" and "Settings".

### 9.5 Framework patches (`frameworks/base`, `frameworks/av`), minimal

| File | Change | Why |
|---|---|---|
| `core/java/android/permission/PermissionManager.java` | Keep `EXEMPTED_ROLES`, but filter out any package with the `ai.elizaresearch.alphaphone.*` prefix or our cert (belt-and-braces) | Prevents a future overlay mistake from hiding our indicator |
| `services/core/java/com/android/server/policy/AppOpsPolicy.java` | Optional alternative to the SystemUI op additions: stop `resolveSandboxedServiceOp` hiding indicators | Only if we adopt HDS in Phase 3 |
| `services/core/java/com/android/server/am/ActiveServices.java` | **None expected** (persistent proc-state). Fallback: add the sense package to `mAllowListWhileInUsePermissionInFgs` via a config array | V3 |
| `services/core/java/com/android/server/policy/PhoneWindowManager.java` | New `config_keyChordPowerVolumeUp` value `3 = toggle listening` (today 0 nothing / 1 mute toggle / 2 global actions), or a double-press-power behaviour | Physical pause gesture |
| `frameworks/av/services/audiopolicy/service/AudioPolicyService.cpp` | **None.** Use the stock concurrency rules | Avoid audio-policy divergence |
| `services/core/java/com/android/server/SystemConfig.java` | None (uses existing tags) | — |

### 9.6 Services and runtime behaviour (sense app)

- `ListeningService` state machine:
  `OFF → CONSENT_REQUIRED → ARMED → LISTENING ⇄ PAUSED_{USER,CALL,MIC_BUSY,MIC_TOGGLE,BATTERY,THERMAL,SCHEDULE,BFU} → OFF`
  - Each state maps to chip text and the FGS notification (`category=service`, ongoing, actions Pause/Settings).
- **Audio:** `AudioRecord` 16 kHz mono PCM16, source per D-src, plus `registerAudioRecordingCallback`. On `isClientSilenced`, go to `PAUSED_MIC_BUSY`. On sensor-privacy toggle, go to `PAUSED_MIC_TOGGLE`.
- **ASR child:** one long-lived isolated process bound with `BIND_AUTO_CREATE | BIND_NOT_PERCEPTIBLE`.
  - Models are passed as read-only `SharedMemory` (the `HotwordDetectionService` pattern) or as an fd to a dm-verity-protected file on `/system_ext` (preferred: the model ships in the image, so its integrity is covered by AVB).
  - Engine: whisper.cpp / sherpa-onnx (Zipformer) / Moonshine, CPU first. The choice comes from the doc 10 measurement harness.
- **Redaction:** in the same isolated child (rules plus a small NER model), producing typed pseudonyms per [04-redaction.md](04-redaction.md).
- **Storage:** RAM ring only for audio. Raw audio is **not persisted** by default. An optional "keep audio 24 h" setting encrypts it with a Keystore key in the sense data dir. Redacted segments are persisted until Alpha acknowledges them.

### 9.7 AOSP files and configs to change or add (real paths)

| Path (AOSP tree) | Action |
|---|---|
| `frameworks/base/core/res/res/values/config.xml` (overlay) | `config_systemAmbientAudioIntelligence`, `config_systemAudioIntelligence`, `config_systemUiIntelligence`, `config_systemNotificationIntelligence`, `config_systemTextIntelligence`, `config_systemVisualIntelligence` set to `""`; `config_supportsMicToggle=true`; `config_defaultAssistant` (D2); `config_sensorPrivacyRequiresAuthentication` (keep `true`); `config_keyChordPowerVolumeUp` (with patch); `config_hotwordDetectedResultMaxBundleSize` (keep `0`) |
| `frameworks/base/packages/SystemUI/src/com/android/systemui/privacy/{AppOpsPrivacyItemMonitor.kt,PrivacyItemController.kt,PrivacyModule.java,OngoingPrivacyChip.kt,PrivacyChipBuilder.kt,PrivacyDialogV2.kt}` | §9.4 |
| `frameworks/base/packages/SystemUI/src/com/android/systemui/appops/AppOpsControllerImpl.java` | §9.4 |
| `frameworks/base/packages/SystemUI/src/com/android/systemui/statusbar/events/{PrivacyDotViewController.kt,SystemStatusAnimationSchedulerImpl.kt}` | Lock screen/AOD; never auto-hide |
| `frameworks/base/core/java/android/permission/PermissionManager.java` | §9.5 |
| `frameworks/base/services/core/java/com/android/server/policy/PhoneWindowManager.java` | Pause chord |
| `system/sepolicy` (no edits) + `vendor/alphaphone/sepolicy/system_ext/private/*` | §6.3 |
| `packages/modules/Permission/PermissionController/res/xml/roles.xml` | **No edit.** Roles are assigned via config only |
| `vendor/alphaphone/**` | New (§9.1–9.3) |
| Device product (generated by adevtool): `vendor/google_devices/frankel/**` | Generated; check the generated `PixelConfigOverlay*` for intelligence-role package names and override them |
| `build/make/target/product/security/` or our key dir | Release keys including `@ALPHASENSE`; AVB key |
| `alphaphone` repo: new `docs/adr/ADR-0xx-privileged-listening.md` | Required before code (supersedes ADR-04 for this component only) |

---

## 10. Legal and UX requirements (engineering-facing)

See [05-regulation-compliance.md](05-regulation-compliance.md) for the law. Platform requirements:

1. **Consent:**
   - Explicit first-run opt-in with a plain-language explainer and a "what never leaves the phone" diagram.
   - Off by default.
   - Re-consent after OTA if the data flows change.
   - Consent receipts are stored in DE storage and in the audit ledger.
2. **Bystander and all-party consent:**
   - Jurisdiction-aware defaults: a geofence/region setting, with "meeting mode" requiring an announcement.
   - Optional audible chime at start and periodically, and a "Recording" lock-screen banner.
   - **No call recording.**
3. **Indicator:** always visible while capture is active (§3.4 rules 1–6). There is no user or developer setting to hide it, including in developer options and `adb` on user builds: SystemUI ignores `privacy/*` overrides for the listening chip.
4. **Pause controls:**
   - QS tile, lock-screen chip, notification action, power+volume-up chord (patched) and the sensor-privacy mic toggle.
   - Optional "flip-to-pause" using the device-orientation sensor **(est. feasibility)**.
   - The voice command "stop listening" works only while listening.
5. **Hardware mute:**
   - Pixel 10 has no mic kill switch.
   - The platform already supports one: `config_supportsHardwareMicToggle`, with the kernel reporting input switch `SW_MUTE_DEVICE` (0x0e). `InputManagerService` forwards it to `SensorPrivacyService` as `TOGGLE_TYPE_HARDWARE`, which calls `setGlobalRestriction(MICROPHONE, …)`.
   - Strongest option: an OEM board with a physical mic power cut **and** the `SW_MUTE_DEVICE` report (Motorola/ODM path).
   - USB-C/BT accessory switches cannot cut internal mics.
6. **Data rights:** delete-range, export, a retention timer, and a "forget the last 5 minutes" one-tap.
7. **BIPA/CUBI:** no voiceprint enrolment by default. Diarization is per-session and anonymous unless the user opts in with written release where required.

---

## 11. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pixel vendor-blob redistribution rights for a commercial image **(unverified)** | Medium / High | Legal review of Google factory-image terms; alternatively ship tooling that builds on the customer's device (GrapheneOS-style) or partner with an OEM |
| R2 | Google kernel-source latency or adevtool breakage on a new Pixel drop | High / Medium | Stock-kernel bring-up (as in the repo lock); pin; track GrapheneOS; budget slip time per QPR |
| R3 | AP-only power exceeds budget | Medium / High | Governor and schedules; DSP spikes; "on charger" mode; honest marketing |
| R4 | `HOTWORD` source unsupported or odd on the AOC HAL without an ST session | Medium / Medium | `VOICE_RECOGNITION` plus cooperative yield (§4) |
| R5 | Custom SELinux coredomain neverallow failures (the Eliza precedent) | High / Medium | Start with stock `priv_app` plus no `INTERNET` and the isolated child; add `alpha_sense_app` in Phase 2 with time budgeted |
| R6 | Indicator regression through a vendor overlay or role default | Low / Critical | Build-time assert, runtime SystemUI assert, on-device invariant test in CI |
| R7 | The persistent app crashes and loops | Medium / Medium | Persistent apps auto-restart; add a crash-loop breaker → `PAUSED_ERROR` with chip |
| R8 | Legal: all-party consent and workplace monitoring law | High / High | Defaults off, announcement mode, regional policy, counsel sign-off before pilots |
| R9 | AOSP source only twice a year; `main` ≠ release | High / Low | Pin tags; re-verify the cited code (V1) |
| R10 | NPU inaccessible from an isolated process on Tensor (LiteRT Tensor NPU is AOT-only; doc 10) | High / Medium | CPU/GPU first; `isolated_compute_app` plus a vendor device attribute spike |
| R11 | Trust/PR: an "always listening phone" | High / High | Make the indicator, local-only and redaction claims verifiable: open-source the sense app and policy; reproducible builds |
| R12 | Upstream Eliza also claims `config_defaultAssistant` (`ai.elizaos.app`) | Certain / Low | D2: product overlay wins; never inherit both products' role defaults (AGENTS.md: one independent product) |

## 12. Decisions needed

- **D1.** Base: AOSP + adevtool (recommended), or a GrapheneOS fork. Also decide whether Alpha's image inherits `vendor/eliza/eliza_common.mk` at all (AGENTS.md: do not import the other product's identity), so probably a separate `alphaphone_common.mk`.
- **D2.** Who holds `ROLE_ASSISTANT`: the Alpha app (recommended) or nobody. The sense package is never the assistant.
- **D3.** Whether to pre-grant `RECORD_AUDIO` (recommend no; ask during consent).
- **D4.** Whether to allow optional 24 h raw-audio retention.
- **D5.** Target device: Pixel 10 (`frankel`) vs Pixel 10 Pro (`blazer`, more RAM) vs wait for Motorola.

## 13. Verification items (all open)

- **V1:** re-check every cited source line at the pinned Android 17 tag.
- **V2:** on Pixel 10, run `dumpsys media.audio_policy`, `dumpsys soundtrigger_middleware` and `lshal`/`service list | grep -i sound`, and document what exists.
- **V3:** a persistent priv-app can start a mic FGS at boot and from the background on Android 17 without `START_ACTIVITIES_FROM_BACKGROUND`.
- **V4:** how `isIsolatedComputeApp` is set; whether a non-HDS service can opt in.
- **V5:** `HOTWORD` source capture without an ST session on AOC.
- **V6:** standby/bucket behaviour for persistent system apps.
- **V7:** system_ext private sepolicy with custom seinfo builds without neverallow violations.
- **V8:** AOD/lock-screen chip rendering.
- **V9:** BT/LE Audio routing for our source.
- **V10:** multi-user `install-in-user-type` semantics and `DISALLOW_UNMUTE_MICROPHONE`.
- **S1/S1b/S1c:** DSP/CHRE/OEM spikes.

## 14. Effort estimate (est.)

| Work item | Effort |
|---|---|
| Pixel 10 lock, product, boot (userdebug, stock kernel) via adevtool | 2–4 eng-weeks |
| Sense app: capture, VAD, state machine, governor, consent UI | 6–8 eng-weeks |
| ASR and redaction in the isolated child (CPU), measurement harness | 6–10 eng-weeks (ML + platform) |
| SystemUI chip, QS tile, lock/AOD, dialog, invariant tests | 4–6 eng-weeks |
| Framework patches (PermissionManager, key chord) and overlays | 2–3 eng-weeks |
| SELinux custom domain, user build, release signing, AVB custom key, OTA server | 6–8 eng-weeks |
| Power/thermal tuning and a 7-day dogfood | 4–6 eng-weeks |
| Spikes: DSP/CHRE, NPU-in-isolated-compute, pVM ledger | 6–10 eng-weeks (parallel, may fail) |
| **Total** | **~36–55 eng-weeks** ≈ 2–3 platform engineers + 1 ML engineer + 0.5 design/legal over **5–7 months** |

## 15. Phased plan

- **Phase 0, foundations (weeks 0–4).**
  - ADR for privileged listening.
  - Pixel 10 lock (`frankel`) mirroring `pixel11pro.lock.json`; boot a userdebug image with Alpha non-privileged (existing staging tool).
  - Generate the AVB key; test-flash `avb_custom_key` on a lab device.
  - V1/V2/V5 probes.
  - **Exit:** a booted image, documented audio/ST inventory, hashes recorded.
- **Phase 1, honest always-on MVP on userdebug (weeks 4–14).**
  - Sense priv-app as stock `priv_app`, no `INTERNET`, persistent mic FGS, VAD, CPU ASR in an isolated child, redaction, egress gate to Alpha.
  - SystemUI listening chip, op patches, overlays, sysprop.
  - Consent flow; pause controls (tile, notification, lock screen).
  - **Exit:** invariant tests pass (the chip is always visible while capture is active, including lock/AOD); concurrency matrix from §4 passes on device; power measured.
- **Phase 2, production hardening (weeks 14–26).**
  - `alpha_sense_app` SELinux domain with egress neverallows; `user` build; release keys; signed OTA and rollback drill.
  - Governor tuning; BT/multi-user/BFU behaviours.
  - 7-day dogfood at ≤10%/day overhead.
  - External privacy review and counsel sign-off.
  - **Exit:** signed release candidate plus an evidence bundle.
- **Phase 3, efficiency and assurance (parallel from week 10).**
  - DSP/CHRE spikes (S1/S1b).
  - NPU via `isolated_compute_app` (V4).
  - pVM audit-ledger signer.
  - Optional VIS + HDS wake phrase with patched indicator.
  - OEM (Motorola/ODM) hardware mute switch discussions.

---

## Sources

**AOSP source (`refs/heads/main` as of 2026-10-02):**
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/AndroidManifest.xml
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/values/config.xml
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/permission/PermissionManager.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/permission/PermissionUsageHelper.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/packages/SystemUI/src/com/android/systemui/appops/AppOpsControllerImpl.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/packages/SystemUI/src/com/android/systemui/privacy/AppOpsPrivacyItemMonitor.kt
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/policy/AppOpsPolicy.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/am/ActiveServices.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/audio/AudioService.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/SystemConfig.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/sensorprivacy/SensorPrivacyService.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/input/InputManagerService.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/service/voice/HotwordDetectionService.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/voiceinteraction/java/com/android/server/voiceinteraction/VoiceInteractionManagerServiceImpl.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/voiceinteraction/java/com/android/server/voiceinteraction/HotwordDetectionConnection.java
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/voiceinteraction/java/com/android/server/voiceinteraction/DetectorSession.java
- https://android.googlesource.com/platform/packages/modules/Permission/+/refs/heads/main/PermissionController/res/xml/roles.xml
- https://android.googlesource.com/platform/frameworks/av/+/refs/heads/main/services/audiopolicy/service/AudioPolicyService.cpp
- https://android.googlesource.com/platform/frameworks/av/+/refs/heads/main/services/audiopolicy/service/AudioPolicyInterfaceImpl.cpp
- https://android.googlesource.com/platform/frameworks/av/+/refs/heads/main/media/utils/ServiceUtilities.cpp
- https://android.googlesource.com/platform/frameworks/av/+/refs/heads/main/services/audioflinger/Threads.cpp
- https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/isolated_compute_app.te
- https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/isolated_app_all.te
- https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/seapp_contexts
- https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/public/attributes
- https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/keys.conf
- https://android.googlesource.com/platform/packages/modules/Virtualization/+/refs/heads/main/docs/device_assignment.md
- https://android.googlesource.com/device/google/gs-common/+/refs/heads/main/audio/aidl.mk
- https://android.googlesource.com/device/google/zuma/+/refs/heads/main/device.mk

**AOSP and Android docs:**
- https://source.android.com/docs/core/audio/sound-trigger
- https://source.android.com/docs/core/permissions/privacy-indicators
- https://source.android.com/docs/core/virtualization
- https://source.android.com/docs/core/virtualization/microdroid
- https://source.android.com/docs/core/ota/sign_builds
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/develop/background-work/services/fgs/service-types
- https://developer.android.com/about/versions/15/behavior-changes-15
- https://developer.android.com/media/platform/sharing-audio-input

**GrapheneOS:**
- https://grapheneos.org/build
- https://grapheneos.org/install/cli
- https://grapheneos.org/faq
- https://grapheneos.org/releases
- https://github.com/GrapheneOS/adevtool/tree/17/config/device
- https://github.com/GrapheneOS/adevtool/blob/17/config/device/common/file-exclusion.yml

**Industry and news:**
- https://9to5google.com/2025/06/12/android-open-source-project-pixel-change/
- https://www.androidauthority.com/google-pixel-kernel-code-forms-3696441/
- https://www.androidauthority.com/aosp-source-code-schedule-3630018/
- https://piunikaweb.com/2026/01/07/android-aosp-source-code-q2-and-q4-pixel-monthly-security-patches-unchanged/
- https://www.opensourceforu.com/2026/08/google-makes-pixel-kernel-source-harder-to-access/
- https://www.privacyguides.org/news/2025/11/26/grapheneos-now-has-experimental-support-for-pixel-10-series/
- https://9to5google.com/2026/03/01/motorola-confirms-grapheneos-partnership-for-a-future-smartphone-porting-features/

**Research:**
- https://arxiv.org/pdf/2209.10317 (Private Compute Core)
- https://arxiv.org/abs/1711.10958 (Now Playing)

**Repository inputs (read-only):**
- `vendor/eliza/packages/os/android/{README.md,hardware-targets.json,pixel11pro.lock.json,vendor-specs/grizzly-cd1a.260905.001.b1.yml}`
- `vendor/eliza/packages/os/android/vendor/eliza/{eliza_common.mk,permissions/*,sepolicy/*,overlays/*,apps/Eliza/Android.bp,manifests/aosp-assistant-full-control.json}`
- `vendor/eliza/packages/app/platforms/android/app/src/main/{AndroidManifest.xml,res/xml/eliza_voice_interaction_service.xml,java/ai/elizaos/app/ElizaVoiceCaptureService.java}`
- `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`
- `docs/android-and-aosp.md`, `docs/architecture.md`, `docs/native-capability-research.md`, `docs/standalone-paired-asr.md`, `docs/market-research/10-always-on-tech-feasibility.md`
