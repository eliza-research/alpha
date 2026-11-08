# Current canonical Notes controller

`CanonicalNotesController` models Alpha's current controller wrapper and the
shared `NotesController` / `NotesSnapshotState` that it invokes. It retains
separate identities for the current read pointer and all still-outstanding
transport requests, so aborting a read does not invent a completed transport.

## Source projection

| Model state | Source observation |
| --- | --- |
| `owner`, `retired` | Controlled current-owner port and the actual lifetime signal |
| `revision`, `notes` | The actual retained snapshot, observed through the erased TypeScript private field |
| `readId`, `readAbortId` | Actual pending promise and AbortController identities, mapped to the originating GET request |
| `reads`, `readCalls`, `aborted` | Controlled transport calls, their settlement flags and actual composed abort signals |
| `writeId`, `seq` | Actual `writing` flag and the recorded transport request sequence |
| `invalidated` | Actual shared controller flag |
| `phase`, `failure` | Values received through the real controller hooks |
| `publishedCurrent`, `publishedMonotonic` | History of actual snapshot callbacks |
| `listening` | Actual event-target listener registration/removal |

The public snapshot, revision, read-presence and pending-write accessors are also
compared. The adapter executes current response parsing and shape validation.
Its successful POST uses the valid `get-notes` capability, exercising the
controller's interaction serialization without inventing server mutations.

Fourteen schedules cover read coalescing, invalidation during read/write, explicit
refresh during write, duplicate-interaction refusal, write-time read abort in
both completion orders, failed requests, older revisions, retirement, loss of
current owner, changed bound identity while the port remains current, and
same-session listener filtering. Every checkpoint compares all seventeen
modeled state fields and four public projections.

Ownership loss is monotonic for the tested port instance. The current
`getAppRecordClient` captures the connection epoch, selected transport and session
by identity. A recreated port/controller starts a new initialization. The
connection controller's own lifecycle has separate source adapters.

The finite model uses two note identities, revisions zero through two and at
most six transport calls. Editor drafts, authored payloads, canonical mutations,
folder state, the full Notes UI and server durability remain separate
refinement obligations. These bounded traces establish the recorded projection.

Response publication and the following `finally` cleanup/reload are one model
macrostep. The current trace checkpoints observe their settled result. Hook
callbacks and promise microtasks inside that macrostep are not individually
checked, and arbitrary reentrant user-provided hooks are outside this adapter.
The application UI caller and editor join still need their own transition
coverage.

The model's `invalidate(-1)` means an absent revision or an invalid event
payload after the event handler has normalized it. A raw negative safe integer passed directly to the
controller uses the older-or-equal class zero. The source adapter checks that
case both before and after an accepted snapshot.
