/// One persisted execution, two timer identities and its host-owned wake-up reservation.
module WorkflowWakeups {
  type Run = { present: bool, typed: bool, status: str, finished: bool, active: bool,
    starts: int, now: int, wakeAt: int, stopped: bool, cancelled: bool,
    reconciliation: str, signals: int, openTimers: int -> int }
  var s: Run
  action init = s' = {present: false, typed: false, status: "none", finished: false, active: false,
    starts: 0, now: 0, wakeAt: 0, stopped: false, cancelled: false,
    reconciliation: "none", signals: 0, openTimers: Map(1 -> 0, 2 -> 0)}
  action admit(typed: bool): bool = all {
    not(s.present), s' = {...s, present: true, typed: typed, status: "queued"}
  }
  action enter = all {
    s.present, not(s.finished), not(s.active), not(s.stopped), not(s.cancelled), s.starts < 3,
    s' = {...s, active: true, status: "running", starts: s.starts + 1}
  }
  action timerCreated(id: int, at: int): bool = all {
    s.active, id.in(1.to(2)), at.in(Set(200, 1000, 2000, 2147483647)),
    s' = {...s, openTimers: s.openTimers.set(id, at)}
  }
  action timerClosed(id: int): bool = all {
    s.active, id.in(1.to(2)), s' = {...s, openTimers: s.openTimers.set(id, 0)}
  }
  pure def minimum(a: int, b: int): int = if (a < b) a else b
  pure def boundedDelay(now: int, target: int): int = minimum((if (target > now) target - now else 0) + 100, 2147483647)
  pure def earlier(existing: int, proposed: int): int = if (existing == 0) proposed else minimum(existing, proposed)
  action park(mode: str, timeout: int): bool = all {
    s.active, mode.in(Set("waiting-timer", "waiting-event", "waiting-approval")),
    timeout.in(Set(-1, 200, 1000, 2000, 2147483647)),
    val timers = s.openTimers.keys().map(id => s.openTimers.get(id)).filter(at => at > 0)
    val target = if (timers.size() > 0) timers.fold(2147483647, (a, b) => minimum(a, b)) else s.now + 60000
    val due = if (mode == "waiting-timer") s.now + boundedDelay(s.now, target)
      else if (mode == "waiting-event" and timeout >= 0) s.now + boundedDelay(s.now, timeout) else 0
    s' = {...s, active: false, status: mode, reconciliation: "none",
      wakeAt: if (due == 0) s.wakeAt else earlier(s.wakeAt, due)}
  }
  action workerUnknown(live: bool): bool = all {
    s.active,
    s' = {...s, active: false, status: "running", reconciliation: if (live) "worker-running" else "outcome-unknown",
      wakeAt: if (live) earlier(s.wakeAt, s.now + 1000) else 0}
  }
  action finish = all { s.active, s' = {...s, active: false, status: "finished", finished: true, reconciliation: "none"} }
  action signal = all { s.present, not(s.finished), not(s.stopped), s.signals < 2, s' = {...s, signals: s.signals + 1} }
  action advance(instant: int): bool = all {
    instant >= s.now, instant.in(Set(300, 1100, 2100, 60100, 1800001, 2147483647)), s' = {...s, now: instant}
  }
  action fire = all { s.wakeAt > 0, s.now >= s.wakeAt, s' = {...s, wakeAt: 0} }
  action cancel = all { s.present, not(s.finished), not(s.active), s' = {...s, cancelled: true, finished: true, status: "cancelled"} }
  action stop = all { not(s.active), s' = {...s, stopped: true, wakeAt: 0} }
  action restart = all { not(s.active), s' = {...s, stopped: false, wakeAt: 0} }
  action missedQueued = all {
    s.present, s.typed, s.status == "queued", s.now > 1800000,
    s' = {...s, finished: true, status: "finished", stopped: false, wakeAt: 0}
  }
  action staleCallback = s' = s
  action step = any {
    admit(false), admit(true), enter, timerCreated(1, 1000), timerCreated(2, 200), timerClosed(1),
    park("waiting-timer", -1), park("waiting-event", 2000), park("waiting-event", -1),
    workerUnknown(true), workerUnknown(false), finish, signal,
    advance(300), advance(1100), advance(60100), advance(1800001), fire, cancel, stop, restart, missedQueued, staleCallback
  }
  val ProcessRequiresAdmission = s.starts > 0 implies s.present
  val TerminalCannotRun = s.finished implies not(s.active)
  val StoppedCannotWake = s.stopped implies s.wakeAt == 0 and not(s.active)
  val WakeupHasPersistedRun = s.wakeAt > 0 implies s.present
  val TypeOK = s.starts.in(0.to(3)) and s.signals.in(0.to(2)) and s.wakeAt >= 0
    and s.status.in(Set("none", "queued", "running", "waiting-timer", "waiting-event", "waiting-approval", "finished", "cancelled"))
  val safety = ProcessRequiresAdmission and TerminalCannotRun and StoppedCannotWake and WakeupHasPersistedRun and TypeOK
  run timerWakeupTest = init.then(admit(false)).then(enter).then(timerCreated(1, 1000)).then(park("waiting-timer", -1))
    .then(advance(1100)).then(fire).then(enter).expect(s.starts == 2 and safety)
  run earlierTimerReplacesEventTimeoutTest = init.then(admit(false)).then(enter).then(park("waiting-event", 1000))
    .then(signal).then(enter).then(timerCreated(1, 200)).then(park("waiting-timer", -1)).expect(s.wakeAt == 300 and safety)
  run laterTimeoutKeepsEarlierTest = init.then(admit(false)).then(enter).then(park("waiting-event", 1000))
    .then(signal).then(enter).then(park("waiting-event", 2000)).expect(s.wakeAt == 1100 and safety)
  run reopenedTimerIdentityTest = init.then(admit(false)).then(enter).then(timerCreated(1, 1000)).then(timerClosed(1))
    .then(timerCreated(1, 2000)).then(timerCreated(2, 200)).then(park("waiting-timer", -1)).expect(s.wakeAt == 300 and safety)
  run terminalWakeupDoesNotRestartTest = init.then(admit(false)).then(enter).then(park("waiting-event", 1000))
    .then(signal).then(enter).then(finish).then(advance(1100)).then(fire).then(enter).fail()
  run unknownClearsReservationTest = init.then(admit(false)).then(enter).then(park("waiting-event", 1000))
    .then(signal).then(enter).then(workerUnknown(false)).expect(s.wakeAt == 0 and safety)
  run liveWorkerPollTest = init.then(admit(false)).then(enter).then(workerUnknown(true))
    .then(advance(1100)).then(fire).then(enter).expect(s.starts == 2 and safety)
  run stoppedCallbackIsInertTest = init.then(admit(false)).then(enter).then(park("waiting-event", 1000))
    .then(stop).then(advance(1100)).then(staleCallback).expect(s.starts == 1 and safety)
  run cancelledTimerCannotResumeTest = init.then(admit(false)).then(enter).then(park("waiting-event", 1000))
    .then(cancel).then(advance(1100)).then(fire).then(enter).fail()
  run unarmedEventRequiresSignalTest = init.then(admit(false)).then(enter).then(park("waiting-event", -1))
    .then(signal).then(enter).expect(s.wakeAt == 0 and s.starts == 2 and safety)
  run emptyTimerHistoryFallbackTest = init.then(admit(false)).then(enter).then(park("waiting-timer", -1)).expect(s.wakeAt == 60100 and safety)
  run farTimerIsBoundedTest = init.then(admit(false)).then(enter).then(timerCreated(1, 2147483647)).then(park("waiting-timer", -1))
    .expect(s.wakeAt == 2147483647 and safety)
  run lateQueuedTypedNeverStartsTest = init.then(admit(true)).then(advance(1800001)).then(missedQueued).then(enter).fail()
  run previouslyStartedTypedReconcilesTest = init.then(admit(true)).then(enter).then(workerUnknown(false)).then(advance(1800001))
    .then(restart).then(enter).expect(s.starts == 2 and safety)
}
