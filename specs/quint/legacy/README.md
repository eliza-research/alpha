# Migrated design models

These seven Quint modules preserve the historical current/proposed comparisons
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
