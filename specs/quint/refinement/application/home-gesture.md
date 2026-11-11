# Home pointer and edit ownership

`HomeGesture` follows the mounted Alpha Home adapter. A press retains its
pointer, tile and timeout. A drag keeps its initiating pointer until
completion or retirement. Drawer opening, a covered Home and unmount fence
the corresponding old gesture, and a replacement Home gets a fresh click
suppression state.

The source campaign checks 114 checkpoints in 20 schedules. It drives the
actual Home callbacks with the shared launcher and navigation, and reads
the actual press, drag, layer, edit and click-suppression state. It covers
the movement threshold, other-pointer and old-timeout delivery, protected
drops, add-sheet and Back ordering, a keyboard reorder and its deferred
focus, and recreation. The Chromium cases also exercise the Home renderer
with native bridge fixtures.

The model bounds two pointer identities, three favorite keys, fixed tile
geometry and one deferred focus frame. A drop compares the final order
after its writes. Multiple failing writes, full focus trapping, overlapping
host instances and physical Android touch delivery require separate
evidence.

```sh
bun test test/quint-home-gesture.test.mjs
```
