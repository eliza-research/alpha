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
the saved order of surviving entries intact.

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
loss remain separate verification obligations.

Run the witness with `node --test test/quint-browser-journal-retention-refinement.test.mjs`.
