# Canonical Calendar event return

`AgentCalendarEventReturn` describes capture of a canonical event selection
and its readback before returning from Maps. The selection binds an event
identity, trimmed provider version, and unique Calendar source digest.
An in-flight request retains its owner, session, scope and Calendar epoch.

The source campaign executes 38 schedules and compares 203 checkpoints.
It uses the actual Calendar controller, default client and shared Calendar
API over controlled AppRecordPort replies. Each admitted attempt reads
the two-millisecond UTC event window and the current unfiltered source
list. The driver checks both dispatches and verifies that the readback
leaves the exact Calendar snapshot and publication count unchanged.

Cases distinguish missing or changed events, ambiguous replies, unreadable
sources, rejection, cancellation and a replacement binding. A refresh can
replace the selected version or source during a request in the same
epoch. The controller requires the captured selection again after both
replies. The separate Maps adapter owns visit lifetime, view-stack and
navigation checks, duplicate taps and legacy native event returns.
Provider effects and linked control also have separate scope.

```sh
bun test test/quint-agent-calendar-event-return.test.mjs
```
