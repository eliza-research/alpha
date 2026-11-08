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
