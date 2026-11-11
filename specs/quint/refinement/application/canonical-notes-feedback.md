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
| Try again finds the draft already saved on its exact existing record ID | Clear feedback and the failed-interaction latch, as a commit does |

The source schedules include delete/restore failures, read recovery with
and without a dirty draft, a successful editor commit, direct card creation,
failed discard/reload and retirement. Four cover Try again (`retryDraft`): a
draft saved on top of a newer collection whose own record is untouched (an
ordinary commit), an update whose lost reply is found saved by the read, a
record changed elsewhere and a failed read. The last two write nothing and keep
the draft in review. An additional schedule loses a new creation's response,
reads another record with identical words, and verifies that retry issues no
request, adopts no identity and retains the same dirty draft and interaction
failure. Identity admission is outside the four-field model; this source check
does not infer a new record identity from matching content. The delete and restore paths execute their
real controller/editor join. Raw source observations also retain row IDs,
selection, request/callback activity and command completion for later view work.
Credit in this model is limited to the four feedback fields.

The finite model includes every phase/review/failure value and both values of
its history bit. This establishes a small feedback safety property. Collection
rendering, pending navigation waits, recorder/dictation, folder state and
Calendar handoff remain separate application-state obligations.

TLC completed the finite safety graph with 23 distinct states, 438 generated
states and search depth five before `retryConfirmed` was added; that action has
the same effect as `committed`, and the TLC run has not been repeated with it
(typecheck, scenario tests and simulation pass). The source adapter passed
twenty-one traces with 223 checkpoints including the unconfirmed-creation schedule.
These are separate forms of evidence for the recorded
feedback projection, while broader implementation refinement remains open.
