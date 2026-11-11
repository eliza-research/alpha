# Agent Calendar refresh

`AgentCalendarRefresh` follows the current Calendar read controller. It
models owner and session replacement, a changed range, retained legacy
review, three independently settled reads, one trailing same-window
request, and next-event freshness. A same-window transport failure keeps
the exact prior feed. A foreign agent, source or range response clears it.

The source campaign checks 237 checkpoints in 25 schedules. It executes
the real controller with a fixed clock, exact captured owner and window
inputs, and controlled provider and preservation promises. Source
observations include active and aborted requests, the deferred window,
feed and next-response identities, the published source state and an
actual source handle.

The model bounds two owner identities, sessions and windows and eight
request epochs. Mutations and their deferred refresh, provider replay,
Maps return, linked selection and real provider transport remain separate.

```sh
bun test test/quint-agent-calendar-refresh.test.mjs
```
