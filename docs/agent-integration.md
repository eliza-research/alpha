# Alpha agent integration contract

Alpha owns its renderer, view policy, connection choices and approval UI. Shared
runtime and protocol implementations come from the revision in `upstream.lock.json`.
The primary deployment is an Android-resident agent with explicitly configured
inference; Cloud and remote agents are separate supported connection paths.
See [architecture](architecture.md), [local agent setup](local-agent-development.md)
and [current product status](mvp-current-status.md) for deployment and acceptance limits.

## Renderer boundary

`apps/app/src/runtime/alpha-client.ts` is the browser-safe integration boundary.
Its public state contains connection status, pending work, nonsecret identity and
versioned view context. Subscriptions return an unsubscribe callback. View and
selection changes must call `setViewContext`; selected-object metadata contains
opaque identifiers and revisions, not file bodies, credentials or hidden content.

`send` requires a verified transport and an allowed, nonsensitive context. Present
the exact proposal before calling `approve`.

Draft preservation is not yet complete. The composer
(`prototype/agent-adapter.ts`) consumes the conversation-bound draft and clears the
input before it connects or dispatches. A failure before dispatch, such as no
selected agent connection, a changed screen or a changed agent, leaves the text only
in the user bubble, not in the composer. The required behavior, still open, is to
consume the draft only after dispatch succeeds, to restore the text after any
pre-dispatch failure, and to offer a history check rather than a blind resend after
an interrupted stream. Typed drafts survive navigation, resize and restart only while
they remain unsent; the [current status](mvp-current-status.md) tracks the remaining
gap.
Agent prose never authorizes an action. `cancel` retires pending UI work and
proposals; it cannot roll back an already dispatched effect. `disconnect` retires
the transport, but credential revocation belongs to its authentication controller.
`attachVerifiedTransport` is a trusted composition API, never a login form or a
capability exposed to third-party web content.

Context changes and connection epochs reject late replies and approvals. Copy
reviewed inputs and bind them to identity, selection, expiration and target
preconditions. An ambiguous write requires receipt reconciliation; do not retry
its effect automatically. In-memory proposal consumption alone is not durable
execution deduplication.

## Connection and service ownership

`runtime/connection-ui.tsx` owns the chooser and connection controller.
`runtime/native-connection.ts` adapts native HTTP and credential operations;
`AlphaConnectionPlugin` supplies encrypted Android credential storage. Public
selection preferences and conversation mappings are not authentication evidence.
Restoring a saved choice requires fresh authenticated verification. Protocol code
may access credentials through its injected store; this is not a claim that
credentials never enter JavaScript memory.

| Domain | Authority | Lifetime |
| --- | --- | --- |
| Cloud services | Verified environment, account and service session | Independent of a separately paired agent; sign-out retires account-bound requests and data |
| Agent target | Verified origin, owner, agent and conversation | Target changes retire pending chat, proposals and target-bound results |
| Local development bridge | Explicit loopback host and temporary debug token | Debug-only acceptance lane; not production authentication |
| Offline or mock | Explicit user selection | No implicit live connection or fixture action promoted to a real effect |

`getCloudClient()` and `getCloudEnvironment()` use the independent service session.
Gmail and Cloud speech must bind that session; a remote agent selection does not
itself authorize access to Cloud account data. OAuth consent is not consent to
send mailbox contents to another agent. Sign-out, account replacement, revoked
authority and target changes must reject stale callbacks against the relevant
captured identities.

Conversation selection is scoped to origin, owner and agent. Explicit restoration
checks conversation membership and accepts historical user/assistant text, not
executable historical actions. Context prefixes are removed only when they match
the exact current envelope. The controller rejects histories over 2,000 records;
a bounded server response is not proof of complete archival recovery.

## Actions and workflows

`runtime/device-actions.ts` consumes the admitted upstream device-action contract.
Remote/local enrollment binds the installation key to origin, owner and agent.
Unsupported hosts may retain typed chat without device authority. Exact proposals
must pass identity, digest, expiry, operation-union and current-context checks.

Reserve the native journal before claiming an effect. Persist an accepted claim
before dispatch, then persist its terminal receipt before acknowledgment. Lost
claim responses, interrupted writes and duplicate entries require reconciliation,
not execution replay. Receipt synchronization repeats the receipt only. A reminder
receipt establishes scheduling, not delivery; opening a browser establishes the
navigation request, not successful page loading or content observation.

`runtime/workflow-protocol.ts` handles capability discovery, typed draft generation,
remote definitions, reviewed runs, cancellation and execution receipts. Generation
must retain selected read scopes and admitted operations. Run admission uses
expected versions and submission reconciliation when the host advertises those
capabilities. An unknown response must not trigger another submission: the phone
first reads the exact submission receipt. Only when the agent reports no run for that
submission ID may the owner confirm sending the same request again under the same ID
and reviewed version, which the agent admits at most once; an agent without
submission identities is never sent a repeat. If the workflow version changed before
any admission, the request can no longer be admitted and is closed as not run. Pause does
not cancel an existing run; a queued receipt is not successful completion.
Execution updates use explicit receipt reads. Approval and cancellation correctness
does not depend on a continuous event stream; a dropped connection requires an
authoritative receipt read before presenting the outcome.
See [workflow lifecycle](workflow-lifecycle-validation.md) and
[mobile workflow packaging](mobile-workflow-packaging.md) for the owning contracts.

## Cloud mail and voice

The Inbox adapter binds requests to the verified service session, account and
query. Its 25-to-50 result expansion is bounded search, not mailbox pagination.
Changing account/query or signing out discards stale results. Read grants do not
imply send grants; send/reply requires exact recipient/body review, account binding,
provider receipts and unknown-outcome recovery. Attachments require explicit
review before saving or handing data to another app.

Voice capture, ASR, reply generation and TTS have separate ownership and consent.
A transcription is an editable draft, not an automatic message or saved note.
Bind remote speech to the selected service identity; retire late capture/upload/
playback results after cancellation or account changes. Do not upload hidden
context or history as an implicit side effect of read-aloud. Local speech setup
and its evidence are documented in [local agent development](local-agent-development.md)
and [fused speech](fused-speech.md) (the libelizainference engine used on the phone and by the local agent).

## Development runtime

`backend/runtime.ts` composes the pinned runtime with Alpha's development character,
allowed proposals and local conversation identity. It deliberately registers only
the configured Cerebras text provider: no embedding handlers, fake vectors or
semantic-recall claim. Conversation history remains stored. `backend/loader.ts`
authenticates source before bundling through the upstream consumer resolver.

```sh
npm ci --prefix backend --ignore-scripts --legacy-peer-deps
npm run agent:dev
```

Use an already authorized environment with `CEREBRAS_API_KEY` and
`CEREBRAS_BASE_URL`; do not store credentials in the repository or APK. The host
prints an owner-only temporary token file path. For an owned debug emulator,
`node scripts/configure-dev-agent.mjs` provisions the debug bridge and port reverse.
`npm run agent:diagnostic` selects the direct Cerebras request path. It uses the same pinned canonical tool schemas, validators and non-effecting preparation host as `agent:dev`; it does not send diagnostic turns through runtime conversation memory. Both commands explicitly enable `ELIZA_DEV_ALLOW_TEST_MOCKS=1` and require Bun. For the full local host and resident
runtime, follow [local agent setup](local-agent-development.md).

`bun run backend/test-runtime.ts` is separate live acceptance: it uses a private
fixture for real model turns, new-process history, cancellation and proposal-only
actions. Note and reminder review is a simulation: it never writes a note or schedules a notification. View navigation can open only a registered local view after review. `scripts/test-dev-agent.mjs` exercises the host protocol and checks that proposals are marked simulated. Neither proves Android UI execution. Local ASR's
host-only and HTTP checks were in the retired `test-local-asr.mjs` (Whisper era, deleted on
2026-10-14); the current ASR route contract is checked against the pinned upstream workers.

## Verification boundaries

Loopback HTTP fixtures verify protocol and lifecycle behavior, not live accounts,
provider grants or native disk durability. Repository tests and APK builds do not
establish emulator HOME behavior, resident process recovery, AOSP boot or physical
device acceptance. Retain evidence tied to the tested source and artifacts.
Required live checks include authentication/revocation, account and owner isolation,
conversation recovery, unknown-write reconciliation, real approved actions,
mail grants and receipts, voice interruption, and offline/mock isolation.

Native arithmetic workflow acceptance (`WorkflowInstrumentedTest`, opt-in argument
`workflows=true`; the class was deleted in `8452394f`, round 9: its runner was gone and it could not run; historical) previously ran through a dedicated wrapper. That wrapper and the
other aggregate smoke runners were removed on October 8 at the owner's request, so
there is no current repository runner for this case. A re-run needs an owned
disposable emulator, a matching archived app/test APK pair, an OWNER session from
ordinary pairing and the exact inactive arithmetic-only fixture created and inspected
with `scripts/test-real-workflow.mjs`. The class no longer exists, so a re-run first needs a new instrumented test. A direct run does not repeat the wrapper's host-side
list/detail and source checks, so record it as a different result from the archived
runs. Keep the fixture free from concurrent edits. Never pass session credentials as
arguments, and never reuse a historical workflow UUID as proof of current admission.
The isolated native workflow campaign that does exist is
`node scripts/android-workflow-native.mjs` (see [verification](verification.md)).

## Ownership and recovery invariants

- Voice preparation captures the initiating view, agent and Cloud identity, and
  connection mode. Success and failure both recheck ownership before navigation
  or fallback. Navigation, hidden/pagehide and unmount retire outstanding probes;
  returning to a view does not revive them. A pending note save locks its reviewed
  transcript; a late completion cannot close a newer recording or publish an old
  error. An authorized committed write remains persisted after UI cancellation.
- Cloud delegation submits completion once, then reconciles through read-only
  status. Uncertain pending state remains recoverable; no automatic resubmission.
  Recheck ownership after secure-store operations. Session expiry clears only the
  matching binding, while ordinary failures must not masquerade as expiry.
- Gmail reads capture the selected account, grant, session and operation. Retiring
  them prevents late draft/undo/receipt updates. Cancelling an inbox, search or
  connection read preserves unsaved edits; full teardown belongs to owner change
  or unmount. Restoring a grant does not silently fetch or send mail.
- Authenticated device enrollment negotiates an owner/agent/device-bound view
  profile revision. Discovery, proposal review and execution all enforce it.
  Unknown legacy negotiation grants no additional authority. Lost conditional
  updates are reconciled by reads, never blindly replayed.
- Notification taps retain opaque encrypted tokens bound to exact owner, agent,
  execution/occurrence and revision. Opening a tap only resolves its target;
  it never approves, executes or completes it. Failed capture remains retryable;
  consumption requires the exact pending token. Bounded ledgers fail closed
  rather than evicting pending or deduplication history. Public credential APIs
  must not expose native authority namespaces.
- Reminder creation persists its identity and original receipt before effects.
  Due time, alert lead and civil recurrence remain independently reviewed; no-alert
  records neither request alert permission nor schedule alarms. Edits preserve
  completed history and require explicit review for another occurrence. Snooze
  changes delivery time without rewriting the original schedule. Clock handoff
  receipts distinguish dispatch from confirmed alarm state; targetless actions
  require manual target selection in Clock.

Qualification must preserve those boundaries: notification recovery sends the
original PendingIntent once and observes readiness within the existing deadline;
unknown publication receipts are polled without reposting. Process-death tests
prove the exact old process is absent and a new process receives the original tap;
Activity recreation and force-stop are different cases. Native crash diagnostics
retain only bounded numeric attribution for the exact worker, preserve the primary
failure and cleanup, and never weaken seccomp or SELinux to obtain a pass.

## Accepted limits and gates recorded at the MVP completion integration

- Resident pre-enrollment (MVP-16): two surfaces that start before the resident agent's owner
  enrollment completes do not share the pending pairing; the second takes the ordinary start
  path, and a completed enrollment is attached to. This is kept as an accepted limit, and the
  host JVM contract asserts it (merged with `0fd9c5b8`). It is class S only.
- Direct Cerebras key (A-20): a flag-off build still admits `configureProvider` with a direct
  Cerebras key, because `ResidentAgentInstrumentedTest` configures the resident agent through
  it. The Cloud branch is limited to `cerebras` and `qwen-3.8-27b` and its environment drops
  every direct-provider variable (`LocalAgentProviderAdmissionTest`, host JVM). Whether the
  direct key stays is [A-20](decisions.md#new-decision-items).
- Account replacement (AP-03): a Cloud sign-in as a second account revokes the first
  account's key once, before the new key is stored, unless Cloud hands back the same key
  (`cloud-account-replacement.production.spec.ts`, `scripts/test-cloud-protocol.mjs`). The
  resident conversation history is kept on the phone under the local owner, not under the
  Cloud account, so the second account's session restores the conversation started under the
  first. That is current behaviour, recorded here; no owner decision covers it yet.
- Zero Cloud balance at sign-in (loop A): the sign-in is kept so the owner can add credits,
  but no agent is started, no provider is bound and no selection is written
  (`resident-first-run.production.spec.ts`). The audit asked for no credential to be left;
  this is a recorded deviation.
- J03 document grants: a content question keeps its `a1:` source reference, and the grant is
  kept for 3 days (the Trash retention) from the time the reference was last retained, stored
  beside it, so a summary note saved later still has its link (`443bfb4f`). After 3 days
  unreferenced, the reference and its grant are released, and a note saved after that has
  no link; this is the limit.

## Upstream changes in the 13c9857598 to bc71e21f3b move

On 2026-10-13 (branch `claude/mvp-final`, not pushed) the pin moved from `13c9857598` to
`bc71e21f3b`, the elizaOS `develop` head at the time, which `scripts/ci/upstream-reachability.json`
records as identical to `develop`. The range holds 1051 commits (879 non-merge,
`git -C vendor/eliza log --no-merges 13c9857598..bc71e21f3b`), so this section lists the eleven
Alpha pull requests it was taken for and every other change to code that Alpha compiles from the
pin (the Gradle modules in `android/settings.gradle`, the staged native classes and the copied
client features). The rest reaches Alpha only through the resident runtime source that
`npm run agent:prepare` stages, with no Alpha-specific test. Every result is class S or a Gradle
compilation; nothing here ran on an emulator or a device.

| Upstream change | What Alpha does with it | Test |
| --- | --- | --- |
| #35906 register `POST /api/workflow/hosted/dossier` | The resident agent registers the dossier route; the renderer offers the dossier with native phone sources on the resident agent (`hosted-digest-ui.tsx`), with the request body unchanged and capped at 2000 bytes by the dispatcher and the handler | `test/digest-route-registration.test.mjs`, `test/digest-capabilities.test.mjs` |
| #35907 `clientMessageId` on history user rows | Stop's single reconciliation read matches the stopped turn by the `clientMessageId` it was sent with; the text and time match is kept only when no row carries an id (older agents, shared-tier Cloud) (shared `conversation-turn-controller.ts` matcher, `connection-ui.tsx`) | `test/stopped-reply-match.test.mjs`, `scripts/test-connection-history.mjs` |
| #35908 Gmail `mailboxHistoryId` per search page | `gmailSearch` parses it; the Inbox keeps the first page's value and treats a later page with another as a changed list (Load newer mail), even when no row repeats. Needs the deployed Eliza Cloud to include the change | `scripts/test-cloud-protocol.mjs`, `scripts/test-inbox-cloud-flow.mjs` |
| #35909 `SystemLauncherApps` by component and profile | Alpha lists, launches and hands off to the dialer only through the shared ElizaSystem (`createSystemLauncherBridge`); `DeviceAppsPlugin` is deleted and the `failed` code, package-only refusal wording and malformed-request guard are upstream. Upstream sorts by label; the renderer sorts itself | `LauncherAppsInstrumentedTest` (compiled, not run) |
| #35910 retained limit for JSON slots | `AlphaCredentialStore` passes `retainedLimit` (32 MiB for `notes-trash:v1:device`, else the slot limit), lowers the Trash cap to the 30 MiB policy limit and reports `CapacityException` as storage-full on every write path | `NotesStorageDurabilityInstrumentedTest` (compiled, not run) |
| #35911 free/busy read of selected calendars | `CalendarAvailabilityReader.java` deleted; `AlphaCalendarPlugin` calls `SelectedCalendarReader.availabilitySources` and `readAvailability`, after `assertSourceIdentities` and Alpha's own fail-closed freshness gate (`CalendarSyncFreshness.java`, only device-local calendars; from main's `bed4b60b2`, which the upstream reader does not have); the zone check moved to `CalendarZones.java`; the 200-interval journal bound stays Alpha's | `test/calendar-availability-reader.test.mjs` (the upstream reader on the JVM) |
| #35912 `creationId` on events the host created | Note links for device-calendar events are keyed by the `creationId` Alpha saves with, not the reusable row id; events from the Android Calendar hand-off are not linked and say so | `scripts/test-calendar-crud-review.mjs`, `journey-j04-android.production.spec.ts` |
| #35913 Calendar review names the account and attendees | Inherited by `AlphaCalendarPlugin`; the review reads "Calendar: On this phone" and "Account: Alpha Phone (this phone only)" | `CalendarAgentCrudInstrumentedTest` checks the text (compiled, not run) |
| #36123 no reply, transcript or image text in bionic inference logs | Staged in the resident runtime source | None in this repository |
| #36124 handlebars 4.7.10, `@ai-sdk/openai` 3.0.118 | Resident dependency audit: the three handlebars advisories and GHSA-866g-f22w-33x8 are gone; their pending fix and exception were removed (`docs/dependency-audit.dispositions.json`) | `node scripts/dependency-audit.mjs --resident`, `test/dependency-audit.test.mjs` |
| #36126 llama.cpp at elizaOS/llama.cpp `7efee0037524` (#58: CVE-2026-107183, and CVE-2026-52132 for the `/rerank` `top_n` bound) | The voice host record names the new pin and engine commit (it holds no qualified binaries). The reviewed ARM64 embedding host was built from the earlier engine, so `android/embedding-host/qualified-host.json` is marked for requalification and distribution builds refuse it; a candidate built at the new engine is recorded there, unreviewed | `test/embedding-host-admission.test.mjs`, `test/voice-host-record.test.mjs` |
| `87fd32888d` and follow-ups: protected native password editor (`openEditor`) | Not used: Alpha's form calls `save`. The development vault implements `openEditor` as unavailable, like the web plugin | `npm run typecheck` |
| `a7056c4adc` versioned device-unlocked custody migration for passwords and secure store | Consumed through the Gradle modules; the migration runs in upstream code on existing vaults | None in this repository; an installed-upgrade run is needed (class E) |
| `eaafb8b7b0`, `4e2b5834e4`, `5820a185bf` secure-store task data key custody and Cloud-owner activation binding | Consumed through the Gradle module; not called by Alpha | Gradle compilation |
| `d87a58d36e` on-device Kokoro voice library and local transcription in `packages/app` | Changes the native build input `stage-elizavoice-lib.ts`, which is part of the embedding host requalification above | `test/embedding-host-admission.test.mjs` |
| `a90c52d8dc`, `c1f9a60373`, `c7a764266d`, `514757be39`, `f612e8c48e`, `ad02f1e2ae` in `plugins/plugin-workflow` | Staged in the resident runtime | None in this repository |

## Upstream commits in the last pin move

The pin moved from `40dbe96bd1` to `13c9857598` in round 9 (the move before `bc71e21f3b`). These are the 16 non-merge commits
in that range (`git -C vendor/eliza log --no-merges 40dbe96bd1..13c9857598`, read-only), with
what Alpha does with each. "Consumed" means Alpha's build includes the changed file and a
product path runs it; "staged" means it is in the resident runtime source that
`npm run agent:prepare` stages, with no Alpha-specific test; "not consumed" means no Alpha
build includes it. Every result is class S or less; nothing here ran on an emulator or device.

| Commit | Change | Disposition | Path into Alpha | Test |
| --- | --- | --- | --- | --- |
| `2a940de821` | Shared native notification delivery receipts with host configuration | Consumed | Gradle includes `plugin-native-notifications`; `WorkflowNoticeDelivery` configures `NoticeDelivery` with Alpha's slot names and record formats | `test/workflow-notice-delivery.test.mjs`, `test/workflow-approval-notice.test.mjs` (host JVM); `WorkflowApprovalNoticeInstrumentedTest` passed at round 8 (class E, developer APKs) |
| `af3fbf924a` | Retain an approval withdrawal before the first notification publish | Consumed | Same `NoticeDelivery` class | Same tests |
| `6db46e188f` | elizacloud: report billed usage before rejecting an incomplete output | Staged | Resident runtime (`plugin-elizacloud`), the Cloud inference route | None in this repository |
| `0e677fe010` | openai: report billed usage before rejecting an incomplete output | Staged, not on Alpha's route | Resident runtime source; Alpha's resident agent uses Eliza Cloud or direct Cerebras, and the Cloud environment removes `OPENAI_*` | `LocalAgentProviderAdmissionTest` (the variables are removed) |
| `1aa07e01f3` | core: match a whole language subtag in `normalizeCharacterLanguage` | Staged | Resident runtime (`packages/core`) | None in this repository |
| `dbcd5ff4c0` | core: end the first sentence at a question mark after a.m. or p.m. | Staged | Resident runtime (`packages/core` text splitting) | None in this repository |
| `92ad9b6d21` | personal-assistant: preserve historical goal sleep time zones | Staged, no Alpha flow depends on it | Resident runtime source; the host launchers (`scripts/start-local-remote.mjs` and the others) disable `personal-assistant`; whether the Android resident loads it was not checked for this table | None |
| `bc58086519` | personal-assistant: owner time zone for the bulk reschedule window | Staged, no Alpha flow depends on it | As above | None |
| `bf711ca611` | personal-assistant: owner time zone for the activity profile | Staged, no Alpha flow depends on it | As above | None |
| `29c1b7ee8a` | lifeops: keep a by-weekday deadline | Staged, no Alpha flow depends on it | As above (`plugin-personal-assistant`) | None |
| `915f31688c` | health: seconds for screen time under a minute | Staged, no Alpha flow depends on it | Resident runtime source; Alpha has no health view | None |
| `0bdb664342` | plugin-health: average heart-rate readings | Staged, no Alpha flow depends on it | As above | None |
| `d68625ff72` | plugin-maps: show the error message from the view broker result | Not consumed | Alpha copies only `plugins/plugin-maps/src/client` (`scripts/prepare-client-features.mjs`); the changed component is not copied | None |
| `bab66a0719` | cloud: claim grace for a delivery intent stored without `dispatchedAt` | Not consumed | Eliza Cloud server code; Alpha is a client of the deployed service | None |
| `7460221ec7` | cloud: voice prices under the API Explorer endpoint ids | Not consumed | Eliza Cloud server code | None |
| `a2cc057730` | Keep the shared transport dependency in the pruned gateway image | Not consumed | Eliza Cloud gateway image | None |

`scripts/ci/upstream-reachability.json` records that the pin is reachable from `develop` and
has no pin-only commits; it did not need a change for this table.
