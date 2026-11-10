# 14 — SOC 2 technical plan for Alpha Phone

> Runtime source update: the local patch series has been migrated into reviewed upstream commits. AlphaPhone now consumes the immutable revision in `upstream.lock.json`; see [architecture and source ownership](../architecture.md). Patch filenames and line numbers below describe historical evidence retained in Git history, not files to apply to the current checkout. Implement further shared runtime changes through upstream PRs and update the reviewed pin.

Companion to [05 — Regulation and compliance](05-regulation-compliance.md), which budgets "SOC 2 Type I, then Type II" as the first enterprise unlock.

> **Not audit or legal advice.** A licensed CPA firm decides scope, criteria and opinion. This plan turns the AICPA criteria into concrete engineering work for this repository and its infrastructure. It also records the gaps that are visible today.
>
> **Conventions.** **(est.)** marks an estimate (cost, effort, duration) that no primary source states. **[repo]** marks a fact observed in this repository or its docs as of 2026-10-02. TSC criterion text is paraphrased, not quoted. The authoritative text is the AICPA [2017 Trust Services Criteria (With Revised Points of Focus — 2022)](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022).

## 0. Executive summary

1. **SOC 2 does not certify the phone. It attests to a *service*.** For Alpha, that service is the agent service: software and OS updates for the device, the hosted agent or pairing path, inference routing and support. Plan it as a CPA attestation of that system. Do not plan it as a device certification. The device software is in scope as a *system component*. Its build, signing and update pipeline is in scope through change management (CC8).
2. **The architecture changed on Oct 1, 2026, so the scope must change too.** [Architecture](../architecture.md) ADR-05 and the [on-device agent plan](../on-device-agent-plan.md) move the primary agent onto the Android device. They demote Nitro Enclaves to "historical optional work", but enclaves a–d are still running [historical enclave readback](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md). Inference still goes to hosted Cerebras. The SOC 2 boundary therefore has to cover: (a) the device runtime and its update chain; (b) whichever cloud components stay customer-facing (enclave remote agent, Eliza Cloud pairing and login, voice services); (c) Cerebras as a carved-out subservice organization. Do not describe the Nitro/attested-KMS path in a SOC 2 system description unless it is actually serving customers in the window.
3. **Criteria to include.** Report 1 should cover **Security (CC1–CC9) + Confidentiality (C1) + Availability (A1)**. Add **Privacy (P1–P8)** to the first Type 2 if the recording or transcription beta ships to customers before the window starts. Add **Processing Integrity (PI1)** only when redaction is a contractual or marketed commitment with a measured accuracy target. Redaction claims are untestable until the pipeline exists; [05 §0](05-regulation-compliance.md) records "no redaction pipeline yet".
4. **Realistic calendar** (assuming the work starts Mon 2026-10-05): readiness and remediation take about 12 weeks. The **Type 1 point-in-time date** falls around **2027-01-15**, with the report about 4 weeks later. The **Type 2 observation window** runs **2027-01-18 → 2027-04-16** (3 months, the accepted minimum for a first report), and the Type 2 report lands around **June 2027**. The second Type 2 should use a 12-month window **(est.)**.
5. **Year-one budget** for a team this small: **$110k–$170k cash is the likely landing, within a full range of ~$94k–$288k (est., §5.6)**. The largest items are a fractional vCISO ($30–60k), pen tests for mobile, cloud and the AOSP image ($15–45k), auditor Type 1 + Type 2 ($20–60k), the GRC automation platform ($8–28k) and signing infrastructure ($3–30k). Add about **1.5–2 FTE of internal time** across 6 months.
6. **The largest gaps are operational, not cryptographic.** The repo has strong integrity *engineering*: hash-pinned sources, 36 explicit upstream patches with source-base manifests, same-run APK manifest verification between CI jobs, Keystore AES-GCM credential storage, `allowBackup=false`. What it lacks is the *control environment*:
   - no branch protection or rulesets;
   - one committer and no second reviewer;
   - unsigned commits;
   - Actions pinned by tag;
   - no Dependabot, CodeQL or SBOM;
   - 14-day evidence retention;
   - release APKs unsigned, with debug-signed launcher staging in CI;
   - no production app, platform, AVB or OTA keys;
   - an unsigned EIF with no locatable signer ARN or Terraform runner;
   - a `trycloudflare.com` quick tunnel as public ingress;
   - personal Gmail as the administrative identity;
   - a production database service named `postgres-auth-restore-drill-20260825`;
   - no written policies, risk register, vendor register, on-call or IR plan.

## 1. SOC 2 basics

### 1.1 What SOC 2 is

- SOC 2 is an attestation engagement performed by a licensed CPA firm under AICPA attestation standards (SSAE No. 18/21, AT-C 105/205). The engagement guidance is the AICPA *SOC 2® Reporting on an Examination of Controls at a Service Organization Relevant to Security, Availability, Processing Integrity, Confidentiality, or Privacy*, updated as of **October 15, 2022** for SSAE 20 and 21 ([AICPA guide](https://www.aicpa-cima.com/cpe-learning/publication/soc-2-reporting-on-an-examination-of-controls-at-a-service-organization-relevant-to-security-availability-processing-integrity-confidentiality-or-privacy); [Moss Adams summary](https://www.mossadams.com/articles/2022/11/aicpa-releases-updated-soc-2-guide)).
- Controls are evaluated against the **2017 Trust Services Criteria (TSP 100), with revised points of focus from 2022** ([AICPA TSC](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022); [Deloitte DART copy](https://dart.deloitte.com/USDART/home/auditing/aicpa/trust-services-principles-criteria-illustrations/aicpa-trust-services-principles-criteria/trust-services-criteria)). As of 2026, no newer TSC version exists, and the AICPA has issued no AI-specific criteria. Auditors fold AI risk into CC3 (risk), CC9 (vendors) and CC6/CC7 ([SureCloud](https://www.surecloud.com/resource-hub/soc-2-compliance-requirement-guide); [Workstreet](https://www.workstreet.com/blog/soc-2-type-2-for-ai-companies)).
- The system description must satisfy **DC 200 (2018 Description Criteria, 2022 implementation guidance)** ([DC 200 PDF](https://assets.ctfassets.net/rb9cdnjh59cm/1vCduR1U2OnhIvFFaDBjMv/836050054707e9afb65adeb30d2e95d8/92317096_dc_section_200_clean_version.pdf)). Its required content:
  - DC1: services provided;
  - DC2: principal service commitments and system requirements;
  - DC3: components (infrastructure, software, people, procedures, data);
  - DC4: significant incidents;
  - DC5: applicable criteria and controls;
  - DC6: CUECs;
  - DC7: subservice organizations and CSOCs;
  - DC8: criteria not relevant, with reasons;
  - DC9: significant changes during the period (Type 2).

  See [Ledger Audits on DC 200](https://www.ledgeraudits.com/blog/dc-200-guidelines). The AICPA publishes an [illustrative SOC 2 report and description](https://www.aicpa-cima.com/resources/download/illustrative-soc-2-r-report-with-description-and-assertion), which is the best template for Alpha's Section III.
- Report sections: (I) independent service auditor's report (the opinion); (II) management's assertion; (III) the system description; (IV) criteria, controls, tests and results (Type 2); optionally (V) unaudited "other information", such as management responses to exceptions.
- **SOC 3** is a short, public, general-use version of the same examination. It is useful as a website badge once the Type 2 exists.

### 1.2 Type 1 vs Type 2 and observation windows

| | Type 1 | Type 2 |
| --- | --- | --- |
| Opinion on | Fairness of the description, and **design** suitability *as of a date* | The same, plus **operating effectiveness** *throughout a period* |
| Window | A single date | 3–12 months; 3 months is acceptable for a first report, 6–12 is typical after that ([Scrut](https://www.scrut.io/hub/soc-2/soc-2-type-1-vs-soc-2-type-2); [Tevora](https://www.tevora.com/resource/how-long-does-it-take-to-complete-a-soc-2-audit/)) |
| Sampling | Walkthrough of one instance | Samples across the period. Daily, weekly and quarterly controls each need evidence for every occurrence or for samples |
| Buyer value | "Designed, not yet proven." Unblocks pilots and some mid-market deals | What enterprise procurement actually requires |
| Validity | Not formally defined. Buyers expect the period end to be ≤12 months old. **Bridge (gap) letters**, issued by management, cover up to about 3 months past period end ([Drata](https://drata.com/learn/soc-2/bridge-letter); [I.S. Partners](https://www.ispartnersllc.com/blog/soc-2-bridge-letter/)) | |

Many startups skip Type 1 ([Scrut](https://www.scrut.io/hub/soc-2/soc-2-type-1-vs-soc-2-type-2)). For Alpha, **Type 1 is still recommended**. The product is pre-production, the device and signing controls are novel to auditors, and a Nasdaq-listed parent benefits from an early, bounded, design-only opinion. Use it to settle the description and the carve-outs before the window starts. Keep the Type 1 date and the start of the Type 2 window adjacent so no controls lapse in between.

### 1.3 The five TSC categories, and what Alpha should include

There are 33 Common Criteria in CC1–CC9 (the COSO-derived CC1–CC5 plus CC6 logical/physical access, CC7 operations, CC8 change and CC9 risk mitigation). The additional categories are A1 (3), C1 (2), PI1 (5) and P1–P8 (18) ([Strac reference](https://www.strac.io/blog/soc-2-controls); [AuditPath on P1–P8](https://www.auditpath.io/blog/soc2-privacy-criteria)).

| Category | Include? | Rationale for Alpha |
| --- | --- | --- |
| **Security (CC1–CC9)** | **Mandatory** | Always required. |
| **Availability (A1)** | **Yes, from Report 1** | An "agent phone" that schedules, reminds and acts is an availability promise. The architecture doc concedes that a powered-off phone cannot execute local schedules, so the availability commitment must be scoped honestly. Covered: cloud remote agent, pairing/login, OTA service, inference failover. Excluded: the customer's own device power and network. A1 also forces backup, DR and capacity evidence that enterprise questionnaires ask for anyway. |
| **Confidentiality (C1)** | **Yes, from Report 1** | Customers will entrust email, calendar, notes, photos, call and voice content, and confidential business information. C1.1/C1.2 require that confidential information is identified, protected and disposed of per commitments. This is the natural home for the "prompts leave the device only to Cerebras, which retains nothing" commitment and for redaction-before-egress. |
| **Privacy (P1–P8)** | **Add in Type 2 #1 if the recording/transcription beta is GA before the window; otherwise Type 2 #2** | Privacy tests notice, consent, collection limitation, retention/disposal, data-subject access, disclosure, quality and monitoring. It needs *operating programs*: consent records, DSR workflows, breach notification ([AuditPath](https://www.auditpath.io/blog/soc2-privacy-criteria)). Alpha's recording, consent and biometric exposure ([05 §1–2](05-regulation-compliance.md)) makes Privacy commercially valuable. But testing it before the consent UX and retention engine exist guarantees exceptions. Implement P-aligned controls now (they are cheap if designed in) and put them in scope once they have operated. |
| **Processing Integrity (PI1)** | **Defer until redaction is a commitment** | PI asks whether processing is complete, valid, accurate, timely and authorized. Redaction is the one Alpha function where accuracy *is* the security property: a missed SSN is a confidentiality breach. When redaction ships, scope PI1 narrowly to the redaction and transcription pipeline, against a published spec: entity classes, measured recall on a held-out set, fail-closed behavior. Agent tool actions (calendar/notes CRUD with approvals) are also PI-like, and the existing approval/receipt protocol is good evidence. Do not put "LLM answers are accurate" in PI scope. |

**Redaction claims and SOC 2.** C1 covers protecting confidential data, so redaction-before-egress is a C1 control. P3/P4 cover collecting and using only what is needed, so redaction is also a minimization control. PI1 covers accuracy, so a redaction *recall* claim is a PI1 control. If marketing says "PII never reaches the model", the auditor can only opine on it when there is a control, a test and a measured exception rate. Until then, keep the claim out of the system description and out of marketing ([05 §4.5](05-regulation-compliance.md) has the retention-versus-redaction tension).

### 1.4 Timeline and cost benchmarks

| Item | Range | Source |
| --- | --- | --- |
| Automation platform: Vanta | $10k–$28k/yr for <50 employees; seed often $10–15k | [soc2auditors.org](https://soc2auditors.org/insights/vanta-soc-2/); [CostBench](https://costbench.com/software/compliance-management/vanta/) |
| Drata | Observed $9.5k–$67k, median ~$25k; Foundation ~$7.5–10k | [Vendr](https://www.vendr.com/marketplace/drata); [Sprinto on Drata](https://sprinto.com/blog/drata-pricing/) |
| Secureframe | Median ~$20k, range ~$7.7k–$32.6k | [Vendr](https://www.vendr.com/marketplace/secureframe); [soc2auditors.org](https://soc2auditors.org/insights/secureframe-pricing/) |
| Sprinto | ~$6k–$30k; single framework $6–10k | [soc2auditors.org](https://soc2auditors.org/insights/sprinto-pricing/); [ComplyJet](https://www.complyjet.com/blog/sprinto-pricing) |
| Auditor: Type 1 | ~$5k–$25k (boutique) | [Drata cost](https://drata.com/learn/soc-2/cost); [soc2auditors.org startup list](https://soc2auditors.org/soc-2-auditors-startups/) |
| Auditor: Type 2 | ~$12k–$30k boutique (Johanson, Prescient); Advantage Partners $15k–$50k; mid-tier and Big 4 much higher | [Patotski](https://patotski.com/blog/soc-2-cost-for-startup-saas/); [Secureleap auditors](https://www.secureleap.tech/blog/best-soc-2-auditors-for-your-company) |
| Pen test | SOC 2 SaaS $8k–$25k; mobile $5k–$30k; cloud $10k–$40k+ | [soc2auditors.org pentest](https://soc2auditors.org/soc-2-penetration-testing-firms/); [Blaze](https://www.blazeinfosec.com/post/how-much-does-penetration-testing-cost/) |
| All-in first year, small SaaS | $25k–$75k typical | [Vanta guide](https://soc2auditors.org/insights/vanta-soc-2/); [Workstreet](https://www.workstreet.com/blog/soc-2-audit-cost) |

Alpha should budget above the SaaS median **(est.)**. It has a custom OS image, device signing keys, an enclave/KMS path and a public-company parent whose ITGC auditors may want to rely on the report.

### 1.5 Auditor choices

- **Boutique, startup-friendly firms that integrate with the automation platforms:** Johanson Group, Prescient Assurance, Advantage Partners, Insight Assurance, Sensiba, Assure Professional, A-LIGN (larger). See the [83-firm list](https://soc2auditors.org/soc-2-auditors-startups/).
- **Mid-tier, for when the parent's external auditor or regulated buyers need a recognizable name:** Schellman, Moss Adams/Baker Tilly, BDO, Linford & Co, Coalfire (also a FedRAMP 3PAO).
- **Selection criteria for Alpha:**
  1. Experience with mobile, IoT or hardware products and with signing and PKI controls. Ask for a redacted example description covering firmware or OTA.
  2. Willingness to test controls that are evidenced by build artifacts (provenance, signatures) rather than screenshots.
  3. AWS Nitro Enclaves and KMS familiarity.
  4. Ability to do **SOC 2+ HIPAA** later.
  5. Independence: do not hire the firm that sells your readiness consulting to also issue the opinion.
  6. Peer review status. Check the firm on the AICPA peer review public file.

## 2. Scope definition for Alpha

### 2.1 Draft system description (DC1–DC3)

**Services (DC1).** Alpha Phone is a managed Android agent phone. It provides:
- (a) the Alpha launcher and app (standalone and HOME flavors) and, for managed SKUs, a custom AOSP image with signed OTA updates;
- (b) an on-device elizaOS agent runtime that orchestrates tasks, stores conversation state, applies tool-approval policy and executes device actions (calendar, notes, reminders, files, browser reading);
- (c) hosted LLM inference, routed to Cerebras (model: Qwen `qwen-3.8-27b` via the Cerebras API). Only explicitly configured, user-visible context is sent;
- (d) optional remote/cloud agent hosting: the enclave-backed remote agent and Eliza Cloud account, pairing and agent hosting, where offered;
- (e) planned on-device ASR and a redaction pipeline;
- (f) customer support and fleet management.

**Principal service commitments (DC2).** These are the drafts to put in the MSA, DPA, security exhibit and privacy notice. Make them testable.

| ID | Commitment | Criteria | Notes |
| --- | --- | --- | --- |
| SC-1 | Customer content is encrypted in transit (TLS 1.2+) and at rest (Android FBE + Keystore AES-GCM on device; KMS-managed keys in cloud) | CC6.1, CC6.7, C1.1 | |
| SC-2 | Model prompts are sent only to approved inference subprocessors, which contractually retain no prompt or output content | C1.1, CC9.2 | Backed by [Cerebras: no retention of prompts, requests/responses, logs, inputs or outputs](https://support.cerebras.net/articles/1811589793-does-cerebras-retain-my-data) |
| SC-3 | Tool actions with side effects require explicit user approval and produce a receipt | CC6.1, PI1.3 | Existing approval/receipt protocol |
| SC-4 | Security updates are delivered within N days of an Android Security Bulletin for supported devices | CC7.1, CC8.1 | |
| SC-5 | Customer data is deleted within N days of account deletion or contract end | C1.2, P4.3 | |
| SC-6 | Availability target for cloud components (e.g. 99.5% monthly, est.) | A1.1–A1.2 | Explicitly *not* for powered-off devices |
| SC-7 | Security incidents affecting customer data are notified within 72 hours | CC7.4, P6.5 | |
| SC-8 | Recordings are captured only with visible indicator and configured consent, and retained per tenant policy | P2, P4 | When Privacy is in scope |

**Components (DC3).**

| Layer | Component | In SOC 2 boundary? |
| --- | --- | --- |
| Infrastructure | AWS account `771726864498`, us-east-2: EC2 Nitro hosts, enclaves a–d, KMS data key, IAM role `shaw-enclave-host`, EBS volume [repo] | **Yes**, if remote agent is a customer-facing service in the window |
| Infrastructure | Cloudflare (Workers `eliza-cloud-api-prod`, DNS, Tunnel), Railway (`eliza-cloud` Postgres, agent-server, voice services `whisper-stt`, `kokoro-tts`) [repo: cloud-production-validation] | **Yes, if Alpha's entity operates Eliza Cloud**. Otherwise Eliza Cloud is itself a subservice organization. **Scoping decision #1**: see §2.3 |
| Infrastructure | GitHub (`AlphaCompute/alphaphone`, private), GitHub Actions hosted runners | Yes, as tooling: carved-out vendor plus in-scope configuration |
| Infrastructure | AOSP build host (Linux x86_64, not yet allocated [repo: android-and-aosp]), signing HSM or KMS, OTA distribution (to be selected) | Yes, once production devices exist |
| Software | Alpha app/launcher (`ai.elizaresearch.alphaphone`), `vendor/eliza` pinned submodule + `patches/eliza/*.patch` (historical; the series was retired in `34b3c82a` and upstream changes now arrive through a reviewed pin move in `upstream.lock.json`), AOSP product overlay `vendor/alphaphone`, enclave EIF, local speech runtime | Yes |
| Endpoint | Customer devices | Device *software controls* are in scope. The physical device and user behavior are CUECs |
| Endpoint | Alpha-owned test, demo and fleet devices; employee laptops | Yes (asset inventory, MDM) |
| People | Founder/CEO (system owner), engineers, contractors, any agentic coding tools with repo write access | Yes. AI coding agents with commit rights must be treated as privileged identities |
| Procedures | Change, release, signing, enclave admission, incident, access review, vendor review | Yes |
| Data | See §2.5 | Yes |

### 2.2 Boundary diagram and data flows

```
                 ┌──────────────────────── SOC 2 SYSTEM BOUNDARY ───────────────────────────┐
 Customer user   │                                                                          │
 (CUECs)         │  Alpha device (customer-held)                                            │
   │ voice/touch │  ┌──────────────────────────────────────────────┐                        │
   └────────────►│  │ AOSP image (AVB release keys, locked BL)     │◄── signed OTA ──┐      │
                 │  │  └ Alpha launcher/app (APK v2/v3 signed)     │                 │      │
                 │  │     └ native IPC ─ on-device elizaOS agent   │                 │      │
                 │  │         ├ local state (FBE + Keystore AES)   │                 │      │
                 │  │         ├ on-device ASR (planned)            │                 │      │
                 │  │         └ redaction (planned) ──┐            │                 │      │
                 │  └─────────────────────────────────┼────────────┘                 │      │
                 │                    TLS 1.2+ prompts │ (redacted, minimal)          │      │
                 │                                     ▼                              │      │
                 │   Optional: pairing/login ──► Eliza Cloud API (CF Worker) ─► Postgres   │
                 │   Optional: remote agent  ──► Named CF Tunnel ─► EC2 host ─► Nitro enclave
                 │                                                   │ attestation  │      │
                 │                                                   └─► AWS KMS (PCR0/PCR8 policy)
                 │   Build/Release: GitHub ─► Actions (provenance) ─► signing HSM ─► OTA/APK store
                 └─────────────────────────────────────┬────────────────────────────────────┘
                                                       ▼   (carved out, CSOCs)
                        Cerebras Inference ─ AWS ─ Cloudflare ─ GitHub ─ Railway ─ Google (OAuth)
```

Data flows to document, each with its own diagram in the description:

| Flow | Path | Notes |
| --- | --- | --- |
| F1 Voice | mic → on-device ASR → transcript → (redaction) → agent | Audio is never forwarded to Cerebras. `local-asr.mjs` already asserts this for the host path [repo: agent-integration]. |
| F2 Inference | agent → TLS → Cerebras → response | Model ID recorded per request. No embeddings, because Cerebras supplies none [repo]. |
| F3 Tool actions | agent proposal → user approval → native bridge → Android provider (Calendar, etc.) → receipt | |
| F4 Account | phone → `/api/auth/cli-session` → browser approval → 90-day org API key → stored in Keystore [repo] | |
| F5 Remote agent | phone → ingress → enclave over vsock → KMS decrypt of state data key, conditioned on attestation | |
| F6 Release | commit → CI build → provenance → signing → APK, OTA payload and EIF → distribution → device verification (AVB/APK signature) and enclave PCR admission | |
| F7 Support and telemetry | Crash and diagnostic logs must be redacted. Define this flow now; it is the classic place PII leaks. | |

### 2.3 Subservice organizations: carve-out vs inclusive

Under the **carve-out** method, the description names the subservice organization and its services, lists the **complementary subservice organization controls (CSOCs)** Alpha assumes it performs, and excludes its controls from testing. Alpha then has to *monitor* it, usually by reviewing its SOC 2 each year and mapping its CUECs. Under the **inclusive** method, the subservice organization's controls are described and tested inside Alpha's report. That needs the subservice organization's participation and assertion, and large providers essentially never agree to it ([I.S. Partners](https://www.ispartnersllc.com/blog/subservice-organization-ssae18-carve-out-inclusive-method/); [Linford](https://linfordco.com/blog/inclusive-audit-method-soc-1-soc-2-reports/); [OneUptime](https://oneuptime.com/blog/post/2026-08-04-soc-2-carve-out-vs-inclusive-subservice-organizations/view)).

**Recommendation: carve out all of them.** The table lists each one's assurance, the CSOCs Alpha relies on, and what Alpha monitors (CC9.2).

| Subservice org | Assurance available | CSOCs Alpha relies on | Alpha monitoring control (CC9.2) |
| --- | --- | --- | --- |
| **AWS** (EC2 Nitro, KMS, IAM, CloudTrail, S3) | SOC 1/2/3 via **AWS Artifact** ([AWS Artifact](https://docs.aws.amazon.com/artifact/latest/ug/what-is-aws-artifact.html)). KMS is in SOC, PCI, FedRAMP and HIPAA programs ([KMS compliance](https://docs.aws.amazon.com/kms/latest/developerguide/kms-compliance.html)) | Physical security; hypervisor and Nitro isolation; KMS HSM key protection; attestation document signing; availability of regions | Annual Artifact download; map AWS CUECs (IAM config, encryption, logging, backups) to Alpha controls ([AWS SOC 2 guide](https://d1.awsstatic.com/whitepapers/compliance/AICPA_SOC2_Compliance_Guide_on_AWS.pdf); [Secureframe on AWS report](https://secureframe.com/blog/aws-soc-2-report)) |
| **Cerebras Systems** (inference) | **SOC 2 Type 2**, GDPR, CCPA; SOC 2 report, pentest and DPA on request at [trust.cerebras.ai](https://trust.cerebras.ai/). Its own subprocessors: AWS, Cloudflare, HubSpot, SendGrid, Mixpanel | Prompts and outputs not retained or logged; access control on inference infrastructure; encryption in transit; incident notification | NDA → obtain report; confirm the report period covers the **Inference API** (not only Cerebras hardware or training cloud); signed DPA with zero-retention clause; confirm **HIPAA BAA** availability in writing before any PHI (third-party sources claim a HIPAA posture and enterprise BAA, e.g. [Infrabase](https://infrabase.ai/inference-apis/cerebras), unverified); re-review on any model or version change |
| **Cloudflare** (Workers, DNS, Tunnel) | SOC 2 Type II (Security, Confidentiality, Availability), all plans in scope, downloadable from the dashboard ([Cloudflare SOC 2](https://www.cloudflare.com/trust-hub/compliance-resources/soc-2/)) | Edge TLS termination; Worker isolation; Tunnel connector auth | Annual review. **Quick tunnels have no SLA and are for testing only** ([Cloudflare docs mirror](https://cloudflare-docs.justalittlebyte.ovh/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)). They cannot sit inside a commitment |
| **GitHub** | SOC 1 and SOC 2 Type 2 for Enterprise Cloud; org owners download them under Settings → Compliance ([GitHub blog](https://github.blog/news-insights/product-news/github-has-soc-1-and-soc-2-type-2-reports/)) | Repo storage integrity, Actions runner isolation, Sigstore attestation service | Annual review; org audit-log export |
| **Railway** (if Eliza Cloud is in scope) | SOC 2 Type II, SOC 3, HIPAA attestation; BAA on request ([trust.railway.com](https://trust.railway.com/); [changelog](https://railway.com/changelog/2025-08-01-soc-2-type-ii)) | Database host security, backups at platform level | Annual review; confirm Postgres backup/PITR features used |
| **Google** (Workspace/IdP, OAuth for Gmail connector) | SOC 2/3, ISO 27001 | IdP authentication | Annual review |
| **Eliza Cloud** (if operated by a different legal entity than Alpha) | None known. **Scoping decision #1** | Account auth, org key issuance, agent hosting | If it is a separate entity, get its SOC 2 or exclude Cloud features from the committed service. If it is the same entity and team, put it **in** scope. Do not leave it ambiguous |

### 2.4 Complementary user entity controls (CUECs)

These go in Section III and in the customer security exhibit. The customer is responsible for:

1. Provisioning and deprovisioning its users' Alpha accounts and devices, and promptly reporting lost or stolen devices.
2. Setting a device screen lock and biometric. Not unlocking the bootloader or sideloading over managed policy.
3. Obtaining legally required consent from all parties before recording conversations, as the employer or recording party. Configuring retention to its legal-hold and recordkeeping obligations (see [05 §1, §4](05-regulation-compliance.md)).
4. Approving or denying agent tool actions, and reviewing receipts.
5. Protecting third-party account credentials it connects (Google OAuth grants), and revoking them on offboarding.
6. Not entering PHI or regulated data unless a BAA or other addendum is signed with Alpha.
7. Keeping devices connected so OTA security updates install within the published window.
8. Configuring its own MDM or EMM if it manages devices with Android Enterprise.

### 2.5 Data classification

| Class | Examples in Alpha | Handling baseline |
| --- | --- | --- |
| **Restricted — secrets** | App, platform, AVB and OTA signing keys; EIF signing key (PCR8); KMS key policies; Cerebras API key; Cloud org API keys (90-day); OAuth refresh tokens; Railway and Cloudflare credentials | HSM/KMS only. Never in repo, CI logs or laptops. Two-person use for signing keys |
| **Restricted — customer content** | Audio, transcripts, messages, email bodies, notes, photos, documents, browser page content, cross-app notification text, location, contacts | On-device FBE + Keystore. Minimum necessary egress, redacted where possible. Cerebras ZDR. Retention per tenant. Never in telemetry |
| **Restricted — special category** | Voiceprints/diarization embeddings (biometric under BIPA etc.), PHI, financial data | Off by default. Explicit consent. Separate keys. Privacy-in-scope controls |
| **Confidential — customer metadata** | Account email, org ID, device IDs, credit balance, usage metrics | Encrypted DB, RBAC, access logged |
| **Internal** | Source code, patches, CI logs, PCR measurements (PCRs can be public; publishing them is recommended) | Repo access control |
| **Public** | Marketing, privacy notice, transparency log of release digests and PCRs | — |

## 3. Control-by-control technical requirements

Each table gives the criterion (paraphrased), the **Alpha implementation** for this stack, **evidence**, and **status** as of 2026-10-02.

Status key:
- ❌ absent
- ◐ partial
- ✅ present

### CC1 — Control environment

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| CC1.1 | Integrity and ethical values | Code of conduct + acceptable use policy, acknowledged at hire and annually. Sanctions policy. Inherit the parent company's Nasdaq-required code of ethics where possible | Signed acknowledgments | ❌ for Alpha; the parent likely has one (verify) |
| CC1.2 | Board/oversight independence | Parent board's audit committee (or a delegated security committee) receives a quarterly security and compliance report | Minutes, decks | ❌ |
| CC1.3 | Structure, reporting lines, authority | Org chart. Named **system owner**, **security officer** (fractional vCISO acceptable), **privacy officer**, **release manager**, **signing-key custodians (≥2)** | Org chart, RACI | ❌ |
| CC1.4 | Competence | Job descriptions with security responsibilities; training records; contractor agreements | HRIS records | ❌ |
| CC1.5 | Accountability | Performance reviews include security objectives; policy violation process | Review records | ❌ |

**HR controls (CC1.4/CC1.5, CC2.2):**
- Background checks for everyone with production, signing or customer-data access, using Checkr or Certn (about $30–$80 per check, est.; local law limits apply).
- NDA/confidentiality and IP assignment at hire.
- Security awareness training at hire and annually, plus phishing simulation (KnowBe4 or platform-bundled).
- Secure-coding training for engineers (OWASP Mobile Top 10, OWASP LLM Top 10).
- Offboarding checklist with **same-day** revocation of IdP, GitHub, AWS, Cloudflare, Railway and Cerebras access, plus device return or wipe.

### CC2 — Communication and information

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| CC2.1 | Quality information to support controls | Asset inventory, data-flow diagrams (§2.2), system description, and a control matrix kept in the GRC platform | Platform exports | ◐ Docs are rich but are engineering narrative, not control artifacts |
| CC2.2 | Internal communication of responsibilities | Policies published in the platform; Slack #security; documented on-call; internal incident reporting channel | Policy acceptance logs | ❌ |
| CC2.3 | External communication | Public trust page (SOC 3 later); `SECURITY.md` + `security.txt` + vulnerability disclosure policy; customer security exhibit; status page; privacy notice; change notifications for subprocessors | Published URLs | ❌ No `SECURITY.md` in repo |

### CC3 — Risk assessment

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| CC3.1 | Objectives specified | Security objectives derived from the SC-1…SC-8 commitments | Risk program doc | ❌ |
| CC3.2 | Identify and analyze risk | **Annual risk assessment + threat model.** Entities: device (lost phone, malicious app, bootloader unlock), agent (prompt injection via web, email or notifications → unauthorized tool action; OWASP LLM01), inference egress (over-sharing context), supply chain (upstream elizaOS, npm 3,227 packages [repo], Actions, AOSP), signing keys, enclave/KMS policy, Cloud account takeover | Risk register with likelihood × impact and owners | ❌ No register (05 doc is market research, not a risk register) |
| CC3.3 | Fraud risk | Credit-ledger manipulation (Cloud credits: existing doc rightly bans direct SQL balance edits [repo]); insider abuse of admin DB reads; signing-key misuse | Fraud section in risk register | ◐ Good norms in docs, not formalized |
| CC3.4 | Significant changes | Architecture changes trigger a risk re-assessment. The **Oct 1 enclave → on-device pivot** is exactly such a change; record it as a DC9 significant change if it occurs in a window | Change-impact assessment | ◐ ADR exists; no risk re-assessment |

### CC4 — Monitoring activities

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| CC4.1 | Ongoing and separate evaluations | Continuous control monitoring in Vanta/Drata (AWS, GitHub, IdP, MDM integrations); quarterly internal control self-assessment; annual third-party pen test; quarterly access reviews | Platform test history; pen-test report | ❌ |
| CC4.2 | Communicate deficiencies | Deficiencies tracked as tickets with SLA; reported in the quarterly security report | Tickets | ❌ |

### CC5 — Control activities

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| CC5.1 | Select controls that mitigate risk | Control matrix mapped to the risk register | Matrix | ❌ |
| CC5.2 | Technology general controls | The CC6–CC8 controls below | — | — |
| CC5.3 | Policies and procedures deployed | Policy set in §5.2, approved by management, reviewed annually | Approval records | ❌ |

### CC6 — Logical and physical access

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| **CC6.1** | Logical access security, infrastructure and architecture | **Identity:** move every admin identity off personal Gmail to a corporate IdP (Google Workspace or Okta/Entra) with **phishing-resistant MFA (FIDO2 security keys)** for all humans. SSO into AWS (IAM Identity Center), GitHub (Enterprise Cloud SAML + enforced 2FA), Cloudflare, Railway, Cerebras console and the GRC platform. **AWS:** AWS Organizations with separate `management`, `security/log-archive`, `prod`, `staging` and `build/signing` accounts. Root MFA hardware keys in a safe, root unused. SCPs deny leaving the org, disabling CloudTrail/GuardDuty/Config, creating IAM users or access keys, and actions outside approved regions; deny `kms:PutKeyPolicy` / `ScheduleKeyDeletion` except via the Terraform pipeline role. **No long-lived access keys**; CI uses GitHub OIDC → IAM role with `sub` claim pinned to repo, branch and environment. **KMS:** key policies grant no blanket `arn:aws:iam::<acct>:root` usage with IAM delegation. Trail of Bits shows any IAM admin can then bypass the attestation condition ([ToB 2026](https://blog.trailofbits.com/2026/08/05/a-few-notes-on-aws-nitro-enclaves-kms-integration/)); use explicit principals and explicit denies. **Device:** native Keystore-backed secrets (present), and no credentials in renderer storage (present per architecture doc) | IdP config export; AWS SCP JSON; IAM Access Analyzer report; KMS policy in Terraform; Keystore code | ◐ Device side good; cloud identity ❌ (personal Gmail; invalid local AWS profile; Wrangler OAuth cached in personal home dir [repo]) |
| CC6.2 | Registration and authorization before access | Access request tickets approved by the system owner; role-based groups in IdP; joiner workflow | Tickets | ❌ |
| CC6.3 | Role-based, least privilege, removal | IAM permission sets: `ReadOnly`, `Operator`, `Break-glass`. Production DB read requires a ticket plus time-boxed elevation (e.g. IAM Identity Center TEAM, or Teleport/StrongDM for Postgres). **Quarterly access reviews** of AWS, GitHub, Cloudflare, Railway, Cerebras, IdP. The 2026-09-30 read-only production query used appropriate safeguards (read-only transaction, timeouts, minimal columns [repo]); formalize that as a "production data access" procedure with ticket and log | Review sign-offs | ❌ |
| CC6.4 | Physical access | Fully inherited from AWS, Cloudflare, Railway and Cerebras (CSOCs). Office: N/A or badge logs. **Signing HSM location** (if on-prem) requires physical controls | Vendor SOC reports | Inherit |
| CC6.5 | Disposal of assets and data | Laptop and phone wipe certificates; device RMA wipe procedure (factory reset + FBE key destruction); cryptographic erasure via KMS key deletion for retired tenants | Wipe logs | ❌ |
| **CC6.6** | Protection against threats outside the boundary | **Replace the trycloudflare quick tunnel with a named Cloudflare Tunnel** on an Alpha zone, with Access policies and WAF/rate limiting. Quick tunnels: no SLA, 200 in-flight request cap ([Cloudflare docs](https://cloudflare-docs.justalittlebyte.ovh/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/); [DeepWiki](https://deepwiki.com/cloudflare/cloudflared/3.4-quick-tunnels)). Close the Railway Postgres public TCP proxy, or require verified TLS; today it presents a self-signed chain [repo]. Security groups deny all inbound except the tunnel. Enclave ingress keeps `ELIZA_REQUIRE_LOCAL_AUTH=1` (present [repo]). Device: Android network security config with cleartext disabled in release (present); certificate pinning for Alpha endpoints (optional; weigh against rotation risk) | Tunnel config; SG exports; scan results | ❌ Quick tunnel in use; public DB proxy |
| **CC6.7** | Restrict transmission, movement and removal of data | TLS 1.2+ everywhere; HSTS. Egress allow-list on the enclave host (Cerebras, KMS, Cloud API only). **Device egress policy:** only the inference endpoint and Alpha services; prompt-construction code enforces minimum context and (later) redaction before egress; logs never contain content. USB/adb disabled on production builds (`user` build, `ro.adb.secure=1`). Employee DLP: MDM-enforced disk encryption; no customer data on laptops | Network policy; build props; unit tests asserting no content in logs | ◐ `usesCleartextTraffic=false` and `allowBackup=false` in main manifest ✅; debug manifest permits cleartext (acceptable only if debug builds never ship) |
| **CC6.8** | Prevent or detect unauthorized or malicious software | **Device:** locked bootloader with **Alpha AVB keys**, either a custom root of trust in `avb_custom_key` (the GrapheneOS model on Pixels) or OEM-fused keys on a custom SKU ([AOSP device state](https://source.android.com/docs/security/features/verifiedboot/device-state)). APK v2/v3 signature with pinned certificate; Play Protect or equivalent for non-GMS. **Cloud:** enclave admission only for PCR0 values in the release transparency log, with PCR8 signer pinning. GuardDuty Malware Protection for EBS; immutable AMIs. **Endpoints:** EDR on laptops (CrowdStrike, SentinelOne or MDM-native) | AVB key fingerprints; `apksigner verify --print-certs`; KMS policy conditions; EDR console | ❌ No production keys; EIF unsigned |

**Key management (CC6.1/CC6.7/CC6.8), the part most specific to Alpha.**

| Key | Today [repo] | Required control |
| --- | --- | --- |
| Android app signing key (`ai.elizaresearch.alphaphone`) | Debug keystore outside repo; release unsigned; "no production signing material is created by setup" | Generate in an **HSM** (AWS CloudHSM, Google Cloud KMS/HSM via PKCS#11, or a YubiHSM 2 offline ceremony). Record the ceremony (two custodians, video, script, hash of public cert). Sign in a dedicated `release` GitHub Environment with required reviewers, or in an isolated signing service that only accepts **provenance-verified** unsigned APKs. Enable **APK Signature Scheme v3 rotation lineage** so a compromised key can be rotated ([apksigner docs](https://developer.android.com/tools/apksigner); [Guardsquare v3](https://www.guardsquare.com/blog/android-apk-signature-scheme-v3-context-and-new-opportunities)). If distributing via Play, use Play App Signing plus a separate upload key |
| AOSP platform keys (`releasekey`, `platform`, `shared`, `media`, `networkstack`, …) | None. The image lane is not yet built | Generate per AOSP "Sign builds for release". **Never ship test-keys.** Sign target files with `sign_target_files_apks -o` and the AVB key flags ([AOSP sign builds](https://source.android.com/docs/core/ota/sign_builds)). Keys stay in the HSM or an offline signing host. An APEX key per APEX |
| AVB / vbmeta key | None | RSA-4096 in HSM. Device root of trust = this key. Rollback index policy. Document the lost-key recovery story: there is none without a new key, so treat as crown jewel |
| OTA payload signing key | None | Separate key. OTA packages generated from signed target files. Device update engine verifies. Staged rollout + rollback |
| Nitro EIF signing key (PCR8) | Exists somewhere, but **signer ARN and operator not locatable**; the documented alias returns NotFound; the candidate EIF is unsigned [repo] | Recover or re-establish custody (KMS asymmetric ECDSA key in the `build/signing` account; `nitro-cli sign-eif` supports a KMS ARN ([AWS docs](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-sign-eif.html))). If custody cannot be proven, **rotate the signer**: new PCR8, a new KMS policy statement, and retire the old signer after migration. An auditor will not accept "the key exists but no one can find who controls it" |
| KMS data key for enclave state (`ba3b5556-…`) | Policy managed by `terraform/kms.tf` in an unlocated workspace; host cannot read policy [repo] | Terraform in a dedicated repo with remote state (S3 + DynamoDB lock, versioned), plan/apply only from CI OIDC role. **Two-person rule:** PR approval by a second key custodian plus GitHub Environment reviewer before `apply`. CloudTrail alert on any `PutKeyPolicy`, `CreateGrant`, `DisableKey`, `ScheduleKeyDeletion`. Key policy conditions: `kms:RecipientAttestation:PCR0` (image), `PCR8` (signer), `PCR3` (host role) ([KMS attestation conditions](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-attestation.html)). Explicit deny for all other principals on `Decrypt` / `GenerateDataKey` without attestation |
| Cerebras API key; Cloud org API keys | Env var on dev host; Keystore on device; 90-day org keys | Store in AWS Secrets Manager / Cloudflare secrets. Rotate ≤90 days. Per-environment keys. Usage alerts |

**Encryption at rest:**
- Device: Android FBE (default on modern Android) plus app-level Keystore AES-GCM for credentials (present).
- Cloud: EBS/S3/RDS encryption with CMKs. Railway Postgres disk encryption is inherited; confirm it in the Railway SOC 2.
- Enclave state: data key released only to attested enclaves.

**Encryption in transit:** TLS 1.2+; vsock inside the host; mTLS or bearer auth for enclave ingress.

### CC7 — System operations

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| **CC7.1** | Detect configuration changes and vulnerabilities | **Cloud posture:** AWS Config (all regions) + conformance packs; Security Hub (CIS/FSBP standards. There is no native SOC 2 standard in Security Hub; map via the GRC platform ([AWS re:Post](https://repost.aws/questions/QUFk1crMThQGKgme256sKFOw/how-to-be-soc2-compliant))); IAM Access Analyzer. **Dependencies:** Dependabot (npm, Gradle, GitHub Actions, git submodules) + `npm audit` gate; OSV-Scanner over `package-lock.json` *and* `vendor/eliza` lockfiles; Snyk or Socket.dev optional for malicious-package detection. **SAST:** CodeQL for JS/TS + Java/Kotlin; semgrep with Android rules; MobSF static scan of release APKs; Android lint (present in build). **Containers/EIF inputs:** Trivy/Grype on the runtime image digests (`sha256:0682…`, `sha256:3f6e…` [repo]) before EIF build. **SBOM:** CycloneDX for npm, Gradle and container rootfs. Attach to each release and to the transparency log. **AOSP patch cadence:** monthly review of the [Android Security Bulletin](https://source.android.com/docs/security/bulletin). Since 2026, AOSP source drops are **quarterly (Q2 and Q4)**, with supplemental patches between ([ASB 2026](https://source.android.com/docs/security/bulletin/2026/2026-03-01); [supplemental patches](https://source.android.com/docs/security/overview/supplemental-security-patches)). Policy: critical issues within 30 days of availability, high within 60, with `ro.build.version.security_patch` truthful; also kernel, vendor blobs and WebView/Chromium. **Remediation SLAs:** Critical 7d (cloud) / 30d (device), High 30d/60d, Medium 90d | Scan histories; SBOMs; patch-level report per OTA | ❌ No Dependabot/CodeQL/SBOM/Config; ◐ hash-verified speech downloads and pinned upstream |
| **CC7.2** | Monitor for anomalies | **Logging:** org-level CloudTrail (management + KMS data events) to the log-archive account, S3 Object Lock (WORM), ≥1 year retention (365 days hot / 7 years cold, est.); VPC Flow Logs; GuardDuty (all accounts; typical small-footprint cost $10–$100/mo ([AWS GuardDuty pricing](https://aws.amazon.com/guardduty/pricing); [CloudBurn](https://cloudburn.io/blog/amazon-guardduty-pricing))); Cloudflare Logpush (Workers, Access, WAF); Railway logs; GitHub audit log streaming; IdP sign-in logs. **SIEM:** a lean stack is fine. Options: (a) AWS Security Lake + Athena + Security Hub findings → PagerDuty; (b) Panther, Datadog Cloud SIEM or Sumo. **Detections:** root login; KMS policy change; enclave PCR mismatch / attestation failure spike; new IAM user/key; GuardDuty high; GitHub branch-protection change; secret-scanning alerts; signing-key use outside release window; Cerebras key usage anomaly. **Device fleet telemetry (privacy-preserving):** OTA install success, patch level, verified-boot state (green/yellow/orange), Play Integrity/Key Attestation verdict, crash rates. **No content** | SIEM rules; alert samples; log retention config | ❌ |
| **CC7.3** | Evaluate security events | Triage runbook; severity matrix (SEV1–4); ticket per alert | Tickets | ❌ |
| **CC7.4** | Incident response | IR plan with roles (incident commander, comms, legal/privacy, parent-company disclosure liaison). **SEC Form 8-K Item 1.05** materiality determination flows to the parent's disclosure committee: a microcap parent must assess material cybersecurity incidents within 4 business days of determining materiality. Customer notification ≤72h (commitment SC-7). Regulatory clocks per [05](05-regulation-compliance.md) (HIPAA 60d, GDPR 72h, NYDFS 72h). Playbooks: signing-key compromise (rotate via v3 lineage; AVB key compromise = device recall/re-key), KMS policy tamper, enclave image compromise, Cerebras breach, account takeover, lost device, prompt-injection-driven unauthorized action. **Annual tabletop exercise** | IR plan; tabletop report; post-mortems | ❌ |
| **CC7.5** | Recover from incidents | Post-incident review with corrective actions; restore tests (see A1.3) | PIR docs | ❌ |

**On-call and alerting:** PagerDuty or Opsgenie (or incident.io), with a 2-person rotation minimum (founder + engineer + vCISO escalation). Commit only to response times you can staff: e.g. SEV1 acknowledged in 30 minutes, 24×7 for cloud; business hours for SEV3 **(est.)**.

### CC8 — Change management

This is Alpha's richest area and the one auditors will spend the most time on.

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| **CC8.1** | Authorize, design, develop, configure, document, test, approve and implement changes | See the CC8 control list below | PR history, CI runs, attestations, transparency log, ticket links | ❌ for review/approval; ✅/◐ for testing and pinning |

CC8.1 controls for Alpha:

**(1) Branch protection / rulesets on `main`.**
- Require PRs; **≥1 approving review from someone other than the author**; dismiss stale approvals; require status checks (`Android foundation`, `Browser MVP`, CodeQL, dependency review); require linear history; block force-push and deletion; include administrators.
- Rulesets on private repos require GitHub Team or Enterprise ([GitHub rulesets](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets); [community discussion](https://github.com/orgs/community/discussions/184363)). The org must upgrade.

**(2) CODEOWNERS.** Required owners for `patches/eliza/**` (historical; the series was retired in `34b3c82a` and upstream changes now arrive through a reviewed pin move in `upstream.lock.json`), `upstream.lock.json`, `.gitmodules`, `android/**/AndroidManifest.xml`, `scripts/stage-aosp.mjs`, `.github/workflows/**`, Terraform and KMS policy.

**(3) Signed commits** (SSH or gitsign/Sigstore keyless). Require them on `main`. All 144 commits today show `%G?`=`N` [repo].

**(4) AI coding agents.** Agent-authored commits must go through PRs reviewed by a human. Agents get no merge or admin permission. Agent identity is visible in the commit trailer.

**(5) CI hardening.**
- Pin all third-party actions to full commit SHAs. The tj-actions/changed-files compromise (CVE-2025-30066) moved version tags to malicious commits across 23k repos ([Semgrep](https://semgrep.dev/blog/2025/popular-github-action-tj-actionschanged-files-is-compromised/); [StepSecurity](https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised)). Today: `actions/*@v4`, `reactivecircus/android-emulator-runner@v2`, `android-actions/setup-android@v3` [repo].
- Keep `permissions: contents: read` (present ✅).
- Add StepSecurity harden-runner egress audit, and an OpenSSF Scorecard workflow.

**(6) Provenance.**
- Use `actions/attest-build-provenance` for every APK, AAB, OTA payload, EIF and SBOM. GitHub artifact attestations give SLSA Build L2 by default, and **L3 when built via a reusable workflow** ([GitHub blog](https://github.blog/enterprise-software/devsecops/enhance-build-security-and-reach-slsa-level-3-with-github-artifact-attestations/)).
- Signing services verify the attestation (`gh attestation verify`) before signing.
- Builds of the EIF today happen on an operator host (`shaw-enclave.alphacompute.dev`) [repo]. Move them into CI, or into a dedicated build account with logged sessions.

**(7) Reproducible builds.**
- APKs: target bit-for-bit reproducibility of unsigned APKs. Verify by copying signatures with apksigcopier and running `apksigner verify`, as F-Droid does ([F-Droid](https://f-droid.org/en/docs/Reproducible_Builds/)).
- EIF: the existing 388,242-path payload equivalence scan and PCR recomputation [repo] is strong evidence. Make it a scripted CI gate.

**(8) Upstream change control.**
- The existing model is auditable: `upstream.lock.json` + 36 numbered patches + `*-source-base.json` manifests + "never edit `vendor/eliza`" rule (AGENTS.md).
- Add a PR template that records the upstream commit, patch SHA256 and test evidence.

**(9) Enclave image change / two-person admission.**
- Every EIF release appends `{source commit, patch SHA, image digests, EIF SHA256, PCR0/1/2/8, SBOM digest, approvers}` to a **public, append-only transparency log**: Sigstore Rekor entry, or a signed git log in a public repo.
- KMS policy PR adds the new PCR0 and retains the rollback PCR0. It needs approval by a second custodian and passes `terraform plan` review.
- Deploy one slot (d) first, with the guarded rollback already documented [repo].
- **No `kms put-key-policy` by hand.** The repo already states this. Enforce it with an SCP.

**(10) Release management for device.**
- Version-code monotonicity across APK and OS.
- Staged OTA rollout (1% → 10% → 100%) with health gates.
- Signed release notes.
- A release checklist that distinguishes APK build, emulator HOME test, AOSP image boot, real integrations and device acceptance. That checklist already exists as AGENTS.md doctrine; turn it into a template.

**(11) Emergency change procedure** with retroactive review within 2 business days.

**(12) Infrastructure as code** for AWS, Cloudflare and Railway. Drift detection via AWS Config and Terraform plan on schedule.

**(13) Model changes** (any change to the Qwen `qwen-3.8-27b` model version, or to its parameters or system prompts) go through change management. Record an eval run (task quality, safety and refusal, tool-call schema compatibility), the risk note (model origin, see [05 §7.7](05-regulation-compliance.md)) and approval.

**(14) Test evidence retention** ≥ the observation window + 1 year. Today CI artifacts are retained **14 days** [repo]. Export to S3 (Object Lock) or rely on the GRC platform's evidence snapshots.

### CC9 — Risk mitigation

| Crit. | Requirement | Alpha implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| CC9.1 | Business disruption risk | BCP covering key-person risk (the repo has **one committer**), loss of the AWS account or of Cerebras (fallback inference provider pre-qualified, e.g. a second host serving the same open-weight Qwen model; open weights make that portable), loss of GitHub. Cyber insurance (tech E&O + cyber), coordinated with the parent | BCP; insurance binder | ❌ |
| CC9.2 | Vendor and partner risk | Vendor register (AWS, Cerebras, Cloudflare, GitHub, Railway, Google, GRC platform, MDM, pen-test firm, OEM/ODM and any device distributor). Tiering by data access. Annual SOC 2 review with CUEC mapping. DPAs/BAAs. Subprocessor list published to customers with 30-day change notice. **Upstream open source** (elizaOS) is a supplier too: track maintainer security posture, pin commits (present) | Vendor register; review memos | ❌ |

### A1 — Availability

| Crit. | Alpha implementation | Status |
| --- | --- | --- |
| A1.1 Capacity | Capacity monitoring for enclave hosts (memory: enclave-d 12,288 MiB, a–c 4,096 MiB [repo]), Cloud DB and Cerebras rate limits; quarterly capacity review; alerts at 70% | ❌ |
| A1.2 Environmental protections, backups, recovery infrastructure | Inherit AWS/Railway physical controls. **Backups:** Postgres PITR + daily snapshot copied cross-region/cross-account; enclave encrypted state volume snapshot (state is KMS-wrapped, so backups are safe at rest but useless without the key policy, so back up the Terraform state and policy too); git mirrors; signing-key HSM backup (CloudHSM cluster backups or YubiHSM wrapped export to a second device in a separate safe). **Device:** platform backup is deliberately disabled [repo: architecture]. Document this as a *design decision* and expose a user-controlled encrypted export, otherwise a lost phone means lost agent state | ◐ Rollback target recorded for enclave d; the DB naming suggests restore-drill history but is not documented as DR |
| A1.3 Recovery testing | **Targets (est.):** Cloud API/pairing RTO 4h / RPO 15m; remote agent RTO 8h / RPO 24h; OTA service RTO 24h; signing capability RTO 72h (key escrow tested). Semiannual restore test with evidence. Annual DR tabletop. Note: the production writer is a service named `postgres-auth-restore-drill-20260825` and a different service is named `Postgres` [repo]. **Rename and document** the promotion; auditors will ask whether production is running on a drill copy | ❌ |

### C1 — Confidentiality

| Crit. | Alpha implementation | Status |
| --- | --- | --- |
| C1.1 Identify and maintain confidential information | Classification (§2.5). Tagging of AWS resources by data class. **Inference egress controls:** minimum context assembly, user-visible disclosure that prompts leave the device (the on-device plan already requires this [repo]), Cerebras ZDR in DPA, **redaction-before-egress** when built (entity classes: names, phone, email, address, government IDs, financial account numbers, health terms; with a fail-closed mode for regulated tenants). Logs and crash reports scrubbed. Test fixtures never use real customer data | ◐ Disclosure principle documented; redaction ❌ |
| C1.2 Dispose of confidential information | Retention schedule per data class. Automated deletion jobs. Account deletion → delete Cloud rows, revoke org keys, crypto-erase enclave state slot, instruct device wipe. Vendor deletion confirmation (Cerebras retains nothing; Railway/AWS backups expire within N days, so disclose backup lag). Evidence = deletion job logs + sample verification | ❌ |

### PI1 — Processing integrity (when redaction or ASR is committed)

| Crit. | Alpha implementation |
| --- | --- |
| PI1.1 Define and communicate processing specifications | Published redaction spec: entity taxonomy; languages; modes (mask, pseudonymize, drop); **target recall per class** (e.g. ≥98% on SSN/PAN, ≥95% on person names, est.); known limitations (accents, code-switching, numbers spoken as words) |
| PI1.2 Input completeness and accuracy | ASR confidence thresholds; audio segment hashes; reject or flag low-confidence spans for "redact by default" |
| PI1.3 Processing | Versioned redaction model and rules. Regression suite (held-out labeled corpus, synthetic PII injection) in CI; a release is blocked if recall drops below threshold. Agent tool actions: approval + receipt + idempotency/unknown-outcome handling (existing protocol) |
| PI1.4 Output | Redacted transcript carries the redaction-engine version and a per-span audit (type, offset, not the value) |
| PI1.5 Stored inputs and outputs | Originals (if retained) encrypted under a separate key with restricted rehydration role; retention per tenant |

The **effectiveness** evidence an auditor can test:
- a quarterly sample of N production transcripts (with consent), human-reviewed for missed entities;
- an exception rate tracked against the target;
- incidents opened when the target is breached.

Without that loop, keep redaction as a C1 *design* control, not a PI commitment.

### P1–P8 — Privacy (when in scope)

| Crit. | Alpha implementation |
| --- | --- |
| P1.1 Notice | Privacy notice covering: device data, on-device vs hosted processing, the Cerebras subprocessor, recordings, voiceprints, retention, rights, contact. In-product just-in-time notices at first mic, first recording, first external account connection |
| P2.1 Choice and consent | Explicit opt-in for recording, transcription, voiceprint/diarization (BIPA-style written release where required), cross-app notification reading, location. **Consent records** stored with timestamp, version and device. All-party consent prompts/announcements configurable per jurisdiction ([05 §1.2](05-regulation-compliance.md)). Visible recording indicator |
| P3.1–P3.2 Collection | Collect only for stated purposes. No secondary collection via telemetry. Implicit collection (bystander voices) handled by consent and auto-deletion of non-consented speakers when diarization exists |
| P4.1–P4.3 Use, retention, disposal | Purpose limitation (no model training on customer data, which Cerebras ZDR supports). Retention schedule enforced by code. Secure disposal (crypto-erase) |
| P5.1–P5.2 Access and correction | DSR workflow: export (JSON + audio) and correction/deletion within 30/45 days (GDPR/CCPA). Identity verification. Log of requests |
| P6.1–P6.7 Disclosure and notification | Subprocessor list. Disclosure log for legal requests. Breach notification procedure. Third-party (OAuth) disclosures only on user action |
| P7.1 Quality | Users can correct transcripts and contact data. Agent memory editable/deletable |
| P8.1 Monitoring and enforcement | Privacy complaints intake. Annual privacy review. DPIA for recording features |

### Cross-cutting: asset inventory, MDM, endpoint security

- **Asset inventory (CC6.1, CC6.5, CC7.1).** Maintain it in the GRC platform, auto-synced from:
  - AWS (Config resource inventory);
  - Cloudflare, Railway and GitHub;
  - the IdP (users);
  - MDM (laptops and phones);
  - a **device fleet register** for Alpha phones: serial/IMEI, SKU, AVB key ID, build fingerprint, patch level, owner/tenant, enrollment state, RMA status.
- **Employee laptops.** MDM (Kandji, Jamf, Intune, Fleet or Rippling) enforcing:
  - FileVault;
  - OS updates within 14 days;
  - screen lock ≤5 min;
  - firewall;
  - EDR;
  - no local admin by default;
  - USB storage policy.

  Laptops holding signing tooling should be dedicated and hardened, or signing should happen only in the HSM/CI service.
- **Alpha phones (company-owned test/demo/fleet).** Android Enterprise **fully managed** enrollment (zero-touch for Android 9+), or an AOSP-capable MDM for non-GMS builds ([Intune Android guide](https://learn.microsoft.com/en-us/intune/device-enrollment/android/guide); [Codeproof AOSP MDM](https://www.codeproof.com/platform/android/); [Fleet Android MDM](https://fleetdm.com/lp/android-mdm)). Note: the custom AOSP image may lack GMS, which rules out Google's Android Management API on those SKUs. Plan for a DPC-based or AOSP MDM, or build a minimal Alpha DPC. Policies: patch level, verified boot state, adb off, unknown sources off, remote wipe. **Customer fleets**: support customers' own EMM (CUEC 8) and document compatibility; the HOME role is not device-owner [repo: android-and-aosp].
- **Development devices and emulators.** `userdebug` images and `-writable-system` emulators are confined to CI/dev and never enrolled into production accounts. The CI workflow already scopes WebView replacement to a disposable emulator [repo].

## 4. Gap assessment against the current repo and infrastructure (2026-10-02)

Severity reflects audit impact: **H** = would produce a qualified opinion or block Type 1 design; **M** = exception likely in Type 2; **L** = hygiene.

| # | Finding [repo evidence] | Criteria | Sev | Remediation |
| --- | --- | --- | --- | --- |
| G1 | **No branch protection or rulesets on `main`.** `gh api …/branches/main/protection` → 404; `rulesets` → `[]`; repo is private | CC8.1 | H | Upgrade org to Team/Enterprise; ruleset per §CC8 (1) |
| G2 | **Single committer.** All 144 commits authored "Shaw" (many likely agent-generated); no second reviewer possible | CC8.1, CC1.3, CC9.1 | H | Hire or assign a second engineer as reviewer; human review of agent PRs; key-person BCP |
| G3 | **Unsigned commits** (`%G?`=`N` for all sampled) | CC8.1 | M | Require signed commits; gitsign or SSH signing |
| G4 | **GitHub Actions pinned by mutable tag** (`@v4`, `@v2`, `@v3`), including third-party `reactivecircus/*` and `android-actions/*` | CC8.1, CC7.1, CC9.2 | M | SHA-pin + Dependabot for actions; harden-runner |
| G5 | **No Dependabot, CodeQL, secret scanning config, SBOM, `SECURITY.md`, CODEOWNERS** (`.github/` contains only `workflows/`); `security_and_analysis` = null | CC7.1, CC2.3 | H | Enable GHAS features available on plan; add configs |
| G6 | **CI evidence retention 14 days** for APKs, smoke evidence and build reports | CC8.1, CC4.1 | M | Archive to S3 Object Lock ≥ 24 months, or GRC snapshots |
| G7 | **No production signing.** Debug APKs signed with local debug keystore; release APKs unsigned; CI stages the **debug-signed launcher** into AOSP overlay with `--development` | CC6.8, CC8.1 | H (for any production claim) | HSM-backed app key + ceremony; release workflow with environment approval; keep dev staging clearly non-release |
| G8 | **No AOSP release keys / AVB / OTA keys; image lane not built** (no Linux builder, hardware/SKU unselected, Cuttlefish boot unverified) | CC6.8, CC7.1, CC8.1 | H (if image is in the service) | Exclude AOSP image from Report 1 scope if not shipping; else generate keys per §CC6 |
| G9 | **Unsigned EIF candidate**; existing signer certificate known only by PCR8 hash; **signer KMS ARN, operator and Terraform runner not locatable**; documented alias NotFound; local AWS profile invalid; host cannot read KMS policy | CC6.1, CC8.1, CC9.2 | H | Recover custody or rotate signer; Terraform repo + CI OIDC; two-person apply; policy readable by security auditor role |
| G10 | **Public ingress via `trycloudflare.com` quick tunnel** (`knitting-clock-content-submitting…`) | CC6.6, A1.2 | H | Named tunnel on owned zone + Access + WAF |
| G11 | **Enclave build artifacts on an operator host home directory** (`/home/ec2-user/alpha-phone-release-…`); evidence in a personal home dir (`~/alpha-enclave-deployment/…`) | CC8.1, CC6.1 | M | Build in CI; artifacts in versioned S3 with Object Lock; evidence in GRC |
| G12 | **Admin identity is a personal Gmail** (`shawmakesmagic@gmail.com`) for Cloud, Railway and Google OAuth; Wrangler OAuth cached in user home; no corporate IdP evident | CC6.1–6.3 | H | Corporate IdP + FIDO2 MFA; migrate ownership of every console; break-glass procedure |
| G13 | **Production DB identity confusion**: writer is service `postgres-auth-restore-drill-20260825`; another service named `Postgres` is not the writer; Railway prod and staging share a project | CC8.1, A1.2, CC2.1 | M | Rename, document promotion, separate prod/staging projects, tag resources |
| G14 | **Public Postgres TCP proxy presents a self-signed chain** (cert validation fails, code 19) | CC6.6, CC6.7 | M | Disable public proxy or enforce verified TLS + IP allow-list |
| G15 | **Cloudflare observability: logs enabled, but historical query denied to the operator**; Google OAuth 401 root cause unrecoverable | CC7.2, CC7.3 | M | Logpush to the SIEM with retention; role for security read |
| G16 | **No written policies, risk register, vendor register, IR plan, on-call, access reviews, training, background checks** | CC1–CC5, CC9 | H | §5 policy set; platform onboarding |
| G17 | **Release build `minifyEnabled false`**; no R8/obfuscation (not required by SOC 2, but a pen-test finding) | CC6.8 (weak) | L | Enable R8 with keep rules; verify bridge reflection |
| G18 | **No redaction pipeline; on-device ASR not met for production; recording consent UX not built** [05 §0; MVP report] | C1, PI1, P1–P4 | H for Privacy/PI scope | Keep Privacy/PI out of Report 1; build per §3 |
| G19 | **Architecture in flux** (enclave → on-device on Oct 1; inference location still a pending decision) | CC3.4, DC9 | M | Freeze in-scope architecture ≥4 weeks before Type 1 date; record as significant change if it happens in-window |
| G20 | **Cerebras due diligence not on file** (SOC 2 report not obtained; DPA/ZDR not countersigned; BAA unconfirmed); Cerebras's own subprocessors include analytics (Mixpanel) and email (SendGrid), so confirm they never receive prompt content | CC9.2, C1.1 | M | Request via trust center; sign DPA; document CSOCs |

**Strengths to cite in the description** (they reduce effort):
- Pinned upstream with explicit patch files and source-base hashes, plus the "never edit vendor" rule.
- Hash-verified model and speech-asset acquisition.
- Same-run APK manifest hash verification between CI jobs.
- `permissions: contents: read` in workflows.
- `allowBackup=false`, `dataExtractionRules`, `usesCleartextTraffic=false` in the main manifest.
- Keystore AES-GCM credential storage; no secrets in renderer storage.
- `.gitignore` blocks `*.jks`, `*.keystore` and `.env*`.
- `DevelopmentAgent` confined to debug source sets.
- Tool approvals with receipts and unknown-outcome handling.
- Documented guarded single-slot enclave rollback and payload-equivalence verification.
- A culture of distinguishing evidence types (AGENTS.md). Auditors value that.

## 5. Evidence, policies, tooling, plan, headcount and budget

### 5.1 Evidence an auditor will request (PBC list)

**Entity level**
- Org chart; board/committee minutes covering security; code of conduct acknowledgments.
- Risk assessment and register; vendor register and reviews; insurance certificate.
- Policy set with approval dates and annual review; security training completion; background-check confirmations (population + sample).
- Hiring and termination lists (HRIS export). Auditors sample from these to test onboarding and offboarding.

**Access (CC6)**
- IdP user list with MFA status and SSO app assignments.
- AWS: Organizations/SCP JSON; IAM Identity Center assignments; IAM credential report (no user keys); root MFA evidence; Access Analyzer findings.
- GitHub org members, roles, 2FA enforcement, outside collaborators, deploy keys, Actions secrets list (names only).
- Cloudflare, Railway and Cerebras member lists.
- Quarterly access review sign-offs with remediation tickets.
- Terminated-user samples: deprovisioning timestamps vs termination date.
- KMS key policies (Terraform + live `get-key-policy`); key rotation status; HSM/key ceremony records; signing-key custodian list; signing logs.
- Encryption configuration: EBS/S3/DB, TLS config scans (SSL Labs); Android manifest/network security config; Keystore implementation.

**Operations (CC7)**
- Vulnerability scan reports and remediation tickets with SLA adherence; Dependabot/CodeQL alert history; SBOMs per release.
- AOSP patch-level tracking vs ASB; pen-test report + retest.
- CloudTrail/Config/GuardDuty/Security Hub enabled-state screenshots and retention settings; SIEM alert rules; sample alerts with triage tickets.
- On-call schedule; IR plan; tabletop report; incident log, including "no incidents" attestations.

**Change (CC8)**
- Population of all merged PRs and deployments in the window. The auditor samples 25–40 **(est.)** and checks: ticket, review by a non-author, CI pass, approval, deploy record.
- Branch-protection/ruleset config history (audit log); emergency changes with retro review.
- Release records: APK/OTA/EIF hashes, attestations, signing approvals, transparency-log entries, KMS policy PRs with two approvers.
- Model-change records.

**Availability/Confidentiality**
- Backup configuration and job logs; restore test evidence; DR test; capacity reviews; uptime/status history.
- Data retention schedule; deletion job logs; sample deletion verification; customer offboarding records.
- Cerebras DPA/ZDR clause; subprocessor list and change notices.

**Privacy/PI (if in scope)**
- Privacy notice versions; consent records sample; DSR log with timeliness.
- Redaction spec, regression results per release, quarterly human review sample, exception rate.

### 5.2 Policy documents (adopt templates, then tailor)

Template sources: the GRC platform's built-in library (Vanta/Drata/Secureframe/Sprinto all ship ~20–30 SOC 2 policies), the free [SANS policy templates](https://www.sans.org/information-security-policy/) and the Comply/StrongDM open-source SOC 2 policy set. Tailor them; auditors spot generic text that does not match practice.

1. Information Security Policy (umbrella; roles; exceptions)
2. Acceptable Use and Code of Conduct
3. Access Control Policy (IdP, MFA, least privilege, reviews, break-glass, production data access)
4. Asset Management Policy (inventory, device fleet register, disposal)
5. Data Classification and Handling Policy (§2.5)
6. Data Retention and Disposal Policy (schedule per class; customer deletion)
7. Encryption and **Key Management Policy** (HSM; ceremonies; custodians; rotation; AVB/OTA/APK/EIF/KMS specifics; compromise response)
8. **Secure SDLC Policy** (review, SAST/SCA, SBOM, provenance, reproducibility, AI-agent contributions, upstream patch process)
9. **Change Management Policy** (normal/standard/emergency; enclave admission; KMS policy two-person rule; model changes; OTA staged rollout)
10. Vulnerability and **Patch Management Policy** (SLAs; ASB cadence; WebView/Chromium; kernel)
11. Logging and Monitoring Policy (sources; retention; alert catalog)
12. Incident Response Plan + playbooks (including key compromise and the SEC 8-K liaison)
13. Business Continuity and Disaster Recovery Plan (RTO/RPO; restore tests; key escrow)
14. Vendor/Third-Party Risk Management Policy (+ subprocessor list)
15. Risk Assessment Policy (method; annual cadence; AI threat model)
16. Human Resources Security Policy (screening; training; offboarding; sanctions)
17. Physical Security Policy (mostly inherited; HSM/safe)
18. Endpoint and Mobile Device Policy (MDM; EDR; BYOD prohibition for admins)
19. Network Security Policy (ingress via named tunnel; egress allow-lists)
20. Privacy Policy (internal) + public Privacy Notice + Recording/Consent Policy + Biometric Data Policy
21. **AI Use and Model Governance Policy** (approved providers; data sent; evals; prompt-injection mitigations; human approval for side effects; maps toward ISO 42001)
22. Responsible Disclosure Policy (`SECURITY.md`, `security.txt`)
23. Backup Policy
24. Software Supply Chain / Open Source Policy (license + security review of new deps; pinned submodules)

### 5.3 Tooling recommendations (lean, for 3–8 people)

| Need | Recommendation | Est. annual cost |
| --- | --- | --- |
| GRC automation | **Drata or Vanta** (strongest AWS/GitHub/MDM integrations and auditor network). Sprinto/Secureframe are cheaper alternatives. Negotiate a startup discount and a 2-year term | $8k–$28k |
| IdP | Google Workspace (Business Plus/Enterprise) + hardware keys, or Okta | $2k–$6k + keys ~$50–$70 each |
| GitHub | **Enterprise Cloud** (rulesets, audit log streaming, SOC reports, SAML). Team plan is the minimum for private-repo rulesets. GHAS for secret scanning/code scanning on private repos | $3k–$12k |
| AWS security baseline | Organizations + Control Tower or `aws-samples` landing zone; CloudTrail org trail; Config; GuardDuty; Security Hub; IAM Identity Center; Access Analyzer; Security Lake (optional) | $2k–$8k usage |
| SIEM/alerting | Start with Security Hub + EventBridge → PagerDuty; graduate to Panther/Datadog Cloud SIEM when log volume justifies | $1k–$15k |
| On-call | PagerDuty / Opsgenie / incident.io | $1k–$3k |
| SCA/SAST | Dependabot + CodeQL (GHAS) + OSV-Scanner + semgrep CE + MobSF | $0–$10k |
| Container/EIF scanning | Trivy/Grype (free) | $0 |
| SBOM | Syft / CycloneDX generators; Dependency-Track (self-host) | $0 |
| Provenance | GitHub artifact attestations; Sigstore cosign/Rekor | $0 |
| Signing | AWS CloudHSM (HA pair) **or** YubiHSM 2 offline ceremony + KMS for EIF. Android OS signing often runs on an air-gapped signing host with HSM | $2k (YubiHSM pair) – $25k+ (CloudHSM HA, est.) |
| MDM (laptops) | Kandji/Jamf (Mac) or Fleet/Rippling/Intune | $1k–$4k |
| MDM (phones) | Android Enterprise EMM, or AOSP-capable MDM for non-GMS builds | $1k–$5k + engineering |
| EDR | CrowdStrike Falcon Go / SentinelOne / MDM-bundled | $1k–$3k |
| Training + phishing | Platform-bundled or KnowBe4 | $0–$2k |
| Background checks | Checkr/Certn | $0.5k–$1k |
| Trust center | Platform add-on or SafeBase | $0–$10k |

### 5.4 Week-by-week plan

**Assumptions:**
- Start Mon **2026-10-05**.
- Scope for Report 1: Security + Availability + Confidentiality.
- In-scope service = on-device agent app (signed APK), the cloud components actually serving customers (remote enclave agent + pairing/login, or whichever is retained), the release pipeline, and Cerebras carved out.
- The AOSP image is in scope **only if** customer devices ship on it before the Type 1 date; otherwise it is a DC9 significant change in Type 2 #2.

**Phase A — Foundations (weeks 1–4)**

| Wk | Dates | Work |
| --- | --- | --- |
| 1 | Oct 5–9 | Executive sponsor + budget approved with parent. Name the security officer (hire fractional vCISO). Decide **Scoping decision #1** (is Eliza Cloud Alpha's system?) and #2 (is the enclave remote agent a committed service?). Select GRC platform (two demos, sign). RFP to 3 auditors |
| 2 | Oct 12–16 | Corporate IdP live; FIDO2 keys shipped; migrate GitHub, AWS, Cloudflare, Railway, Cerebras and Google Cloud console ownership off personal Gmail (G12). Upgrade GitHub org plan. Enable 2FA enforcement, secret scanning and push protection |
| 3 | Oct 19–23 | `main` ruleset + CODEOWNERS + PR template + signed commits (G1, G3). SHA-pin actions; add Dependabot (npm, gradle, actions, submodules), CodeQL, dependency review, OpenSSF Scorecard (G4, G5). `SECURITY.md` |
| 4 | Oct 26–30 | AWS Organizations restructure (log-archive, security, prod, build/signing accounts); org CloudTrail with Object Lock; Config; GuardDuty; Security Hub; IAM Identity Center; SCPs. Connect AWS/GitHub/IdP to GRC. Engage auditor (sign SOW for Type 1 + Type 2) |

**Phase B — Close the high gaps (weeks 5–10)**

| Wk | Dates | Work |
| --- | --- | --- |
| 5 | Nov 2–6 | Replace trycloudflare quick tunnel with a named tunnel + Access + WAF (G10). Close or lock down the public Postgres proxy (G14). Rename/document the production DB; split prod/staging (G13) |
| 6 | Nov 9–13 | **Enclave custody:** locate or rotate the EIF signer; move `kms.tf` to a dedicated Terraform repo with CI OIDC apply, two-person review, drift detection; CloudTrail alerts on KMS policy events (G9). Fix key-policy root/IAM-delegation pattern per Trail of Bits |
| 7 | Nov 16–20 | **App signing ceremony:** HSM-backed release key, v3 lineage plan, custodians; `release.yml` workflow with environment approval, provenance attestation, SBOM, `apksigner verify`, artifact archive to S3 Object Lock (G6, G7). Enable R8 (G17) |
| 8 | Nov 23–27 *(holiday week, light)* | Draft policies 1–12 in platform; tailor to repo reality |
| 9 | Nov 30–Dec 4 | Policies 13–24; management approval; employee acknowledgment; security training; background checks for existing staff. Risk assessment workshop → register (CC3). Vendor register; request Cerebras SOC 2 + DPA/ZDR + BAA position; download AWS, Cloudflare, GitHub, Railway reports; CSOC/CUEC mapping (G20) |
| 10 | Dec 7–11 | Logging/SIEM: Cloudflare Logpush, GitHub audit-log streaming, IdP logs, Railway logs → central store; alert catalog; PagerDuty rotation; IR plan + playbooks; **first tabletop** (scenario: EIF signer compromise) |

**Phase C — Readiness and Type 1 (weeks 11–16)**

| Wk | Dates | Work |
| --- | --- | --- |
| 11 | Dec 14–18 | Backups + **first restore test** (Cloud DB to a scratch project; enclave state recovery path; signing-key escrow test). Set RTO/RPO. Capacity dashboard. MDM on all laptops + test-phone fleet; asset inventory complete |
| 12 | Dec 21–25 *(holiday)* | Buffer. Freeze in-scope architecture (G19) |
| 13 | Dec 28–Jan 1 *(holiday)* | Buffer; draft system description (DC1–DC9) from §2 |
| 14 | Jan 4–8 | **Readiness assessment** (auditor or vCISO mock audit) against every control; fix list. Pen test kickoff (mobile app + cloud + enclave ingress; AOSP image if in scope) |
| 15 | Jan 11–15 | Fix readiness findings. First quarterly access review completed and signed. **Type 1 "as of" date: Fri 2027-01-15** |
| 16 | Jan 18–22 | Type 1 fieldwork (walkthroughs, ~1–2 weeks). **Type 2 observation window opens Mon 2027-01-18** |

**Phase D — Operate the Type 2 window (weeks 17–26)**

| Wk | Dates | Work |
| --- | --- | --- |
| 17 | Jan 25–29 | Pen test report; remediate highs within SLA; retest booked |
| 18 | Feb 1–5 | Monthly vulnerability review #1 (evidence). ASB February review → patch decision record |
| 19 | Feb 8–12 | **Type 1 report issued** (~4 weeks after the as-of date, est.). Publish trust page; start sharing under NDA |
| 20 | Feb 15–19 | Change-management sample self-check: pull 10 PRs and verify ticket/review/CI/deploy linkage; fix process drift |
| 21 | Feb 22–26 | Vendor reviews completed and signed; subprocessor list published |
| 22 | Mar 1–5 | Monthly vuln review #2; ASB March; pen-test retest closed |
| 23 | Mar 8–12 | DR/BCP tabletop #2 (scenario: Cerebras outage → fallback provider; AWS account lockout) |
| 24 | Mar 15–19 | Privacy readiness (if Privacy goes into Type 2 #2): DPIA for recording, consent records, DSR workflow dry run |
| 25 | Mar 22–26 | Redaction spec + regression harness (feeds a future PI scope); quarterly risk review |
| 26 | Mar 29–Apr 2 | **Quarterly access review #2**; monthly vuln review #3; restore test #2 |
| 28 | Apr 16 | **Type 2 window closes Fri 2027-04-16** |
| 29–32 | Apr 19–May 14 | Type 2 fieldwork (samples across the window) |
| ~35 | early Jun 2027 | **Type 2 report issued (est.)** |
| — | Apr 17, 2027 → Apr 16, 2028 | **Type 2 #2: 12-month window**; add Privacy (and PI if redaction is committed); add AOSP image/OTA if shipping |

### 5.5 Headcount (est.)

| Role | Load | Notes |
| --- | --- | --- |
| Executive sponsor / system owner (founder) | 10–15% for 6 months | Approvals, risk acceptance, board reporting |
| **Fractional vCISO / GRC lead** | 0.3–0.5 FTE for 6 months, then 0.2 | Policy authoring, auditor liaison, risk/vendor program; $5k–$12k/month (est.) |
| **Security/platform engineer** | 1.0 FTE (new hire or reassigned) | AWS org, IdP, CI hardening, signing infra, SIEM, IaC. This is the person who also becomes the *second reviewer* (fixes G2) |
| Application engineers | 10–20% each | Remediation, SAST fixes, R8, release workflow, redaction harness |
| Android/AOSP release engineer | 0.5 FTE when the image lane starts | AVB/OTA keys, ASB patch cadence, Cuttlefish/physical acceptance |
| People ops / legal / privacy counsel | ad hoc, ~40–80 hrs | HR controls, DPAs, privacy notice, consent; the parent may supply |

Without the second engineer, G2 cannot be closed. A one-person company cannot demonstrate segregation of duties in change management. The usual compensating control is an independent reviewer (contractor or vCISO) approving production changes, which is weaker.

### 5.6 Budget, year one (est.)

| Item | Low | High |
| --- | --- | --- |
| GRC platform | $8k | $28k |
| Auditor: Type 1 | $8k | $20k |
| Auditor: Type 2 (3-month window) | $12k | $40k |
| Pen test (mobile + cloud + enclave ingress; + AOSP image if in scope) | $15k | $45k |
| Fractional vCISO (6 months) | $30k | $60k |
| Signing infrastructure (HSM, ceremony) | $3k | $30k |
| IdP + hardware keys + MDM + EDR + on-call + training + background checks | $8k | $20k |
| GitHub plan upgrade + GHAS | $3k | $12k |
| AWS security services usage | $2k | $8k |
| Legal/privacy counsel (DPA, privacy notice, consent) | $5k | $25k |
| **Total cash** | **~$94k** | **~$288k** |
| Likely landing for a disciplined, small scope | **$110k–$170k** | |
| Internal security/platform engineer (if new hire, fully loaded) | +$180k–$260k/yr | |

Ongoing years run about $60k–$150k/yr plus headcount **(est.)**: annual Type 2, pen test, platform renewal and the vCISO at reduced load.

## 6. Interactions with other frameworks and customer questionnaires

### 6.1 HIPAA

- **There is no HIPAA "certification."** A covered entity buyer wants:
  - a signed **BAA**;
  - a documented **Security Rule risk analysis** (§164.308(a)(1));
  - policies;
  - evidence such as SOC 2 + HIPAA mapping, or HITRUST.
- **SOC 2+ HIPAA** adds HIPAA Security Rule criteria as additional subject matter in the same CPA examination ([Meditology](https://www.meditologyservices.com/soc-2-hipaa-examination/); [Secureframe](https://secureframe.com/hub/hipaa/and-soc-2-compliance)). It does not replace the BAA or the risk analysis.
- The strongest overlaps are access, encryption, audit logging, incident response and risk management ([AccountableHQ crosswalk](https://www.accountablehq.com/post/soc-2-to-hipaa-mapping-crosswalk-trust-services-criteria-to-hipaa-security-rule-requirements)).
- **Alpha-specific additions:**
  - BAAs down the chain: AWS via Artifact ([AWS re:Post](https://repost.aws/knowledge-center/activate-artifact-baa-agreement)); Cerebras (confirm in writing); Railway (BAA on request); Cloudflare (if PHI transits Workers).
  - A "PHI-safe mode": redaction on; no third-party connectors without a BAA.
  - Breach notification within 60 days.
  - Design to the 2025 NPRM: MFA, asset inventory and network map, 72-hour restore, semiannual scans, annual pen test. See [05 §3](05-regulation-compliance.md). The SOC 2 plan above already satisfies most of these if the RTO is ≤72h.
- HITRUST e1/i1 is the healthcare-buyer upgrade, $40–200k (est., from 05).

### 6.2 ISO/IEC 27001:2022

- ISO 27001 certifies the ISMS: scope, context, risk treatment, Statement of Applicability, internal audit, management review. It does this against 93 Annex A controls in four themes ([Konfirmity](https://www.konfirmity.com/blog/iso-27001-mapping-to-soc-2)).
- Practitioner estimates put **~60–80% control overlap** with SOC 2 ([Probo](https://www.probo.com/hub/iso-27001-after-soc-2-the-30-percent-shortcut); [TruvoCyber](https://truvocyber.com/blog/iso-27001-soc-2-control-mapping)).
- **Net-new work:**
  - ISMS clauses 4–10: context, interested parties, ISMS scope statement, objectives, internal audit, management review, corrective-action process;
  - SoA;
  - a formal risk treatment plan;
  - several Annex A items SOC 2 does not force (A.5.7 threat intelligence, A.5.23 cloud services, A.8.28 secure coding, A.5.30 ICT readiness for BC).
- **Recommendation:** run ISO 27001 in year two, once EU or Gulf buyers ask. Stage 1 + Stage 2 cost about $15–40k (est.). **ISO/IEC 42001** (AI management system; ~40–50% overlap with SOC 2 per practitioners ([soc2auditors.org](https://soc2auditors.org/insights/ai-startup-iso-42001/))) is a candidate if AI governance becomes a sales question. The AI Use and Model Governance Policy (#21) is a head start.

### 6.3 FedRAMP 20x

- 20x replaces control narratives with **Key Security Indicators (KSIs)** that are machine-validated: ~56 for Low, ~61 for Moderate per secondary sources ([FedRAMP KSIs](https://www.fedramp.gov/docs/key-security-indicators/); [Knox](https://knoxsystems.com/resources/fedramp-20x-ksi); [Secureframe](https://secureframe.com/blog/fedramp-20x)).
- First Moderate authorizations came in March 2026, and Rev5 certifications sunset June 2027 ([05 §7.1](05-regulation-compliance.md)). SOC 2 and ISO evidence is **partially reusable**. Commentators describe limited reuse pathways, but 20x still needs FedRAMP-specific automated KSI validation by a 3PAO ([Knox](https://knoxsystems.com/resources/fedramp-20x)).
- What carries over directly from this plan:
  - IaC-defined infrastructure;
  - centralized immutable logging;
  - automated config/vuln evidence (Config, Security Hub);
  - phishing-resistant MFA;
  - SBOM/provenance;
  - IR and recovery testing;
  - the AICPA [TSC↔NIST 800-53 mapping](https://www.aicpa-cima.com/resources/download/mapping-2017-trust-services-criteria-to-nist-800-53).
- What does not carry over:
  - a FedRAMP boundary, likely in AWS GovCloud;
  - FIPS 140-3 validated crypto in the boundary;
  - **inference inside an authorized boundary**. Cerebras's public API has no known FedRAMP authorization; this is the blocker 05 already flags.
- Design choice now: keep evidence machine-readable (JSON from AWS/GitHub APIs, not screenshots). That is the 20x direction and also makes SOC 2 sampling cheaper.

### 6.4 Customer security questionnaires: what they ask beyond SOC 2

- **SIG Lite** (Shared Assessments) has ~126–128 questions across ~18–21 domains ([Workstreet](https://www.workstreet.com/blog/sig-lite); [UpGuard](https://www.upguard.com/blog/sig-questionnaire)). SIG Core runs much larger.
- **CAIQ v4.1** maps the CSA **CCM v4.1** (207 controls, 17 domains, released Jan 2026), with ~283 yes/no questions ([CSA CCM v4.1](https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4-1); [CSA blog](https://cloudsecurityalliance.org/blog/2025/12/02/the-csa-cloud-controls-matrix-v4-1-strengthening-the-future-of-cloud-security)). A SOC 2 report is an accepted basis for **CSA STAR Level 2**.

Expect these Alpha-specific asks that a SOC 2 report alone will not answer. Prepare a standing answer pack for each:
1. **AI/LLM:** which models and providers; data retention and training use (Cerebras ZDR); prompt-injection defenses; human-in-the-loop for actions; model change control; evals; output-harm handling; AI incident process. Many 2026 questionnaires add an AI annex ([Lowerplane](https://lowerplane.com/blog/enterprise-ai-security-questionnaires/)).
2. **Mobile/device:** MDM compatibility (Android Enterprise); verified boot and patch SLA (ASB cadence); device data encryption; remote wipe; lost-device process; supply chain of the hardware (ODM, country of origin — see [05 §7.4](05-regulation-compliance.md)); radio certifications.
3. **Data residency and sovereignty:** where inference runs (Cerebras US data centers); EU option; subprocessor countries; cross-border transfer mechanism (SCCs/DPF).
4. **Privacy and recording:** consent model, all-party consent support, biometric handling, retention configurability, legal hold and e-discovery export.
5. **Business continuity:** key-person risk (directly visible here), financial viability (the public parent helps), source-code escrow (some enterprises ask for it for a device OS).
6. **Insurance:** cyber and tech E&O limits (often $2–5M asked).
7. **Pen test summary letter**, vulnerability disclosure program, bug bounty.
8. **Software supply chain:** SBOM on request (EO 14028-influenced buyers), SLSA level, signed releases, open-source license compliance (the repo already tracks `licenses/`).
9. **Encryption specifics:** algorithms, key lengths, KMS/HSM usage, BYOK/HYOK (the attested-KMS design is a differentiator if retained).
10. **Background checks, training cadence, access reviews:** answered by SOC 2, but questionnaires want dates.

## 7. Open decisions

1. **Scope:** is Eliza Cloud (Cloudflare Workers + Railway) Alpha's system, a sister entity's, or a third party's? (§2.3)
2. **Scope:** does the Nitro enclave remote agent remain a customer-facing, committed service after the Oct 1 pivot? If not, keep it out of the description and decommission or isolate it, rather than describing an orphaned system.
3. **Device:** will customer devices run the custom AOSP image before the Type 1 date? That decides whether AVB/OTA key controls are tested in Report 1.
4. **Inference:** confirm Cerebras contract terms for `qwen-3.8-27b` (DPA, ZDR, BAA, region) before the window. Pre-qualify a fallback provider for CC9.1.
5. **Report consumers:** does the parent's external auditor intend to rely on this report for ITGCs? If so, involve them in selecting the CPA firm and the criteria.
6. **Second engineer:** without one, the change-management segregation of duties cannot be shown.
