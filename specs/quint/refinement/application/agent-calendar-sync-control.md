# Linked Calendar review and control in the renderer

`AgentCalendarSyncControl` models the renderer methods for reviewing
linked Calendar, selecting a destination, resuming, pausing, recovering
and reading linked events. The review retains the current owner, session,
scope, control revision, writable Google sources and visible built-in
event IDs. Select and resume require a fresh match for the selected
source identity and selection version. Before dispatch the controller
rechecks its binding and the caller's draft fence.

The source campaign compares 267 checkpoints across 36 schedules. It uses
the current controller and default shared API over a controlled
AppRecordPort. The driver holds review and linked-event reads separately,
observes the actual selected source, and checks each control request's
operation, expected revision, idempotency key and destination. It also
covers retired operations settling while a newer owner's review stays
active. Direct linked-event reads use the live binding across a Calendar
refresh and keep their own cancellation signal.

Two owner, session and scope identities, two destinations, eight Calendar
epochs and seven attempts bound the model. The draft decision comes from
a controlled caller. Settings dialog state, Google grant and link
orchestration, provider replay and remote effects have separate scope.

```sh
bun test test/quint-agent-calendar-sync-control.test.mjs
```
