# Native resident coordinator refinement

`resident-coordinator.mjs` compiles the whole production `AlphaLocalAgentPlugin`
with its actual admission, attachment, worker-submission and recovery-policy helpers.
Controlled Android, Capacitor, vault and resident-service ports supply observations
and synthetic local HTTP responses. Unused capabilities in those ports throw.

The source campaign covers normal stop, failed stop dispatch, delayed stop and
startup cancellation from a destroyed surface, owned startup cancellation, attached
startup cancellation, reenrollment of an existing service, an uncertain pairing
response, last-surface destruction and broadcast admission racing with stop.

## Corrections established through source execution

A destroyed launch owner could call `stop` or `cancelStart` after a second surface
attached. Both methods changed the shared lifecycle epoch and could stop the live
resident. They now reject disposed callers while holding `lifecycleLock`.

The native full-start path advances its lifecycle epoch and may reuse an existing
service without owning its launch. `ResidentRuntime.admitStart` records that
transition. `cancelUnownedStart` retires the enrollment without requesting a service
stop. `retireLastSurface` represents loss of the final bridge while the service
continues. The existing `start` action remains available to earlier renderer and
composition projections.

## Observation relation

| Model field or action | Executed source observation |
| --- | --- |
| `s.epoch` | Private static `lifecycleEpoch` |
| `s.ownedStart` | Private static `startOwnsLaunch` |
| `s.localProcess` | Controlled service activity/socket observation |
| `s.phase` | Source stopping/accepting flags, current start request, enrollment and service observation |
| `admitStart` | Full `startAfterShutdown` admission before its worker receives the authentication result |
| `started` | Actual enrollment completes and the waiting plugin call resolves |
| `cancelAttachedStart` | `cancelStart` removes the attaching surface's request without changing the shared epoch |
| `requestStop` | Shared epoch and enrollment retire before the service stop port returns |
| `shutdownConfirmed` | `getStatus` observes both service and socket absent |
| `observeResident` | An existing service or a system broadcast supplies a live resident |

Raw observations also retain enrollment presence, accepting/stopping flags, start
request identity/epoch, live bridge count, per-surface disposal/pending/stream/
attachment/cancellation counts and service request counters. Assertions
check returned plugin outcomes, exact service stop counts, single pairing dispatch
after an uncertain response and lock exclusion during a broadcast start.

## Reproduction and scope

```sh
node --test test/quint-resident-refinement.test.mjs
node specs/quint/refinement/native/resident-coordinator.mjs
```

The receipt is `test-results/quint-refinement/ResidentRuntime-coordinator.json`.
Source, driver and model hashes bind the observations. The generated port bundle
has an additional digest in the receipt assumptions.

The campaign contains ten source schedules and 51 model checkpoints. The existing
twenty resident/teardown/provider tests pass. `ResidentRuntime` has thirteen
scenario tests and `ApplicationComposition` has thirty-one. Both models pass
1,000 simulation runs of 80 steps and bounded symbolic safety through depth four.

This is bounded orchestration correspondence. It does not establish every
interleaving or every private field. Credential mutation/shutdown retry, recovery
archival, arbitrary request/stream methods, cancellation-set capacity and provider
configuration need additional whole-plugin campaigns. Real Binder delivery,
process death, packaged runtime launch, encrypted storage and local HTTP transport
remain Android/service integration obligations. The controlled service confirms
the replies used in these tests without starting a packaged runtime.
