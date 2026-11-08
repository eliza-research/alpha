# Permission coordinator refinement

The current adapter executes `StartupPermissions`, its durable progress reader and the shared permission flows with real React in JSDOM. Seven native permission bridges and connection subscriptions are controlled ports. It records 31 schedules and 192 checkpoints, including changed owners, an A-to-B-to-A owner sequence, overlapping requests, hidden setup, fresh read-only reactivation, historical four-, five- and six-step completion, and failed progress writes.

The source sequence and current credential jointly fence callback publication. A retired callback cannot advance setup or clear a newer busy lease. Reactivating setup reads permission status without requesting permission. The model keeps one prompt per permission per flow lifetime and distinguishes best-effort persisted attempts from current in-memory attempts.

The hook observer forwards every call to React. Native bridge calls, callback queues and storage failures are recorded separately from the model projection. The existing progress-store component trace remains in the aggregate alongside the coordinator receipt. Real Android prompts, process death and assistive technology remain external obligations.
