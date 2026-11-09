# Historical Camera session comparison

This campaign replays selected transitions against the unchanged
`CameraSession` Design profile. Chromium mounts the current Camera
renderer and shared session. A closed media port holds and releases
synthetic canvas streams. The replay covers first preview, late stream
retirement, the observed back zoom, a front-lens reset, and conversation
grace release followed by a new first frame.

Four schedules and 27 checkpoints passed. The real scan review opens and closes over a synthetic image and local
OCR. Those actions stutter in the historical state, which has no scan
review transition. The source projection observes the current view,
phase, capture mode, lens, flash, selected zoom class, conversation
cover and actual preview readiness. It drains already-issued synthetic
requests on retirement before reopening. The pre-fix renderer could issue
an extra preview request during the leave transition. That ordering
is covered by the separate rapid-leave regression.

The current source campaign excludes physical capture, photo and video
save, installed permission or resume behavior, and agent queue
settlement. The original Design and as-built model checks and their
historical outcomes remain separate from this comparison.

```sh
node --test test/quint-historical-camera-session.test.mjs
```
