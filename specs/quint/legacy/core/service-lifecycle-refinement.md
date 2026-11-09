# Original service lifecycle design and current runtime

The `liveness` and `siblings` profiles in [CoreServiceLifecycleDesign](../CoreServiceLifecycleDesign.qnt) preserve the original bounds, actions, fairness and TLC properties. The source campaign adds aliases around those same actions. It compiles the pinned SDK and drives real `AgentRuntime` service registration, loading, plugin unload and shutdown with local PGlite and synthetic start, observer and stop hooks.

| Original boundary | Current source observation |
| --- | --- |
| `EBegin`, `EEnsure`, `ESettle` | Public load promises, shared per-class start promises, registration status and selected caller progress. Concurrent loads share one start and await publication observers. |
| `StartOk`, `StartEvent`, `StartFail` | Exact instance publication, per-class attempt and failure state, and observer completion. A successful sibling stays available when the other class fails. |
| `EDelay` | One real eager backoff restarts a failed class in the siblings profile and the retry clears its failure mark on success. |
| `RRequest`, `RServices`, `RStopNext`, `RStopWait`, `RClear` | Runtime stop flags, one real per-instance stop promise, and final lookup removal. A start that returns after admission closes is stopped before the load rejects. |
| `UStart`, `UAwaited`, `UDrain`, `UStopped` | Actual plugin unload withdraws its class before awaiting a pending start. An unload racing runtime stop joins the same teardown operation and does not stop the instance twice. |

One source schedule differs from the literal design. In `RuntimeServiceLifecycle._runServiceStart`, the runtime publishes an instance and marks the type registered before calling `registerSendHandlers`. A synchronous throw from that hook skips the started observer and marks the class failed, while the public load still returns the published instance. The original `StartOk → StartEvent → ESettle` sequence leaves the class available and clears its failure mark. The campaign checks the common publication, settlement and status observations, then retains a separate expected-mismatch receipt for the failed-class flag. The mismatch is evidence of a boundary in the design model and does not change the original transitions.

The runtime additionally distinguishes public resolve/reject values, observer and handler failures, stop errors retained by strict retirement, and the ordering imposed by draining in-flight starts before normal service teardown. The eager source policy can retry after 2, 5 and 10 seconds, whereas the two original profiles bound retries at zero and one. The source checks use a single ordinary service type, two concrete classes and at most two caller identities. They do not establish source fairness, deadline behavior, or correspondence for arbitrary plugins and shutdown orders.
