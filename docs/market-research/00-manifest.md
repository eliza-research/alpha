# 00 — Scope and coverage

This document defines the scope of the Alpha Phone research: the product baseline every section assumes, the questions each section answers, and the topics outside the original request that the research covers. The consolidated findings are in [REPORT.md](REPORT.md).

Product capability statements come from the repository's evidence ledger (`docs/mvp-scope-and-gap-report.md`, `docs/mvp-current-status.md`, [historical enclave candidate](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md)). Where a capability is only planned, the research says so.

## Product baseline

| Attribute | Current state |
| --- | --- |
| Platform | Alpha forks AOSP for its own signed image. Banking apps, Play Integrity and GMS are not requirements. |
| Form factor | Android phone UI (Pixel 10 or similar target), in standalone-app and HOME-launcher flavors; an additive, non-privileged AOSP vendor add-on is generated. The full signed image has not been qualified on a physical device. |
| Agent runtime | elizaOS agent, owner-paired, running on the phone (Android-resident). Only model requests leave the device. Inference is Qwen (`qwen-3.8-27b`) on Cerebras. The earlier AWS Nitro Enclaves deployment is no longer the agent runtime. |
| Voice | Native capture and playback on the phone. ASR/TTS (whisper.cpp tiny.en, Kokoro) currently run on a paired host. On-device STT/TTS is an MVP requirement that is not yet met. |
| Daily tools | Notes, transcription, calendar CRUD, reminders and alarms, browser with a password-provider integration, files, camera and photos, maps handoff, workflows, digests, notifications and inbox. Gmail is recommended. |
| Deferred | Phone, SMS and contacts integration; wallet and payments; offline LLM; Telegram and Discord. |
| Security posture | Android Keystore AES-GCM credential storage, no backup, owner-scoped pairing, and explicit approvals and receipts for native actions. Model inference on Cerebras is covered by a contractual no-retention commitment, not attestation. Redaction is named as a shared upstream contract in ADR-02; the upstream secret/PII swap is enabled for the resident agent, and the full redaction pipeline is not yet built. |
| Design | Alpha Compute brand: white/black with electric blue #0000FF, Fraunces/Denton serif and Public Sans. The prototype has 14 app modules. |

## Sections and research questions

| # | Section | Key questions |
| --- | --- | --- |
| 01 | [AI transcription and recorder devices, and meeting-assistant software](01-transcription-competitors.md) | Every wearable and pocket recorder (Plaud, Limitless→Meta, Bee→Amazon, Omi, Friend, Sandbar, TicNote, HiDock, Viaim, Soundcore, Pixel Recorder…) and meeting software (Otter, Fireflies, Granola, Fathom, Read.ai, Krisp, Zoom/Teams/Gemini): funding, valuation, revenue, price, how built (models, on-device vs cloud, hardware), privacy posture and failures |
| 02 | [Agentic phones and AI assistant devices](02-agentic-phones-devices.md) | Rabbit, Humane→HP, OpenAI/io, T Phone AI, Nothing, Brain.ai, Doubao phone, Honor, Samsung/Pixel/Apple AI, Solana Saga/Seeker, Light Phone, Meta glasses: funding, sales, lessons, why they failed or succeeded |
| 03 | [Secure and sovereign phones, and confidential-compute AI](03-secure-phones-confidential-ai.md) | Secure phones (Bittium, Sirin, Katim, Purism, GrapheneOS, Murena, Boeing Black, Samsung Knox/Tactical, Hypori virtual mobile) and confidential AI (Apple PCC, Google Private AI Compute, NVIDIA CC, Opaque, Fortanix, Anjuna, Edgeless, Tinfoil, Confident Security, Phala, Privatemode): funding, customers, architectures |
| 04 | [Redaction and PII/DLP technology, plus a redaction design for Alpha](04-redaction.md) | Competitors (Private AI, Tonic, Presidio, Nightfall, Skyflow, Protecto, Strac, Harmonic, Prompt Security, Lakera, Credal, Veritone Redact…); taxonomy of sensitive data per vertical; techniques that preserve business value (typed pseudonyms, reversible vault tokenization, generalization, FPE, policy tiers, local rehydration); failure modes and evaluation |
| 05 | [Regulation, compliance and certification](05-regulation-compliance.md) | Recording-consent law, BIPA, HIPAA, FERPA/COPPA, GLBA, FINRA/SEC recordkeeping (off-channel fines), CJIS, ITAR/EAR, CMMC, FedRAMP, NIAP MDF, CSfC, DISA STIG, FIPS 140-3, EU AI Act/GDPR, UK; costs and timelines; what compliance unlocks |
| 06 | [Vertical deep-dives](06-vertical-markets.md) | Government and civilian, defense and intelligence, finance, healthcare, legal, education, enterprise exec/office, critical infrastructure, international sovereign: pains, buyers, budgets, procurement, incumbents, fit |
| 07 | [Market sizing](07-tam-sam-som.md) | TAM, SAM and SOM, top-down and bottom-up per segment, with assumptions shown |
| 08 | [Capital: investors, funding comps, M&A](08-investors-funding-ma.md) | Who funded the comparables, relevant VCs (defense, privacy, AI hardware, crypto/elizaOS-adjacent), strategic and corporate VCs, non-dilutive funding (SBIR, AFWERX, DIU, IQT, ARPA-H, NSF, EU), acquirers and valuation comps |
| 09 | [Distribution, partners and unit economics](09-distribution-partners-economics.md) | Carriers, MDM/EMM, VARs/GSA/SEWP/Carahsoft, SIs, OEM/ODMs, EHR/CRM and compliance-archive partners, silicon (Qualcomm/Tensor/MediaTek), Cerebras/AWS, GMS licensing, BOM and pricing models |
| 10 | [Always-on assistant: technical feasibility and competitive tech](10-always-on-tech-feasibility.md) | On-device ASR, diarization and redaction models (Whisper, Parakeet, Moonshine, Gemini Nano, Apple), NPU capability, battery for always-on capture, wake word, audio hardware, multi-party capture, enterprise deployment |
| 11 | [Product fit, opportunity ranking, GTM, risks and blind spots](11-fit-gtm-risks.md) | Segments scored against the current feature set, beachhead, pricing and packaging, pilots, positioning, a full risk register, and material topics outside the original request |
| 12 | [AOSP fork: always-on listening](12-aosp-always-on-listening.md) | Permissions, roles and framework rules for always-on capture in a custom image; concurrent capture, power, isolation and egress; the recording indicator; Pixel 10 platform constraints; implementation spec, effort and phased plan |
| 13 | [Redaction integration](13-redaction-integration.md) | Inventory of the upstream redaction components in `vendor/eliza`; Alpha's egress points; external options; egress gate API, vault, policy tiers and audit receipts; evaluation harness and work packages |
| 14 | [SOC 2 technical plan](14-soc2-technical-plan.md) | Trust Services Criteria scope for Alpha, control-by-control technical requirements, gap assessment against the repository and infrastructure, evidence, tooling, headcount and budget |
| 15 | [Open-gap technical plan](15-open-gap-technical-plan.md) | On-device transcription, pre-egress redaction, built-in consent and verifiable cloud processing behind one egress gate; interfaces, claims ladder, threat model, milestones, team and cost of confidential GPU hosting versus Cerebras |

## Topics outside the original request

Each topic is covered in the sections listed in parentheses.

- Recording-consent law (all-party-consent states and the EU) as a gating feature (05, 10)
- Biometric voiceprints under BIPA/CUBI when diarizing speakers (05, 10)
- Bystander privacy and a social-acceptability "recording" indicator (Humane/Friend backlash) (01, 02, 11)
- Recordkeeping obligations: finance must retain, not only redact. Retention can conflict with redaction (04, 05, 06)
- Legal holds and e-discovery for transcripts; privilege waiver when privileged speech reaches a third party's AI (05, 06)
- Export controls on encryption and AI (EAR 5A002, ITAR if defense-modified) (05, 09)
- Supply chain and origin requirements: TAA, NDAA §889, trusted-foundry style and "China-free" BOMs (03, 05, 09)
- Google GMS/MADA licensing versus de-Googled AOSP. Play Integrity breaks banking apps, which are out of scope for Alpha's image (09, 11)
- Pixel bootloader and verified-boot custom keys (GrapheneOS model) (03, 09)
- Wake-word patents and speech-model licensing (Whisper MIT, Parakeet CC-BY) (10, 11)
- Brand trust: elizaOS/ai16z crypto association as an asset for some investors and a liability with government buyers (08, 11)
- Insurance and liability for redaction false negatives (04, 11)
- Alternative form factors: a companion pendant or desk puck versus a full phone, and BYOD app versus dedicated device (02, 10, 11)
- Channel conflict with Apple and Google bundling free recorders and summaries (01, 02, 11)
- Hiring and certification capacity (FIPS, CC and FedRAMP take 12–24 months) (05, 11)
- Pricing: hardware-plus-subscription versus seat-based versus enclave-inference metering (09, 11)

## Conventions

Every number cites a source URL in its section. **(est.)** marks an estimate and **(unverified)** marks a figure not confirmed against a primary source. Funding rounds carry their dates. Sections 01–11 end with implications for Alpha Phone.
