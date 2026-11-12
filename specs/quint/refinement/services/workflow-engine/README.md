# Workflow execution admission refinement

This adapter executes the pinned `EmbeddedWorkflowService` and `createWorkflowDispatchService`, including their actual Drizzle queries, against PGlite 0.4.6 and Drizzle 0.45.4. The versions match the pinned upstream lock. It also executes the current typed workflow compiler, stored-spec validation and core cron occurrence classifier.

The finite model is `WorkflowEngineAdmission`. The earlier `WorkflowExecution` helper model retains its existing narrower scope. This model adds server admission and process coordination without reinterpreting that helper as execution coverage.

## Observed state

| Model fields | Actual observation |
| --- | --- |
| `version`, `active`, `removed` | Stored workflow definition and version read back from SQL |
| `runs`, `receipt`, `owner`, `payload`, `runVersion`, `mode` | Actual execution and manual-submission rows for one request identity |
| `status`, `finished`, `cancelRequested`, `reconciliation` | Actual persisted `WorkflowExecution` |
| `workerActive`, `workerStarts` | Entered and unresolved controlled process calls, each asserting that SQL admission already exists |
| `approval`, `supported`, `digest`, `decisionOwner` | Actual service `approvalReceipts` result from its canonical-store port |
| `recordedApproval` | The independent `execution.approvals` SQL projection |
| `controls` | Commands sent by the actual service to its process-control port |
| `otherActive` | A separately seeded unfinished execution in the same workflow |
| `workerApproval` | Invocation-local model snapshot, explicitly not observed from the source closure |

Owners, versions, request input and canonical digests use distinct finite equality classes. Every recorded checkpoint derives observed fields from SQL, the real service result, or the external port the real service invoked. Failed source calls are asserted before checking disabled model actions or an unchanged observation. A failed model action does not stand in for a failed source call.

## Executed boundaries

The campaign covers same-key concurrent admission, exact and conflicting retries, authorization failure, removed and paused definitions, precommit rollback, postcommit response loss, queued recovery through the actual static service initializer, unavailable immutable revisions, process outcome uncertainty, cancellation persistence before teardown, terminal-result precedence, repeated cancellation, reviewed approvals, canonical control-result recovery and changed approval identity. Typed schedules cover real ready, missed and overlap classifications. Trigger dispatch covers concurrent in-flight deduplication and durable lookup after restart.

The SQL rollback and lost-response faults wrap the actual transaction. They do not replace the admission algorithm. Table columns and primary keys derive from the actual Drizzle schema. This fixture supplies all required inserted fields and does not test deployed migrations, index installation or default application.

## Important current behavior

Canonical approval readback and the execution projection can differ. If the process commits an approval but the subsequent canonical read fails, the host transaction rolls back while the external decision remains committed. A same-owner retry reads the committed decision without issuing another command. The SQL projection can remain pending. The model retains both states and the source campaign checks this sequence.

A cancellation request does not guarantee a cancelled outcome. A complete captured terminal result that wins during teardown remains authoritative. A conflicting native terminal status without its captured output becomes an explicit failed result. Both schedules use the actual cancellation entrypoint.

## Remaining obligations

- The installed Smithers worker, process isolation, native control executable and SQLite approval reader remain controlled external ports. The campaign establishes the host coordinator's reaction to their outcomes.
- Multi-host PostgreSQL serialization, production migrations and runtime supervision require their deployment environment. PGlite provides real SQL and serialized same-process transactions.
- Hosted Google/native grants, typed device effects, event listeners and notification delivery remain separate coordinators.
- Full event/output/error content, multiple distinct submission identities, timer/event reconciliation queues, schedule-task arming and the complete time-zone space are not checked by these bounded traces.
- `workerApproval` is a model-private snapshot. Other source-private collections and nonselected execution fields are also explicit gaps.

Run the focused test with `bun test test/quint-workflow-engine-refinement.test.mjs`. It first discovers the import graph without evaluation, captures source and adapter hashes, rebuilds while hashing the exact source bytes consumed by esbuild, rejects graph or byte changes, and only then evaluates the source. It invokes the shared trace checker and records a bounded-orchestration receipt. The adapter returns explicit obligations for aggregate reporting.
