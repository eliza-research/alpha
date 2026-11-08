# Notes mutation identity and durable representative order

This patch targets the exact four Notes source files listed in
`core-state-manifest.json` at upstream commit
`99b49439ce9d0cb5607e9831b9f7f58d89525029`. The four preimages are byte-identical
to the original reviewed 475a sources. The pinned checkout stays unchanged.

## Reproduced failures

Creating A and B, editing A to have B's plain content, then creating that content
again returned B as the replay while the canonical snapshot contained A. The
actual Notes client rejected the successful response because its mutation
identity was absent from the returned snapshot. Replay selection now uses the
existing canonical representative projection.

Equal or backward wall-clock readings also hid a successfully edited identity.
Notes now persist optional private `noteRevisions` allocated from the next
collection revision inside the existing serialized transaction. Representatives
compare that order first and retain the previous timestamp/array-order fallback
for legacy records. Public `StickyNote` and `NotesSnapshot` shapes stay the same.
A no-op create replay preserves both the collection revision and stored bytes.

## Storage and compatibility

The store projects a detached copy of the exact prospective committed document
before persistence. A projector failure leaves durable bytes and cache intact.
A projector cannot mutate the committed document. Read and mutation replies use
that exact projection, avoiding a later read of a different committed revision.
Ordering metadata is validated against active and trashed record IDs and the
collection revision. Permanent removal prunes old metadata. Moving a record to
Trash or restoring it preserves its identity, original timestamps and order.

Schema 1, 2 and 3 documents without metadata retain timestamp fallback. New
mutations introduce metadata only for edited or created records. Raw document
copies retain it. Older unpatched readers reject the new private field and leave
the bytes untouched. Rolling back the reader therefore requires a separately
reviewed migration. No production backup/import surface is introduced.

Restore keeps its existing raw transaction reply. Both restore orders preserve
the exact restored note, including timestamps, and the reply contains that ID.
Normal reads project one visible representative per plain content key. Raw
restore membership and visible membership are intentionally distinct.

## Authenticated consumption and checks

The shared runtime transform allowlist contains TaskService, four Notes files
and TurnControllerRegistry. Every compiled consumer validates its selected set
from the actual source graph. Mobile requires all six targets. Source hosts use
the authenticated preload before loading core. Runtime and refinement compilers
record original and effective source hashes.

`test/notes-replay-identity.test.mjs` executes original and patched service/broker
code and the actual browser decoder. `test/notes-logical-revision.test.mjs`
covers tied/backward clocks, legacy versions, mixed metadata, restart, rejected
stale CAS, raw copies, pruning and projection/validation failure.
`test/notes-store-lifecycle.test.mjs` covers real temporary-file persistence and
controlled encrypted-port CAS, shared serialization, stop and unknown outcomes.
The controlled port advertises the required encryption contract but implements
no encryption. Cryptographic storage, cross-process filesystem ownership and
power-loss durability remain external obligations.
