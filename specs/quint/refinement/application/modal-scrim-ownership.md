# Modal and raised-composer scrim ownership

The bounded red replay uses the actual chat motion and Calendar month focus
adapters, the inline modal and inert helpers, and the phone stylesheet in
Chromium. A controlled shell binds their real pointer callbacks through React. A captured
mouse release still reached the inert scrim while Calendar owned focus.
An uncaptured release reached the modal and left the old press recorded.
Closing Calendar before release revived the old press, and a scheduled
fallback could lower the composer under either inline or native coverage.
The uninterrupted fallback lowered the dock once.

The raised composer now tracks the exact scrim element and press. An inert
acquisition on that element or its ancestors retires the press, releases
capture and clears its deferred fallback. Inert mutation history also
records coverage that began and ended in one task. Native modal focus
provides the exact top-layer acquisition. A nonmodal dialog and unrelated
inert changes leave a valid press alone. A compatibility click requires
the current released press and checks the pointer ID when the browser
supplies one. The same checks protect capture, release and timeout.

The source replay includes trusted mouse and touch, a delayed compatibility
click, an unreported pointer ID, a different reported ID, inline and native
open/close in one task, and a fresh release that reuses the retired pointer
ID. It observes capture independently of the press record. The draft and
unrelated controls remain owned by their original surfaces.

## App entry points

- Calendar month selection uses the actual month focus adapter in the
  replay. Its app controls, conversation and scrim are separate DOM branches.
- Inbox's sharing, attachment and provider reviews use the inline modal
  helper through the subview accessibility adapter. The conversation's
  Review email suggestion has the same review class inside the chat layer.
- Photos empty Trash and the retained Notes trash reviews also use inline
  modal refs. Their product-level open and close schedules are separate.
- Browser and Files sheets and the app's other inline menus use the shared
  focus and inert helper where their own refs are attached.
- Native dialogs can take ownership with the top layer alone. Explicit
  phone inert and native top-layer coverage both execute in the replay.
  This projection leaves nonmodal dialog behavior intact.

This replay compiles the actual adapters over controlled rendering and
modal invocation. The whole Alpha shell, other app-specific admission,
half-sheet gestures and installed Android compatibility event delivery
remain separate obligations.
