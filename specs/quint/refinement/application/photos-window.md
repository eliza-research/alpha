# Native Photos catalog window

`PhotosWindow` executes the installed Photos adapter inside
`installPrototypeCameraAdapter`, together with the real `readWindow`,
`newestFirst` and `mergeWindow` helpers. Native access and catalog page promises
are controlled ports. The class and `readWindow` locals have read-only
build-time observers. Capture, editing, scanning, email and browser media ports
remain unused in this native catalog campaign.

Nineteen schedules cover first-page reads, next-page merging, a reload that
reads enough pages to preserve the loaded window, current failures, successful
retry, coalesced and reentrant reload, duplicate identity replacement across pages, stable
rank ties, visibility changes and disposal at either await point. An inactive
but visible Photos view can finish a cache read, matching the current source.
A hidden native window cannot publish catalog rows.

The initial source reproduced a visibility race. Hiding during the first
`libraryAccess` call did not invalidate its epoch because no prior access scope
was recorded. That call could later set full access, list native media and
populate the hidden catalog. Native hiding now invalidates and clears the
window regardless of whether its first access read has answered. The access
and page paths recheck visibility and epoch before publication. Loading remains
owned until `finally`, allowing reentrant retry requests to coalesce without
letting an older cleanup clear a newer read.

A separate source regression holds two summary requests, completes the newer
one successfully and then rejects the older one. The older failure no longer
sets the current counts error flag. Full counts state is still an unmodeled
protocol, so this focused regression does not claim its complete refinement.

The finite model uses three media identities, bounded date/revision classes,
two page cursors and four load identities. Within a single reload, the modeled
provider pages have distinct identities and do not repeat earlier rows. The
model does not shrink the implementation's window limit. Its source schedules
remain below that limit. Cross-page provider instability, arbitrary metadata,
large-window eviction, album and Trash loaders, selection/viewer state,
mutations, thumbnail retention and browser persistence remain explicit work.
