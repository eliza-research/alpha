# Canonical Notes remove and restore

`CanonicalNotesMutation` executes the actual shared `NotesEditor` through Alpha's
canonical controller and Notes wire codec. It extends the source coverage of
`CanonicalNotesDraft` to the remove and restore methods and their asynchronous
continuations. The existing editor compiler provides its read-only captured-save
observer. No production code changes are needed.

Thirty-seven schedules compare 170 checkpoints. Thirteen observation paths cover
all twenty-five state leaves, including the open draft identity and revision, current
collection and Trash membership, canonical authored-content classes, pending write kind and captured input, one
remove/restore continuation, queued editor version and review outcome. Fresh
UUIDs use distinct identity classes. A source call's returned promise supplies
its pending/completed result. Pending request parameters supply the write input.

The schedules include dirty-delete saves, replacement or closure during that
save, newer queued edits, empty drafts, revision changes, owner loss, second
command admission, editing during deletion, failure and malformed target
replies. Restore is checked against the collection revision present when its
request begins. Calls are checked after their actual promise jobs settle. A
successful prerequisite save, editor continuation, controller cleanup and
possible automatic queued save form one model macrostep.

The source permits a queued newer save to acquire the controller before a dirty
remove continuation. That remove then returns false and requests review. A
successful delete closes a matching editor even if it was edited while the
delete was pending. Both behaviors are retained in the model.

The model represents two note identities, five draft identities, four edit
versions and revisions through four. One remove/restore continuation is pending
at a time. Rejected concurrent probes are checked, while multiple overlapping
dirty-remove continuations, intermediate reentrant hooks and external
invalidation/read interleavings remain obligations.

Returned membership is an explicit source input. The codec checks canonical
identity consistency but does not itself require a delete response to put the
record in Trash. A valid unchanged-membership response is included so the model
cannot accidentally claim that stronger backend guarantee. Provider mutation,
revision allocation, Trash retention and durable storage still need their own
source-executing coverage. Full `CanonicalNotesUi` selection, row rendering,
navigation waits, folders and recorder/Calendar joins remain separate work.

Empty canonical records and a save reply containing empty content have explicit
source schedules. The shared content reconstruction and rich authored-text
functions classify each actual returned record before it is compared with Quint.
