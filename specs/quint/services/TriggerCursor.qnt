/// The development trigger runtime: a scan latch, a dispatch latch, and per-workflow cursors.
/// One workflow watches a place for "I leave home"; another watches incoming messages.
module TriggerCursor {
  type Runtime = {
    foreground: bool, blocked: bool, held: bool, faulted: bool,
    actual: str, pos: str, placeVersion: int,
    cursor: bool, cursorInside: str, cursorPlace: int,
    lastKnown: str, observedLeaves: int, fired: int,
    queue: int, brokenB: bool, reportB: bool, cursorB: bool,
    liveB: Set[int], seenB: Set[int], firedB: int, moves: int
  }
  var s: Runtime
  action init = s' = {
    foreground: true, blocked: false, held: false, faulted: false,
    actual: "in", pos: "unknown", placeVersion: 1,
    cursor: false, cursorInside: "none", cursorPlace: 0,
    lastKnown: "none", observedLeaves: 0, fired: 0,
    queue: 0, brokenB: false, reportB: false, cursorB: false,
    liveB: Set(), seenB: Set(), firedB: 0, moves: 0 }
  val Known = s.pos.in(Set("in", "out"))
  /// A place has a key only while the position is fresh.
  val PlaceKey = if (s.pos == "unknown") 0 else s.placeVersion
  /// The cursor starts over only when the stored and the current place are both known and differ.
  val PlaceChanged = s.cursorPlace != 0 and PlaceKey != 0 and s.cursorPlace != PlaceKey
  val LeaveDetected = s.cursor and not(PlaceChanged) and Known and s.cursorInside == "in" and s.pos == "out"
  val FreshB = if (s.brokenB or not(s.cursorB)) Set() else s.liveB.exclude(s.seenB)
  val Found = (if (LeaveDetected) 1 else 0) + FreshB.size()
  action move = all {
    s.moves < 3,
    s' = { ...s, actual: if (s.actual == "in") "out" else "in", moves: s.moves + 1 }
  }
  /// A fix reports the side of the place, or neither when accuracy straddles its edge.
  action fix(clear: bool): bool = all {
    s.foreground,
    s' = { ...s, pos: if (clear) s.actual else "edge" }
  }
  action loseFix = s' = { ...s, pos: "unknown" }
  action editPlace = all { s.placeVersion == 1, s' = { ...s, placeVersion: 2 } }
  /// In the background the position is dropped and nothing is checked.
  action background = s' = { ...s, foreground: false, pos: "unknown" }
  action resume = all { not(s.foreground), s' = { ...s, foreground: true, blocked: false, held: false, faulted: false } }
  action wake = all { s.foreground, s' = { ...s, blocked: false, held: false, faulted: false } }
  action arrive(m: int): bool = all {
    not(s.liveB.contains(m)), s.liveB.size() < 2,
    s' = { ...s, liveB: s.liveB.union(Set(m)) }
  }
  action remove(m: int): bool = all { s.liveB.contains(m), s' = { ...s, liveB: s.liveB.exclude(Set(m)) } }
  /// The message workflow's source cannot be read (a message without an identity). The workflow
  /// itself is unchanged: an edited trigger is another definition and starts its cursor over.
  action breakB = all { not(s.brokenB), s' = { ...s, brokenB: true } }
  action repairB = all { s.brokenB, s' = { ...s, brokenB: false, reportB: false } }
  /// One check of every enabled workflow. A workflow that cannot be checked is reported and
  /// keeps its cursor while the others are still checked. A failure of the check as a whole
  /// (here a full queue) saves nothing and stops further checks until a wake event.
  action scan = all {
    s.foreground, not(s.blocked),
    if (s.queue + Found > 3) s' = { ...s, blocked: true, faulted: true }
    else s' = { ...s, queue: s.queue + Found,
      cursor: true,
      cursorPlace: if (PlaceKey != 0) PlaceKey else if (not(s.cursor)) 0 else s.cursorPlace,
      cursorInside: if (not(s.cursor) or PlaceChanged) (if (Known) s.pos else "none")
        else if (Known) s.pos else s.cursorInside,
      fired: if (LeaveDetected) s.fired + 1 else s.fired,
      lastKnown: if (not(s.cursor) or PlaceChanged) (if (Known) s.pos else "none")
        else if (Known) s.pos else s.lastKnown,
      observedLeaves: if (s.cursor and not(PlaceChanged) and s.lastKnown == "in" and s.pos == "out")
        s.observedLeaves + 1 else s.observedLeaves,
      reportB: s.brokenB, cursorB: s.cursorB or not(s.brokenB),
      seenB: if (s.brokenB) s.seenB else s.liveB,
      firedB: s.firedB + FreshB.size() }
  }
  /// Queued work is dispatched whether or not checks are stopped. A job that stays queued
  /// after its dispatch holds further dispatch until a wake event.
  action dispatch(done: bool): bool = all {
    s.foreground, not(s.held), s.queue > 0,
    if (done) s' = { ...s, queue: s.queue - 1, blocked: false, faulted: false }
    else s' = { ...s, held: true }
  }
  action step = any {
    move, fix(true), fix(false), loseFix, editPlace, background, resume, wake,
    arrive(1), arrive(2), arrive(3), remove(1), remove(2), remove(3), breakB, repairB,
    scan, dispatch(true), dispatch(false), s' = s
  }
  /// Only a failure of the whole check stops checking. One workflow's error never does.
  val LatchNeedsRuntimeFault = s.blocked implies s.faulted
  /// Each change from inside to outside seen by two checks yields exactly one occurrence,
  /// whatever happened to the position in between.
  val LeaveFiredOncePerObservation = s.fired == s.observedLeaves
  val CursorKeepsLastKnownSide = s.cursor implies s.cursorInside == s.lastKnown
  val SeenBounded = s.seenB.size() <= 2
  val QueueBounded = s.queue.in(0.to(3)) and s.queue <= s.fired + s.firedB
  val ReportMeansBroken = s.reportB implies s.brokenB
  val TypeOK = s.pos.in(Set("unknown", "in", "out", "edge")) and s.actual.in(Set("in", "out"))
    and s.cursorInside.in(Set("none", "in", "out")) and s.placeVersion.in(Set(1, 2)) and s.moves.in(0.to(3))
  val safety = TypeOK and LatchNeedsRuntimeFault and LeaveFiredOncePerObservation
    and CursorKeepsLastKnownSide and SeenBounded and QueueBounded and ReportMeansBroken
  val GapKeepsSideWitness = s.cursorInside == "in" and s.pos == "unknown" and s.actual == "out" and s.foreground
  val BlockedWithQueueWitness = s.blocked and s.queue == 3 and not(s.held)
  val BrokenFlowBesideFiringWitness = s.reportB and s.fired > 0
  val HeldDispatchWitness = s.held and s.queue > 0 and not(s.blocked)
  val EdgeFixWitness = s.pos == "edge" and s.cursorInside == "in" and s.actual == "out"
  /// The phone is locked at home and unlocked after leaving. The first check after unlocking
  /// has no position; the leave still fires once a fix arrives.
  run leaveAcrossBackgroundTest = init.then(fix(true)).then(scan).expect(s.cursorInside == "in")
    .then(background).then(move).then(resume).then(scan)
    .expect(s.cursorInside == "in" and s.fired == 0 and safety)
    .then(fix(true)).then(scan).expect(s.fired == 1 and s.queue == 1 and s.cursorInside == "out" and safety)
    .then(scan).expect(s.fired == 1 and safety)
  /// A workflow whose source cannot be read is reported. The place workflow still fires.
  run brokenFlowDoesNotStopOthersTest = init.then(breakB).then(fix(true)).then(scan)
    .expect(s.reportB and not(s.blocked) and safety)
    .then(move).then(fix(true)).then(scan).expect(s.fired == 1 and not(s.blocked) and safety)
    .then(repairB).then(arrive(1)).then(scan).then(arrive(2)).then(scan).expect(s.firedB == 1 and safety)
  run fullQueueStillDispatchesTest = init.then(scan).then(arrive(1)).then(arrive(2)).then(scan)
    .then(remove(1)).then(remove(2)).then(arrive(3)).then(scan).expect(s.queue == 3 and s.seenB == Set(3))
    .then(arrive(1)).then(scan).expect(s.blocked and s.queue == 3 and s.seenB == Set(3) and safety)
    .then(dispatch(true)).expect(not(s.blocked) and s.queue == 2 and safety)
    .then(scan).expect(s.queue == 3 and s.seenB == Set(1, 3) and safety)
  run heldDispatchWaitsForWakeTest = init.then(scan).then(arrive(1)).then(scan).then(dispatch(false))
    .expect(s.held and s.queue == 1 and safety)
    .then(wake).then(dispatch(true)).expect(s.queue == 0 and safety)
  run movedPlaceRestartsCursorTest = init.then(fix(true)).then(scan).then(editPlace).then(move)
    .then(fix(true)).then(scan)
    .expect(s.fired == 0 and s.cursorPlace == 2 and s.cursorInside == "out" and safety)
}
