# Reviewed workflow launcher source refinement

`ReviewedWorkflowLauncher` covers the profile and source admission owned by
`scripts/start-reviewed-workflow-agent.mjs`. The launcher selects the prepared
artifact for the admitted pin by default, or an explicit source supplied by the
caller. It checks dependencies and port before private state. The owner token
is durable before the runtime entry check. Profile identity normalization
precedes the validation of the retained text route. Fresh profiles disable
scheduling and personal-assistant and set the local embedding route. Existing
profiles retain their optional plugin and embedding settings.

Each schedule runs exact launcher and helper source in a disposable synthetic
Git repository and private home. Filesystem operations are real. The spawn
port starts only an owned synthetic child. The driver asserts the actual
loopback, authentication, selected source and environment wiring, and records
state and return values without fixture credentials. The optional Bun runs
execute the actual authenticated preload on a tiny synthetic entry. The
accepted entry loads one authenticated patch. A different HEAD and an edited
tracked file both refuse entry. Both can leave a process receipt, and the dirty
checkout's receipt still names the pinned HEAD.

The launcher publishes its receipt before attaching supervision. A synthetic
failure of its post-spawn Git revision read and an actual EISDIR at
`process.json` each leave a responsive child before the harness reaps its own
fixture. `ChildCustodyAfterReceiptFailure` captures the observed false
expectation separately from baseline safety. An ordinary spawn error leaves a
receipt without a PID. Child exit and signal forwarding are source-observed.
The baseline launcher keeps its log descriptor until process exit.

`CombinedAgentLauncher` covers a different launcher with frozen-source
admission, fixed-port probing, and reviewed speech assets. `DevelopmentHost`
covers Cloud resident binding. Reviewed workflow capabilities, actual
provider execution, deployed endpoint readiness, mutable source races,
concurrent launchers and process crash recovery are separate obligations.

Run the focused campaign with Node 26.

```sh
node --test test/quint-reviewed-workflow-launcher-refinement.test.mjs
ALPHA_QUINT_BUN=/absolute/path/to/bun node --test test/quint-reviewed-workflow-launcher-refinement.test.mjs
```
