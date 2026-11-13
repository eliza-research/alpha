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

Each family's `manifest.json` is one array of model entries: the executable module, its initial
and next actions, invariants, scenarios, source files and abstractions.

## Running checks

Install the root lockfile with `bun install --frozen-lockfile`. The development tool is pinned to
`@informalsystems/quint` 0.33.1. `bun run verify` and `bun run test` leave out the Quint gate and
the `test/quint-*` tests; run them before merging. CI runs them only for pull requests into `main`
and on manual dispatch (`.github/workflows/promotion.yml`).

```sh
bun run quint:check
bun run quint:tests
```

`quint:check` (`scripts/check-quint.ts`) parses and typechecks every model, runs every manifest
scenario through an explicit matcher, including named setup scenarios, and simulates each model.
It requires a successful CLI execution record for each registration. Simulation uses each
model's `bounds.maxSamples`, `bounds.maxSteps` and `bounds.seed`, falling back to
80 traces, 40 transitions and seed 20261107. `--samples`, `--steps` and `--seed` override them.
The gate requires both a deliberately false invariant and a failing scenario
assertion to be detected; a syntax/tooling error cannot satisfy either canary.
Manifest invariant names must resolve to top-level values or imported instances.
`additionalProofInit` runs an extra one-transition simulation and symbolic check
when its corresponding command is selected. `bounds.maxVerifyDepth` sets the
default symbolic depth for that model; explicit `--steps` overrides it.
`verifyBackend: "tlc-bounded"` selects exhaustive safety checking through that
transition bound. BrowserSession uses it with its unchanged six-transition default.
The checker appends a depth counter to the translated model, checks every state
at depths zero through the bound, and records the scope, depth and translation
hashes. It does not establish safety beyond that bound.

`quint:tests` runs the `test/quint-*` files. Each drives product code against one model's
transitions and compares what the code did with the model after every step.

Model checking is separate and needs JDK 21 in this repository. Quint fetches its
pinned Apalache 0.62.4 distribution when needed. The CLI also uses that
distribution's TLC implementation. The supplied TLC configuration bounds heap
and worker count. Change the server endpoint when running independent checker
processes concurrently, since a single server does not isolate concurrent jobs.

```sh
# Bounded symbolic safety checking
bun scripts/check-quint.ts verify --steps=4

# Exhaustive finite-state safety checking
bun scripts/check-quint.ts verify --backend=tlc --models=ChatInput

# Fairness-guarded temporal properties for the historical models
bun scripts/check-quint.ts temporal --backend=tlc --models=SignIn,GoogleConnect,Maps

# Require the expected current-design passes and counterexamples
bun scripts/check-quint.ts compare --backend=tlc --models=ChatInput
```

`--models` selects comma-separated module names. `--out` selects the JSON
evidence file. `--jobs` or `ALPHA_QUINT_JOBS` allows independent scenario,
simulation and typecheck workers. The default is one worker. Each model keeps
its ordered phases, and the receipt lists results in registry order. Use
`ALPHA_QUINT_JOBS=3 bun run quint:check` to apply this to the standard gate. Model
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

After changing implementation behavior, review the corresponding executable model, its scenarios
and its source entry points in the family manifest, and run that model's `test/quint-*` file.
Shared behavior stays pinned by `upstream.lock.json`; the vendor checkout is immutable.

## Implementation refinement

A refinement test runs product code with controlled environmental ports and maps its concrete
state through an explicit abstraction. Every recorded implementation event must correspond to a
named model transition or leave the abstract state unchanged; a rejected command must find the
model transition disabled. The test imports, bundles or compiles the whole product source file.
A check that cuts a region out of a source file, asserts on source text or restates the model in
JavaScript is not refinement and does not belong here.

An adapter lives in its test file, `test/quint-<name>.test.mjs`, unless another module also uses
it. Shared drivers, ports, fixtures and Java harnesses are in
`specs/quint/refinement/<family>/`. Adapters that cover several models at once run from
`test/quint-<family>-refinement.test.mjs`. A model has more than one test file only when each file
drives a different product component through it: AgentCalendarRefresh (refresh and mutation
controllers), CanonicalNotesController, CanonicalNotesDraft and CanonicalNotesFeedback (the
controller, draft, mutation and view surfaces), CoreFactWriteDedupe (dedupe and write scope),
HostedDigestRefresh (refresh, mutation and the renewal question), MapsScreenModes (model-trace
replay and the explicit-schedule canaries), NativeCredentialMutation (credential leases and the
native and service campaigns), NativeLiveCapture and SharedRecordingAdmission (frame, live and
piped capture and shared recording), NativeStreamBridge (the bridge and forwarded receipts),
PhotosWindow (window, trash, owned album and browser album storage) and ResidentRuntime (resident,
scheduling admission, start cancellation and the native campaign).
`specs/quint/refinement/check-traces.mjs` evaluates the
generated checks with the pinned Quint interpreter, compares observations after every checkpoint
and fails on a mismatch; `test/quint-refinement-harness.test.mjs` includes a deliberately wrong
observation. A trace has this shape:

```js
{
  name: 'two speech windows',
  init: { name: 'init' },
  expect: { 's.speaking': false },
  steps: [
    { action: { name: 'accept', args: [500] }, expect: { 's.speaking': false } },
    { action: { name: 'accept', args: [500] }, expect: { 's.speaking': true } }
  ]
}
```

Keys in `expect` name model expressions under the imported namespace; values come from observed
implementation state. A step with `action: null` checks an event that preserves abstract state.
An action with `reject: true` also checks that the model transition is disabled. Native adapters
need a JDK and the pinned org.json jar.

A passing test covers its recorded finite traces. Controlled ports stand in for Android, providers,
storage and scheduling; they are no evidence of device, provider or installed behavior.

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

Implementation correspondence is checked by the refinement tests above. It
remains a different obligation from proving all TypeScript/Java execution
refines all models. APK build and audit results,
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

`quint-checker.test.mjs` checks per-family model floors and a total scenario floor; an intentional
retirement requires an explicit review of that baseline. A model listed in a manifest without a
`test/quint-*` file has model checks only.
