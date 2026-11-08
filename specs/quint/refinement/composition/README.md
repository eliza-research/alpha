# Current application composition

This bounded composition imports `IdentitySession`, `CalendarLinkedSync` and
`VoiceSession`. Its source driver runs the actual renderer `connectionController`,
Alpha `calendarSyncHost` and `startCalendarSyncHost`, native Calendar bridge
validation, shared Calendar controller/store/reconciler and shared voice session.
The Android bridge, encrypted storage primitive, Cloud responses, microphone and
speaker are controlled external ports. Requests outside the fixture are fenced.

Native credential commit, acknowledgement and renderer publication have distinct
model transitions. Opening a sign-in panel retains the prior Calendar identity.
Voice becomes ineligible because the actual conversation predicate includes the
open connection panel. A replacement published to the renderer invalidates the
old Calendar lifetime. It cannot authorize another write, while a write already
sent may apply remotely and leave its old local checkpoint dirty.

## Source schedules

Nine schedules check 44 checkpoints with before-driver input hashes and model
safety at every recorded point.

- Calendar create completion through the actual Alpha host.
- Account replacement while a Calendar create is dispatched.
- Replacement after a Calendar review but before enabling it.
- Cancelled precommit sign-in while old-account Calendar sync continues.
- Sign-out and visibility loss after Calendar dispatch.
- Voice capture invalidated by an open sign-in panel.
- A submitted voice turn followed by account replacement and a late reply.
- Foreground loss while voice capture is open.

The source runs distinguish refused new admission from previously dispatched
uncertain outcomes. The current sign-out keeps its account chooser open, which
is modeled explicitly. A synthetic unsafe initializer keeps the refinement
harness canary effective when observations happen to match an unsafe state.

## Observation map and remaining gaps

| Imported component | Observed in this campaign | Further relation required |
| --- | --- | --- |
| IdentitySession | Stored credential presence and renderer owner/publication checkpoints | Native attempt, callback burn, receipts, pending owner, ACK and transient cleanup fields are contract macros here. The separate native sign-in campaign executes them. Intermediate native-to-renderer delivery still needs a combined trace. |
| CalendarLinkedSync | Actual retained record state, pending operation, provider-reference presence, provider write count, external result and host enabled state | Local/remote semantic hashes, local revision/ETag equality, conflict resolutions and the full collection remain covered only by the separate bounded Calendar campaign. Model phase and binding epochs are not all directly observed here. |
| VoiceSession | Actual phase, capture presence, input-held flag and submission count under the actual renderer conversation predicate | Timed endpoint results, utterance/session/turn counters, heard sentence prefixes and full rendered `voice-adapter` cleanup wiring need combined traces. The driver explicitly calls `recheck()` after relevant renderer changes. |
| Host projection | Renderer owner, provider readiness, connection-panel openness and document foreground | Internal native Resident lifecycle, consumer subscription ordering between checkpoints and all host epoch/binding fields need a fuller relation. |

The composition contains one retained Calendar link for its captured account.
It preserves that record across retirement. It does not reset it to represent
another account's independent collection. Inbox's two retained account slots,
Resident start/stop/credential coordination, Reset and device acceptance are
explicit remaining composition obligations. Removing their old unsupported
coupling does not remove their separate domain models or tests.

`CalendarSync` was moved to the legacy family as a `historical-source-model`,
with source revision `a6fce187c935d0cb4b5bb40aadcbe1263fb4011f` and its original
source paths recorded in `historicalSources`. Its nine scenarios still test
those historical transition semantics.

## Reproduction

```sh
node --import=tsx specs/quint/refinement/composition/index.mjs
node --test test/quint-composition-refinement.test.mjs test/quint-refinement-harness.test.mjs
node_modules/.bin/quint test specs/quint/native/ApplicationComposition.qnt
```

The source receipt is `test-results/quint-refinement/ApplicationComposition.json`.
These sampled concrete schedules and finite model checks do not establish
unrestricted application refinement or installed Android/provider behavior.
