# Combined agent launcher source refinement

`CombinedAgentLauncher` covers one invocation of
`scripts/start-combined-agent.mjs`. The launcher verifies the executable
versions and frozen source manifest, probes its fixed loopback port, checks
private profile and speech prerequisites, then prepares the profile and selects
the core overlay before requesting one child. The launcher installs child and
signal handlers before publishing its process receipt. The synthetic child
can acknowledge boot after the receipt is written.
Endpoint readiness belongs to a separate authenticated acceptance check.

The source driver runs the exact launcher and helpers in a disposable
repository. The Git workspace, provider input, profile and speech bytes are
synthetic. The driver observes real filesystem operations, substitutes closed
version and port probes, and replaces the requested command with a private
Node fixture. Signals reach only that returned child. Child IPC confirms
script execution. The report records neither the dummy provider input nor
the generated owner token.

The schedules cover version and source rejection, an occupied port, profile
containment and ownership, speech integrity, marker and routing refusal,
validation-only, both core overlay decisions, late profile or patch refusal,
process metadata, launch failure, two forwarded signals, and numeric child
exit. A patch admission error closes the private log it opened. Refusing
empty synthetic provider input leaves the prepared profile and token before
that log step. Validation-only
accepts an existing marker file before parsing its contents. The normal
launch separately rejects the same wrong marker. A spawn failure can leave
metadata without a PID. The child close event releases the log and handlers.

An obstructed `process.json` write fails under supervision. The launcher sends
SIGTERM to its returned child and waits for its close event before rejecting.
A synthetic child that ignores SIGTERM receives the bounded SIGKILL fallback.
Both cases close the private log and remove signal handlers before returning
the original write error. `ChildCustodyAfterLaunch` is now a checked safety
invariant. The prior source observation is preserved in the
[baseline record](combined-agent-launcher-baseline.md).

`DevelopmentHost` covers Cloud resident binding and retirement through
`scripts/cloud-resident-host.mjs`. The combined launcher has a distinct
source and process boundary. Concurrent launchers and competing binders,
signal handling after process termination, actual tool execution, real
speech assets and authenticated service readiness are separate obligations.

Run the focused campaign with Node 26.

```sh
node --test test/quint-combined-agent-launcher-refinement.test.mjs
```
