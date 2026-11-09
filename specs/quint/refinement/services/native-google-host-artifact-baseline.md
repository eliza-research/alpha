# Native Google host artifact custody baseline

[NativeGoogleHostArtifact](../../services/NativeGoogleHostArtifact.qnt) models the current producer and host receipt readback. The fixture executes the actual product artifact wrapper, TypeScript builder, committed SDK verifier, and host and worker verifiers. The client projection and compiler are closed ports. The compiler runs the actual SDK resolver and selected core transform callback and emits an inert module containing the SHA-256 of the synthetic input it read.

Each scenario owns a disposable committed SDK and generic worker artifact. The producer selects the exact synthetic Bun version, verifies the SDK before and after compilation, hashes the declared input files, and writes the additive host receipt. The fixture observes real output bytes, manifest bytes, compiler and metadata events, and temporary directory cleanup. Both a genuine zero-selected-core graph and a graph with the required connector transform are exercised.

Two baseline observations are preserved.

- The compiler reads product input version 1, then the fixture edits that input to version 2 before the compiler returns. The SDK remains committed and clean. The producer publishes module version 1 and records the current input version 2. Actual host readback admits the pair. `ReceiptBindsCompiledSource` is false for this accepted checkpoint. A coherent rebuild restores it.
- The producer can replace `google-host.mjs` before a later failure. Escaped metadata paths, missing selected transforms, metadata write refusal, absent or linked declared input, manifest write refusal, and SDK postcheck refusal all leave the old manifest in the selected schedules. Restoring the original input still leaves the old manifest pointing at different module bytes. Host and generic worker readback both reject the pair. A coherent rebuild restores usability.

The safety predicate captures the current guarantees, including matching current declared source and module bytes on accepted readback, producer event order and scratch cleanup. The stronger compiled-source equality and old pair preservation are separate baseline observations.

The comparison covers one private worker directory, one product input, two byte identities and one representative optional transform. Actual client projection, full Bun compilation, worker orchestration, Android staging, concurrent producers, process interruption and installed host execution remain separate.

Run the replay with Node 26.

```sh
node --test test/quint-native-google-host-artifact.test.mjs
```
