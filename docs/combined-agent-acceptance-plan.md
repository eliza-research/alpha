# One paired agent: combined runtime acceptance plan

## Present evidence and gap

The user needs one selected agent for all supported flows. Separate passing hosts do not establish that journey:

| Isolated host | Named evidence |
| --- | --- |
|47840|Cerebras chat/context, approved device actions and cancellation|
|47844|Paired Kokoro TTS|
|47846|Paired explicit Whisper ASR and TTS|
|47848|Reviewed workflow submission and recovery|
|47854|Canonical approval and metadata mutation/reconciliation|

Existing native runners hardcode these origins (or their response-loss proxies47849/47855), pair independently and restore earlier selection. Their archived results remain valid scoped evidence; none proves uninterrupted shared identity, enrollment, history and capability state across every feature.

Recorded `process.json` files identify a shared source directory but usually only HEAD45cc570, while later changes were uncommitted patches. HEAD alone is insufficient runtime identity, and a shared mutable source directory can change between startup and later imports. Do not infer currently loaded capabilities from current filesystem contents or historical startup metadata.

## Reproducible source

Read-only audit reconstructed touched source files from upstream `4573712ebf0466daa4dfadaa4482704c209d9b8c` in a temporary directory, then ran sequential `git apply --check` and apply for0001 through0008. All eight passed with no textual conflicts; digests matched the corresponding source-base records. This checks patch composition, not typecheck or runtime behavior. No vendor, live worktree or service changed.

Freeze0009 after its owner completes lifecycle tests; apply it after0008 and repeat clean composition. Use a separate immutable combined source checkout, pinned lockfile dependencies and explicit source resolution. Do not combine profile databases or copy arbitrary credentials between historical hosts. Preserve their rollback/evidence identity.

`fingerprint-combined-agent.mjs` records HEAD plus every tracked/nonignored untracked file's SHA256, executable bit, missing-file state and symlink identity. Ignored dependencies are deliberately outside this fingerprint; pin/install the lockfile and separately record toolchain/native assets. The one explicitly reviewed gitlink `plugins/plugin-local-inference/native/llama.cpp` at `ea8b3f2dfc2641dea3e6238bc6dd99595584b076` is recorded as `type:gitlink, initialized:false` only while its directory exists and is completely empty. A populated, symlinked, differently pinned or other unqualified gitlink is rejected. This records omitted native build input honestly; it does not claim to build llama.cpp. Actual prebuilt CPU inference/voice assets and their dependency closure require separate hashes and runtime evidence. Keep the manifest outside the source tree; root must review its content before launch.

```sh
node scripts/fingerprint-combined-agent.mjs ABSOLUTE_COMBINED_SOURCE ABSOLUTE_NEW_MANIFEST
```

## Prepared launcher — do not start before root review

`scripts/start-combined-agent.mjs` uses port47858 only. A read-only listener inventory found no listener during preparation; the launcher rechecks availability immediately before startup and never stops a competing process. Default profile is `~/.local/share/alphaphone/combined-agent-47858`, outside source; an existing unmarked profile is refused. It never adopts40/44/46/48/54 state.

Required explicit configuration:

- `ALPHA_COMBINED_SOURCE`, `ALPHA_COMBINED_SOURCE_MANIFEST`: absolute reviewed frozen source/manifest. Byte mismatch fails before private state is created.
- `ELIZA_INFERENCE_LIBRARY`, `ELIZA_KOKORO_MODEL_DIR`: existing absolute TTS library/assets.
- `ELIZA_WHISPER_BINARY`, `ELIZA_WHISPER_BINARY_SHA256`, `ELIZA_WHISPER_MODEL`: explicit standalone provider, verified executable digest and pinned supported tiny.en bytes.
- `ALPHA_NODE_BIN` and `ALPHA_BUN`: explicit absolute executables, verified as Node24.15.0 and Bun1.4.2. The Node executable must be named `node`; its directory is first in the child PATH so Bun subprocess resolution cannot pick ambient Homebrew24.5. Runtime metadata records both executable hashes.
- Optional `ALPHA_COMBINED_PROFILE` for the reviewed private profile path.

It reads the existing owner-only Cerebras key file privately, uses a new owner-only token and fixed direct Cerebras text routing, and preserves the explicitly named voice variables. It excludes ambient unrelated credentials. It binds127.0.0.1, allows the emulator host, sets `ELIZA_REQUIRE_LOCAL_AUTH=1`, uses `--conditions=eliza-source` plus explicit tsconfig, and redirects child output to an owner-only log. No token/key is printed. Normal device/user pairing remains necessary; an owner token is not an enrolled phone identity. Scheduling and personal-assistant defaults stay disabled until separately qualified. Existing routing config mismatch fails rather than rewriting it.

This corrects the old launchers' configuration mismatch: reviewed-workflow launcher drops voice variables; voice launcher defaults to another source checkout unless explicitly overridden. The prepared launcher checks startup preconditions but does not advertise readiness until actual authenticated endpoints are tested. `--validate-only` validates source/asset/port prerequisites without launching or creating a profile; it does not run model inference.

No launcher has been run and no service has been restarted during preparation. Syntax checking is not runtime acceptance.

## One-session composite acceptance

1. Verify immutable source/dependency/native-asset hashes, schema migrations, strict unauthenticated401 and wrong-owner rejection. Run all owning plugin typechecks/host protocol suites against the combined source. Additive submission/metadata/lifecycle receipts and cancellation markers need forward/rollback compatibility review.
2. Pair once to47858. Keep the same origin, authenticated owner/agent, encrypted credential and device enrollment through all later cases. Record nonsecret identity hashes and archive both APK/test hashes.
3. Create a fresh explicit test conversation; real Cerebras reply and current-view context; approved note/reminder/browser effects with exact journal receipts. Avoid accumulated-history token pressure and automatic model retries.
4. Explicit recorded-fixture upload through actual native decode/resample → real Whisper transcript → editable Notes draft → Kokoro Listen completion/cancel. Label synthetic recording ingress; physical microphone acceptance remains separate. Confirm text stays routed to Cerebras.
5. Reviewed inactive synthetic workflow run/submission, cancellation, canonical approval/second confirmation, metadata change and0009 lifecycle/history/restore. Preserve original workflow source/activation except explicitly reviewed fixture operations. Use exact native/provider receipts, not button completion.
6. A single stable owned fault proxy may forward to this same combined process to test dropped committed responses, with fixed non-loopback forwarding and unauthenticated401. Do not silently change the phone origin midway; use a separate same-origin fault campaign or stable proxy for the entire composite session. No extra authority from loopback.
7. Kill/restart only this disposable combined host, then phone process restart: same account/history, enrollment, native journals, pending approval/mutation identities and workflow historical receipts remain; no re-pair or replay to hide recovery failures. Repeat both distributions and preserve earlier failed attempts.
8. Only after passing, plan controlled primary-host cutover: preserve existing database/agent identity and owner sessions via documented compatible migration/backup; do not merge independent profiles. Revalidate original phone pairing, capabilities and rollback. Port/profile migration must be explicit because native credentials/enrollment bind origin and identity.

Existing single-feature test origin guards should become explicit bounded fixture configuration (emulator loopback only, reviewed allowed port and expected identity), not unrestricted arbitrary host access. A new composite runner is still required; no APK test parameterization is included in this scripts-only preparation.

## Enclave candidate and outstanding boundaries

The existing measured candidate documents only0001. It cannot attest0002–0009 or the combined profile. Build a new Linux source/runtime artifact after combined acceptance; macOS `.dylib` and Homebrew Whisper cannot be copied into Linux as working providers. Record architecture/library/model dependency closure and test actual Linux decoding/TTS/ASR and persistent mixed PGlite/Smithers stores. Standalone Whisper currently advertises local/local-only modes; enclave runtime mode and exposure require explicit supported design, not bypassing route restrictions or curated fused-ASR gates.

Repeat strict ingress authentication, owner/device authority and restart persistence in the candidate, then the existing signer/PCR admission/deployment/rollback process. Signing and authorized infrastructure references remain gates. Cloud/Gmail OAuth, real password vaults, production Maps service, physical phone/full AOSP and user acceptance remain independent. A combined localhost is an integration milestone, not completion of those services.

## Staged native campaign (not executed)

The combined-agent wrapper described in this section was removed on October 8 with the other aggregate smoke runners, at the owner's request; the section is a historical design record and the campaign has no current repository runner. `CombinedAgentInstrumentedTest#onePairingCoversDeviceVoiceAndReviewedWorkflowLifecycle` and that wrapper staged one normal phone pairing through fixed47859→47858. No listener was present on47859 during the initial read-only check; the runner reserves it exclusively or fails. The proxy fixes forwarded identity, rejects redirects through the host client, forwards actual model/audio/workflow responses and intentionally drops only the reviewed arithmetic fixture's committed metadata response. It never fabricates successful replies or effects.

The runner requires `ALPHA_BUILD_ARCHIVE`, explicit emulator `ANDROID_SERIAL`, reviewed `ALPHA_COMBINED_SOURCE_MANIFEST`, and owner-only `ALPHA_COMBINED_OWNER_SESSION` obtained through ordinary host pairing. It checks source identity against the launch record and both app/test archive hashes. It refuses missing lifecycle/manual-submission/metadata/approval capabilities or unavailable ASR/TTS. The native fixture refuses a preexisting credential/enrollment at this dedicated proxy origin and a competing connected Cloud voice credential; it never erases those to make a run pass.

The staged campaign selects a newly-created empty conversation using real history UI, checks an exact real numeric model reply, reviews and approves one actual native note, runs real Whisper/Kokoro with explicitly synthetic recording ingress, runs an inactive arithmetic workflow, approves a separate exact synthetic file-effect workflow, reconciles lost metadata response after Activity recreation, then removes/re-discovers retained history/restores the arithmetic workflow paused. Native checkpoints compare unchanged encrypted session/enrollment identities across stages without printing them; the proxy independently requires exactly one successful pairing and one bearer/device identity, real ASR/TTS calls and one decision/claim/receipt. The prior phone selection is restored only after the whole campaign.

Host cleanup checks exact fixture source/paused state, cancels only unfinished fixture executions, requires terminal readback before removing the owned effect directory and marks results failed if cleanup cannot complete. Inactive fixture definitions, conversation history, enrollment audit/receipt records are intentionally retained; this is not a secure-erasure test. The native fixture removes its exact synthetic note and temporary local pairing after the campaign. Both distributions get separate campaigns; a failed first campaign stops the next instead of automatically retrying model calls.

This is staged source, not a pass: native compile, runner review and both distributions remain pending. It currently proves intended Activity recreation only; the result explicitly marks `hostRestartTested:false` and `allSupportedProductFlowsAccepted:false`. A later same-identity full host/phone process restart phase remains required. Build75 source adds bounded read-only terminal polling and exact native-journal-to-note assertions before/after the campaign; they still need compilation and execution. Cleanup preserves a primary failure and attempts removal of the dedicated pairing even when its response fails. Existing independent fixtures and failed attempts remain archived.
