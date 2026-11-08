# Native recording refinement plan

The prior native models do not represent the current segmented Notes recorder.
This tranche adds separate native models and real-source JVM drivers, preserving
the renderer recorder models owned by the UI refinement work.

## Source boundaries

- `AlphaNoteRecorder` owns one process-wide recording, its exact recording ID,
  owner/folder binding, current MediaRecorder, pause accounting, rollover timer,
  completed AAC segments and transcript journal. Finished in-memory segments and
  durably journaled segments can differ after a failed write.
- `AlphaNoteRecordingService` owns the foreground notification and its recording
  identity. Start, pause, resume, stop and destruction need independently observed
  admission and teardown outcomes.
- The Notes methods and event listener in `AlphaVoiceCloudPlugin` connect those
  components to permissions, lifecycle and the retained recording store.
- Shared `LocalVoiceRecording` owns the distinct bounded voice draft. Shared
  `RecordingStore` owns durable retained audio and metadata. Those responsibilities
  require separate source projections rather than treating one recorder as all of
  them.

## Models and observations

`NativeNoteRecording` will represent the current recorder resource, exact ID and
binding equality classes, idle/recording/paused/stopped state, segment cursor,
finished and durable prefix, transcript publication, pending rollover and restart
recovery. Native callbacks retain the recorder instance they belong to. The driver
exposes known failed journal writes, recorder open/stop failure, stale callbacks,
discard and remux failure.

`NativeNoteRecordingService` will represent requested and actual foreground
ownership, the current recording identity, queued command identity, notification
state and activity-independent service lifetime. Its driver will execute actual
service entry points with primitive notification/service ports and real recorder
state.

## First regressions to investigate

A delayed STOP command currently clears the service foreground unconditionally,
while pause and resume check the recording ID. Test a retired recording command
after a newer recording starts before deciding whether the source needs repair.

The plugin event listener reads `recordingId` for every closed state, while the
recorder's idle/discard status omits that field. Test actual discard delivery and
foreground teardown through the source listener.

## Evidence limits

MediaRecorder, codec, filesystem crash behavior and notification display are
external platform inputs. The driver will execute actual Java coordination and
read real temporary journal bytes, but arbitrary audio encoding and physical
microphone behavior require Android/device acceptance. No attached device or
real microphone is used by these fixtures.

## Implemented source relation

`NativeNoteRecording` now observes every declared model state field, including
exact pause timestamps, the file cursor, in-memory and durable transcript value
classes, current-file ownership and the rollover timer. Source schedules include
corrupt journal removal, missing segment removal, legacy unbound recovery, and a
failed transcript edit that restores the previously durable text after restart.
Known journal failures are injected before replacement. Android AtomicFile
replacement/power-loss behavior remains an external durability obligation.

The real service regression reproduced both a stale STOP and a stale START
removing the successor's foreground notification. The repair retains the admitted
foreground recording ID, ignores retired commands while a newer foreground owner
exists, and accepts a blank legacy STOP only after no recording remains open.
The actual Capacitor JSObject returns null for an absent recording ID. The fixture
compiles that class directly and treats JSArray construction/put as a JSON port.

The current controller boundary still excludes AlphaVoiceCloudPlugin permission
callbacks and the shared LocalVoiceRecording draft pipeline. Free-space exhaustion
is modeled but awaits a controlled source seam or Android filesystem fixture.
Those obligations are distinct from the physical codec and device acceptance
checks and are retained in the aggregate inventory.
