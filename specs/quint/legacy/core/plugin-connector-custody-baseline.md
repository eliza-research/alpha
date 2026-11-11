# Late plugin connector publication on the pinned runtime

The original `CorePluginLifecycle` inflight campaign reproduced the `PluginLateStartConnector` mismatch. Commit `f0a28195bf560c9cec2dda63ab6f3fdb4b4ddfa9` preserves the as-built source test. The translated model and original profiles stay unchanged. This separate source campaign checks public runtime state at finer scheduling boundaries.

The fixture executes the pinned `AgentRuntime` with one isolated PGlite database. Its actors have distinct synthetic plugin names, service types and connector sources. It holds promises inside real start and stop hooks. At each checkpoint it reads `getPluginOwnership`, `getMessageConnectors` and `getService`. It also calls the actual route selector through `sendMessageToTarget` with local handlers that only return a label. The fixture refuses external fetches. Loader and fixture hashes are captured before execution and revalidated after cleanup.

| Schedule | Observed result |
| --- | --- |
| Eager start registers after class and connector withdrawal | Its service is absent from public lookup and stops once. The newly installed connector and handler remain visible and routable when ownership disappears. A later same-name registration that does not claim the key leaves the orphan in place. Another unload cannot remove it. |
| Rival already owns the default key | Late A replaces the exact default connector and removes the rival's default ownership claim. The rival retains its separately keyed sibling account. A's unload leaves the default route unowned. Rival unload removes only the sibling. |
| Rival registers after late A, before unload settles | The later rival claim replaces the late route. Both exact rival keys survive A's completed unload. |
| Detached lazy continuation after unload, with no replacement | The route is absent at unload completion. The continuation installs it later with no owner. A new explicit claim replaces it and its own unload removes it. |
| Detached lazy continuation after same-name replacement | The old continuation replaces the new route and is attributed to the replacement's ownership record by name. The replacement's eventual unload removes that route. |
| Detached eager continuation after same-name replacement | The inherited registration context retains the retired ownership record. The old continuation strips the replacement's claim and writes the old route. It then remains routable after the replacement's unload. |

In `teardownPluginOwnership`, connector removal precedes `stopOwnedServices`. The latter withdraws classes and awaits captured starts. `RuntimeServiceLifecycle._runServiceStart` stops a returned instance whose class has been withdrawn, but the service hook can already have published a connector. The three publication wrappers update the registry first. Their ownership bookkeeping removes the exact claim from other owners and then attributes it to the active capture. A detached continuation outlives the awaited start. Eager and lazy starts differ because `getOwnershipTarget` prefers an inherited registration capture and otherwise resolves the current record by plugin name.

## Authenticated correction

The product-owned patch records the exact runtime and ownership object at service-start admission and retires that record at the existing post-disposal connector-withdrawal boundary. Each of the three publication wrappers checks that record before updating the registry or transferring a key. A retired call returns through the existing void API. Service class ownership is runtime-local. Pending declared classes use their registration's capture during eager startup, and a current nested registration gets a new capture.

The repaired campaign exercises the six original schedules across message, post and default send-handler APIs. It also checks unscoped host publication, registration nested inside a retired continuation, publication while disposal is still pending, and one shared service class started by two runtimes. The historical Quint source replay now includes the corrected connector observation in its matching projection. The registration rollback and final shutdown lookup mismatches remain separate.

The patch is applied by the existing core-state manifest, with an exact required transform in the mobile build receipt and APK source snapshot. The fixture executes authenticated runtime source with isolated databases and closed synthetic handlers. Installed-profile connector activation, explicit direct unregister calls, entirely unscoped callbacks and arbitrary plugin effects remain separate boundaries.

Run with Node 26 from the repository root.

```sh
bun test test/quint-plugin-connector-custody.test.mjs
```
