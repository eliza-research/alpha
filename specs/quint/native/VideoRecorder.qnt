// One browser video recording: chunk admission against the size limit, the stop and settle
// race, cancellation, and the adapter's finalisation before the preview stops.
// Sizes are in units; the limit of two units stands for 100 MB.
module VideoRecorder {
  pure val Max = 2
  type State = {
    session: str, generation: int, bytes: int, chunks: int, full: bool, settles: int, cause: str,
    adapter: str, finalizing: bool, leaving: bool, previewStopped: bool,
    rows: int, resolved: int, savedGeneration: int, settledGeneration: int, failures: int
  }
  var s: State
  action init = s' = {
    session: "none", generation: 0, bytes: 0, chunks: 0, full: false, settles: 0, cause: "none",
    adapter: "idle", finalizing: false, leaving: false, previewStopped: false,
    rows: 0, resolved: 0, savedGeneration: -1, settledGeneration: -1, failures: 0
  }
  pure def admit(bytes: int, chunk: int, max: int): { keep: bool, stop: bool, bytes: int } =
    if (bytes + chunk > max) { keep: false, stop: true, bytes: bytes }
    else { keep: true, stop: bytes + chunk == max, bytes: bytes + chunk }
  action shutter = all {
    s.adapter == "idle", not(s.finalizing), not(s.leaving), not(s.previewStopped), s.generation < 3,
    s' = { ...s, adapter: "starting" }
  }
  action startResolved(ok: bool): bool = all {
    s.adapter == "starting",
    s' = if (ok and not(s.previewStopped))
        { ...s, adapter: "recording", session: "recording", generation: s.generation + 1,
          bytes: 0, chunks: 0, full: false, settles: 0, cause: "none" }
      else { ...s, adapter: "idle" }
  }
  // A chunk that would pass the limit is left out and recording stops with what was collected.
  // Once the limit stopped the recording every later chunk is left out too.
  action chunk(units: int): bool = all {
    s.session.in(Set("recording", "stopping")), Set(1, 2, 3).contains(units),
    val admitted = admit(s.bytes, units, Max)
    s' = if (s.full) s else { ...s, bytes: admitted.bytes, chunks: if (admitted.keep) s.chunks + 1 else s.chunks,
      full: admitted.stop, session: if (admitted.stop) "stopping" else s.session }
  }
  // The duration limit or an ended camera track stops the recorder.
  action limitOrTrackEnded = all { s.session == "recording", s' = { ...s, session: "stopping" } }
  pure def settled(v: State, ok: bool, cause: str): State =
    { ...v, session: if (ok) "saved-pending" else "failed-pending", settles: v.settles + 1,
      cause: cause, chunks: if (ok) v.chunks else 0, settledGeneration: v.generation,
      resolved: if (ok) v.resolved + 1 else v.resolved }
  action recorderStopped = all { s.session == "stopping",
    s' = if (s.bytes == 0) settled(s, false, "empty") else settled(s, true, "none") }
  action recorderError = all { s.session.in(Set("recording", "stopping")), s' = settled(s, false, "recorder-error") }
  action stopDeadline = all { s.session == "stopping", s' = settled(s, false, "deadline") }
  // The shutter again, back, the recording poll or leaving the view finalises once.
  action finish = all { s.adapter == "recording", not(s.finalizing),
    s' = { ...s, adapter: "idle", finalizing: true,
      session: if (s.session == "recording") "stopping" else s.session } }
  // Finalisation saves exactly one row for a settled recording of the current session.
  action finalized = all { s.finalizing, s.session.in(Set("saved-pending", "failed-pending", "cancelled", "none")),
    val saved = s.session == "saved-pending" and s.rows < 3
    s' = { ...s, finalizing: false, session: "none", rows: if (saved) s.rows + 1 else s.rows,
      savedGeneration: if (saved) s.generation else s.savedGeneration,
      failures: if (saved or s.failures == 2) s.failures else s.failures + 1 } }
  // Leaving the camera finalises a recording before the preview is stopped.
  action leave = all { not(s.leaving), s' = { ...s, leaving: true } }
  action finishOnLeave = all { s.leaving, s.adapter == "recording", not(s.finalizing),
    s' = { ...s, adapter: "idle", finalizing: true,
      session: if (s.session == "recording") "stopping" else s.session } }
  // Stopping the preview cancels whatever recorder session is left.
  action stopPreview = all { s.leaving, s.adapter != "recording", not(s.finalizing), not(s.previewStopped),
    s' = { ...s, previewStopped: true,
      session: if (s.session == "none") "none" else "cancelled",
      settles: if (s.session.in(Set("recording", "stopping"))) s.settles + 1 else s.settles } }
  action returnToCamera = all { s.previewStopped, s.adapter == "idle",
    s' = { ...s, leaving: false, previewStopped: false } }
  action step = {
    nondet units = Set(1, 2, 3).oneOf()
    nondet ok = Bool.oneOf()
    any { shutter, startResolved(ok), chunk(units), limitOrTrackEnded, recorderStopped, recorderError,
      stopDeadline, finish, finalized, leave, finishOnLeave, stopPreview, returnToCamera, s' = s }
  }
  val LimitTruncatesNotDiscards = s.cause.in(Set("none", "empty", "recorder-error", "deadline"))
    and (s.session == "saved-pending" implies s.chunks > 0 and s.bytes > 0)
    and (s.cause == "empty" implies s.bytes == 0)
  val WithinSizeLimit = s.bytes <= Max and (s.full implies s.session != "recording")
  val SettledExactlyOnce = s.settles.in(Set(0, 1))
  val CancelledSessionNeverWritesRow = s.rows <= s.resolved and (s.rows > 0 implies s.savedGeneration != -1)
  val LeaveFinalisesBeforePreviewStop = s.previewStopped implies s.adapter != "recording" and not(s.finalizing)
  val OneFinalisation = s.finalizing implies s.adapter == "idle"
  val safety = LimitTruncatesNotDiscards and WithinSizeLimit and SettledExactlyOnce
    and CancelledSessionNeverWritesRow and LeaveFinalisesBeforePreviewStop and OneFinalisation
  val LimitReachedWithVideoWitness = s.full and s.bytes > 0 and s.session == "saved-pending"
  val OverflowChunkDroppedWitness = s.full and s.bytes == 1 and s.chunks == 1
  val SavedRowWitness = s.rows > 0
  val LeavingWhileRecordingWitness = s.leaving and s.finalizing and not(s.previewStopped)
  val FailedFinalisationWitness = s.failures > 0
  // The size limit is reached mid-recording: the video collected so far is saved.
  run limitReachedStillSavesTest = init.then(shutter).then(startResolved(true)).then(chunk(1)).then(chunk(2))
    .expect(s.full and s.bytes == 1 and s.chunks == 1 and s.session == "stopping" and safety)
    .then(chunk(1)).expect(s.bytes == 1 and safety).then(recorderStopped).then(finish).then(finalized)
    .expect(s.rows == 1 and s.failures == 0 and safety)
  run exactLimitKeepsChunkTest = init.then(shutter).then(startResolved(true)).then(chunk(2))
    .expect(s.full and s.bytes == 2 and s.chunks == 1 and safety).then(recorderStopped)
    .expect(s.session == "saved-pending" and safety)
  run emptyRecordingFailsTest = init.then(shutter).then(startResolved(true)).then(finish).then(recorderStopped)
    .then(finalized).expect(s.rows == 0 and s.failures == 1 and s.cause == "empty" and safety)
  run leaveFinalisesFirstTest = init.then(shutter).then(startResolved(true)).then(chunk(1)).then(leave)
    .then(finishOnLeave).then(recorderStopped).then(finalized).then(stopPreview)
    .expect(s.rows == 1 and s.previewStopped and s.session == "none" and safety)
  run recorderErrorDiscardsTest = init.then(shutter).then(startResolved(true)).then(chunk(1)).then(recorderError)
    .then(finish).then(finalized).expect(s.rows == 0 and s.cause == "recorder-error" and s.settles == 1 and safety)
}
