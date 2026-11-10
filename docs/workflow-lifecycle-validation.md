# Workflow removal and restore

The live phone action is **Remove workflow; keep execution history**. It is not erasure and does not undo prior effects. Removal requires a second explicit confirmation. Existing nonterminal executions must be cancelled individually through their receipts first. Restore requires completed trigger cleanup and returns the definition paused; it never automatically resumes schedules.

The `Removed workflows` card provides fresh-session access to removed definitions and their retained executions. The exact definition ID and owner remain available after removal. A persistent, account-bound pending row keeps an ambiguous removal reachable even when the live list no longer contains its definition. Reopening reconciles by mutation UUID and reviewed version with GET; it never repeats POST automatically. Stored mutation intent excludes source, descriptions, credentials and execution output.

## Reviewed upstream implementation

The pinned upstream workflow plugin owns this contract. The additive SQL table stores owner/workflow/mutation identity, expected version, operation and immutable receipt. Normal plugin schema migration creates it. No existing execution rows are deleted. Legacy destructive DELETE now returns409 and requires this reviewed path.

Definition row locking serializes lifecycle transitions with queued execution admission, metadata CAS, activation and update. Removal rejects unfinished/unsupported terminal states. The retained definition blocks background and manual admission while removed; paused definitions also reject trigger admission. Failed trigger deletion leaves durable pending cleanup and blocks restore. Startup retries exact workflow task removal. Cleanup never touches unrelated workflow tasks. Schedule synchronization is serialized within one service; an in-flight task created by another host rechecks version/state and deletes its own stale task. Durable admission still rejects a stale task while removed or paused. This does not establish distributed scheduler exactly-once delivery or cron/DST acceptance.

Endpoints under `/api/workflow`:

- GET `/status`: `lifecycleMutationProtocol:1`.
- GET `/removed-workflows`: owner-scoped removed definitions; regular list excludes them.
- POST `/workflows/:id/lifecycle`: `{mutationId,expectedVersionId,operation:"remove"|"restore"}`.
- GET `/workflows/:id/lifecycle-mutations/:mutationId`: exact immutable receipt or null, plus current lifecycle state.

Detail and execution receipt routes remain owner-scoped and readable. Typed `WORKFLOW_LIFECYCLE_NOT_APPLIED` is accepted by the phone only when workflow, mutation and expected-version identity match. Other409/network failures retain the pending lock.

## Validation

`node --import=tsx scripts/test-workflow-lifecycle-ui-flow.ts` checks explicit removal review, account changes, retained history and GET-only reconciliation against a synthetic HTTP host.

The shared implementation is consumed through [upstream.lock.json](../upstream.lock.json); see [agent integration](agent-integration.md) for the product boundary. These adapter checks are not live-provider, native process-death, HOME-role, AOSP or device acceptance.

The [historical validation record](https://github.com/eliza-research/alphaphone/blob/1de85a13ecd1d7658fa2453c9c2b8ed5b82646c6/docs/workflow-lifecycle-validation.md) preserves the earlier host and Android campaign details and APK identities. Those results apply only to their recorded builds; the removed aggregate runners do not qualify the current pin.
