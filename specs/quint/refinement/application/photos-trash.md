# Native Photos Trash lifecycle

`PhotosTrash` follows the actual `loadTrash` function and its renderer and
visibility callers inside `installPrototypeCameraAdapter`. Fourteen source
schedules cover initial load, coalescing, next-page merge, failure/retry,
visibility changes during a read, disposal, an inactive visible view and return
from another view. The existing `PhotosWindow` fixture supplies deferred native
Trash requests. Shared row-order functions are imported from the window model.

The source previously cleared native Trash rows on hide while leaving
`trashLoaded` true. A loaded Trash view then returned empty and issued no new
request. Hiding now invalidates the loaded marker. Visible return requests the
missing Trash read, including when an older read still needs to settle. Old
success and error responses check their epoch, visibility and disposal before
publishing. Loading ownership remains until the request's final cleanup.

The model preserves visible inactive cache completion and the source's retained
private array after disposal. It checks the rendered native lifecycle rather
than claiming physical memory erasure or a provider retention guarantee.

Three media identities, four request identities, two cursors and bounded
rank/revision classes define the finite campaign. Delete/restore operations,
selection, confirmation dialogs, provider storage, expiry and browser-owned
Trash remain separate protocols.
