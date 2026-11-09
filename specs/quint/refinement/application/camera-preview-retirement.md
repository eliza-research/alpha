# Camera preview retirement

`CameraPreviewRetirement` separates the Camera leave callback from the
shell’s Home commit. The release latch retires the current request while
the old Camera view is still mounted. The scheduled preview sync sees
that latch. Home clears it after the preview is released, so a deliberate
new visit can start its own request. A retired stream ends even if a
newer stream is already visible.

Three mounted Chromium schedules and 33 checkpoints observe all seven
state fields and six transition actions. The fixture shares the rapid
leave regression’s media port. It records the real onLeave return and
queued sync, actual session request tokens, the visible video source and
each synthetic track’s terminal state. The source drives real Camera
buttons and the shell’s platform Home event.

The model bounds two visits with a closed conversation and controls the
timing of synthetic canvas streams. Android permission prompts, native
resume and physical media capture remain separate. The historical
CameraSession model is unchanged.

```sh
node --test test/camera-rapid-leave.test.mjs test/quint-camera-preview-retirement.test.mjs
```
