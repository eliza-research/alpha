# Permission coordinator refinement

The adapter runs the actual `StartupPermissions` React component, permission-flow helpers and durable-progress helpers. Six native permission bridges, connection subscriptions and storage faults are controlled inputs. Every React hook call forwards to the real React implementation. The observer retains state/ref values, DOM headings, button disabled state, native request calls, persisted records and the current connection identity.

`contracts.permissionWalkthrough` now delegates to this component adapter. The previous progress-store-only projection is covered through the component's normal read/write entry points.

## State correspondence

- `signedIn` comes from the connection credential and `enabled` from the actual caller prop.
- `phase`, `progress`, `target`, `reopened`, `completedReady`, `progressError` and permission `states` come from component state and refs. A null progress object maps to the model sentinel `-1`.
- `pending` comes from the action-pending ref and the current selected permission. `generation` is the actual sequence ref. `ticket` is that ref's value at the observed button event, matching the source's local capture before its await.
- `operations` records native requests that have started and have not settled for the current component instance. Old-instance completion remains separately observable after remount.
- `attempted`, `completed`, `legacyCompleted` and `savedProgress` come from actual stored records and the actual progress reader. `requests` counts bridge calls. `writeWorks` is the injected storage-port outcome.

The model bounds the sequence to six and permissions to the native six-step flow. Failed progress writes and silently dropped writes are covered. Attempt-marker writes succeed in these traces. The separate `StartupPermissions` model retains the best-effort attempt-marker failure behavior.

## Source correction

Changing credentials, changing the enabled prop or reopening setup now invalidates the old operation and releases its UI busy state. The old callback may still settle its platform request. It cannot update component state or advance the new context. Its catch and finally handlers also require the captured generation, so an old completion or rejection cannot clear a newer operation's busy state.

The model separates pending platform operations from the current UI operation. A completed installation's ordinary remount goes directly to Home. Explicit authentication setup can still show Ready using the retained completion marker. The final Photos Continue does not write a new progress record. Failed completion and rewind writes retain the source's actual visible phase and persisted step.

## Remaining boundaries

The adapter checks finite native-port schedules. Browser-specific four-step orchestration, OS callback behavior, every malformed native response, all external-panel combinations, and device/user acceptance remain separate obligations. Observation of every modeled field does not establish universal implementation refinement.

## Validation on 2026-11-07

- The coordinator receipt passed 22 concrete source traces with 150 checker checkpoints and all 19 state fields observed. Source and driver input hashes remained unchanged.
- The new coordinator test and 23 existing completion tests passed. Seven adjacent modal/identity tests also passed.
- All eight model scenarios passed. Seed `20261107` completed 1,000 simulations of 80 steps without a safety violation.
- Apalache 0.62.4 completed bounded symbolic safety checking through depth 4 without a violation. The model hash matched before and after the proof.
- These are bounded component/orchestration checks. No Android build, real permission dialog or device acceptance was run for this change.
