# Notes coordinator refinement

The driver installs the actual `installAgentAdapter` on a synchronous shell
fixture and executes its normal mount, `vset`, unmount and remount paths.
The actual `SecureNotesStore`, shared document engine and draft merge functions
run over an atomic in-memory storage port. The shared `AlphaClient` also runs.
Unrelated native, rendering and connection registration ports remain controlled.

Two schedules submit two edits before the first commit settles. The first
acknowledgement is lost either before or after publication. The real document
engine retains that fault for the second queued operation. The coordinator keeps
the latest editor contents in the encrypted-draft slot.

On remount, the pre-publication failure resumes and confirms the retained edit.
The post-publication failure finds a changed saved note, keeps that newer saved
version and retains the conflicting draft. These schedules check ten model
checkpoints. Fixture content uses three explicit equality classes.

| Source observation | Model observation |
| --- | --- |
| Current editor record | `s.draft` |
| Shared document engine's verified snapshot | `s.content` |
| Current storage-port record | `s.storedContent` |
| Coordinator pending-operation count | `PendingCount` |
| Coordinator storage and uncertain-outcome flags | `s.fault`, `s.uncertain` |
| Persisted draft presence, content and base | `s.retainedDraft`, `s.durableDraft`, `s.durableBase` |
| Remounted coordinator conflict flag | `s.draftConflict` |

The model also preserves the existing Trash scenarios. A separate retained-draft
presence field distinguishes an empty change set from absent storage. Its
conflict invariant requires the retained record to remain present.

The source test, eight model scenarios, 1,000 simulations of 80 steps and bounded
symbolic safety through depth four passed in the isolated worktree. Arbitrary
note batches, all storage failures, physical durability, real React rendering and
Android Keystore behavior remain further refinement or integration work.
