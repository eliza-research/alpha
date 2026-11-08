# Agent Calendar mutation and refresh ownership

`AgentCalendarMutation` follows the current controller's create, update
and delete methods. It models the displayed source or event admission,
provider version, recurrence scope, organizer disposition, the current
preservation read and the captured owner/session. One active mutation
defers the latest requested refresh without aborting its write.

The source campaign checks 134 checkpoints in 24 schedules. It executes
the actual controller and shared event-editor policy with controlled
preservation, read and provider replies. It compares actual dispatch
targets, versions, cancellation modes and operation keys. It checks
refusal before dispatch, unresolved create readback, changed preservation,
and a retired operation settling while its successor is still active.

The model bounds two owner/session identities and windows, eight epochs
and six attempts. The synthetic provider exercises the client boundary.
Current update admission delegates blank-key validation to the transport,
and create event readback checks the agent while update also checks the
destination. Provider effects and replay, linked control and Maps event
readback remain separate.

```sh
node --test test/quint-agent-calendar-mutation.test.mjs
```
