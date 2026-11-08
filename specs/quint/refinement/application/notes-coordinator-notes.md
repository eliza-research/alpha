# Notes coordinator refinement

The current driver executes the exact legacy Notes `vset`, failed-write status and encrypted-draft retention functions from `agent-adapter.ts`. It combines those functions with the real `SecureNotesStore`, shared document engine and draft slot. Shell rendering and storage scheduling are controlled ports. It does not install the entire application.

Two schedules queue two edits while the first commit is unresolved. The first reply is lost before or after durable publication. Both queued callers retain the failure, and the latest draft remains encrypted. Reopening reads the actual stored collection and keeps the retained draft. It does not automatically apply a previous draft. The current product requires an explicit recovery action.

These ten checkpoints use `initLegacy`. The separate canonical variant preserves its owner/read/write generations, queued edits, uncertain writes, selected note and folder identity. Canonical new-note creation, broad UI routing and physical persistence remain additional obligations.
