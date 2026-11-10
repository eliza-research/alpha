/// Recoverable first-run Home request and keyboard defaults; explicit appearance action.
module OSProvisioning {
  type State = { eligible: bool, alive: bool, phase: str, generation: int,
    held: bool, keyboard: str, complete: bool, completionAuthorized: bool,
    appearanceRequested: bool, appearanceChanged: bool }
  var s: State
  action init = s' = { eligible: true, alive: true, phase: "idle", generation: 0,
    held: false, keyboard: "none", complete: false, completionAuthorized: false,
    appearanceRequested: false, appearanceChanged: false }
  action begin = all { s.alive, s.eligible, s.phase == "idle", s.generation < 3,
    s' = { ...s, phase: "waiting", generation: s.generation + 1 } }
  action callback(generation: int, accepted: bool, held: bool): bool =
    s' = if (s.alive and s.phase == "waiting" and generation == s.generation)
      { ...s, phase: if (s.eligible and accepted and held) "presets" else "idle", held: held }
      else s
  action timeout = s' = if (s.phase == "waiting") { ...s, phase: "idle" } else s
  action authorityLost = s' = { ...s, eligible: false }
  action destroy = s' = { ...s, alive: false, phase: "idle" }
  action ownerKeyboard = s' = { ...s, keyboard: "owner" }
  action keyboardDefault(ok: bool): bool = s' = if (s.alive and s.eligible and s.phase == "presets" and ok)
    { ...s, keyboard: if (s.keyboard == "none") "latin" else s.keyboard } else s
  action finish = s' = if (s.alive and s.eligible and s.phase == "presets" and s.held and s.keyboard != "none")
    { ...s, complete: true, phase: "done", completionAuthorized: true } else s
  action requestAppearance = s' = { ...s, appearanceRequested: true }
  action applyAppearance(ok: bool): bool = s' = if (s.alive and s.appearanceRequested and ok)
    { ...s, appearanceChanged: true } else s
  action step = any { begin, callback(1,true,true), callback(1,false,true), callback(2,true,true),
    callback(3,true,true), timeout, authorityLost, destroy, ownerKeyboard,
    keyboardDefault(true), keyboardDefault(false), finish, requestAppearance, applyAppearance(true), applyAppearance(false) }
  val safety = s.generation >= 0 and s.generation <= 3
    and s.phase.in(Set("idle", "waiting", "presets", "done"))
    and (not(s.complete) or (s.completionAuthorized and s.held and s.keyboard != "none"))
    and (not(s.appearanceChanged) or s.appearanceRequested)
  run expiredCallbackCannotCompleteTest = init.then(begin).then(timeout).then(callback(1,true,true))
    .then(keyboardDefault(true)).then(finish).expect(not(s.complete) and safety)
  run previousAttemptCannotCompleteTest = init.then(begin).then(timeout).then(begin)
    .then(callback(1,true,true)).expect(s.phase == "waiting" and not(s.complete) and safety)
  run existingKeyboardPreservedTest = init.then(ownerKeyboard).then(begin).then(callback(1,true,true))
    .then(keyboardDefault(true)).then(finish).expect(s.complete and s.keyboard == "owner" and safety)
  run missingKeyboardCannotCompleteTest = init.then(begin).then(callback(1,true,true))
    .then(keyboardDefault(false)).then(finish).expect(not(s.complete) and safety)
  run authorityLossCannotCompleteTest = init.then(begin).then(callback(1,true,true)).then(authorityLost)
    .then(keyboardDefault(true)).then(finish).expect(not(s.complete) and safety)
  run appearanceNeedsUserActionTest = init.then(applyAppearance(true)).expect(not(s.appearanceChanged))
    .then(requestAppearance).then(applyAppearance(true)).expect(s.appearanceChanged and safety)
}
