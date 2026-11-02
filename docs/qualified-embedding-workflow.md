# Qualified embedding inputs for the resident workflow

The existing `resident-android.yml` stays model-free for ordinary Cloud dispatches. `local_embeddings: true` is valid only with `runtime_profile: cloud` and requires four exact inputs: `embedding_component_artifact_id`, `embedding_component_sha256`, `embedding_qualification_artifact_id`, and `embedding_qualification_sha256`. SHA-256 values identify the complete ZIP archives, not individual files.

Both artifacts must originate from successful runs in this canonical repository. The acquisition step checks metadata identity/digest/expiry, bounds the downloads, does not forward the token to redirected storage, and rejects unsafe or oversized archives. It never builds native code or manufactures semantic qualification.

The component archive uses the existing layout: `component-output/INTENT.json`, `component-output/export/PREPARATION.json`, and the three qualified ARM64 library names under that export directory. Those records preserve the original compiled Alpha/SDK/engine tuple.

The separately reviewed semantic archive provides `QUALIFICATION.json` and `embedding-qualification.json` at its root. The allowlisted qualification retains the original compiled identity, input, JNI, and library fields, plus `qualifiedAt` only after actual ARM64 semantics and independent review and `semanticReceiptSha256` matching the raw report. It does not copy the whole preparation record: commands, environment data, and other unapproved fields are excluded. Original `pin`, `forkPin`, `inputs`, `producerInputs`, `jniBinding`, and library paths/hashes must remain unchanged. Additional harness/device evidence can be included. The raw report must record passing ABI21/BGE384 checks, 10 calls with finite nonzero norms, repeat/reopen/relatedness thresholds, and drained caller retirement without claiming kernel cancellation.

The workflow retains the canonical BGE model, then runs the existing embedding stager with the immutable qualification and a separate `--library-root` mapping to the extracted bytes. The mapping never rewrites the original receipt or relabels its compiled pin. Existing source/producer/library/model verification must pass against the consumer before the normal archive build proceeds.

This source wiring is not a build dispatch, semantic result, signed release, or device acceptance. An unqualified compile-only archive must fail. The subsequent app still needs Direct/Cloud and data-continuity tests on the target device.


## Publishing the initially local semantic receipt

No qualification artifact exists until the ARM64 test actually passes and the result is reviewed. Prepare a **data-only carrier commit** with exactly `embedding-qualification/QUALIFICATION.json` and `embedding-qualification/embedding-qualification.json`. Allow only the fields accepted by `validate_carrier_schema`; do not include commands, environment dumps, private app data, account/history, filesystem preimages, or unrelated harness logs. Keep the original compiled source fields and original library paths. Review the two file hashes before publishing the carrier.

Run the separate **Publish reviewed embedding qualification** workflow on the reviewed code revision, supplying the exact carrier commit, both file SHA-256 values, and the original component artifact ID/archive hash. It checks out the carrier as data only, validates its immutable identity and every selected field against the compiled component and semantic thresholds, and uploads only those two files. It does not build, install, deploy, or create a release. Its artifact ID and digest become the qualification inputs to the resident build. The artifact is a carrier for a reviewed result, not a substitute for performing the test.
