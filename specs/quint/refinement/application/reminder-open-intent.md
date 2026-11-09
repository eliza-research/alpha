# Legacy reminder open intent

An older reminder link requests an exact reminder and optional occurrence after
the next successful list refresh. The existing refresh generation decides which
read can update the cache. At baseline `0ec439ae4c`, returning to the original
screen after an intervening Notes visit allowed an old request to reopen
Calendar. Entering Calendar after that intervening visit also reopened it.

The adapter now records the app or Home navigation visit independently of the
refresh generation. One direct Calendar entry can carry the intent from its
original visit. The Workflows device reminder row still requests Calendar and
immediately starts the exact read. The read captures the requested visit even
when the shell still reports Workflows. A later resume can supersede the list
read while preserving that navigation intent.

The closed VM runs the actual legacy reminder adapter, reminder row projector,
and Workflows device-row branch. It holds list promises and the Calendar view
commit at synthetic ports. The replay compares the refresh and visit counters,
captured occurrence, cache, failure diagnostic, and the visit that owned the
Calendar open. It covers exact and changed occurrences, direct Calendar entry,
leave and return, stale reads, expiry, foreground loss, and current read
failure. A mismatched occurrence still opens Calendar without selecting a
different reminder detail.

The model covers one reminder, two occurrences, and three list generations.
Journal reconciliation, Android delivery and storage, mounted shell rendering,
and retained typed tap custody remain separate.
