# Personal Assistant scheduled task custody

This campaign executes the pinned Personal Assistant dossier mutation,
automatic admission, automatic preparation, reconciliation, and anchor
registration code. The fixture extracts the selected runtime wiring and binds
it to the actual SDK scheduling runner, schema migration, task store, and
state-log store in private PGlite. Two runner handles share the same database.
Manual calls enter the SDK route through a synthetic request and response
context. Automatic calls enter the runner directly.

An untrusted signal leaves the managed row unadmitted. An admitted signal
stays durable while the SQL claim is held. The claim simultaneously sets
`fired`, clears the admission and commits its UTC day. In both caller
orders, a second claim of the same admitted day loses. A repeated signal on
that day remains ineligible after the winner settles.

The manual schedules distinguish completion before synthetic egress,
completion after synthetic egress, and complete–reopen–refire. In the last
schedule the older dispatcher still passes the status-only check against the
newer fired row. The SQL conditional write rejects the older snapshot and
the route returns the newer row. The newer dispatch then saves its own
receipt. Separate schedules preserve the fired state and instant while
changing either metadata or the definition. Each change independently
causes the stale completion write to lose.

This complements the [generic memory-store replay](lifeops-scheduled-task-route.md),
which can restore the older row. Exact occurrence identity at the
pre-egress check remains open. The manual refire uses distinct clock
instants. Same-clock identity, production runtime construction, family
transaction and execution wrappers, authentication, transport, PostgreSQL
deployment, and external provider delivery require separate evidence.
