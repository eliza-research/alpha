# Fact-write deduplication

The two profiles in `CoreFactWriteDedupe.qnt` preserve the original empty and
prefilled `FactWriteDedupe` specifications. Both configure three writers and
`Serialised = TRUE`. The source replay aliases expose the existing `Check`,
`Insert`, `Update` and state. They leave `Next`, the properties, fairness and the
profile constants unchanged.

## Current owner and activation

`AgentRuntime.createMemory` delegates to `RuntimeDataMutations.createMemory`.
For the `facts` table, `serialiseFactWrite` chains jobs by room in one runtime
instance. The owned section calls `findEquivalentFact`, then either invokes
`adapter.createMemories` or applies `mergeStrongerFactMetadata` through
`updateMemory` and `adapter.updateMemories`. The adapter checks and writes the
current `memory` rows. The normal single-item route supplies the current agent
identity and redacts content before lookup. The batch `createMemories` route
goes directly to the adapter and has its own contract.

At SDK pin `99b49439ce9d0cb5607e9831b9f7f58d89525029`, the audited mobile bundle
contains this core owner, `plugin-sql/src/base.ts`, the assistant message pipeline
and the fact evaluator. The detached legacy `runFactsAndRelationshipsStage`
returns before model inference or writes when `isMobilePlatform` is true.
`ElizaAgentService` sets `ELIZA_PLATFORM=android` for the resident process. On
desktop/server the message pipeline can start the legacy stage when extraction
has candidates and `EvaluatorService.ownsDeferredFacts` does not take ownership.
The assistant's `createAssistantBehavior` registers the incremental `factMemory`
and `preferences` evaluators. Their accepted write branches call
`runtime.createMemory(memory, "facts", true)` independently of the legacy stage.
The witness exercises the write owner once called. It leaves model inference,
evaluator admission, post-turn job production and device execution to their
respective source and integration campaigns.

## Source correspondence

| Model boundary | Source observation |
| --- | --- |
| `Init` | Actual PGlite rows in one room, empty or seeded through `AgentRuntime.createMemory` |
| `Check` | Completed SQL lookup and the branch reaching an actual insert or update adapter port |
| `Insert` and `Update` | Real SQL write followed by the public runtime call returning |
| `rows`, `pc`, `seen`, `owner` | SQL evidence lists, held source-port admission, captured lookup and its one active writer |

The replay uses the pinned SQL test fixture with real plugin migrations and a
unique temporary PGlite directory. Its explicit `postgresUrl: null` selects local
PGlite regardless of process environment. The byte-bound compiler includes the
effective core transforms and PGlite resources before source execution. Gates hold
SQL results or writes outside the database transaction. The six submission orders
execute under each profile. Different outer whitespace is an equivalent fact.
The witness verifies that all successful writers return the same persisted ID,
retain their evidence IDs and merge the stronger confidence value. A lookup held
before branch admission projects to stutter. The source FIFO gives a concrete
order within the original model's nondeterministic choice of waiter.

## Checked boundaries outside the original profiles

- One writer rejected before SQL commit retires its tail. A queued successor can
  read and insert. The translated success profile has no failure transition.
- Two different rooms enter their write ports concurrently. The translated
  profile represents a single room.
- An equivalent row behind 119 newer non-equivalent rows is still found. Behind
  120 newer rows it falls out of the candidate window, and the real database
  stores a second equivalent row. `NoDuplicateFact` applies within the modeled
  recent-candidate premise.
- Two `AgentRuntime` instances sharing the same adapter can both see an empty
  room and insert distinct rows. The lock's ownership is instance-local. The
  translated profile models one owner, and the replay gives no multi-process SQL
  isolation guarantee.

The bounded campaign uses active distinct-ID facts and finite successful SQL
replies. Same-ID adapter semantics, inactive evidence, other owners, lost commit
responses, and post-persistence hook failure or delay remain separate obligations.
The fixture uses the SQL plugin without the evaluator service, so an installed
evaluator's `mutateSourceEvidence` reconciliation is a separate owner boundary.
The insert path awaits `after_memory_persisted` after releasing the per-room
section, so source liveness additionally depends on hook completion.

Run the campaign with `node --test test/quint-fact-write-dedupe-refinement.test.mjs`.

## Separate current-source model

[FactWriteScope](../../services/FactWriteScope.qnt) models the runtime instance
and room as separate lane keys. It records the bounded SQL lookup, captured
candidate, write admission and public settlement. A rejected precommit write
releases its lane, so a queued successor can insert and the rejected evidence
can retry against that row. Two runtime instances may capture a miss in the
same room before either inserts. Distinct rooms may run concurrently within
one runtime. The model permits both cases and places no uniqueness requirement
on the normalized fact text.

The [source replay](../../refinement/services/fact-write-scope.mjs) checks SQL
candidate counts and ranks at 119 and 120 newer rows, including the old row
that remains durable after it falls out of the candidate window. It also
checks instance and room boundaries, refusal before an insert or metadata
update, retry, and replay of evidence already present. The source campaign
covers distinct IDs, one entity, active evidence, ordered fixture timestamps,
and known precommit failure. It leaves concurrent hits on the same metadata,
ambiguous commits, multiple adapters or processes, and persistence hooks as
separate obligations.

Run it with `node --test test/quint-fact-write-scope.test.mjs`.
