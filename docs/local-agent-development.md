# Local agent setup

Alpha runs the real Eliza runtime locally in both environments. Android runs a resident process in the app sandbox over authenticated native socket IPC. Browser development runs the pinned source on the Mac through a private Vite bridge. The two environments keep separate profiles, history, credentials and acceptance evidence.

The standalone Android app signs in to an Eliza Cloud account, checks its plan (signed entitlement; [plan gate](eliza-cloud-subscription-entitlement-contract.md)), and binds the resident runtime to the supported billed Cloud model (`cerebras/qwen-3.8-27b`). It does not provision a hosted agent. Microphone, notifications and local app access follow account readiness. The agent and local stores remain on the phone; model requests and explicitly shared context use Cloud inference.

Mac development uses direct Cerebras (`qwen-3.8-27b`) with an existing host credential. This route does not qualify Android billing or permission behavior. Generic product voice uses the selected Eliza Cloud account. Explicitly labelled **Read locally** stays local when offered; the local Whisper/Kokoro setup below is optional development qualification.

## Browser development

Use Node 24.15.0 and Bun 1.4.2, then:

```sh
npm ci
npm run agent:prepare
npm run agent:test
bun run dev
```

`npm run agent:prepare` reproduces the immutable `upstream.lock.json` source and runs its normal `bun install --frozen-lockfile`. It does not build an APK. `--source-only` deliberately skips dependency installation; `bun run dev` requires installed dependencies in that prepared checkout. Keep the source guard enabled and use independent metadata/dependencies rather than a symlink to another runtime checkout.

Before starting, configure `CEREBRAS_API_KEY` in the host environment or the owner-only file `~/.config/alphaphone/cerebras-key`. Do not put it in a `VITE_` variable, checked-in file, browser field, URL or command-line argument. The existing private key file is supported. The current model defaults to `qwen-3.8-27b`.

`bun run dev` starts the agent on this computer in the background together with the development server (`npm run dev:local` is the same command). Open `http://127.0.0.1:5317`: the app always connects to that local agent in the background (P-43: there is no offline mode); if it is not running Home shows a recovering state, and **Settings › Agent connection › Try again** reconnects. The connection sheet is the product **Alpha connection** sheet; `ALPHA_DEV_CONNECTION_TOOLS=1 bun run dev` restores the development connection sheet (development profiles, mock mode, subscription gate QA, development Cloud and pairing tools), where **Start local agent** reconnects. Extra arguments go to Vite, for example `bun run dev --port 5199` for the Alpha comparison preview. The default port is 5317. Conversation history comes from the agent's local database. Use `npm run dev:ui` for a renderer-only development server with no agent.

`bun run dev` owns the host and Vite child processes and stops them on Ctrl-C. It refuses an occupied agent port or a live process already using its profile. Its default profile is `~/.local/share/alphaphone/browser-agent`, with owner-only credentials, logs and browser action journal. `ALPHA_REMOTE_PROFILE` and `ALPHA_REMOTE_PORT` permit a separate profile/port. `ALPHA_ELIZA_SOURCE` is an explicit development override; evidence for one source snapshot does not qualify another.

The bridge accepts same-origin requests from the loopback development page only. It allows the conversation, device-action and workflow APIs, injects a host-owned machine session, and removes the upstream session ID because that ID is itself a bearer token. Credentials are not embedded in the web bundle. Device enrollment keys and durable action receipts are kept in the private development profile. Browser development uses the available browser-backed Notes, Calendar and Reminders adapters. These are local browser stores and development capabilities, not access to Android providers or native permissions. Supported actions tied to the owner's freshly submitted request can run directly when **Ask before agent actions** is off. Turning it on requires review; recovered proposals, workflows, selected-object/source checks and OS/provider permission gates retain their own boundaries. A successful Notes test does not prove Gmail authority, Calendar sync or camera capture.

The development host launches Bun with `--conditions=eliza-source` and `--no-install`, matching upstream's source-checkout resolution. Alpha explicitly opts into workflows within the lean chat plugin set using the pinned upstream lean-chat workflow support; coding, terminal, browser automation and wallet exclusions remain in force. An explicit workflow disable in the private profile still takes precedence. `agent:test` checks those selection boundaries against the prepared source. Existing profiles and their schedule settings are preserved.

Workflow drafts in local browser development persist in the private host profile, separately scoped to the selected owner/agent. Atomic compare-and-exchange rejects stale-tab changes. These development drafts are not encrypted; the editor says so. Android continues to use its encrypted native draft store. Draft storage does not save or execute a workflow on the agent until the separate reviewed submission.

## Isolated Mac provider QA

Use separate `ALPHA_REMOTE_PROFILE`, `ALPHA_REMOTE_PORT` and Vite `--port` values
when comparing a developer runtime with an existing preview. Reuse a verified
prepared source through `ALPHA_ELIZA_SOURCE`; never restart another preview's host.

`ALPHA_DEV_CARTESIA=1` explicitly enables the pinned runtime's self-hosted Cartesia
speech service. Supply `CARTESIA_API_KEY_FILE` as an absolute reference to an existing
owner-only regular file. The launcher passes only that reference to the host;
it does not read the key into the renderer or accept a `VITE_` credential.
This opt-in does not change the app's Cloud voice controls. Server health,
selected app voice, actual recording/playback and Android acceptance are separate
checks. Leave microphone and playback tests to an explicitly authorized session.

The developer Models page reads the active host's inference provider. A saved
Cloud account is independent of this selection, and an unreported model name
stays unknown.

## Speech routes and optional local development

The native default profile stages on-device libelizainference voice (Paradee-8M TTS and the voice bundle's ASR slot; see [fused speech](fused-speech.md)). Browser development has distinct local-host and owner-bound Cloud speech routes. The explicit Cloud-resident browser profile enables the Cloud route without enabling test-mocks; the separately gated development voice options also use the selected account. Check the loaded profile and verified provider route instead of inferring speech location from the UI or text model. These routes do not use Web Speech as a fallback. Notes recording, transcription and playback have separate user actions. Actual microphone, response, playback and Android permission acceptance require their own qualification; text inference readiness does not prove them.

The development host runs the same engine: the shared Paradee TTS worker (`POST /api/tts/paradee`) and the shared ASR service (`POST /api/asr/libelizainference`), both on libelizainference. Configuration uses the upstream names only (`scripts/speech-env.mjs`): `ELIZA_INFERENCE_LIBRARY` with its independently reviewed `ELIZA_INFERENCE_LIBRARY_SHA256`, `ELIZA_PARADEE_ENABLED` / `ELIZA_PARADEE_MODEL_DIR` and `ELIZA_ASR_ENABLED` / `ELIZA_ASR_MODEL_DIR`. `1` requires the service, `0` turns it off, and unset enables it only when its model directory is set. The Paradee directory holds the pinned `paradee-8m-v1_0.gguf`, `misaki-en-us.lex` and optionally `espeak-ng-data/`; the ASR directory holds the slot pair under `asr/` and Silero VAD under `vad/` (paths and hashes in `scripts/host-speech-assets.json`). Assets are verified before the worker starts; nothing is downloaded.

Require both speech services at startup with:

```sh
ELIZA_ASR_ENABLED=1 \
ELIZA_PARADEE_ENABLED=1 \
ELIZA_INFERENCE_LIBRARY=/absolute/path/to/libelizainference.dylib \
ELIZA_INFERENCE_LIBRARY_SHA256=<reviewed sha256> \
ELIZA_PARADEE_MODEL_DIR=/absolute/path/to/paradee \
ELIZA_ASR_MODEL_DIR=/absolute/path/to/asr-bundle \
npm run dev:local
```

For persistent development defaults, save those nonsecret settings in the selected
profile's `local-speech.json` (by default
`~/.local/share/alphaphone/browser-agent/local-speech.json`), with owner-only
permissions (`chmod 600`). For example:

```json
{
  "ELIZA_ASR_ENABLED": "1",
  "ELIZA_PARADEE_ENABLED": "1",
  "ELIZA_INFERENCE_LIBRARY": "/absolute/path/to/libelizainference.dylib",
  "ELIZA_INFERENCE_LIBRARY_SHA256": "<reviewed sha256>",
  "ELIZA_PARADEE_MODEL_DIR": "/absolute/path/to/paradee",
  "ELIZA_ASR_MODEL_DIR": "/absolute/path/to/asr-bundle"
}
```

The TTS directory holds the pinned Paradee-8M GGUF and misaki lexicon (optionally
`espeak-ng-data/`); the ASR directory holds `asr/phonon-2-fv5.gguf` (Phonon-2, the only GGUF under
`asr/`) and `vad/silero-vad-v5.gguf`. The agent's host workers load them through
libelizainference, and the ASR worker runs with `ELIZA_ASR_BACKEND=parakeet`
(`scripts/host-speech-assets.json`, [host speech migration](host-speech-migration-2026-10-14.md)).

`npm run dev` and `npm run dev:local` read this file at startup. A file that still uses the
earlier Alpha-only keys (`ALPHA_LOCAL_TTS`, `ALPHA_LOCAL_ASR`, `ALPHA_TTS_MODEL_DIR`,
`ALPHA_ASR_MODEL_DIR`, `ALPHA_TTS_LIBRARY`) is refused with an error naming the upstream
replacement; the retired Whisper and Kokoro keys are refused too. The environment refuses the
earlier names the same way. Explicit shell environment values take precedence, including
`ELIZA_PARADEE_ENABLED=0`. Only speech modes, the digest and absolute asset paths are accepted;
credentials, arbitrary process settings, symlinks, shared-access files and malformed JSON are
rejected. The file does not download assets or configure speech on Android. Speech runs on the
development computer; text-model inference still uses the configured provider (Qwen
`qwen-3.8-27b` on Cerebras).

The earlier cold-Kokoro, paired-Whisper and combined voice-roundtrip campaign scripts were deleted
on 2026-10-14 (they could not qualify Paradee or Phonon-2); their historical evidence below
describes the retired engines.

Notes recording uses the selected Cloud account. The retired local-agent Notes UI journeys are removed; real browser capture, reviewed saves, cancellation and playback remain covered by the Cloud-bound recording E2E fixtures. Those fixtures use synthetic transport and do not qualify a live Cloud provider. The explicit local-host playback check above remains available for development speech. Native Android speech and physical-device acceptance remain separate.

For a real arithmetic-only workflow check against a disposable local host, provide an owner-only paired session JSON file and run:

```sh
ALPHA_WORKFLOW_ORIGIN=http://127.0.0.1:47859 \
ALPHA_DEVICE_SESSION_FILE=/private/path/to/session.json \
node scripts/test-real-workflow.mjs
```

The helper loads TypeScript through the installed `tsx` loader, accepts only an exact IPv4 loopback HTTP origin, creates a paused synthetic workflow, executes it once, and leaves it paused. It requires one persisted output row for the matching run and task with value `56`, then checks that a second receipt read returns the same result. A finished status without that output fails qualification. It exercises the actual local workflow engine without model inference, tools or communications. Run it against an isolated test profile; it does not qualify native triggers or real-provider workflows.

## Qualified browser host checkpoint — October 5

Consumer `7edcbad1a672f11799119af3dfe83a3a818a4760` and upstream
`eba10c3eaad0923e777062b1b946911bc31d7fbd` were prepared with the frozen host
dependency install, without lifecycle scripts or Android packaging. The 21
runtime workflow/process-host tests passed. `npm run verify` passed TypeScript,
all 397 repository tests (zero failures or skips), and the renderer build.

The renderer on port 5317 and private host on port 47849 were upgraded together.
Stopped-profile backups remain private outside the repository. Before/after
snapshots confirm the same owner, agent and all 17 conversation identifiers;
authenticated status reports the agent running and both Whisper and Kokoro ready.
This establishes identifier retention, not a row-by-row database equivalence audit.

The real Chromium speech journey passed in 12.9 seconds (13.4 seconds including
runner startup): synthetic audio through MediaRecorder, actual host Whisper,
Kokoro playback, completion, Stop and disconnect. The rendered transcript was
inspected. The journey sends no chat message and saves no reminder. Its total
includes several playbacks and is not a six-second voice-latency measurement.
Local evidence is retained under `artifacts/current-live-runtime/` in the
qualification checkout: `runtime-contracts.log`, `verify.log`, `live-speech.log`
and hashed before/after identity snapshots. No credentials or profile contents
are committed as evidence.

This is a source-bound development checkpoint. It does not establish hosted
Cerebras task quality, full current-source hosted browser qualification, native
Android speech, physical microphone quality or device acceptance. Keep these
gates separate from a working browser host.

## Android setup

Use the normal resident build pipeline when native or runtime changes need device qualification:

```sh
npm run android:build:local
```

Iterate on UI at `http://127.0.0.1:5199/` with `bun run dev --port 5199`. This does not need a connected phone. Use an owned emulator for repeatable Android scenarios and Seeker for native providers, service lifecycle and actual screen-off delivery. Browser evidence does not establish these device behaviors.

The staging command builds the Android mobile agent bundle, runs upstream's host-Bun module initialization check, and stages pinned ARM64 and x86_64 Bun/musl/runtime artifacts. Executables are packaged as extracted JNI libraries for an ordinary APK; it does not require root, writable-directory execution or disabling SELinux. The upstream staging step includes its small embedding artifact, not an offline text-generation model. Generated assets and binaries are ignored by Git and reproducible from the checked-in scripts and manifests.

When an APK build is wanted, `npm run android:build:local` checks the pinned checkout (and any staged voice bundle against `android/voice-host/qualified-voice-host.json`), checks that the reviewed embedding host libraries are staged (it stops there, naming the person who must supply them, when they are not; `npm run android:build:inputs` lists every input), then runs preparation, `agent:build-workflow-worker`, staging, the packaged-runtime notices and the existing build/verification of both standalone and launcher variants. Rerunning it reuses the prepared source and worker artifact only when they verify against the current source stamp; a stale worker artifact is reported, never rebuilt over. The ordinary `android:build` uses whatever payload has already been staged and stops before Gradle, naming the command to run, when the prepared source or (for distribution builds) the staged payload is missing or was staged from a different preparation. Unpackaged developer artifacts never qualify resident acceptance. Signing, speech functionality and overall release acceptance remain separate from a successful packaging check. Preparation, worker build and staging start their children in the prepared checkout without the AI-agent variables Turborepo detects (`AI_AGENT`, `CLAUDECODE` and others, see `TURBO_AGENT_DETECTION_ENV` in `scripts/local-agent-source.mjs`), so Turborepo does not append agent guidance to that checkout's `AGENTS.md`.

In the standalone Android app, use the existing Eliza Cloud account flow. A verified interactive phone/account sign-in opens required access setup, then Ready and Home. Setup opens as soon as the account is admitted (the verified code step says Signing in… meanwhile, not Checking code…): the resident agent restarts with the new key behind it and shows as starting (Home, Settings › Agent connection) instead of holding the sign-in step or describing AI or billing until it runs. The original Notifications → Microphone → Camera → Location sequence has no Skip action; Android appends Calendar and Photos. Google connects separately in Settings. Previously completed installations retain their completion. Completing setup does not grant denied permissions or establish inference readiness. Plan, binding, unexpected-account and unconfirmed prior-key revocation notices remain visible within setup; relevant account/plan controls remain in Settings. Quiet restoration preserves completed setup, while **Set up Alpha access** reopens its current status. The separate development hosted-agent flow retains its own hosting consent review rather than being redirected into phone setup. Staging QA: [cloud-subscription-qa.md](cloud-subscription-qa.md). It binds a credential reference to the supported Cloud model in native encrypted storage and reuses the saved account on restart. No provider key belongs in the renderer or source, and no hosted agent is provisioned. Account/logout changes retire the old binding and runtime; changed provider selections require a new admitted runtime launch.

**Stop local agent** requests native shutdown and waits for process/service/socket status before reporting success. Disconnecting the UI alone does not prove the background runtime stopped. Existing direct-provider records are legacy development compatibility, not the product onboarding path.

The native bridge enrolls and verifies its own local owner session. Conversation, workflow and device-action calls retain the existing review, selected-context, journal, receipt and reconciliation boundaries. Both environments select the upstream store capability policy, independently of build-channel selection. Browser development uses the lean plugin profile; Android uses the mobile allow-list. Desktop coding/PTY surfaces are excluded. Runtime location does not waive selected-context, receipt or provider-consent checks; the action preference applies only to supported fresh requests.

## Reproducible source boundaries

- `vendor/eliza` stays pinned and unchanged at the repository's `upstream.lock.json` revision. Its Android lifecycle sources are generated into Gradle's ignored build directory with Alpha's identity and socket namespace. A generated SHA-256 manifest records inputs and outputs.
- `agent:prepare` creates an isolated checkout in `artifacts/local-agent-resident-<commit>` from the same `upstream.lock.json` commit. It applies no patches. All relevant overlays have moved upstream; historical patch files and their old qualification evidence remain in Git history.
- Cached preparations authenticate every tracked source byte and executable mode, plus unexpected untracked files including ignored files. Generated outputs are limited to authenticated workspace/Turbo declarations. Source stamps pin the upstream lock, preparer and guard. Preparation never resets or overwrites a mismatched checkout. `ALPHA_RUNTIME_GIT_CACHE` may point to a repository containing the pinned commit; it does not change the required revision.

For an existing preparation that no longer matches the source stamp, preserve it and select a fresh directory for every preparation, test, development and staging command:

```sh
export ALPHA_LOCAL_AGENT_SOURCE_DIR="$PWD/artifacts/local-agent-mobile-workflows-v3"
export ALPHA_WORKFLOW_WORKER_OUTPUT="$PWD/artifacts/mobile-workflow-worker-current"
npm run agent:prepare
npm run agent:build-workflow-worker
npm run agent:test-workflow-worker
npm run agent:test-workflow-compiler
npm run agent:test
npm run agent:stage-android
```

- Runtime preparation skips the unrelated fused local language-model engine setup. The mobile bundler and staged artifact manifest retain their own validation/provenance.

Worker builds write only to a fresh output directory; an existing directory is reused when it verifies against the prepared source and rejected otherwise. `agent:stage-workflow-worker` can independently validate and stage that artifact without a mobile bundle or APK build. `agent:stage-android` now checks the worker artifact's source/lock identity before staging the full runtime and includes its verified files. Native startup extracts the worker through a bounded hash-checked index before setting its runtime resource path. Android startup enables the workflow plugin when verified extraction includes its compiler resources; older worker-only payloads leave it disabled. Canonical approval receipts use the packaged worker launch contract in the pinned upstream source.

The pinned upstream workflow-worker implementation preserves browser workflow database paths, separates packaged Android resources from durable state, uses the native loader/Bun/library environment for worker and control launches, and repairs dependency links after installation moves. See the [worker packaging report](mobile-workflow-packaging.md) for artifact commands and remaining native staging/plugin requirements. Set `ALPHA_WORKFLOW_WORKER_OUTPUT` to an existing verified worker artifact when running `agent:test` to include its real packaged-executor integration case; without that artifact, the case is explicitly skipped.

## Verification and remaining acceptance

The implementation has a real browser/local Eliza/Cerebras chat result, synthetic HTTP security/lifecycle tests, durable development journal tests, a successful mobile bundle module-load smoke, and Java compilation for both Android distribution variants. These are different evidence classes.

A native APK installation and real on-device Bun process/chat run, process-death/reboot recovery, battery/thermal qualification and physical-device acceptance are still required. Android APK assembly/install was not performed in this browser-focused pass. Cancellation immediately detaches the UI and aborts browser transport; an already-dispatched native action may still complete and must be reconciled from receipts. Browser development streams chat through the private loopback bridge and exposes Stop reply. Only text is shown before the terminal event; action proposals still require the completed response and existing review flow. Interrupted partial replies are marked incomplete and cannot be played as completed speech. Android chat now has an authenticated native streaming adapter and an explicit hash-pinned service patch for request-scoped socket cancellation. Completion requires both the final reply and native successful termination. Stop, disconnect and lifecycle changes close the transport and suppress late events; they do not prove that runtime effects were cancelled. Build137 passes both distribution builds/lint and rendered controlled-native streaming/shutdown checks. Actual Android socket cancellation and live resident chat remain unverified.

Powered-off-phone execution is unavailable with a device-only executor. Persisted schedules, explicit missed-occurrence policy and catch-up need their own acceptance; no browser check proves them. Cloud-backed Inbox/account integrations still require separate sign-in and live acceptance. Moving the agent does not complete every item in the broader MVP report.

The Android bundle includes the workflow plugin and its routes, while native startup opts into it only with extracted compiler resources. Browser development retains its lean workflow opt-in. Isolated host bundle loading and worker/compiler checks pass; actual Android service initialization and workflow execution still require device qualification. Run `npm run agent:test-mobile-workflow-bundle` after building the mobile JavaScript bundle to verify its route registration outside the checkout.

Local evidence for this pass is retained in `test-results/local-agent-qualification/`: repository verification passed 39 tests; the clean browser suite passed 74 tests; both native Java variants compiled; mobile staging and its module-load smoke passed. The final live privacy copy was inspected separately after that browser suite. Against the prepared source, the real browser returned `72` for `8 × 9`, proposed and saved the synthetic **Local runtime check** note only after approval, and retained exactly one note plus its successful journal entry after reload. No provider credential is included in these evidence files.

Browser scheduled digests use the private host profile for results and pending mutations, with bounded compare-and-exchange and commit-before-ack recovery. This development storage is unencrypted. The pinned upstream source registers the implemented digest endpoints on the actual plugin router; `agent:test` checks those registrations and owner-bound dispatch. Use a fresh `ALPHA_LOCAL_AGENT_SOURCE_DIR` after changing the upstream pin or source-admission scripts. Local schedules require the host/device agent process to remain running; browser result sync does not qualify real scheduled execution or Android lifecycle recovery.

Resident digest results now synchronize through the selected local workflow client into the existing encrypted Android connection store while the app is open. They no longer require the remote background-delivery session. Browser development uses the same inbox logic with its disclosed private-host store. Remote Android connections retain their native background inbox. Resident background delivery is configured through the native controller described below. This transport selection has persistence/recovery contract coverage; browser checks do not establish actual native background execution.

The pinned upstream packaged workflow compiler routes semantic checks through the packaged compiler and the shared Bun/native-loader configuration when a runtime resource directory is selected. Missing packaged compiler files fail explicitly; the checker does not fall back to source dependencies. Browser development retains its existing Node/TypeScript path. The 15-second deadline, source/output bounds, allowed imports and default-export contract remain enforced. Run `agent:test` with the worker artifact to include production-checker integration; the packaged case is explicitly skipped without it.

On Android, the scheduled-digest controller configures native result delivery after verifying the selected agent session. Successful setup enables the shared encrypted inbox and background/notification preferences for the resident agent. Setup failure shows a foreground-only fallback; reconnect to retry. Disconnect retires the native delivery binding, while closing the Activity alone allows configured background delivery to continue. Android may delay polling beyond 15 minutes. Host tests cover the binding logic; actual WorkManager, notification and restart behavior still require device qualification.

Browser development also supports Camera photo preview/capture and a local Photos library. Camera access requires the browser's permission and a secure context (localhost qualifies). Captures use this browser origin's IndexedDB, separate from the agent's private host profile and Android MediaStore; clearing site data removes them. Photos can be favorited, moved to trash/restored, explicitly deleted, downloaded as JPEG, or rotated/cropped/filtered into a new copy. Edited copies are capped at a 2048-pixel longest edge; originals stay unchanged, and pending copy outcomes recover when Photos reopens. This path does not upload pixels to the agent. Browser implementations also provide MediaRecorder video, local albums, bulk sharing, local English OCR, document correction and reviewed multipage/searchable PDF export. See [browser parity](browser-dev-parity.md) and the [current review](mvp-browser-review.md) for each capability's evidence and limits. Media-device support in a test harness is not proof of hardware-camera compatibility.


## Host model selection

The host launchers share the new-profile default `qwen-3.8-27b`. Set upstream `CEREBRAS_MODEL` to select a model for a new private profile; availability still depends on the configured provider. Existing direct Cerebras profiles retain their saved `serviceRouting.llmText.smallModel` and `largeModel`, and the child environment now matches those values. An explicit override that disagrees with either saved model is rejected before launch. Update the reviewed profile routing or select a separate profile instead of silently replacing it. The combined launcher retains its stricter full-profile equality check.

For the separate development-backend launcher, `ALPHA_DEV_MODEL` takes precedence over the shared default. This host configuration does not change Android's encrypted provider/model settings, load an offline LLM, or establish current provider availability. The launcher regression uses synthetic credentials and a recording child process; it does not call a provider.


## Egress redaction prerequisite

The pinned upstream source includes the previously patched egress control-object handling. It preserves clean native cancellation signals while keeping forged/decorated objects inside the secret/PII data walkers, and supports host environment fallback for `ELIZA_SECRET_SWAP_ENABLED` and `ELIZA_PII_SWAP_ENABLED`. Explicit runtime settings take precedence. Fresh preparation is required after this manifest change; do not modify or reuse a differently stamped prepared checkout.

Source-level Node/Bun checks and full-series replay qualify this prerequisite. They do not establish that the running browser agent has redaction enabled or that every PII category/provider/action path is covered. Keep the current Privacy disclosure until enabled runtime and end-to-end restoration evidence support changing it. No Android build is needed to reproduce source preparation.


## Reproducible host redaction check

After preparing and installing the pinned runtime, run:

```sh
npm run agent:test-redaction -- --live
```

This opt-in check uses the configured Cerebras key and sends only synthetic contact and credential fixtures. It creates its own private profile and available loopback port; the running user profile is not used. The admitted source is checked before launch, both redaction switches are enabled only for the test host, and provider-request instrumentation records leak booleans rather than bodies or headers. Six buffered formats, streamed output and a distinct-process restart exercise contact restoration and credential exclusion. The command returns nonzero on any failed assertion or missing outbound evidence.

The summary is written to `test-results/local-redaction/result.json`. Successful runs remove their private synthetic profile; failures retain it in the printed temporary directory for diagnosis. SIGINT/SIGTERM stop only the owned process group. This is a real-provider host check, not browser rendering, Android privacy acceptance or proof that every possible secret format is recognized. Default development redaction settings remain unchanged.

## Current host redaction checkpoint (October 5)

Current-source checkpoint, October 5: the isolated command above passed on
`95924e90a75ec2b14f5835fa5f07d81115ccdb15` at `2026-10-05T21:43:29.723Z`.
Six synthetic formats, streaming, owner/contact restoration across a distinct
process restart, and all ten provider-bound wire checks passed. The private test
profile was removed on success. This qualifies the tested real-Cerebras host
requests only; approved device actions, broader categories/models and Android
still need qualification. The ordinary development host remains unchanged with
both swaps off by default. See the [integrated review](mvp-browser-review.md).

## Historical host redaction qualification (October 2)

The following dated checkpoints retain earlier failures and repairs. Patch names
refer to retired consumer patches now recorded in the [architecture and source ownership](architecture.md),
not files to apply to the current source. The [current status](mvp-current-status.md)
is the authority for later qualification and remaining work.

Setting both upstream switches `ELIZA_SECRET_SWAP_ENABLED=true` and `ELIZA_PII_SWAP_ENABLED=true` now opts the browser host launcher into both swap layers only after full composed-source verification. Invalid or partial selections and unqualified source fail before profile creation or child launch. The default remains off; process metadata records the requested mode, not a coverage claim.

Fresh pinned dependency installation and source re-verification succeeded. The isolated real host authenticated through the production Vite bridge and completed chat, but the synthetic email drafting probe returned a `__ELIZA_SECRET_…__` placeholder. A repeat request was also refused as a credential. This is a failed restoration acceptance check: the assistant reply boundary restores PII surrogates but does not restore secret-swap placeholders. Do not enable both layers in the user-facing session until safe reply restoration is implemented and tested, including protection against restoring actual provider credentials. Device enablement remains unqualified and was not included in this checkpoint.

Validation: five launcher tests pass, and product verification passes (93 tests, TypeScript and browser bundle). Evidence is in `test-results/redaction-boundary-review/launcher-verify.log`, `launcher-tests.log`, `install.log`, and `live-bridge.json`. No Android build or provider-wire capture was performed. The earlier pairing probe was unsuitable for this host's machine-session path; the production bridge was used for the decisive result.


## Personal-data reply restoration repair (October 2)

The new `egress-user-reply-restoration.patch` restores personal data captured by the secret detector at both the final assistant reply boundary and the visible stream boundary. Model-facing stream text remains substituted. Configured credentials, detected credential classes, overlapping credential values, and unresolved current-session placeholders remain redacted. Tool-parameter restoration remains separate. Secret classification takes precedence even when the same value was first recognized as contact data.

Evidence: 22 focused tests pass, including prior cancellation-control tests, session isolation, credential precedence and streamed placeholder splits. Fresh full-series preparation, pinned installation and source re-verification pass for `redaction-qualified-source-v4`. Product verification passes all 93 tests, TypeScript and the web bundle. The live production Vite bridge plus actual host/provider restored the synthetic email in streaming progress and terminal output. A buffered controlled prompt explicitly preserving opaque contact placeholders also restored correctly and persisted a two-message conversation.

Remaining: the ordinary buffered drafting probe had the model output `[secret omitted]` instead of retaining the contact placeholder. The patch cannot restore text the model discarded; contact-versus-credential placeholder semantics need further work before default enablement. The detection grammar is also not comprehensive: the initial lowercase unquoted `password=value` regression was outside the existing detector grammar; the precedence test uses its supported JSON credential form. Keep both swap layers off in the main development session pending broader model/action/restart qualification. Android enablement and physical-device acceptance remain unverified; no Android build was run.

Evidence: `test-results/redaction-boundary-review/reply-stream-tests.log`, `reply-product-verify.log`, `reply-prepare-v4.log`, `live-bridge-after-restoration.json` (ordinary buffered failure), `live-buffered-controlled-restoration.json` (controlled buffered pass), and `live-stream-after-restoration.json` (streamed pass). These are host/provider observations, not a capture of provider-bound traffic or proof of every PII category.

## Isolated digest process-recovery check

`npm run agent:test-digest-restart` kills a resident workflow worker while a scheduled digest is inside inference and checks what the runtime does next. It is a host test of the pinned upstream runtime with a synthetic model. It needs no emulator, account, provider key or network after preparation, and it is not Android evidence.

Preparation, from the repository root on a POSIX host with Bun and about 6 GB free:

```sh
git submodule update --init vendor/eliza     # the pinned commit in upstream.lock.json
ALPHA_RUNTIME_GIT_CACHE="$PWD/vendor/eliza" npm run agent:prepare
npm run agent:test-digest-restart
```

`agent:prepare` creates `artifacts/local-agent-resident-<commit>` from the pinned commit and runs `bun install --frozen-lockfile` in it (the install builds the workspace packages and takes several minutes). `ALPHA_RUNTIME_GIT_CACHE` only avoids a network fetch of the source; it does not change the commit. The check uses that directory by default. `ALPHA_ELIZA_SOURCE=/absolute/path` selects another prepared checkout of the same commit; a `--source-only` preparation is not enough. With no prepared source, no installed dependencies, a relative path or no Bun, the command exits 2 before starting any process and prints these steps. Remove `artifacts/local-agent-resident-<commit>/node_modules` (or the whole directory) afterwards to get the space back.

The command verifies the prepared source against the pinned commit before and after the run, and creates its own temporary working directory, database and workflow state. It kills only its own detached fixture process group after synthetic inference begins. Logs and results stay in the temporary evidence directory it prints; the live local-agent profile is untouched.

What a pass means: the interrupted run is kept as `outcome-unknown` with no finished result and no repeated inference; two concurrent duplicate admissions of the same occurrence return the same run ID; and a separate, never-admitted occurrence a day outside the schedule window produces one explicit `missed` result without running the backlog, with the next occurrence in the future. A fourth fresh runtime process then verifies the same missed receipt and exact future occurrence survive another restart; concurrent repeat admission still returns that missed run and makes no model call. It checks process-loss safety and overdue scheduling on a host. It does not check automatic recovery of an ambiguous worker outcome, Android background execution, physical power-loss durability or exactly-once provider calls.

The Resident source preparation workflow runs this campaign after installing the pinned runtime dependencies. Its `resident-prepare-evidence` artifact retains the supervised phase outcome and synthetic process logs/results, including failures; the temporary PGlite database is not uploaded. Source preparation alone is not a passing restart campaign.

This check is not part of `npm test` or `npm run verify`, because it needs prepared runtime dependencies; the Resident source preparation workflow runs it after preparation, and `.github/workflows/digest-restart.yml` runs it on dispatch, and also weekly and on pin or check changes on `main` once the CI owner sets the repository variable `DIGEST_RESTART_AUTOMATIC=true` (not a required check). `test/digest-restart-input.test.mjs` covers only its input admission. Recorded run (host-runtime evidence, not Android): product branch `claude/r5-runner-gaps`, the script as committed in `15d29c3d` (its test phases are unchanged from `8acc6e4b`; only input admission and result labels changed), upstream `352d7a0855b713319cbe1acdab5fbf556fb85aa8`, macOS arm64, Node 24.15.0, Bun 1.4.2, 2026-10-10: exit 0 twice (once with `ALPHA_ELIZA_SOURCE`, once with the default directory); one model call in the admit phase and none in recover or overdue; `recovered.json` `{"sameRunId":true,"resultCount":0,"duplicateAdmissionsSameRun":true,"reconciliation":"outcome-unknown","finished":false}`; `overdue-result.json` `{"status":"missed","resultCount":1,"nextOccurrenceFuture":true,"duplicateAdmissionSameRun":true}`. A changed upstream pin needs a new run. Latest recorded run: upstream `1f2a922f86e2a1f3d6cd62e097145492bd49ebfc`, Linux x86_64, Bun 1.3.14, 2026-10-28, exit 0 with the same recovered, overdue and overdue-restart results; see `docs/evidence/digest-restart-1f2a922f-20261028/`.

Repeated at pin `40dbe96bd1`, which round 9 has since replaced with `13c9857598` (host-runtime evidence, not Android; not run at `13c9857598`, so the last two runs are at `352d7a08` and `40dbe96bd1`): product branch `claude/r8-runner-ci` at `dc0baed4`, the script unchanged since `15d29c3d`, upstream `40dbe96bd1fc2603aaff655cd52d0ab899704e2c`, macOS arm64, Node 24.15.0, Bun 1.4.2, 2026-10-11. `ALPHA_RUNTIME_GIT_CACHE="$PWD/vendor/eliza" npm run agent:prepare` exit 0 (27,339 files, 3,236 packages, 5.8 GB; the dependency install was removed afterwards), then `npm run agent:test-digest-restart` with the default directory: exit 0 in 19 seconds, `{"evidenceClass":"host-runtime","upstreamCommit":"40dbe96b…","crashDuringInference":true,"preservedSameRun":true,"unknownOutcomeNotReplayed":true,"noFabricatedResult":true,"overdueSkippedWithoutInference":true,"modelAttempts":1}`; `recovered.json` `{"sameRunId":true,"resultCount":0,"duplicateAdmissionsSameRun":true,"reconciliation":"outcome-unknown","finished":false}` (its run id omitted here); `overdue-result.json` `{"status":"missed","resultCount":1,"nextOccurrenceFuture":true,"duplicateAdmissionSameRun":true}`; one model call, in the admit phase. One run. The evidence directory was a temporary folder and is not kept.

## Contact placeholder semantics (October 3)

`egress-contact-references.patch` gives detected email/phone data session-nonced `__ELIZA_CONTACT_…__` references. Credentials retain `__ELIZA_SECRET_…__`. Both forms share session-scoped resolution, unresolved-reference checks and streaming boundaries. A contact later classified as a credential remains blocked at the user-reply boundary; configured credentials and overlapping credential values retain precedence. The local execution boundary can still restore authorized parameters.

Fresh full-series preparation and source verification pass with manifest `113b0e72f49f258d651529186c6d2a927164a62999f206018394a19b614f6fcf`. Thirty-one focused tests pass, including cancellation-control objects, credential precedence, forged/session-isolated references and every tested stream split. The initial broad-suite invocation failed to resolve a core subpath; an external harness alias fixed resolution without changing runtime source. All failed attempts are retained alongside the passing log. Product verification passes 157 tests with zero skips, TypeScript and the web bundle.

An isolated host with both swap layers enabled used the production Vite bridge and real configured Cerebras model. Two ordinary email-drafting requests restored the exact synthetic email without placeholder instructions; a synthetic password-repeat request did not return the password. The actual streamed request restored both progress and terminal text. After restarting that isolated host, retained history and a follow-up restored the same email. Fetch instrumentation captured provider request-body checks (booleans only, no credentials or raw request bodies): all nine requests observed through these checks excluded the synthetic raw email/password, and included the relevant contact/secret markers. This is bounded proof for these probes, not a general privacy guarantee.

Evidence: `artifacts/calendar-preferences-review/test-results/contact-references/` contains preparation, source tests, product verification, provider/stream/restart results and the instrumentation harness. The earlier lowercase-assignment finding is already repaired by `egress-credential-assignments.patch`; those regression tests pass here. Both swaps remain off in the user-facing host pending broader contact/phone, approved action, mixed-data and provider coverage. No Android build or device acceptance is claimed.


## Mixed contact and credential qualification (October 3)

The first mixed email/phone/password draft altered a phone reference, leaving it unrestored. `egress-contact-guidance.patch` now adds explicit exact-copy guidance to text model requests containing CONTACT references, preserves SECRET restrictions and existing approval requirements, and removes only an exact duplicate leading system message before extending the canonical system prompt. It never guesses a contact from a corrupted reference. The guidance is included in the provider budgeted request and is absent when swapping is disabled.

Fresh source manifest `856e543ec6f38041a056d32f2e3d8d6df4cb96881fea58189150a2fe85f82255` passes full-series preparation/reverification. All 32 focused runtime tests and 157 repository tests, TypeScript and build pass. The real isolated host/model passed six repeated contact drafts (three mixed with a synthetic password), followed by a contact-to-credential promotion that refused disclosure. Streamed progress and terminal output restored both email and phone. A real generated local-note proposal displayed restored details, saved nothing before approval, and retained exactly one approved note after reload. Fourteen captured provider request-body checks excluded the exact raw synthetic email, phone and password, and all contact requests carried the guidance.

Failed attempts are retained: the first guidance implementation produced duplicate system messages rejected by the provider; a subsequent test edit accidentally referenced a fixture flag outside its helper. Both were corrected before delivery; the final native-message regression proves one canonical system prompt. Evidence is `artifacts/calendar-preferences-review/test-results/contact-mixed-review/`, with final evidence in `qualified/`. The original unmodified-reference failure and first successful approval journey remain at the top level.

Enablement remains blocked by a newly reproduced defect: a named six-character password is left in model-facing and visible text because the generic swap threshold is eight characters. `short-credential-probe.json` records boolean leak checks using synthetic input. Fix named short credentials without globally replacing ordinary short words; then qualify short/overlapping values, structured action parameters, and broader contact formats before enabling defaults. These results do not establish universal model reliability or physical-device privacy acceptance. No Android build ran.


## Short credential repair (October 3)

`egress-short-credentials.patch` repairs the reproduced six-character password leak. Explicit credential captures no longer have an eight-character minimum. Capture spans handle short punctuation-only assignments; known short values use token boundaries, and existing opaque references are preserved. Structured explicit credential fields are learned from a bounded descriptor snapshot before substitution, so a later password field protects earlier references. Generic `key` metadata, token budgets and correlation identifiers are not treated as credential fields. Credential overlap checks also use short-value boundaries rather than suppressing unrelated contact text.

Manifest `d570c03df74303368ed3e9ffeae4f1dbde1c7529136d1c806ef54e5d03394e3a` reproduces and re-verifies. All 45 focused runtime tests and 157 repository tests/typecheck/build pass. Cases include one-character and punctuation values, JSON syntax, whole-word boundaries, known configured credentials, structured-field ordering, contact overlap, existing placeholders, cancellation and stream splits. An initial broad structured-field classifier incorrectly treated tool-schema `key` metadata as credentials and caused real provider rejection; the final narrower classifier and schema regression test repair that failure. Failed source/test/provider attempts remain recorded.

The real isolated host/model passes six repeated contact drafts (three containing the unrelated short test password), contact-to-credential promotion, streamed contact output without the short password, and an approved local note. The note is absent before approval and retained once after reload with exact contact data and no test password. Fifteen captured provider request-body checks contain none of the exact raw synthetic email, phone or password values. Evidence: `artifacts/calendar-preferences-review/test-results/short-credential-review/`, with passing final evidence in `final/`.

This closes the named short-string credential defect for the tested paths. It is not universal secret detection, an arbitrary-format guarantee or device acceptance. Default swaps remain off while the broader redaction enablement campaign, current-source restart and native integration gates are completed. No Android build ran.


## Stored and encoded credential qualification — October 3

The October 3 qualification used `artifacts/calendar-preferences-review/artifacts/storage-credential-final`, consumer manifest `383de39c44aa5be6b99dffb91d285ca21b1055a86dff6ba4b70cf701998846ac`. It was restarted with the existing browser-agent profile; owner authentication, one agent, local workflows, Whisper and Kokoro all report ready. Both swap flags remain off by default. This is historical source evidence; consult [current MVP status](mvp-current-status.md) for the active development runtime. Fresh source reproduction and dependency installation remain governed by the commands above.

An isolated redaction-on campaign on this source passes five real-provider credential formats, streaming, and owner/contact restoration after an actual host restart. All eleven captured outbound body checks exclude the synthetic raw contacts and credential suffix. Incoming storage now masks complete credentials before the model sees them; nested JSON text/fragments are also protected with exact source-span restoration and bounded decoding. All 97 selected runtime/security tests and all 157 repository tests/typecheck/build pass.

Failed live attempts led to this repair and remain recorded under `test-results/current-redaction-live/`; passing results are in its `storage/` directory. `test-results/encoded-credential-review/` contains source/test evidence. The broader stage-one invalid-native-source failure was subsequently traced to a stale fixture that omitted the intentional single repair attempt. The fixture correction and combined 485-case campaign pass; production runtime behavior is unchanged. Native integration, wider model reliability and current-head full hosted qualification remain open. No Android build ran.

## Google service QA in a separate browser profile

Use `ALPHA_BROWSER_CLOUD_PROFILE=/private/separate/profile npm run dev:ui -- --port 5209 --strictPort`
for Google-service-only QA without another agent backend. Sign in through the normal
Eliza Cloud flow. Google authorization is separate from both that Cloud identity
and the inference provider; use **Settings → Accounts → Google accounts**, Inbox's
**Connect Gmail**, or Calendar's connection button.

The shared connection panel requests Gmail and Calendar read access. It reports
server-returned grants, offers explicit calendar selection, and keeps provider events
read-only and separate from app/native Calendar writes. Gmail permission upgrades
retain already-selected Calendar read access. Event writes and mail sending are not
part of read-only qualification.

**Disconnect Google account** removes the entire stored Google connection (Gmail
and Calendar together), verifies account readback, and invalidates both views. It does
not delete the Google account, mail or events. An uncertain disconnect remains
unconfirmed; the user can check again. Reconnect uses the normal Google consent flow.
Calendar selection contains only nonsecret source identifiers scoped to the Cloud
user and organization. No provider tokens or calendar event content are stored in it.
