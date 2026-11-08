# Workflow approval receipts and explicit decisions

The phone can review an existing remote execution's engine approval after opening its receipt. It shows the request summary, disclosed operation, target, account, node/iteration and execution version. Approve and Deny require a second explicit confirmation. Missing or unsupported review fields disable approval; denial remains available. This implements an existing workflow gate, not a sandbox for arbitrary workflow source or a claim that supplied descriptions prove what arbitrary source does.

## Durable contract

The contract is implemented by the pinned upstream workflow plugin and uses its existing approval store. `GET /api/workflow/status` advertises `approvalReceiptProtocol:1`. Older hosts retain normal receipts without phone approval controls.

`GET /api/workflow/executions/:runId/approvals` checks ownership, then reads pending and decided approvals from the pinned Smithers SQLite store without evaluating workflow source. It returns exact run/workflow/version, cancellation and terminal state, and bounded request disclosures. `requestDigest` binds run, version, node, iteration and canonical request JSON. The explicit decision route `POST /api/workflow/executions/:runId/approvals/:nodeId/:iteration` accepts `approved`, `expectedVersionId`, and `requestDigest`. It locks the existing execution row, validates current canonical request, rejects cancellation/terminal/stale/conflicting decisions, and uses the existing engine control command. Identical already-recorded decisions are read back without another engine decision. Execution recovery still honors the durable cancellation intent.

The phone records only a nonsecret intent under origin/owner/agent/workflow/run before sending. Transport loss or generic409 leaves that decision locked. Refresh reads canonical state; it does not retry the POST. A pending read remains locked. Account/view changes abort the request and clear the visible review; an uncertain old-account intent remains scoped to that account. No background approval, activation, workflow creation, generated source execution or communication is added.

## Validation

`node --import=tsx scripts/test-workflow-approval-ui-flow.mjs` checks confirmation, account changes and read-only reconciliation against a synthetic HTTP host.

The shared implementation is consumed through [upstream.lock.json](../upstream.lock.json); see [agent integration](agent-integration.md) for the product boundary. These adapter checks are not live-provider, native process-death, HOME-role, AOSP or device acceptance.

The [historical validation record](https://github.com/eliza-research/alphaphone/blob/1de85a13ecd1d7658fa2453c9c2b8ed5b82646c6/docs/workflow-approval-validation.md) preserves the earlier host and Android campaign details and APK identities. Those results apply only to their recorded builds; the removed aggregate runners do not qualify the current pin.
