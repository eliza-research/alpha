# Mobile bundle receipt admission

[MobileBundleAdmission](../../services/MobileBundleAdmission.qnt) models the file and receipt identities read by the mobile build helpers. A returned candidate and a written receipt are separate observations. The verifier recomputes the expected receipt against its selected bundle and current inputs. A write can store a stale candidate. Readback rejects it until the receipt matches current inputs.

The source fixture copies the reviewed policy, pinned SDK producer and Bun lock, authored adapter inputs, all 23 reviewed UUID package files and the authenticated core patch sources. It executes both actual build interception callbacks and binds the resulting transform records. The connector lifecycle transform is checked for presence, uniqueness and exact output digest at receipt issue and readback.

The replay drives the actual input gate, receipt builder and verifier in private directories. It exercises the original policy and a coherent synthetic producer-policy revision, lock and source-pin refusal, UUID module and inventory faults, missing and malformed receipts, missing bundle bytes, and stale receipts after adapter, stamp or bundle changes. It also checks current receipt recovery, strict smoke and provenance fields, and a verifier-selected alternate directory.

The bundle and source stamp are synthetic. The helpers compare smoke claims as receipt fields. Compiler execution, smoke execution, actual staged copy timing, process interruption and installed runtime acceptance are separate evidence.

Run the replay and the original UUID fixture tests with Node 26.

```sh
node --test test/mobile-uuid-build.test.mjs test/quint-mobile-bundle-admission.test.mjs
```
