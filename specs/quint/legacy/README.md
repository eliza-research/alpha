# Migrated design models

These eleven Quint modules preserve the historical current/proposed comparisons
from the November 2026 design reviews. The current design refers to source
`ef9fbf7cd7`, as it did in the original models. Runtime coverage for the current
working tree lives in the other Quint families.

## Representation and translation

Each original state variable is retained as a named field of `s`. `Design` is an
immutable field selected by `init` or `currentInit`. Record updates preserve all
unchanged fields and evaluate expressions against the pre-state. The original
finite domains, constants, action guards, nondeterministic choices, property
names and weak/strong fairness assumptions are retained.

`manifest.json` records the SHA-256 of each input specification before migration,
its source definition names, constants, properties and historical current-design
expectations. It also lists executable tests and source entry points. `vars`
retains the original state-vector role, including instrumentation when present.

The following language differences require explicit representation.

- TLA+ initial predicates are represented by `Initial` and executable initializer
  actions. `Spec` and `CurrentSpec` use the state predicate. Independent
  `checkerInit` and `checkerCurrentInit` entry points accommodate Quint's TLC
  initializer conversion, which rejects assignment helpers reused elsewhere.
- TLA+ `ENABLED Back` and `ENABLED Edit` are represented by their exact guards.
  Their assignments are total whenever the guards hold. Quint's `enabled` is a
  temporal operator and cannot be used as an ordinary simulation invariant.
- The Home model uses `HalfFloor` for integer division. TLA+ floors a negative
  quotient, while Quint truncates it. The keyboard/tall-card regression checks
  the original grid position of 174 pixels.
- TLA+ action properties are observed by persistent `history` booleans. The
  `*Relation` functions contain their pre-state/post-state formulas, `Track`
  updates the monitors on every transition, and `*Invariant` exposes each result.
  No monitor changes an original guard or suppresses a transition. This is an
  exact state extension that permits TLC to check the properties, since direct
  Quint `always(action.orKeep(vars))` output is not accepted by TLC as the
  original bracketed action formula. The named temporal properties are
  equivalent `always(history.property)` formulas.
- `step` includes stuttering, matching the original bracketed `Next`. Fairness
  uses the original state projection and named actions. `CheckedTemporal` guards
  the temporal properties with the original fairness assumptions.
- Partial update helpers such as `Tap`, `Detour` and `Activate` are represented
  as values or full-record updates inside the same original callers.

These are design models with intentionally small data domains. Calendar retains
three event identities and boolean presence, including the source model's
abstraction of recurring-event scope. Maps retains abstract service health and
routes. The Settings model retains the complete source row inventory. Cryptography,
provider payloads, Android behavior and current implementation conformance need
the runtime models and implementation tests.

## Checks

Run the root Quint commands documented in the parent guide to check all admitted
models. To inspect a single migrated model directly, use the local pinned CLI.

```sh
node_modules/.bin/quint typecheck specs/quint/legacy/ChatInput.qnt
node_modules/.bin/quint test specs/quint/legacy/ChatInput.qnt --backend=typescript --seed=1
node_modules/.bin/quint run specs/quint/legacy/ChatInput.qnt --init=checkerInit --step=step --invariant=safety --backend=typescript --seed=42 --max-samples=300 --max-steps=35
node_modules/.bin/quint verify specs/quint/legacy/ChatInput.qnt --init=checkerInit --step=step --invariant=safety --backend=tlc --tlc-config=specs/quint/tlc.json
node_modules/.bin/quint verify specs/quint/legacy/SignIn.qnt --init=checkerInit --step=step --invariant=safety --temporal=CheckedTemporal --backend=tlc --tlc-config=specs/quint/tlc.json
```

`currentChecks` contains the expected results of checking the historical current
state machine against the same requirements. A listed violation is intentional
and must remain reproducible. Scenario tests explicitly reproduce each class of
historical safety violation and exercise the proposed success paths.

Quint 0.33.1 typechecking and all 47 scenario tests pass. Seeded safety simulation
used seed 42, 300 traces and 35 transitions for all seven models before the
transition-monitor extension. The final monitored models are rechecked by the
root verification gate. An additional SignIn sample used seed 100, 500 traces and
70 transitions. Historical TLC results remain in the two design folders and keep
their original evidence classification.

Full finite-state checking of the migrated models is recorded separately in
`test-results/quint-legacy/` during this migration. Matching state counts are
translation checks, and do not establish implementation refinement.

| Module | Migrated proposed states | Historical states | Safety | Declared temporal properties |
| --- | --- | --- | --- | --- |
| ChatInput | 38 | 38 | Pass | None declared |
| HomeLayout | 900 | 900 | Pass | None declared |
| SettingsNav | 16 | 16 | Pass | None declared |
| SignIn | 10,173 | 10,173 | Pass | All 1 pass |
| GoogleConnect | 498 | 498 | Pass | All 3 pass |
| Calendar | 687,728 | 687,728 | Pass | All 2 pass |
| Maps | 12,316 | 12,316 | Pass | All 6 pass |

Calendar's full fair temporal check completed in 14 minutes 47 seconds after
checking its 687,728-state graph and a 2,750,912-state temporal product. Its
successful log is `test-results/quint-legacy/Calendar-optimized.log`. An earlier
300-second attempt was incomplete and a redundant check was superseded. Those
attempts are retained separately from the completed result.

All twelve declared temporal properties pass with the original fairness
assumptions. Action properties use the equivalent observation invariants
explained above. Per-property `Checked<Property>` aliases enable reproducible
current-design comparisons and do not change the transition relation.

The supplemental runtime models `FilesTree`, `CalendarPresentation` and
`NotificationCollection` passed 26 scenario tests and 1,000 seeded traces of
60 transitions each. They also passed Apalache 0.62.4 checks through four
transitions. Their bounded results are in
`test-results/quint-legacy/supplemental-bounded.json`. These checks establish
only the declared finite abstractions and their configured bounds.

The original historical evidence is retained in the
[flow design results](../../../docs/flow-redesign-2026-11/tla/results.md) and
[UI design results](../../../docs/ui-refresh-2026-11/tla/results.md).

## Additional view-refresh designs


The four view-refresh designs from commit `7883110c0a` are translated to
`CameraSession.qnt`, `PhotosLibrary.qnt`, `NotesView.qnt` and `FilesBrowser.qnt`.
Their 22 original configurations, property lists and input hashes are retained
in [view-refresh-configurations.json](view-refresh-configurations.json). Each
configuration has an independent `checker<Name>Init` entry point. `checkerInit`
selects `Design`. `Rename` retains its separate name domain and bounds.

These models retain every original state field and action, including external
changes, reviewed revisions, recording visibility and weak/strong fairness.
The configuration is immutable state. The `history` record observes the exact
pre-state/post-state formulas of action properties. `stateSafety` combines the
original configured state invariants. `safety` also checks the action monitors.
The `Checked<Property>` temporal aliases apply the original fairness assumptions
to `s`, excluding the observational history record.

The translation uses the following representations.

- TLA model values for Notes and folders become distinct strings.
- Photos `Take` selects items with fewer than `W` strictly newer or older IDs.
  This is equivalent to the original recursive maximum/minimum extraction.
- Files `FreeName` selects the lowest unused numeric name, realizing the source
  `CHOOSE` under TLC's numeric ordering. The source does not specify a different
  tie-breaking rule.
- Camera's per-epoch fairness quantifies over the pure constant `MaxEpoch = 3`.
  TLC cannot normalize a temporal quantifier whose bound is read from a state
  record, even when the record is immutable. All camera configurations use 3.
- Separate checker initializers avoid Quint 0.33.1's restriction on reusing an
  initializer action inside scenarios and other entry points.

| Model | Retained finite bounds |
| --- | --- |
| CameraSession | 3 sessions, media admission bound 2 |
| PhotosLibrary | 3 item IDs, window 2, historical cap 1, 2 external events, revisions 0–2 |
| NotesView | 2 notes, 2 folders, 2 names, 3 segments, historical cap 1, 2 disruptions, revisions 0–2. Rename uses 3 names, 1 segment and 1 disruption. ASR while hidden is false in every configuration. |
| FilesBrowser | 3 files, 3 directories, names 1–3 with initial names 1–2, 1 external event |

The local runner checks these historical design comparisons independently of the
application coverage ledger. Original TLA specifications and configurations remain
in `design/view-refresh-2026-11/tla/`; their source hashes match the translation
manifest. Historical implementation links are metadata, while the application,
service and native families bind current source owners. It records input hashes before and after execution and rejects an
unexpected checker error as a counterexample. Separate simultaneous invocations
need distinct server endpoints. A persistent, independently started Apalache
server avoids the pinned CLI's automatic server shutdown/startup race.

```sh
node specs/quint/legacy/check-view-refresh.mjs --phase=check
node specs/quint/legacy/check-view-refresh.mjs --phase=symbolic --steps=4
node specs/quint/legacy/check-view-refresh.mjs --phase=compare
node specs/quint/legacy/check-view-refresh.mjs --phase=properties
node specs/quint/legacy/check-view-refresh.mjs --phase=temporal --models=NotesView --configurations=AsBuilt_Hidden
```

`compare` preserves each original configuration's combined verdict. `properties`
checks all expected passing properties together and each expected violation
separately. `temporal` checks every temporal property separately. The stronger
property checks expose two additional historical failures that the earlier
first-failure results masked.

- `CameraSession.AsBuilt_Leave` also violates `AgentCaptureSettles`. An unfinished
  photo remains stuck across reopen. A later agent request queues during startup
  and cannot run after preview becomes ready. Both the translated model and the
  original TLA+ reproduce this fair liveness counterexample.
- `FilesBrowser.Ablate_Conflict` also violates `SelectionExists`. A reviewed move
  can overwrite another selected file while the current listing is not stale.
  Both source and translation retain this behavior.

All four modules passed typechecking, 38 scenario tests and 1,000 seeded traces
of 80 transitions at seed 20261108. The originating unchanged-input receipt is
`test-results/quint-view-refresh/check-stable.json` in the translation worktree.
The integration records its own fresh checks under `test-results/quint-view-refresh/`. Fresh finite-state and symbolic
results are written under `test-results/quint-view-refresh/`. The
[November 6 results](../../../design/view-refresh-2026-11/tla/results.md) remain
historical. A fresh original Camera `Design` run and its translation both have
2,742 reachable states. The historical table's 1,344 states predate later edits
to that specification. Interrupted or failed tool runs remain separate evidence
and do not establish a completed finite-state check. Current implementation
conformance is a separate obligation of the application, native and service
refinement adapters.

The property-specific `CameraSession-properties-final.json` run encountered an
Apalache startup error while checking `AsBuilt_Focus-NoLostShutter`. A later
`CameraSession-properties-stable.json` run completed all 13 property campaigns
with unchanged inputs at 15:24 UTC on November 8. Its model and configuration
hashes match this integration. The Focus configuration produces the expected
`dropped = TRUE` counterexample; the Design properties pass. The failed attempt
remains separate. Photos and the other large temporal state spaces require
their own completed receipts. Unfinished runs are not counted as passing here.

The integration recheck passed all four typechecks, all 38 scenarios and
80 traces of 40 transitions per model at seed 20261108. Its stable-input receipt
is `test-results/quint-view-refresh/integration-bounded.json`. The exact source
models remain byte-identical to commit `7883110c0a`; the integration runner also
checks and captures the retained original TLA and configuration hashes.
