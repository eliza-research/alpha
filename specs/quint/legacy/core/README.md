# Shared core design configurations

The [migration report](migration-report.md) inventories the 16 shared core
specifications and 31 TLC profiles at upstream revision
`4787d51a142c63c98371c832997184c53f7218d3`. The Git blob hashes are in
[source-inventory.json](source-inventory.json). The checked-in Quint modules
live one directory above this metadata. The immutable vendor tree retains the
original upstream specifications.

Each default model appears in the legacy manifest. Its configuration records
select exact profile modules and preserve the original constant assignments,
invariants, temporal properties and deadlock setting. A qualified profile can
be selected without changing the source model.

```sh
node specs/quint/legacy/core/check-configurations.mjs --phase=check
node specs/quint/legacy/core/check-configurations.mjs --phase=symbolic --models=InteractionSession --steps=4
node specs/quint/legacy/core/check-configurations.mjs --phase=temporal --profiles=ActionSettlement.late --tlc-max-heap-mb=1024
```

The bounded phases use an explicit stutter action to represent the source
`[Next]_vars` relation. The finite phase compiles the exact `Next` relation and
sets TLC's original `CHECK_DEADLOCK` value. Fair profiles check their temporal
properties under the original fairness predicate. Prefix monitors translate
action properties without restricting the original state relation. The one
symmetry configuration records its source operator and the current checker
explores its unreduced graph.

The runner verifies upstream bytes using Git objects, checks the profile
metadata against the inventory and hashes the model, dependencies, tooling
and metadata before and after checking. Generated backend modules, logs,
checkpoints and receipts are stored under `test-results/quint-core-configurations`.
Type checking and simulations do not establish a complete temporal verdict.
