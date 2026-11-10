# Workflow Change: name and description

For source-based workflows, Change edits only the name and description. Save requires a nonempty name of at most 200 characters and a description of at most 4,000 characters. It does not run, enable, disable or reschedule the workflow. Typed workflows (`phoneSpec`) open the separate full authoring flow; this document describes the metadata-only endpoint.

## Durable mutation contract

The pinned upstream workflow plugin owns the durable metadata mutation table.

The server advertises `metadataMutationProtocol:1`. `POST /api/workflow/workflows/:id/metadata` accepts only UUID `mutationId`, `expectedVersionId`, `name` and `description`. Extra fields, including source, are rejected. One transaction locks the exact workflow, revalidates owner, checks any existing mutation identity, compares the current version, captures the previous revision, changes only the two permitted fields and stores an immutable receipt. It does not call scheduling or execution services. A duplicate identical mutation returns that same receipt; changed input under the same identity is409. A conclusively stale, never-applied mutation returns the identity-bound `WORKFLOW_METADATA_NOT_APPLIED` refusal.

`GET /api/workflow/workflows/:id/metadata-mutations/:mutationId` is owner scoped and returns that immutable receipt or null. The phone writes only mutation ID and reviewed version into an origin/owner/agent/workflow-scoped lock before submitting; name and description content are not persisted there. A lost response, malformed response or generic409 retains the lock. Reopening the workflow performs an exact GET; null is still unresolved, not permission to send another save. Only an exact receipt or correctly identity-bound definite refusal clears the lock. It then reads the current workflow independently, so a historical receipt is not presented as proof that no later edit exists.

Account/view changes abort the active request and clear its visible editor. An uncertain save remains scoped to the original account and reconciles by GET when that account returns. Existing servers without the advertised contract truthfully refuse phone editing. Existing broad legacy update/activation routes are not claimed to have acquired CAS semantics through this endpoint.

## Validation

`node --import=tsx scripts/test-workflow-metadata-ui-flow.ts` checks metadata-only editing, retained nonsecret intent, account changes and exact receipt reconciliation against a synthetic HTTP host.

The shared implementation is consumed through [upstream.lock.json](../upstream.lock.json); see [agent integration](agent-integration.md) for the product boundary. These adapter checks are not live-provider, native process-death, HOME-role, AOSP or device acceptance.

The [historical validation record](https://github.com/eliza-research/alphaphone/blob/1de85a13ecd1d7658fa2453c9c2b8ed5b82646c6/docs/workflow-metadata-validation.md) preserves the earlier host and Android campaign details and APK identities. Those results apply only to their recorded builds; the removed aggregate runners do not qualify the current pin.
