# Alpha application-state specifications

The migration began with the [detailed report](../../docs/quint-migration-report.md).
Quint specifications live here, separate from production renderer and Android
code. All checks execute models or isolated test adapters.

## Model families

| Family | Coverage |
| --- | --- |
| [Application](application/README.md) | Shell, startup permissions, assistant requests/drafts, local documents, Notes, vault, files/sharing, preferences and development surfaces |
| [Services](services/README.md) | Sign-in, service authorization, Google accounts, Calendar, Inbox, Maps, workflows, notices/caches, browser and document pipelines |
| [Native](native/README.md) | Resident runtime, voice, speech resources, listener, reset, deletions, media, device actions and composed cross-domain behavior |
| [Legacy](legacy/README.md) | Eleven translated historical current/proposed design comparisons, original properties, fairness and expected counterexamples |

Each family's `manifest.json` names its executable modules, initial and next
actions, invariants, scenarios, exact source entry points and abstractions. The
[source ledger](coverage.json) accounts for authored application code and declared
consumed shared dependencies, with exact source hashes. Shared dependencies marked
`state-audit-required` retain field and transition obligations beyond their domain
allocation. It separates application, development and test-support files.

## Running checks

Install the root lockfile with `npm ci`. The development tool is pinned to
`@informalsystems/quint` 0.33.1. Repository verification includes the default
Quint gate and implementation conformance tests.

```sh
npm run quint:check
npm run quint:typecheck
npm run quint:test
npm run quint:simulate -- --samples=1000 --steps=60 --seed=123
npm run quint:coverage
npm run quint:conformance
```

The default gate parses/typechecks every model, runs every registered scenario,
and samples 80 traces per model with up to 40 transitions at seed 20261107. It
also requires a deliberately broken counterexample canary to fail. A syntax or
tooling failure cannot substitute for detecting a violated invariant.

Model checking is separate and needs JDK 21 in this repository. Quint fetches its
pinned Apalache 0.62.4 distribution when needed. The CLI also uses that
distribution's TLC implementation. The supplied TLC configuration bounds heap
and worker count. Change the server endpoint when running independent checker
processes concurrently, since a single server does not isolate concurrent jobs.

```sh
# Bounded symbolic safety checking
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
model checking and 120 for the default gate. The checker saves parameters, model hashes, the source-ledger
hash, complete checker output, exit status and evidence class under
`test-results/quint/` by default. Temporal/compare commands reject a selection
that has no corresponding checks. TLC exploration ignores the symbolic
transition bound and may take substantially longer on large finite models.

## Source changes and review

Every new, deleted or changed source in the configured roots fails coverage
admission until its allocation and abstraction are reviewed. After changing
implementation behavior, update the corresponding model, scenarios and source
hashes together. Record added source paths and explicit domain assignments in
`coverage.json`. The gate never invents an assignment for an unknown file.

The ledger's lexical change anchors help locate candidate mutable state. They
also include locals and method declarations, so they are navigation aids.
Per-domain manifests and models define the actual abstraction. A file appearing
in the ledger does not prove that every implementation variable or behavior is
formally covered. Shared behavior is represented at the imported contract
boundary and pinned by `upstream.lock.json`. The vendor checkout is immutable.

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
