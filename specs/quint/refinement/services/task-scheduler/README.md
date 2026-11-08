# Task scheduler source refinement

This campaign binds the shared daemon in `packages/core/src/services/task-scheduler.ts`
and the patched `TaskService` in `packages/core/src/services/task.ts` at SDK
`99b49439ce9d0cb5607e9831b9f7f58d89525029`. The translated live and restart
configurations retain one agent, two service identities, two adapter identities,
three in-flight tick slots and two start/stop operations. The live configuration
excludes query failure, while restart allows it. This is an opt-in shared runtime
boundary. Current Alpha and pinned upstream application source has no direct
production call enabling `startTaskScheduler`.

## State owners and observation boundaries

| State or effect | Actual owner | Observation |
| --- | --- | --- |
| Shared interval, selected adapter, generation and attached tick | Scheduler module `ensureTimer`, `startTaskScheduler`, `stopTaskScheduler` and the interval's `finally` | Read-only bundle export reads exact module bindings. A controlled interval port invokes the registered callback. Observations use the actual attached promise identity, including after detachment. |
| Per-agent registration ID, service owner and dirty mark | Scheduler module `registerTaskSchedulerRuntime`, `unregisterTaskSchedulerRuntime`, `markTaskSchedulerDirty` | Exact map/set reads. Service registration/stop runs through actual `TaskService.startTimer` and `prepareStop`, using the authenticated runtime transform. |
| Captured query scope and result | `tick` calls host `getTasks` once for the dirty registration snapshot | Controlled DB promise records the actual requested agent IDs and tags. Its released value supplies rows, empty result or refusal. |
| Busy ownership and detached completion | Scheduler module tracks the concrete TaskService object in `busyServices`, and captures adapter generation and registration ID before its await | Real TaskService `runTick` is called and awaited. Its actual configured worker enters a controlled promise so the run can remain held across replacement. Each retired promise is settled independently. |
| Stopped service fence | `TaskService.prepareStop`, with actual `runTick` returning when stopped | Read the TaskService instance's stopped flag. The patched start guard keeps a stopped service from re-registering. |
| Diagnostics and worker side effects | Runtime error reporting, logger and external worker | Runtime errors and worker calls are observed directly. Provider work and installed persistence remain separate. |

A source boundary records the selected TLA+ action, exact observed state and
external input. A timer callback without an observable query attaches a promise
only until its microtasks settle. Its stable before/after projection may stutter.
Tick slots label real promise identities in the order scheduled by each trace.
The `taken` history variable is a design witness. The source has a dirty set and
observable adapter admission, with no persisted field named `taken`.

## Schedules to check

- A dirty registration is captured exactly once, and empty results disarm work
  until an explicit dirty mark. Repeating a start with the same adapter preserves
  the current generation and timer.
- Replacing an adapter while a query is held detaches the old promise. Its
  success or rejection cannot dispatch work or clear an attached newer tick.
- Replacing or stopping a service while its query is held rejects the old
  registration. Stopping an older instance cannot unregister the replacement.
- Replacing an adapter during a real `runTick` preserves the busy owner. A new
  interval cannot take that service's dirty mark until the old run completes.
- Query refusal re-dirties only its still-current registration and emits the
  typed runtime diagnostic. A stopped scheduler invalidates the old result.

The exact translated profiles have one agent and omit the process-task registry.
Multi-agent batching, mixed-scope DB rows, host process-task disposal and a full
start/stop/start sequence require an expanded runtime abstraction. The same
scheduler source can execute them independently of this first correspondence
campaign. Real-time timer fairness, crash behavior, SQL guarantees and provider
side effects are outside this controlled boundary.

## Checked evidence

`runTaskSchedulerRefinement(extraSources = [])` returns the two source receipts
and explicit uncovered obligations. The live profile passes 7 source traces at
63 checkpoints, including a disabled stopped-registration canary while capacity
remains. The restart profile passes 3 source traces at 26 checkpoints. Each
profile compares 11 observed expressions and checks its safety predicate at
all checkpoints. Inputs are captured before executing the source schedules.

The query action was factored into the same four alternatives, with named
witnesses for refusal, stale completion, empty completion and dispatch. The
original `Next` and fairness continue to use the union of those branches.
The current Quint bytes pass typechecking, the three original named scenarios,
and 500 TypeScript simulation traces by 40 steps for each profile with seed 123.
The earlier exhaustive results are evidence for the pre-witness translation.

## Expanded current runtime model

`TaskSchedulerRuntime` covers the batching and process-task state beyond the
single-agent design. Two agent queues share one adapter request. The captured
registration cohort, DB row order, per-agent grouping, report counts and
active/detached `runTick` owners are represented independently. The source
campaign exercises absent agents, missing and foreign row owners, a known
agent outside the query, changed registrations before both DB completion and
later dispatch, and stop/restart while an old service remains busy. DB refusal
and worker refusal have separate diagnostics and retry behavior.

The process registry models two names and three actual task instances. A
queued callback can be aborted before entry. A disposer withdraws its exact
entry and aborts its signal synchronously, then drains its own active promise.
A same-name successor can register while the retired run drains. Repeating an
old disposer preserves the successor. Registered process tasks keep the
shared interval alive after daemon stop, and a process callback can start
while a DB tick is attached.

`runTaskSchedulerRuntimeRefinement(extraSources = [])` compares 10 actual
source traces, 125 checkpoints and 24 observed expressions, including a
negative duplicate-name admission check. The trace uses exact source maps,
timer handles, attached promises, TaskService group arguments and external
worker calls. It checks source-assigned safety at every checkpoint. Internal
queued groups are confirmed at their actual dispatch boundary. Transient
no-query attachments are projected at stable checkpoints. The six declared
Quint scenarios and 500 by 40 TypeScript simulations pass. These checks use
a controlled host, with SDK daemon enablement, real-time timer behavior and
external provider effects outside their scope.
