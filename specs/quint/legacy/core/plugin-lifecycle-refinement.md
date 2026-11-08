# Original plugin lifecycle and current runtime

The source campaign replays the `inflight`, `register`, and `services` profiles in [CorePluginLifecycle](../CorePluginLifecycle.qnt) against pinned runtime code. The three outcome-controlled actions select branches of the original `SDone`, `RInit`, and `UStopWait` disjunctions. `Next`, fairness, profile constants, properties, and the upstream TLA and TLC configurations retain the original relation.

The registration profile drives public `AgentRuntime.registerPlugin`. Two calls to the same plugin join the actual promise and run the init hook once. In the failure case, rollback removes a synthetic connector and preserves the same original init error for both callers, even when the dispose hook rejects. The service profiles use an isolated PGlite runtime with actual plugin ownership, class and instance maps, connector registry, and stop-operation identities. The fixture holds start, dispose, and stop hooks to observe withdrawal before waits, refusal of a load during withdrawal, and continued teardown after a stop rejection. A rival plugin takes the exact connector key and keeps it through A's unload. Connector handlers are synthetic and never dispatch messages.

Three exact comparisons are retained separately from the matching projections.

| Boundary | Runtime observation | Original design |
| --- | --- | --- |
| Registration rollback visibility | The plugin is removed from `runtime.plugins` while dispose is held and both registration promises remain pending. | `RInit` removes the entry and settles the owning actor together. |
| Connector registered inside a late start | After unload removes connectors and withdraws the class, a held `start()` registers the connector before returning. The runtime stops the returned instance and removes the plugin and its ownership, but the connector remains registered. | `SDone` after withdrawal only tears down the returned instance. `NoOrphanConnector` rules out the retained key after teardown. |
| Final shutdown lookup | `AgentRuntime._stopServices` clears both the per-class instance map and the public service lookup. | The final `TSvc` clears `byClass` but preserves `services`, which the original TLA declares as the public lookup. |

Each discrepancy uses an exact source observation and the same original action sequence as the matching projection, which omits only that observation at the relevant checkpoint. A mismatch receipt records the failed Quint assertion. The campaign makes no change to product or upstream code.

The original load action ends at dispatch. The source fixture separately checks rejection of the public promise. `live` denotes the synthetic instance resource and closes when the fixture's stop hook finishes, including a deliberately rejected hook that has already closed its resource. The retired A ownership list is compared only while it is reachable from the source ownership store. Other plugin contributions, connector accounts, eager retry timers, and temporal correspondence are outside the bounded source campaign.
