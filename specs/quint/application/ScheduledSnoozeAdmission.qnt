// Alpha computes one explicit snooze instant before the exact protocol call.
module ScheduledSnoozeAdmission {
  type State = {clock: int, next: int, saved: int, differentDay: bool,
    scheduled: bool, snoozed: bool, until: int, phase: str, requests: int,
    sentUntil: int, sentClock: int, cancelled: bool}
  var s: State

  action init = s' = {clock: 0, next: -1, saved: -1, differentDay: false,
    scheduled: false, snoozed: false, until: -1, phase: "idle", requests: 0,
    sentUntil: -1, sentClock: -1, cancelled: false}

  action prepare(nextAt: int, saved: int, differentDay: bool, scheduled: bool, snoozed: bool): bool = all {
    s.phase == "idle",
    s' = {...s, next: nextAt, saved: saved, differentDay: differentDay,
      scheduled: scheduled, snoozed: snoozed, phase: "ready"},
  }
  action calculate = all {
    s.phase == "ready",
    val preserve = s.snoozed and s.saved > s.clock and
      (s.next == -1 or s.saved >= s.next or s.differentDay)
    val base = if (preserve) s.saved else if (s.scheduled and s.next != -1) s.next else s.clock
    s' = {...s, until: base + 10, phase: "calculated"},
  }
  action advance(minutes: int): bool = all {
    minutes >= 0, s' = {...s, clock: s.clock + minutes},
  }
  action send(validId: bool): bool = all {
    s.phase == "calculated",
    val admitted = validId and s.until > s.clock
    s' = if (admitted) {...s, requests: s.requests + 1, sentUntil: s.until, sentClock: s.clock, phase: "pending"}
      else {...s, phase: "refused"},
  }
  action cancel = all {s.phase == "pending", s' = {...s, cancelled: true}}
  action settle(result: str): bool = all {
    s.phase == "pending", result.in(Set("exact", "wrong-id", "wrong-status", "wrong-time", "missing", "transport")),
    s' = {...s, phase: if (result == "exact" and not(s.cancelled)) "confirmed" else "unconfirmed"},
  }
  action step = any {
    {nondet nextAt = Set(-1, 0, 30, 60, 420, 1440).oneOf()
      nondet saved = Set(-1, 20, 70, 120, 1500).oneOf()
      nondet different = Bool.oneOf()
      nondet scheduled = Bool.oneOf()
      nondet snoozed = Bool.oneOf()
      prepare(nextAt, saved, different, scheduled, snoozed)},
    calculate, send(true), send(false), cancel,
    {nondet minutes = Set(0, 10, 60, 1500).oneOf(); advance(minutes)},
    {nondet result = Set("exact", "wrong-id", "wrong-status", "wrong-time", "missing", "transport").oneOf(); settle(result)},
    s' = s,
  }

  val ExactRequest = s.requests == 0 or (s.requests == 1 and s.sentUntil == s.until)
  val ConfirmationRequiresRequest = s.phase == "confirmed" implies s.requests == 1
  val FutureAtDispatch = s.requests == 0 or s.sentUntil > s.sentClock
  val safety = ExactRequest and ConfirmationRequiresRequest and FutureAtDispatch

  run recurrenceDeferralTest = init.then(prepare(420, -1, false, true, false)).then(calculate)
    .expect(s.until == 430).then(send(true)).then(settle("exact")).expect(s.phase == "confirmed" and safety)
  run validDeferralContinuesTest = init.then(prepare(1435, 5, true, true, true)).then(calculate)
    .expect(s.until == 15 and safety)
  run earlyDeferralRepairsTest = init.then(prepare(420, 54, false, true, true)).then(calculate)
    .expect(s.until == 430 and safety)
  run expiredReviewRefusesTest = init.then(prepare(-1, -1, false, false, false)).then(calculate)
    .then(advance(10)).then(send(true)).expect(s.requests == 0 and s.phase == "refused" and safety)
  run mismatchedReceiptRefusesTest = init.then(prepare(-1, -1, false, false, false)).then(calculate)
    .then(send(true)).then(settle("wrong-time")).expect(s.phase == "unconfirmed" and safety)
}
