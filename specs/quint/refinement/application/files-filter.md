# Files filter coordination

`FilesFilter` executes the current prepared shared Files runner in a mounted
Browse view. The adapter observes actual access and query generations, filter
identity, matched rows, native request order and agent outcomes. Held storage
ports can return a grant, denial, ready result, unavailable result or transport
rejection. The shared filter matcher and sorter run against those replies.

A late rejected query previously erased a newer filter's rows, then reported a
successful zero-item result for the superseded request. The authenticated
client patch fences both successful and failed replies by the current query
and filter identities. A replacement clears the old rows when installed.
Denied access, unavailable queries and superseded work produce a failed
result, while a successful empty query still reports zero matches.
The agent's abort signal prevents publication after cancellation.

The campaign checks 17 schedules with three operation identities, two text
classes and four unique rows. It covers repeated filter text with a different
owner, stale admission/readback, clearing by chip or Back, and abort before
or during each await. A separate source regression leaves the view during a
reload and checks that the retired query preserves the last active rows.

Native storage and provider effects remain controlled ports. The model starts
after mounting and settling the initial Browse read. It does not cover the
full watch/reload coordinator, provider query implementation, arbitrary
metadata or file mutations.

```sh
node --test test/quint-files-filter.test.mjs
```
