# 11 — Product fit, opportunity ranking, GTM, risks and blind spots

> **Superseded in part (2026-10-13, [decision P-42](../decisions.md)).** On-device and local speech and inference use only libelizainference (llama.cpp/ggml, GGUF models). ONNX Runtime, sherpa-onnx and ONNX-format models named in this section are historical research context, not a plan.

Every product capability statement below is tied to a repository file and uses the repository's own evidence vocabulary (§1). Every external number carries a source URL. **(est.)** marks an estimate or proposal, not a sourced fact; **(unverified)** marks a figure not confirmed against a primary source. Where a sibling file (01–10) covers a topic in depth, this file cross-references it rather than repeating it.

**Product baseline.** Alpha forks AOSP for its own image and does not need banking apps, Play Integrity or GMS on it; MDM support for AOSP devices remains a real risk. Inference stays on Qwen (`qwen-3.8-27b` on Cerebras). Buyer objections to Qwen's origin are recorded as facts, and mitigation is framed around Qwen itself.

---

## 0. Executive summary

1. **Alpha Phone today is a well-engineered, honestly documented pre-MVP.** It has a large verified surface on emulators and paired hosts: both APK variants, HOME role, calendar CRUD, reminders, files, photos, notes, owner-bound approvals with an encrypted action journal, an isolated browser with a sensitive-page guard, and offline on-device speech in a separate ARM64 harness. Nothing has passed on a physical Pixel. There is no live Cloud login, no live Gmail, no deployed latest enclave, no powered-off hosted loops and no user acceptance ([mvp-scope-and-gap-report.md](../mvp-scope-and-gap-report.md), [mvp-current-status.md](../mvp-current-status.md)).
2. **The strongest market asset is not in the Alpha app yet.** The pinned elizaOS upstream already contains a serious PII layer. It has checksum-validated detectors, corpus-consistent typed pseudonyms, a "secret-swap" before the model boundary, fail-closed audio redaction with re-transcription verification, and a host-owned *confidential inference admission* policy with mandatory audit records (`vendor/eliza/packages/core/src/security/{pii-detectors,pii-pseudonymizer,pii-pseudonym-map,secret-swap,confidential-inference}.ts`, `vendor/eliza/packages/core/src/audio-redaction*.ts`, `vendor/eliza/packages/agent/src/services/audio-redaction-service.ts`). The Alpha renderer does not call any of it (grep of `apps/app/src` finds no redaction use beyond a settings label). Wiring it in is the single highest-leverage product move.
3. **The confidentiality story does not hold up as currently described.** The agent runs in an AWS Nitro Enclave. Nitro Enclaves have no GPU, no persistent storage and no external networking, only a vsock channel ([AWS FAQ](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/)). Inference therefore leaves the enclave for Cerebras. Cerebras states it does not retain inference inputs or outputs ([Cerebras privacy policy](https://www.cerebras.ai/privacy-policy)), but that is a contractual promise, not attestation. The repo says so itself ([mvp-scope-and-gap-report.md §Private hosting](../mvp-scope-and-gap-report.md)). **Redaction before egress is what makes the architecture defensible.** A later GPU TEE (NVIDIA confidential computing on Hopper, Blackwell or Rubin; [NVIDIA](https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/)) closes the gap fully.
4. **Recommended beachhead: SEC-registered investment advisers, meaning independent RIAs, multi-family offices and private-markets/alternatives IR teams.** The product would be *"Alpha Secure Scribe"*: a managed Android Enterprise app on stock Pixels, with the hardened launcher phone as a premium tier. The reasons:
   - The pain is regulator-proven. The SEC fined 26 firms $392.75M in one off-channel sweep ([SEC 2024-98](https://www.sec.gov/newsroom/press-releases/2024-98)) and 12 more, including Blackstone, KKR, Apollo, Carlyle and TPG, $63.1M on 2025-01-13 ([SEC 2025-6](https://www.sec.gov/newsroom/press-releases/2025-6)). **Caveat:** under Chair Atkins the SEC has signalled lower priority for recordkeeping cases, so new-fine pressure is weakening even though the rules and existing undertakings stand ([Bond Buyer](https://www.bondbuyer.com/news/secs-atkins-criticizes-off-channel-comms-enforcement)). Sell retention hygiene and supervision of AI notes (FINRA 24-09), not fine avoidance.
   - No FedRAMP, BAA or NIAP certification is required. SOC 2 plus archive and CRM integration is enough.
   - Buyers are small and decide fast.
   - Incumbents are cloud meeting software. Jump serves 45,000+ advisors per its homepage ([jump.ai](https://jump.ai/)); its Feb 2026 $80M Series B release cited 27,000 ([WealthManagement](https://www.wealthmanagement.com/artificial-intelligence/jump_secures_series_b)), so the count is growing fast. Zocks serves 5,000+ firms ([zocks.io](https://www.zocks.io/)). Neither is a device with local ASR and attested processing.
5. **Follow-on #1: boutique and mid-size law firms plus M&A/PE deal teams.** Privilege and MNPI make "the raw words never leave the device unredacted" worth paying for, and the same redaction and clean-room features apply. **Follow-on #2: behavioral health and private-practice clinics.** On-device ASR is most valuable there, but the segment needs a BAA, a HIPAA program and 42 CFR Part 2 handling, and it faces Microsoft Dragon Copilot and ambient-scribe incumbents ([Microsoft](https://www.microsoft.com/en-us/health-solutions/clinical-workflow/dragon-copilot)). **Government (federal civilian, DoD, IC) is a non-dilutive R&D lane**, through SBIR/DIU-style work, not a beachhead. FedRAMP 20x is still phasing in ([fedramp.gov/20x](https://www.fedramp.gov/20x/)), and NIAP/CSfC for a custom AOSP image is a multi-year effort.
6. **Package software first and hardware second.** A dedicated "AI phone" alone joins a graveyard. Humane raised $230M and sold most of itself to HP for $116M; its devices were bricked on 2025-02-28 ([Wikipedia](https://en.wikipedia.org/wiki/Humane_Inc.)). Rabbit sold about 130k R1s, with about 5,000 concurrent users reported ([Wikipedia](https://en.wikipedia.org/wiki/Rabbit_r1)). Ship the redaction and enclave stack as an app on managed stock Android. Sell the hardened launcher phone to the subset that wants a dedicated device, and keep an SDK/OEM licensing option open. GrapheneOS's Motorola partnership, announced March 2026, shows OEM appetite for hardened Android ([Wikipedia](https://en.wikipedia.org/wiki/GrapheneOS)).
7. **Top risks (§6):**
   - claiming "confidential AI" before redaction and GPU TEE exist
   - on-device ASR not yet accepted on physical hardware
   - brand association with the ai16z token among regulated buyers, where Rabbit's NFT past is a cautionary analog. The token was declared "dead" on 2026-08-05 after the *Doe v. Walters* class action (S.D.N.Y. 1:26-cv-03238) was settled with the remaining treasury (see [08](08-investors-funding-ma.md) §1.2)
   - recording-consent and wiretap litigation, now an active class-action genre (Otter, No. 5:25-cv-06911; Cruz v. Fireflies, unverified; [Wikipedia](https://en.wikipedia.org/wiki/Otter.ai))
   - focus: 14 prototype modules plus a sibling senior-care product, against one wedge

---

## 1. Evidence vocabulary used in this file

The repo's rule is to distinguish an APK build, an emulator test, a full AOSP image boot, a real integration and device or user acceptance, and never to let one stand in for another ([AGENTS.md](../../AGENTS.md)). This file uses these levels:

| Code | Meaning | Example |
| --- | --- | --- |
| **S** | Source exists (code or patch), not necessarily built or run | upstream PII layer, staged Inbox patches |
| **B** | Built: `npm run verify` plus both APK distributions, lint and static scans pass | Build98 |
| **E** | Native instrumentation on a disposable Pixel-class **emulator** (API 35), both standalone and launcher | Calendar agent CRUD Build91 |
| **H** | Real **paired-host** or local integration (real Eliza, real Cerebras, real whisper.cpp) from phone or emulator | Build65 paired ASR live |
| **X** | Separate device harness, e.g. the offline ARM64 speech APK | Build90 speech evidence |
| **L** | **Live** third-party or production integration (Cloud login, Gmail OAuth, deployed signed enclave) | *none yet passed* |
| **I** | Full AOSP **image** boot on target hardware | *none* |
| **D** | **Physical device** (Pixel) acceptance | *none* |
| **U** | **User**/stakeholder acceptance (DoD five-minute demo, four devices) | *none* |

---

## 2. Feature inventory: verified, partial, planned

### 2.1 Platform and shell

| Capability | Status | Highest evidence | Source |
| --- | --- | --- | --- |
| Independent package `ai.alphacompute.alphaphone`, standalone and HOME-launcher flavors from one source | Verified | B + E (HOME role select/restore) | [README.md](../../README.md), [architecture.md ADR-03](../architecture.md) |
| Alpha visual system: 14 prototype modules, 60 named presets; MVP profile hides Phone, SMS, Contacts, Wallet | Verified (visual/mock); 10 retained MVP apps navigate | E (Build83 navigation/accessibility) | [prototype-screen-inventory.md](../prototype-screen-inventory.md), `apps/app/src/prototype/mvp-features.ts` |
| AOSP vendor add-on (non-privileged, hash/signer-checked) | Generated only | B | [README.md §AOSP](../../README.md); image boot **not** done |
| Physical Pixel image, signing, OTA/rollback | Planned | none | [decisions.md A-01, A-06](../decisions.md) |
| Accessibility (TalkBack, large text, focus trapping) | Partial | E (Build64 text scaling, Build83 covered-layer focus) | [mvp-current-status.md](../mvp-current-status.md) |
| MDM / Android Enterprise managed configuration | **Absent**: no `RestrictionsManager`/`DevicePolicyManager` use in `android/app/src/main` | none | repo grep |

### 2.2 Agent, identity and security

| Capability | Status | Highest evidence | Source |
| --- | --- | --- | --- |
| Connection chooser: Cloud, remote pairing, local dev, offline, mock | Partial | H (local), Cloud callback failing | [mvp-scope-and-gap-report.md §Startup](../mvp-scope-and-gap-report.md) |
| Owner-bound pairing, Keystore AES-GCM credentials, no backup | Verified locally | H | [architecture.md](../architecture.md), `PairedAgentCredential.java` |
| Real Cerebras (`qwen-3.8-27b`) replies in all 14 allowed roots | Verified on local host | H (Build69, 16 replies) | ledger §Cross-product gates |
| Explicit approvals plus encrypted native action journal (note, reminder, settings, browser) | Verified locally | H + E | ledger §App and flow coverage |
| Durable reconnect / exactly-once results | Partial | S + HTTP fixtures | [mvp-completion-plan.md](../mvp-completion-plan.md) |
| Hosted scheduled loops (morning/evening digest) running while the phone is **off** | Partial | S + PGlite E2E with synthetic model | ledger Build89/Build95 |
| Nitro Enclave agent with PCR-measured EIF, attested KMS key release | **Old** release running; latest candidate is an **unsigned EIF** | H (health `ready:true` on old release) | [enclave-candidate-validation.md](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md) |
| User-facing attestation evidence (verify PCRs on the phone, show receipt) | Planned (prototype "Sealed/Attested" copy is fixture only) | none | [prd.md AP-13](../prd.md), [prototype-screen-inventory.md §Settings](../prototype-screen-inventory.md) |
| Inference inside a TEE | **No.** Enclave calls external Cerebras | n/a | [mvp-scope-and-gap-report.md §Private hosting](../mvp-scope-and-gap-report.md) |
| PII detection, typed pseudonyms, secret-swap, audio redaction with verification, confidential-inference admission with audit | **Upstream source only; not wired into Alpha** | S (upstream) | `vendor/eliza/packages/core/src/security/*`, `vendor/eliza/packages/agent/src/services/audio-redaction-service.ts`; ADR-02 names redaction as upstream |
| Sensitive-screen flag blocks send/approve; notification previews redacted; browser sensitive-page rejection | Verified (narrow) | E (Build84/93/94) | [agent-integration.md](../agent-integration.md), ledger |

### 2.3 Voice and transcription

| Capability | Status | Highest evidence | Source |
| --- | --- | --- | --- |
| Native recording/playback | Verified | E | ledger §Voice |
| Paired-host ASR (whisper.cpp tiny.en) and TTS (Kokoro), owner-bound, explicit upload | Verified | H (Build65, synthetic audio ingress) | [standalone-paired-asr.md](../standalone-paired-asr.md) |
| **On-device** STT/TTS (sherpa-onnx CPU; `execution: "device"`) | Partial | X: offline harness transcribed a 6.6 s human clip in 1,171 ms; TTS 904 ms; cold load 6.8 s; 423 MB PSS. Packaged-app Build92 campaign **failed** one synthesized fixture ("lazy" heard as "lady") | ledger Build90–92, `AlphaVoiceCloudPlugin.java`, `runtime/local-voice.ts` |
| Physical microphone, far-field, diarization, multilingual, six-second round trip | Not started / unverified | none | [mvp-scope-and-gap-report.md §Voice](../mvp-scope-and-gap-report.md) |
| Word timings (needed for audio redaction) | **Unavailable** from the paired whisper route ("not fabricated") | H | [standalone-paired-asr.md](../standalone-paired-asr.md) |

### 2.4 Daily tools

| Tool | Status | Highest evidence | Notes |
| --- | --- | --- | --- |
| Notes (text/checklist/audio, SAF import/export) | Verified locally | E | No sync or E2E-encrypted sync |
| Calendar CRUD via Android CalendarProvider | Verified | E (Build86/91 both variants) | Phone-local; no Google/M365 account sync |
| Reminders (recurring, DST, reboot) | Verified | E | Inexact emulator timing ≠ physical deadline |
| Alarms via Clock handoff | Partial | E (creation and firing observed; snooze/dismiss not accepted) | Build94–97 |
| Browser (isolated child WebView, tabs, downloads, reading guard) | Partial | E, intermittent failures | Not a production WebView distribution |
| Password autofill (framework) | Verified with **synthetic** provider | E | Proton Pass warns on unknown browser package; passkeys open ([browser-autofill-integration.md](../browser-autofill-integration.md)) |
| Files, Photos, Camera | Verified locally | E | Physical optics open |
| Maps | Partial | E (Monaco region only) | |
| Inbox / Gmail | **Failing live** | E (local drafts only); OAuth token exchange 401 | |
| Workflows | Partial | E + S | Civil scheduling and deployed templates open |
| Cross-app notifications | Failing on emulator (System UI ANR) | — | |
| Phone, SMS, Contacts, Wallet | Deferred | — | [mvp-scope-and-gap-report.md](../mvp-scope-and-gap-report.md) |

### 2.5 What this inventory means commercially

- The product is currently a **personal agent phone**. None of the markets in §3 buys a personal agent phone. They buy **confidential capture, transcription, summarization and filing of sensitive conversations, with evidence**. About 70% of what makes that product (on-device ASR, redaction, audit evidence, archive export, CRM/EHR push, MDM) is either upstream-only or unbuilt. The prototype's daily-tool breadth (browser, maps, photos, camera) is nearly irrelevant to those buyers.
- The engineering culture is itself a commercial asset for regulated buyers: evidence ledgers, fail-closed defaults, "no fabricated success", owner-bound receipts. Few AI start-ups can show a compliance reviewer an artifact-hashed acceptance ledger. **Productize that discipline.**

---

## 3. Capability-to-market fit matrix

### 3.1 Current Alpha state per capability column

| Column | Alpha today | Gap to "credible for a regulated pilot" |
| --- | --- | --- |
| **ASR** on-device | X-level harness; packaged-app fixture failing; English tiny model; no diarization | 3–4 months: physical qualification, a better model (whisper small/base or Parakeet-class; see [10](10-always-on-tech-feasibility.md)), diarization |
| **RED** redaction | Upstream library, unwired, no evaluation set | 3–5 months: wire into transcript→model path, per-vertical policies, recall/precision eval, reviewer UI |
| **ATT** attestation evidence | Nitro PCRs; unsigned candidate; no phone-side verification; external inference | 2–3 months for phone-side PCR verification plus a signed "inference receipt"; 6–9 months for GPU-TEE inference |
| **MDM** Android Enterprise | None | 2–3 months for managed config, work-profile support, zero-touch/QR enrollment, EMM partner validation (Intune, Workspace ONE, Knox Manage) |
| **ARC** compliance archiving | None | 2–4 months for WORM export plus a Smarsh/Global Relay/Theta Lake connector; supervision flags |
| **BAA** HIPAA program | None; no SOC 2; Cerebras BAA status unknown | 6–9 months for policies, risk analysis, BAA chain (AWS signs; Cerebras must confirm), SOC 2 Type 1 |
| **FED** FedRAMP/IL | None | 12–24+ months even under 20x ([fedramp.gov/20x](https://www.fedramp.gov/20x/)); IL5 is a separate DoD path |
| **NIAP** MDF/CSfC | None; custom AOSP on Pixel unevaluated | 18–36 months (est.); requires a stable OEM partner |
| **OFF** offline | Shell, notes, calendar and local speech work offline; LLM cloud-only | 1–2 months for honest offline mode; local LLM deferred by decision |
| **INT** integrations | Android calendar provider; Gmail failing; no M365, Salesforce, Wealthbox, Redtail, Epic, iManage | 2–6 months per integration family |
| **CON** consent/bystander UX | Recording indicator exists in prototype; no consent capture or jurisdiction logic | 1–2 months |
| **BR** brand tolerance | elizaOS/ai16z association | Positioning work; a separate enterprise brand/entity may be needed |

### 3.2 Matrix

Cell legend: **requirement weight** (M = must-have for a paid pilot, S = should-have within 12 months, · = not material) followed by **gap score** 0–3 (0 = none, 1 = small/weeks, 2 = major/months, 3 = blocker/≥9 months or outside control). The last column is Σ(gap×weight) with M = 3, S = 1. Lower is better.

| Market | ASR | RED | ATT | MDM | ARC | BAA | FED | NIAP | OFF | INT | CON | BR | **Weighted gap** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wealth advisors / RIAs | S·2 | M·2 | S·2 | M·2 | M·3 | · | · | · | S·1 | M·2 (CRM, M365) | M·1 | S·2 | **37** |
| Clinics / behavioral health | M·2 | M·2 | S·2 | S·2 | S·2 | M·3 | · | · | S·1 | M·3 (EHR) | M·1 | S·2 | **42** |
| Hospital enterprise | M·2 | M·2 | S·2 | M·2 | M·2 | M·3 | · | · | S·1 | M·3 (Epic/Cerner) | M·1 | M·2 | **54** |
| Federal civilian | M·2 | M·2 | M·2 | M·2 | M·2 | · | M·3 | S·3 | M·1 | M·2 (M365 GCC) | M·1 | M·3 | **63** |
| DoD / tactical | M·2 | S·2 | M·2 | M·2 | S·2 | · | M·3 | M·3 | M·1 | S·2 | S·1 | M·3 | **55** |
| Intelligence community | M·2 | S·2 | M·2 | M·2 | S·2 | · | M·3 | M·3 | M·1 | S·2 | S·1 | M·3 | **55** |
| Law firms | M·2 | M·2 | S·2 | S·2 | S·2 (legal hold) | · | · | · | S·1 | M·2 (DMS, M365) | M·1 | S·2 | **30** |
| Education / IEP | M·2 | M·2 | · | M·2 | S·2 (FERPA records) | · | · | · | S·1 | S·2 (SIS/IEP systems) | M·1 | M·2 | **32** |
| Enterprise exec / boardroom | S·2 | M·2 | M·2 | M·2 | S·2 | · | · | · | S·1 | M·2 (M365/Google) | M·1 | M·2 | **38** |
| M&A / PE deal teams | S·2 | M·2 | M·2 | S·2 | M·3 | · | · | · | M·1 | S·2 | M·1 | S·2 | **35** |
| Crypto-native prosumers | S·2 | S·2 | M·2 | · | · | · | · | · | S·1 | S·2 | S·1 | · (asset) | **14** |
| Sovereign Gulf / EU | M·2 | M·2 | M·2 | M·2 | S·2 | · | · | S·3 | M·1 | S·2 | M·1 | M·2 | **43** (plus in-country hosting blocker) |
| Privacy consumers | S·2 | S·2 | S·2 | · | · | · | · | · | M·1 | S·2 | S·1 | S·2 | **14** |

Reading the matrix:

- **Lowest-gap markets are the non-regulated ones** (crypto prosumers, privacy consumers). They have poor unit economics and would reinforce the brand problem, so they are a channel for launch buzz and community testers, not a beachhead.
- **Among regulated markets, law firms have the lowest gap (30)**, then education (32), deal teams (35), RIAs (37) and executives (38). RIAs rank fourth on fit alone because they need compliance archiving (a 3). They rank first overall in §3.3 because pain, sales speed and proven willingness to buy outweigh the difference. The dominant gaps (redaction, MDM, archive, CRM/DMS) are all *buildable by the team in months*. None requires a government certification body.
- **Health adds a BAA and an EHR** that are partly outside the team's control, since the Cerebras BAA status is unknown.
- **Government and defense are dominated by 3s in columns the team cannot shorten** (FedRAMP, NIAP, brand).

### 3.3 Opportunity scoring (fit gap is only one input)

Scores are 1–5, where 5 is best. **Fit** is the inverse of the §3.2 gap. **Pain** means acute, regulator- or liability-driven pain. **WTP** is willingness to pay per seat. **Speed** is the inverse of sales-cycle length. **Comp** is competitive whitespace for a *device-level, attested, redacting* product. **Brand** means the elizaOS/crypto association is tolerated. **Size** is the reachable 3-year SAM ([07](07-tam-sam-som.md) has sizing).

| Market | Fit ×2 | Pain ×2 | WTP | Speed | Comp | Brand | Size | **Total /45** | Rank |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wealth advisors / RIAs / alternatives | 4 | 5 | 4 | 4 | 3 | 3 | 4 | **36** | 1 |
| Law firms (boutique/mid) | 4 | 4 | 4 | 3 | 4 | 3 | 3 | **33** | 2 |
| M&A / PE deal teams | 3 | 5 | 5 | 3 | 4 | 3 | 2 | **33** | 2 (merged with law in GTM) |
| Behavioral health / clinics | 3 | 4 | 3 | 3 | 2 | 3 | 4 | **29** | 4 |
| Enterprise exec / boardroom | 3 | 3 | 5 | 2 | 3 | 2 | 3 | **27** | 5 (tie) |
| Education / IEP | 4 | 3 | 2 | 2 | 4 | 2 | 3 | **27** | 5 (tie) |
| Sovereign Gulf / EU | 2 | 4 | 5 | 1 | 3 | 2 | 3 | **26** | 7 |
| Hospital enterprise | 2 | 4 | 3 | 1 | 1 | 2 | 5 | **24** | 8 |
| Crypto-native prosumers | 5 | 2 | 2 | 5 | 2 | 5 | 1 | **29** (poor quality: low pain, small) | channel only |
| Privacy consumers | 5 | 2 | 2 | 4 | 2 | 3 | 2 | **27** | channel only |
| Federal civilian | 1 | 4 | 3 | 1 | 3 | 1 | 4 | **22** | R&D lane |
| DoD / tactical | 1 | 4 | 4 | 1 | 2 | 1 | 4 | **22** | R&D lane |
| Intelligence community | 1 | 5 | 4 | 1 | 2 | 1 | 2 | **22** | R&D lane |

---

## 4. Recommendation: beachhead, follow-ons, packaging

### 4.1 Beachhead: SEC/FINRA-regulated advisers (RIAs, multi-family offices, alternatives IR)

**The job to be done.** Capture every client conversation, in person, by phone or on video, and turn it into CRM notes, tasks and a compliant archive record. The client's account numbers, SSNs, health disclosures and family details must never reach a third-party model in the clear, and the firm must be able to prove it to an examiner.

Why this segment first:

| Factor | Evidence |
| --- | --- |
| Regulator-quantified pain | SEC off-channel sweep: 26 firms, $392.75M ([SEC 2024-98](https://www.sec.gov/newsroom/press-releases/2024-98)); a further 12 firms including Blackstone ($12M), KKR ($11M), Schwab ($10M), Apollo, Carlyle and TPG ($8.5M each), totalling $63.1M ([SEC 2025-6](https://www.sec.gov/newsroom/press-releases/2025-6)). Private-markets firms are explicitly in scope. |
| AI-specific supervision expectations | FINRA Regulatory Notice 24-09 (2024-06-27): existing rules 2210, 3110 and 4511 apply to GenAI output ([FINRA](https://www.finra.org/rules-guidance/key-topics/ai)). An AI note is a record to supervise and retain. |
| Proven willingness to adopt AI note-takers | Jump: 45,000+ advisors, clients include LPL, Osaic, Northwestern Mutual ([jump.ai](https://jump.ai/)). Zocks: 5,000+ firms, 7 of the 9 Barron's top mega-RIAs ([zocks.io](https://www.zocks.io/)). |
| Whitespace | Incumbents compete on privacy *policy*: Zocks says it "never records your client conversations", and Jump offers transcript-only modes. None offers on-device ASR, pre-egress redaction with a verifiable manifest, or enclave attestation. Alpha's differentiation is **provable** minimization, not a new feature. |
| No certification wall | SOC 2 Type 2 is the gate. Total program cost is about $80k–$350k, with Type 2 audits observing 3–12 months ([Secureframe](https://secureframe.com/hub/soc-2/audit-cost)). No FedRAMP, BAA or NIAP. |
| Brand tolerance | Many advisers serve crypto-curious clients. The token association is a manageable diligence question, not an automatic disqualifier as it would be with DoD. |

Honest caveats:

- Incumbents already own CRM integrations, with 40+ two-way connectors each. Alpha must integrate rather than replace them: push into Wealthbox, Redtail, Salesforce FSC and **into Jump/Zocks** where possible.
- Recordkeeping *requires retention*. Alpha must **retain the original** in the firm's archive under WORM rules and **redact only the copy sent to models**. Redaction cannot become a deletion tool (§7, item 3).
- The in-person meeting is the real wedge. Zoom bots already cover video, but a phone on the table in a client's kitchen is where cloud bots cannot go and where consent UX matters most.

### 4.2 Follow-on #1: law firms plus M&A/PE deal teams ("privileged and MNPI conversations")

- The same core stack applies: on-device ASR, typed pseudonyms, clean-room mode, audit log. Integrations change: iManage/NetDocuments DMS, M365, legal-hold export.
- The pain is privilege waiver and MNPI leakage when conversations pass through a third-party AI. Deal teams pay executive-level prices.
- It shares buyers with the beachhead: PE firms are both SEC-registered advisers and deal teams.
- Timing: months 6–12, once SOC 2 Type 1 and archive export exist.

### 4.3 Follow-on #2: behavioral health and small private practices

- On-device ASR plus redaction is the strongest privacy argument anywhere in this analysis. Therapy notes and substance-use records under 42 CFR Part 2 (confidentiality of SUD patient records, [Cornell LII](https://www.law.cornell.edu/cfr/text/42/part-2); the compliance date of the 2024 HIPAA-alignment rule is unverified) carry stigma and extra legal protection.
- It requires a HIPAA program and BAA chain, EHR integration (SimplePractice, TherapyNotes and similar are more tractable than Epic), and a two-party consent flow.
- Enter via a partner EHR rather than direct hospital sales. Hospital enterprise is where Microsoft Dragon Copilot competes, with 2,500+ active users at Intermountain alone ([Microsoft](https://www.microsoft.com/en-us/health-solutions/clinical-workflow/dragon-copilot)).
- Timing: design-partner pilots in months 9–12, after the SOC 2 Type 2 window opens.

### 4.4 Government: an R&D and credibility lane, not a beachhead

- Pursue SBIR/STTR, DIU CSO or AFWERX topics for "attested on-device transcription with redaction for disconnected, intermittent and limited (DIL) environments" ([08](08-investors-funding-ma.md) covers the funding vehicles).
- Partner with an existing NIAP-listed platform, such as Samsung Knox devices, rather than evaluating a custom AOSP image.
- Brand and FedRAMP timelines (FedRAMP 20x Phase 3 was still formalizing requirements in FY26 Q3–Q4, and legacy Rev5 phases out in FY27; [fedramp.gov/20x](https://www.fedramp.gov/20x/)) make direct sales before 2028 unrealistic.

### 4.5 Alternative packaging evaluated

| Package | What it is | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- |
| **A. "Alpha Secure Scribe" app** on stock Pixel or any Android Enterprise device (work profile or fully managed) | The standalone flavor, stripped to capture → local ASR → redaction → enclave agent → CRM/archive | Stays inside the buyer's existing MDM and phones. No hardware inventory. Play Integrity is unaffected (stock OS), so banking and MFA apps keep working. Fastest to pilot. | Less control of the mic/HOME experience. Competes directly with app incumbents. | **Lead package** |
| **B. Hardened launcher device** (Pixel plus HOME flavor, managed, with Alpha's own AOSP image) | Today's launcher flavor on a company-provisioned Pixel, locked to Alpha + approved apps | Clean-room device for execs and deal teams. Premium price. Showcases the brand. | Pixel supply and bootloader dependency. Custom images fail Play Integrity (SafetyNet was fully replaced on 2025-05-20; non-certified ROMs fail attestation; [Wikipedia](https://en.wikipedia.org/wiki/Play_Integrity_API)), but Alpha's image does not need banking apps, Wallet or GMS, so this is not a blocker. The real cost is **enterprise management**: Intune's AOSP list contains one phone (HMD Terra M; [Microsoft Learn](https://learn.microsoft.com/en-us/mem/intune/fundamentals/android-os-project-supported-devices)), and zero-touch/managed Play assume GMS ([09](09-distribution-partners-economics.md)). Support burden. | **Premium tier**; Alpha's AOSP image where Alpha or the customer manages the device; stock-OS-plus-launcher for fleets already on Intune/Workspace ONE |
| **C. Desk/companion puck** (boardroom or clinic-room mic array plus local NPU, pairs with A) | Multi-party far-field capture that does not rely on a phone on the table | Solves far-field/diarization. Socially legible "recording" object with an indicator light. Pairs with the clean-room meeting mode. | New hardware program. The AI-hardware graveyard. | **Year 2 option**, via ODM reference design only after A has traction |
| **D. Sovereign on-prem appliance** (agent + GPU inference in customer DC, attestation root in customer HSM) | Enclave-equivalent stack on NVIDIA confidential-computing GPUs | Solves the Cerebras egress problem completely. Large contracts with Gulf, EU and defence primes. | Long sales cycles. Requires packaging the hosted stack for on-prem. | **Opportunistic**, driven by one anchor customer |
| **E. SDK/licensing** of redaction plus attested-agent stack to OEMs, carriers and MDM vendors | Upstream elizaOS modules plus Alpha's verification discipline, licensed with support | Leverages MIT upstream. OEM demand for hardened Android (GrapheneOS × Motorola, March 2026; [Wikipedia](https://en.wikipedia.org/wiki/GrapheneOS)). Carriers want enterprise AI differentiation. | The MIT license means code is not the moat; support, certification and evaluation data are. Long OEM cycles. | **Keep as partnership track.** Revenue in year 2+. |

---

## 5. Positioning, category, messaging, pricing

### 5.1 Category naming options

| Candidate category | Pros | Cons |
| --- | --- | --- |
| **"Confidential AI scribe"** | Buyers already understand "AI scribe" or "notetaker". "Confidential" maps to confidential computing and to client confidentiality. | "Scribe" connotes healthcare. Must not overclaim "confidential computing" until GPU TEE. |
| "Zero-exposure meeting capture" | Crisp promise | "Zero" is an absolute claim that redaction false negatives will disprove |
| "Verifiable AI notetaker" | Emphasizes evidence | Abstract |
| "Private AI phone" | Consumer-legible | Graveyard association. Wrong buyer. |
| **"Minimized-by-design capture"** (sub-message) | Compliance officers think in GDPR Art. 5 minimization terms | Jargon for end users |

**Recommendation:** category **"Confidential AI scribe for regulated conversations"**, with the proof line *"Words are transcribed on the device. Names and numbers are replaced before any model sees them. You get a receipt."* Avoid "never leaves the device" until the LLM is local or attested (the prototype's "Nothing leaves" copy is flagged in [prototype-screen-inventory.md](../prototype-screen-inventory.md) as design data, not fact).

### 5.2 Messaging by persona

| Persona | Message | Proof asset |
| --- | --- | --- |
| Advisor / lawyer / clinician (user) | "Put the phone on the table, talk to your client, and get a CRM-ready note and follow-ups before you reach the car." | Live demo, latency numbers from physical devices |
| CCO / general counsel (approver) | "Every AI note comes with a redaction manifest and an archive copy. Your examiner can see exactly what the model saw." | Redaction manifest, confidential-inference audit record, archive export |
| CISO (security reviewer) | "Measured enclave, hardware-bound keys, no vendor access to plaintext, fail-closed redaction, and an evidence ledger for every release." | PCR list, SOC 2 report, pen test, SBOM, the acceptance ledger discipline |
| CFO / managing partner | "Replaces 5–8 hours per advisor per week of admin (est.) and reduces off-channel exposure." | Pilot time-motion study |

### 5.3 Pricing and packaging proposal (all figures are proposals, est.)

| Tier | Contents | Price (est.) | Rationale |
| --- | --- | --- | --- |
| **Secure Scribe — Professional** | App on managed Android; on-device ASR; redaction (standard PII + finance pack); CRM push (1 CRM); archive export; 1,500 capture minutes/user/month | **$99/user/month**, annual | Within the typical AI-notetaker-for-advisors range (incumbent pricing is not public on [jump.ai](https://jump.ai/) or [zocks.io](https://www.zocks.io/); verify via [09](09-distribution-partners-economics.md)). Premium justified by attestation and redaction evidence. |
| **Secure Scribe — Compliance** | Adds supervision queue, lexicon flags, legal hold, custom redaction policies, SSO/SCIM, audit-log API, dedicated enclave | **$149/user/month**, min 10 seats | CCO buys this tier |
| **Alpha Clean-Room Device** | Company-provisioned Pixel (hardened launcher, MDM-enrolled), Compliance tier, device replacement, 24-month term | **$229/user/month** (≈ $99 hardware amortization + margin) or $1,499 device + Compliance | Execs and deal teams. Hardware as a service avoids inventory risk being carried as sales risk. |
| **Enterprise / Sovereign** | Customer-held keys, in-region enclave or on-prem GPU-TEE appliance, custom policies | Platform fee $150k–$750k/year + seats | Anchor deals only |
| **SDK / OEM** | Redaction and attested-agent modules, evaluation suite, support | NRE $250k+ plus per-active-device royalty $1–4/month | Partnership track |
| **Metering** | Inference beyond the included minutes, billed per 1,000 redacted tokens or per audio hour | Pass-through + 30% | Protects margin against Cerebras and enclave cost ([09](09-distribution-partners-economics.md)) |

Packaging principles:

- Never price per "AI action". Regulated buyers want predictable seat pricing.
- Include the **evidence pack** (SOC 2 report, DPIA template, redaction evaluation report, subprocessor list including Cerebras and AWS) in every tier. It is the product for the approver.
- Offer a **"bring your own inference"** option for enterprises with Azure OpenAI or Bedrock commitments. It de-risks the Cerebras dependency.

---

## 6. Pilot plan

### 6.1 First 10 design partners (profiles, not names)

| # | Profile | Why them | What they validate |
| --- | --- | --- | --- |
| 1 | Independent RIA, 5–15 advisors, fee-only, heavy in-person meetings, Wealthbox or Redtail | Fast decision, founder-CCO | Core loop, CRM push, consent UX |
| 2 | Mid-size RIA, 50–150 advisors, Salesforce FSC, outsourced compliance (e.g. a compliance consultancy) | Real supervision workflows | Archive export, supervision queue, SSO |
| 3 | Multi-family office serving UHNW families (sensitive health, trust and family data) | Highest confidentiality sensitivity | Redaction policies beyond PII (family relationships, trust names) |
| 4 | Private-markets/alternatives manager IR team (SEC-registered, previously worried about off-channel) | Directly exposed to the sweeps | Mobile capture in the field, MNPI flags |
| 5 | Broker-dealer-affiliated hybrid advisor | Tests the FINRA 3110/4511 path | Stricter supervision, lexicon review |
| 6 | Boutique M&A advisory firm (10–40 bankers) | Follow-on #1 and clean-room device | Hardened device tier, MNPI handling |
| 7 | Litigation boutique law firm, iManage/NetDocuments | Privilege | Legal hold vs redaction, DMS filing |
| 8 | Group behavioral-health practice (5–20 clinicians) on a mainstream practice EHR | Follow-on #2 signal | Consent script, BAA requirements list, clinical note quality |
| 9 | Crypto-native fund or treasury team | Brand-tolerant, fast feedback, high security bar | Attestation UX, key custody, travel mode |
| 10 | Enterprise executive office (CEO/GC office of a public company) | Board and exec clean-room meetings | Puck demand signal, M365 integration, bystander norms |

**Recruiting:** RIA custodian and TAMP communities, compliance consultancies (they carry trust with CCOs), state bar tech committees, and elizaOS community members who are practitioners, for #9 only.

### 6.2 90-day pilot structure

| Phase | Days | Activities | Exit criteria |
| --- | --- | --- | --- |
| 0. Readiness | −30 to 0 | Physical-device qualification (D-level) of the capture→ASR→redact→agent loop; SOC 2 Type 1 underway; DPA and subprocessor list; redaction eval report v1; consent script per state | No pilot starts on emulator-only evidence |
| 1. Shadow | 1–30 | 3–5 users per partner. Capture only, local transcript, redaction preview. Nothing leaves the device except manifests (local-only mode). | ≥ 80% of eligible meetings captured; WER measured on real rooms; zero consent complaints |
| 2. Assisted | 31–60 | Enable enclave summarization on redacted text; CRM push with human approval; archive export to firm system | ≥ 70% of AI notes accepted with ≤ 2 edits; CCO signs off on the manifest format |
| 3. Operational | 61–90 | Supervision queue, legal hold, policy customization; weekly evidence pack | Conversion decision; reference-ability; price validation |

### 6.3 Success metrics

| Metric | Target (proposal) | How measured |
| --- | --- | --- |
| Redaction recall on defined classes (SSN, account numbers, DOB, addresses, names of clients and family) | ≥ 99.5% at the **token** level on a per-partner labelled sample; **0** unredacted Tier-1 identifiers (SSN, account #) in model egress | Blind double-annotated sample of 50+ meetings; confidential-inference audit logs |
| Redaction precision (business value retained) | ≥ 90% (over-redaction ≤ 10% of flagged spans) | Same sample |
| Transcript WER in real rooms | ≤ 12% English conversational (est. target; model-dependent, see [10](10-always-on-tech-feasibility.md)) | Human reference on 30 clips |
| Note acceptance | ≥ 70% accepted with ≤ 2 edits | In-app telemetry (counts only) |
| Time saved | ≥ 3 hours/user/week (est.) | Pre/post time diary |
| Latency | Note ready ≤ 2 min after meeting end; DoD simple query ≤ 6 s | Device logs |
| Battery | ≤ 15% per hour of active capture on Pixel 10 (est. target) | Physical measurement |
| CCO approval | Signed "fit for supervision" memo from ≥ 5 of 10 partners | Artifact |
| Commercial | ≥ 6 of 10 convert; ≥ 3 referenceable | CRM |

### 6.4 Demo script: "what the model saw" (5 minutes, synthetic data only)

All names, numbers and accounts are fictional and generated for the demo. Never use prototype mock data presented as real, and never use real client data.

1. **(0:00) Airplane mode on.** Put the Pixel on the table and tap Capture. The recording indicator and consent banner are visible: "This conversation is being transcribed on this phone."
2. **(0:20) Role-play a two-minute client review.** The "client" mentions a synthetic SSN, a brokerage account number, a daughter's name and school, a recent cancer diagnosis, and plans to sell a business. The live transcript appears **offline**, showing that ASR runs on the device.
3. **(2:20) Stop.** Tap "Redaction view", a split screen:
   - Left: the original transcript, local only.
   - Right: what will leave the device, e.g. `[CLIENT_1] wants to move [ACCOUNT_1] ... her daughter [FAMILY_1] at [SCHOOL_1] ... recent [HEALTH_CONDITION] ... sale of [BUSINESS_1]`.
   - Typed pseudonyms keep the business meaning, so the summary still says "client wants to reposition an account ahead of a business sale".
4. **(3:00) Airplane mode off. Tap "Summarize & file".**
   - The phone shows the enclave's measured identity (PCR0, signer), checked against the published release list.
   - The note comes back **with pseudonyms**, and the phone **rehydrates locally**.
   - The presenter says the honest line aloud: "The model provider receives only the right-hand text."
5. **(3:45) Show the receipt:** the redaction manifest (classes, counts, policy version), the confidential-inference audit record (route, model, policy revision, digest), and the archive copy sent to the firm's WORM store with the original preserved.
6. **(4:30) Red-team moment.** Say a new synthetic account number with unusual formatting; it is caught. If the detector cannot place a span in the timed words, the system **fails closed** and blocks egress. Close on: "If we're not sure, nothing leaves."

---

## 7. Risk register

Likelihood (L) and impact (I) are scored 1–5; score = L×I. **Owner** is a proposed accountable role.

### 7.1 Technical

| # | Risk | L | I | Score | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | On-device ASR accuracy/latency not acceptable on physical Pixel (packaged-app fixture already failing "lazy→lady"; tiny.en model; cold load 6.8 s, 423 MB PSS) | 4 | 5 | **20** | Qualify larger/streaming models (see [10](10-always-on-tech-feasibility.md)); warm model holder; physical mic/room test matrix; publish WER honestly | Voice lead |
| T2 | Confidentiality claim contradicted by architecture (Nitro has no GPU or networking → external Cerebras) | 5 | 5 | **25** | Ship redaction-before-egress first; say "attested agent + zero-retention inference provider" ([Cerebras policy](https://www.cerebras.ai/privacy-policy)); roadmap GPU-TEE inference ([NVIDIA CC](https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/)); pursue a Cerebras dedicated/private deployment | CTO |
| T3 | Redaction false negatives (unlabelled secrets, accents, multilingual, ASR errors that split an account number) | 4 | 5 | **20** | Fail-closed on unlocatable spans (already in upstream design); tiered policies; evaluation set per vertical; human review option; insurance (L3) | Redaction lead |
| T4 | No word timings from current ASR → audio redaction impossible | 4 | 3 | 12 | Choose an engine with word timestamps; otherwise redact text only and never export audio | Voice |
| T5 | Battery and thermals in hour-long capture (Tensor G5 reviewed as throttling to 28% of max; [Wikipedia](https://en.wikipedia.org/wiki/Pixel_10)) | 4 | 3 | 12 | Measure; duty-cycle; NPU path; puck option | Android |
| T6 | Pixel supply, SKU change, bootloader/vendor blob changes; no Pixel 10 source lock in the pinned OS tree ([prd.md](../prd.md)) | 3 | 4 | 12 | Lead with package A on stock OS; second OEM track (Motorola is now GrapheneOS-friendly); qualify one SKU | Release |
| T7 | Enclave release signing/KMS admission custody unclear: signer ARN and Terraform owner not located ([enclave-candidate-validation.md](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md)) | 4 | 4 | 16 | Formalize release-signing ceremony, 2-person rule, documented custody; move ingress off temporary quick tunnels | Security |
| T8 | Browser/WebView stability (intermittent dispatch timeouts) and production WebView distribution undecided | 3 | 2 | 6 | Out of wedge scope; freeze browser | Mobile |
| T9 | Emulator-only evidence is mistaken for device readiness in sales | 3 | 4 | 12 | Keep the evidence vocabulary in sales material; no pilot before D-level evidence | PM |
| T10 | Upstream dependency drift (14 local patches, vendor pin, patches not yet merged upstream) | 3 | 3 | 9 | Upstream the reviewed patches; release-train cadence | Eng mgr |

### 7.2 Platform

| # | Risk | L | I | Score | Mitigation |
| --- | --- | --- | --- | --- | --- |
| P1 | De-Googled image loses managed Google Play, zero-touch and Intune AOSP support (only HMD Terra M is on Intune's AOSP phone list; [Microsoft Learn](https://learn.microsoft.com/en-us/mem/intune/fundamentals/android-os-project-supported-devices)). GMS itself is **not needed** on Alpha's image | 4 | 3 | 12 | Alpha-provided device management or an MDM partner allow-list for the custom image; stock OS + app + launcher for fleets already on Intune/Workspace ONE ([09](09-distribution-partners-economics.md)) |
| P2 | Play Integrity: custom images fail attestation ([Wikipedia](https://en.wikipedia.org/wiki/Play_Integrity_API)). Banking/Wallet apps are **out of scope** for Alpha's image; residual risk is third-party enterprise MFA or line-of-business apps that enforce integrity | 3 | 2 | 6 | Publish a compatibility list; offer partner apps hardware key attestation against Alpha's pinned verified-boot key |
| P3 | Google/Apple bundle free on-device and "private cloud" transcription: Google Private AI Compute (2025-11-11) powers Recorder summaries ([Google](https://blog.google/technology/ai/google-private-ai-compute/)); Apple PCC ([Apple](https://security.apple.com/blog/private-cloud-compute/)) | 5 | 4 | **20** | Differentiate on *enterprise evidence* (archive, supervision, redaction manifest, customer-held keys), which platforms will not build for vertical compliance |
| P4 | Android changes to mic, background and accessibility policy restrict always-on capture | 3 | 3 | 9 | Foreground-service capture with visible indicator; no accessibility scraping (already policy in [cross-app-notifications-plan.md](../cross-app-notifications-plan.md)) |
| P5 | EMM vendors (Intune, Workspace ONE) do not certify or allow the app | 2 | 4 | 8 | Early Android Enterprise validation; managed-config schema |

### 7.3 Legal and regulatory

| # | Risk | L | I | Score | Mitigation |
| --- | --- | --- | --- | --- | --- |
| L1 | Wiretap/consent violations: all-party-consent states include CA, CT, FL, IL, MD, MA, MT, NH, OR (in-person), PA, WA ([Wikipedia](https://en.wikipedia.org/wiki/Telephone_recording_laws)). AI-notetaker class actions are active (Otter N.D. Cal. 5:25-cv-06911 under ECPA/CIPA/BIPA, no resolution reported; Cruz v. Fireflies, Dec 2025, unverified; [Wikipedia](https://en.wikipedia.org/wiki/Otter.ai)) | 4 | 5 | **20** | Jurisdiction-aware consent script; spoken plus visual notice; consent receipt in the transcript; no auto-join; **no training on customer data** |
| L2 | BIPA voiceprints from diarization: $1,000/$5,000 per violation ([Wikipedia](https://en.wikipedia.org/wiki/Biometric_Information_Privacy_Act)); Facebook settled for $650M | 3 | 5 | 15 | Diarize without persistent voiceprints (session-local clustering); written consent where enrolling; retention schedule |
| L3 | Redaction false-negative liability: a customer relied on "redacted" and PII leaked to a subprocessor | 3 | 4 | 12 | Contract: redaction is a risk-reduction control with published recall, not a guarantee. Cyber/tech E&O insurance. Subprocessor DPA with zero retention. |
| L4 | Privilege waiver or MNPI disclosure through a third-party model | 3 | 5 | 15 | Pseudonymize, enclave, zero-retention subprocessor, customer-held keys option; opinion letter from outside counsel for law-firm GTM |
| L5 | Recordkeeping vs redaction conflict (SEC 17a-4, FINRA 4511, legal hold): destroying the original could be spoliation. FRCP 37(e) sanctions are harshest with intent to deprive ([Cornell LII](https://www.law.cornell.edu/rules/frcp/rule_37)) | 4 | 5 | **20** | **Dual-track architecture:** original to customer archive (WORM), redacted copy to models; legal-hold flag suspends deletion policies |
| L6 | EU AI Act: emotion inference in workplace banned since 2025-02-02 ([Art. 5](https://artificialintelligenceact.eu/article/5/)); GDPR DPIA required. Most provisions applied 2026-08-02, but Annex III high-risk obligations apply from **2027-12-02** and Annex I from **2028-08-02**; generative-content transparency from 2026-12-02 ([AI Act timeline](https://artificialintelligenceact.eu/implementation-timeline/)) | 2 | 4 | 8 | No sentiment or emotion features for employees in the EU; DPIA template |
| L7 | HIPAA/Part 2 obligations triggered accidentally when advisors discuss client health | 3 | 3 | 9 | Health-condition redaction class in the finance pack; clear BA/non-BA position |
| L8 | Export control of encryption/AI (EAR 5A002/5D002) for sovereign sales | 2 | 3 | 6 | Classification ruling before first non-US sale ([05](05-regulation-compliance.md)) |

### 7.4 Market

| # | Risk | L | I | Score | Mitigation |
| --- | --- | --- | --- | --- | --- |
| M1 | AI-hardware graveyard stigma: Humane ($230M raised, sold for $116M, bricked), Rabbit (≈5% concurrent use), Friend backlash ([Humane](https://en.wikipedia.org/wiki/Humane_Inc.), [Rabbit](https://en.wikipedia.org/wiki/Rabbit_r1), [Friend](https://en.wikipedia.org/wiki/Friend_(product))) | 4 | 4 | 16 | Lead with software on existing phones; hardware as an enterprise option; no consumer launch hype |
| M2 | Incumbents (Jump, Zocks, Microsoft) add "on-device" or "redaction" checkboxes | 4 | 4 | 16 | Win on *verifiability* and archive evidence; partner or integrate rather than fight |
| M3 | Long government sales cycles drain focus | 4 | 3 | 12 | Government limited to non-dilutive R&D; one owner |
| M4 | Commoditized recorders at scale (Plaud 2.5M+ users; [Plaud](https://www.plaud.ai/pages/about-us)) anchor price expectations low | 3 | 3 | 9 | Sell to the firm (CCO), not the individual |
| M5 | Buyer confusion between "phone" and "scribe" | 3 | 3 | 9 | One product name per buyer |

### 7.5 Brand

| # | Risk | L | I | Score | Mitigation |
| --- | --- | --- | --- | --- | --- |
| B1 | elizaOS/ai16z token association read as "crypto project" by CCOs, CISOs and government. Rabbit's pre-rebrand NFT history became a credibility scandal ([Wikipedia](https://en.wikipedia.org/wiki/Rabbit_r1)). The token was declared dead in Aug 2026 after a settled S.D.N.Y. class action, *Doe v. Walters* ([CoinDesk](https://www.coindesk.com/markets/2026/08/05/ai-agent-token-once-worth-usd2-4-billion-ends-with-founder-calling-it-dead), [Burwick](https://www.burwick.law/insights/burwick-law-files-class-action-over-ai16z-and-elizaos-tokens)) | 4 | 4 | **16** | Separate enterprise brand and legal entity; no token mechanics in the product; disclose the token history and settlement plainly; elizaOS positioned as "MIT-licensed open-source agent runtime". Note that the likely parent, Alpha Compute Corp (NASDAQ: ALP), carries its own diligence flags: a going-concern paragraph in its FY2026 20-F/A and a ≈$7M market cap after a 1:50 reverse split ([20-F/A](https://www.sec.gov/Archives/edgar/data/0001095435/000117184326005284/f20fa_072626.htm), [stockanalysis](https://stockanalysis.com/stocks/alp/statistics/); see [08](08-investors-funding-ma.md) §1.1), so it is not a diligence-neutral brand |
| B2 | Prototype mock data (balances, contacts, "Sealed/Attested/Nothing leaves" copy) appears in demos or screenshots as if real | 3 | 5 | 15 | Enforced mock banner (exists); demo-asset review; ban fixture screenshots in sales decks ([prd.md](../prd.md)) |
| B3 | "Alpha" trademark crowding (Sony Alpha, Alphabet, many "Alpha" marks) | 3 | 3 | 9 | Formal clearance search (not done here) before investing in the product name |
| B4 | Public infra identifiers (AWS account, KMS ARN, temporary tunnel host) in the product repo if it becomes public | 3 | 3 | 9 | Scrub docs before open-sourcing; move to private ops repo |

### 7.6 Execution

| # | Risk | L | I | Score | Mitigation |
| --- | --- | --- | --- | --- | --- |
| E1 | Focus: 14 modules plus browser, maps and photos against a scribe wedge, plus a sibling senior-care product | 5 | 4 | **20** | Freeze non-wedge modules after DoD; one roadmap ([mvp-completion-plan.md](../mvp-completion-plan.md) already urges this) |
| E2 | Current DoD dates (M1 2026-10-01, M2 10-29, M3 11-12) are at risk given open gates | 4 | 3 | 12 | Renegotiate with honest ledger; prioritize the physical-device demo |
| E3 | Certification capacity: SOC 2, HIPAA, pen tests; later FedRAMP/NIAP need dedicated staff | 4 | 4 | 16 | Hire a GRC lead in Q1; use compliance automation |
| E4 | Hiring voice/ML, Android Enterprise and enterprise sales | 4 | 3 | 12 | Founding AE with RIA background; contract Android Enterprise specialists |
| E5 | Agent-driven development throughput (heavy parallel agent work; usage limits halted work in the ledger) | 3 | 3 | 9 | Human review gates; reserve budget |

### 7.7 Financial

| # | Risk | L | I | Score | Mitigation |
| --- | --- | --- | --- | --- | --- |
| F1 | Inference and enclave COGS (12 GiB enclave slots, Cerebras per-token) exceed seat price at heavy use | 3 | 3 | 9 | Metering above included minutes; local summarization for short notes |
| F2 | Hardware inventory and returns | 3 | 3 | 9 | HaaS via leasing partner; no stock beyond pilots |
| F3 | Compliance program cost ($80k–$350k SOC 2 alone; [Secureframe](https://secureframe.com/hub/soc-2/audit-cost)) before revenue | 4 | 3 | 12 | Stage: Type 1 → Type 2; share controls across products |
| F4 | Funding perception tied to the (now dead) token and to a distressed public parent | 3 | 4 | 12 | Enterprise-revenue metrics; strategic investors from fintech and compliance ([08](08-investors-funding-ma.md)) |

**Highest scores:** T2 (25); then at 20: T1, T3, P3, L1, L5, E1; then at 16: T7, M1, M2, B1, E3.

---

## 8. Things you haven't thought of (30 considerations)

| # | Consideration | Why it matters | Suggested action |
| --- | --- | --- | --- |
| 1 | **Bystander consent UX** | Eleven states have all-party-consent rules, some with in-person nuances ([Wikipedia](https://en.wikipedia.org/wiki/Telephone_recording_laws)). The Friend pendant showed that social backlash is real ([Wikipedia](https://en.wikipedia.org/wiki/Friend_(product))). | Spoken consent prompt, visible indicator, "pause for this person" button, consent receipt stored with transcript |
| 2 | **Redaction as a compliance *evidence* product** | Examiners ask "show me". A signed manifest of what classes were removed, under which policy version, is itself sellable to CCOs. | Treat the manifest as a first-class exportable artifact |
| 3 | **Legal-hold vs redaction conflict** | Deleting originals under litigation hold risks FRCP 37(e) sanctions ([Cornell](https://www.law.cornell.edu/rules/frcp/rule_37)) and SEC recordkeeping violations | Dual-track storage; hold overrides retention |
| 4 | **Audit log sold to the CISO** | Upstream `confidential-inference.ts` already defines mandatory audit records (dispatch intent, response headers, denial) | Ship a SIEM export (Splunk/Sentinel) as a Compliance-tier feature |
| 5 | **Clean-room meeting mode** | Boards and deal teams want *no* capture at all, with proof. A device-level "all mics off, radios on, attestation of mode" is a differentiator for the launcher device. | Launcher-only mode with signed state receipts |
| 6 | **Duress / remote wipe** | Executives and journalists face coercion; MDM wipe exists, but a duress PIN does not on stock Android | Duress passphrase that wipes local transcript keys; relies on Keystore key deletion |
| 7 | **Travel mode for border crossings** | CBP searched 55,318 devices in FY2025, up from 46,958 in FY2024 ([CBP](https://www.cbp.gov/travel/cbp-search-authority/border-search-electronic-devices)) | "Travel mode" that removes local transcripts and keys, re-syncs from enclave after crossing; legal review per country |
| 8 | **Journalists and NGOs** | Source protection and interview transcription is a natural fit, with low budgets. Foundation-funded programs could subsidize. | Pro-bono/foundation tier; builds credibility beyond crypto |
| 9 | **Union and works-council objections** | In Germany, works councils have co-determination over technical devices that can monitor employee performance (BetrVG §87(1) no. 6; wording unverified against the official text). The EU AI Act bans workplace emotion inference ([Art. 5](https://artificialintelligenceact.eu/article/5/)). | Works-council pack: purpose limitation, no performance analytics, local storage |
| 10 | **Accessibility/ADA transcription as a compliant wedge** | EEOC lists automated captioning, voice recognition software and CART as reasonable accommodations ([EEOC](https://www.eeoc.gov/laws/guidance/hearing-disabilities-workplace-and-americans-disabilities-act)). An on-device live-caption tool for deaf and hard-of-hearing employees is a pre-justified purchase that security teams approve more easily. | "Alpha Captions" accommodation SKU; HR/accommodations budget |
| 11 | **Multilingual** | Current ASR is English-only tiny.en ([standalone-paired-asr.md](../standalone-paired-asr.md)). Gulf, EU and many US advisory clients code-switch. Redaction detectors must be locale-aware (IBAN is already there; national IDs are not). | Multilingual model qualification before sovereign GTM |
| 12 | **Trademark check** on "Alpha Phone" / "Alpha Compute" | "Alpha" is heavily registered across electronics (Sony α), software and finance. No clearance found in repo. | Commission a USPTO/EUIPO clearance search |
| 13 | **Patents** | Wake-word, always-on capture and PII-redaction patents exist (see [10](10-always-on-tech-feasibility.md)). Push-to-talk avoids most wake-word claims. Alpha's fail-closed audio redaction verification may itself be patentable. | FTO review; consider defensive filings or publication |
| 14 | **Open-source licensing of elizaOS** | Upstream is MIT (`vendor/eliza/LICENSE`, copyright Shaw Walters and elizaOS contributors). Competitors can reuse the redaction stack freely, so the moat is data, evaluations, certification and integrations. Proton Pass is GPLv3 ([browser-autofill-integration.md](../browser-autofill-integration.md)). The model license for `qwen-3.8-27b` must be confirmed (Cerebras lists it as an Alibaba model in production but does not state the licence; [Cerebras docs](https://inference-docs.cerebras.ai/models/qwen-3.8-27b)). | License inventory in the evidence pack; decide what stays proprietary (policy packs, eval sets) |
| 15 | **SOC 2 as table stakes** | Jump advertises SOC 2-certified infrastructure ([jump.ai](https://jump.ai/)). Without it, no RIA procurement will pass. Costs $80k–$350k ([Secureframe](https://secureframe.com/hub/soc-2/audit-cost)). | Start the Type 1 in Q4 2026 |
| 16 | **Cyber insurance** | Insurers increasingly ask about AI vendors and data flows. Alpha's own tech E&O needs to cover redaction failure. Customers' carriers may ask for evidence. | Buy tech E&O plus cyber; give customers an insurer-ready control summary |
| 17 | **Insider-threat use cases** | A device that captures meetings can be abused *by* insiders (secret recording of colleagues). Conversely, audit logs help insider-risk programs. | Admin policy: capture only in allowed contexts; tamper-evident logs |
| 18 | **Subprocessor chain disclosure** | Cerebras, AWS and Cloudflare (currently a temporary tunnel for ingress) all become listed subprocessors under GDPR/DPA | Publish a subprocessor list; remove quick-tunnel ingress from production |
| 19 | **Data residency** | Sovereign and EU buyers need in-region enclaves and in-region inference; Cerebras region availability is unknown | Region matrix; BYO-inference option |
| 20 | **Model provenance and Chinese-origin models** | Qwen is an Alibaba model family; some government and defense buyers restrict PRC-origin models even when self-hosted. The FY2026 NDAA already directs DoD/IC to remove DeepSeek AI ([Wikipedia](https://en.wikipedia.org/wiki/DeepSeek)) | Keep Qwen and answer the objection directly: self-hosted Qwen open weights inside the attested boundary for regulated and sovereign tiers (no third-party inference egress), redaction before any prompt leaves the device or enclave, and a provenance file (weights source and hash, licence, evaluations, red-team results, attested model hash). Accept that some defense/IC buyers will still decline |
| 21 | **Supply-chain origin of competitors** | Plaud lists Shenzhen and Beijing offices ([Plaud](https://www.plaud.ai/pages/about-us)). "US-built, no PRC data path" is a real selling point for regulated buyers. | Comparative data-path sheet (factual, not disparaging) |
| 22 | **Platform bundling timing** | Google Private AI Compute launched 2025-11-11 with Recorder and Magic Cue ([Google](https://blog.google/technology/ai/google-private-ai-compute/)). Apple PCC promises published images ([Apple](https://security.apple.com/blog/private-cloud-compute/)). Alpha's "verifiable" claim must be at least as transparent as Apple's. | Publish enclave images/measurements and a transparency log |
| 23 | **Transparency log for enclave releases** | The repo already records PCRs and hashes per candidate ([enclave-candidate-validation.md](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md)). Making this public is cheap and matches PCC's "verifiable transparency". | Public release-measurement page; phone-side verification |
| 24 | **Android Enterprise controls a CISO will ask for** | Android 15 lets admins block Circle to Search in work profiles and enforce default dialer/browser on COPE ([Android](https://developer.android.com/work/versions/android-15)). Buyers will expect Alpha to honour work-profile boundaries. | Managed-config schema: capture allowed apps, retention, egress policy |
| 25 | **Deceased and incapacitated client data, and elder financial abuse** | Advisers must document diminished capacity and suspected exploitation. Transcripts become evidence. | Legal-hold and flagging workflow; tie to senior-care sibling learnings without merging products |
| 26 | **Minors' data (education/IEP)** | IEP meetings involve FERPA records and often parental recording rights; COPPA for under-13s | Defer education; keep the note in the backlog |
| 27 | **Voice as a biometric in the EU and Texas** | GDPR Art. 9 special-category data if used for identification; Texas CUBI (statute text unverified) | No speaker identification by default |
| 28 | **Hallucinated summaries as records** | An AI-generated note that is wrong still becomes a required record under FINRA 4511 ([FINRA](https://www.finra.org/rules-guidance/key-topics/ai)) | Human approval before filing; keep transcript linkage |
| 29 | **Product sunset promise** | Humane's buyers lost device function when servers shut off ([Wikipedia](https://en.wikipedia.org/wiki/Humane_Inc.)) | Contractual data-export and offline-mode guarantees; escrow |
| 30 | **Self-reporting incentive** | The SEC reduced penalties for self-reporting firms ([SEC 2024-98](https://www.sec.gov/newsroom/press-releases/2024-98)) | Position Alpha as part of a remediation program after a deficiency letter: a strong trigger event for sales |

---

## 9. Twelve-month strategic roadmap (Oct 2026 – Sep 2027)

| Quarter | Product | Compliance and trust | GTM | Exit evidence |
| --- | --- | --- | --- | --- |
| **Q4 2026** (Oct–Dec) | Close DoD gates honestly: physical Pixel demo, deployed signed enclave, two hosted loops. **Freeze non-wedge modules.** Wire upstream PII/secret-swap into transcript→model path; choose an ASR engine with word timings; build "redaction view" and manifest. | Adopt a no-overclaim messaging policy; SOC 2 Type 1 kickoff; DPA and subprocessor list; trademark clearance; license inventory | Recruit 10 design partners; build the evidence pack; separate enterprise brand decision | D-level demo video; redaction eval v1 on synthetic plus consented data |
| **Q1 2027** | "Alpha Secure Scribe" alpha (standalone flavor under Android Enterprise): managed config, work profile, CRM push (Wealthbox/Redtail), archive export (WORM + one archiver connector), consent script per state; phone-side PCR verification | SOC 2 Type 1 report; pen test #1; Type 2 observation window begins; tech E&O/cyber insurance | Pilots phase 0–1 with 5 partners; pricing tests | Pilot metrics dashboard; CCO memo #1 |
| **Q2 2027** | Salesforce FSC + M365 integrations; supervision queue; legal hold; clean-room mode on launcher device; GPU-TEE inference prototype or Cerebras private deployment | HIPAA program design (for follow-on #2); DPIA template; works-council pack | Pilots phase 2–3 with all 10; first paid conversions; RIA conference presence; compliance-consultancy channel | ≥ 6 conversions; 3 references |
| **Q3 2027** | GA for RIA segment; law-firm pack (DMS, privilege policies); multilingual (ES first); puck ODM evaluation | SOC 2 Type 2 report; BAA-ready (if Cerebras/AWS chain resolved); public transparency log | Launch law and deal-team follow-on; behavioral-health design partners; SBIR/DIU proposal; OEM/SDK conversations | ARR target (est.) $1–2M; pipeline in follow-on #1 |

Gating rule: no GTM phase advances on emulator-level evidence alone. Each quarter's exit evidence must be at D, L or U level as defined in §1.

---

## 10. Implications for Alpha Phone

1. Turn the upstream redaction and confidential-inference modules into the product's core, and make them measurable.
2. Re-word every confidentiality claim to match the real data path until GPU-TEE inference or local LLM exists.
3. Ship as an Android Enterprise app first. The launcher device becomes the premium clean-room tier, and the custom AOSP image a sovereign-only option.
4. Pick RIAs, alternatives and IR as the beachhead. Law and deal teams follow, then behavioral health. Treat government as R&D.
5. Build the dual-track record (original archived, redacted copy to models) before the first finance pilot.
6. Protect focus: the prototype's breadth is design value, not the wedge.

---

## Open questions

1. Will the DoD's "private TEE inference" requirement be satisfied by redaction plus a zero-retention provider, or does it require GPU-TEE or on-prem inference? Who decides?
2. Can Cerebras sign a BAA, offer a dedicated or private deployment, and provide region pinning? The Cerebras Trust Center lists **SOC 2 Type 2**, GDPR and CCPA, with subprocessors HubSpot, Cloudflare, SendGrid, Mixpanel and AWS; ISO 27001 and HIPAA/BAA are not listed ([Trust Center](https://trust.cerebras.ai/)). Cerebras states zero data retention for inference and US-based datacenters ([support](https://support.cerebras.net/articles/1811589793-does-cerebras-retain-my-data)). BAA availability remains open.
3. Is the company willing to create a separate enterprise brand and entity, distinct from elizaOS/ai16z community branding, for regulated GTM?
4. Which on-device ASR model will be the shipping choice? Does it provide word timestamps and diarization within the battery budget on Pixel 10 (Tensor G5)?
5. Is Alpha Phone the same company and roadmap as the senior-care product, and how is engineering capacity divided?
6. Will leadership accept freezing non-wedge modules (maps, photos editing, browser automation, wallet) after the DoD milestone?
7. Who owns the enclave release-signing key and KMS policy? What is the target custody model for enterprise customers (customer-held keys)?
8. What is the product name after trademark clearance?
9. Is there appetite for hardware-as-a-service financing, or should hardware stay strictly optional?
10. Which archive vendors (Smarsh, Global Relay, Theta Lake, others) will partner, and on what integration terms ([09](09-distribution-partners-economics.md))?
11. Can the redaction evaluation set be built with consented real conversations from design partners, and under what data agreement?
12. Should the SDK/OEM track begin now (e.g., with a hardened-Android OEM) or wait for enterprise proof?
