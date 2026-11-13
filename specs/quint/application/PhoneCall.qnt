/// The development Phone fixture's call session: the module-level live call, the view state
/// that mirrors it, the start of a handed-over call, the call's background timers and the recents
/// rows. The fixture exists only in development builds; nothing here places a call.
module PhoneCall {
  type State = {
    // The module's live call id and the view's copies: the call shown and the call running.
    live: str, want: str, callWho: str,
    // A call handed to the view starts on a later turn: the latch names the call whose start was
    // armed last, and each armed start is a pending timer of the view.
    bootFor: str, bootTimers: List[str],
    active: bool,
    connected: bool, min: bool, kp: bool, hold: bool,
    // The background timers and the call each belongs to ("" is not armed).
    connectFor: str, tickFor: str,
    // The view hang-up returns to.
    ret: str,
    incoming: bool,
    started: int, ended: int, rings: int, ringRows: int, accepted: int, dropped: int,
    // A development jump reset the view while the module still held a live call.
    orphaned: bool
  }
  var s: State

  pure val Callers = Set("ada", "#555")
  /// The person the development jumps ring from and call.
  pure val PresetPerson = "ada"
  pure val MaxCalls = 4
  pure val MaxArmed = 3
  pure def count(flag: bool): int = if (flag) 1 else 0
  pure def armed(v: State, id: str): bool = v.bootTimers.select(entry => entry == id).length() > 0
  /// The view draws after every state change while it is in front. A drawn call that is not the
  /// running one, with no ring showing, arms its start once per latch value.
  pure def shown(v: State): State =
    if (v.active and v.want != "" and v.callWho != v.want and not(v.incoming) and v.bootFor != v.want)
      { ...v, bootFor: v.want, bootTimers: v.bootTimers.append(v.want) }
    else v
  /// Leaving the view cancels its armed starts and restores a running call's minimised screen.
  pure def left(v: State): State =
    { ...v, active: false, bootFor: "", bootTimers: List(), min: v.min and v.callWho == "" }
  /// Ending a call writes its one recents row and clears both copies and the background timers.
  /// A call started from another app's detail returns there when Phone is in front.
  pure def endCall(v: State, quiet: bool): State =
    if (v.live == "") v
    else
      val ended = { ...v, ended: v.ended + 1, live: "", want: "", callWho: "", connected: false, min: false,
        kp: false, hold: false, ret: "", connectFor: "", tickFor: "", orphaned: false }
      if (not(quiet) and v.ret != "" and v.active) left(ended) else ended
  /// Calling the party already on the line returns to that call. Any other call ends the live
  /// one first, does not inherit its return target, and cancels every armed start.
  pure def startCall(v: State, id: str, answered: bool): State =
    if (v.live == id and v.callWho == id) { ...v, min: false }
    else
      val replaced = v.live != ""
      val base = endCall(v, true)
      { ...base, started: v.started + 1, live: id, want: id, callWho: id, connected: answered,
        min: false, kp: false, hold: false, incoming: false, bootFor: "", bootTimers: List(),
        accepted: v.accepted + count(v.incoming and answered),
        dropped: v.dropped + count(v.incoming and not(answered)),
        connectFor: if (answered) "" else id, tickFor: id,
        ret: if (replaced) "" else v.ret }
  /// A development jump leaves the current view and resets Phone's state; the module's live call
  /// and its background timers are not part of that state.
  pure def devReset(v: State): State =
    { ...v, want: "", callWho: "", connected: false, min: false, kp: false, hold: false, ret: "",
      incoming: false, bootFor: "", bootTimers: List(), active: true,
      dropped: v.dropped + count(v.incoming), orphaned: v.live != "" }

  action init = s' = { live: "", want: "", callWho: "", bootFor: "", bootTimers: List(), active: true, connected: false,
    min: false, kp: false, hold: false, connectFor: "", tickFor: "", ret: "", incoming: false,
    started: 0, ended: 0, rings: 0, ringRows: 0, accepted: 0, dropped: 0, orphaned: false }
  /// Typing redraws the view. A dialled entry without a digit names no call.
  action keypadCall(hasDigit: bool): bool = all { s.active, s.started < MaxCalls,
    s' = if (hasDigit) shown(startCall(shown(s), "#555", false)) else shown(s) }
  /// A recents or contact row inside Phone starts its call at once.
  action callFrom(id: str): bool = all { s.active, id.in(Callers), s.started < MaxCalls, s' = shown(startCall(s, id, false)) }
  /// Another app opens Phone with a call to place and, from a contact, where to return. Phone's
  /// state is kept when it is in front or busy with a call or a ring; otherwise it starts fresh.
  action openCall(id: str, ret: str): bool = all { id.in(Callers), ret.in(Set("", "contacts")), s.started < MaxCalls,
    s.bootTimers.length() < MaxArmed,
    val kept = s.active or s.callWho != "" or s.incoming
    s' = shown(if (kept) { ...s, active: true, want: id, ret: if (ret != "") ret else s.ret }
      else { ...s, active: true, want: id, ret: ret, min: false, kp: false, hold: false }) }
  /// The oldest armed start runs: it releases the latch and starts its call only if that call is
  /// still the one drawn and not yet running.
  action bootStart = all { s.bootTimers.length() > 0,
    val target = s.bootTimers.head()
    val fired = { ...s, bootFor: "", bootTimers: s.bootTimers.tail() }
    s' = if (s.want == target and s.callWho != target) shown(startCall(fired, target, false)) else fired }
  action leave = all { s.active, s' = left(s) }
  /// Showing the view again as it was left arms the start of a handed-over call that has not begun.
  action reopen = all { not(s.active), s' = shown({ ...s, active: true }) }
  action connect = all { s.connectFor != "",
    val fired = { ...s, connectFor: "" }
    s' = if (s.callWho == s.connectFor and not(s.connected)) shown({ ...fired, connected: true }) else fired }
  /// The call screen's controls belong to the call drawn, started or not.
  action toggleHold = all { s.active, s.want != "", s' = shown({ ...s, hold: not(s.hold) }) }
  action openKeypad = all { s.active, s.want != "", not(s.min), not(s.kp), s' = shown({ ...s, kp: true }) }
  action back = all { s.active, s.want != "", not(s.min), not(s.incoming),
    s' = shown(if (s.kp) { ...s, kp: false } else { ...s, min: true }) }
  action hangUp = all { s.live != "", s' = shown(endCall(s, false)) }
  action presetIncoming = all { s.rings < MaxCalls,
    s' = { ...devReset(s), incoming: true, rings: s.rings + 1 } }
  action presetCall = all { s.started < MaxCalls, s' = shown({ ...devReset(s), want: PresetPerson }) }
  action accept = all { s.active, s.incoming, s.started < MaxCalls, s' = shown(startCall(s, PresetPerson, true)) }
  /// Declining logs the ring's row and stops the view's background timers; a call handed over
  /// during the ring is armed once the ring is gone.
  action decline = all { s.active, s.incoming,
    s' = shown({ ...s, incoming: false, ringRows: s.ringRows + 1, connectFor: "", tickFor: "" }) }
  action step = {
    nondet id = Callers.oneOf()
    nondet ret = Set("", "contacts").oneOf()
    nondet hasDigit = Set(true, false).oneOf()
    any { keypadCall(hasDigit), callFrom(id), openCall(id, ret), bootStart, leave, reopen, connect, toggleHold,
      openKeypad, back, hangUp, presetIncoming, presetCall, accept, decline, s' = s }
  }

  /// The view never shows a running call the module does not hold.
  val SingleSource = s.live == s.callWho or (s.orphaned and s.callWho == "")
  /// While Phone is in front with no ring showing, a drawn call that is not the running one has
  /// its start armed.
  val NoPhantomCall = s.active and s.want != "" and s.callWho != s.want and not(s.incoming) implies armed(s, s.want)
  /// Armed starts belong to the view in front, and the latch names one of them.
  val BootOwned = (s.bootTimers.length() > 0 implies s.active) and (s.bootFor != "" implies armed(s, s.bootFor))
  val TimersOwned = (s.tickFor != "" implies s.tickFor == s.live) and
    (s.connectFor != "" implies s.connectFor == s.live and not(s.connected))
  val ControlsNeedCall = (s.hold or s.kp or s.min implies s.want != "") and (s.connected implies s.callWho != "")
  val OneRowPerCall = s.started == s.ended + count(s.live != "")
  val RingsAccounted = s.rings == s.ringRows + s.accepted + s.dropped + count(s.incoming)
  val safety = SingleSource and NoPhantomCall and BootOwned and TimersOwned and ControlsNeedCall and
    OneRowPerCall and RingsAccounted

  val OrphanedLiveWitness = s.orphaned and s.live != ""
  /// A ring that another call or a development jump replaced leaves no recents row.
  val DroppedRingWitness = s.dropped > 0
  val MinimisedLiveWitness = s.min and s.connected
  val ReturnedWitness = s.ended == 1 and not(s.active) and s.live == "" and s.started == 1
  /// A call handed over during a ring waits behind it.
  val RingHoldsHandoverWitness = s.incoming and s.want != "" and s.bootTimers.length() == 0
  /// An armed start outlives the call it was armed for.
  val StaleStartWitness = s.bootTimers.length() > 0 and not(armed(s, s.want))
  val HeldBeforeStartWitness = s.hold and s.callWho == ""

  run digitlessDialStartsNothingTest = init.then(keypadCall(false))
    .expect(s.live == "" and s.callWho == "" and s.started == 0 and s.tickFor == "" and safety)
  // Calling the party already on the line keeps the call's clock and writes no row.
  run redialKeepsCallTest = init.then(openCall("ada", "")).then(bootStart).then(connect).then(back)
    .expect(s.min and s.connected)
    .then(callFrom("ada"))
    .expect(not(s.min) and s.connected and s.started == 1 and s.ended == 0 and safety)
  run replacedCallLogsOneRowTest = init.then(openCall("ada", "contacts")).then(bootStart)
    .then(keypadCall(true))
    .expect(s.live == "#555" and s.started == 2 and s.ended == 1 and s.ret == "" and not(s.connected) and safety)
  run hangUpReturnsToCallerTest = init.then(openCall("ada", "contacts")).then(bootStart).then(connect).then(hangUp)
    .expect(s.live == "" and s.ended == 1 and not(s.active) and s.ret == "" and safety)
  run acceptedRingBecomesCallTest = init.then(presetIncoming).then(accept)
    .expect(s.live == PresetPerson and s.connected and s.accepted == 1 and s.connectFor == "" and safety)
    .then(hangUp).expect(s.ended == 1 and s.ringRows == 0 and safety)
  run declineLogsRingTest = init.then(presetIncoming).then(decline)
    .expect(not(s.incoming) and s.ringRows == 1 and s.started == 0 and safety)
  run lateConnectIgnoresEndedCallTest = init.then(keypadCall(true)).then(hangUp).then(connect.fail())
  run developmentJumpOrphansCallTest = init.then(keypadCall(true)).then(presetCall)
    .expect(s.orphaned and s.live == "#555" and s.callWho == "" and safety)
    .then(bootStart).expect(s.live == "ada" and not(s.orphaned) and s.started == 2 and s.ended == 1 and safety)
  run ringHoldsHandoverTest = init.then(presetIncoming).then(openCall("#555", ""))
    .expect(s.incoming and s.want == "#555" and s.bootTimers.length() == 0 and safety)
    .then(decline).expect(s.bootTimers == List("#555") and s.ringRows == 1 and safety)
    .then(bootStart).expect(s.live == "#555" and s.started == 1 and safety)
  run staleStartIsDroppedTest = init.then(openCall("ada", "")).then(openCall("#555", ""))
    .expect(s.bootTimers == List("ada", "#555"))
    .then(bootStart).expect(s.live == "" and s.bootFor == "" and safety)
    .then(bootStart).expect(s.live == "#555" and s.started == 1 and safety)
  // A call started while another start is armed releases the latch: the same party can be handed over again.
  run startReleasesLatchTest = init.then(openCall("ada", "")).then(callFrom("#555"))
    .expect(s.bootTimers.length() == 0 and s.bootFor == "" and s.live == "#555")
    .then(openCall("ada", "")).expect(s.bootTimers == List("ada") and safety)
    .then(bootStart).expect(s.live == "ada" and s.started == 2 and s.ended == 1 and safety)
  run freshOpenDropsReturnTest = init.then(openCall("ada", "contacts")).then(leave)
    .expect(s.ret == "contacts" and s.want == "ada" and not(s.active))
    .then(openCall("#555", "")).expect(s.ret == "" and s.want == "#555" and s.bootTimers == List("#555") and safety)
}
