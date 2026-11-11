# Calendar-aware Google disconnect

`GoogleCalendarDisconnect` follows the helper that starts Cloud privacy
revocation with optional Calendar pause and callback retirement. Calendar
pause uses the captured lease, managed connection, source, version and
control revision. Cloud privacy authorization can remain valid after
Calendar ownership changes.

The source campaign compares 272 checkpoints across 59 schedules. It
executes `disconnectGoogleWithCalendar` with independently held Calendar,
revoke and callback ports and controlled timers. It checks exact pause
request and readback, reply ordering, timeouts, cancellation, and
Calendar ownership loss before or after a pause was confirmed.

The model bounds one verified connection and one attempt per operation.
Callback retirement and Calendar pause report their own outcomes. The
helper always reports provider drain as unavailable. Mounted publication,
native access state, persistence and installed provider effects have
separate scope.

```sh
bun test test/quint-google-calendar-disconnect.test.mjs
```
