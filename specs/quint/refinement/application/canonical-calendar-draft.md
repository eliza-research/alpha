# Canonical Calendar draft ownership

`CanonicalCalendarDraft` follows Alpha's real canonical Calendar editor
adapter, form codec and shared durable draft controller. The outer slot
and inner form owner both bind a saved draft. The editor retires its old
text before reading another slot, and a new binding has a distinct
lifetime even when the same account returns. Already-queued writes remain
with their captured slot.

The source campaign checks 121 checkpoints in 17 schedules using the
actual controller and raw compare-and-exchange store. It observes the
binding token, pending read and write ownership, exact slot presence,
visible form, recovery and stale controls. It covers old and same-account
reads, held clears, the update gap before rebinding, foreign stored frames
and conflict restoration. A synthetic foreign row remains stored while
the current account cannot resume or export it.

The model bounds two owners, six lifetimes and one held read and write
per owner. The raw slot is synthetic and compares actual serialized bytes.
Provider dispatch, reminder destination conversion, arbitrary invalid
fields and persistence across device failure require separate evidence.

```sh
bun test test/quint-canonical-calendar-draft.test.mjs
```
