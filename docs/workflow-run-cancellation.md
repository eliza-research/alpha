# Remote workflow execution and cancellation

The phone manages already-created remote workflows. Turning a workflow off
changes activation/scheduling and does not cancel a running execution. A
nonterminal execution receipt now has a separate **Cancel execution** action
and a second **Confirm cancellation** step. It calls the authenticated owner
route `POST /api/workflow/executions/:id/cancel`; the response is202 and may
still be nonterminal. **Refresh receipt** reads server state without submitting
a new run. Cancellation does not roll back completed effects.

Receipts show the exact run and actual workflow version, start/stop timestamps,
last100 identity-validated event summaries, bounded output and error message.
Event payloads and stacks are not rendered. Every response must match the
selected run/workflow and current session; leaving or changing accounts aborts
UI work and drops stale results. Pending cancellation confirmation is cleared
when opening/closing another receipt.

## Legacy-server ambiguous submission policy

The unpatched backend `/run` route lacks an atomic expected-version condition
and idempotency key even though its embedded service supports idempotency.
A preflight version GET reduces stale review but does not solve the race.
The actual accepted version appears on the receipt.

Before POST, the app persists an intent containing only workflow/version/time,
scoped to server origin, authenticated owner, agent and workflow. A missing or
failed response leaves an **outcome unknown** lock that survives renderer
recreation and pairing restoration. It blocks another Run now for that scope.
History and receipt refresh remain available. A different history row is never
automatically assumed to be this submission. The lock is removed only after an
identity-validated accepted response. There is intentionally no optimistic
unlock based on empty history or elapsed time: clearing an unresolved lock
requires the patched reconciliation contract described below. This is
an explicit usability limitation, not exactly-once execution.

## Evidence and native gate

- `scripts/test-workflow-protocol.ts`: actual HTTP cancellation/terminal read,
  stale version refusal, dropped accepted POST without retry.
- `scripts/test-workflow-ui-flow.ts`: actual adapter plus protocol over HTTP;
  disable remains distinct, cancellation requires confirmation, receipt identity
  and version appear, uncertain submission stays blocked after recreation.
- `test-results/workflow-cancellation/real-host.json`: real authenticated47840
  Smithers execution accepted and cancelled while an arithmetic-only module
  waits180seconds before running. The fixture is inactive. This proves worker
  cancellation, not completed-effect rollback or phone UI acceptance.
- `WorkflowCancellationInstrumentedTest` (deleted in `8452394f`, round 9: its runner was gone and it could not run; historical) (native gate `workflowCancellation=true`)
  with its dedicated wrapper: archived matching app/test hashes, exact reviewed
  held arithmetic source, both variants, real Notes-independent Workflows UI.
  The wrapper additionally verified exactly one new server execution, matching
  version, terminal cancelled. Build67 passed both archived variants after the
  exact-current-receipt test repair; see `test-results/prototype-build67/workflow-cancellation/result.json`.

The wrapper was removed on October 8 with the other aggregate smoke runners, at
the owner's request, so this Build67 result is historical and no repository runner
reproduces it today. A direct `adb shell am instrument` run of the class with
`-e workflowCancellation true` on an owned disposable emulator omits the wrapper's
server-side execution checks and is a different, narrower result. The archived
fixture UUID `4b16eb24-3559-4478-97b7-43b97f5294c5` belonged to the isolated47840
profile; it is not a portable default, and any re-run must verify exact source,
owner, inactive state and version first. Cloud workflow management,
phone triggers, workflow creation/editing and approval decisions remain separate
gaps.

## Reviewed submission contract (Build66 app, isolated47848 backend)

Upstream changes now arrive only through a reviewed pin move in `upstream.lock.json`; the product's `patches/eliza` series is historical: this repository retired it in `34b3c82a` (2026-10-03) and `55c2944f` (2026-10-04), and the last reference went in `530d3b26` (2026-10-10), each when the pinned upstream already carried the change.

Historical: `0004-reviewed-workflow-submissions.patch` advertised
`manualSubmissionProtocol: 1` in workflow status. Only then does the phone send
`{submissionId, expectedVersionId, input:{}}` on manual run. The server locks the
workflow row, rechecks ownership/version, and atomically inserts the execution
and its durable submission ledger entry. The ledger's primary key is agent,
workflow and submission UUID. An identical repeated request returns the same
execution; a key reused with different input/version conflicts. Legacy runs and
scheduled idempotency keys retain their previous contract.

On reopening a workflow after an uncertain response, the phone reads
`GET /api/workflow/workflows/:id/submissions/:submissionId`. Only the exact
workflow/version/key receipt clears its retained lock. A null or failed lookup
keeps the lock; it is not proof that a delayed POST cannot arrive. No automatic
POST retry occurs. Old servers keep the conservative behavior above. Existing
pre-key unknown intents cannot be reconciled automatically.

The additive ledger is exported through the plugin schema so standard startup
provisions it. It requires no rewriting/deduplicating historical executions.
The real isolated47848 profile first booted before the export was added; after
that explicit source fix, normal restart provisioned the new table, and real
paired admission and a second full process restart/readback passed. No manual
SQL was used on that profile. Primary47840 was not restarted.

Evidence: `test-results/workflow-submissions/real-host.json` records eight
concurrent authenticated submissions producing one finished run, request and
version conflict409, and missing-auth401. `real-restart.json` records the same
run read after stopping/starting the whole host. The upstream HTTP/PGlite suite
also drops an accepted HTTP response, reopens persisted SQL, tests trusted
cross-owner denial, and preserves the existing route-dispatch tests (14 tests,
59 assertions). Local plugin routing remains the established single-owner
facade; the service principal-isolation fixture is not production multitenant
login proof. Admission deduplication does not guarantee exactly-once external
workflow effects.

`WorkflowSubmissionInstrumentedTest` (deleted in `8452394f`, round 9: its runner was gone and it could not run; historical) (`workflowSubmission=true`) and its
dedicated wrapper (removed on October 8 with the aggregate smoke runners) were
prepared for Build67. The wrapper created inactive arithmetic-only fixtures on47848 and a loopback47849
proxy that drops each accepted run response. It requires genuine phone pairing,
persistent unknown status, Activity recreation, exact-key reconciliation and a
visible receipt, then verifies one POST and one backend execution. It preserves
the previous selected connection/credential. Build67 failed on capability
lifetime; Build68 passed both variants after the fresh-client fix, with exactly
one POST, one lookup and one server execution per variant. See
`test-results/prototype-build68/workflow-submissions/result.json`.

The Build66 cancellation runs both reached backend `cancelled`; instrumentation
incorrectly stopped polling upon matching a historical cancelled span. The
Build67 repair binds polling to the current receipt UUID and requires its
cancelled status plus terminal buttons. Build66 is retained as failed native
evidence; it is not silently relabeled passed.

## Durable cancellation (isolated backend patch0005)

Historical: `0005-durable-workflow-cancellation.patch`, applied after0004, wrote
`cancellationRequestedAt` into the existing execution JSON inside a row-locked
transaction **before** aborting the worker. Every execution save preserves this
marker from the latest stored record; stale event snapshots cannot erase it or
replace a terminal receipt with running state. Recovery rereads current durable
state and finalizes a requested cancellation before loading/evaluating workflow
source. No additional queue or SQL migration is introduced.

This remains a best-effort cancellation request until terminal status is read.
A worker that already completed effects is not rolled back. The implementation
uses the existing single-host controller/recovery model and does not claim a
new distributed cancellation transport or worker lease. An older runtime that
does not recognize the marker must not be rolled back onto unfinished requested
cancellations; finish/drain these first.

Actual proof: `test-results/workflow-cancel-recovery/prepare.json` records a
real authenticated cancel response with status **running**, `finished:false`,
and a durable intent. The harness then SIGKILLed only isolated47848.
`verify.json` records a new host PID recovering **cancelled** with the same
intent, no new execution events and no synthetic file effect after18seconds
(the source's pre-effect hold was15seconds). An uncancelled positive control
using the identical source then produced exactly one synthetic file effect.
The temporary effect directory was removed. Primary47840 was untouched.

Reproduce only on this disposable isolated profile, with its protected existing
paired session: start `scripts/start-reviewed-workflow-agent.ts`, run
`scripts/test-workflow-cancel-recovery.ts --prepare` (explicitly hard-stops that
host), start it again, then run the same test script without the flag. These
are real backend/process tests, not native phone acceptance.

## Build68 capability lifetime and definite refusals

Build67's genuine native test exposed a product bug: the connection controller
creates a new workflow client for each operation, so a capability stored only
by List was unavailable to Run. The Build68 fix negotiates capability within
Run and reconciliation themselves. The adapter HTTP fixture now mirrors the
real controller by returning a fresh client on every lookup; old-server and
new-server lost-response flows pass. Build67 remains failed native evidence.

Historical: `0006-workflow-definite-admission-refusal.patch` added one bounded typed409:
`WORKFLOW_VERSION_NOT_ADMITTED`, carrying exact workflow, submission and expected
version IDs. It is returned only after the admission transaction establishes
that no prior submission exists and the reviewed version is stale. A reused
key with different payload/version deliberately does **not** receive this code.
The phone's native error boundary retains only these bounded public IDs/code
and status. Only an exact match clears the retained intent, fetches current
steps for review and requests another explicit user decision. Generic409,
wrong-identity refusal, key conflict, dropped response or lookup failure retain
the lock. No automatic POST retry occurs.

Actual isolated47848 proof now includes typed refusal and a null lookup for the
refused key. The host restart proof explicitly records a changed process PID and
the exact surviving run UUID. The UI fixture covers fresh-client lifetime,
legacy conservative behavior, accepted response loss/recreation, definite
refusal, key conflict and mismatched identity. Native Build68 subsequently passed both archived variants; the result path
and one-POST/one-lookup evidence are recorded above.

Build72 submission reconciliation rerun passed both variants after the standalone Build71 pairing-stage failure. The native helper now waits for an enabled visible Connect button after startup restoration rather than silently clicking a disabled button; bounded chooser status/error diagnostics exclude pairing input. Current wrapper explicitly forwards a non-loopback address and proves unauthenticated401. `test-results/prototype-build72/workflow-submissions/result.json` records1POST/1lookup/1execution each. Build71 failure remains archived and occurred before workflow execution; Build71 cancellation still passed both variants.
