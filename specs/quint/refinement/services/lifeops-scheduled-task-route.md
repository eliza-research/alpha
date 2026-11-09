# LifeOps scheduled task route

This campaign executes the generic scheduler route, request schemas and
response serializer from SDK `b1817660a`. Two actual runner handles share the
SDK in-memory task and state-log stores. A direct route context supplies body
and response primitives, a fixed clock, and controlled claim and dispatch
checkpoints. The observed storage and dispatch work stays in memory.

Owner-visible filtering keeps the list-only fixture row out of the filtered
response. The route rejects duplicate filters, malformed task path encoding,
empty edit bodies, read-only edits and an invalid snooze. An exact cron edit
returns the stored task and adds one edit event. A manual snooze, completion
and reopen expose their actual state and history fields.

Two claims against one scheduled snapshot yield one winner and one raced
reply. Completion before claim prevents dispatch. Completion after claim
blocks a held pre-egress guard and preserves the terminal write. Completion
after the synthetic dispatch port is entered also wins storage, while the
successful fire receipt returns the authoritative completed task. The
model distinguishes that outcome from dispatch failure and global pause.

The pinned generic runner permits a separate occurrence mismatch. After
one claim, a second caller completes, reopens and claims the task at a later
instant. The older dispatch guard accepts the later row because it checks
only the fired status. When the older synthetic success returns, the generic
post-dispatch conditional write accepts the same status and restores the
older occurrence snapshot. The newer guard then sees that older snapshot.
The source replay and directed Quint scenario record this behavior as a
counterexample to exact occurrence custody.

The minimum storage contract for that obligation is an occurrence identity
committed at claim and captured in each derived dispatch. The pre-egress
check must compare that identity with the current fired row. Preparation,
post-dispatch success, failure and deferred writes must compare it atomically
with the current row as well. The observed instant distinguishes these two
fixture claims. A production occurrence identity must also distinguish claims
created at the same clock instant.

This projection does not execute a configured host's admission wrapper,
network framing or authorization, PostgreSQL, provider dispatch, or recovery
after process loss.
