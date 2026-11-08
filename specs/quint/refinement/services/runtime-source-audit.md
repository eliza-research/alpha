# Runtime source scope audit

The current workflow source campaigns execute the actual workflow service while supplying the core runtime, process execution and task persistence as explicit ports. They do not establish the state of the full agent runtime behind those ports.

## Selected production roots

The Android build selects `packages/app/src/mobile-agent-entry.ts` in `packages/agent/scripts/build-mobile-bundle.ts`. That entry installs the mobile workflow process host, the mobile authentication host bridge and the native runtime profile before importing `@elizaos/agent/bin`.

`packages/agent/src/bin.ts` dynamically imports `./cli/index.ts` and calls `runAutonomousCli`. The CLI imports `../runtime/eliza.ts` for boot and server-only startup. That runtime imports the real core `AgentRuntime`, which constructs its own service lifecycle, retirement, model dispatch, embeddings, provider state and data mutation owners. The simplified core Service base class in the workflow test fixture does not execute those owners.

The workflow dependency producer is independently selected by `scripts/prepared-workflow-worker.mjs`. It invokes `packages/scripts/plugins/plugin-workflow/build-workflow-artifact.ts`. Its generated entrypoints include Smithers run/control, store, output snapshot, cancellation subtree, Effect, graph and scheduler libraries. These are separate from the first-party `smithers-runtime.ts` process/protocol wrapper. The current workflow fixtures replace that wrapper's execution and control ports.

The authoritative Android consumed-source list is `plugins-manifest.json` → `bundleDependencies`, generated from the successful Bun build's entrypoint input metadata. No current pinned `475a8d59dc1811c2cde093613519906a5a3f6457` artifact was available in this worktree or the root agent's artifact search. Historical manifests cannot establish the current consumed-source closure.

## Static reachability evidence

`test-results/quint-workflow-tasks/runtime-graph-audit.json` records a conservative source walk from eight explicit Android/runtime/workflow roots. The accompanying `runtime-graph-audit.mjs` uses Bun's TypeScript-aware import scanner, hashes every read source and follows relative imports plus explicitly recorded core, agent and assistant aliases.

The observed walk contains 1,374 first-party files, 4,090 edges and 1,033 unresolved bare or computed import edges. These counts describe potential static reachability. They include re-exports and literal dynamic imports and do not account for dead-code elimination, runtime feature gates or all mobile builder substitutions. Class names in that evidence are candidates, not a determination that each class owns state. This walk must not replace a current authenticated bundle manifest or be labeled complete consumed-source coverage.

## Connected state owners requiring further refinement

| Source owner | Concrete state and missing boundary |
| --- | --- |
| `packages/core/src/runtime/service-lifecycle.ts` and `runtime/retirement.ts` | Service-class start deduplication, failed registrations, eager retry timers, stop-during-start ownership, retained teardown promises and accumulated quiescence failures. Root agent owns the next implementation slice. |
| `packages/core/src/services/task.ts` | `activeTick`, executing task IDs/promises, dirty-query suppression, quarantined orphan tasks, startup grace, pause/resume and stop/drain. The actual assistant `basicServices` selects this service. The workflow task fixture supplies its persistence port and does not execute this scheduler. |
| `packages/agent/src/triggers/runtime.ts` and `triggers/event-bridge.ts` | Per-runtime event registration, per-trigger dispatch queues, shared discovery batches, cooldown/cache state, task progress and re-arm metadata. `runtime/eliza-plugin.ts` registers this task worker. |
| `packages/core/src/runtime/turn-controller.ts` | Active turns per room, abort ownership and listener lifetime. It is separate from voice capture and workflow execution cancellation. |
| `packages/core/src/runtime/room-handler-queue.ts` | Per-room FIFO ownership, global/room capacity, cancellation before acquisition, acquired leases and queue closure. |
| `packages/core/src/runtime/run-terminal-owner.ts` and `services/post-delivery-task-tracker.ts` | Pending continuations, settled effect receipts, single terminal request/event, room lease release and delivery-versus-terminal quiescence. |
| `packages/core/src/runtime/model-dispatch.ts`, `embeddings.ts`, `provider-context.ts`, `single-flight-memo.ts` | Provider/model registrations, in-flight/cache coalescing, pinned embedding provider and request/context lifetimes. These need source-backed schedules rather than service result summaries. |
| `packages/agent/src/runtime/deferred-boot-owner.ts`, `deferred-boot-status.ts`, `blocking-core-boot.ts` | Runtime-owned background boot tasks, abort tombstones, dynamic registrations after shutdown, dependency-wave plugin admission and failed startup phases. |
| `packages/agent/src/runtime/plugin-types.ts` and `plugin-resolver.ts` | Static plugin registry, fallback loader promises, plugin resolution/cache and publication during mobile module initialization. |
| `plugins/plugin-workflow/src/services/smithers-runtime.ts`, `workflow-process-host.ts` and `workflow-worker-lease.ts` | Spawned process protocol, payload cleanup, line delivery, terminal receipt versus timeout/abort, worker lease observations and unknown outcomes. The current models consume these outcomes as external inputs. |
| `plugins/plugin-scheduling/src/plugin.ts`, `shared-reminders.ts`, `coding-agent-schedules.ts` | Persistent schedule service admission, shared reminder lifecycle and receipt locks behind the selected scheduling plugin. Exact enabled feature paths still require the mobile bundle and runtime configuration. |

Other static-reachable sources remain unclassified. The graph includes module definitions that may be bundled without being activated. Each additional model should identify its real production entrypoint, enabled configuration, observable fields and external ports before claiming runtime correspondence.
