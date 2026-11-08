# Shared core design configurations

The [migration report](migration-report.md) inventories the 16 shared core
specifications and 31 TLC profiles at upstream revision
`4787d51a142c63c98371c832997184c53f7218d3`. The Git blob hashes are in
[source-inventory.json](source-inventory.json). The checked-in Quint modules
live one directory above this metadata. The immutable vendor tree retains the
original upstream specifications.

Each default model appears in the legacy manifest. Its configuration records
select exact profile modules and preserve the original constant assignments,
invariants, temporal properties and deadlock setting. A qualified profile can
be selected without changing the source model.

```sh
node specs/quint/legacy/core/check-configurations.mjs --phase=check
node specs/quint/legacy/core/check-configurations.mjs --phase=symbolic --models=InteractionSession --steps=4
node specs/quint/legacy/core/check-configurations.mjs --phase=temporal --profiles=ActionSettlement.late --tlc-max-heap-mb=1024
```

The bounded phases use an explicit stutter action to represent the source
`[Next]_vars` relation. The finite phase compiles the exact `Next` relation and
sets TLC's original `CHECK_DEADLOCK` value. Fair profiles check their temporal
properties under the original fairness predicate. Prefix monitors translate
action properties without restricting the original state relation. The one
symmetry configuration records its source operator and the current checker
explores its unreduced graph.

The runner verifies upstream bytes using Git objects, checks the profile
metadata against the inventory and hashes the model, dependencies, tooling
and metadata before and after checking. Generated backend modules, logs,
checkpoints and receipts are stored under `test-results/quint-core-configurations`.
Type checking and simulations do not establish a complete temporal verdict.

## Interactive task source conformance

After a successful finite `InteractiveTask.reducer` run, the source check
regenerates a single-worker state graph from the compiled Quint model and
compares its initial state and all non-self successor edges with the pinned
upstream graph. It then runs both original upstream reducer conformance test
bodies against the vendor checkout. The check binds the actual reducer, test,
parser, graph and generated model hashes. It uses a small Node assertion harness
for the three Vitest registration and equality functions used by those tests.

```sh
node specs/quint/legacy/core/check-configurations.mjs --phase=temporal --profiles=InteractiveTask.reducer
node specs/quint/legacy/core/check-interactive-task-refinement.mjs
```

At shared revision `99b49439ce9d0cb5607e9831b9f7f58d89525029`, the graph has
1,015 states and 3,136 distinct non-self edges. The original source tests
exercise 59 event classes and 6,603 accepted transitions, including multiple
events with the same abstract successor. This evidence concerns the reducer's
finite abstract state and event partition. It does not cover durable storage or
the runtime actuator that executes authorized actions.

## Action settlement source traces

The action-settlement adapter executes the pinned `settleActionHandler` and
processing-policy entry points with controlled handler and transport promises.
Eight schedules compare 74 checkpoints against both original Quint profiles.
Read-only build-time observers expose the actual buffered callbacks and eligible
delivery queue. The traces cover admission denial, handler outcomes,
late delivery during and after draining, and a rejected transport delivery.
Reentrant executor hooks, arbitrary callback counts and effect-receipt binding
remain outside this bounded trace campaign.

```sh
node specs/quint/legacy/core/check-action-settlement-refinement.mjs
```

### Provider execution source correspondence

`node --test test/quint-provider-execution-refinement.test.mjs` executes the
current `ProviderStateComposer` and actual runtime provider registration. The
coalesced and one-off profiles pass seven schedules and 40 checkpoints. Source
observations cover all 12 original state fields through the public composition
entry point, retained execution records and promise settlement. The fixture
checks the caller's terminal cancellation or provider error and successful text.

Controlled provider promises and a host stop flag make cancellation ordering
reproducible. The adapter covers one keyed identity, one provider and at most
three callers. Authorization, cache publication, pre-aborted admission and
complete runtime shutdown composition remain distinct source obligations.

### Read memo source correspondence

`node --test test/quint-single-flight-refinement.test.mjs` runs actual room and
message reads, memo replacement and runtime room mutation wrappers. Both
configured profiles pass nine schedules and 72 checkpoints. Observations cover
all 11 original state fields and distinguish a database commit from the
mutation caller's acknowledgement and cache invalidation. A late rejection
keeps the replacement memo entry. A complete message read replaces an
insufficient finite window.

The controlled adapter supplies versioned database results and write
acknowledgements. Physical database isolation, multi-key eviction, TTL
scheduling and other mutation wrappers remain separate source obligations.

## Approval service source traces

The approval driver executes the pinned `ApprovalService` and its registered
task worker against a controlled clock and deferred task-store operations.
Thirteen schedules compare 81 checkpoints in the failure-enabled profile.
They cover both selector orders, timeout ownership, failed callbacks, typed
decline, cancellation and service stop. The callback-success schedules
also fall within the race profile. The model's transition relation and
configured checks remain the original translation.

Task lookup and deletion are controlled ports. Task creation races, worker
restart, role admission, task-store failures and fire-and-forget approvals
remain outside this source campaign.

```sh
node --test test/quint-core-approval-service.test.mjs
```

## Interaction session source traces

The interaction driver runs the pinned authority and SQLite store on a
temporary journal with separate connections for each client. Twelve schedules
compare 121 checkpoints across both original lease profiles. They cover
lease takeover, stale commitments, response mismatch, revocation, replay,
expiry, ambiguous commits across reopen, reconciliation and a sweep racing
an old completion. A controlled clock and held continuations expose the
actual claim, commitment and execution boundaries. A synthetic effect
receipt makes the reconciliation input explicit.

The schedules hold one valid preinstalled session and one replay key. They
cover reopening the SQLite journal after interrupted clients. Provider
effects, session creation negotiation, foreign bindings, OS power loss and
arbitrary simultaneous database processes remain outside the campaign.

```sh
node --test test/quint-core-interaction-session.test.mjs
```

## Task scheduling source traces

Eight Semaphore schedules compare 69 checkpoints in the one- and two-permit
profiles. Native AbortController listeners expose the actual cancellation race.
An earlier listener releases a held permit before the semaphore's cancellation
callback. The source must skip the aborted waiter, grant the next live waiter
or restore the permit, and detach settled listeners.

The Serialise schedules compare 254 checkpoints across every four-call order.
Same-turn and staggered arrivals exercise successful operation bodies, rejected
promises and synchronous exceptions. These are bounded source observations.
Additional arrival schedules, arbitrary call counts and a nested invocation
awaited from its own queue remain outside the campaign.

```sh
node --test test/quint-core-task-scheduling.test.mjs
```
