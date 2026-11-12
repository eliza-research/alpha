# Browser journal retention

`BrowserJournalRetention` uses the production limits. `retireJournal` retains at
most 200 definite rows at the instant of trimming. A later write in the same
transaction can add one more. Age retirement applies to dated definite rows
strictly older than 30 days. The count and age tests use the same original cohort.
Missing timestamps sort at zero and are age-exempt. Ties keep the saved
`Object.entries` order. An unacknowledged Calendar creation stays until acknowledged
and its original timestamp is preserved through acknowledgement.

`trimDeletionJournal` retains the newest 127 terminal rows, ranked by
`deadline.createdElapsed`, and keeps every unresolved row. The replay claim keys
after trimming are the intersection of the original claims and the remaining own
deletion records. Staging may append a queued row and its claim. The helper leaves
the saved order of surviving entries intact. Receipt and deletion IDs that overlap
JavaScript prototype names are stored as enumerable own keys and participate in
the same retention and replay rules as other admitted IDs.

| Checkpoint | Real source |
| --- | --- |
| Direct count, age, missing timestamp, pending rows and replay claims | `retireJournal`, `trimDeletionJournal` in `apps/app/src/browser/journal-retention.ts` |
| Acknowledgement and append in a document transaction | `BrowserCalendar.save`, `BrowserCalendar.acknowledgeCreation`, `BrowserDaily.operateReminder` |
| Terminal retirement before reviewed staging and retained replay refusal | `BrowserCalendar.executeAgent`, `BrowserDaily.stageDeletion`, `stageCalendarDeletion`, `stageReminderDeletion` |

The source witness uses ordered concrete inputs immediately below, at and above
each cap. It also drives both browser entrypoints against the real domain-document
wrapper and a controlled document/review/notification fixture. The missing-map
case projects missing and empty records to the same logical journal. No settlement
or provider action runs in these traces. Installed Web Locks/IndexedDB behavior,
malformed documents, arbitrary timestamp histories and exact replay after journal
loss remain separate verification obligations. Older builds could leave a Reminder
with `pendingDeletion` set but no durable deletion when the identity was `__proto__`.
Those orphaned markers still need a reviewed recovery protocol.

Run the witness with `bun test test/quint-browser-journal-retention-refinement.test.mjs`.

The model represents wall timestamps as a UTC day and milliseconds within that
day. TLC accepts both integers, and comparing the pair with the same time of
day 30 days earlier preserves the exact expiry boundary. Missing dates and
dated zero sort together, while only dated zero is subject to age retirement.

The default TLC proof explores the full finite graph from the four initial
states, including interleavings of receipt and deletion actions. Count checks
use sets of row positions. The model reuses an ordered list when retention
keeps every row, and sorts the original definite or settled cohort when the
count limit requires eviction. Acknowledgement replaces the selected row at
its original position. These operations preserve the modeled transitions.

The source witness separately exercises concrete cutoff neighborhoods and
stable order. Both checks retain the limits described above for input histories
and installed browser scheduling.

```sh
bun scripts/check-quint.ts verify --models=BrowserJournalRetention
```
