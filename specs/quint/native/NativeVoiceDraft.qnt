/// Current shared LocalVoiceRecording draft, timer and callback lifecycle.
module NativeVoiceDraft {
  type State = {
    id: int, capture: int, issued: int, file: bool, size: int,
    now: int, startedAt: int, duration: int, timer: bool, limit: int,
    event: str, eventId: int, events: int, selected: str,
    externalConfigured: bool, externalReady: bool
  }
  var s: State
  action init = s' = {
    id: 0, capture: 0, issued: 0, file: false, size: 0,
    now: 100, startedAt: 0, duration: 0, timer: false, limit: 0,
    event: "none", eventId: 0, events: 0, selected: "none",
    externalConfigured: false, externalReady: false
  }
  action start(id: int, limit: int, success: bool): bool = all {
    not(s.file), id.in(Set(1, 2)), limit.in(Set(29000, 59000)), s.issued < 3,
    s' = { ...s, id: if (success) id else 0, capture: if (success) s.issued + 1 else 0,
      issued: s.issued + 1, file: success, size: if (success) 1 else 0,
      startedAt: if (success) s.now else s.startedAt, timer: success, limit: limit,
      duration: 0, selected: "none" }
  }
  action constructorFailed = s' = s
  action advance(delta: int): bool = all {
    delta.in(Set(1000, 29000, 59000)), s.now + delta <= 120100,
    s' = { ...s, now: s.now + delta }
  }
  action fileSize(category: int): bool = all {
    s.file, category.in(Set(0, 1, 2)), s' = { ...s, size: category }
  }
  action stop(stopOk: bool): bool = all {
    s.capture != 0,
    val kept = stopOk and s.size == 1
    s' = { ...s, capture: 0, timer: false, duration: if (kept) s.now - s.startedAt else 0,
      id: if (kept) s.id else 0, file: kept, size: if (kept) s.size else 0 }
  }
  action automatic(ticket: int, stopOk: bool, consumerOk: bool): bool = {
    val kept = stopOk and s.size == 1
    if (ticket == s.capture and ticket != 0) all {
      s.events < 2, kept and not(consumerOk) implies s.events == 0,
      s' = { ...s, capture: 0, timer: false, duration: if (kept) s.now - s.startedAt else 0,
        id: if (kept) s.id else 0, file: kept, size: if (kept) s.size else 0,
        eventId: s.id, event: if (kept and consumerOk) "recorded" else "failed",
        events: s.events + (if (kept and not(consumerOk)) 2 else 1) }
    } else s' = s
  }
  action deadline(ticketId: int): bool =
    if (ticketId == s.id and s.capture != 0) automatic(s.capture, true, true) else s' = s
  action microphoneError(ticket: int): bool =
    if (ticket == s.capture and ticket != 0) all {
      s.events < 2,
      s' = { ...s, id: 0, capture: 0, file: false, size: 0, duration: 0, timer: false,
        event: "failed", eventId: s.id, events: s.events + 1 }
    } else s' = s
  action cancel = s' = { ...s, id: 0, capture: 0, file: false, size: 0, duration: 0, timer: false }
  action discard(ticketId: int): bool = if (ticketId == s.id and s.id != 0) cancel else s' = s
  action configureExternal(ready: bool): bool = s' = { ...s, externalConfigured: true, externalReady: ready }
  action selectDraft(ticketId: int): bool = s' = { ...s,
    selected: if (s.capture == 0 and s.file and ticketId == s.id) "draft"
      else if (s.externalConfigured and s.externalReady and ticketId == 3) "external" else "none" }
  action metrics(ticketId: int): bool = all { s.capture != 0, ticketId == s.id, s' = s }
  action recreate = s' = { ...s, id: 0, capture: 0, file: false, size: 0, duration: 0,
    startedAt: 0, timer: false, selected: "none", externalConfigured: false, externalReady: false }
  action step = any {
    constructorFailed, start(1, 29000, true), start(2, 59000, true), start(1, 29000, false),
    advance(1000), advance(29000), advance(59000), fileSize(0), fileSize(1), fileSize(2),
    stop(true), stop(false), automatic(1, true, true), automatic(2, true, true),
    automatic(1, false, true), automatic(1, true, false), automatic(3, true, true), deadline(1), deadline(2),
    microphoneError(1), microphoneError(2), microphoneError(3), cancel, discard(1), discard(2),
    configureExternal(true), configureExternal(false), selectDraft(0), selectDraft(1), selectDraft(2), selectDraft(3),
    metrics(1), metrics(2), recreate, s' = s
  }
  val CaptureOwnsDraft = s.capture != 0 implies s.id != 0 and s.file and s.timer
  val EmptyHasNoCapture = not(s.file) implies s.id == 0 and s.capture == 0 and s.duration == 0
  val TimerTracksCapture = s.timer iff s.capture != 0
  val Bounded = s.id.in(0.to(2)) and s.capture.in(0.to(3)) and s.issued.in(0.to(3)) and
    s.size.in(0.to(2)) and s.now.in(100.to(120100)) and s.events.in(0.to(2))
  val safety = CaptureOwnsDraft and EmptyHasNoCapture and TimerTracksCapture and Bounded
  run stoppedDraftSelectableTest = init.then(start(1, 29000, true)).then(advance(1000)).then(stop(true)).then(selectDraft(1))
    .expect(safety and s.selected == "draft" and s.duration == 1000)
  run staleCallbackAfterReplacementTest = init.then(start(1, 29000, true)).then(cancel).then(start(2, 59000, true))
    .then(microphoneError(1)).then(deadline(1)).expect(safety and s.capture == 2)
  run oversizedDraftClearedTest = init.then(start(1, 29000, true)).then(fileSize(2)).then(stop(true))
    .expect(safety and not(s.file) and s.id == 0)
  run consumerFailureKeepsRecordedAudioTest = init.then(start(1, 29000, true)).then(automatic(1, true, false))
    .expect(safety and s.file and s.event == "failed" and s.events == 2)
  run externalSegmentAvailableDuringDraftTest = init.then(start(1, 29000, true)).then(configureExternal(true)).then(selectDraft(3))
    .expect(safety and s.selected == "external" and s.capture == 1)
}
