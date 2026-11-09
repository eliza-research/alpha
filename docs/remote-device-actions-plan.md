# Remote agent actions on Alpha Phone

Reviewed 2026-09-29. This is a proposed integration, not an implemented or verified remote execution capability. Build30 source remains unchanged by this review.

## Finding

The current REST conversation response is not a phone command channel. Alpha's current-turn context identifies its screen and opaque selected object, but does not grant device access. No source-backed API found in the reviewed checkouts directly delivers durable, owner-approved native Alpha commands and reconciles their receipts. Do not interpret assistant prose, code fences, arbitrary JSON, or chat `actionResults` as executable phone instructions.

There are two reusable upstream mechanisms: the mounted-view interaction transport and the durable approval execution queue. Neither alone implements the required phone flow.

## Existing mechanisms and precise boundaries

Historical (2026-09-29). This table records the mechanisms reviewed before device actions were built. Phone actions now run through the shared device-action coordinator in `plugin-assistant`; see `docs/agent-view-coverage.md` for the current families, review policy and `VIEWS` navigation states.

| Mechanism | Current source and contract | Reuse and missing work |
| --- | --- | --- |
| Conversation REST | `packages/agent/src/api/conversation-routes.ts`; `packages/ui/src/api/client-chat.ts`. POST `/api/conversations/:id/messages` returns assistant text and optional action-result summaries. | Those results describe server-side work. They are not pending phone proposals and cannot authorize client effects. |
| Mounted-view dispatch | `packages/agent/src/api/views-routes.ts` builds targeted WebSocket frame `{type:'view:interact',installationId,viewId,viewType,capability,params,requestId}`. | A real existing server-to-client transport. Requires registered runtime views, an authenticated client connection and matching installation. Alpha currently has neither the matching registry nor that WebSocket channel. Do not map Alpha to unrelated stock Eliza views. |
| Interaction claim | POST `/api/views/interact-claim` with `{clientId,requestId,viewId,viewType,installationId}` returns `{claimId}`. `view-interaction-host.ts` binds the claim to the pending client and current registry installation, with role checks. | Preserves at-most-one claim within a live host. It is not a human approval or durable execution journal. The host stores pending entries in memory and rejects pending work when the runtime closes. |
| Interaction result | POST `/api/views/interact-result`, or WebSocket `view:interact:result`, carries the same identity plus `claimId`, `success`, optional `result`/`error`. | Reuse correlation semantics. Result HTTP `{ok:true}` is not proof the effect succeeded or a durable receipt was committed; the matcher can ignore stale/mismatched results. Add an acknowledged durable receipt contract for phone effects. |
| Renderer handler | `packages/ui/src/components/views/view-interact-registry.ts`: register mounted handler, claim request, ensure registration unchanged, invoke handler, report result. Its handled-ID memory expires after 60 seconds. | Good installation/stale-owner checks. Invocation occurs without a phone-specific human confirmation. Not sufficient for replay protection after process death. Do not copy its short-lived cache as the native mutation ledger. |
| Approval read surface | GET `/api/approvals` in `packages/agent/src/api/approval-routes.ts` exposes `pending`, `pendingUserActions`, and approval DTOs. Other verbs/subpaths are rejected by this handler. | Source-backed read API only. Its queue projection uses `subjectUserId:null` at this layer; do not assume it is already scoped to the current phone/account. A phone-specific authenticated projection must derive owner and target device on the server. |
| Durable approval execution | `plugins/plugin-assistant/src/services/approval/types.ts` and `store.ts`: protocol `eliza.approval-execution`, version 2; enqueue, approve/reject, claimExecution, markDispatchStarted, markDone, markRetryableFailure, markReconciliationRequired, reconcileExecution. | Reuse the persisted queue, transactional idempotency and explicit uncertain-outcome states. Existing action discriminants include email/messages/calendar/calls/workflows/travel/spending, not local note/reminder/navigation operations. Extend typed payloads intentionally, with migrations/compatibility where required. |
| Remote agent request | `packages/core/src/contracts/remote-agent-request.ts`: validated `agent.request` routes for health/status/conversation operations. | Requests flow toward an agent. This does not let that agent call arbitrary Capacitor methods back on the phone. |
| Existing Alpha debug actions | `apps/app/src/runtime/development-transport.ts` and `scripts/dev-agent.mjs`: model tool proposals for `create_note`, `create_reminder`, `open_view`, retained exact proposal, expiry/context checks, consume before local dispatch. | Useful product schemas and approval UI. Its custom development protocol/in-memory pending map is not production ownership, durable execution or a substitute for upstream integration. |
| Cloud shared runtime | `packages/cloud/shared/src/lib/services/shared-runtime/shared-rest-adapter.ts` reports no WebSocket/per-agent command registry for the shared adapter. Shared conversation routes execute text turns through their coordinator. | A dedicated-host WebSocket integration alone will not satisfy shared Cloud. A common durable HTTP proposal/decision/receipt projection must be implemented in shared Cloud too, with its account/org authorization and storage owner. |

The reviewed v3 paths are under `/Users/shawwalters/v3`; equivalent app/agent/view/approval mechanisms were located in `/Users/shawwalters/eliza-workspace/milady/eliza`. These source contracts must be checked again against the exact deployed revision before implementing deployment-specific assumptions.

## Smallest complete implementation

Reuse the approval execution service as the canonical durable owner. Add narrowly typed **client-device operations** and a versioned authenticated HTTP projection. This is new upstream work, not an already available endpoint. Reuse the view installation and claim identity pattern, rather than importing the whole stock renderer or building an unrelated queue.

1. Register an Alpha device capability installation against the authenticated owner, agent and session. Native generates/persists a device ID; the server verifies it under the session and returns an installation ID. Advertise only actual implemented operations and schema versions. The UI must show when this connection can propose phone actions. Revocation invalidates the installation.
2. Add an agent tool that creates an approval record for the target device. Tool execution only proposes. It must never return “saved”, “opened” or “scheduled” at this point. Enqueue under the existing transaction/idempotency owner. Bind the authenticated conversation principal and explicit target installation; the model cannot choose arbitrary owner IDs.
3. Add a typed read projection for pending operations. A provisional API layout is `/api/client-devices/:installationId/proposals`; names are design placeholders until the owning upstream patch is accepted. Fetching is read-only and repeatable. Each record includes immutable operation/schema, exact parameter digest, owner/agent/device/installation/conversation IDs, observation revision, selected-object precondition, creation/expiry, and proposal ID.
4. Alpha renders the exact operation and target in the existing approval card. Confirmation is a separate foreground user gesture. The current account, connection epoch, device installation and observation must still match. If anything changed, request a fresh proposal; do not silently mutate the retained parameters. Rejection records a decision without an effect.
5. A new decision/claim endpoint atomically validates owner, device, version, payload digest, expiry and current approval state before issuing a dispatch attempt ID. Reuse `approve` and `claimExecution`, extending the API around them. Neither arbitrary chat text nor a successful fetch is approval.
6. Before invoking a native mutation, durably write a local pending receipt keyed by owner+agent+installation+proposal+attempt. Mark dispatch started through the canonical service. Device-specific mutation code consumes the same key and returns a stable object ID/receipt. The effect and local operation journal should share a transaction wherever the data store supports it.
7. Upload the receipt through a typed, idempotent endpoint. Server `markDone` happens only with a confirmed effect result. Repeated receipt delivery must return the same committed result. A failed upload does not repeat the effect. The model receives a result only after a verified receipt, or an explicit pending/unknown state.
8. Process death after dispatch is **unknown**, not safe-to-retry. Reconcile using the local journal and provider/object IDs. Reuse `markReconciliationRequired` and `reconcileExecution`; only proven non-dispatch can become retryable. Server restart, socket reconnect and installation replacement never silently replay effects.

The same HTTP projection can run on a dedicated/self-hosted agent and on the Cloud shared coordinator. Keep model tools, approval types and receipt semantics shared. Deployment-specific authorization/storage adapters must not fork the contract. WebSocket delivery can be an optional wake-up notification later; it must not be the durable queue.

## First operation set

| Operation | Exact review | Execution/receipt boundary |
| --- | --- | --- |
| Create note | Title and complete body, target “this phone”, new versus existing note. | Existing Alpha note store needs a durable operation-key index. A verified persisted note ID/body revision is success. Never substitute a remote server note. |
| Create reminder | Title/body, absolute timestamp, rendered local date/time and timezone, target “this phone”. | Existing native reminder scheduling should accept the stable operation key and return its reminder ID. Permission denial, scheduling acceptance and actual delivered notification are distinct evidence. |
| Open Alpha view | Allowlisted view name; selected object only if still valid under the current account. | Confirm actual renderer route after dispatch. A navigation receipt does not imply record creation or external app access. |
| Browser navigation | Canonical HTTP(S) destination, browser surface and current-tab/new-tab choice. | Use Alpha's isolated native browser controller, not JavaScript injection or system-wide intents inferred from prose. Report navigation accepted versus document loaded separately. Credentials/sensitive destinations must not enter a model-visible receipt. |

Do not add arbitrary `invokePlugin`, JS evaluation, shell commands, selector execution or unconstrained URL intents. Later camera/photos/files/calendar/mail workflows require their own typed operations, capability disclosure and precondition/receipt definitions. Selection/read permission does not authorize deletion, sharing or sending.

## Required binding and failure checks

- Server derives owner/account and authorization from the verified session. Device IDs, client IDs and installation IDs supplied in a request are correlation data, not authentication.
- Every approval, dispatch and receipt binds agent, owner, device installation, operation version, payload hash, request ID and observation revision. Changing a parameter requires a new review.
- Local storage must namespace every object/receipt by owner/account where the product supports separate accounts; existing device-local notes must not be falsely labelled cloud-owned.
- Expiry/revocation between display and tap is rejected. Switching account/view clears the displayed approval and cancels only undispatched work. Already dispatched work remains pending reconciliation.
- Native method availability and Android permission checks happen again at execution. Capability advertisement cannot bypass current Android permission state.
- Error bodies and audit records must not contain tokens, raw passwords, OAuth URLs, file contents or full sensitive browser URLs. Do not remove the exact proposal text from the user's review just to simplify logging.

## End-to-end acceptance

Run against the actual app host and both APK variants, then against the exact enclave revision and shared Cloud deployment:

1. Agent proposes creating a synthetic local note; before approval no note exists. Approve once, verify persisted body and receipt, relaunch and verify exactly one note. Reject a second proposal and verify no effect.
2. Duplicate proposal poll/decision/claim/receipt calls and network retries do not create duplicates. Concurrent devices cannot claim each other's installations.
3. Change account, view, selected-note revision, parameters, installation or expiry before approval: reject without dispatch. Replay an old signed-in session after revocation: reject.
4. Kill app before claim, after claim, after local effect but before receipt upload, and after acknowledged receipt. Reconcile with one effect or an explicit unknown state; never automatically repeat a possible effect.
5. Server/Cloud restart does not lose approval state. A receipt for a retired view installation cannot settle unrelated work.
6. Reminder permission denied, enabled then revoked, schedule accepted, reboot, and actual notification tap/delivery are separate full-flow cases.
7. Browser navigation/cancel/failure and Alpha view navigation verify actual native/renderer state. Receipt text must not claim more than observed.
8. Malicious assistant text containing JSON/tool-looking commands does nothing. Unknown operation versions/keys, oversized payloads, invalid IDs and altered hashes fail before native dispatch.

No API implementation, upstream patch, endpoint deployment, native action execution or acceptance result is claimed by this document. The next code change belongs in an explicit upstream patch/worktree with tests; `vendor/eliza` must remain unchanged until the reviewed patch or commit is intentionally incorporated.
