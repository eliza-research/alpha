/// Recorder stage machine of chat Transcribe (stage, generation, busy) over its recording driver
/// (opening, recording, stopping, clip). A recording that ends with a clip is transcribed in the
/// same task; a failed transcription keeps the clip for another try. Transcribed text only becomes
/// an editable draft; applying it hands it to the composer and sends nothing.
module RecorderStage {
  type State = { stage: str, generation: int, busy: bool, task: str, token: int, staleStart: bool, staleTask: bool,
    driver: str, clip: bool, draft: bool, error: bool, stopFailed: bool, refusedAsRecording: bool, applied: int }
  var s: State
  // cleanup(): a new generation abandons the task in flight and cancels the driver's recording.
  pure def cleaned(st: State, stage: str): State = { ...st, stage: stage, generation: st.generation + 1,
    busy: false, task: "none", staleStart: st.staleStart or st.task == "start",
    staleTask: st.staleTask or st.task.in(Set("stop", "transcribe")), driver: "none", clip: false,
    draft: false, error: false }
  pure def settled(st: State): State = { ...st, busy: false, task: "none" }

  action init = s' = { stage: "closed", generation: 0, busy: false, task: "none", token: 0, staleStart: false, staleTask: false,
    driver: "none", clip: false, draft: false, error: false, stopFailed: false, refusedAsRecording: false, applied: 0 }
  // Transcribe opens from the chat, or Record again discards a clip whose transcription failed.
  // It does not open while an abandoned microphone start has not settled: the surface is still
  // stopping that capture.
  action enter = all { s.stage.in(Set("closed", "recorded")), not(s.staleStart), s.generation < 3, s' = cleaned(s, "ready") }
  action close = all { s.stage != "closed", s.generation < 3, s' = cleaned(s, "closed") }
  // A result that belongs to an abandoned generation changes nothing.
  action staleSettled = all { s.staleStart or s.staleTask, s' = { ...s, staleStart: false, staleTask: false } }
  action primaryStart = all { s.stage == "ready", not(s.busy),
    s' = { ...s, stage: "starting", busy: true, task: "start", token: s.generation, error: false,
      driver: if (s.driver == "none") "opening" else s.driver } }
  // The driver refuses a start while an earlier recording has neither a clip nor been released.
  action startSettled(ok: bool): bool = all { s.task == "start",
    s' = if (s.driver != "opening")
        settled({ ...s, stage: "ready", error: true, refusedAsRecording: true })
      else if (ok) settled({ ...s, stage: "recording", driver: "recording" })
      else settled({ ...s, stage: "ready", error: true, driver: "none" }) }
  action primaryStop = all { s.stage == "recording", not(s.busy), s.driver == "recording",
    s' = { ...s, busy: true, task: "stop", token: s.generation, error: false, driver: "stopping" } }
  // A stop that rejects releases the driver's recording, so recording can start again. A stop
  // that returns the clip goes on to transcribe it in the same task.
  action stopSettled(ok: bool): bool = all { s.task == "stop",
    s' = if (ok) { ...s, stage: "transcribing", task: "transcribe", clip: true, driver: "clipped" }
      else settled({ ...s, stage: "ready", clip: false, error: true, driver: "none", stopFailed: true }) }
  // The maximum-duration timer stops the recording on its own, unless a stop is already running.
  action maxDuration(ok: bool): bool = all { s.driver == "recording", s.stage == "recording",
    s' = if (ok) { ...s, stage: "transcribing", busy: true, task: "transcribe", token: s.generation, error: false,
        clip: true, driver: "clipped" }
      else { ...s, stage: "ready", clip: false, error: true, driver: "none", stopFailed: true } }
  action captureLost = all { s.driver == "recording", s.stage == "recording",
    s' = { ...s, stage: "ready", clip: false, error: true, driver: "none" } }
  // Another try at a clip whose transcription failed.
  action primaryTranscribe = all { s.stage == "recorded", s.clip, not(s.busy),
    s' = { ...s, stage: "transcribing", busy: true, task: "transcribe", token: s.generation, error: false } }
  action transcribeSettled(ok: bool): bool = all { s.task == "transcribe",
    s' = if (ok) settled({ ...s, stage: "review", draft: true })
      else settled({ ...s, stage: "recorded", error: true }) }
  // Cancelling a transcription closes Transcribe and returns to the keyboard.
  action cancelTranscribe = all { s.stage == "transcribing", s.generation < 3, s' = cleaned(s, "closed") }
  action apply = all { s.stage == "review", s.draft, not(s.busy), s.generation < 3,
    s' = { ...cleaned(s, "closed"), applied: s.applied + 1 } }
  action step = {
    nondet ok = Set(false, true).oneOf()
    any { enter, close, staleSettled, primaryStart, startSettled(ok), primaryStop, stopSettled(ok), maxDuration(ok),
      captureLost, primaryTranscribe, transcribeSettled(ok), cancelTranscribe, apply, s' = s }
  }

  val BusyHasCurrentTask = (s.busy == (s.task != "none")) and (s.busy implies s.token == s.generation)
  val ClosedIsQuiet = s.stage == "closed" implies (not(s.busy) and s.driver == "none" and not(s.clip) and not(s.draft))
  val ReadyCanRecord = (s.stage == "ready" and not(s.busy)) implies s.driver == "none"
  val NeverRefusedAsRecording = not(s.refusedAsRecording)
  val RecordingHasCapture = s.stage == "recording" implies s.driver.in(Set("recording", "stopping"))
  val LaterStagesHoldClip = s.stage.in(Set("recorded", "transcribing", "review")) implies (s.clip and s.driver == "clipped")
  val WaitingStagesAreBusy = s.stage.in(Set("starting", "transcribing")) implies s.busy
  val DraftOnlyInReview = s.draft implies s.stage == "review"
  val safety = BusyHasCurrentTask and ClosedIsQuiet and ReadyCanRecord and NeverRefusedAsRecording and
    RecordingHasCapture and LaterStagesHoldClip and WaitingStagesAreBusy and DraftOnlyInReview

  val RetryAfterFailedStopWitness = s.stopFailed and s.stage == "recording"
  val ReviewWitness = s.stage == "review" and s.draft
  val StaleTaskWitness = s.staleTask and s.stage == "closed"
  val StaleStartBlocksEntryWitness = s.staleStart and s.stage == "closed" and s.generation == 2
  val RecordedAfterFailedTranscriptionWitness = s.stage == "recorded" and s.error and s.clip and not(s.busy)
  val RecordAgainWitness = s.stage == "ready" and s.generation == 2 and not(s.staleStart) and not(s.staleTask) and not(s.error)
  val ReadyAfterErrorWitness = s.stage == "ready" and s.error and not(s.busy)

  run recordTranscribeApplyTest = init.then(enter).then(primaryStart).then(startSettled(true)).then(primaryStop)
    .then(stopSettled(true)).expect(s.stage == "transcribing" and s.busy and s.clip and safety).then(transcribeSettled(true))
    .expect(s.stage == "review" and s.draft and safety).then(apply)
    .expect(s.stage == "closed" and s.applied == 1 and s.driver == "none" and safety)
  // A rejected stop does not leave the driver recording: the next start is accepted.
  run failedStopAllowsRetryTest = init.then(enter).then(primaryStart).then(startSettled(true)).then(primaryStop)
    .then(stopSettled(false)).expect(s.stage == "ready" and s.driver == "none" and s.error and safety)
    .then(primaryStart).then(startSettled(true))
    .expect(s.stage == "recording" and not(s.refusedAsRecording) and safety)
  run failedTimerStopAllowsRetryTest = init.then(enter).then(primaryStart).then(startSettled(true))
    .then(maxDuration(false)).expect(s.stage == "ready" and s.driver == "none" and safety)
    .then(primaryStart).then(startSettled(true)).expect(s.stage == "recording" and safety)
  // An abandoned microphone start keeps Transcribe closed until it settles.
  run staleStartAfterCloseTest = init.then(enter).then(primaryStart).then(close)
    .expect(s.stage == "closed" and s.staleStart and not(s.busy) and s.driver == "none" and safety)
    .then(staleSettled).expect(s.stage == "closed" and safety).then(enter).expect(s.stage == "ready" and safety)
  run lostCaptureReturnsReadyTest = init.then(enter).then(primaryStart).then(startSettled(true)).then(captureLost)
    .expect(s.stage == "ready" and s.error and s.driver == "none" and not(s.clip) and safety)
  run cancelTranscriptionClosesTest = init.then(enter).then(primaryStart).then(startSettled(true))
    .then(maxDuration(true)).expect(s.stage == "transcribing" and s.busy and safety).then(cancelTranscribe)
    .expect(s.stage == "closed" and s.generation == 2 and s.staleTask and not(s.clip) and safety)
  // A failed transcription keeps the clip: it can be transcribed again or recorded again.
  run failedTranscriptionRetriesTest = init.then(enter).then(primaryStart).then(startSettled(true)).then(primaryStop)
    .then(stopSettled(true)).then(transcribeSettled(false)).expect(s.stage == "recorded" and s.clip and s.error and not(s.busy) and safety)
    .then(primaryTranscribe).then(transcribeSettled(true)).expect(s.stage == "review" and s.draft and safety)
  run recordAgainDiscardsClipTest = init.then(enter).then(primaryStart).then(startSettled(true)).then(primaryStop)
    .then(stopSettled(true)).then(transcribeSettled(false)).then(enter)
    .expect(s.stage == "ready" and s.generation == 2 and not(s.clip) and s.driver == "none" and not(s.error) and safety)
}
