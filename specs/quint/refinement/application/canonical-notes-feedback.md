# Canonical Notes feedback

`CanonicalNotesFeedback` covers the feedback classifier in `CanonicalNotesUi`.
Its source fields are `phase`, `reviewPending` and `failure`. A separate history
bit records a failed interaction until explicit discard or a current editor
commit clears that review.

The adapter executes the actual UI, controller, editor and response codecs. It
wraps the installed callbacks, forwards each original call and records the
resulting source fields. Nested editor-review callbacks retain their real
ordering relative to read publication and phase changes. Final source stutters
also check that retired or obsolete-owner replies produce no feedback change.

| Source event | Modeled effect |
| --- | --- |
| Controller failure | Preserve an existing change review against later read errors, or classify a new read/interaction failure |
| Controller phase | Retain the review classification when the controller reports ready |
| Accepted read snapshot | Clear a read-only failure only for a current, idle, clean draft |
| Local review request | Enter change review without replacing the prior failure origin |
| Current editor commit | Clear feedback and the failed-interaction latch |
| Explicit discard/reload | Clear prior feedback before the new read starts |

The sixteen source schedules include delete/restore failures, read recovery with
and without a dirty draft, a successful editor commit, direct card creation,
failed discard/reload and retirement. The delete and restore paths execute their
real controller/editor join. Raw source observations also retain row IDs,
selection, request/callback activity and command completion for later view work.
Credit in this model is limited to the four feedback fields.

The finite model includes every phase/review/failure value and both values of
its history bit. This establishes a small feedback safety property. Collection
rendering, pending navigation waits, recorder/dictation, folder state and
Calendar handoff remain separate application-state obligations.

TLC completed the finite safety graph with 23 distinct states, 438 generated
states and search depth five. The source adapter passed sixteen traces with
155 checkpoints. These are separate forms of evidence for the recorded
feedback projection, while broader implementation refinement remains open.
