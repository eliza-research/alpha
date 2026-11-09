# Scheduled task controls

The unified Workflows view displays owner-visible LifeOps scheduled tasks.
Its edit review can change instructions and the time of a recognized cron
preset while preserving the preset pattern and stored time zone. Custom
cron and manual tasks keep their trigger when instructions change. An
owner-confirmed action records its exact intent before the request.

The closed replay at `38c997d5ca` exposed six failures. A fired result with a
wrong or missing task identity, and a skipped result for a different task,
cleared the pending request. A completed manual task appeared paused and
offered active actions. A confirmed missing schedule retained its detail
when another source failed. A failed schedule list left stale controls
enabled. The renderer now uses the schedule source's own freshness and
preserves terminal status. Fire replies that include a task must identify the
exact task. The runner's raced reply carries no task by contract, so it
reports the race without claiming a run started.

The adapter executes the real Alpha renderer callbacks, protocol and route
table, along with the shared intent store through Alpha's installed-slot
adapter. A controlled shell and in-memory storage and request ports expose
the status menu, edit draft, visible review verb, exact serialized request,
held reply and owner-scoped intent bytes. The source replay checks a lost or
incorrect receipt, explicit release without replay, and a reply held across
owner replacement. Every dispatched request is observed after its exact
intent exists. The reviewed body first becomes observable at admission.

The replay uses one synthetic scheduled task, two owners and fixed UTC
examples. Mounted browser callback ordering, physical and browser document
storage, server-side scheduling and worker effects remain separate.
