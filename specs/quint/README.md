# Alpha application-state specifications

Quint specifications live here, separate from production renderer and Android
code. All checks execute models or isolated test adapters.

## Model families

| Family | Coverage |
| --- | --- |
| [Application](application/README.md) | Shell, startup permissions, assistant requests/drafts, local documents, Notes, vault, files/sharing, preferences and development surfaces |
| [Services](services/README.md) | Sign-in, service authorization, Google accounts, Calendar, Inbox, Maps, workflows, notices/caches, browser and document pipelines |
| [Native](native/README.md) | Resident runtime, voice, speech resources, listener, reset, deletions, media, device actions and composed cross-domain behavior |
| [Legacy](legacy/README.md) | Eleven translated historical current/proposed design comparisons with their original properties, fairness and expected counterexamples, and sixteen conversions of upstream core designs |

Each family's `manifest.json` names its executable modules, initial and next
actions, invariants, scenarios, exact source entry points and abstractions.

## Manifest fields the runner checks

`scripts/quint-lib.mjs` loads all four manifests before any command runs and
refuses to start when an entry is inconsistent. Module names and model paths
must be unique, every `.qnt` file under this directory must be registered, every
name in `tests` must be a `run` definition in the model, and every path in
`sources` and `sharedSources` (relative to `vendor/eliza`) must be readable.
The following optional fields add checks.

| Field | Meaning | Where it is enforced |
| --- | --- | --- |
| `witnesses` | Names of state predicates that must be reachable | At load, each name must be a `val`, `def` or `temporal` definition in the model. In `quint:check` and `quint:simulate`, each witness is run as `--invariant=not(<witness>)` and the phase passes only when the simulator reports a counterexample |
| `symbols` | `{path, name}` pairs naming source identifiers the model follows | At load, `name` must still occur as a whole identifier in the repository file `path`; a rename or removal stops every command |
| `additionalProofInit` | A second initializer that starts from every finite shape of a counter | `quint:verify` runs one extra pass from it with `--max-steps=1`, the model's `step` and `invariant`, recorded as the `<backend>-proof-init` phase |
| `bounds` | Per-model `maxSamples`, `maxSteps` and `seed` | Standalone `quint:simulate` uses them unless `--samples`, `--steps` or `--seed` is passed. `quint:check` always uses its own defaults. Other keys under `bounds` are descriptive and are not read by this runner |
| `temporal` | Temporal properties | `quint:temporal` |
| `currentChecks`, `currentTemporalChecks`, `expectedViolations` | Current-design comparisons with an expected `pass` or `violation` | `quint:compare` |

A witness guards against an invariant that holds only because the state it
constrains is never reached. Witness runs use at least 2,000 samples and 60
transitions, or the simulation bounds when those are larger. A witness run that
finds no counterexample fails the gate, as does a tool error: only the pinned
CLI's explicit violation markers count as a counterexample.

## Running checks

Install the root lockfile with `npm ci`. The development tool is pinned to
`@informalsystems/quint` 0.33.1. Repository verification includes the default
Quint gate and implementation conformance tests.

```sh
npm run quint:check
npm run quint:typecheck
npm run quint:test
npm run quint:simulate -- --samples=1000 --steps=60 --seed=123
npm run quint:conformance
```

The default gate (`quint:check`) runs every registered scenario, samples 80
traces per model with up to 40 transitions at seed 20261107 against the model's
invariant, and then requires a counterexample for each declared witness. It does
not start a separate typecheck process: `quint test` parses and typechecks a
model before running its scenarios, and a model whose scenarios fail is not
simulated. `quint:typecheck` remains available as a standalone command.

The gate ends with two canaries written to a temporary directory. The first is a
model with a deliberately false invariant and must produce a counterexample. The
second is a model with a deliberately failing scenario; `quint test` must exit
non-zero and name the failed assertion. A syntax or tooling failure cannot
substitute for either detection, and a missing detection fails the gate.

Model checking is separate and needs JDK 21 in this repository. Quint fetches its
pinned Apalache 0.62.4 distribution when needed. The CLI also uses that
distribution's TLC implementation. The supplied TLC configuration bounds heap
and worker count. Change the server endpoint when running independent checker
processes concurrently, since a single server does not isolate concurrent jobs.

```sh
# Bounded symbolic safety checking, plus any additionalProofInit pass
npm run quint:verify -- --steps=4

# Exhaustive finite-state safety checking
npm run quint:verify -- --backend=tlc --models=ChatInput

# Fairness-guarded temporal properties for the historical models
npm run quint:temporal -- --backend=tlc --models=SignIn,GoogleConnect,Maps

# Require the expected current-design passes and counterexamples
npm run quint:compare -- --backend=tlc --models=ChatInput
```

`--models` selects comma-separated module names. `--out` selects the JSON
evidence file. `--timeout` sets the per-check timeout in seconds, with 1800 for
model checking and 120 for the default gate. The checker saves parameters, model hashes, complete checker output, exit status and evidence class under
`test-results/quint/` by default. Temporal/compare commands reject a selection
that has no corresponding checks. TLC exploration ignores the symbolic
transition bound and may take substantially longer on large finite models.

`.github/workflows/quint-model-check.yml` runs `quint:verify` for every model,
`quint:compare` for `ChatInput`, `SettingsNav`, `HomeLayout` and `GoogleConnect`,
and `quint:temporal` for `SignIn`, `GoogleConnect` and `Maps` on pull requests
that touch the models or the runner, nightly, and on manual dispatch. Repository
verification runs only the default gate. The other legacy modules that declare
comparisons or temporal properties are checked by running those commands with
`--models` locally.

## Source changes and review

After changing implementation behavior, review the corresponding executable model,
scenarios and source entry points in its family manifest. Conformance campaigns
capture their actual model and implementation inputs for each invocation. Shared
behavior stays pinned by `upstream.lock.json`; the vendor checkout is immutable.

## Interpretation of results

Safety scenarios and random simulation are sampled evidence. Apalache results
cover the recorded transition bound. TLC results cover the finite abstraction
and fairness assumptions supplied to that invocation. Temporal action
properties use equivalent persistent transition monitors where the checker
requires state predicates. The original action relations remain in the
corresponding `*Relation` definitions.

`ApplicationComposition` imports actual domain actions and invariants for
identity, voice, resident execution, Calendar, Inbox and reset. It exercises
coordinated account changes and reset and has a canary for omitted coordination.
The full Cartesian product of all application details is not enumerated.

Implementation correspondence is checked by selected ITF trace adapters and
existing source tests. It remains a different obligation from proving all
TypeScript/Java execution refines all models. APK build and audit results,
installed emulator behavior, AOSP image boot, provider integrations and device
acceptance retain their separate gates in the repository.

## Function-level proofs

[`specs/lemma`](../lemma/README.md) holds LemmaScript proofs of small pure
decision functions in `apps/app/src`. They are a different kind of evidence from
the models here.

| | Quint models | LemmaScript proofs |
| --- | --- | --- |
| Subject | A hand-written state machine derived from the source | The text of one annotated TypeScript function, translated to Dafny |
| Claim | Invariants over sequences of transitions | The `ensures` contract of a single call, for every input meeting `requires` |
| Coverage | Scenarios, sampled traces, and bounded or finite-state model checking of the abstraction | All inputs of that function under the translator's number and collection models |
| Link to source | Manifest `sources` and `symbols`, selected trace adapters | The proof is tied to the function's exact text and is regenerated when it changes |

Neither implies the other. A proof says nothing about the callers of a function
or about ordering across steps; a model says nothing about whether a function
body computes what the model's action assumes. `specs/lemma/README.md` lists the
proved functions, the trusted assumptions, the required LemmaScript and Dafny
versions and how a run without a Dafny backend is reported.

## Known modeled discrepancy

The integrated scan model follows the shared camera controller. Explicit Save
clears automatic draft ownership, so confirmed PDF export retains that draft.
The historical migration receipt records the older local-controller defect.

Permission attempts are retained in the live flow and across restart when the
best-effort storage write succeeds. A failed write can allow another explicit
prompt after a cold restart. Walkthrough progress writes remain durable before
advancing. The models distinguish these contracts.

## Verification record

The integrated check results and any remaining limits are recorded in
`verification.md` after validation. Historical TLC tables remain under their
original design directories and retain their original evidence dates.

## Current integration scope

The November 8 registry contains 85 models and 782 scenarios. Additive contracts
cover native view subscription, permission choices, canonical Notes controller
and draft behavior, linked Calendar sync, Inbox provider drafts, workflow SQL
admission and cleanup, runtime lifecycle, recording admission and controller
composition. Existing canonical Notes, durable draft dispatch, resident failure
and busy voice-input contracts remain registered.

The runtime bundle inventory is regenerated by the normal Android bundle
producer at the pinned SDK99 revision. Its tracked inputs and declared origins
of generated inputs join the source-drift ledger. This dependency inventory
does not prove that each dependency's state or behavior refines a model.

The completed 65-model receipt belongs to its earlier frozen source. The expanded
85-model source set requires a fresh normal gate and source-refinement receipts.

## Registry size

Counted from the four manifests on 2026-11-10:

| Family | Models | Scenarios | Models with witnesses | Witnesses | Models with symbols | Symbols |
| --- | --- | --- | --- | --- | --- | --- |
| Application | 165 | 1,069 | 61 | 233 | 54 | 496 |
| Services | 68 | 587 | 26 | 109 | 20 | 218 |
| Native | 75 | 662 | 17 | 77 | 12 | 113 |
| Legacy | 27 | 121 | 0 | 0 | 0 | 0 |
| Total | 335 | 2,439 | 104 | 419 | 86 | 827 |

`RendererRecovery` and `VadSegmentation` declare `additionalProofInit`. Twenty-four
legacy modules declare `temporal` properties and eleven declare `currentChecks`;
no entry currently declares `expectedViolations`.

The family guides describe a subset of the registered modules; the manifests are
the complete list. The earlier receipts named in this guide and in
`verification.md` cover the registries of their dates. A registry of this size
needs its own default-gate receipt and model-checking receipts before any result
is claimed for it.
