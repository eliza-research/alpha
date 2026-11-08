# Resident workflow crash tests

`ResidentWorkflowCrashInstrumentedTest` runs in the hosted resident job
(`scripts/ci/resident-native.py`, `residentCrash=1`). It has two cases:

- `lostParentModelRpcRemainsUnknownWithoutReplay`: the resident is killed while an authored
  workflow waits on a model request. After restart the execution is `outcome-unknown` and the
  request is never sent again.
- `trustedPackagedWorkerSurvivesResidentRestart`: an instrumentation-created packaged worker
  survives a resident kill and an explicit service stop, and its result replays without a
  second model request.

## Deferred: local-survivor case

A third case was planned: an authored workflow whose task uses the public `read` and `write`
file tools, survives a resident kill, and finishes with exactly one effect. The mobile
authoring facade does not support `read`/`write`, so that workflow cannot be authored on the
phone. The case was never registered as a `@Test` and has been removed from the class rather
than kept as uncalled code. Bring it back when the facade exposes the file tools; until then
no test covers a resident-created worker surviving a crash with a local effect.
