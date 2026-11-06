# Architecture and product decisions

October 1 architecture change: the user has selected an **Android-resident agent instead of Nitro/TEE hosting**. The [on-device agent plan](on-device-agent-plan.md) supersedes cloud-only and enclave-primary requirements below. Agent execution and model inference are separate: the implemented path uses hosted Cerebras text inference and local orchestration; fully offline language-model operation remains unqualified. Historical evidence is retained. October 12 policy below resolves powered-off scheduling: schedules run only while the phone is powered on.

## Accepted foundation decisions

1. Keep Alpha Phone and senior-care independent: separate repository, application ID, renderer, assets and release stream.
2. Use a pinned Eliza source submodule while upstream consumer exports stabilize. Avoid publishing every workspace package before testing the actual dependency closure.
3. Package the pinned Eliza runtime with the Capacitor shell and use native authenticated IPC for the resident agent. Browser development runs the real agent on a private local host. Cloud/remote adapters remain historical/development infrastructure only; October 12 policy prohibits every hosted-agent product connection. Connected chat reports the actual protocol outcome; starting, recovering or inference-unavailable states must not simulate a successful send (P-43: the resident agent is always present). See [current status](mvp-current-status.md) for the remaining integration and device acceptance.
4. Use standalone and launcher product flavors with the same Alpha identity. Switching flavor replaces the installed Alpha app. Senior-care has a different identity and can coexist.
5. Make AOSP installation additive, nonprivileged and certificate/hash verified. Device provisioning chooses default HOME. Keep system recovery paths available.
6. Preserve the prototype's brand and layout direction while labeling data and agent capabilities honestly. Do not port mocked transfers, account linking or generated success messages.
7. October 2 confidentiality claim: hosted text inference stays on Qwen (`qwen-3.8-27b`) via Cerebras; `scripts/agent-model.mjs` holds the script default. Product, demo and sales wording follows the claims ladder in [the open-gap plan](market-research/15-open-gap-technical-plan.md). Today only rung L0 is earned: the agent runs on the phone; model requests carry prompts and selected context over TLS to Cerebras (US) running Qwen; no-retention is contractual, not technical. Never say sealed, attested, enclave-protected or "never leaves the device" until the named evidence exists. `test/browser/confidentiality-claims.spec.ts` enforces this for real and mock screens.
8. October 2 platform scope: Alpha forks AOSP for its own signed image. Banking apps, Play Integrity and GMS are not requirements. Always-on listening follows [the AOSP listening spec](market-research/12-aosp-always-on-listening.md) and needs a new ADR superseding item 5's nonprivileged rule for the listener package only.

## October 7 owner product decisions

Decided by the product owner on 2026-10-07 unless marked as an engineering disposition. Entries use stable `P-` identifiers, separate from the numbered foundation decisions above, so later foundation entries do not renumber them. These record product policy; they are not evidence that any feature is implemented or accepted. Each acceptance gate in [current status](mvp-current-status.md) still applies.

- **P-01** **Superseded by P-39 on October 12:** Voice send (product owner): voice does not auto-send, for now. The flow stays record → transcribe → review → the user sends. Consequence: the DoD's six-second hands-free round trip cannot be met with a manual send. Open follow-up A-10 must either measure end-of-speech to first audible response excluding the user's review/send time, or revisit the target. This entry does not choose between them.
- **P-02** Email scope (product owner): Gmail/Email is in MVP scope. Telegram and Discord stay deferred unless the owner states otherwise. This resolves the messaging part of A-07; other providers and exact read/write scopes remain open there.
- **P-03** Cross-app notification mirroring (delegated by the product owner to engineering judgment; engineering disposition): keep the implemented feature. It must stay strictly opt-in and off by default, outside onboarding, limited to user-selected apps, with previews hidden while the device is locked, and clearly disclosed. It is not an MVP acceptance gate. Re-evaluate it before any Play Store distribution because of notification-listener policy.
- **P-04** Browser sign-ins (product owner): browser tabs keep sign-ins in a persistent browser profile, with an explicit private-tab option that stays ephemeral. This supersedes the earlier per-tab ephemeral profile design. The persistent profile must remain separate from the privileged Capacitor host profile.
- **P-05** Password manager (product owner): an integrated password manager is in scope. It belongs in elizaOS upstream as a reusable component that Alpha consumes. Proton Pass remains an optional alternative provider. This supersedes "credential handling remains in the third-party provider" as the only path; provider-owned vault and unlock UI still applies when Proton Pass is chosen.
- **P-06** Note deletion (product owner): deleted notes go to Trash, and Trash empties automatically after 3 days. Implemented for text, checklist, link and voice notes, including approved agent deletions: a voice note's recording is trashed, restored and erased with its Trash entry, and the native 30-day audio sweep remains only a backstop. Undo, Restore, Delete forever and Empty Trash (both confirmed) are available. See [browser storage](browser-storage.md#notes-trash).
- **P-07** **Superseded by P-13/P-29 on October 12:** Voice route: Eliza Cloud is the current product default for chat voice, Notes transcription and read-aloud, bound to the signed-in account. Recording alone does not upload audio; transcription and playback name the selected service. The earlier in-browser Whisper engine was removed (P-42); local speech in a browser goes through the local agent on the same computer, which runs libelizainference, and is never an automatic fallback.
- **P-08** OCR languages (product owner): OCR covers English only for now.

## October 10 owner product decision

Decided by the product owner on 2026-10-10. Same rules as the entries above: this records product policy, not evidence that anything is implemented, accepted or legally reviewed.

- **P-09** Dependency licences and the Denton typeface (product owner), in three statements made that day:
  1. Open-source licences. The owner's instruction is to ignore the licence checks, because the work is all MIT-licensed open source and it is fine to use free open-source technology; the licences must be there, and they must be properly flagged and handled. Policy that follows: an open-source dependency licence never stops a build and is never a release blocker. Every licence text and notice still ships, and anything copyleft, unknown or unverified is flagged, with what it obliges, in the notices, in the build output (`LICENCE FLAG <flag>: <package>@<version> (<licence>)`, warnings, exit 0) and in the machine-readable inventories (`third-party-notices.json`, the verify-apks `licenceFlags` list, the SBOM). Implemented in `scripts/licence-policy.mjs` and `scripts/generate-licenses.mjs`; see [dependency audit](dependency-audit.md#licence-flags-p-09).
  2. Denton check: "flag only". The separately named check for proprietary fonts, `unresolved-font-licence`, is reported in the build output and in release records and does not make a release `distributable: false`. The constant `UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION` in `scripts/licence-policy.mjs` is therefore `false`; setting it to `true` makes a font with no licence record a release blocker again.
  3. Denton licence. The owner states that Alpha Compute owns the Denton font and that the licence is simply not in this repository. This closes A-21 as licensed, with the licence held by the owner outside the repository. What is recorded is that statement and nothing more (`licenses/font-licenses.json`, evidence `held-outside-repository`): no licence document, name, number, date, scope or terms is in the repository or was seen in this work. The font remains proprietary and is not open-source software; its notice and SBOM entries say so and stay flagged `proprietary-licence-held-outside-repo`. One follow-up would complete the record: a reference to the licence document (a reference only, never the document itself, and no secrets) in the record's `reference` field, when the owner supplies one.

  What this entry does not claim. "Included and flagged" is not legal review. The obligations a flag names (corresponding source for GPL, AGPL and LGPL components, a replaceable library for LGPL, a source offer that extends to network use for AGPL) are stated, not shown to be met. The first statement covers open-source software: the resident runtime payload contains one package under non-commercial terms (`@metamask/sdk`, flagged `non-open-source-terms`; see the dependency audit), which none of the three statements addresses.

## October 12 owner product decision: one local inference engine

Decided by the product owner on 2026-10-12 and recorded on 2026-10-13. Same rules as above: policy, not evidence. (It was first recorded as P-10 on a branch; P-10 is the schedules decision below, so this one is P-42.)

- **P-42** One local inference engine (product owner): on-device and local speech and inference use only the native llama.cpp-based stack, libelizainference (ggml, mtmd, OmniVoice, Kokoro and Silero VAD from the elizaOS fused fork, GGUF models). The owner's reason: the earlier runtimes were too slow and too memory-inefficient. Consequences: the in-browser Whisper engine, its WebAssembly runtime and its model files are removed from the web build, and the Android Sherpa engine and its models are removed from the APKs; neither may return (`test/llama-cpp-only.test.mjs`, `scripts/audit-production-bundle.mjs`). A browser with no local agent has no local speech and says so (`local-agent-required`); it never falls back to Cloud on its own. P-13 and P-29 (all speech on the device, no Cloud speech fallback) are implemented on this engine: the local speech they require is libelizainference, and its acceptance must be run there (see [fused speech](fused-speech.md)). This records the policy; it is not evidence that the replacement is built, qualified or accepted.

## October 13 owner decision: the resident agent is always present

Decided by the product owner on 2026-10-13. Same rules as above: policy, not evidence. (It was first recorded as P-11 on a branch; P-11 is the latency decision below, so this one is P-43. Source comments cite P-43.)

- **P-43** Resident agent always present (product owner). The owner's words: "there should NEVER be no agent connected since the agent should ALWAYS run locally on device, no exceptions." On Android the resident on-device agent starts automatically at app start, signed in or not, and in browser development the private local host agent is always connected. Eliza Cloud supplies inference and services only: Cloud admission binds the resident's inference provider and never decides whether the agent runs, and plan (subscription) state is shown beside the running agent without stopping it. A signed-out phone, a refused sign-in or an account with no admissible plan runs the resident with no provider bound (native `applyUnboundEnvironment` removes every provider credential and selector), and a chat or assistant turn gets the agent's honest in-conversation answer (`inferenceUnavailableReply`: a plan is needed, sign-in is needed, or Cloud is unreachable) with its plan action card (Redeem code or choose a plan, Sign in, Check again), never a generic "Set up AI" failure. Consequences: the "Use local apps without AI" and "Continue offline" choices are retired, and a stored `offline`, local-apps or `none` selection from an older build reads as the resident. Removing the provider key or signing out of Eliza Cloud unbinds inference and restarts the resident ("Your agent is running. Sign in to Eliza Cloud to turn AI back on."). Stop is replaced by Restart. A Cloud sign-in keeps the resident running while the owner signs in in the browser and rebinds it only once the new key is stored, so a cancelled or failed first sign-in leaves it untouched (a sign-in kept on the phone is re-admitted). A startup path that ends without any agent settles as recovering with Retry, never as a lasting "starting". Every surface with no session shows the resident starting or recovering state (`residentPendingText` / `agentPendingText` in `apps/app/src/runtime/connection-ui.tsx`), and the Android connection dialog is "Your agent": status (Starting / Running on this device / Not running, with Retry) plus AI inference (sign-in, plan, redeem code, sign-out). Reconciled with the #410 requirement that every Alpha Phone signs in to Eliza Cloud and holds a plan, and with the parallel implementation of the same directive in #478 (`claude/agent-always-local-plan-gate`, merged from `main` on 2026-10-14) into one design: signed out, or with a sign-in Cloud rejected, that dialog opens by itself and cannot be dismissed while the agent runs behind it; without an admissible plan, or while Cloud is unreachable, nothing opens by itself and a closable notice beside the running agent offers Redeem code and Choose a plan (or Try again). Neither withholds or stops the agent: `admitCloudResident` decides only the inference binding (`cloud`, `unbound`, or `kept` while Cloud is unreachable after a plan verified within 7 days) and `applyResidentBinding` applies it; a removal native cannot confirm is shown as unconfirmed and still starts the agent. A plan that ends, a refused refresh or a newly admissible plan queues one rebind (`queueResidentRebind`), which reconnects (native attaches when the process already matches its binding, otherwise restarts once); a rebind that cannot reconnect leaves the agent recovering with Retry. Native: `AlphaLocalAgentPlugin.start()` no longer refuses a missing provider slot; such a launch records the `no-provider` generation (`LocalAgentProviderAdmission.NO_PROVIDER_GENERATION`), later surfaces attach to it while no provider is stored, and a later provider binding (a new generation) restarts it. Product phones refuse disconnecting the resident or removing its provider (`ALWAYS_LOCAL`). Network offline is not "no agent": the resident keeps running and says AI needs a connection. The Web Speech (`speechSynthesis`) read-aloud fallback is removed. Mock mode and fixtures stay behind `ELIZA_DEV_ALLOW_TEST_MOCKS=1`; `offline` exists only there and in the flag-off web preview. `scripts/audit-production-bundle.mjs` forbids the retired strings in production bundles. This records the policy and the source change; it is not device evidence. The instrumentation that asserted the without-AI path is replaced by `ResidentAlwaysPresentInstrumentedTest` (written, not yet run on an emulator), and earlier verification records made with local apps selected are superseded (see [verification](verification.md)).

## October 13 and 14 owner decisions: Paradee speech and the ASR slot

Decided by the product owner on 2026-10-13 (P-54) and 2026-10-14 (P-55), recorded on 2026-10-14. Same rules as above: policy, not evidence.

- **P-54** On-device speech output is **Paradee-8M** (Apache-2.0), not Kokoro-82M, running on libelizainference (P-42) through the shared elizaOS paradee-voice library: native misaki English G2P with its lexicon, and eSpeak NG 1.52.0 for out-of-lexicon words. eSpeak NG is GPL-3.0-or-later and statically linked into libelizainference; like every licence finding it is listed and flagged in the notices and never blocks a build (P-09). The 32 MB Paradee GGUF ships in the APK assets. No Kokoro model, voice preset or CMUdict lexicon ships, and the Android CMUdict G2P workaround is removed. See [fused speech](fused-speech.md).
- **P-55** **Phonon-2** is the on-device ASR (faster, smaller and more accurate; owner, 2026-10-13 and 2026-10-14). It was ported upstream (elizaOS/eliza#36212 merged on 2026-10-14 as `d06a1aa9c9`, with streaming ASR #36213 `d68909cb` and live voice #36214 `70dc0bbf`) and is consumed at the pin `c7a9a0d7e7` (2026-10-14, llama.cpp `5df17a66`): the voice bundle's ASR slot holds the single parakeet-tdt GGUF `asr/phonon-2-fv5.gguf` (330,632,256 bytes, sha256 `dc552eb7…`, converted from `FermionResearch/Phonon-2@7e153e40`), pinned in `android/paradee-voice/asr-inputs.json` with backend `parakeet`, and the APK sets `ELIZA_ASR_BACKEND=parakeet` by default. The Qwen3-ASR pair no longer ships; the slot still accepts it as the `qwen3` backend. Phonon-2 weights are CC-BY-4.0: the attribution, Fermion's NOTICE and the licence text ship in the bundle and the notices; the training-data terms the NOTICE names (CHiME-6 CC-BY-SA-4.0, SPGISpeech Kensho terms) are flagged for review, never blocking (P-09). The voice conversation on Android streams to the resident agent's live ASR route with Silero VAD in the app process; the send policy is unchanged (P-39, MVP-01: `VOICE_SEND_POLICY`). The voice host stays unqualified until a person reviews on-device qualification. Text inference is unchanged: Qwen qwen-3.8-27b on Cerebras. See [fused speech](fused-speech.md).

## October 14 Maps allowance clarification

Decided by the owner in chat on 2026-10-14 (2026-10-15 UTC), while reviewing
[#410](https://github.com/AlphaCompute/alphaphone/issues/410). This clarifies P-26
and P-28; it does not establish implementation, deployment or acceptance.

- **P-56** Maps has a **separate Maps request allowance, with no per-request charge**.
  Enforce that allowance across the organization, separately from inference usage.
  Usage accounting must not introduce a monetary charge or automatic overage.
  Numeric prices and limits remain unset until supported by cost and pilot evidence.
  Preserve revocation/expiry checks, idempotent accounting and local speech's
  independence from billing. Source, deployment and real-account acceptance remain
  open under #410.

## October 12 owner decisions

The owner approved the following choices in chat on 2026-10-12. The matching GitHub
issues are now implementation TODOs, not unanswered decision requests. The policy
below controls over older PRD/plan wording and source defaults. Acceptance remains
open. In particular Wallet is removed from MVP, superseding the October 11 expansion.

- **P-10 — A-09 ([#394](https://github.com/AlphaCompute/alphaphone/issues/394)):** Schedules run only while the phone is powered on; the agent is local. Remove powered-off hosted-loop acceptance. Record missed occurrences once; do not automatically replay overdue effects. Offer an explicit Run now action where useful.

- **P-11 — A-10 ([#395](https://github.com/AlphaCompute/alphaphone/issues/395)):** Voice-assistant latency is the elapsed time from the last user speech audio sample to the first audible response sample. Include end-of-turn detection, final STT, inference, TTS and playback buffering. Do not subtract silence detection or report a sum of selected stages as the end-to-end result. Dictation reports stop-to-editable-text separately; manual user think time is not a voice-assistant benchmark.

- **P-12 — A-02 ([#396](https://github.com/AlphaCompute/alphaphone/issues/396)):** Eliza Cloud is the managed account, inference, subscription and Maps service endpoint. Agent orchestration, state, scheduling and approvals remain on the phone. No Cloud/hosted agent exists as a product connection, upgrade or fallback.

- **P-13 — A-04 ([#397](https://github.com/AlphaCompute/alphaphone/issues/397)):** All speech recognition and synthesis run locally on the device, always. Replace Cloud/paired-host speech policy. Use the Android native bridge to the reviewed Eliza llama.cpp/libelizainference build, extending shared upstream speech support where necessary. Research candidate models on Hugging Face and select by measured device speed and quality, not advertised desktop throughput.

- **P-14 — A-05 ([#398](https://github.com/AlphaCompute/alphaphone/issues/398)):** Use periodic background work and immediate reconciliation at resume/start. Doze delays are honest; a permanent connection solely for mail is not required. Stable event identities prevent duplicate user-visible alerts.

- **P-15 — A-01 ([#399](https://github.com/AlphaCompute/alphaphone/issues/399)):** Target Pixel 10a on Android 17. Ship standalone APK and Alpha AOSP image/launcher; Cuttlefish is the image integration test target. Other Pixels are not alternate promised hardware.

- **P-16 — A-06 ([#400](https://github.com/AlphaCompute/alphaphone/issues/400)):** Alpha Compute controls signing and update authority; Shaw is the accountable release/support/rollback owner. Use managed or hardware-backed release signing, distinct from developer keys.

- **P-17 — A-11 ([#401](https://github.com/AlphaCompute/alphaphone/issues/401)):** Android Clock owns alarms, conditional on a usable integration in the app and AOSP image. Alpha owns reminders. A dispatch receipt may state that Clock opened, not that an alarm was created.

- **P-18 — A-12 ([#402](https://github.com/AlphaCompute/alphaphone/issues/402)):** Passkeys are outside MVP acceptance. Integrated passwords remain in scope. A later release may use the system credential provider after actual browser/image qualification; Alpha is not a new passkey provider now.

- **P-19 — A-13 ([#403](https://github.com/AlphaCompute/alphaphone/issues/403)):** Third-party cookies are allowed in normal browsing. Persistent first-party sign-ins remain. Private tabs remain ephemeral and strict; browser storage stays separate from the privileged app WebView.

- **P-20 — A-14 ([#404](https://github.com/AlphaCompute/alphaphone/issues/404)):** Every eligible login surface in Alpha should support password-manager fill. The isolated Browser is currently the website-login surface; future Alpha-owned login forms must also be covered. This is not blanket trust of arbitrary external browsers and does not expose passwords to the agent.

- **P-21 — A-15 ([#405](https://github.com/AlphaCompute/alphaphone/issues/405)):** Include reading, read/unread, archive, drafts, reply/forward, reviewed send, opening/saving attachments and user-selected outbound attachments. Defer custom label management.

- **P-22 — A-16 ([#406](https://github.com/AlphaCompute/alphaphone/issues/406)):** Only the local resident agent is supported. No hosted agent, dedicated-agent purchase, remote pairing or Cloud-agent fallback is a product option, now or as an advanced setting.

- **P-23 — A-17 ([#407](https://github.com/AlphaCompute/alphaphone/issues/407)):** Use the system secure camera and its AOSP lock-screen gesture. Alpha does not implement its own secure camera; agent/library/account access stays behind unlock.

- **P-24 — A-18 ([#408](https://github.com/AlphaCompute/alphaphone/issues/408)):** Provide full device photo/video library access to the local agent where Android permits and the user grants it, rather than limiting the product to owned captures or picker selections. Handle partial/denied access honestly. Full local access does not imply automatic upload of the entire library.

- **P-25 — A-19 ([#409](https://github.com/AlphaCompute/alphaphone/issues/409)):** No app-data import/export, backup or device-transfer product workflow. Provide a confirmed Reset Alpha data option. Keep Android backup disabled. Ordinary Files opening/saving and Gmail attachments are separate daily-tool operations, not app-data migration.

- **P-26 — A-20 ([#410](https://github.com/AlphaCompute/alphaphone/issues/410)):** Use subscription billing with reasonable rate limits rather than a user-facing credit top-up/per-token meter. Billing checks must not add a billing-service round trip to each assistant turn. Local speech and local tools do not depend on an online billing check.

- **P-27 — A-22 ([#411](https://github.com/AlphaCompute/alphaphone/issues/411)):** Support portrait and landscape, adapting each surface by its purpose. Do not stretch every panel or change sensitive/native UI ownership. Preserve drafts, scroll, selection, task and capture state.

- **P-28 — A-23 ([#412](https://github.com/AlphaCompute/alphaphone/issues/412)):** Maps belongs in Eliza Cloud as a reusable managed service for agents, with full supported search, place, route and navigation control from Alpha’s local agent. The regional development gateway is a prototype adapter, not the production coverage promise. No hosted agent is introduced.

- **P-29 — A-24 ([#413](https://github.com/AlphaCompute/alphaphone/issues/413)):** On-device STT and TTS are mandatory for every production speech entrypoint, including signed-out and offline use. No Cloud speech fallback. A failed local engine must surface recovery and typing, not switch routes.

- **P-30 — A-25 ([#414](https://github.com/AlphaCompute/alphaphone/issues/414)):** Use a short durable Undo window and one review step for events and reminders. Initial engineering value: ten seconds. Delay provider deletion until expiry when possible; never call a recreated invitation a lossless restore. Suspend pending-deletion reminder delivery immediately.

- **P-31 — A-26 ([#415](https://github.com/AlphaCompute/alphaphone/issues/415)):** No Cloud-agent host is admitted. The resident agent uses the local native bridge. Cloud inference, subscription, Gmail and Maps are managed services, not agent hosts.

- **P-32 — A-32 ([#416](https://github.com/AlphaCompute/alphaphone/issues/416)):** Use Android’s shade as the single notification/quick-settings surface if it integrates correctly and matches the product design. Keep workflow history in Alpha; remove the competing imitation shade. Use normal notifications/tiles before custom SystemUI changes.

- **P-33 — A-33 ([#417](https://github.com/AlphaCompute/alphaphone/issues/417)):** A downward swipe on empty launcher Home opens Android’s shade. Preserve top-edge Android behavior and content/conversation scrolling. Standalone follows ordinary app behavior.

- **P-34 — A-34 ([#418](https://github.com/AlphaCompute/alphaphone/issues/418)):** Free, cancelled and declined entries are not busy. Offer owner-selected free/busy-only calendars without exposing details. Tentative/unanswered blocking entries count conservatively; unavailable/stale reads are unknown, never free.

- **P-35 — A-35 ([#419](https://github.com/AlphaCompute/alphaphone/issues/419)):** A reviewed Use in email suggestion may attach items selected in Files or Photos. Context selection is not itself permission to attach. Insert into a draft; final Send is separate.

- **P-36 — A-03 ([#420](https://github.com/AlphaCompute/alphaphone/issues/420)):** Phone, Contacts and SMS are included only in the AOSP fork. Hide and capability-gate them in standalone APKs and other non-AOSP product installs. The launcher flavor alone is not proof of an Alpha image. Wallet is outside MVP.

- **P-37 — A-07 ([#421](https://github.com/AlphaCompute/alphaphone/issues/421)):** Communication providers are Gmail and text messaging. Gmail is available in both product distributions; SMS/MMS is device/SIM based and only exposed on the Alpha AOSP image. Telegram, Discord and additional mail providers stay deferred. Device Calendar/Contacts sources remain separate native permissions.

- **P-38 — A-08 ([#422](https://github.com/AlphaCompute/alphaphone/issues/422)):** Wallet is removed from the MVP plan. No custody, payment, pass-wallet, NFC payment integration or wallet-provider activation is required for MVP. Preserve unrelated user data; do not activate prototype transfers.

- **P-39 — MVP-01 ([#423](https://github.com/AlphaCompute/alphaphone/issues/423)):** Transcribe records locally and on Stop inserts editable text; the user sends it. Voice assistant listens and submits automatically: after a short gap evaluate semantic turn completion with Clef; after a longer gap submit. Resumed speech cancels pending submit or the in-flight response/playback and continues the utterance/conversation. All STT/TTS remains local.

- **P-40 — MVP-52 ([#424](https://github.com/AlphaCompute/alphaphone/issues/424)):** Always-on listening and supported hardware-key invocation are required in the AOSP MVP, not a later milestone. Use a narrowly privileged isolated listener only; the ordinary Alpha app remains nonprivileged. Listening is off until consent, local, visibly indicated and immediately stoppable.

- **P-41 — OWNER-NOTICE ([#425](https://github.com/AlphaCompute/alphaphone/issues/425)):** Withdraw owner-specific approval notices on owner change. Repost quietly when the original owner returns only if the approval remains pending, valid and unexpired. Keep workflow state; revalidate the target and create a fresh tap binding. Apply the same privacy boundary to owner-specific result notices.

## Resolved decision index

| ID | Policy | Implementation | State |
| --- | --- | --- | --- |
| A-09 | P-10 | [#394](https://github.com/AlphaCompute/alphaphone/issues/394) | TODO |
| A-10 | P-11 | [#395](https://github.com/AlphaCompute/alphaphone/issues/395) | TODO |
| A-02 | P-12 | [#396](https://github.com/AlphaCompute/alphaphone/issues/396) | TODO |
| A-04 | P-13 | [#397](https://github.com/AlphaCompute/alphaphone/issues/397) | TODO |
| A-05 | P-14 | [#398](https://github.com/AlphaCompute/alphaphone/issues/398) | TODO |
| A-01 | P-15 | [#399](https://github.com/AlphaCompute/alphaphone/issues/399) | TODO |
| A-06 | P-16 | [#400](https://github.com/AlphaCompute/alphaphone/issues/400) | TODO |
| A-11 | P-17 | [#401](https://github.com/AlphaCompute/alphaphone/issues/401) | TODO |
| A-12 | P-18 | [#402](https://github.com/AlphaCompute/alphaphone/issues/402) | TODO |
| A-13 | P-19 | [#403](https://github.com/AlphaCompute/alphaphone/issues/403) | TODO |
| A-14 | P-20 | [#404](https://github.com/AlphaCompute/alphaphone/issues/404) | TODO |
| A-15 | P-21 | [#405](https://github.com/AlphaCompute/alphaphone/issues/405) | TODO |
| A-16 | P-22 | [#406](https://github.com/AlphaCompute/alphaphone/issues/406) | TODO |
| A-17 | P-23 | [#407](https://github.com/AlphaCompute/alphaphone/issues/407) | TODO |
| A-18 | P-24 | [#408](https://github.com/AlphaCompute/alphaphone/issues/408) | TODO |
| A-19 | P-25 | [#409](https://github.com/AlphaCompute/alphaphone/issues/409) | TODO |
| A-20 | P-26 | [#410](https://github.com/AlphaCompute/alphaphone/issues/410) | TODO |
| A-22 | P-27 | [#411](https://github.com/AlphaCompute/alphaphone/issues/411) | TODO |
| A-23 | P-28 | [#412](https://github.com/AlphaCompute/alphaphone/issues/412) | TODO |
| A-24 | P-29 | [#413](https://github.com/AlphaCompute/alphaphone/issues/413) | TODO |
| A-25 | P-30 | [#414](https://github.com/AlphaCompute/alphaphone/issues/414) | TODO |
| A-26 | P-31 | [#415](https://github.com/AlphaCompute/alphaphone/issues/415) | TODO |
| A-32 | P-32 | [#416](https://github.com/AlphaCompute/alphaphone/issues/416) | TODO |
| A-33 | P-33 | [#417](https://github.com/AlphaCompute/alphaphone/issues/417) | TODO |
| A-34 | P-34 | [#418](https://github.com/AlphaCompute/alphaphone/issues/418) | TODO |
| A-35 | P-35 | [#419](https://github.com/AlphaCompute/alphaphone/issues/419) | TODO |
| A-03 | P-36 | [#420](https://github.com/AlphaCompute/alphaphone/issues/420) | TODO |
| A-07 | P-37 | [#421](https://github.com/AlphaCompute/alphaphone/issues/421) | TODO |
| A-08 | P-38 | [#422](https://github.com/AlphaCompute/alphaphone/issues/422) | TODO |
| MVP-01 | P-39 | [#423](https://github.com/AlphaCompute/alphaphone/issues/423) | TODO |
| MVP-52 | P-40 | [#424](https://github.com/AlphaCompute/alphaphone/issues/424) | TODO |
| OWNER-NOTICE | P-41 | [#425](https://github.com/AlphaCompute/alphaphone/issues/425) | TODO |
| A-21 | P-09 | Closed: licensed; the owner holds the licence outside the repository (P-09); no licence document, name, number, scope or terms has been seen or recorded | Policy closed |

## Open decisions

The 32 reviewed product choices are resolved. Implementation details that still need
measurement (speech candidate, Clef feasibility, subscription price/quotas, Cloud Maps
provider coverage) are deliverables in their TODOs; they do not reopen the approved
local-only agent/speech, subscription, AOSP scope or Wallet exclusion policies.

## Pending owner decisions

No reviewed A-01–A-26/A-32–A-35/MVP-01/MVP-52/owner-notice item remains awaiting
owner policy. A-21 was already closed under P-09; A-27–A-31 were never decision IDs.
The [approved backlog](owner-approved-mvp-plan-2026-10-12.md) contains every checklist.
Earlier questions and evidence remain in Git history and the historical details of
each issue; no failed or unrun acceptance result becomes a pass through this decision.

## Closed owner decisions

A-21 remains licensed by owner statement under P-09, with the licence held outside
the repository. The 32 October 12 choices are policy-resolved above; their associated
implementation issues remain open TODOs. Existing P-02–P-06/P-08/P-09 continue where
not explicitly superseded (reset-only removes data import/export requirements;
normal-browser third-party cookies are now allowed).

## October 15 Google Calendar service decision

During Alpha QA the product owner explicitly requested agent-driven Gmail and Google Calendar tests, local Calendar-to-Google sync, the required Gmail-send/Calendar-event permission upgrade, and completion of the linked integration. The owner approved those Google permissions. This extends AP-09: Eliza Cloud owns Google OAuth token custody and the owner-scoped Calendar read/conditional-write API. Generic native Calendar adapters, local data, orchestration and the agent stay on the phone. The Google connection is optional; local Calendar use does not require a Google connection.

Cloud permission consent does not enable sync by itself. Settings reviews the exact account/destination before opt-in; direct agent writes retain their owner review. Device Calendar access still requires its native permission. Unknown outcomes require readback; unsupported recurrence/attendee fields must not be flattened. Source tests, backend deployment, real provider writes and physical-phone acceptance remain separate. Custom Gmail labels and categories are deferred.

## October 16: existing Cloud credit billing
The owner requested use of the existing funded Cloud account. The native provider uses the standard Cloud API key and /api/v1 endpoint. The current API admits organization-credit requests through its normal credential, quota and credit-reservation checks. A billing snapshot with subscription.status=not_applicable and reason=no_organization_subscription is not an inference refusal.

This supersedes P-43's plan-only assumption for that explicit legacy billing mode while the signed entitlement route is absent. Alpha binds only the verified account and credential reference, shows Cloud credits rather than an active plan, and keeps bounded background refresh. Signed plan validation, account changes, expiry, revocation, quotas and server refusals keep their existing checks. Alpha does not create a plan, grant funds, buy anything, make per-turn balance checks or retry a failed turn.

## November 5: on-device speech default and acceleration

Decided by the product owner on 2026-11-05. Same rules as above: policy, not evidence.

- **P-57** On-device speech replaces Cartesia as the default: Phonon-2 and Paradee on libelizainference, in the `native` profile, with Eliza Cloud text inference. The `cloud` profile remains an explicit QA selection.
- **P-58** Accelerators are used only when they are faster on the path that ships. Measured on the Pixel 10a (Tensor G4), Phonon-2's streaming finish takes 45 to 54 ms on the CPU, and a best-case TPU pass cannot go below about 59 ms for 5 s of audio, so Phonon-2 stays on the CPU. P-42 therefore stands. See [on-device speech](on-device-speech-2026-11-05.md). A faster future chip or model reopens this.
- **P-59** The Delibes-8M-esES Spanish voice ships under its open-source licence (Apache-2.0 for the model files), with its notices in the bundle and the generated third-party notices. This is the owner's Alpha decision on the upstream `spanish.release_override`.
