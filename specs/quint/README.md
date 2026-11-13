# Alpha application-state specifications

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
actions, invariants, scenarios, source files and abstractions.

## Running checks

Install the root lockfile with `bun install --frozen-lockfile`. The development tool is pinned to
`@informalsystems/quint` 0.33.1. `bun run verify` and `bun run test` leave out the default
Quint gate and the `test/quint-*` tests; run them before merging. CI runs them only for
pull requests into `main` and on manual dispatch (`.github/workflows/promotion.yml`).

```sh
bun run quint:check
bun run quint:tests
bun run quint:typecheck
bun run quint:test
bun run quint:simulate -- --samples=1000 --steps=60 --seed=123
```

The default gate parses/typechecks every model and runs every manifest scenario
through an explicit matcher, including named setup scenarios. It requires a
successful CLI execution record for each registration. Simulation uses each
model's `bounds.maxSamples`, `bounds.maxSteps` and `bounds.seed`, falling back to
80 traces, 40 transitions and seed 20261107. Explicit CLI values override them.
The gate requires both a deliberately false invariant and a failing scenario
assertion to be detected; a syntax/tooling error cannot satisfy either canary.
Manifest invariant names must resolve to top-level values or imported instances.
`additionalProofInit` runs an extra one-transition simulation and symbolic check
when its corresponding command is selected. `bounds.maxVerifyDepth` sets the
default symbolic depth for that model; explicit `--steps` overrides it.
`verifyBackend: "tlc-bounded"` selects exhaustive safety checking through that
transition bound. BrowserSession, PhotosWindow and LauncherFavorites use it with
their unchanged six-transition default after symbolic checks exceeded their deadline.
The checker appends a depth counter to the translated model, checks every state
at depths zero through the bound, and records the scope, depth and translation
hashes. It does not establish safety beyond that bound.

Model checking is separate and needs JDK 21 in this repository. Quint fetches its
pinned Apalache 0.62.4 distribution when needed. The CLI also uses that
distribution's TLC implementation. The supplied TLC configuration bounds heap
and worker count. Change the server endpoint when running independent checker
processes concurrently, since a single server does not isolate concurrent jobs.

```sh
# Bounded symbolic safety checking
bun run quint:verify -- --steps=4

# Exhaustive finite-state safety checking
bun run quint:verify -- --backend=tlc --models=ChatInput

# Fairness-guarded temporal properties for the historical models
bun run quint:temporal -- --backend=tlc --models=SignIn,GoogleConnect,Maps

# Require the expected current-design passes and counterexamples
bun run quint:compare -- --backend=tlc --models=ChatInput
```

`--models` selects comma-separated module names. `--out` selects the JSON
evidence file. `--jobs` or `ALPHA_QUINT_JOBS` allows independent scenario,
simulation and typecheck workers. The default is one worker. Each model keeps
its ordered phases, and the receipt lists results in registry order. Use
`ALPHA_QUINT_JOBS=3 npm run verify` to apply this to the standard gate. Model
checking remains serial within one server endpoint.
`--timeout` sets the per-check timeout in seconds, with 1800 for model checking
and 120 for the default gate. The checker saves parameters, model hashes,
complete checker output, exit status and evidence class under
`test-results/quint/` by default. Temporal/compare commands reject a selection
that has no corresponding checks. Full `tlc` exploration ignores the symbolic
transition bound and may take substantially longer on large finite models.
`tlc-bounded` is restricted to safety verification; temporal and comparison
commands retain full `tlc` exploration.

## Source changes and review

After changing implementation behavior, review the corresponding executable model,
scenarios and source entry points in its family manifest. Conformance campaigns
capture their actual model and implementation inputs for each invocation. Shared
behavior stays pinned by `upstream.lock.json`; the vendor checkout is immutable.

## Interpretation of results

Safety scenarios and random simulation are sampled evidence. Apalache results
cover the recorded transition bound, as do `tlc-bounded` results. Full `tlc` results cover the finite abstraction
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

Current checks write their source-bound receipts to `test-results/quint/` and
`test-results/quint-refinement/`. CI retains the corresponding run artifacts.
[`verification.md`](verification.md) records the historical migration checks
and their original scope.

## Registry review

The November 10 registry has 259 models and 1,841 registered scenarios. Its
per-family model and total scenario floors are checked in `quint-checker.test.mjs`;
intentional retirements require an explicit review of that baseline. The model
source lists, implementation adapters and run receipts bind each invocation's
inputs. The retired coverage hash ledger is not an additional admission gate.
Historical receipts retain their original source and model set and do not certify
later additions.


## Complementary audit models

The integrated registry also retains the November audit models, witnesses and source symbols. Distinct admission/readback state shapes are registered separately from the current source-correspondence models. Manifest entries state their partial scope; new model execution is not Android, service or device acceptance. The manifests and new run receipts, rather than earlier registry totals, define current coverage.
