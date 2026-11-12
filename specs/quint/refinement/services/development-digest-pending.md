# Development digest pending storage

The as-built replay invokes `developmentDigestStore` and `localAgentStorage` using a closed request function and an in-memory filesystem. For a newly persisted reviewed request and an older saved record without a phase, writing the same payload with phase `dispatched` fails in the renderer before its CAS request reaches the host. The prior exact bytes remain stored. No provider call, credential, real profile or socket participates.

The exact as-built baseline is commit `6477306da2184c21710c4a4265550ec96018c2ed`.

## Corrected phase transition

[DevelopmentDigestPending](../../services/DevelopmentDigestPending.qnt) models one selected pending slot. The renderer permits only the serialization of the original payload with phase changed from review or absent to dispatched. The CAS expected value remains the original host byte string, including legacy whitespace. Changes to the body, turn, route, summary, renewal binding or serialized field order remain refused, as does a transition back to review.

Seven source traces compare 52 checkpoints. Two renderer instances demonstrate stale advancement and stale removal after a commit. Re-encoding a legacy row can produce a conflict even when its decoded payload is the same. When the acknowledgement is lost after commit, the original renderer still uses the old expected string and its retry conflicts. Reading the host row restores the exact dispatched state. A failure before the host receives the CAS preserves the reviewed row.

The fixture controls request faults and substitutes the host filesystem with memory while retaining the actual adapter logic. Physical durability, process interruption, overlapping calls within one renderer store and provider mutations are separate. CAS distinguishes byte values within this scope.

```sh
bun test test/quint-development-digest-pending.test.mjs
```
