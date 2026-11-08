# Browser Reminder orphan markers

The previous Reminder staging code assigned into an ordinary object. For a
first deletion ID of `__proto__`, that assignment changed the map prototype.
Serialization retained the Reminder row's `pendingDeletion` string and
discarded the prototype entry. This was reproduced by executing
`stageReminderDeletion` from commit
`b0eb368436d74d4976b70dc52354e51e51ed79d4`, then loading its serialized output
through the current domain migration. The old source digest was
`5ee15a9c2d962bf738e42beeb78d55e8abb9af194b75b0bf58efd2bfd0b544b2`.
The current staging code writes an own entry and persists its paired marker.

The [model](../../application/BrowserReminderOrphan.qnt) and [source replay](browser-reminder-orphan.mjs)
compare both kinds of stored state through actual BrowserDaily, Reminder
domain and Clock methods. They use the same opaque operation ID for the
historical and currently staged forms.

| Current operation | Legacy marker without its own record | Current queued record and marker |
| --- | --- | --- |
| Load, select and read | The stored marker survives migration and the row can still be selected. | The row remains available for current selection. |
| List pending deletions and recover a receipt | The pending list omits the marker. Deletion readback returns the row and no entry. The recovery helper returns no result. | The owned queued record appears in pending readback. |
| Restage, Undo and dismiss | Restaging refuses the marker. Undo and dismissal refuse without an entry. | A second stage refuses. A matching Undo in the open window clears the marker and keeps the row. |
| Automatic due posting and notification revival | The marker prevents both. A separate eligible row still posts. | The marker prevents both while the pair is pending. |
| Reminder update, reschedule, Snooze and Done | Ordinary valid decisions can apply. They keep the marker even when a new occurrence is created. | The domain guard refuses a mutation of the pending row. |
| Explicit same-ID schedule | The existing schedule API replaces the row and creates a new occurrence. | The domain guard refuses replacement while the queued record remains. |
| Reviewed create and cancel | Create requires a new identity. Direct cancel still requires the deletion window. | The same admission rules apply. |
| Clock cancel or reviewed bulk change | An otherwise eligible alarm action can apply and leave the marker. | The domain guard refuses a change to the pending alarm. |

The Clock sound gate checks the marker both before requesting the ringing lock
and after receiving it. The source replay leaves a posted orphan in the Clock
row list and observes no lock request. A second schedule holds a ringing
lock callback, stages an actual paired deletion, and observes no sound after
the callback's fresh read. A matching Undo restores the ordinary posted
alarm's ability to ring. Audio in the replay is synthetic.

The source campaign uses v1 one-off reminders, controlled document CAS and
notification ports, a held deletion clock and jsdom. It characterizes existing
mutations without providing a way to decide or replay a legacy deletion.
Resolution of an orphan requires separate reviewed policy. Actual IndexedDB,
Web Locks arbitration, browser/device sound, recurring timing and expiry
remain separate boundaries.

Run `node --test test/quint-browser-reminder-orphan-refinement.test.mjs`.
