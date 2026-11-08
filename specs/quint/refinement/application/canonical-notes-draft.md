# Canonical Notes draft and save protocol

`CanonicalNotesDraft` covers the shared `NotesEditor` methods used for one open
draft and its save. The source adapter executes the actual editor against
Alpha's current canonical controller and wire codec. Controller requests are
held at the transport boundary and completed in selected orders.

The model retains the current draft and a separate captured save snapshot,
including their token, record ID, base revision, edit version, text, framing,
format and color. It also records the queued edit version, current canonical
records, review callbacks and committed target callbacks. Whole-record
observations cover all thirty-three declared leaf fields. Fresh UUIDs are
modeled as distinct bounded identities.

A read-only build-time observer puts the actual local `captured` reference in a
WeakMap when the source starts saving. It exposes that snapshot to the test
without changing editor or controller state. The renderer source remains
unchanged.

The twenty-nine schedules cover newer edits with and without a queued save,
new-record identity assignment, close/replacement while an old save is pending,
failed writes, owner loss, empty/whitespace/metadata-only drafts, rich list,
voice and link content, clean/dirty external revisions, removed records and
invalid inputs. Selected byte-framing checks distinguish existing verbatim
content from a new title/body pair. Model text classes preserve those selected
identities, while arbitrary byte strings and arbitrary rich JSON remain
separate codec obligations.

Save response publication, editor continuation and an automatically queued save
are one model macrostep. Intermediate promise microtasks and reentrant hooks
are not separately checked. The model bounds two record identities, five fresh
draft identities and four edit versions. `NotesEditor.remove` and `restore`, the
controller/editor/UI join, canonical selection and external UI ownership remain
explicit work for the canonical Notes UI model.

The final source run also checks repeat-save coalescing without a new version
and an unknown save failure while a newer version is queued. Rich-format
observations use exact JSON equality classes, so an unrepresented metadata
change fails the adapter.
