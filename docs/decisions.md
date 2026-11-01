# Architecture and product decisions

October 1 architecture change: the user has selected an **Android-resident agent instead of Nitro/TEE hosting**. The [on-device agent plan](on-device-agent-plan.md) supersedes cloud-only and enclave-primary requirements below. Agent execution and model inference are separate: the implemented path uses hosted Cerebras text inference and local orchestration; fully offline language-model operation remains unqualified. Historical evidence is retained. October 12 policy below resolves powered-off scheduling: schedules run only while the phone is powered on.

## Accepted foundation decisions

1. Keep Alpha Phone and senior-care independent: separate repository, application ID, renderer, assets and release stream.
2. Use a pinned Eliza source submodule while upstream consumer exports stabilize. Avoid publishing every workspace package before testing the actual dependency closure.
3. Package the pinned Eliza runtime with the Capacitor shell and use native authenticated IPC for the resident agent. Browser development runs the real agent on a private local host. Cloud/remote adapters remain historical/development infrastructure only; October 12 policy prohibits every hosted-agent product connection. Connected chat reports the actual protocol outcome; starting, recovering or inference-unavailable states must not simulate a successful send (P-43: the resident agent is always present). See [current status](mvp-current-status.md) for the remaining integration and device acceptance.
4. Use standalone and launcher product flavors with the same Alpha identity. Switching flavor replaces the installed Alpha app. Senior-care has a different identity and can coexist.
5. Make AOSP installation additive, nonprivileged and certificate/hash verified. Device provisioning chooses default HOME. Keep system recovery paths available. **Amended by P-75 (2026-10-29):** image provisioning also preassigns Alpha as default dialer and SMS app, and unattended field updates add a narrowly privileged update client beside the listener.
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

  What this entry does not claim. "Included and flagged" is not legal review. The obligations a flag names (corresponding source for GPL, AGPL and LGPL components, a replaceable library for LGPL, a source offer that extends to network use for AGPL) are stated, not shown to be met. The first statement covers open-source software: the resident runtime payload contained one package under non-commercial terms (`@metamask/sdk`, flagged `non-open-source-terms`; see the dependency audit), which none of the three statements addresses. **Amended by P-71 (2026-10-29):** the owner accepted the `@metamask/sdk` licence and accepted the flagged copyleft obligations as fulfilled for the pilot, with legal review before any wider release. From the pin that carries the shared mobile wallet-connector exclusion, the Android resident bundle resolves wagmi, RainbowKit and `@metamask/*` to a stub, so the package is no longer expected in the payload; `test/wallet-disabled.test.mjs` checks a staged runtime inventory for it.

## October 12 owner product decision: one local inference engine

Decided by the product owner on 2026-10-12 and recorded on 2026-10-13. Same rules as above: policy, not evidence. (It was first recorded as P-10 on a branch; P-10 is the schedules decision below, so this one is P-42.)

- **P-42** One local inference engine (product owner): on-device and local speech and inference use only the native llama.cpp-based stack, libelizainference (ggml, mtmd, OmniVoice, Kokoro and Silero VAD from the elizaOS fused fork, GGUF models). The owner's reason: the earlier runtimes were too slow and too memory-inefficient. Consequences: the in-browser Whisper engine, its WebAssembly runtime and its model files are removed from the web build, and the Android Sherpa engine and its models are removed from the APKs; neither may return (`test/llama-cpp-only.test.mjs`, `scripts/audit-production-bundle.mjs`). A browser with no local agent has no local speech and says so (`local-agent-required`); it never falls back to Cloud on its own. P-13 and P-29 (all speech on the device, no Cloud speech fallback) are implemented on this engine: the local speech they require is libelizainference, and its acceptance must be run there (see [fused speech](fused-speech.md)). This records the policy; it is not evidence that the replacement is built, qualified or accepted. **Amended by P-60 (2026-10-29):** local speech still uses only libelizainference; Cloud STT/TTS is now available as an explicit user setting, never as an automatic fallback.

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
  **Amended by P-62 (2026-10-29):** the Maps allowance is Plus 1,000 and Pro 5,000
  requests a day.

## October 12 owner decisions

The owner approved the following choices in chat on 2026-10-12. The matching GitHub
issues are now implementation TODOs, not unanswered decision requests. The policy
below controls over older PRD/plan wording and source defaults. Acceptance remains
open. In particular Wallet is removed from MVP, superseding the October 11 expansion.

- **P-10 — A-09 ([#394](https://github.com/AlphaCompute/alphaphone/issues/394)):** Schedules run only while the phone is powered on; the agent is local. Remove powered-off hosted-loop acceptance. Record missed occurrences once; do not automatically replay overdue effects. Offer an explicit Run now action where useful. **Amended by P-75 (2026-10-29):** the missed-run window is 30 minutes and Run now keeps its implemented scope (typed scheduled workflows and morning digests).

- **P-11 — A-10 ([#395](https://github.com/AlphaCompute/alphaphone/issues/395)):** Voice-assistant latency is the elapsed time from the last user speech audio sample to the first audible response sample. Include end-of-turn detection, final STT, inference, TTS and playback buffering. Do not subtract silence detection or report a sum of selected stages as the end-to-end result. Dictation reports stop-to-editable-text separately; manual user think time is not a voice-assistant benchmark.

- **P-12 — A-02 ([#396](https://github.com/AlphaCompute/alphaphone/issues/396)):** Eliza Cloud is the managed account, inference, subscription and Maps service endpoint. Agent orchestration, state, scheduling and approvals remain on the phone. No Cloud/hosted agent exists as a product connection, upgrade or fallback.

- **P-13 — A-04 ([#397](https://github.com/AlphaCompute/alphaphone/issues/397)):** All speech recognition and synthesis run locally on the device, always. Replace Cloud/paired-host speech policy. Use the Android native bridge to the reviewed Eliza llama.cpp/libelizainference build, extending shared upstream speech support where necessary. Research candidate models on Hugging Face and select by measured device speed and quality, not advertised desktop throughput. **Amended by P-60 (2026-10-29):** STT and TTS stay local by default; Settings offers a local vs cloud switch for each.

- **P-14 — A-05 ([#398](https://github.com/AlphaCompute/alphaphone/issues/398)):** Use periodic background work and immediate reconciliation at resume/start. Doze delays are honest; a permanent connection solely for mail is not required. Stable event identities prevent duplicate user-visible alerts.

- **P-15 — A-01 ([#399](https://github.com/AlphaCompute/alphaphone/issues/399)):** Target Pixel 10a on Android 17. Ship standalone APK and Alpha AOSP image/launcher; Cuttlefish is the image integration test target. Other Pixels are not alternate promised hardware.

- **P-16 — A-06 ([#400](https://github.com/AlphaCompute/alphaphone/issues/400)):** Alpha Compute controls signing and update authority; Shaw is the accountable release/support/rollback owner. Use managed or hardware-backed release signing, distinct from developer keys. **Amended by P-58 (2026-10-29):** release keys are held as GitHub Actions secrets for a CI signing job, an owner-accepted departure from managed or hardware-backed signing; they stay distinct from developer keys.

- **P-17 — A-11 ([#401](https://github.com/AlphaCompute/alphaphone/issues/401)):** Android Clock owns alarms, conditional on a usable integration in the app and AOSP image. Alpha owns reminders. A dispatch receipt may state that Clock opened, not that an alarm was created.

- **P-18 — A-12 ([#402](https://github.com/AlphaCompute/alphaphone/issues/402)):** Passkeys are outside MVP acceptance. Integrated passwords remain in scope. A later release may use the system credential provider after actual browser/image qualification; Alpha is not a new passkey provider now.

- **P-19 — A-13 ([#403](https://github.com/AlphaCompute/alphaphone/issues/403)):** Third-party cookies are allowed in normal browsing. Persistent first-party sign-ins remain. Private tabs remain ephemeral and strict; browser storage stays separate from the privileged app WebView.

- **P-20 — A-14 ([#404](https://github.com/AlphaCompute/alphaphone/issues/404)):** Every eligible login surface in Alpha should support password-manager fill. The isolated Browser is currently the website-login surface; future Alpha-owned login forms must also be covered. This is not blanket trust of arbitrary external browsers and does not expose passwords to the agent.

- **P-21 — A-15 ([#405](https://github.com/AlphaCompute/alphaphone/issues/405)):** Include reading, read/unread, archive, drafts, reply/forward, reviewed send, opening/saving attachments and user-selected outbound attachments. Defer custom label management.

- **P-22 — A-16 ([#406](https://github.com/AlphaCompute/alphaphone/issues/406)):** Only the local resident agent is supported. No hosted agent, dedicated-agent purchase, remote pairing or Cloud-agent fallback is a product option, now or as an advanced setting.

- **P-23 — A-17 ([#407](https://github.com/AlphaCompute/alphaphone/issues/407)):** Use the system secure camera and its AOSP lock-screen gesture. Alpha does not implement its own secure camera; agent/library/account access stays behind unlock.

- **P-24 — A-18 ([#408](https://github.com/AlphaCompute/alphaphone/issues/408)):** Provide full device photo/video library access to the local agent where Android permits and the user grants it, rather than limiting the product to owned captures or picker selections. Handle partial/denied access honestly. Full local access does not imply automatic upload of the entire library.

- **P-25 — A-19 ([#409](https://github.com/AlphaCompute/alphaphone/issues/409)):** No app-data import/export, backup or device-transfer product workflow. Provide a confirmed Reset Alpha data option. Keep Android backup disabled. Ordinary Files opening/saving and Gmail attachments are separate daily-tool operations, not app-data migration.

- **P-26 — A-20 ([#410](https://github.com/AlphaCompute/alphaphone/issues/410)):** Use subscription billing with reasonable rate limits rather than a user-facing credit top-up/per-token meter. Billing checks must not add a billing-service round trip to each assistant turn. Local speech and local tools do not depend on an online billing check. **Amended by P-59 and P-62 (2026-10-29):** the "Membership & credits" sheet shows organization credit in the October 16 credit mode (P-59), and catalog v1 and its per-minute limits are confirmed (P-62).

- **P-27 — A-22 ([#411](https://github.com/AlphaCompute/alphaphone/issues/411)):** Support portrait and landscape, adapting each surface by its purpose. Do not stretch every panel or change sensitive/native UI ownership. Preserve drafts, scroll, selection, task and capture state.

- **P-28 — A-23 ([#412](https://github.com/AlphaCompute/alphaphone/issues/412)):** Maps belongs in Eliza Cloud as a reusable managed service for agents, with full supported search, place, route and navigation control from Alpha’s local agent. The regional development gateway is a prototype adapter, not the production coverage promise. No hosted agent is introduced. **Amended by P-64 (2026-10-29):** the production provider is Google Maps Platform through Eliza Cloud, with Google's coverage.

- **P-29 — A-24 ([#413](https://github.com/AlphaCompute/alphaphone/issues/413)):** On-device STT and TTS are mandatory for every production speech entrypoint, including signed-out and offline use. No Cloud speech fallback. A failed local engine must surface recovery and typing, not switch routes. **Amended by P-60 (2026-10-29):** on-device STT and TTS are the default; cloud STT and cloud TTS are explicit Settings choices, never an automatic fallback.

- **P-30 — A-25 ([#414](https://github.com/AlphaCompute/alphaphone/issues/414)):** Use a short durable Undo window and one review step for events and reminders. Initial engineering value: ten seconds. Delay provider deletion until expiry when possible; never call a recreated invitation a lossless restore. Suspend pending-deletion reminder delivery immediately.

- **P-31 — A-26 ([#415](https://github.com/AlphaCompute/alphaphone/issues/415)):** No Cloud-agent host is admitted. The resident agent uses the local native bridge. Cloud inference, subscription, Gmail and Maps are managed services, not agent hosts.

- **P-32 — A-32 ([#416](https://github.com/AlphaCompute/alphaphone/issues/416)):** Use Android’s shade as the single notification/quick-settings surface if it integrates correctly and matches the product design. Keep workflow history in Alpha; remove the competing imitation shade. Use normal notifications/tiles before custom SystemUI changes.

- **P-33 — A-33 ([#417](https://github.com/AlphaCompute/alphaphone/issues/417)):** A downward swipe on empty launcher Home opens Android’s shade. Preserve top-edge Android behavior and content/conversation scrolling. Standalone follows ordinary app behavior.

- **P-34 — A-34 ([#418](https://github.com/AlphaCompute/alphaphone/issues/418)):** Free, cancelled and declined entries are not busy. Offer owner-selected free/busy-only calendars without exposing details. Tentative/unanswered blocking entries count conservatively; unavailable/stale reads are unknown, never free.

- **P-35 — A-35 ([#419](https://github.com/AlphaCompute/alphaphone/issues/419)):** A reviewed Use in email suggestion may attach items selected in Files or Photos. Context selection is not itself permission to attach. Insert into a draft; final Send is separate.

- **P-36 — A-03 ([#420](https://github.com/AlphaCompute/alphaphone/issues/420)):** Phone, Contacts and SMS are included only in the AOSP fork. Hide and capability-gate them in standalone APKs and other non-AOSP product installs. The launcher flavor alone is not proof of an Alpha image. Wallet is outside MVP.

- **P-37 — A-07 ([#421](https://github.com/AlphaCompute/alphaphone/issues/421)):** Communication providers are Gmail and text messaging. Gmail is available in both product distributions; SMS/MMS is device/SIM based and only exposed on the Alpha AOSP image. Telegram, Discord and additional mail providers stay deferred. Device Calendar/Contacts sources remain separate native permissions.

- **P-38 — A-08 ([#422](https://github.com/AlphaCompute/alphaphone/issues/422)):** Wallet is removed from the MVP plan. No custody, payment, pass-wallet, NFC payment integration or wallet-provider activation is required for MVP. Preserve unrelated user data; do not activate prototype transfers.

- **P-39 — MVP-01 ([#423](https://github.com/AlphaCompute/alphaphone/issues/423)):** Transcribe records locally and on Stop inserts editable text; the user sends it. Voice assistant listens and submits automatically: after a short gap evaluate semantic turn completion with Clef; after a longer gap submit. Resumed speech cancels pending submit or the in-flight response/playback and continues the utterance/conversation. All STT/TTS remains local. **Amended by P-60 (2026-10-29):** Clef end-of-turn detection runs in Eliza Cloud on Cloudflare, and STT/TTS are local by default with Settings switches for cloud.

- **P-40 — MVP-52 ([#424](https://github.com/AlphaCompute/alphaphone/issues/424)):** Always-on listening and supported hardware-key invocation are required in the AOSP MVP, not a later milestone. Use a narrowly privileged isolated listener only; the ordinary Alpha app remains nonprivileged. Listening is off until consent, local, visibly indicated and immediately stoppable. **Amended by P-61 and P-75 (2026-10-29):** the dedicated `alpha_sense_app` SELinux domain (G7) is required before MVP (P-61); an unattended-update client is a second narrowly privileged component (P-75).

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

The selections these policies leave to the owner are listed in order, each with the setting or
record that waits for it, in [human actions](human-actions.md) H-01 to H-07: release key custody
(P-16 names no service), confirming or replacing the server-published plan catalog (P-26), the
plan request limits and the separate Maps allowance (P-56), Maps coverage (P-28), the
`@metamask/sdk` terms that P-09 does not cover, and the pilot roles. Each is recorded here as a
dated `P-` entry when made; none is chosen by software. On 2026-10-29 the owner made all seven
selections: custody P-58, catalog, limits and Maps allowance P-62, Maps coverage P-64,
`@metamask/sdk` P-71 and the pilot roles P-72 (see [October 29 owner decisions](#october-29-owner-decisions)).
The steps that carry them out (the key ceremony, enrollment, Cloud settings and the pilot) remain
open in [human actions](human-actions.md).

### Open engineering question: a view change during a reply (2026-10-28)

Current behaviour: a typed reply in flight is stopped when the screen it was asked from changes.
`AlphaClient.setViewContext` (`apps/app/src/runtime/alpha-client.ts`) aborts the foreground request
whenever the view context's revision moves, so HOME pressed while another app is in front, or
opening another app, is an explicit Stop: one cancel through the agent's abort route where it has
one, the "may still finish" notice, and one history read that shows the reply if it finished.
Nothing is resent. Collapsing the chat (Back from full to sheet) and HOME while Home is already in
front change no view, so the reply keeps arriving and is shown once.
`test/browser/chat-continuity.spec.ts` pins both.

The question for the owner: should a view change stop the reply, or should the reply keep
arriving (as it does for Back and HOME on Home) while only actions and proposals bound to the old
screen are refused (`contextRevision` already fences proposals)? Until it is decided the current
behaviour stays and no software chooses otherwise. Tracked with the other open engineering
choices in issue #680.

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

## October 29 owner decisions

Decided by the product owner on 2026-10-29 in answer to the HUMAN issues #658 to #681. The
owner's answers are posted on each issue as a comment headed "Owner decisions, 2026-10-29"; those
comments are the source of these entries. Each entry names the [human actions](human-actions.md)
step it settles. Same rules as above: policy, not evidence. None of these entries shows that a key
exists, a release was signed, a service was deployed, a run passed or a device was accepted; every
acceptance gate in [current status](mvp-current-status.md) still applies. Where an entry amends an
earlier one, the earlier entry carries a dated "Amended by" note and keeps its original text.

- **P-57** — H-36 ([#658](https://github.com/eliza-research/alphaphone/issues/658), [#679](https://github.com/eliza-research/alphaphone/issues/679)): No branch protection is added for now. The
  no-force-push and signed-commit rulesets and the "Main required checks" ruleset (MVP-46) are not
  installed yet; H-36 stays the owner's open choice. This changes nothing already enforced on the
  default branch. The rest of the 2026-10-27 forged-commit response stays open under #658: secret
  rotation, revoking the forged-commit author's access, machine checks and the audit-log review.
- **P-58** — H-01, H-08, H-10 / A-06 ([#661](https://github.com/eliza-research/alphaphone/issues/661), [#662](https://github.com/eliza-research/alphaphone/issues/662), [#672](https://github.com/eliza-research/alphaphone/issues/672)): Release
  keys are stored as **GitHub Actions secrets** and used by a CI signing job, for the release APKs
  and for the Pixel 10a image and OTA. The owner knowingly accepts that this is weaker than HSM or
  offline custody. **This departs from P-16's requirement of managed or hardware-backed release
  signing and amends P-16**; the keys must still be distinct from developer keys. The owner runs
  the key ceremony locally and uploads the keys with `gh secret set`; no agent generates, sees or
  uploads a key, and no key material, passphrase or PIN is recorded in this repository. The
  ceremony custodian and witness is the owner; a distinct witness is still recommended. The legal
  entity in the release certificates is **Alpha Compute**. The first release has versionName
  **0.1.0**, and its versionCode is the next integer above the last recorded release. With no
  branch protection (P-57), keeping the secrets to the signing job is a matter of workflow review.
- **P-59** — H-37 ([#660](https://github.com/eliza-research/alphaphone/issues/660), [#659](https://github.com/eliza-research/alphaphone/issues/659)): The two defaults taken on 2026-10-28 are
  confirmed. (1) The Settings membership sheet stays **"Membership & credits"**, the
  organization-credit mode of the October 16 Cloud credit billing entry. For that mode this is an
  exception to P-26's "rather than a user-facing credit top-up" and **amends P-26**; subscription
  plans keep P-26 as written, including no billing round trip per turn. On the phone's own agent the
  "Eliza Cloud account & plan" panel is the correct surface; off it, the "Membership & credits"
  sheet. The failing native Cloud-subscription cases are each fixed to boot the right flow, never
  by loosening the `residentCloudFlow()` guard. (2) Notes are stored as **canonical Eliza records**
  (#621); the older Notes-storage specifications are rewritten for canonical records, keeping their
  Trash, recovery and deletion guarantees, not retired.
- **P-60** — AP-06, H-18, H-19 / MVP-01 ([#663](https://github.com/eliza-research/alphaphone/issues/663)): **Clef end-of-turn detection and the
  LLM run in Eliza Cloud on Cloudflare.** STT and TTS stay on the device by default, and Settings
  gains a **local vs cloud switch for STT and a separate one for TTS**. This **amends P-13 and P-29**
  ("all speech on the device, always", "no Cloud speech fallback"), **P-39** ("all STT/TTS remains
  local", and Clef runs in Cloud rather than on the phone) and **P-42** (local speech still uses only
  libelizainference; Cloud speech is now a user choice). Cloud speech is an explicit setting, not
  an automatic route: a failed local engine still surfaces recovery and typing (P-29). The cloud path
  needs an honest disclosure of what leaves the device (audio for cloud STT, text for cloud TTS, the
  turn-detection input for Clef) within the claims ladder of foundation item 7, and a defined
  fallback when offline or without a plan, before it ships. P-39's long-gap submission and P-11's
  latency definition are unchanged. Eliza Cloud remains a managed service here, not an agent host
  (P-12, P-31).
- **P-61** — H-20 ([#664](https://github.com/eliza-research/alphaphone/issues/664)): **G7, the dedicated `alpha_sense_app` SELinux domain for the
  always-on listener, is required before the MVP ships**, not deferred. This tightens P-40. The
  reviewer is NubsCarson and the device operator is the owner. No G6 battery or thermal bar was
  chosen; engineering proposes one in the [listener runbook](runbooks/664-listener-qualification.md)
  for the owner to accept.
- **P-62** — H-02, H-03, H-04 / A-20 ([#665](https://github.com/eliza-research/alphaphone/issues/665)): The published plan catalog **v1 is
  confirmed**: Plus USD 30 a month with a USD 25 allowance, Pro USD 100 with USD 90, no rollover.
  The plan request limits (`ELIZA_CLOUD_PLAN_RATE_LIMITS`) are **v1's per-minute limits**: Plus
  completions 120, embeddings 200, standard 60, strict 10; Pro 300, 600, 120 and 30. The Maps
  request allowance (`ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES`) is **Plus 1,000 requests a day and Pro
  5,000 requests a day**, with no per-request charge. This sets the numbers P-26 left open and
  **amends P-56** ("numeric prices and limits remain unset"); P-56's separate allowance, no
  automatic overage and local speech's independence from billing are unchanged. The values are
  applied per environment, staging first (H-15, H-16).
- **P-63** — H-15 ([#666](https://github.com/eliza-research/alphaphone/issues/666)): The deployed admission-latency benchmark runs against
  **staging**, with dedicated per-condition staging accounts. The billing outage is simulated with a
  staging-only switch (a configuration flag or a blocked billing route), never in production. The
  harness runs from an elizaOS develop checkout that contains it, not from the vendor pin. The
  owner left the remaining details to engineering judgement.
- **P-64** — H-05, H-16, H-35 / A-23 ([#667](https://github.com/eliza-research/alphaphone/issues/667)): Production Maps uses a **hosted provider,
  Google Maps Platform**, through Eliza Cloud, not a self-hosted OpenStreetMap stack. Google's terms
  (attribution and caching limits) replace the ODbL/OpenStreetMap attribution duties for production
  results. A Google Maps Platform billing account and API key are provisioned in Eliza Cloud, never
  on the phone. Coverage follows Google's. This chooses the provider and coverage that **P-28** left
  open and amends it; the agent's Maps tools and the Maps allowance (P-56, P-62) are unchanged, and
  the regional development gateway stays a prototype adapter.
- **P-65** — H-17, H-27 / AP-09 ([#668](https://github.com/eliza-research/alphaphone/issues/668)): Gmail and Calendar use **Eliza Cloud's existing,
  already-verified Google OAuth app**; no separate verification is submitted. Still to confirm:
  that its verification covers the restricted Gmail scopes Alpha requests (the
  [scope matrix](runbooks/668-google-capability-scope-matrix.md)). The live send acceptance (H-27)
  goes from the owner's own Google account to the owner's own address, subject "Alpha pilot send
  test", at the device pilot.
- **P-66** — H-12 ([#669](https://github.com/eliza-research/alphaphone/issues/669)): Staging Steward supports native Google sign-in for test-mocks
  builds. The pre-release Android OAuth clients are dropped: after enrollment
  `STEWARD_GOOGLE_NATIVE_CLIENT_IDS` lists only the release-signed client.
- **P-67** — H-13 ([#670](https://github.com/eliza-research/alphaphone/issues/670)): The production `assetlinks.json` on eliza.app lists the
  **enrolled release certificate and keeps the two existing certificates** (this project's debug
  signer `22:42:99:4D…` and the candidate resident-artifact signer `ED:BF:CA:CB…`). The owner
  keeps them knowingly: the debug certificate keeps verified eliza.app callback handling.
- **P-68** — H-30 ([#671](https://github.com/eliza-research/alphaphone/issues/671)): The Cerebras development key is provided to hosted CI as a
  **GitHub Actions secret**, scoped to the workflows that need it. The owner adds it with
  `gh secret set`, after or alongside the #658 secret rotation. It stays a development key:
  production phones accept inference only through the signed-in Cloud plan (P-43), and no key
  enters a product bundle.
- **P-69** — H-21, H-22 / A-01 ([#672](https://github.com/eliza-research/alphaphone/issues/672)): The Pixel 10a production image is built on a
  **cloud builder** the owner provisions (about 64 cores, 256 GB RAM, 1 TB disk). Its
  cuttlefish-base and cuttlefish-user versions are pinned in `product.json`. Image and OTA signing
  follow P-58.
- **P-70** — H-24, H-25 ([#673](https://github.com/eliza-research/alphaphone/issues/673)): The Pixel 10a pilot units are **left bootloader-unlocked**
  after `avb_custom_key` enrollment. Verified boot shows orange, so pilot results are not
  production-representative and never stand in for a locked-bootloader release. Each unit owner's
  consent is obtained before any flash or reset.
- **P-71** — H-06, H-35 ([#674](https://github.com/eliza-research/alphaphone/issues/674)): The **`@metamask/sdk` 0.33.1 licence is accepted**, so the
  resident runtime may ship it. Cycle 2 may still prune the `@metamask/sdk` and `wagmi` graph
  where it is unreachable, disabled Wallet code; Wallet stays outside the MVP (P-38 unchanged).
  The flagged copyleft obligations (ffmpeg-static, ua-parser-js, rpc-websockets, JavaScriptCore,
  eSpeak NG) are **accepted as fulfilled today for the pilot**; a legal review is required before
  any wider release. This **amends P-09**, whose statements did not cover `@metamask/sdk`. It is an
  owner acceptance, not legal review. *Amended by P-77 (2026-10-29): AGPL dependencies are
  accepted generally, not only for the pilot.*
- **P-72** — H-07, H-26, H-27, H-29 ([#675](https://github.com/eliza-research/alphaphone/issues/675), [#677](https://github.com/eliza-research/alphaphone/issues/677)): The owner is the operator,
  support owner, rollback owner, key custodian and witness. **NubsCarson is the independent
  reviewer.** The pilot cohort is the internal team only (the owner, the reviewer and teammates),
  names to follow. Pilot plans are **3-month grant codes**. The Gmail live send is owner to owner
  (P-65). Proton Pass is skipped for the pilot; P-05's optional provider is not part of pilot
  acceptance.
- **P-73** — H-31 ([#676](https://github.com/eliza-research/alphaphone/issues/676)): The hosted CI campaigns are dispatched once on current main.
  Dispatched on 2026-10-29 at `8f1737533`: resident-android native including recovery-ui
  ([run](https://github.com/eliza-research/alphaphone/actions/runs/40822720344)),
  android-emulator instrumentation
  ([run](https://github.com/eliza-research/alphaphone/actions/runs/40822722622)),
  android-emulator browser-reading
  ([run](https://github.com/eliza-research/alphaphone/actions/runs/40822725753)) and digest-restart
  ([run](https://github.com/eliza-research/alphaphone/actions/runs/40822728120)).
  `ELIZA_RESIDENT_QUALIFICATION` stays unset, so these are dispatches, not qualification. The
  resident native inference parts need the Cerebras Actions secret (P-68). Their results are
  recorded separately.
- **P-74** — H-38 ([#678](https://github.com/eliza-research/alphaphone/issues/678)): The owner's per-view QA review is **batched by surface**, one
  batch per app.
- **P-75** — AP-04, AP-08, AP-14 ([#680](https://github.com/eliza-research/alphaphone/issues/680)): (1) The missed-run window is **30 minutes**, up
  from 120 s, for generic, typed and digest schedules alike; an occurrence that reaches the agent
  later is recorded once as missed and not run late. (2) **Run now keeps its current scope**: typed
  scheduled workflows and morning digests, behind the reviewed two-step confirmation. (3) The
  emulator development host **is kept** as a test-mocks-only developer surface. (4) The AOSP image
  **preassigns Alpha as the default dialer and SMS app**; HOME, assistant and Autofill stay
  preassigned as today, and emergency routing stays with the system. (5) Field updates are
  **unattended**. This **amends P-10** (the window and Run now scope), **foundation item 5** (image
  provisioning now also assigns the dialer and SMS roles) and **P-40**: unattended updates need a
  narrowly privileged on-device update client applying signed channel packages through
  `update_engine`, a second privileged component beside the listener. The ordinary Alpha app
  stays nonprivileged. The update drills (interrupted update, rollback, stock recovery) stay
  required (H-25).
- **P-76** — Eliza-side ([#681](https://github.com/eliza-research/alphaphone/issues/681)): Eliza's app **adopts all four shared components**: the
  DataReset coordinator, the native Cloud sign-in (`CloudSignInPlugin`), the nonprivileged-launcher
  profile for Eliza's images, and the Clock handoff policy, migrating existing `ElizaAlarms`.
  **Eliza's SMS gateway must go through the reviewed send**; there are no unreviewed auto-replies.
  These are elizaOS changes, recorded here for tracking. Alpha's own policy is unchanged, and the
  two products keep separate UI and identity (foundation item 1).
- **P-77** — H-35 ([#674](https://github.com/eliza-research/alphaphone/issues/674)): **AGPL-licensed dependencies may ship**, because the whole
  project is open source; ua-parser-js (AGPL-3.0-or-later, through the RainbowKit wallet barrel) is
  one example. AGPL is not a licence blocker. Every AGPL component that ships must still be
  attributed in the licence notices, and the public eliza-research/alphaphone and elizaOS/eliza
  repositories meet the source-availability obligation. This **amends P-71**, which accepted the
  flagged copyleft obligations for the pilot only; AGPL dependencies are now accepted generally.
  It is an owner acceptance, not legal review.

- **P-78** — [#743](https://github.com/eliza-research/alphaphone/issues/743#issuecomment-6514832799): Voice is in-chat only; hardware invocation and wake listening are deferred. Chat microphone controls remain available. Hardware hold, assistant overlays, lock-screen voice and voice shortcuts do not start capture; their implementations stay dormant. Wake-listening Settings are hidden. Startup requests the canonical listener turn-off; an unconfirmed stop is reported without blocking chat. This supersedes earlier hardware/wake voice requirements for the Alpha/Mac lane.
