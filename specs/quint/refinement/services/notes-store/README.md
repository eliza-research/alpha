# Canonical Notes persistence refinement

The `CanonicalNotesStore` model distinguishes physical active/Trash records,
canonical visible representatives, the cached document, durable bytes and each
mutation's committed reply. Two note IDs, two plain-content equality classes,
three clock classes and collection revisions through eight form the finite
bound. The source campaign executes the actual NotesStore, NotesService,
server interact function and browser mutation decoder.

`runCanonicalNotesRefinement(extraSources = [])` captures the source compiler,
fixture, driver, model and authenticated patch inputs before executing source.
It returns one receipt and explicit remaining obligations for the service
aggregate. Its 11 schedules record 46 checkpoints and 22 observed expressions.
The controlled host supplies atomic string compare/exchange, clock and event
delivery. It advertises the encrypted-port interface requirement without
implementing cryptography.

## Observed contracts

- An ordinary create replay selects the canonical visible identity and keeps
  durable bytes and revision unchanged. Real client decoding checks identity.
- Private logical revision order selects a newly edited plain duplicate even
  when real wall time ties or moves backward. Legacy notes use timestamp and
  raw array order until an edit assigns private revision metadata.
- Deleting a plain note moves its logical duplicates to Trash. Either restore
  order returns the exact restored record and raw membership. Normal reads
  select one visible representative. Restore preserves original timestamps
  and ordering metadata.
- An encrypted write may persist before readback fails. Its cache remains old,
  a later stale write conflicts, and reopening loads the committed document.
  An explicit persistedSnapshot read does not update the cache.
- A delayed broadcast retains its own exact committed response even after a
  second transaction commits. A projection error persists nothing.
- A new empty document omits Trash. Its first clear adds the field and advances
  revision. Clearing the resulting empty document preserves the revision.

## Limits

The model is a bounded component refinement. It does not establish arbitrary
ID/content behavior, rich document format equivalence, full provider/action
permission orchestration, filesystem power-loss behavior or host encryption.
The stale-writer abstraction treats different revisions as distinct CAS tokens.
Arbitrary out-of-band byte changes at the same revision remain a host-port
obligation. The model retains old note field values after permanent removal;
permanent deletion and metadata pruning are exercised by source regression
outside this collection model. Lookup-based consolidation and empty/error
initialization, shared-instance reference counts and complete stop queues also
remain outside these traces.

The source regression files separately exercise real temporary-file storage,
shared same-process instances, stop/queued-write ordering, schema versions 1,
2 and 3, raw document copies, invalid private metadata and old reader rejection.
Older unpatched readers reject the new optional document field without rewriting
it. Public StickyNote and NotesSnapshot replies retain their existing shapes.

## Verification at upstream 475a8d59dc

Quint 0.33.1 typechecking and 16 declared scenarios pass. A TypeScript-backend
simulation of 1,000 traces by 80 steps passes with seed 123. The real source
campaign passes through `test/quint-canonical-notes-refinement.test.mjs`.
Source and model hashes are retained in the generated receipt under
`test-results/quint-refinement/CanonicalNotesStore.json`. Bounded symbolic
results and superseded attempts are retained under `test-results/quint-notes/model`.
The authenticated transform and source regression prerequisite is commit
3185352291. A newer upstream pin requires a separate correspondence review.
