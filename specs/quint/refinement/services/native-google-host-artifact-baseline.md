# Native Google host artifact custody baseline

Commit `c568151b104b454f74d9ea1545765afd6a009941` preserves the original bounded producer and host receipt readback. The fixture executes the actual product artifact wrapper, TypeScript builder, committed SDK verifier, and host and worker verifiers. The client projection and compiler are closed ports. The compiler runs the actual SDK resolver and selected core transform callback and emits an inert module containing the SHA-256 of the synthetic input it read.

Each scenario owns a disposable committed SDK and generic worker artifact. The producer selects the exact synthetic Bun version, verifies the SDK before and after compilation, hashes the declared input files, and writes the additive host receipt. The fixture observes real output bytes, manifest bytes, compiler and metadata events, and temporary directory cleanup. Both a genuine zero-selected-core graph and a graph with the required connector transform are exercised.

Two baseline observations are preserved.

- The compiler reads product input version 1, then the fixture edits that input to version 2 before the compiler returns. The SDK remains committed and clean. The producer publishes module version 1 and records the current input version 2. Actual host readback admits the pair. `ReceiptBindsCompiledSource` is false for this accepted checkpoint. A coherent rebuild restores it.
- The producer can replace `google-host.mjs` before a later failure. Escaped metadata paths, missing selected transforms, metadata write refusal, absent or linked declared input, manifest write refusal, and SDK postcheck refusal all leave the old manifest in the selected schedules. Restoring the original input still leaves the old manifest pointing at different module bytes. Host and generic worker readback both reject the pair. A coherent rebuild restores usability.

The baseline safety predicate captured the as-built guarantees, including matching current declared source and module bytes on accepted readback, producer event order and scratch cleanup. The stronger compiled-source equality and old pair preservation are separate baseline observations.

The baseline comparison covered one private worker directory, one product input, two byte identities and one representative optional transform. Actual client projection, full Bun compilation, worker orchestration, Android staging, concurrent producers, process interruption and installed host execution remain separate.

Run the replay with Node 26.

```sh
bun test test/quint-native-google-host-artifact.test.mjs
```


## Corrected producer

The current [NativeGoogleHostArtifact](../../services/NativeGoogleHostArtifact.qnt) model includes compiled-source binding and prior-pair preservation in its safety predicate. The builder hashes the bytes it supplies through Bun's existing file loader, records raw authenticated preimages for selected core transforms, and requires its metafile graph to match the consumed paths. It also binds the compiler output digest before writing the private candidate. The producer rechecks the prepared SDK and fixed inputs and verifies the candidate with the unchanged public manifest schema and fixed module name before publication.

The selected rollback test refuses the final manifest rename after the new module reaches its live path. The producer restores the exact old module bytes and mode, or removes only its candidate on a first publication. Other tests cover compiler source drift, fixed input drift, escaped, unbound or incomplete graphs, missing transform evidence, corrupt private output, missing or linked input, and a detected independent edit to the live module. The 18 source traces check 148 states including their initial observations.

A separate optional pinned Bun 1.4.2 test compiles and executes only inert synthetic modules in a private tree. It verifies 13 graph input bindings, including TypeScript and JavaScript module variants, JSX, JSON and a text import. The connector's public input digest binds the raw preimage while the emitted module executes the reviewed transformed bytes.

```sh
ALPHA_QUINT_BUN=/absolute/path/to/bun bun test test/quint-native-google-host-artifact.test.mjs
```

The selected guarantees cover serial local producer execution and definite filesystem refusals. Fixed-name publication still uses two renames, so independent readers can see an intermediate pair, and process interruption or rollback failure can require a rebuild. Cross-process exclusion, full product Bun graph admission, staged worker custody and installed Android acceptance are separate checks.
