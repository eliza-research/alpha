# Canonical Notes collection view

`CanonicalNotesView` follows the current `CanonicalNotesUi` collection projection
and navigation waiter list. The adapter executes that class with its actual
editor, controller and wire codecs. Accepted transport replies, edits, create,
leave, remove, retirement and held saves drive thirty source schedules and 291
checkpoints. Ten observation paths cover all twenty-one declared state leaves.

The view's `baseRows`, `rowsValue`, `openValue`, `blankCreationValue`, `trashValue`
and `idleWaiters` have direct projections. The existing `CanonicalNotesFeedback`
model covers its other three private fields. The public list and open getters
are also checked across current-owner loss. These two models cover the class's
declared private state through bounded source observations. They do not establish
universal refinement of all commands or all payloads.

Read-only build-time observer calls run after accepted base projection, draft
painting, waiter admission, phase draining and explicit retirement. The adapter
rejects a changed source seam. It keeps actual continuation identities distinct,
so admission order and removal of the waiter list are compared directly. The
observer does not change production state. External native actions and global
connection copy are unused controlled ports.

Snapshots and editor draft callbacks are inputs from the separately modeled
controller and editor. The view model checks how those inputs become displayed
rows, including list order, in-place replacement, new draft insertion, canonical
identity assignment, draft identity replacement, text/kind/pin/folder data,
local-handle omission and owner masking. Tests include empty and authored voice
and link formats, view-field collisions in rich metadata, dirty/clean external
changes, queued saves, two waiting navigations, failure and retirement while a
navigation waits.

The source retains base pin/folder metadata in a draft overlay when a replacement
format omits those fields. The model preserves that behavior. Text/list formats
explicitly change the draft row kind, while other formats retain an existing
base row kind. Unknown rich metadata, date formatting, link-domain derivation
and voice-array normalization need further payload checks. The bounded model
uses two canonical IDs, five draft IDs, up to three queued waiters and explicit
text/format classes.

The callback model observes admission and draining of `settle()` waiters. It does
not prove the eight-attempt loop, every competing navigation outcome, DOM row
focus, record/playback controls, dictation, folder storage or note-to-Calendar
handoffs. Those remain separate source-transition obligations.
