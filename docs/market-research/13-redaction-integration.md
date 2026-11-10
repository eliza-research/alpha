# 13 — Redaction integration: verified upstream inventory, egress gate design and implementation plan

> **Superseded in part (2026-10-13, [decision P-42](../decisions.md)).** On-device and local speech and inference use only libelizainference (llama.cpp/ggml, GGUF models). ONNX Runtime, sherpa-onnx and ONNX-format models named in this section are historical research context, not a plan.

> Runtime source update: the local patch series has been migrated into reviewed upstream commits. AlphaPhone now consumes the immutable revision in `upstream.lock.json`; see [architecture and source ownership](../architecture.md). Patch filenames and line numbers below describe historical evidence retained in Git history, not files to apply to the current checkout. Implement further shared runtime changes through upstream PRs and update the reviewed pin.

This is an engineering design and plan, not acceptance evidence. Apart from the upstream swap fix in Section 17, nothing in it is built. It checks the claims in [04-redaction.md](04-redaction.md) and [11-fit-gtm-risks.md](11-fit-gtm-risks.md) against source, maps Alpha's egress points, compares external tools, and proposes a single egress gate with a work plan.

Repository rules that constrain this plan (from `AGENTS.md` and `docs/architecture.md`):

- `vendor/eliza` is a pinned upstream submodule and must not be edited. Upstream changes go through reviewed upstream commits or explicit tested patches in `patches/eliza` (historical; the series was retired in `34b3c82a` and upstream changes now arrive through a reviewed pin move in `upstream.lock.json`).
- ADR-02 (`docs/architecture.md:28`) says "Generic transport, platform capability checks, redaction, task/approval protocol and native plugins belong upstream. Product task policy must be supplied explicitly." So detectors, sessions and the audit sink belong upstream. Alpha supplies **policy**, the **device vault** and **native enforcement**.
- E5 (`docs/implementation-plan.md:58`) requires "secret redaction before remote transport" and "no passwords/OTP/token values in transcripts, screenshots, model input or logs".
- Evidence levels must stay distinct: a source read, a unit test, an APK build, an emulator test, a physical-device test and user acceptance each prove different things. Section 12.3 tags every test with its level.

File and line references are against the pinned checkout `vendor/eliza` at `760ad0f1`, the 36 MVP patches plus the auxiliary patches in `patches/eliza` (historical; the series was retired in `34b3c82a` and upstream changes now arrive through a reviewed pin move in `upstream.lock.json`), the Alpha renderer runtime and the Android plugins. Vendor accuracy numbers are vendor claims unless stated otherwise.

## 1. Executive summary

1. **The claims in 04 and 11 mostly hold, with three corrections.** The pinned upstream does contain checksum-validated detectors, session pseudonyms, secret-swap, fail-closed audio redaction with re-transcription checks, and confidential-inference admission with mandatory audit. The corrections:
   - The pseudonyms are **realistic surrogates** ("Dana Whitfield" becomes "Priya Okafor"), not typed tokens like `PERSON_1`.
   - The confidential-inference audit record carries **route and attestation metadata only**. It records nothing about redaction.
   - The core PII modules have **no unit tests in the pinned checkout**, although their comments mention fuzz and red-team suites. Only the plugin-level recognizer, the scrub handler and the transcript store have tests.
2. **Upstream redaction runs inside the agent runtime, at the model boundary** (`packages/core/src/runtime/model-dispatch/dispatcher.ts:1395-1450`). It is off by default and turned on by `ELIZA_SECRET_SWAP_ENABLED` and `ELIZA_PII_SWAP_ENABLED`. It protects the hop from agent to model provider. It does **not** protect the hop from phone to agent, which is where raw user text, mail bodies and audio travel today.
3. **Without a local NER model, upstream detects no person names.** The built-in regex recognizer finds only US street addresses, plus email and phone if enabled. Person, organisation and location detection needs the `PII_ENTITY_RECOGNIZER_SERVICE`. Its upstream implementation (`plugins/plugin-local-inference/src/pii/llm-recognizer.ts`) is a llama.cpp prompt that Alpha's Android build does not ship.
4. **Alpha calls none of it.** `apps/app/src` has no `@elizaos/core` dependency and no redaction calls. The upstream modules import `node:crypto` and `node:buffer` (`utils/crypto-compat.ts`, `utils/buffer.ts`), so the renderer cannot import them unchanged.
5. **Alpha already has strong minimisation in places:**
   - The per-view context sends opaque IDs only (`apps/app/src/runtime/phone-context.ts:15-45`).
   - The browser refuses to read sensitive pages (`android/.../BrowserReading.java:20-61`).
   - Credentials live in the Keystore (`AlphaConnectionPlugin.java:69`, alias `alpha.connection.aes.v1`).

   The open egress is **free text**: chat messages, reviewed email bodies, voice transcripts and TTS text. **Raw audio** also leaves the phone for cloud STT and paired whisper.
6. **There is one renderer chokepoint for chat:** `connectionController.send` in `apps/app/src/runtime/connection-ui.tsx:594-596`, where `phoneContextMessage` builds the outgoing text. Native egress has **two Java chokepoints**: `AlphaConnectionPlugin.request` (`:245`) for all JSON HTTP, and `AlphaVoiceCloudPlugin.connect`/`connectPaired` (`:88`, `:109`) for audio and TTS.
7. **Recommended architecture:**
   - **Detect and transform in the renderer**, reusing upstream TypeScript through a new browser-safe subpath export (a patch).
   - **Run model-based NER natively** through ONNX Runtime Android, exposed to the renderer as a `PiiEntityRecognizer`.
   - **Enforce in Java**, so that no body leaves without a matching gate receipt and a clean tier-0 floor scan.
   - **Turn on the upstream swaps in the agent** as a second pass, both on-device and in the enclave.
8. **Model choice:** first evaluate OpenAI Privacy Filter (Apache-2.0, 1.5B total / 50M active, 8 categories, ONNX q4 about 875 MB). Its download size makes it a heavy optional pack. The default on-device candidate is **GLiNER-PII edge** (Apache-2.0, UINT8 ONNX about 197 MB, vendor F1 75.5%). The regex and checksum detectors stay the deterministic floor. Presidio, Limina and Tonic Textual fit the enclave second pass or evaluation, not the phone.
9. **Spoken entities are the biggest technical gap.** Upstream `normalizeSpokenText` strips separators but does not turn number words into digits ("five five five"). Upstream audio redaction needs word timings, which Alpha's paired whisper route does not provide (`docs/standalone-paired-asr.md:20`). Alpha needs a number-word normalisation pass with an offset map, and confidence-aware widening of detected spans.
10. **Effort:** about 15 to 19 engineer-weeks to a qualified Tier-1/Tier-2 gate on emulator plus one physical device, and about 20 to 26 weeks including the model pack, the evaluation set and the enclave second pass. Work packages are in Section 14.

## 2. Verification of prior claims

| Claim (04 / 11) | Verdict | Evidence |
|---|---|---|
| "Checksum-validated detectors" | **True** | `packages/core/src/security/pii-detectors.ts`. Validators: Luhn plus card brand (`:78`, `:95`), SSN allocation rules (`:119`), IPv4 octets (`:132`), IBAN mod-97 (`:139`), WIF double-SHA256 (`:186`). |
| "Corpus-consistent typed pseudonyms" | **Partly** | Session-consistent, bijective, reversible **realistic** surrogates (`pii-pseudonymizer.ts:1-42`, `mintSurrogate` `:639`). Corpus-wide consistency by entity cluster exists separately (`pii-pseudonym-map.ts` `CorpusPseudonymMap`). Neither emits typed tokens like `PERSON_1`. |
| "Secret-swap before the model boundary" | **True, but opt-in** | `secret-swap.ts` `SecretSwapSession`. Wired at `runtime/model-dispatch/dispatcher.ts:1395-1415`. Gated by `ELIZA_SECRET_SWAP_ENABLED` (`runtime.ts:792-796`), which defaults to false. |
| "Fail-closed audio redaction with re-transcription verification" | **True** | `packages/agent/src/services/audio-redaction-service.ts:150-215`: build span plan, `assertCompleteAudioRedactionPlan`, render a candidate, re-transcribe with every verifier, persist only after verification. `audio-redaction-verify.ts:161` fails if no verifier is configured, if any backend throws, or if a transcript is empty. |
| "Confidential inference admission policy with mandatory audit records" | **True for routes; no content inspection** | `security/confidential-inference.ts:27-44`. The audit record holds attempt, agent, model type, policy revision, route, phase, denial code, status and evidence/binding digests. It records no redaction facts. Durable sink: `packages/agent/src/security/confidential-sqlite-audit.ts:51`. Bootstrap: `runtime/confidential-host-bootstrap.ts:95`. |
| "The Alpha app does not call any of it" | **True** | `apps/app/src` has no `@elizaos/core` import and no redaction call. The root `package.json` has no `@elizaos/*` dependency. |
| "Alpha patches wire it in" | **No patch does** | 0001–0035 contain no redaction logic (0025/0026 only mention the words). 0036 is the qualified rebase to upstream `ab8f9a7110ae…` (3.4 MB, 86,625 lines). It **brings in** upstream changes to `pii-scrub-seam.ts`, `log-redaction.ts` and `redact.ts`, and adds `security/processing-policy.ts` (host-owned processing admission with `Action.egress`). It does not wire anything into Alpha's path. |

## 3. Upstream component inventory (pinned `vendor/eliza`)

All listed modules are re-exported from the `@elizaos/core` root (`packages/core/src/index.ts:321`, `:334`, `:2976-3164`). The package has a single `.` export plus `./activity-plaintext`, and no browser-specific build.

### 3.1 Tier-0 deterministic detectors

**Location.** `packages/core/src/security/pii-detectors.ts` (445 lines).

**API.**
```ts
export interface PiiMatch { readonly kind: string; readonly value: string; readonly start: number; readonly end: number }
export function detectPii(text: string, options?: { disabledKinds?: ReadonlySet<string> }): PiiMatch[]
export const PII_DETECTORS: readonly PiiDetector[]
export const PII_DETECTOR_BY_KIND: ReadonlyMap<string, PiiDetector>
export function luhnValid(d: string): boolean; cardBrand; ssnValid; ipv4Valid; ibanValid; wifValid
```

**Kinds detected (24).**
- Personal and financial: `email`, `credit-card` (Luhn and brand), `ssn`, `iban` (mod-97), `phone` (NANP with a separator, or E.164 with `+`), `ipv4`, `mac-address`.
- Credentials and keys: `jwt`, `seed-phrase` (BIP-39), `wif-private-key`, `url-credentials`, `anthropic-key`, `stripe-webhook-secret`, `slack-webhook-url`, `basic-auth-header`, `google-oauth-refresh-token`, `telegram-bot-token`, `pgp-private-key`, `aws-access-key`, `stripe-key`, `google-api-key`, `github-token`, `openai-key`, `slack-token`, `private-key`, `hex-secret`.

**Approach.** Regex plus structural validators. Overlapping matches resolve longest-first (`:395-445`).

**Reversible?** No. Detection only.

**Runtime.** Imports `createHash` from `../utils/crypto-compat`, which imports `node:crypto`. That makes it Node-only as written. The hash is used only by the WIF check, so a WebCrypto shim or a pure-JS SHA-256 makes it browser-safe.

**Tests.** None in the pinned checkout. It is exercised indirectly by `plugins/plugin-local-inference/src/services/voice/transcript-store.test.ts`.

**Gaps.**
- No person, organisation or location detection.
- No date of birth, passport, driver's licence, medical record number, non-US national IDs, US bank account or routing numbers, or ZIP codes.
- No spoken-form numbers ("four one five …").
- Phone detection requires separators.
- English and US-centric.

### 3.2 Entity recognizers

**Location.** `packages/core/src/security/entity-recognizer.ts` (318 lines).

**API.**
```ts
export interface EntitySpan { kind: string; value: string; start?: number; end?: number; score?: number }
export interface PiiEntityRecognizer { readonly name: string; recognize(text: string): Promise<EntitySpan[]> }
export const PII_ENTITY_RECOGNIZER_SERVICE = "pii_entity_recognizer";
export interface PiiEntityRecognizerService { getRecognizer(): PiiEntityRecognizer | null }
export class RegexEntityRecognizer   // options { address?: true, email?: false, phone?: false }
export class GazetteerEntityRecognizer // (entries: Iterable<{kind,value}>, { name?, caseSensitive? })
export class CompositeEntityRecognizer // (recognizers, { blocklist? }); longest span wins; throwing recognizer contributes 0 spans
export function canonicalKind(raw: string): string // PER/ORG/LOC/GPE/... -> person/org/location/address/email/phone
```

**Approach.** The regex recognizer handles conservative US street addresses. The gazetteer matches a dictionary (for example, the user's contact roster). The composite merges recognizers. A recognizer that throws contributes zero spans, so the composite **fails open for that recognizer**. Alpha's gate must treat "NER unavailable" as a policy event, not as silence.

**Runtime.** Pure TypeScript with no Node imports apart from `basic-email`, so it is browser-safe.

**Tests.** None in core.

**Plugin-level model recognizer.** `plugins/plugin-local-inference/src/pii/llm-recognizer.ts`:
- `class LlmEntityRecognizer(generate: LocalPiiGenerate, { chunkChars? = 4000 })`.
- Kinds: `person`, `org`, `location`.
- It runs a JSON-extraction prompt on the resident local llama.cpp model and keeps only spans found verbatim in the source.
- `service.ts` registers `LocalPiiRecognizerService`.
- 14 test cases.
- It needs a local GGUF model, which Alpha's Android build does not package.

### 3.3 Session pseudonymizer (reversible)

**Location.** `packages/core/src/security/pii-pseudonymizer.ts` (939 lines).

**API.**
```ts
export interface PseudonymEntry { readonly value: string; readonly surrogate: string; readonly kind: string }
export interface PseudonymSessionOptions { salt?: string; blocklist?: Iterable<string>; disabledKinds?: Iterable<string>; recognizer?: PiiEntityRecognizer; minValueLength?: number }
export class PseudonymSession {
  constructor(options?: PseudonymSessionOptions)
  get entries(): PseudonymEntry[]; get size(): number; get maxTokenLength(): number
  learn(text: string): Promise<void>                      // runs recognizer
  learnSpans(sourceText: string, spans: readonly EntitySpan[]): void
  substituteText(text: string): string;  restoreText(text: string): string
  substituteInValue<T>(value: T): T;     restoreInValue<T>(value: T): T   // bounded deep walk
}
export const PII_SWAP_ENABLED_SETTING = "ELIZA_PII_SWAP_ENABLED"
export const PII_SWAP_EXEMPT_VALUES_SETTING = "ELIZA_PII_SWAP_EXEMPT_VALUES"
export const PII_SWAP_DISABLED_KINDS_SETTING = "ELIZA_PII_SWAP_DISABLED_KINDS"
export function collectPiiPromptText(params: unknown, systemPrompt?: string): string
export const DEFAULT_PSEUDONYM_BLOCKLIST // eliza, anthropic, openai, cerebras, ...
```

**Surrogates.** Realistic and deterministic per salt:
- Person: first and last name from built-in lists.
- Organisation: two-part name.
- Location: a city.
- Address: a fabricated street.
- Email: `first.last@example.com` (an RFC 2606 reserved domain).
- Phone: `(NXX) 555-01xx` (a range reserved for fiction).

The salt is a random 16 bytes per session, so sessions are unlinkable. The module guarantees bijectivity and collision checks against everything learned (`:742-939`).

**Runtime.** `BufferUtils.randomBytes` imports `node:crypto`. A browser shim to `crypto.getRandomValues` is needed.

**Gaps.**
- **No snapshot/restore API.** A session lives only in memory, so rehydrating after an app restart or a background reply is impossible without a patch.
- No typed-token or role-annotation mode.
- Matching is by surface string, so "Dana" and "Dana Whitfield" are separate entities unless both are learned.

**Tests.** None in core. Coverage is indirect through `transcript-store.test.ts`.

### 3.4 Secret-swap (reversible, opaque)

**Location.** `packages/core/src/security/secret-swap.ts` (494 lines) and `secret-swap.bench.ts`.

**API.**
```ts
export type SecretSwapSessionOptions = { knownSecrets?: Record<string,string|undefined>; exemptValues?: Iterable<string>; disabledKinds?: Iterable<string> }
export class SecretSwapSession {
  get entries(): SecretSwapEntry[]; get maxTokenLength(): number
  substituteText(text: string): string; restoreText(text: string, ...): string
  substituteInValue<T>(v: T): T; restoreInValue<T>(v: T, { failOnUnresolved? }): T
  assertNoUnresolvedPlaceholders(value: unknown): void   // throws SecretSwapUnresolvedPlaceholderError
}
export const SECRET_SWAP_ENABLED_SETTING = "ELIZA_SECRET_SWAP_ENABLED"
```

**Approach.** It combines `detectPii` (all 24 kinds) with assignment patterns from `redact.ts` (`KEY=…`, JSON credential fields, `Bearer`). Each hit is replaced with an unforgeable per-session nonce placeholder, `__ELIZA_SECRET_<nonce>_<n>__`. A short PII span qualifies at 4 characters or more; a generic secret needs 8 or more.

**Reversible?** Yes, at the execution boundary.

**Runtime.** Same Node shims as above.

**Use for Alpha.** This is the right transformation for OTPs, passwords, keys, PANs and SSNs, which per [04](04-redaction.md) should be masked rather than pseudonymised.

### 3.5 Streaming restore

**Location.** `packages/core/src/security/guarded-stream.ts`.

**API.** `new GuardedStreamScanner({ secretSession?, piiSession? })`, with `push(chunk) -> { safe, visible }` and `flush()`.

**Approach.** It holds back a tail of the stream so that no value or surrogate is split across chunk boundaries. Alpha can use it to rehydrate streamed replies (`onText`) on the phone.

### 3.6 Corpus pseudonym map and encrypted store

**`pii-pseudonym-map.ts`.**
- `CorpusPseudonymMap` with `assign({clusterId, kind, aliases, identities?, rulesetVersion})`, `substituteAliases(text)`, `assignmentsForText`, `toSnapshot()` and `assertValidSnapshot()`.
- Keyed by entity cluster (one person, all aliases, one pseudonym).
- Reversible, with snapshot support.

**`pii-pseudonym-map-store.ts`.**
- `EncryptedCachePseudonymMapStore`: AES-256-GCM under a dedicated AAD `elizaos:pii-pseudonym-map:v1`, stored in the runtime cache key `pii:pseudonym-map:v1`.
- It is structurally excluded from retrieval.
- This is the **agent-side** vault. Alpha's phone vault should copy its design (domain-separated AAD, never indexed) but use the Android Keystore for the key.

### 3.7 Corpus scrub rails (batch)

- **`pii-scrub-seam.ts`.** `scrubWithEscalation(runtime, {text, candidateSpans, rulesetVersion, ...})` runs tier-0 detection first. Only the residue escalates to `ModelType.PII_SCRUB`. With no handler registered and residue present, it throws `PiiScrubFabricationError`, so it fails closed. `assertValidScrubResult` rejects fabricated results.
- **`pii-context-pack.ts`.** Retrieval context for the scrub step.
- **`pii-scrub-markers.ts`.** Content-addressed done markers.
- **`packages/core/src/services/pii-scrub.ts`.** `PiiScrubService`, driven by the `PII_SCRUB_REQUESTED` event.
- **Cloud.** `packages/cloud/api/v1/pii-scrub/jobs`, the executor and the migrations. Patch 0036 adds tests and an inspection-scope migration.
- **Assessment.** These rails are for background scrubbing of stored memory and corpora. They are useful for scrubbing Alpha's archive and memory in the agent, not for interactive egress.

### 3.8 Audio redaction

**Core, pure TypeScript.**
- `packages/core/src/audio-redaction.ts`: `normalizeSpokenText`, `matchPiiSpansToWords`, `mergeRedactionSpans`, `buildAudioRedactionSpans(words, piiSpans, {durationMs, padMs?})`, `assertCompleteAudioRedactionPlan`, and `DEFAULT_REDACTION_PAD_MS = 250`. The 250 ms value was calibrated on faster-whisper timings.
- `packages/core/src/audio-redaction-verify.ts`: `findResidualPii`, `findMissingSentinels`, `judgeRedactedTranscript`, and `verifyAudioRedaction(transcribers, input, {piiTexts, sentinelTexts})`.
- `TranscriptWord` = `{ text, startMs, endMs, confidence? }` (`packages/core/src/transcripts.ts:21`).

**Agent, Node.**
- `packages/agent/src/services/audio-redaction-service.ts`: `AudioRedactionService.redactAndVerify(VerifiedAudioRedactionRequest)`. Inputs are `originalAudioUrl` (a local media-store URL), `durationMs`, `words`, `piiSpans`, `mode: "mute"|"bleep"`, `rulesetVersion` (default `2026-08-06.1`) and `languageHint`.
- Processing is duration-preserving. There are two lanes: a pure-TS PCM16 WAV lane, and an ffmpeg lane for desktop and server only, which is unavailable on Android.
- Verification re-transcribes with the runtime transcriber plus an optional independent OpenAI-compatible STT read from the environment.
- Sentinels check that non-PII audio survived, so silencing everything does not count as success.
- Only verified bytes are persisted (`api/audio-redaction-store.ts`).
- Fail-closed paths: an unmatched span throws, and so do a missing verifier, any verifier failure, and a residual match.

**Gaps.**
- Word timings are mandatory. Alpha's paired whisper route has none.
- PII spans are supplied by the caller; the service does no detection.
- Residual matching is normalised containment of the exact surface text. If the re-transcript renders "555-0123" as "five five five oh one two three", the residue is **missed**.
- No tests for the agent service exist in the pinned checkout.

**Transcript redaction.** `plugins/plugin-local-inference/src/services/voice/transcript-store.ts:329-470` creates redacted transcript variants:
- `transcriptPiiRecognizer(transcript, supplemental?)` composes regex, a gazetteer of the speaker roster, and an optional supplemental recognizer.
- It then pseudonymises names and type-masks tier-0 matches as `[EMAIL]`, `[SSN]` and so on.
- It is tested (`transcript-store.test.ts`).
- **This is the closest reusable recipe for Alpha's transcript path.**

### 3.9 Confidential inference and processing policy

**Location.** `packages/core/src/security/confidential-inference.ts` (435 lines; imports `node:async_hooks` and `node:crypto`, so Node only).

**API.**
- `ConfidentialInferenceAuthority({ handlers, currentProfile, audit, transport?, redispatchPolicy? })`.
- `runWithConfidentialInference(authority, {agentId, modelType, handler, operation?}, run)`.
- `fetchWithConfidentialInference(input, init, transport)`. It admits only POST requests with a string body, rejects redirects, and commits a `dispatch_intent` audit record **before** sending.

**Host bootstrap.** `packages/agent/src/runtime/confidential-host-bootstrap.ts:95` with `createAttestedInferenceFetch` and the durable `createConfidentialSQLiteAudit`.

**Tests.**
- `plugins/plugin-embeddings/__tests__/confidential-inference.test.ts`.
- `plugins/plugin-openai/__tests__/confidential-inference.real.test.ts` (real-network).
- `packages/os/scripts/__tests__/check-confidential-*.node.test.ts` (image and policy manifests).

**Processing policy (patch 0036, upstream `ab8f9a`).** `packages/core/src/security/processing-policy.ts` adds a host-installed policy. It is consulted before any secret or PII substitution for model attempts, and before action effects with declared `Action.egress`. When no policy is installed, nothing changes. When one is installed, anything it cannot evaluate is denied, and a denial is terminal.

**Where this fits.** This is the enclave hook for "refuse model attempts on turns without a valid Alpha redaction receipt at Tier ≥ 2".

### 3.10 Other redaction modules (not for egress; keep)

- `redact.ts`: `redactSecrets`, `redactSensitiveText`, `redactObjectSecrets`, `createSecretsRedactor`. Used for logs and tool output.
- `log-redaction.ts`: `redactLogValue` and `redactSensitiveLogText`. It fails closed with `[REDACTED: redaction failed]`, and its header says it is shared by Node and client sinks.
- `fragment-redaction.ts`: secret taint across stream fragments.
- `outbound-sanitize.ts`: strips reasoning and tool-call tags. This is not PII handling.
- `voice-gate.ts`: rephrases outbound literals into the agent's voice. This is **not** a privacy gate; the name is misleading.
- `plugins/plugin-personal-assistant/src/lifeops/redact-sensitive-data.ts` (tested in `test/lifeops-redact-sensitive-data.test.ts`).
- `packages/testing/scenario-runner/src/redaction.ts`.

### 3.11 Maturity summary

| Component | Code maturity | Tests in pin | Wired by default | Usable on phone as-is |
|---|---|---|---|---|
| `detectPii` | High (validators, overlap resolution) | None (indirect only) | Via secret-swap when enabled | Needs a `node:crypto` shim |
| Recognizers (regex/gazetteer/composite) | Medium; no names without a model | None | When PII swap is enabled | Yes (pure TS) |
| `LlmEntityRecognizer` | Medium | 14 cases | Only if the plugin is loaded | No (needs llama.cpp and a GGUF) |
| `PseudonymSession` | High (bijective, bounded walk) | None | Opt-in env | Needs shims; **no snapshot** |
| `SecretSwapSession` | High | Bench only | Opt-in env | Needs shims |
| `GuardedStreamScanner` | High | None | When swaps are enabled | Yes after shims |
| `CorpusPseudonymMap` and encrypted store | High | None | Scrub service | Map yes; store is agent-side |
| Audio redaction and verify | High, fail-closed | None | Service must be registered | Core math yes; render and verify Node-only; **needs word timings** |
| Confidential inference | High | Yes | Host bootstrap | Agent/enclave only |
| Processing policy (0036) | New | In 0036 | Host-installed | Agent/enclave only |

## 4. Alpha egress map (where content leaves today)

| # | Channel | Code (file:line) | Payload carrying user content | Destination and transport | Existing protection |
|---|---|---|---|---|---|
| E1 | Chat turn | `apps/app/src/runtime/connection-ui.tsx:594-625` `send()`, which builds `phoneContextMessage(text, context)` at `:596` and then calls `selected.cloud.send` / `selected.remote.send` | `text` (the user message after the observation envelope); `metadata.alphaPhone.context` | Eliza Cloud (`cloud-protocol.ts:292`), a paired or resident agent (`remote-protocol.ts:224`), or the on-device local runtime. HTTP goes through `nativeCloudRequest` (`native-connection.ts:47`), then `AlphaConnectionPlugin.request` (`AlphaConnectionPlugin.java:245`) over `HttpURLConnection` | Context is sanitised to opaque IDs (`phone-context.ts:15`); `sensitive` screens throw |
| E2 | Reviewed email context | `apps/app/src/prototype/inbox-cloud-adapter.ts:105`, `validateMailContext` (`runtime/reviewed-mail-context.ts:10-12`), then `api.sendReviewedMail(text)`, which reaches E1 | `from`, `to[]`, `subject`, `bodyText` (up to 48 kB) as prose | Same as E1 | The user reviews it; the digest is bound to the destination. No PII transform |
| E3 | Voice audio, cloud STT | `AlphaVoiceCloudPlugin.java:153-160` `transcribeRecording`, then `connect(...,"stt")` at `:88-103` (`https://<host>/api/v1/voice/stt`, multipart) | **Raw audio** | Eliza Cloud | User-initiated; HTTPS only |
| E4 | Voice audio, paired whisper | `AlphaVoiceCloudPlugin.java:129-132` `transcribePairedRecording`, then `connectPaired(..., asr=true)` at `:109-117` (`/api/asr/whisper`) | **Raw PCM** | Paired desktop agent (HTTPS, or loopback in development) | Origin validation only |
| E5 | TTS text | `AlphaVoiceCloudPlugin.java:184-187` `synthesize`/`synthesizePaired`; `:137` `synthesizeBrowserReading` | Reply text and pasted browser excerpts | Cloud or paired TTS | 5000-character cap |
| E6 | Local on-device agent to model provider | `AlphaLocalAgentPlugin.java:66-82` `configureEnvironment` (sets `CEREBRAS_API_KEY` and model) | Whole prompt, built by the on-device elizaOS runtime | Cerebras HTTPS, direct from the phone | **None.** Swap env flags are not set |
| E7 | Workflow authoring, inbox operations, reminders, notes and calendar CRUD | `runtime/phone-workflow-authoring.ts`, `inbox-operation.ts:54` (`subject`, `bodyText` drafts), `device-actions.ts` | Drafts, titles and bodies | Through E1 transports (`nativeRemoteRequest` / `nativeCloudRequest`) | Review UIs |
| E8 | Per-view context | `phone-context.ts:15-45` | View name and opaque IDs. Provider IDs such as `accountId` and `messageId` are linkable identifiers | Through E1 metadata and prose | IDs must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`, which blocks `@` and URLs |
| E9 | Browser page reading | `BrowserReading.java:20-105`; renderer `browser/reading-review.ts:5` | Excerpt pasted by the user, sent to TTS (E5) | TTS route | `sensitiveUrl` and a sensitive-text scan deny vault, OTP and login pages |

**Chokepoints.**
- **Renderer, text:** `connectionController.send` (E1, with E2 and E7 flowing into it). Workflow and inbox operation calls that bypass `send` go through `nativeRemoteRequest`/`nativeCloudRequest`, which are the second renderer chokepoint.
- **Native:** `AlphaConnectionPlugin.request` covers all renderer HTTP (E1, E2, E7). `AlphaVoiceCloudPlugin.connect` and `connectPaired` cover E3, E4 and E5.
- **No Java chokepoint for E6.** That egress happens inside the bundled agent process. Its only control is the agent's own swap flags and a future processing policy.

**Reusable Keystore material.**
- `AlphaConnectionPlugin.key()` (`:103-112`) and `AlphaCredentialStore` (`:41`, `:58-66`) use alias `alpha.connection.aes.v1`: AES-256-GCM, 12-byte IV, `AtomicFile` per slot.
- The vault should use a **separate alias**, `alpha.redaction.vault.v1`, with `setUnlockedDeviceRequired(true)`. That way a vault-key compromise does not imply a credential compromise and vice versa.

## 5. External options evaluation

| Option | What it is | Licence / size | Entities | Reported accuracy | Deployment | Reversible | Android feasibility | Role for Alpha |
|---|---|---|---|---|---|---|---|---|
| **OpenAI Privacy Filter** (released 2026-04-22) | Bidirectional token classifier, BIOES spans with constrained Viterbi; 8 transformer blocks; sparse MoE (128 experts, top-4) | Apache-2.0; 1.5B total / 50M active; 128k context ([HF card](https://huggingface.co/openai/privacy-filter)) | 8 categories: account_number, private_address, private_email, private_person, private_phone, private_url, private_date, secret | F1 96% on PII-Masking-300k, 97.43% after label correction (vendor, via [MarkTechPost](https://www.marktechpost.com/2026/04/28/openai-releases-privacy-filter-a-1-5b-parameter-open-source-pii-redaction-model-with-50m-active-parameters/), [Help Net Security](https://www.helpnetsecurity.com/2026/04/23/openai-privacy-filter-personally-identifiable-information/)). Card lists limitations: uncommon names, over-redaction of public entities, non-English | transformers, transformers.js (WebGPU/WASM) ([browser demo](https://github.com/montevive/openai-privacy-filter)), ONNX | No (detector) | ONNX q4f16 772 MB, q4 875 MB, q8 1.5 GB, fp16 2.6 GB ([HF onnx tree](https://huggingface.co/openai/privacy-filter/tree/main/onnx)). The MoE needs all experts resident, so **memory is the obstacle on phones**. Run with ORT Android CPU/XNNPACK; WebView WebGPU is device-dependent | Optional "accuracy pack" on 8–12 GB devices; **primary candidate for the enclave second pass** (CPU-feasible) |
| **GLiNER-PII** (Knowledgator/Wordcab) | Zero-shot span NER, labels given at inference | Apache-2.0; edge, small, base and large variants. Edge ONNX FP16 330 MB, UINT8 197 MB ([HF](https://huggingface.co/knowledgator/gliner-pii-edge-v1.0)) | 60+ labels (personal, contact, financial, health, documents, credentials) | Vendor F1: edge 75.5% (P 78.96 / R 72.34); base 80.99% | GLiNER Python, Rust (gline-rs), ONNX | No | **Best fit for the on-device default** (UINT8 197 MB, ORT Android). Needs a span-decoding port to Java (tokeniser plus span scoring) | Default device NER |
| **GLiNER2-PII** (Fastino, May 2026) | GLiNER2 fine-tune | 205M params ([arXiv 2605.09973](https://arxiv.org/abs/2605.09973)) | 42 PII types, multilingual | Paper reports the highest span F1 among five systems on the SPY benchmark, including OpenAI Privacy Filter | HF `fastino/gliner2-privacy-filter-PII-multi` | No | ONNX export unconfirmed | Evaluate as an alternative default |
| **urchade/gliner_multi_pii-v1** | GLiNER multi v2.1 fine-tune on synthetic data | Apache-2.0 | ~40 types; EN/FR/DE/ES/PT/IT ([HF](https://huggingface.co/urchade/gliner_multi_pii-v1)) | Not published by the author | Python | No | Same porting cost as GLiNER-PII | Baseline only |
| **NVIDIA gliner-PII** | Successor to the Gretel GLiNER PII/PHI models (bi-large) | 55+ categories ([HF discussion](https://huggingface.co/nvidia/gliner-PII/discussions/6)) | PII and PHI | Not verified | Python | No | Large for phones | Enclave or eval candidate for PHI |
| **Microsoft Presidio** | Analyzer (recognizers + NER) and Anonymizer (replace, redact, mask, hash, encrypt, keep, custom); `DeanonymizeEngine` reverses **only the `encrypt` operator** via `decrypt` (AES) ([Anonymizer docs](https://presidio.dataprivacystack.org/anonymizer/), [DeepWiki](https://deepwiki.com/microsoft/presidio/3.2.2-deanonymization)) | MIT; Python plus Docker REST images | ~30 built-in recognizers plus custom; `GLiNERRecognizer` built in (`presidio-analyzer[gliner]`) ([docs](https://presidio.dataprivacystack.org/samples/python/gliner/)); a known GLiNER long-text truncation issue ([#1569](https://github.com/data-privacy-stack/presidio/issues/1569)) | Depends on the NER plugged in | Python, Docker | Encrypt/decrypt only | **Not on the phone** (Python) | Enclave second pass if the enclave image can carry Python; otherwise the eval harness comparator |
| **Limina (formerly Private AI)** | Proprietary transformer NER in a container | Commercial; CPU container (AVX2/AVX-512/AMX) or GPU (≥16 GB VRAM, Volta+) ([requirements](https://docs.private-ai.com/installation/prerequisites-and-system-requirements)) | 50+ entity types, 52 languages; text, PDF, images, **audio** ([site](https://www.getlimina.ai/en)) | Vendor ai4privacy benchmark F1 0.938 (see [04](04-redaction.md)) | On-prem container, REST | Yes (reidentify endpoints, unverified) | No Android SDK found | Enterprise option for the enclave or customer VPC second pass; benchmark comparator |
| **Tonic Textual** | Redaction plus synthesis; tokenised (reversible) or synthesised replacements ([SDK docs](https://tonic-textual-sdk.readthedocs-hosted.com/en/latest/redact/redact_config.html)) | Commercial; free tier with $5 credits, Plus $29/month, Enterprise custom ([pricing](https://www.tonic.ai/pricing)) | Built-in plus custom-trained entity types | Not independently verified | Cloud, self-hosted Kubernetes/Docker, AWS AMI, Snowflake ([deploy](https://docs.tonic.ai/textual/textual-install-administer/deploying-a-self-hosted-instance)) | Tokenisation reversible | No | Synthetic training and test data generation; possible enclave second pass |
| **Google ML Kit Entity Extraction** | On-device annotator (beta) | Proprietary; ~5.6 MB per language model ([docs](https://developers.google.com/ml-kit/language/entity-extraction/android)) | 11 types incl. address, date-time, email, flight number, IBAN, ISBN, money, payment card, phone, tracking number, URL (per docs; the fetched page summary listed fewer) | Not published | Android SDK | No | **Native and cheap**, but beta with no SLA, and a Google Play services dependency conflicts with de-Googled AOSP builds | Optional supplemental recognizer for addresses and dates on stock Android only |
| **Gemini Nano / ML Kit GenAI Prompt API** | On-device LLM via AICore (alpha) ([Android blog](https://developer.android.com/blog/posts/ml-kit-s-prompt-api-unlock-custom-on-device-gemini-nano-experiences)) | Proprietary; supported devices only | Prompted extraction | Not published | AICore | No | Not on the AOSP image; device-gated | Not recommended as a dependency |
| **LiteRT-LM (Gemma 4 E2B)** | On-device LLM runtime ([overview](https://ai.google.dev/edge/litert-lm/overview)) | Gemma licence; ~52 tok/s decode, ~3.8k tok/s prefill on S26 Ultra GPU ([Google blog](https://developers.googleblog.com/blazing-fast-on-device-genai-with-litert-lm/)) | Prompted | Not published | Android | No | Possible host for an `LlmEntityRecognizer`-style prompt; too slow for every keystroke | Fallback recognizer for Tier 2 when no NER pack is present |
| **sherpa-onnx** | Kaldi-next ASR/TTS/VAD/punctuation over ORT ([GitHub](https://github.com/k2-fsa/sherpa-onnx)) | Apache-2.0 | No NER; offline punctuation has Java bindings; online punctuation Java API was missing in AAR 1.12.11 ([#2568](https://github.com/k2-fsa/sherpa-onnx/issues/2568)) | — | Android AAR | — | Yes | Candidate on-device ASR with **word timestamps** (transducer models emit token times); not a PII detector |
| **ITN (NeMo text processing / Sparrowhawk)** | WFST spoken-to-written normalisation ([NeMo ITN paper](https://arxiv.org/pdf/2104.05055)) | Apache-2.0; Sparrowhawk archived 2022 | Numbers, dates, money, phone | — | Python/C++ | — | No maintained Android port found | Port a small TypeScript subset (cardinals, digit sequences, "oh" for zero, "double") |
| **SpeechShield** (research) | On-device timestamped entity masking in a tiny speech model ([arXiv 2502.01649](https://arxiv.org/abs/2502.01649)) | Research | Entities | Filters ~83% of private entities on-device at <100 MB | Research code | — | Shows feasibility; recall too low to be the only gate | Reference design |

**Datasets and benchmarks for evaluation.**
- ai4privacy `pii-masking-400k`: 406,896 rows, 17 classes, 6 languages ([HF](https://huggingface.co/datasets/ai4privacy/pii-masking-400k)).
- `open-pii-masking-500k`: 580,227 rows, 20 classes, 8 languages ([HF](https://huggingface.co/datasets/ai4privacy/open-pii-masking-500k-ai4privacy)).
- LLM-Redactor: 8 techniques compared. Local routing plus redaction plus rephrasing reached 0.6% combined PII leak with 0 exact leaks over 500 samples, and the paper documents placeholder leakage and adversarial-obfuscation evasion ([arXiv 2604.12064](https://arxiv.org/abs/2604.12064)).
- RedactionBench: 200 documents, 11 domains, the character-level R-Score metric, and human agreement of only 47.7% on contextual redactions ([arXiv 2606.18782](https://arxiv.org/abs/2606.18782)).
- SLUE-NER for spoken NER ([HF](https://huggingface.co/datasets/asapp/slue)).
- None of these is a spoken-meeting PII set, so Alpha must build its own (Section 12.1).

**Word timings.**
- Whisper's word timestamps come from cross-attention DTW. That is an approximation that can differ by 100–400 ms between model builds ([vLLM PR](https://github.com/vllm-project/vllm/pull/47664), [whisper.cpp #2307](https://github.com/ggml-org/whisper.cpp/discussions/2307)).
- Upstream's 250 ms padding matches this range.
- CrisperWhisper reports more accurate verbatim timestamps ([arXiv 2408.16589](https://arxiv.org/pdf/2408.16589)).

## 6. Architecture

### 6.1 Where detection runs: options and decision

| Option | Pros | Cons |
|---|---|---|
| **A. Renderer JS only** | Reuses upstream TypeScript directly (detectors, sessions, streaming restore); one language; testable in Node and Playwright | A compromised or buggy WebView can bypass it; NER in WASM or WebGPU in the WebView is slow and memory-capped; it cannot see native audio routes |
| **B. Native Java/Kotlin only** | Enforced below the WebView; ORT Android with NNAPI/QNN; covers audio routes | Must re-implement upstream detectors in Java, so rules drift between phone and agent; rehydrating renderer-visible text means round-trips anyway |
| **C. Hybrid (recommended)** | Detection and transformation in the renderer with upstream code; **NER inference native** behind a `PiiEntityRecognizer` adapter; **enforcement native**, where Java refuses any egress without a matching receipt and re-runs a tier-0 floor; the vault key is in the Keystore | Two layers to keep in sync, mitigated by generating the Java floor's patterns from upstream `PII_DETECTORS` at build time and by golden cross-tests |

**Decision: C.** The renderer owns transformation because it owns the text and can show the user the redaction preview. Java owns enforcement because it owns the sockets. The agent runs a second pass inside its own runtime (E6, and the enclave), because it sees context the phone never does (memory, tool outputs).

### 6.2 Data flow

```
 user text / mail / transcript / page excerpt
            │
            ▼
 ┌──────────────────────── Renderer (apps/app/src) ─────────────────────────┐
 │ EgressGate.prepare(channel, destination, payload, tier)                  │
 │   1 policy lookup (tier x channel x destination)                         │
 │   2 spoken-form normaliser (voice only) -> offset map                    │
 │   3 tier-0: detectPii (upstream)       ─┐                                │
 │   4 gazetteer: contacts/roster (upstream GazetteerEntityRecognizer)      │
 │   5 NER: NativePiiRecognizer ─────────────► AlphaPrivacy.recognize (ORT) │
 │   6 CompositeEntityRecognizer (upstream) │                               │
 │   7 SecretSwapSession.substitute* (secrets/PAN/SSN/OTP -> opaque)        │
 │   8 PseudonymSession.learnSpans + substitute* (names/orgs/places/email…)  │
 │   9 residual check: detectPii(out) must be empty of non-surrogate hits   │
 │  10 receipt (value-free) -> AlphaPrivacy.registerReceipt(sha256(body))    │
 └───────────────┬───────────────────────────────────────────────────────────┘
                 │ body + X-Alpha-Redaction-Receipt
                 ▼
 ┌────────── Java (AlphaConnectionPlugin.request / AlphaVoiceCloudPlugin) ───┐
 │ EgressGuard.admit(): receipt exists, digest matches body, tier allows     │
 │ route, Java tier-0 floor finds nothing, else REJECT (fail closed)         │
 └───────────────┬───────────────────────────────────────────────────────────┘
                 ▼
   agent (local runtime / paired / Eliza Cloud / enclave)
   second pass: ELIZA_SECRET_SWAP_ENABLED + ELIZA_PII_SWAP_ENABLED,
   PII_ENTITY_RECOGNIZER_SERVICE, ConfidentialInferenceAuthority audit,
   ProcessingPolicy (0036) requiring a valid receipt at Tier >= 2
                 │ reply with surrogates
                 ▼
 Renderer: GuardedStreamScanner(visible) -> rehydrated text to UI;
           ActionProposal.description rehydrated before review;
           approved device actions executed with real values on device.
```

### 6.3 Agent-side second pass (local runtime and enclave)

**On-device local runtime (E6).** Alpha owns `AlphaLocalAgentPlugin.configureEnvironment` (`android/.../AlphaLocalAgentPlugin.java:66`), so it can set the flags without touching upstream:
```java
env.put("ELIZA_SECRET_SWAP_ENABLED", "true");
env.put("ELIZA_PII_SWAP_ENABLED", "true");
// Pseudonym layer owns email/phone only when secret swap is off; keep defaults.
env.put("ELIZA_PII_SWAP_DISABLED_KINDS", "");          // policy-supplied
env.put("ELIZA_PII_SWAP_EXEMPT_VALUES", "Alpha Phone");  // product identity
```
Without a recognizer service this is regex-only: addresses plus everything secret-swap catches. That is still a strict improvement on today's raw prompts to Cerebras. It is the cheapest first deliverable (WP1).

**Enclave / Eliza Cloud agent.**
- Enable the same two flags.
- Register a `PII_ENTITY_RECOGNIZER_SERVICE` backed by OpenAI Privacy Filter or GLiNER-PII under onnxruntime-node. This needs a small upstream plugin (patch or upstream PR), because `plugin-local-inference` is llama.cpp-only.
- Keep `ConfidentialInferenceAuthority`.
- Install a `ProcessingPolicy` (available after 0036 lands in the agent build) that denies `model_attempt` for an Alpha Tier ≥ 2 room unless the inbound message metadata carries a valid receipt.
- Add a **redaction summary** to the audit trail (Section 11), because `ConfidentialInferenceAuditRecord` has no field for it.

**Double pseudonymisation is safe.** The agent may learn the phone's surrogates as "names" and swap them again. Restore runs in reverse order: the agent restores to phone surrogates, and the phone restores to real values. The blocklist does not need phone surrogates. A test must cover this composition (T-12).

## 7. Egress gate API contract

### 7.1 TypeScript (renderer, `apps/app/src/runtime/egress-gate.ts`, new)

```ts
import type { EntitySpan, PiiEntityRecognizer } from '@elizaos/core/privacy'; // new subpath (patch P1)

export type EgressChannel =
  | 'chat' | 'mail-context' | 'voice-transcript' | 'voice-audio'
  | 'tts-text' | 'browser-excerpt' | 'workflow-authoring' | 'inbox-operation' | 'view-context';

export type PolicyTier = 'T0-open' | 'T1-standard' | 'T2-confidential' | 'T3-local-only';

export interface EgressDestination {
  kind: 'local-runtime' | 'paired-host' | 'eliza-cloud' | 'confidential-enclave';
  origin: string;                  // canonical, verified by the connection layer
  agentId?: string;
  conversationId?: string;
  attestation?: { evidenceDigest: string; policyRevision: string; verifiedAt: number };
}

export type EgressPayload =
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: unknown }                    // all string leaves are scanned
  | { kind: 'audio'; recordingId: string; durationMs: number };

/** A span the user explicitly chose to release unredacted, after preview. */
export interface SpanRelease { kind: string; valueDigest: string; reason: 'user-release' }

export interface EgressRequest {
  requestId: string;              // equals the native request id
  channel: EgressChannel;
  destination: EgressDestination;
  payload: EgressPayload;
  releases?: readonly SpanRelease[];
  signal: AbortSignal;
}

export type EgressDecision =
  | { status: 'allow' | 'transformed'; payload: EgressPayload; vaultHandle: string; receipt: RedactionReceipt }
  | { status: 'blocked'; reason: BlockReason; receipt: RedactionReceipt };

export type BlockReason =
  | 'tier-forbids-channel'            // e.g. T2 + voice-audio
  | 'tier-forbids-destination'        // e.g. T2 + unattested cloud
  | 'recognizer-unavailable'          // NER required by tier but not loaded
  | 'residual-detected'               // post-transform tier-0 still matches
  | 'unbounded-payload'               // upstream PII_PSEUDONYM_UNBOUNDED / SECRET_SWAP_UNBOUNDED
  | 'sensitive-surface';              // ViewContext.sensitive or BrowserReading deny

export interface EgressGate {
  /** Pure with respect to the network; never sends. Fail-closed on any throw. */
  prepare(request: EgressRequest): Promise<EgressDecision>;
  /** Rehydrate model output for display. Unknown surrogates pass through untouched. */
  rehydrateText(vaultHandle: string, text: string): string;
  rehydrateValue<T>(vaultHandle: string, value: T): T;
  /** Streaming variant backed by upstream GuardedStreamScanner. */
  openStream(vaultHandle: string): { push(chunk: string): string; flush(): string };
  /** Bind the receipt to the transport outcome (sent | failed | cancelled | unknown). */
  settle(receiptId: string, outcome: 'sent' | 'failed' | 'cancelled' | 'unknown'): Promise<void>;
}

/** Native NER adapter, implementing the upstream interface. */
export class NativePiiRecognizer implements PiiEntityRecognizer {
  readonly name = 'alpha-native-ner';
  constructor(private readonly plugin: AlphaPrivacyPlugin, private readonly labels: readonly string[]) {}
  async recognize(text: string): Promise<EntitySpan[]> {
    const { spans } = await this.plugin.recognize({ text, labels: [...this.labels] });
    return spans.map(s => ({ kind: s.kind, value: text.slice(s.start, s.end), start: s.start, end: s.end, score: s.score }));
  }
}
```

**Integration points.**
- **E1/E2/E7.** In `connection-ui.tsx` `send()` after `phoneContextMessage` (`:596`):
  1. `const d = await gate.prepare({channel, destination, payload:{kind:'text', text: message.text}, ...})`.
  2. If `d.status === 'blocked'`, throw a user-visible error carrying `d.reason`.
  3. Send `d.payload.text` with header `X-Alpha-Redaction-Receipt: d.receipt.receiptId`.
  4. Wrap `onText` with `gate.openStream(d.vaultHandle)`.
  5. Rehydrate the final `reply.text` and every `proposal.description`.

  The observation envelope itself is constant text plus opaque IDs, and is exempted by construction: the gate scans only the user section after `[USER MESSAGE]`. The JSON observation is checked separately through the `view-context` channel.
- **`nativeRemoteRequest` / `nativeCloudRequest`.** Accept an optional `receiptId`. Calls without one are allowed only for an allowlist of **content-free** routes (auth, status, list conversations, jobs). Java enforces this list (7.2).
- **Voice (E3/E4).** `prototype/voice-adapter.ts:210`. Before choosing a cloud or paired route, call `gate.prepare({channel:'voice-audio', payload:{kind:'audio',...}})`. At T2 and above this blocks, and the UI offers only the on-device route. The resulting transcript then passes through `voice-transcript` before it enters chat.

### 7.2 Java (native enforcement)

```java
package ai.elizaresearch.alphaphone.privacy;

public enum EgressChannel { CHAT, MAIL_CONTEXT, VOICE_TRANSCRIPT, VOICE_AUDIO, TTS_TEXT,
                            BROWSER_EXCERPT, WORKFLOW_AUTHORING, INBOX_OPERATION, VIEW_CONTEXT, CONTENT_FREE }

/** Registered by the renderer after prepare(); value-free. */
public final class ReceiptBinding {
  public final String receiptId, requestId, policyTier, channel, destinationOrigin;
  public final byte[] bodySha256;        // exact bytes Java will send
  public final long expiresAtMs;         // short TTL, e.g. 60 s
}

public interface EgressGuard {
  /** Called by the renderer via AlphaPrivacy.registerReceipt before the request. */
  void register(ReceiptBinding binding) throws EgressDeniedException;

  /**
   * Called inside AlphaConnectionPlugin.request and AlphaVoiceCloudPlugin.connect/connectPaired
   * immediately before connection.getOutputStream(). Fail closed: any exception => no bytes sent.
   */
  void admit(String requestId, java.net.URI destination, String route, byte[] body) throws EgressDeniedException;
}

final class DefaultEgressGuard implements EgressGuard {
  // 1. route classification: CONTENT_FREE allowlist (e.g. /api/auth/*, GET status) needs no receipt.
  // 2. otherwise: binding must exist, be unexpired, match requestId, origin and sha256(body).
  // 3. tier rules: T2+ forbids VOICE_AUDIO routes (/api/v1/voice/stt, /api/asr/whisper) entirely;
  //    T3 forbids every non-content-free route.
  // 4. Tier0Floor.scan(body): Luhn PAN, SSN, JWT, PEM/PGP, AWS/GitHub/OpenAI/Stripe/Slack keys,
  //    BIP-39 runs. Patterns generated at build time from upstream PII_DETECTORS (script, see WP3).
  //    Any hit => EgressDeniedException("residual-detected").
  // 5. consume the binding (single use) and append a native audit line (hashes only).
}
```

`AlphaPrivacyPlugin` (new Capacitor plugin) methods:
- `recognize({text, labels}) -> {spans:[{kind,start,end,score}]}`. ORT session, single thread pool, 512-token windows with 64-token overlap.
- `registerReceipt(binding)`.
- `vaultOpen({vaultId}) / vaultPut({vaultId, entriesCiphertext}) / vaultGet / vaultDestroy`. Key alias `alpha.redaction.vault.v1`.
- `signReceipt({receiptJson}) -> {signature, keyId}`. EC P-256 key `alpha.redaction.receipt.v1`, non-exportable, StrongBox if available.

## 8. Vault and rehydration design

**Contents.** For each vault (one per conversation, which matches the upstream "per-session unlinkable" default):
- The `PseudonymSession` salt and entries.
- The `SecretSwapSession` nonce and entries.
- The policy tier and creation time.
- The TTL.

**Upstream gap.** `PseudonymSession` has no export/import. Surrogate minting is deterministic given salt, kind, value, attempt and corpus state, but replaying `learnSpans` does not guarantee the same surrogates after collision re-mints. **Patch P2** adds:
```ts
// packages/core/src/security/pii-pseudonymizer.ts (patch)
export interface PseudonymSessionSnapshot { v: 1; salt: string; entries: PseudonymEntry[]; corpusDigest: string }
toSnapshot(): PseudonymSessionSnapshot
static fromSnapshot(s: PseudonymSessionSnapshot, options?: Omit<PseudonymSessionOptions,'salt'>): PseudonymSession
// same for SecretSwapSession (nonce + entries)
```
Until P2 lands, Alpha can keep vaults **memory-only**. Replies that arrive after a process death then show surrogates with a "names hidden; reopen conversation to restore" banner. That is acceptable for T1, and the fail-safe direction (showing surrogates) is not a leak.

**Encryption at rest.**
- AES-256-GCM, key `alpha.redaction.vault.v1` in AndroidKeyStore.
- Key parameters: `PURPOSE_ENCRYPT|DECRYPT`, `BLOCK_MODE_GCM`, `setKeySize(256)`, `setUnlockedDeviceRequired(true)` (API 28+), `setIsStrongBoxBacked(true)` with fallback, and no user-auth-per-use (rehydration happens while streaming) ([Android Keystore](https://developer.android.com/privacy-and-security/keystore), [KeyProtection](https://developer.android.com/reference/android/security/keystore/KeyProtection)).
- AAD = `"alpha:redaction-vault:v1|" + vaultId`, domain-separated from credential slots, mirroring upstream `PII_PSEUDONYM_MAP_AAD`.
- Storage: `AtomicFile` under `noBackupFilesDir/redaction-vault/`. The vault must be excluded from Auto Backup and from device-transfer rules.

**Lifecycle.**
- Default TTL: 30 days at T1, 7 days at T2, plus explicit "forget conversation".
- Crypto-erase deletes the file. Deleting the Keystore key erases every vault.
- Under GDPR the data stays pseudonymous **while the vault exists** (see [04](04-redaction.md) §B).

**Rehydration rules.**
1. Display: `restoreText` and streaming through `GuardedStreamScanner`.
2. Action proposals: rehydrate `description` before review, so the user approves real values. Then:
   - **Device-executed** actions run with rehydrated arguments on the phone.
   - **Agent-executed** actions with external egress (for example, cloud Gmail send) would act on surrogates. Policy: at T1 the proposal is shown with a warning, and the phone sends a rehydrated, user-approved argument set in the `execute` call, recorded on the receipt. At T2 such actions require device execution or are refused.
3. Never rehydrate into logs, notifications (lock-screen previews stay pseudonymous) or the action journal. Store pseudonymised text in conversation history and keep the vault separate.

## 9. Policy tiers

| | T0 Open (developer/personal) | T1 Standard (default) | T2 Confidential (regulated pilot) | T3 Local-only |
|---|---|---|---|---|
| Secrets, OTP, passwords, PAN, SSN, IBAN | Secret-swap (opaque) | Secret-swap | Secret-swap | Nothing leaves |
| Email, phone | Allow | Pseudonymise | Pseudonymise | — |
| Person, org, location | Allow | Pseudonymise **if NER is available**; otherwise gazetteer only, plus a banner | Pseudonymise; **NER required** (else `recognizer-unavailable` block) | — |
| Dates, money, numbers | Allow | Allow | Generalise (bucket), with exact arithmetic done locally on rehydration; optional | — |
| Admin gazetteer (clients, deal code names, restricted list) | — | Optional | Required (MDM-delivered, Keystore-encrypted) | — |
| Raw audio egress (E3/E4) | Allowed | Paired owned host only | **Forbidden**; on-device ASR only | Forbidden |
| Destinations | Any | Any verified connection | Attested enclave (`destination.attestation` present and fresh) or the local runtime with agent swaps on | Local runtime only |
| User release of a span | Yes | Yes (recorded) | Admin-configurable | — |
| Agent second pass required | No | Recommended | Required (receipt checked by ProcessingPolicy) | n/a |
| Receipts | Local, summary only | Local, signed | Signed, exportable to the firm archive | Manifests only |

The tier is a product policy supplied by Alpha to upstream primitives, per ADR-02. It lives in `apps/app/src/runtime/redaction-policy.ts`, and is mirrored by Java constants and checked by the receipt digest.

## 10. Channel-specific designs

### 10.1 Per-view context (E8)

- Keep `sanitizePhoneContext`. Its opaque-ID regex already blocks emails, URLs and prose.
- **Add at T2:** destination-scoped tokenisation of provider IDs (`accountId`, `messageId`, `eventId`). Compute `HMAC-SHA256(vaultKey, destinationOrigin|kind|id)`, truncate it to 22 base64url characters, and store the handle-to-real-ID map in the vault.
  - Device-executed actions map handles back on the phone.
  - Cloud-executed Google actions need real IDs, so at T2 those calls rehydrate in `execute` only after user approval, and the receipt records it.
- The observation JSON goes through the gate as channel `view-context`. Tier-0 must find nothing, which it cannot by construction. This is a regression tripwire.

### 10.2 Voice transcripts (E3/E4 and on-device ASR)

Pipeline for `voice-transcript`:

1. **ASR choice by tier.** At T2+, only `transcribeLocalRecording` (on-device) is allowed. Record whether word timings exist.
2. **Spoken-form normaliser (new, Alpha-side; candidate for upstream).** Produce `written` from `spoken` with an offset map back to `spoken`:
   - Number words become digits: "four one five", "oh" as zero, "double five", "triple", "hundred", teens and tens.
   - "at" and "dot" become `@` and `.` inside email-shaped runs.
   - Spelled letter runs collapse ("S M I T H" becomes SMITH).
   - Ordinal dates are handled.

   Run `detectPii` on **both** forms and map spans back through the offset map. This mirrors dual-form ITN ([arXiv 2609.02901](https://arxiv.org/pdf/2609.02901)) and the NeMo/Sparrowhawk tagger-then-verbaliser design.
3. **Long digit-run rule.** Any run of 7 or more spoken digits within a 6-second window that no detector has classified becomes `NUMERIC_SEQUENCE` and is masked at T1+. This catches phone numbers or account numbers that ASR splits, which separator-bound regexes miss.
4. **Confidence widening.** If a word adjacent to a detected span has `confidence < 0.6`, extend the span by one word on that side. Without confidences (paired whisper), pad by one word at T2. This is an n-best proxy. Real lattice or n-best access is not available from the current routes. If sherpa-onnx becomes the on-device ASR, its transducer n-best can be consumed later ([N-best SLU](https://arxiv.org/pdf/2001.05284)).
5. **Roster gazetteer.** Calendar attendees, contacts and meeting title names go into `GazetteerEntityRecognizer`, as upstream `transcriptPiiRecognizer` does.
6. Then NER, then secret-swap and pseudonymisation, as for chat.
7. **Audio artefacts.** If a redacted **audio** copy is needed (for sharing or archive, never for model egress), call upstream `AudioRedactionService.redactAndVerify` in the local runtime or paired host with timed words. Map the residual check through the same spoken-form normaliser. That requires patch P4, because upstream `findResidualPii` compares only normalised surface text.

### 10.3 Browser page context (E9 and future "share page with agent")

- Keep `BrowserReading.sensitiveUrl` and the sensitive-text denial. A deny becomes `blocked: sensitive-surface` with a receipt.
- Strip query strings and fragments from any URL sent as context. Today only the origin is shown, which is good. A future share-page feature must send origin plus path only.
- Excerpts go through channel `browser-excerpt`: tier-0, gazetteer, NER and secret-swap. Do not pseudonymise public entities, because the excerpt is public text. At T1 apply secret-swap and tier-0 only (the Privacy Filter card warns about over-redaction of public entities). At T2 pseudonymise **only** entities that also appear in the user's contacts or the admin gazetteer.
- TTS of excerpts (E5) at T2 must use a device-local voice. The renderer already says "Speech uses a device-local browser voice" for pasted excerpts (`reading-review.ts:15`). Enforce it in Java by refusing `synthesizeBrowserReading` to remote routes at T2.

### 10.4 Reviewed email context (E2)

This is the highest-volume PII payload.
- `from` and `to` addresses become email surrogates.
- Display names become person surrogates.
- `bodyText` goes through the full pipeline.
- Signatures (phone, address) are covered by tier-0 and the regex address recogniser.

The review sheet should show the **redacted** text that will be sent, with per-span release toggles. Today it shows the original.

## 11. Audit receipt / redaction manifest

Receipts are value-free, so they can be retained and shown to users, compliance officers and archives:
- Hashes are keyed HMACs, using a per-device key `alpha.redaction.hmac.v1` stored as a Keystore-wrapped secret. That prevents dictionary attacks on short values such as SSNs.
- Counts are per kind.
- Receipts are hash-chained and signed with a non-exportable Keystore EC key.

### 11.1 JSON Schema (2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://alphaphone.invalid/schemas/redaction-receipt.v1.json",
  "title": "Alpha Phone redaction receipt v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema","receiptId","requestId","createdAt","channel","destination","policy","detectors","input","output","entities","decision","chain","signature"],
  "properties": {
    "schema": { "const": "alpha.redaction-receipt.v1" },
    "receiptId": { "type": "string", "format": "uuid" },
    "requestId": { "type": "string", "maxLength": 256 },
    "createdAt": { "type": "string", "format": "date-time" },
    "settledAt": { "type": ["string","null"], "format": "date-time" },
    "outcome": { "enum": ["sent","failed","cancelled","unknown","not-sent"] },
    "device": {
      "type": "object", "additionalProperties": false,
      "required": ["installationDigest","appVersion","distribution"],
      "properties": {
        "installationDigest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "appVersion": { "type": "string" },
        "distribution": { "enum": ["standalone","launcher"] }
      }
    },
    "channel": { "enum": ["chat","mail-context","voice-transcript","voice-audio","tts-text","browser-excerpt","workflow-authoring","inbox-operation","view-context"] },
    "destination": {
      "type": "object", "additionalProperties": false,
      "required": ["kind","origin"],
      "properties": {
        "kind": { "enum": ["local-runtime","paired-host","eliza-cloud","confidential-enclave"] },
        "origin": { "type": "string", "maxLength": 512 },
        "agentIdDigest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "attestation": {
          "type": "object", "additionalProperties": false,
          "required": ["evidenceDigest","policyRevision","verifiedAt"],
          "properties": {
            "evidenceDigest": { "type": "string" },
            "policyRevision": { "type": "string" },
            "verifiedAt": { "type": "string", "format": "date-time" }
          }
        }
      }
    },
    "policy": {
      "type": "object", "additionalProperties": false,
      "required": ["tier","policyId","policyVersion"],
      "properties": {
        "tier": { "enum": ["T0-open","T1-standard","T2-confidential","T3-local-only"] },
        "policyId": { "type": "string" },
        "policyVersion": { "type": "string" },
        "gazetteerDigest": { "type": ["string","null"] }
      }
    },
    "detectors": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["id","version","status"],
        "properties": {
          "id": { "type": "string", "examples": ["upstream.detectPii","upstream.regex-recognizer","gazetteer.contacts","native.gliner-pii-edge","spoken-normalizer"] },
          "version": { "type": "string" },
          "modelSha256": { "type": ["string","null"], "pattern": "^[a-f0-9]{64}$" },
          "status": { "enum": ["ran","unavailable","failed","skipped-by-policy"] },
          "latencyMs": { "type": "number", "minimum": 0 }
        }
      }
    },
    "input": {
      "type": "object", "additionalProperties": false,
      "required": ["hmac","chars"],
      "properties": {
        "hmac": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "chars": { "type": "integer", "minimum": 0 },
        "audioDurationMs": { "type": ["integer","null"] },
        "wordTimings": { "type": ["boolean","null"] }
      }
    },
    "output": {
      "type": "object", "additionalProperties": false,
      "required": ["sha256","chars"],
      "properties": {
        "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "chars": { "type": "integer", "minimum": 0 }
      }
    },
    "entities": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["kind","action","count"],
        "properties": {
          "kind": { "type": "string" },
          "action": { "enum": ["secret-swap","pseudonymize","generalize","mask","tokenize-id","released-by-user","allowed-by-policy","blocked"] },
          "count": { "type": "integer", "minimum": 0 },
          "detectors": { "type": "array", "items": { "type": "string" } },
          "minScore": { "type": ["number","null"] }
        }
      }
    },
    "releases": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["kind","valueHmac","by"],
        "properties": {
          "kind": { "type": "string" },
          "valueHmac": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "by": { "enum": ["user","admin-policy"] }
        }
      }
    },
    "residualCheck": {
      "type": "object", "additionalProperties": false,
      "required": ["renderer","native"],
      "properties": {
        "renderer": { "enum": ["clean","residual-blocked","not-run"] },
        "native": { "enum": ["clean","residual-blocked","not-run"] }
      }
    },
    "decision": { "enum": ["allow","transformed","blocked"] },
    "blockReason": { "type": ["string","null"] },
    "upstream": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "confidentialAttemptIds": { "type": "array", "items": { "type": "string" } },
        "agentSecondPass": { "enum": ["confirmed","claimed","unknown"] }
      }
    },
    "chain": {
      "type": "object", "additionalProperties": false,
      "required": ["prevReceiptSha256","receiptSha256"],
      "properties": {
        "prevReceiptSha256": { "type": ["string","null"], "pattern": "^[a-f0-9]{64}$" },
        "receiptSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
      }
    },
    "signature": {
      "type": "object", "additionalProperties": false,
      "required": ["alg","keyId","value"],
      "properties": {
        "alg": { "const": "ES256" },
        "keyId": { "type": "string" },
        "value": { "type": "string" },
        "attestationChainDigest": { "type": ["string","null"] }
      }
    }
  }
}
```

**Rules.**
- `receiptSha256` is computed over the canonical JSON (RFC 8785 JCS) with `signature` and `chain.receiptSha256` removed.
- The user-facing view renders kind counts ("3 names, 1 phone number, 1 account number hidden"), the destination, the tier and any releases.
- Receipts are archived through Alpha's existing export paths.
- The agent can echo `receiptId` into upstream audit as a pipeline-hook annotation. That requires patch P3, because `ConfidentialInferenceAuditRecord` has no free field.

## 12. Evaluation harness and test plan

### 12.1 Spoken-meeting evaluation set

**Composition.**
- 60 scripted role-play meetings, 8–15 minutes each: wealth management (RIA), legal intake, M&A deal call, clinical intake, and personal/family.
- 4 speakers each, mixed accents.
- Recorded on Alpha's target devices in a quiet room and a noisy café.
- Plus TTS renders of 2,000 ai4privacy 400k/500k rows ([HF](https://huggingface.co/datasets/ai4privacy/pii-masking-400k)), re-transcribed through Alpha's actual ASR routes to create ASR-noise variants.

**Planted entities.** Names, including uncommon and non-English ones; employer and client names; account, routing, IBAN and card numbers **spoken digit by digit and in groups**; SSNs; DOBs; addresses; emails spelled out ("j dot smith at gmail dot com"); OTPs; passwords spoken aloud; MNPI phrases from a synthetic restricted list; deal code names.

**Labelling.** Double-annotated gold spans **on each ASR output**, not only on the script, because the gate sees ASR output. Adjudicate disagreements, and record agreement (RedactionBench shows contextual agreement can be as low as 47.7%).

**Storage.** Repo-external, encrypted. Only synthetic identities, with no real people.

### 12.2 Metrics

| Metric | Definition | T1 target | T2 target |
|---|---|---|---|
| Exact leak rate | Share of gold PII values whose normalised form (digits/letters only, plus spoken-form normalised) appears in **any captured egress byte** | ≤ 0.5% | **0** for Tier-1 identifiers (SSN, account, card, OTP, password); ≤ 0.2% overall |
| Partial leak rate | Gold value of 8+ characters with any ≥ 4-digit or ≥ 6-letter contiguous fragment in egress | ≤ 2% | ≤ 0.5% |
| Worst-class recall | Minimum span recall across classes | ≥ 0.90 | ≥ 0.97 |
| Implicit re-identification | An LLM judge given the egress transcript plus public context guesses the real person or company (top-3) | Report | ≤ 5% |
| Over-redaction | Share of flagged spans not in gold | ≤ 15% | ≤ 10% |
| Task utility retention | Summary and action-item quality on redacted vs. raw input, judged against references | ≥ 90% | ≥ 85% |
| Rehydration exactness | Share of model outputs where `restore(substitute(x))` round-trips the referenced entities | 100% | 100% |
| Latency | Gate p50/p95 for a 300-word chat turn and a 10-minute transcript on the reference device | p95 ≤ 250 ms (chat) | p95 ≤ 2 s per minute of audio |

Leaks are measured on **captured wire bytes** from a mock server, not on the gate's own output, so serialisation bugs count.

### 12.3 Test plan, with evidence level

| ID | Test | Level | Where |
|---|---|---|---|
| T-1 | Upstream detector golden tests ported (Luhn, SSN, IBAN, WIF, BIP-39, phone shapes) run against the **browser build** of the subpath | Unit (Node) | `test/redaction-detectors.test.mjs` |
| T-2 | Gate property tests: `restore(substitute(x)) == x` for random corpora; idempotence; no real learned value in output | Unit | `test/egress-gate.test.mjs` |
| T-3 | Spoken-form normaliser fixtures ("oh", "double", spelled emails, grouped digits) with offset-map correctness | Unit | `test/spoken-normalizer.test.mjs` |
| T-4 | Streaming rehydration with surrogates split across chunks (upstream `GuardedStreamScanner`) | Unit | same |
| T-5 | Policy matrix: every tier × channel × destination gives the expected allow, transform or block reason | Unit | `test/redaction-policy.test.mjs` |
| T-6 | Renderer end-to-end: send a message with canary PII through the browser dev transport; the mock server asserts no canaries in bodies or headers; the UI shows rehydrated text | Browser (Playwright) | `test/browser/redaction-egress.spec.ts` |
| T-7 | Java `EgressGuard`: missing receipt, digest mismatch, expired binding, residual PAN and T2 audio route are all refused **before** `getOutputStream()` | JVM unit plus instrumented | `android/app/src/test/...`, `androidTest/EgressGuardInstrumentedTest.java` |
| T-8 | Bypass attempt: call `AlphaConnection.request` directly from the WebView console with a raw PII body; it must be rejected | Emulator instrumented | `androidTest` |
| T-9 | Native NER: ORT model loads, span offsets map correctly, memory stays within budget, cold and warm latency | Physical device (state the model) | `scripts/android-redaction-ner-smoke.mjs` |
| T-10 | Voice: on-device ASR, then transcript gate, then chat; at T2, paired and cloud routes are disabled in the UI and refused natively | Emulator + physical | `scripts/android-redaction-voice-smoke.mjs` |
| T-11 | Local runtime second pass: with `ELIZA_*_SWAP_ENABLED`, a mock Cerebras endpoint (debug build, loopback) receives no canaries that bypassed the phone gate (for example, via memory or tool output) | Emulator, local agent | `scripts/android-local-agent-swap-smoke.mjs` |
| T-12 | Double-pseudonymisation composition: phone surrogates go through agent swap and back, giving exact rehydration | Unit (Node, upstream runtime from `vendor/eliza`, no edit) | `backend/test-runtime.ts` style harness |
| T-13 | Receipt schema validation, chain continuity, signature verification, no raw value in any receipt (grep canaries) | Unit + instrumented | `test/redaction-receipt.test.mjs` |
| T-14 | Evaluation run on the spoken-meeting set; publish the report with metric definitions | Offline eval | `scripts/redaction-eval/` |
| T-15 | Both distribution variants (standalone, launcher) built and smoke-tested | APK build + emulator | `npm run verify`, `npm run android:build` |

## 13. Reuse vs. patch

| Need | Reuse upstream as-is | Needs patch in `patches/eliza` (historical; the series was retired in `34b3c82a` and upstream changes now arrive through a reviewed pin move in `upstream.lock.json`) (or upstream PR) | Alpha-owned (no upstream change) |
|---|---|---|---|
| Tier-0 detection | `detectPii`, `PII_DETECTORS` | **P1**: browser-safe subpath `@elizaos/core/privacy` re-exporting `pii-detectors`, `entity-recognizer`, `pii-pseudonymizer`, `secret-swap`, `guarded-stream` and `audio-redaction` (math only), with `crypto-compat` and `buffer` resolved to WebCrypto and `Uint8Array` | Build-time generator for the Java floor patterns |
| Name/org/place detection | `PiiEntityRecognizer`, `CompositeEntityRecognizer`, `GazetteerEntityRecognizer`, `canonicalKind` | **P5**: `plugin-pii-onnx` recogniser service for Node (enclave), registering `PII_ENTITY_RECOGNIZER_SERVICE` with OpenAI Privacy Filter or GLiNER-PII | `NativePiiRecognizer` and the `AlphaPrivacy` ORT plugin |
| Reversible transforms | `PseudonymSession`, `SecretSwapSession`, `GuardedStreamScanner` | **P2**: `toSnapshot/fromSnapshot` on both sessions. **P6** (optional): `surrogateStyle: 'realistic' \| 'typed'` plus role annotation hook | Vault (Keystore), TTL, crypto-erase |
| Agent second pass | Dispatcher swap wiring, env settings | — | Env flags in `AlphaLocalAgentPlugin.configureEnvironment`; cloud/enclave config |
| Admission and audit | `ConfidentialInferenceAuthority`, SQLite audit; `processing-policy.ts` via 0036 | **P3**: an optional `annotations` field (e.g. `alphaRedactionReceiptId`, value-free) on `ConfidentialInferenceAuditRecord`, or a sibling `RedactionAuditRecord` sink | Receipt format, signing, archive |
| Audio redaction | `buildAudioRedactionSpans`, `verifyAudioRedaction`, `AudioRedactionService` | **P4**: spoken-form-aware residual matching (an injectable normaliser in `findResidualPii`) | Word timings from on-device ASR |
| Transcript redaction recipe | `transcriptPiiRecognizer` pattern (plugin-local-inference) | — | Port the recipe to the renderer gate |
| Test debt | — | **P7**: unit suites for `pii-detectors`, `pii-pseudonymizer`, `secret-swap`, `entity-recognizer` and `audio-redaction-service` (missing in the pin; possibly present upstream after `ab8f9a`; check before writing) | — |

Shared changes now go through upstream review and are consumed through `upstream.lock.json`; see [ownership architecture](../architecture.md).

## 14. Work packages

| WP | Scope | Output | Effort (eng-weeks) | Depends on |
|---|---|---|---|---|
| WP0 | Spike: bundle upstream `pii-detectors`, `pseudonymizer` and `secret-swap` into the renderer with Vite aliases for `node:crypto`/`node:buffer`; measure bundle size; confirm browser behaviour. Decide between P1 and a temporary alias shim | Spike report; go/no-go on P1 | 0.5 | — |
| WP1 | **Quick win:** set `ELIZA_SECRET_SWAP_ENABLED`/`ELIZA_PII_SWAP_ENABLED` in `AlphaLocalAgentPlugin.configureEnvironment`; T-11 | Local runtime second pass | 0.5 | — |
| WP2 | Patch P1 (browser-safe subpath) plus P7 detector tests, in an isolated upstream worktree; qualification per the README | `0037-core-privacy-subpath.patch` | 1.5 | WP0 |
| WP3 | Renderer `EgressGate` (Section 7.1), policy module, chat (E1), mail (E2) and inbox/workflow (E7) integration, rehydration of replies and proposals, redaction preview UI in the mail review sheet; T-1..T-6 | Gate v1 (tier-0, gazetteer, secret-swap, pseudonymisation); no NER yet | 3 | WP0/WP2 |
| WP4 | Java `EgressGuard` and `AlphaPrivacy` plugin (receipt registration, generated tier-0 floor, route allowlist, T2 audio refusal) wired into `AlphaConnectionPlugin.request` and `AlphaVoiceCloudPlugin.connect*`; T-7, T-8 | Native enforcement | 2 | WP3 |
| WP5 | Vault with Keystore (`alpha.redaction.vault.v1`), memory-only first, then persistence after P2; patch P2 | Vault plus `0038-session-snapshots.patch` | 1.5 | WP3 |
| WP6 | Receipts: schema, HMAC key, ES256 signing key, chain, user-facing receipt view, export; T-13 | Receipt v1 | 1.5 | WP3, WP4 |
| WP7 | Native NER: ORT Android, GLiNER-PII edge UINT8 (default) with tokeniser and span decoder in Java; optional OpenAI Privacy Filter q4 pack behind a device-RAM gate; model download and integrity (SHA-256 pinned); T-9 | `NativePiiRecognizer` | 3–4 | WP3 |
| WP8 | Voice: spoken-form normaliser, digit-run rule, confidence widening, roster gazetteer, T2 route policy; T-3, T-10; P4 if a redacted-audio artefact is in scope | Transcript gate | 2–3 | WP3, WP7 |
| WP9 | Per-view ID tokenisation (T2) and browser excerpt channel | T2 context controls | 1 | WP5 |
| WP10 | Enclave second pass: env flags, P5 ONNX recogniser plugin, ProcessingPolicy requiring a receipt at T2, P3 audit annotation | Agent-side enforcement | 2–3 | WP6; 0036 deployed |
| WP11 | Evaluation set, harness and first report (Section 12); T-14 | Eval report v1 | 3 (plus actor and recording costs) | WP3, WP7, WP8 |

Totals:
- **WP0–WP6 plus WP9: about 12 weeks.** That is a usable T1 gate with native enforcement and receipts, without model NER.
- **Adding WP7–WP8: about 17–19 weeks.** That reaches a T2-capable gate on emulator plus one physical device.
- **Adding WP10–WP11: about 22–26 weeks** in total.

Physical-device qualification of each tier is separate evidence, per `AGENTS.md`.

## 15. Concrete code: calling the upstream APIs

These snippets are against the pinned upstream API. The `@elizaos/core/privacy` import path assumes P1; before P1, import from `@elizaos/core` in Node tests only.

**(a) Tier-0 detection:**
```ts
import { detectPii } from '@elizaos/core/privacy';
const hits = detectPii('Card 4111 1111 1111 1111, SSN 123-45-6789', { disabledKinds: new Set(['ipv4']) });
// [{kind:'credit-card', value:'4111 1111 1111 1111', start:5, end:24}, {kind:'ssn', ...}]
```

**(b) Gate core: secret-swap first, then pseudonymise with a composite recogniser:**
```ts
import {
  SecretSwapSession, PseudonymSession, CompositeEntityRecognizer,
  RegexEntityRecognizer, GazetteerEntityRecognizer, DEFAULT_PSEUDONYM_BLOCKLIST,
} from '@elizaos/core/privacy';

const blocklist = [...DEFAULT_PSEUDONYM_BLOCKLIST, 'Alpha Phone'];
const recognizer = new CompositeEntityRecognizer([
  new RegexEntityRecognizer({ address: true }),                       // email/phone stay with secret-swap
  new GazetteerEntityRecognizer(contacts.map(c => ({ kind: 'person', value: c.displayName })), { name: 'contacts' }),
  new NativePiiRecognizer(AlphaPrivacy, ['person', 'organization', 'location', 'address']),
], { blocklist });

const secrets = new SecretSwapSession({ disabledKinds: policy.disabledSecretKinds });
const people  = new PseudonymSession({ recognizer, blocklist });

const masked = secrets.substituteText(userText);   // OTP/PAN/SSN/keys -> __ELIZA_SECRET_<nonce>_<n>__
await people.learn(masked);                        // NER never sees raw secrets (same order as upstream dispatcher)
const outbound = people.substituteText(masked);    // "Dana Whitfield" -> "Priya Okafor"
// residual floor (fail closed)
if (detectPii(outbound).some(m => !isOwnPlaceholderOrSurrogate(m, secrets, people))) throw new Error('residual-detected');
```

**(c) Streaming rehydration for the UI:**
```ts
import { GuardedStreamScanner } from '@elizaos/core/privacy';
const scanner = new GuardedStreamScanner({ secretSession: null, piiSession: people });
onText = chunk => render(scanner.push(chunk).visible);   // secrets stay masked in UI; names restored
// on completion:
render(scanner.flush().visible);
const proposals = reply.proposals?.map(p => ({ ...p, description: people.restoreText(p.description) }));
```

**(d) Transcript recipe (mirrors upstream `transcript-store.ts:390`):**
```ts
import { PseudonymSession, detectPii } from '@elizaos/core/privacy';
const s = new PseudonymSession({ salt: `transcript:${id}:${vaultSalt}`, recognizer: transcriptRecognizer });
await s.learn(normalizedForDetection);            // spoken-form normalised copy
const safe = typeMaskTier0(s.substituteText(written)); // tier-0 -> [CREDIT-CARD] etc.
```

**(e) Verified audio redaction (local runtime or paired host only; Node):**
```ts
import { AUDIO_REDACTION_SERVICE_TYPE, type AudioRedactionService } from '@elizaos/agent/services/audio-redaction-service';
const svc = runtime.getService(AUDIO_REDACTION_SERVICE_TYPE) as AudioRedactionService;
const res = await svc.redactAndVerify({
  originalAudioUrl, durationMs,
  words,                                        // TranscriptWord[] with startMs/endMs (required)
  piiSpans: matches.map(m => ({ text: m.value, label: m.kind })),
  mode: 'bleep', languageHint: 'en',
});
// res: { url, hash, reused, verifierIds, spanCount, sentinelTexts }; throws on any unverified outcome
```

**(f) Confidential inference admission in the enclave host (as the upstream bootstrap does):**
```ts
import { ConfidentialInferenceAuthority, runWithConfidentialInference } from '@elizaos/core';
const authority = new ConfidentialInferenceAuthority({
  handlers: [cerebrasHandler], currentProfile: () => profile, audit: sqliteAudit,
  redispatchPolicy: 'deny-after-authorization', transport: attestedTransport,
});
await runWithConfidentialInference(authority, { agentId, modelType: 'TEXT_LARGE', handler: cerebrasHandler },
  () => cerebrasHandler(runtime, params));
```

**(g) Escalation with fail-closed semantics (agent-side archive scrub):**
```ts
import { scrubWithEscalation } from '@elizaos/core';
const r = await scrubWithEscalation(runtime, { text, candidateSpans: nerValues, rulesetVersion: '2026-10-01.1' });
// throws PiiScrubFabricationError if residue exists and no PII_SCRUB model is registered
```

**(h) Java enforcement hook (`AlphaConnectionPlugin.request`, before writing the body):**
```java
byte[] body = call.getString("body", "").getBytes(StandardCharsets.UTF_8);
egressGuard.admit(id, url, url.getPath(), body);   // throws EgressDeniedException -> call.reject("Blocked by redaction policy")
try (OutputStream out = connection.getOutputStream()) { out.write(body); }
```

## 16. Risks and open questions

1. **Realistic vs. typed surrogates.** Upstream realistic surrogates keep LLM fluency. They also risk confusion: "Priya Okafor" could be a real contact. Mitigations: the collision check against learned values, and the gazetteer learning all contacts first. For compliance reviewers a typed display (`[PERSON 1]`) may be preferable, which is P6. Decide per tier.
2. **NER memory on the phone.** The Privacy Filter q4 pack (875 MB) is not viable as a default. GLiNER-PII edge recall (72%, vendor figure) is too low for T2 on its own. T2 therefore needs the gazetteer, the spoken-form rules **and** the agent second pass. Report worst-class recall honestly.
3. **Agent-executed actions on surrogates.** These need the T1/T2 rules in Section 8. This interacts with upstream approval semantics in 0001/0007, so check before WP3 ships.
4. **The renderer can be bypassed.** The Java guard covers HTTP from plugins. It does not cover E6 (the in-process agent) or arbitrary WebView `fetch`. Confirm the CSP `connect-src` forbids remote origins from the WebView, so that only native plugins can reach the network.
5. **Recordkeeping.** Redaction applies to the AI copy only. Originals may need WORM retention (see [04](04-redaction.md) and [05](05-regulation-compliance.md)).
6. **Patents.** [04](04-redaction.md) lists US 12229313 and US 12189817. A freedom-to-operate review is needed before marketing audio de-identification.

## 17. Implementation status: upstream swap fixed and enabled for the resident agent

This delivers WP1 (Section 14). With it, egress E6 in Section 4 is no longer unprotected for secrets and structured identifiers.

- **Measured before the fix** (logging proxy between the real pinned runtime and Cerebras, Qwen): with both swaps off, the email, phone, card and SSN in the prompt reached Cerebras verbatim. Enabling either swap made every model call fail with `signal is not of type AbortSignal`. That fails closed but is unusable.
- **Root causes:**
  - The swap walkers flatten the request `AbortSignal` into a plain object.
  - The enable flags were read only from runtime settings, which host env forwarding cannot set for keys containing `SECRET`.
- **Fix:** the retired patch (available in Git history), added to the Android runtime extras. `AlphaLocalAgentPlugin` sets `ELIZA_SECRET_SWAP_ENABLED=true` and `ELIZA_PII_SWAP_ENABLED=true`.
- **Measured after the fix** (same proxy, patched runtime): through both the settings path and the environment-only path the resident agent uses, the email, phone, card and SSN reached Cerebras only as `__ELIZA_SECRET_<nonce>_<n>__` placeholders, and the turn completed normally.
- **Remaining:**
  - Person names still egress until an NER recognizer is registered (Section 14).
  - The desktop backend's vendor pin is unpatched.
  - Emulator and physical-device evidence for the resident agent are separate gates.
- **Emulator evidence:** `ResidentEgressRedactionInstrumentedTest` ran through `scripts/android-resident-instrumentation.mjs` on a disposable API 35 arm64 emulator with 6 GB RAM, in a fresh secondary user, with the debug APK built from the series that includes the patch. Result:
  - The resident agent, with both swaps on, answered the turn ("56").
  - Its one recorded provider request contained `__ELIZA_SECRET_` placeholders and none of the raw email, card number or SSN.

  The non-secret proof is in `test-results/android-resident-redaction/result.json`. This is emulator evidence, not physical-device or AOSP-image acceptance.
- **Pairing contract:** in that local swap-fix build, `/api/auth/pair` answered from the agent-only route (`{token, instanceId}`) instead of the app pairing route that mints an owner session (`access`, `identityId`). Production enrollment in `AlphaLocalAgentPlugin` requires the owner-session contract, and the CI resident runtime pairs successfully with it, so the mismatch was specific to that build, not a product or redaction defect.

## Sources

Code (pinned `vendor/eliza`): `packages/core/src/security/{pii-detectors,entity-recognizer,pii-pseudonymizer,secret-swap,guarded-stream,pii-pseudonym-map,pii-pseudonym-map-store,pii-scrub-seam,pii-context-pack,pii-scrub-markers,confidential-inference,redact,log-redaction}.ts`, `packages/core/src/{audio-redaction,audio-redaction-verify,transcripts,runtime}.ts`, `packages/core/src/runtime/model-dispatch/dispatcher.ts`, `packages/core/src/services/pii-scrub.ts`, `packages/agent/src/services/audio-redaction-service.ts`, `packages/agent/src/api/audio-redaction*.ts`, `packages/agent/src/security/confidential-sqlite-audit.ts`, `packages/agent/src/runtime/confidential-host-bootstrap.ts`, `plugins/plugin-local-inference/src/pii/*`, `plugins/plugin-local-inference/src/services/voice/transcript-store.ts`. Patches: `patches/eliza/0036-qualified-ab8f9a-runtime.patch` (historical; the series was retired in `34b3c82a` and upstream changes now arrive through a reviewed pin move in `upstream.lock.json`) (`processing-policy.ts`). Alpha: `apps/app/src/runtime/{connection-ui.tsx,phone-context.ts,native-connection.ts,alpha-client.ts,reviewed-mail-context.ts}`, `apps/app/src/prototype/{agent-adapter.ts,inbox-cloud-adapter.ts,voice-adapter.ts}`, `android/app/src/main/java/ai/elizaresearch/alphaphone/{AlphaConnectionPlugin,AlphaCredentialStore,AlphaVoiceCloudPlugin,AlphaLocalAgentPlugin,BrowserReading}.java`.

Web:
- OpenAI Privacy Filter: [OpenAI announcement](https://openai.com/index/introducing-openai-privacy-filter/) ([HF model card](https://huggingface.co/openai/privacy-filter), [HF ONNX tree](https://huggingface.co/openai/privacy-filter/tree/main/onnx), [MarkTechPost](https://www.marktechpost.com/2026/04/28/openai-releases-privacy-filter-a-1-5b-parameter-open-source-pii-redaction-model-with-50m-active-parameters/), [Help Net Security](https://www.helpnetsecurity.com/2026/04/23/openai-privacy-filter-personally-identifiable-information/), [montevive browser demo](https://github.com/montevive/openai-privacy-filter))
- GLiNER-PII: [knowledgator edge](https://huggingface.co/knowledgator/gliner-pii-edge-v1.0), [base](https://huggingface.co/knowledgator/gliner-pii-base-v1.0), [urchade multi PII](https://huggingface.co/urchade/gliner_multi_pii-v1), [NVIDIA gliner-PII](https://huggingface.co/nvidia/gliner-PII/discussions/6), [GLiNER2-PII arXiv 2605.09973](https://arxiv.org/abs/2605.09973)
- Presidio: [Anonymizer](https://presidio.dataprivacystack.org/anonymizer/), [Deanonymization](https://deepwiki.com/microsoft/presidio/3.2.2-deanonymization), [GLiNER in Presidio](https://presidio.dataprivacystack.org/samples/python/gliner/), [issue #1569](https://github.com/data-privacy-stack/presidio/issues/1569)
- Limina: [system requirements](https://docs.private-ai.com/installation/prerequisites-and-system-requirements), [site](https://www.getlimina.ai/en)
- Tonic Textual: [product](https://www.tonic.ai/products/textual), [pricing](https://www.tonic.ai/pricing), [self-hosted](https://docs.tonic.ai/textual/textual-install-administer/deploying-a-self-hosted-instance), [tokenisation vs synthesis](https://tonic-textual-sdk.readthedocs-hosted.com/en/latest/redact/redact_config.html)
- Android: [ML Kit Entity Extraction](https://developers.google.com/ml-kit/language/entity-extraction/android), [ML Kit Prompt API](https://developer.android.com/blog/posts/ml-kit-s-prompt-api-unlock-custom-on-device-gemini-nano-experiences), [LiteRT-LM](https://ai.google.dev/edge/litert-lm/overview), [LiteRT-LM blog](https://developers.googleblog.com/blazing-fast-on-device-genai-with-litert-lm/), [ORT mobile](https://onnxruntime.ai/docs/tutorials/mobile/), [OpenMed Android accelerators](https://openmed.life/docs/runtimes/android-accelerators/), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [sherpa-onnx #2568](https://github.com/k2-fsa/sherpa-onnx/issues/2568), [Keystore](https://developer.android.com/privacy-and-security/keystore), [KeyProtection](https://developer.android.com/reference/android/security/keystore/KeyProtection)
- Speech: [NeMo ITN](https://arxiv.org/pdf/2104.05055), [on-device streaming ITN](https://arxiv.org/html/2211.03721), [Dual-Form ASR ITN](https://arxiv.org/pdf/2609.02901), [SpeechShield](https://arxiv.org/abs/2502.01649), [SLUE](https://huggingface.co/datasets/asapp/slue), [N-best SLU](https://arxiv.org/pdf/2001.05284), [whisper.cpp DTW discussion](https://github.com/ggml-org/whisper.cpp/discussions/2307), [vLLM Whisper DTW PR](https://github.com/vllm-project/vllm/pull/47664), [CrisperWhisper](https://arxiv.org/pdf/2408.16589)
- Benchmarks: [ai4privacy 400k](https://huggingface.co/datasets/ai4privacy/pii-masking-400k), [open-pii-masking-500k](https://huggingface.co/datasets/ai4privacy/open-pii-masking-500k-ai4privacy), [LLM-Redactor](https://arxiv.org/abs/2604.12064), [RedactionBench](https://arxiv.org/abs/2606.18782)
