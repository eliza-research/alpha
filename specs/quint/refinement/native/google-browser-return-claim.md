# Native Google browser return claim

`GoogleBrowserReturnClaim` starts at a prepared browser attempt or a durable
pending record left without a live attempt. It models App Link admission,
the worker's claim, resume and return-hint timers, scoped cancellation,
pending-record compare-and-exchange, and the first exchange dispatch.
An admitted result can settle after either grace timer. An unusable result
releases the elapsed hint to its original fallback and preserves the record.

The source campaign runs the same authenticated Java method bodies as the
packaged sign-in regression. It compares 121 checkpoints in 23 schedules.
Read-only wrappers tag the actual queued worker and timer objects. The
observations include both queues, claim and retirement flags, pending
record identity classes, bridge outcomes and whether exchange began.
The input classes distinguish a foreign host from a query code on the
registered callback, which the native parser treats as a return hint.

The model bounds one attempt, four worker entries and four grace timers.
A worker dispatch is one transition, with deterministic storage and HTTP
ports and representative expired and unexpired records. Starting a new
attempt, interleavings within a worker, Android App Link delivery, secure
storage durability and provider behavior require separate evidence.

```sh
node --test test/quint-google-browser-return-claim.test.mjs
```
