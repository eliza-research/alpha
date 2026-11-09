# Late plugin connector publication on the pinned runtime

The original `CorePluginLifecycle` inflight campaign preserves its `PluginLateStartConnector` mismatch. The translated model and original profiles stay unchanged. This separate source campaign checks public runtime state at finer scheduling boundaries.

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

A narrow repair would record the exact runtime and ownership object at service-start admission and retire that record at the existing connector-withdrawal boundary. It would refuse publication from a retired capture before a wrapped message connector, post connector or default send handler can update the registry or transfer a claim. Runtime-local service class ownership would distinguish the same class object in different runtimes. Registration still needs its pending capture for eager startup. A second teardown sweep alone cannot restore a displaced rival or catch a callback that runs after unload. The fixture establishes the message connector path; equivalent positive and negative checks would be needed for the other two wrappers before applying the repair.

The campaign covers this API schedule with synthetic hooks. It does not establish that an installed Alpha profile enables a particular remote connector or exposes plugin hot reload. Explicit direct unregister calls, entirely unscoped callbacks, runtime shutdown and arbitrary plugin side effects are separate boundaries. There are no production edits in this baseline.

Run with Node 26 from the repository root.

```sh
node --test test/quint-plugin-connector-custody.test.mjs
```
