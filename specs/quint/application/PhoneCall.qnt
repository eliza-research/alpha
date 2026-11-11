/// The development Phone fixture's call session: the module-level live call, the view state
/// that mirrors it, the call's background timers and the recents rows. The fixture exists only
/// in development builds; nothing here places a call.
module PhoneCall {
  type State = {
    // The module's live call id and the view's copies: the call shown and the call running.
    live: str, want: str, callWho: str,
    // A call handed to the view by another app starts on the view's next turn.
    boot: bool, active: bool,
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
  pure val MaxCalls = 4
  pure def count(flag: bool): int = if (flag) 1 else 0
  /// Ending a call writes its one recents row and clears both copies and the timers.
  pure def endCall(v: State, quiet: bool): State =
    if (v.live == "") v
    else { ...v, ended: v.ended + 1, live: "", want: "", callWho: "", connected: false, min: false,
      kp: false, hold: false, ret: "", connectFor: "", tickFor: "", orphaned: false,
      active: v.active and (quiet or v.ret == "") }
  /// Calling the party already on the line returns to that call. Any other call ends the live
  /// one first and does not inherit its return target.
  pure def startCall(v: State, id: str, answered: bool): State =
    if (v.live == id and v.callWho == id) { ...v, min: false }
    else
      val replaced = v.live != ""
      val base = endCall(v, true)
      { ...base, started: v.started + 1, live: id, want: id, callWho: id, connected: answered,
        min: false, kp: false, hold: false, incoming: false,
        accepted: v.accepted + count(v.incoming and answered),
        dropped: v.dropped + count(v.incoming and not(answered)),
        connectFor: if (answered) "" else id, tickFor: id,
        ret: if (replaced) "" else v.ret }
  pure def devReset(v: State): State =
    { ...v, want: "", callWho: "", connected: false, min: false, kp: false, hold: false, ret: "",
      incoming: false, boot: false, dropped: v.dropped + count(v.incoming), orphaned: v.live != "" }

  action init = s' = { live: "", want: "", callWho: "", boot: false, active: true, connected: false,
    min: false, kp: false, hold: false, connectFor: "", tickFor: "", ret: "", incoming: false,
    started: 0, ended: 0, rings: 0, ringRows: 0, accepted: 0, dropped: 0, orphaned: false }
  /// A dialled entry without a digit names no call.
  action keypadCall(hasDigit: bool): bool = all { s.active, s.started < MaxCalls,
    s' = if (hasDigit) startCall(s, "#555", false) else s }
  /// A recents or contact row inside Phone starts its call at once.
  action callFrom(id: str): bool = all { s.active, id.in(Callers), s.started < MaxCalls, s' = startCall(s, id, false) }
  /// Another app opens Phone with a call to place and, from a contact, where to return.
  action openCall(id: str, ret: str): bool = all { id.in(Callers), ret.in(Set("", "contacts")), s.started < MaxCalls,
    s' = { ...s, active: true, want: id, ret: if (ret != "") ret else s.ret, boot: true } }
  action bootStart = all { s.boot,
    s' = if (s.want != "" and s.callWho != s.want) { ...startCall(s, s.want, false), boot: false }
      else { ...s, boot: false } }
  action leave = all { s.active, s' = { ...s, active: false, boot: false, min: false } }
  /// Showing the view again arms the start of a handed-over call that has not begun.
  action reopen = all { not(s.active),
    s' = { ...s, active: true, boot: s.want != "" and s.callWho != s.want and not(s.incoming) } }
  action connect = all { s.connectFor != "",
    s' = { ...s, connectFor: "", connected: s.connected or s.callWho == s.connectFor } }
  action toggleHold = all { s.callWho != "", s' = { ...s, hold: not(s.hold) } }
  action openKeypad = all { s.callWho != "", s.active, not(s.min), s' = { ...s, kp: true } }
  action back = all { s.active, s.callWho != "", not(s.min),
    s' = if (s.kp) { ...s, kp: false } else { ...s, min: true } }
  action hangUp = all { s.live != "", s' = endCall(s, false) }
  action presetIncoming = all { s.rings < MaxCalls,
    s' = { ...devReset(s), incoming: true, rings: s.rings + 1, active: true } }
  action presetCall = all { s.started < MaxCalls,
    s' = { ...devReset(s), want: "ada", boot: true, active: true } }
  action accept = all { s.incoming, s.started < MaxCalls, s' = startCall(s, "bea", true) }
  /// Declining or screening logs the ring's row and stops the view's background timers.
  action decline = all { s.incoming,
    s' = { ...s, incoming: false, ringRows: s.ringRows + 1, connectFor: "", tickFor: "" } }
  action step = {
    nondet id = Callers.oneOf()
    nondet ret = Set("", "contacts").oneOf()
    nondet hasDigit = Set(true, false).oneOf()
    any { keypadCall(hasDigit), callFrom(id), openCall(id, ret), bootStart, leave, reopen, connect, toggleHold,
      openKeypad, back, hangUp, presetIncoming, presetCall, accept, decline, s' = s }
  }

  /// The view never shows a running call the module does not hold.
  val SingleSource = s.live == s.callWho or (s.orphaned and s.callWho == "")
  /// While Phone is showing, every running call has its call screen once a handed-over call
  /// has started.
  val NoPhantomCall = s.active and s.callWho != "" and not(s.boot) implies s.want == s.callWho
  val TimersOwned = (s.tickFor != "" implies s.tickFor == s.live) and
    (s.connectFor != "" implies s.connectFor == s.live and not(s.connected))
  val ControlsNeedCall = s.hold or s.kp or s.min or s.connected implies s.callWho != ""
  val OneRowPerCall = s.started == s.ended + count(s.live != "")
  val RingsAccounted = s.rings == s.ringRows + s.accepted + s.dropped + count(s.incoming)
  val safety = SingleSource and NoPhantomCall and TimersOwned and ControlsNeedCall and OneRowPerCall and RingsAccounted

  val OrphanedLiveWitness = s.orphaned and s.live != ""
  /// A ring that another call or a development jump replaced leaves no recents row.
  val DroppedRingWitness = s.dropped > 0
  val MinimisedLiveWitness = s.min and s.connected
  val ReturnedWitness = s.ended == 1 and not(s.active) and s.live == "" and s.started == 1

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
    .expect(s.live == "bea" and s.connected and s.accepted == 1 and s.connectFor == "" and safety)
    .then(hangUp).expect(s.ended == 1 and s.ringRows == 0 and safety)
  run declineLogsRingTest = init.then(presetIncoming).then(decline)
    .expect(not(s.incoming) and s.ringRows == 1 and s.started == 0 and safety)
  run lateConnectIgnoresEndedCallTest = init.then(keypadCall(true)).then(hangUp).then(connect.fail())
  run developmentJumpOrphansCallTest = init.then(keypadCall(true)).then(presetCall)
    .expect(s.orphaned and s.live == "#555" and s.callWho == "" and safety)
    .then(bootStart).expect(s.live == "ada" and not(s.orphaned) and s.started == 2 and s.ended == 1 and safety)
}
