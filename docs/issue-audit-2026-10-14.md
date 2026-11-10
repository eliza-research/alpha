# Open-issue audit — October 14, 2026

Audited all 28 open issues and the 70 most recent pull requests against main
`f7e538070ba2a851efe64d38317d71978c960058`, then refreshed through
`7bbf4ba18` after #462 merged during the audit. Merged source is not real-provider
acceptance.

Policy approval, source merge, APK packaging, emulator execution, full AOSP boot,
physical hardware, real providers and release acceptance are separate gates.
Historical evidence remains bound to its recorded source/artifact. The rows below
identify the concrete work left rather than closing broad issues from partial PRs.

## Current integration update

The rows below record the initial audit evidence, not a claim that all described
source gaps still exist. PR493 advances shared contracts to
`644d56c93df9e410b1ef4297f961cb1df9e7d152`, migrates native/host speech to
Paradee and shared ASR, removes production Cloud speech selection, and adds
separate editable dictation. See [current speech boundaries](shared-speech-migration-2026-10-14.md).
Its source tests do not qualify runtime/model bytes, streaming ASR/Clef, both ABIs,
or physical devices. Current dependency PRs must pass their exact-head CI and
merge before these changes count as main-branch completion.

## Disposition

#415 closed after PR468 integrated the source/JVM repairs and 32 focused production
browser checks. PR469 separately corrects Clock caller admission; physical Clock
acceptance remains open.
Nine audited issues are now closed for tracking (#396, #401, #405, #407, #408,
#409, #415, #418 and #425); 19 remain open. #409 closed after the reset recovery
source fixes in PR475; its actual-image/reset/interruption acceptance remains in #378. Except for #415's source boundary, those
closures consolidate unmet acceptance in [the #378 qualification ledger](https://github.com/eliza-research/alphaphone/issues/378#issuecomment-6161377036); they do not establish device/provider qualification. None of this audit changes the approved scope,
pricing, quotas, signing authority or hardware target.

| Issue | Existing implementation / evidence | Remaining requirement |
| --- | --- | --- |
| [#377](https://github.com/eliza-research/alphaphone/issues/377) | PR446 opt-in image listening integrated; PR434 verified image capabilities and PR432 secure-camera staging merged; production Cloud speech remains | Complete approved local-speech AOSP image, phone/SMS/Gmail integration and listener power/lock behavior, signed Pixel10a Android17 boot/OTA/recovery evidence. |
| [#378](https://github.com/eliza-research/alphaphone/issues/378) | native speech functional admission failed/unexecuted; release signer unset; new policy implementation PRs do not establish physical acceptance | Exact-source full verify and packaged builds; native/device/image/real-service user acceptance. No owner signoff or fabricated fixtures substitute. |
| [#381](https://github.com/eliza-research/alphaphone/issues/381) | PR457 integrates many policy changes; PR467 sign-in/plan gate merged; production Cloud speech and unqualified speech remain | Umbrella: native local speech, interruptible endpointing, all subordinate policy acceptance and production/local APK variants plus image/final qualification. |
| [#395](https://github.com/eliza-research/alphaphone/issues/395) | scripts/aggregate-voice-latency.ts originally accepted 25 renderer/text samples, excluded manual review and called policy undecided; new native-voice-latency.ts validates native sample boundary and cohort evidence | Native instrumentation not yet connected to capture/playback; at least 50 actual simple-query trials at exact source/model hashes, physical audible boundary and thermal/network evidence. New parser is tooling only; synthetic regression inputs are not acceptance. |
| [#396](https://github.com/eliza-research/alphaphone/issues/396) | PR428 production hosted pairing/restore removal and retained legacy history; native owner/generation-bound credential store; PR445/467 subscription binding/gate. | Real resident sign-in, expiry/revoke, wrong-origin callbacks and account isolation with deployed Cloud services still require live qualification. |
| [#397](https://github.com/eliza-research/alphaphone/issues/397) | apps/app/src/runtime/voice-selection.ts production selectVoiceRoute returns cloud; apps/app/src/prototype/voice-adapter.ts directly constructs Cloud voice; docs/local-speech-research-2026-10-12.md | Reviewed shared native inference STT/TTS integration and candidate benchmarking; Cloud removal across every entrypoint. A selector flip alone would retain chat uploads or break functionality. |
| [#398](https://github.com/eliza-research/alphaphone/issues/398) | Native Gmail consumer now binds encrypted checkpoint/notice metadata to owner, credential and selected grant generation; WorkManager/resume checks, redacted at-most-once notices and validated Inbox taps. Cloud history contract: [Eliza PR36173](https://github.com/elizaOS/eliza/pull/36173), with deployment still unverified. See [consumer evidence](gmail-background-reconciliation.md). | Endpoint deployment and real mailbox/device Doze/denial/lock/reboot/process-death qualification remain missing. Quiet initial/expired baselines explicitly do not claim complete missed-mail backfill. Keep open. |
| [#399](https://github.com/eliza-research/alphaphone/issues/399) | docs/implementation-plan.md approved Pixel10a Android17 target; android/release-signer.json unset; Android strict build fails for absent speech AAR | Admit exact physical source/firmware/SKU hash lock; four packaged variants with qualifying assets; Cuttlefish, Pixel device/update/recovery/user acceptance separately. |
| [#400](https://github.com/eliza-research/alphaphone/issues/400) | android/release-signer.json signerSha256=unset | Alpha-controlled managed/hardware key, certificate descriptor, update channel/recovery image and signed/interrupted-update/rollback drills. Owner assigned; custody and evidence absent. |
| [#401](https://github.com/eliza-research/alphaphone/issues/401) | ClockHandoff.java uses reviewed create/show intents with dispatch-only receipts; reminders remain separate. stage-aosp.ts appends clockProductRequirement from scripts/aosp-clock-contract.ts, explicitly shipping DeskClock in an additive Alpha-only launcher overlay. Commit 8dfb937e4 hardens read-only image admission to require enabled system DeskClock and explicit expected image fingerprint; 2 behavioral tests pass. | Actual target-image alarm creation, return-to-Alpha, ring/snooze/dismiss/reboot/DST/time-zone/DND acceptance remains. Image source verification must not be confused with physical ringing. Keep open. |
| [#404](https://github.com/eliza-research/alphaphone/issues/404) | [#438](https://github.com/eliza-research/alphaphone/pull/438), [#430](https://github.com/eliza-research/alphaphone/pull/430) | Official integrated vault and optional Proton unlock/save/fill, redirects/frames/wrong origin/cancel and release-signed identity qualification remain. HTTP-auth needs trustworthy engine-origin binding before fill. Keep open. |
| [#405](https://github.com/eliza-research/alphaphone/issues/405) | Existing account-bound operation contracts and attachment MIME/size/digest controls; PR456/458 reviewed selected Files/Photos attachment flows; tests use synthetic provider. | Authorized real-mailbox read/archive/draft/reply/forward/send/exact-byte attachment operations, account switch/revoke and ambiguous-send reconciliation not qualified. PR462 merged during this audit; live provider qualification remains. |
| [#407](https://github.com/eliza-research/alphaphone/issues/407) | [#432](https://github.com/eliza-research/alphaphone/pull/432) | docs/aosp-secure-camera-source.json says source contract only. Image locked capture must demonstrate no prior gallery/agent/accounts access plus unlock/return/permission/absence. Keep open. |
| [#408](https://github.com/eliza-research/alphaphone/issues/408) | [#437](https://github.com/eliza-research/alphaphone/pull/437), [#442](https://github.com/eliza-research/alphaphone/pull/442), [#458](https://github.com/eliza-research/alphaphone/pull/458) | Large personal catalogs, reboot, permission downgrade, external edits, memory/battery and integrated agent acceptance are incomplete. Found and fixed stale async read race permitting old catalog results after reopen/revocation; exact change reported separately. Keep open. |
| [#409](https://github.com/eliza-research/alphaphone/issues/409) | PR431 authenticated durable package reset/removal of migration controls; PR459 same-signed listener consent revocation before reset; Android package-scoped clear uses OS deletion rather than shared-file enumeration. Fresh JVM reset authorization and startup admission tests pass. | Installed self-clear observed externally on disposable package/user; interruption/restart/no resurrection, listener provider IPC/microphone release, both image distributions and no-cross-app deletion qualification remain. An unacknowledged listener reset now opens a provider-free recovery surface (retry, listener settings, Phone, Settings) with bounded automatic attempts instead of a silent launcher relaunch loop (JVM relaunch tests); installed HOME behaviour of that surface is unqualified. |
| [#410](https://github.com/eliza-research/alphaphone/issues/410) | PR445 entitlement verifier/account binding, plan/retry UI; PR467 mandatory Cloud account/plan gate and redemption. This worker fixes active fallback billing snapshot that previously stopped background refresh, missing cancellation while app stayed open (commit 99aae715c). | Cloud server cached quota/token buckets and idempotent accounting, live revoke/expiry/outage integration, p50/p95 latency benchmarks, measured provider cost/pilot data for owner-approved numerical pricing and limits remain. No prices or quotas invented. |
| [#411](https://github.com/eliza-research/alphaphone/issues/411) | PR393/426 accessibility/rotation and PR451 keyboard review clearance; browser landscape/accessibility sweeps and existing native rotation instrumentation. | Matrix-wide both-distribution screen-reader/large-text/keyboard/process recreation and physical rotation/capture/task continuity evidence not complete. Browser geometry and historical limited native rotation tests cannot close the full criterion. |
| [#412](https://github.com/eliza-research/alphaphone/issues/412) | Alpha has regional Maps adapter and local location/navigation/state/review contracts (`apps/app/src/maps`, `runtime/maps-contract.ts`). | No provisioned shared production Cloud Maps provider-neutral service, datasets/coverage/freshness operations, signed plan enforcement, complete agent tools, live Calendar→Maps/physical navigation qualification. Regional adapter is explicitly prototype coverage. Requires upstream Cloud work and provider provisioning. |
| [#413](https://github.com/eliza-research/alphaphone/issues/413) | android/local-speech/qualified-runtime-manifest.json functionalAcceptance.passed=false; x86_64 state not-executed | Current-source both-ABI functional and speed admission, no-egress, real microphone/speaker and thermal/cancellation tests. Historical candidate ARM64 emulator pass is not current admission. |
| [#415](https://github.com/eliza-research/alphaphone/issues/415) | PR428 production local-only selection. `ConnectionRoutes.java`, `managed-service-routes.ts`, `native-connection.ts` use exact origin and service route admission; redirects disabled. `connection-ui.tsx` prevents saved remote/cloud selection reconnection and preserves history/credentials. PR445/#467 separately admit entitlement/key/redeem routes. No Maps route is admitted absent a production service. | Closed after PR468 integrated passing source/JVM route and flag-off browser boundary checks. Real resident sign-in remains tracked by #396. |
| [#416](https://github.com/eliza-research/alphaphone/issues/416) | [#443](https://github.com/eliza-research/alphaphone/pull/443), [#461](https://github.com/eliza-research/alphaphone/pull/461) | Actual AOSP portrait/landscape/lock screenshots, insets, DND, clear/tap and listening integration missing. Ask parity tracked by 449 is partial. Keep open. |
| [#417](https://github.com/eliza-research/alphaphone/issues/417) | [#443](https://github.com/eliza-research/alphaphone/pull/443) | Document explicitly says SystemShadeInstrumentedTest not compiled or run at its source; actual AOSP swipe/tap/TalkBack/return with no duplicate open remains. Keep open. |
| [#418](https://github.com/eliza-research/alphaphone/issues/418) | PR454 rejects unknown remote freshness. `CalendarAvailabilityReader.java` and `runtime/calendar-availability.ts` exclude free/cancelled/declined and re-read owner-selected source revisions and interval results before sharing. Remote cached reads explicitly remain unknown. | Real synced invitations, free/busy-only permission, stale/revoked sources, all-day/DST and conflict updates must be qualified; synced freshness contract intentionally remains fail-closed. Existing fixture coverage does not establish these real-provider gates. |
| [#421](https://github.com/eliza-research/alphaphone/issues/421) | PR440 incremental read then modify Gmail grants (`runtime/gmail-grants.ts`); PR434 image capability admission; PR448 bounded image-only Contacts. `AlphaTelephonyPlugin` supplies status/handoffs and standalone remains denied. | Actual AOSP SMS/MMS provider and Telecom contracts, SIM selection plus incoming/outgoing status and reviewed native sends remain incomplete. Owned live Gmail and SMS delivery/revoke/account-change qualification not established. PR462 is now merged; live provider evidence remains. |
| [#423](https://github.com/eliza-research/alphaphone/issues/423) | apps/app/src/prototype/voice-adapter.ts:169 and :451 force Cloud chat speech; test/voice-entry-timing.test.mjs remains TODO | Separate dictation/voice assistant controls, native streaming STT/VAD/Clef, cancellation and heard-content reconciliation, barge-in and account-change audio acceptance. PR463 improves explicit developer Cartesia sessions; does not implement local production voice. |
| [#424](https://github.com/eliza-research/alphaphone/issues/424) | [#446](https://github.com/eliza-research/alphaphone/pull/446), [#447](https://github.com/eliza-research/alphaphone/pull/447), [#459](https://github.com/eliza-research/alphaphone/pull/459) | No listener installation or microphone capture in cited evidence. Real Pixel lock/AOD/background/calls/echo/stop/battery/thermal and full image privilege/SELinux verification remain. Keep open. |
| [#425](https://github.com/eliza-research/alphaphone/issues/425) | [#429](https://github.com/eliza-research/alphaphone/pull/429) | Evidence excludes real workflow metadata/approval actions; full target-image lock previews, account/process-death and real result integration remain acceptance. Keep open. |
| [#449](https://github.com/eliza-research/alphaphone/issues/449) | [#461](https://github.com/eliza-research/alphaphone/pull/461) | PR 461 explicitly labels partial: approval, Calendar/reminder and other publishers still need source/owner-bound question adapters. New instrumentation has not run. Keep open. |

## Repairs from this audit

- #410: refresh active fallback billing snapshots while Alpha stays foregrounded;
  preserve backoff, account teardown, signed-token adoption and server enforcement.
- #408: reject catalog results and validation changes from retired views or
  permission generations, with delayed-operation regressions.
- #415/#421: admit the exact read-only Google Calendar native service routes added
  by #462; retain denial of writes, malformed paths and hosted-agent endpoints.
- #401: bind Clock handler admission to the expected image fingerprint and require
  a system-installed DeskClock, rejecting ordinary replacement APKs.
- #411: center readable Notes text, checklist and voice-note columns on wide
  screens while preserving draft, caret, scroll and editor identity across resize.
- #395: require at least 50 native audio-clock trials with source/model/device
  provenance, cold/warm statistics and the entire last-speech-to-audible interval.
  Legacy renderer stage sums remain diagnostic only. The native collector and real
  audio trials are still missing; fixture exports are not qualification.
- #397/#413/#400: strict build guidance now names the approved local-speech
  requirement and Alpha Compute/Shaw release ownership instead of asking for
  decisions already made. Qualification gates are unchanged.

## Native speech implementation boundary

At pinned shared source `13c98575987a121decc45b161b0c8a4ee698554e`,
`ElizaVoiceNative.java`/`elizavoice-jni.cpp` expose batch ASR and Kokoro IPA synthesis,
but do not expose the FFI streaming ASR session calls or `cancel_tts`. Clef semantic
endpointing and heard-content accounting are not implemented in the pinned Android
path. The batch base64-PCM inference endpoint is not the required native streaming
pipeline. The current Alpha local plugin uses separate Sherpa Whisper/Piper assets.

The next coherent upstream change needs persistent capability/versioned speech
sessions, streaming ASR, generation-owned cancellable TTS and bounded native
AudioRecord/AudioTrack queues. Both ABI libraries and actual ASR/Kokoro/voice/
phonemizer assets must be pinned and qualified before Alpha consumes that path.
An embedding-only ARM64 qualification does not establish speech qualification.
These are remaining implementation and artifact-admission tasks, not only missing
hardware screenshots. Changing a renderer selector cannot complete them.

## Validation

Focused source/JVM regression checks pass. A flag-off production build passed 32
focused browser tests (legacy connection/owner-history boundaries plus Notes),
followed by the enhanced Notes regression passing again. The 915×412 screenshot
was inspected; resize retained the same editor, draft/title, caret selection,
scroll and checklist roundtrip. Tests used an audited prebuilt production bundle
after standalone authenticated source preparation, avoiding the local server's
180-second preparation timeout. These are browser results, not Android acceptance.
Combined repository verification and exact-head hosted CI are in progress.
`npm run android:build:local` was attempted and stops before compilation because
`android/local-speech/libs/sherpa-onnx-1.13.8-no-espeak.aar` is absent. No local
APK, image, hardware, real Gmail/SMS, signing or release acceptance is claimed.

The audited pin `13c98575987a121decc45b161b0c8a4ee698554e` establishes batch ASR
and Kokoro, not JNI streaming ASR, `cancel_tts`, or Clef. New upstream work in
[PR36168](https://github.com/elizaOS/eliza/pull/36168) and
[PR36177](https://github.com/elizaOS/eliza/pull/36177) must be reviewed at its served
source and qualified assets; this audit does not establish voice acceptance.

## Own-notification Ask inventory

Workflow result Ask already exists; PR472 adds approval/quiet approval Ask. Shared
[Reminder PR36179](https://github.com/elizaOS/eliza/pull/36179) and its Alpha adapter
add exact-source reminder review with reusable cancellation. The Alpha adapter
also adds Gmail Ask with explicit current-message checks and subject/snippet review.
Hosted result and source-renewal publishers are separate follow-ups; navigation progress has no
qualified immutable question source yet. External Calendar notifications and OS
DownloadManager notifications are not Alpha-owned publishers. #449 stays open.
