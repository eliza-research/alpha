# Current Files folder readback

`FilesBrowserController` covers the installed Files adapter's access/volume
readback and folder-listing generation protocol. The source adapter executes
`installFilesBrowserAdapter`, the real storage helpers and the registered Files
agent runner from the authenticated shared client source. Native storage replies are deferred ports. A read-only build-time
closure observer exposes the current binding, active state, place, generations,
access, volumes, entries, loading fields and pending request history.

Thirteen schedules cover a current denial, late old denial/grant/failure,
late old listing success/failure, leave and re-entry at either await point,
primary-volume ordering and overlapping registered share requests. Each
observation is compared against the model. Listing replies in this campaign
are ready or rejected transport promises. Other provider status variants remain
uncovered. The model bounds two folders, three
entry identities, two volumes and six access-read identities.

The pre-fix source reproduced a stale readback error. After an old visibility
refresh paused at `storageState`, a newer folder read displayed `Owned.txt`.
Resolving the old call as denied erased that newer listing. The pinned client patch preserves stable list identities and gives the adapter a separate monotonically increasing access-read identity, checks the
caller's current generation before publishing access/volumes, and stops stale
callers. Folder, category and Trash results also require the view to remain
active before publishing. Final cleanup still releases the loading state of
its own generation.

An agent operation can request Files before its new render has committed. Its
access read therefore retains the existing admission boundary, while an
obsolete access request cannot dispatch a share after a newer request replaces
it. Full agent cancellation and review ownership remain separate obligations.

This is the first part of the current Files controller. Category and Trash
aggregation, filter queries, selection, preview, mutation dialogs, pressed-item
and timer ownership, native watch sequencing and durable storage semantics
still need their own source-transition coverage. `FilesPreview` separately
checks selected-capability ownership. `FilesTree` covers the separate storage and reviewed transfer contract.
