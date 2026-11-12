# Calendar return from a Maps visit

`MapsEventReturn` models ownership of the rendered Back to event control.
A read belongs to one captured origin object. Leaving the view, hiding the
document, receiving pagehide or disposing the adapter retires the pending
return. A later read can complete while a retired read is still settling.
The retained Calendar origin stays available for a fresh tap after pageshow.

The source campaign compares 129 checkpoints across 18 schedules. It
executes the actual Maps adapter and origin helpers with controlled shell,
screen and Calendar ports. A read-only observer captures the private
request token. The driver checks the exact canonical origin and native
event window, returned Calendar row and day, stack pop, unwind and notice
effects. Separate Chromium cases mount the real renderer and verify both
leave and reentry with a held Calendar GET and a visible pagehide followed
by a successful return after pageshow.

The model bounds two events, six captured origin objects and five return
attempts. The mounted browser tests use a closed Calendar service fixture.
Physical native or remote provider effects and detailed navigation guidance
have separate scope.

```sh
bun test test/quint-maps-event-return.test.mjs
```
