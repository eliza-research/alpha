# Original TaskService profiles and current source

The source campaign replays the original profiles against the pinned SDK's current, authenticated TaskService and AgentRuntime with isolated PGlite. Only the replay aliases are added to the translated model. The original template, Next, fairness, profile bounds, TLC inputs and configured properties remain intact. [CoreTaskService](../CoreTaskService.qnt)

| Profile | Source boundary observed |
| --- | --- |
| Daemon one-shot | A real daemon snapshot waits in worker preflight while a host due tick claims, rechecks, and deletes the row. Releasing the stale snapshot does not run the worker again. A separate run injects a one-shot reread refusal, then verifies a preserve result leaves the durable row in place. |
| Daemon repeat | A manual call holds a blocking claim while a daemon tick skips the same row. A newer atomic wake survives the old worker's completion and is consumed only after a later worker reads that revision. |
| Local one-shot | A timer firing behind the host's active tick performs no extra query. It rearms after the host finishes and disarms on an empty queue. A pause persisted before a read survives the skipped tick until a real resume permits execution. |
| Local repeat | A committed wake write reaches the registered service's local timer. The exact revision is dispatched and consumed before the ordinary repeat interval. |

The fixture delivers the actual TaskService timer callbacks using its injected clock and observes the real current claim map, active-tick promise, timer arm and persisted row. The daemon path passes a PGlite snapshot into the actual daemon entry point `runTick`. Separate scheduler refinement covers how a live daemon selects and owns that call. Instance stop/restart, nonblocking counted ownership, task disappearance, wake write failures and unrestricted timing remain outside this comparison.

A separate exact mismatch records the current failure policy at `maxFailures=1`. The runtime sets `metadata.paused` in the same write that records the failed repeat. Original `Write` marks the row failing and reschedules it while preserving its pause state. The common projection checks every other selected observation and omits only the pause flag at that checkpoint. The original model also has no outcome for a rejected one-shot worker, whereas the source deletes its row and propagates the typed execution failure. This campaign compares the matching one-shot success, preservation and reread failure paths. No product behavior was changed.
