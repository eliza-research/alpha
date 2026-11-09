# Core connector custody refinement

[CoreConnectorCustody](../../../services/CoreConnectorCustody.qnt) models the authenticated plugin connector repair. The [historical baseline](../../../legacy/core/plugin-connector-custody-baseline.md) keeps the original late-start discrepancy and the six as-built schedules. The original PluginLifecycle transition relation and profiles remain intact.

The ordinary fixture begins with the first owner's registration and its held service start. The model retains the exact runtime and ownership stamp across service return, disposal, withdrawal, stop and detached continuation. A fresh registration with the same plugin name receives a separate ownership stamp. One independent rival can take the default and named account keys, and an unscoped host can claim the default keys. Route labels and plugin ownership claims are separate because the old claim can remain visible while withdrawal has already removed its route.

The driver reuses the actual source fixture. It compares public ownership, message and post descriptors, synthetic message and legacy handler resolution, the default fallback for a named account, service lookup, class presence, disposal, stop invocation and detached callback progress. Private stamps are abstract identities checked through these outcomes. The isolation schedule registers the same class object in two actual runtimes and checks both sides as each start and the first unload complete.

The model bounds a single service and retired continuation per runtime, one replacement, one rival and five route keys. The fixture's synchronous registrations are grouped into actions, and some checkpoints group sequential source completions. Explicit direct unregistration, cross-runtime connector calls from another runtime's async scope, generic stop or disposal failures, installed provider activation and other plugin effects remain separate.

Run the source replay with Node 26 from the repository root.

```sh
node --test test/quint-plugin-connector-custody.test.mjs
```
