# Workflow wake-up refinement

`WorkflowWakeups` models one persisted execution and its per-run host callback reservation. The source campaign executes `EmbeddedWorkflowService`, its actual event persistence, result handling, signal entrypoint, stop and static restart against real SQL. The platform clock and callback delivery are controlled. The Smithers execution and control ports remain external.

The adapter observes persisted status, terminal/cancellation/reconciliation fields, actual process entries and control calls, plus the service's real `workerReconciliations` reservation and `reconciliationStopped` flag. It reads these private fields without mutation. The model's two-entry `openTimers` map is specification state, driven by actual persisted timer events. The driver does not reconstruct the timer-selection algorithm.

The bounded schedules exercise these behaviors.

- An ordered timer history closes and reopens the same timer identity before selecting the next wake-up.
- A signal can resume the run before an existing timeout. A later result can replace that reservation with an earlier timer or retain the earlier reservation.
- A terminal or cancelled row is read again when an older callback fires and does not enter another worker.
- A live worker result reserves a reconciliation poll. An unknown outcome removes an earlier pending poll.
- Stopping a parked host clears its timer. Delivery of an already-queued old callback respects the stopped host. A new service instance recovers the durable run.
- Empty timer history receives the source's fallback, and far deadlines respect the platform timeout limit.
- A typed occurrence admitted before host loss becomes missed if still queued after its window. A previously started typed run follows process reconciliation.

The evidence is bounded to one execution, two timer identities and three process invocations. Stop during an active worker, in-progress resume admission, multiple runs, schedule-task registration and the external trigger dispatcher remain separate obligations. Installed process leases and side-effect idempotency are also outside this host callback model.

Source discovery, exact compiled-byte checks and before-driver provenance use the shared workflow engine harness. No product source is changed by these fixtures.

## Persistent task registration

`WorkflowScheduleTasks` covers the independent SQL-definition and runtime-task commits through the actual activation, deactivation, removal, restoration and startup methods. The fixture executes core `stringToUuid` for the persisted deterministic trigger identity. Task read/create/delete remain controlled persistence ports.

The source schedules include failure before and after task creation, failure before and after deletion, inactive cleanup on startup, exact-version task reuse, stale creation versus another host's pause, stale creation versus a newer activation, preservation of unrelated event triggers on pause, removal of every workflow trigger, and restoration only after confirmed cleanup. The second host is a separate actual `EmbeddedWorkflowService` using the same SQL and task ports.

Typed task metadata binds its reviewed version. Generic tasks have no equivalent field, so the generic schedule projects only its task count. The model's generic task-version value and its schedule-validity class remain unobserved fields. Their absence is an explicit refinement gap.

A successful definition commit does not establish successful task registration. A reported task-store failure can leave a missing task or an already-created task. The model retains both possibilities. Schedule existence also does not authorize a run. Durable run admission is covered separately by `WorkflowEngineAdmission`.

A completed cleanup marker records the last cleanup transaction. The source campaign also holds an older host task creation until after removal cleanup, then rejects retirement of that late task. The marker remains complete while the stale task is still present. Startup removes it later. The model deliberately retains this current behavior and does not assert that the marker alone proves task-store quiescence. Durable run admission still rejects a removed workflow.
