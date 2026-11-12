# Historical Quint migration verification

This section records the original migration run on 2026-11-07. It does not certify the integrated source revision. The historical source pin is
`b25d8aef2916385c571f4367e099809254fde0bb`. The source basis is the existing
working tree, including its uncommitted product changes.

## Scope and tools

There are 58 admitted model files and 396 registered scenarios, covering the
seven historical designs and 51 current-runtime models. The source ledger has
858 files and eight configuration inputs. Product code, development code and
test-support code have separate inventory classifications.

The toolchain is Quint 0.33.1, Apalache 0.62.4, Node 26.13.0 and JDK 21.
Model-checker output generated from Quint is retained as ignored test evidence.
Authored TLA+ source and the obsolete Python runners/configurations were removed.
Historical result tables retain their original evidence classification.

## Integrated formal gate

`bun run quint:check` passed all 174 model phases, comprising typechecking,
scenario execution and seeded simulation for every model. All 396 registered
scenarios passed. Each simulation used seed 20261107, up to 80 sampled traces
and 40 transitions per trace. The deliberately false invariant canary was
detected. Source and model hashes remained stable throughout the run.

The final aggregate receipt is in `test-results/quint/check-final.json`.
Focused integration tests passed 16/16, covering coverage rejection, CI selection,
counterexample admission and real-source conformance adapters. The standalone
application TypeScript check also passed. Their final log is
`test-results/quint/focused-tests-final.log`.

## Exhaustive legacy checks

All seven proposed models passed exhaustive finite-state safety checks. All 12
declared temporal properties passed with their original fairness assumptions.
The reachable-state counts match the historical source configurations.

| Model | Distinct states |
| --- | --- |
| SignIn | 10,173 |
| GoogleConnect | 498 |
| Calendar | 687,728 |
| Maps | 12,316 |
| ChatInput | 38 |
| HomeLayout | 900 |
| SettingsNav | 16 |

Calendar's final fair-temporal pass traversed a 2,750,912-state temporal product
and completed in 14 minutes 47 seconds. Its generated checker inputs and hashes
are recorded in `test-results/quint-legacy/summary.json`.

The new comparison runner separately checked all six historical-current
ChatInput properties, requiring four counterexamples and two passes. The
fairness-guarded SignIn temporal command also passed through that runner.
Every individual current-design temporal comparison is executable, but the
complete current-design comparison matrix was not rerun during this migration.

## Bounded runtime checking and source correspondence

Current-runtime safety checking uses an explicit four-transition bound. It is
additional evidence about the finite models. The complete implementation is
not proved to refine those models.

- The initial 13-model native receipt at
  `test-results/quint-native/proof-results.json` includes model/dependency hashes,
  commands and timings. Two initial checker connection/startup failures were
  preserved and their fresh-port retries passed. Four added native models and
  the expanded composition have separate final receipts. The original
  composition check is retained as historical evidence.
- Service checks passed for all 14 service models. Actual outputs are under
  `test-results/quint-services/`. Those direct CLI runs captured source hashes
  during archival, after checking. The receipt states this provenance limit and
  separates superseded model versions and infrastructure failures.
- All 20 application-family models passed four-transition symbolic safety
  checking with source hashes captured before and after each invocation. The
  receipts are `test-results/quint/application-symbolic-final.json` and
  `test-results/quint/callback-symbolic.json`.
  Additional historical development receipts are retained separately.

The native adapter replayed 1,992 Quint states through the real Java policies,
passing 6,013 Java assertions and ten TypeScript navigation assertions. Other
source adapters checked permission denial/restart, private-tab persistence,
large-text layout, composer conflicts and held-draft release. All 240 finite
voice-deletion evidence combinations were compared with the real planner.
The added renderer-recovery/VAD runner compared 5,361 trace states and passed
12,085 Java assertions. The static delegation-return page ran in an isolated
DOM against eight Quint traces for validation, query scrubbing and link exposure.

The four new native models and two updated grant-restoration models passed
1,000-trace simulations with up to 80 transitions. Renderer recovery and VAD also
passed one-transition checks from every finite counter shape, reaching the
otherwise longer loss-budget and sixteen-low-window boundaries. A replaced
voice IPC handle is protected by the added `ForeignHandlePreserved` invariant.

All 51 runtime models have passing four-transition safety evidence for their
current hashes. `test-results/quint/final-proof-index.json` validates the current
hash of every model against its applicable receipt, retaining the distinct
hash-provenance labels. Updated native and service receipts are under
`test-results/quint-native/producer-validation.json`,
`test-results/quint-native/VoiceIpcAssembly.cas-correction.json` and
`test-results/quint-native/recovery-vad-supplemental.json`. The final composition
receipt is `test-results/quint-composition/validation-final.json`, with an action
coverage audit beside it. Earlier superseded revisions retain their own logs.

The scan adapter executes `openScanDocument` with isolated storage/export ports.
It reproduced the current explicit-save-after-autosave defect. Its desired
preservation invariant is recorded as an expected violation, and the comparison
runner independently required that counterexample.

## Repository and Android gates

`bun run verify` completed with exit 1 after its formal gate and TypeScript stage
passed. The Node suite reported 1,953 tests, with 1,916 passed, 32 failed and five
skipped, in 63 minutes. Its full output is
`test-results/quint/repository-verify.log`.

The failures include a Maps traffic-capability assertion, five background-restore
fixture errors (`holdOperation` is missing), native campaign fixture timeouts,
a Vite module-fetch timeout, a JVM timeout, and three tests requiring a JDK path
that this shell did not provide. These existing runtime/test sources were not
changed by the migration. The Maps contract and background fixture failures
were reproduced separately. Model and source-conformance tests passed in that
run. Later model additions and runner fixes have separate final receipts in this
report.

A targeted rerun with `JAVA_HOME=/usr/lib/jvm/java-21-openjdk` passed all 20 tests
in the SMS, phone-login, credential-shutdown and recovery-review suites. This
includes the five failures those suites reported during the aggregate run. The
log is `test-results/quint/existing-jdk-targeted.log`. The Notes query script also
passed separately because the failed aggregate test command stopped before it.


A separate production web build and bundle audit passed. The audit checked 408
files with `testMocks=false` and found no mock, fixture or developer surfaces.
Outputs are retained in `test-results/quint/production-web-build.log` and
`test-results/quint/production-bundle-audit.log`.

Both required Android commands were rerun and exited 2 before Gradle.
`bun run android:build:local` stopped in embedding-host admission because staged
`libelizainference.so` and `libelizavoicejni.so` differ from the reviewed bytes.
`bun run android:build` reported that the pinned native engine needs
requalification. The exact outputs and command results are retained in
`test-results/quint/android-attempts.json` and its linked logs.

No standalone or launcher APK was produced by these attempts. APK inspection,
installed emulator/HOME behavior, AOSP image boot, real-service integration and
physical-device/user acceptance have separate evidence requirements. The model
checks establish none of those acceptance results.

## Remaining limitations and known behavior

The models use finite identity, content, time and collection abstractions.
Upstream implementation details are modeled at their consumed contracts and
remain tied to the source pin. The ledger enforces source review and ownership,
rather than proving a correspondence for every variable or instruction.

The scan draft-deletion defect remains present in runtime source. Changes to
existing product source in this migration update formal-specification references
in comments. The existing uncommitted product implementation is preserved.

The checker timeout regression deliberately failed a one-second invocation and
verified that it was recorded as a tool failure. Checker descendants are stopped
as a process group. The preliminary aggregate typecheck attempt used an
unsupported CLI option, failed, and was corrected before the integrated gate.
Failed and superseded evidence was retained.

Final review found that a broad counterexample-output expression could accept
an unknown property named `InvariantViolated` as a model violation. The runner
now requires the pinned CLI's explicit violation and terminal-error markers,
rejects tool diagnostics and has a regression test for that missing-property
case. The full model gate and historical comparison were rerun after the fix.
Unexpected runner exceptions now produce failed receipts. An in-progress receipt
starts with `passed=false`, so interruption preserves an explicitly incomplete
result. A regression test exercises that interruption path and child cleanup.
An intermediate integrated run was stopped when a composition test attempted
restored grants before finishing the preceding authentication cleanup. The
scenario setup was corrected, all 27 composition cases passed, and the complete
58-model gate was rerun successfully. The interrupted log is retained separately.

## Published baseline

The PR carries prerequisite product source in commit `875f5a8550935c5ca1797cea4ea38e7c7759ca54`.
Current verification writes fresh results under `test-results/quint/`.
Implementation refinement follows in subsequent commits.

## Registry change, 2026-11-10

The sections above are the record of the 2026-11-07 migration and are unchanged.
The registry has since grown and the runner has changed, so none of the counts or
receipts above describe the present manifests.

The four manifests now register 335 models and 2,439 scenarios: 165 application,
68 service, 75 native and 27 legacy modules. 104 models declare 419 reachability
witnesses and 86 models declare 827 source symbols. The default gate now also
requires a counterexample for the negation of every witness and a detected
failing-scenario canary, checks source symbols when the manifests load, and no
longer runs a separate typecheck phase. `check-quint.ts verify` runs an additional
one-transition pass for models that declare `additionalProofInit`.

No aggregate result for this registry is recorded here. A fresh full
`bun run quint:check` receipt and fresh model-checking receipts
(`check-quint.ts verify`, and `compare` and `temporal` for the legacy modules
that declare those checks) are required for the 335-model total before any pass
is claimed for it. Earlier receipts remain evidence only for the model and source
hashes they recorded.
