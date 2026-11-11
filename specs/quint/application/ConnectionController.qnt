/// The connection controller's single step slot and what waits behind it: a native sign-in
/// return, a sign-in-incomplete notice and a rebind of the running agent.
module ConnectionController {
  type State = {
    // The step holding the slot: none, step (any owner or background step), key-manager (a
    // provider key reveal, edit or removal), return (a native sign-in return) or rebind.
    operation: str, startupResolved: bool,
    rebindWanted: bool, rebinds: int,
    queuedReturn: bool, returnsArrived: int, returnsHandled: int, returnsReplaced: int,
    // The queued notice: none, plain or restarted. A notice queued after startup is bound to the
    // connection and sign-in view it arrived under.
    incomplete: str, incompleteFenced: bool, viewChanged: bool,
    noticesArrived: int, notices: int, noticesDropped: int, noticesReplaced: int
  }
  var s: State
  action init = s' = {
    operation: "none", startupResolved: false, rebindWanted: false, rebinds: 0,
    queuedReturn: false, returnsArrived: 0, returnsHandled: 0, returnsReplaced: 0,
    incomplete: "none", incompleteFenced: false, viewChanged: false,
    noticesArrived: 0, notices: 0, noticesDropped: 0, noticesReplaced: 0
  }
  /// The queued return runs first and takes the slot. A queued notice needs a free slot and a
  /// settled startup, and is shown only for the connection and view it arrived under.
  pure def signInDrained(v: State): State = {
    val returned = if (v.queuedReturn and v.operation == "none")
      { ...v, queuedReturn: false, operation: "return", returnsHandled: v.returnsHandled + 1 } else v
    if (returned.incomplete != "none" and returned.operation == "none" and returned.startupResolved)
      { ...returned, incomplete: "none", incompleteFenced: false, viewChanged: false,
        notices: if (returned.incompleteFenced and returned.viewChanged) returned.notices else returned.notices + 1,
        noticesDropped: if (returned.incompleteFenced and returned.viewChanged) returned.noticesDropped + 1 else returned.noticesDropped }
    else returned
  }
  /// A rebind takes the slot and retires the connection, so a notice bound to the connection it
  /// arrived under is no longer current.
  pure def rebinding(v: State): State =
    { ...v, rebindWanted: false, operation: "rebind", rebinds: v.rebinds + 1, viewChanged: v.viewChanged or v.incompleteFenced }
  /// A step that ends frees the slot, then runs a wanted rebind, then the sign-in queue. When the
  /// step that ends is itself a rebind, the rebind queue still counts it as running at the release,
  /// so the sign-in queue goes first and the wanted rebind takes the slot only if it is still free;
  /// otherwise it waits for the next release.
  pure def drained(v: State): State = {
    val freed = { ...v, operation: "none" }
    if (v.operation == "rebind") {
      val signed = signInDrained(freed)
      if (signed.rebindWanted and signed.operation == "none") rebinding(signed) else signed
    } else signInDrained(if (freed.rebindWanted) rebinding(freed) else freed)
  }
  action startupSettles = all { not(s.startupResolved), s' = signInDrained({ ...s, startupResolved: true }) }
  action stepStarts = all { s.operation == "none", s' = { ...s, operation: "step" } }
  action stepEnds = all { s.operation.in(Set("step", "return", "rebind")), s' = drained(s) }
  action keyManagerStarts = all { s.operation == "none", s' = { ...s, operation: "key-manager" } }
  /// A key-manager request that ends, completed or failed, releases the slot as any step does:
  /// a wanted rebind runs, then the sign-in queue.
  action keyManagerEnds = all { s.operation == "key-manager", s' = drained(s) }
  /// A native sign-in return is handled now or kept in the single slot behind the step in flight.
  action nativeReturn = all {
    s.returnsArrived < 3,
    s' = if (s.operation != "none")
        { ...s, returnsArrived: s.returnsArrived + 1, queuedReturn: true,
          returnsReplaced: if (s.queuedReturn) s.returnsReplaced + 1 else s.returnsReplaced }
      else { ...s, returnsArrived: s.returnsArrived + 1, operation: "return", returnsHandled: s.returnsHandled + 1 }
  }
  /// A return without a sign-in result. During a step or before startup settles it waits; one
  /// that arrived before startup settled says Alpha restarted.
  action incompleteArrives = all {
    s.noticesArrived < 3,
    s' = if (s.operation != "none" or not(s.startupResolved))
        { ...s, noticesArrived: s.noticesArrived + 1,
          incomplete: if (s.incomplete == "restarted" or not(s.startupResolved)) "restarted" else "plain",
          incompleteFenced: s.startupResolved, viewChanged: false,
          noticesReplaced: if (s.incomplete != "none") s.noticesReplaced + 1 else s.noticesReplaced }
      else { ...s, noticesArrived: s.noticesArrived + 1, notices: s.notices + 1 }
  }
  /// The connection is replaced or the sign-in view changes while a notice waits.
  action viewChanges = all { s.incomplete != "none", not(s.viewChanged), s' = { ...s, viewChanged: true } }
  action rebindRequested = all {
    s.rebinds < 3, not(s.rebindWanted),
    s' = if (s.operation == "none") rebinding(s) else { ...s, rebindWanted: true }
  }
  action step = any {
    startupSettles, stepStarts, stepEnds, keyManagerStarts, keyManagerEnds, nativeReturn,
    incompleteArrives, viewChanges, rebindRequested, s' = s
  }
  /// Every return is handled once, replaced by a later one in the slot, or still waiting.
  val ReturnsConserved = s.returnsArrived == s.returnsHandled + s.returnsReplaced + (if (s.queuedReturn) 1 else 0)
  val NoticesConserved = s.noticesArrived == s.notices + s.noticesDropped + s.noticesReplaced + (if (s.incomplete != "none") 1 else 0)
  /// Work waits only behind a step holding the slot (a notice also behind unsettled startup);
  /// no release, the key manager's included, leaves it waiting with the slot free.
  val QueuedReturnBehindWork = s.queuedReturn implies s.operation != "none"
  val QueuedNoticeHasReason = s.incomplete != "none" implies s.operation != "none" or not(s.startupResolved)
  val WantedRebindBehindWork = s.rebindWanted implies s.operation != "none"
  val FenceNeedsNotice = (s.incompleteFenced or s.viewChanged) implies s.incomplete != "none"
  val TypeOK = s.operation.in(Set("none", "step", "key-manager", "return", "rebind"))
    and s.incomplete.in(Set("none", "plain", "restarted")) and s.rebinds.in(0.to(3))
    and s.returnsArrived.in(0.to(3)) and s.noticesArrived.in(0.to(3))
  val safety = TypeOK and ReturnsConserved and NoticesConserved and QueuedReturnBehindWork and
    QueuedNoticeHasReason and WantedRebindBehindWork and FenceNeedsNotice

  val ReturnBehindKeyManagerWitness = s.queuedReturn and s.operation == "key-manager"
  val RebindBehindKeyManagerWitness = s.rebindWanted and s.operation == "key-manager"
  val ReplacedReturnWitness = s.returnsReplaced > 0
  val StaleNoticeDroppedWitness = s.noticesDropped > 0
  val RebindBeforeReturnWitness = s.operation == "rebind" and s.queuedReturn
  val RestartedNoticeWitness = s.incomplete == "restarted" and s.startupResolved
  val ReturnBeforeWantedRebindWitness = s.operation == "return" and s.rebindWanted and s.rebinds > 0

  run returnQueuedBehindStepTest = init.then(startupSettles).then(stepStarts).then(nativeReturn)
    .expect(s.queuedReturn and s.returnsHandled == 0 and safety)
    .then(stepEnds).expect(s.operation == "return" and not(s.queuedReturn) and s.returnsHandled == 1 and safety)
    .then(stepEnds).expect(s.operation == "none" and safety)
  /// A wanted rebind takes the freed slot first; the queued return follows it.
  run rebindRunsBeforeQueuedReturnTest = init.then(startupSettles).then(stepStarts).then(rebindRequested)
    .then(nativeReturn).then(stepEnds).expect(RebindBeforeReturnWitness and s.returnsHandled == 0 and safety)
    .then(stepEnds).expect(s.operation == "return" and s.returnsHandled == 1 and safety)
  /// A return that arrives during a key-manager request waits for it and is handled, exactly
  /// once, as that request ends; it never waits with the slot free.
  run keyManagerReleaseRunsQueuedReturnTest = init.then(startupSettles).then(keyManagerStarts).then(nativeReturn)
    .expect(ReturnBehindKeyManagerWitness and s.returnsHandled == 0 and safety)
    .then(keyManagerEnds)
    .expect(s.operation == "return" and s.returnsHandled == 1 and not(s.queuedReturn) and safety)
    .then(stepEnds).expect(s.operation == "none" and s.returnsHandled == 1 and safety)
  /// A rebind and a notice that arrive during a key-manager request are serviced when it ends: the
  /// rebind takes the slot and retires the connection the notice arrived under, so the notice is
  /// dropped when the rebind ends.
  run keyManagerReleaseRunsRebindAndNoticeTest = init.then(startupSettles).then(keyManagerStarts)
    .then(rebindRequested).then(incompleteArrives)
    .expect(RebindBehindKeyManagerWitness and s.incomplete == "plain" and safety)
    .then(keyManagerEnds).expect(s.operation == "rebind" and not(s.rebindWanted) and s.rebinds == 1 and s.notices == 0 and safety)
    .then(stepEnds).expect(s.operation == "none" and s.notices == 0 and s.noticesDropped == 1 and s.incomplete == "none" and safety)
  /// A notice that arrives while the rebind already runs belongs to the rebound connection and is shown.
  run noticeDuringRebindShownTest = init.then(startupSettles).then(rebindRequested).then(incompleteArrives)
    .expect(s.operation == "rebind" and s.incompleteFenced and not(s.viewChanged) and safety)
    .then(stepEnds).expect(s.notices == 1 and s.noticesDropped == 0 and safety)
  /// A rebind wanted while a rebind runs yields to a queued return when that rebind ends, and runs
  /// when the return's step ends.
  run rebindBehindRebindYieldsToReturnTest = init.then(startupSettles).then(rebindRequested).then(rebindRequested)
    .then(nativeReturn).expect(s.operation == "rebind" and s.rebindWanted and s.queuedReturn and safety)
    .then(stepEnds).expect(s.operation == "return" and s.rebindWanted and s.rebinds == 1 and s.returnsHandled == 1 and safety)
    .then(stepEnds).expect(s.operation == "rebind" and not(s.rebindWanted) and s.rebinds == 2 and safety)
  run rebindBehindRebindRunsNextTest = init.then(startupSettles).then(rebindRequested).then(rebindRequested)
    .then(stepEnds).expect(s.operation == "rebind" and not(s.rebindWanted) and s.rebinds == 2 and safety)
  run secondReturnReplacesQueuedTest = init.then(startupSettles).then(stepStarts).then(nativeReturn).then(nativeReturn)
    .expect(ReplacedReturnWitness and s.queuedReturn and safety)
    .then(stepEnds).then(stepEnds).expect(s.returnsHandled == 1 and s.operation == "none" and safety)
  /// A notice retained across a restart waits for startup and then says the restart is why.
  run noticeBeforeStartupTest = init.then(incompleteArrives)
    .expect(s.incomplete == "restarted" and not(s.incompleteFenced) and s.notices == 0 and safety)
    .then(startupSettles).expect(s.notices == 1 and s.incomplete == "none" and safety)
  /// A notice queued behind a step is dropped when the connection or sign-in view changed meanwhile.
  run staleNoticeDroppedTest = init.then(startupSettles).then(stepStarts).then(incompleteArrives)
    .expect(s.incomplete == "plain" and s.incompleteFenced).then(viewChanges).then(stepEnds)
    .expect(StaleNoticeDroppedWitness and s.notices == 0 and safety)
  run queuedReturnRunsBeforeNoticeTest = init.then(startupSettles).then(stepStarts).then(nativeReturn)
    .then(incompleteArrives).then(stepEnds)
    .expect(s.operation == "return" and s.incomplete == "plain" and s.notices == 0 and safety)
    .then(stepEnds).expect(s.notices == 1 and s.operation == "none" and safety)
}
