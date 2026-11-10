# Reviewed workflow launcher source refinement

`ReviewedWorkflowLauncher` covers the profile and source admission owned by
`scripts/start-reviewed-workflow-agent.ts`. The launcher selects the prepared
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
accepted entry loads one authenticated patch. The launcher campaign observes
that entry at child settlement. A different HEAD and an edited
tracked file both refuse entry. Both can leave a process receipt, and the dirty
checkout's receipt still names the pinned HEAD.

The launcher captures the actual Git revision before spawning and uses that
revision in its process receipt. A refused revision read closes the private
log before spawn. Both reviewed workflow and combined launchers use the same
child supervisor. It attaches handlers before publication and reaps the exact
returned child before the original receipt write error propagates. Ordinary
spawn failure still leaves metadata without a PID. SIGINT, SIGTERM and
numeric child exit are observed, and child close releases the log and handlers.
The two earlier lost-custody schedules are preserved in the
[baseline record](reviewed-workflow-launcher-baseline.md).

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
