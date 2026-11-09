/// Six independent native permissions and the signed-in, durable walkthrough UI.
/// Platform status is authority. A saved walkthrough marker never grants permission.
module PermissionWalkthrough {
  pure val Keys = 0.to(5)
  type State = { signedIn: bool, phase: str, states: int -> str,
    attempted: Set[int], requests: int -> int, progress: int, savedProgress: int,
    completed: bool, legacyCompleted: bool, pending: int, generation: int,
    ticket: int, target: int, writeWorks: bool }
  var s: State
  action init = s' = { signedIn: false, phase: "signin", states: Keys.mapBy(_ => "checking"),
    attempted: Set(), requests: Keys.mapBy(_ => 0), progress: 0, savedProgress: 0,
    completed: false, legacyCompleted: false, pending: -1, generation: 0,
    ticket: 0, target: -1, writeWorks: true }
  val selected = if (s.target >= 0) s.target else s.progress
  val allGranted = Keys.forall(key => s.states.get(key) == "ready")
  val firstMissing = Keys.fold(6, (first, key) => if (s.states.get(key) != "ready" and key < first) key else first)
  action signIn = s' = { ...s, signedIn: true, phase: if (s.completed) "ready" else "permissions" }
  action signOut = all { s.generation < 2,
    s' = { ...s, signedIn: false, phase: "signin", pending: -1, generation: s.generation + 1 } }
  action platformStatus(key: int, granted: bool): bool = all { key.in(Keys),
    s' = { ...s, states: s.states.set(key, if (granted) "ready" else if (s.attempted.contains(key)) "settings" else "request") } }
  action begin = all { s.signedIn, s.phase == "permissions", s.pending == -1,
    selected.in(Keys), s.generation < 2,
    s' = { ...s, pending: selected, generation: s.generation + 1, ticket: s.generation + 1 } }
  action request = all { s.pending >= 0, s.states.get(s.pending) == "request", not(s.attempted.contains(s.pending)),
    s' = { ...s, attempted: s.attempted.union(Set(s.pending)),
      requests: s.requests.set(s.pending, s.requests.get(s.pending) + 1) } }
  action result(granted: bool): bool = all { s.pending >= 0,
    s' = { ...s, pending: -1,
      states: s.states.set(s.pending, if (granted) "ready" else "settings") } }
  action advance = all { s.signedIn, s.phase == "permissions", s.pending == -1,
    s.target == -1, s.states.get(s.progress) == "ready", s.writeWorks,
    s' = if (s.progress == 5) { ...s, phase: "ready" }
      else { ...s, progress: s.progress + 1, savedProgress: s.progress + 1 } }
  action finish = all { s.signedIn, s.phase == "ready", s.pending == -1, s.writeWorks,
    s' = if (s.legacyCompleted or allGranted)
      { ...s, phase: "home", completed: true, savedProgress: if (s.legacyCompleted) s.savedProgress else 6 }
    else { ...s, phase: "permissions", progress: firstMissing, savedProgress: firstMissing } }
  action historicalInstall = {
    nondet count = Set(4, 5).oneOf()
    all { not(s.signedIn), s' = { ...s, completed: true, legacyCompleted: true, savedProgress: count } }
  }
  action openTarget(key: int): bool = all { s.signedIn, key.in(Keys),
    s' = { ...s, phase: "permissions", target: key } }
  action closeTarget = all { s.target >= 0, s.pending == -1,
    s' = { ...s, phase: "home", target: -1 } }
  action storageFails = s' = { ...s, writeWorks: false }
  action storageRecovers = s' = { ...s, writeWorks: true }
  action restart = s' = { ...s, pending: -1, progress: if (s.completed) s.progress else s.savedProgress,
    phase: if (not(s.signedIn)) "signin" else if (s.completed) "ready" else "permissions" }
  action staleResult = s' = s
  action step = {
    nondet key = Keys.oneOf()
    nondet granted = Set(false, true).oneOf()
    any { signIn, signOut, platformStatus(key, granted), begin, request, result(granted), advance,
      finish, historicalInstall, openTarget(key), closeTarget, storageFails, storageRecovers, restart, staleResult }
  }
  val OnePromptPerPermission = Keys.forall(key => s.requests.get(key) <= 1)
  val OrderedWalkthrough = s.progress.in(Keys) and (s.target == -1 or s.target.in(Keys))
  val SignedInActions = s.pending >= 0 implies s.signedIn and s.pending.in(Keys)
  val DurableCompletion = s.completed implies s.savedProgress == 6 or (s.legacyCompleted and s.savedProgress.in(Set(4, 5)))
  val safety = OnePromptPerPermission and OrderedWalkthrough and SignedInActions and DurableCompletion
  run orderedProgressTest = init.then(signIn).then(platformStatus(0, true)).then(advance)
    .then(platformStatus(1, true)).then(advance).then(platformStatus(2, true)).then(advance)
    .then(platformStatus(3, true)).then(advance).then(platformStatus(4, true)).then(advance)
    .then(platformStatus(5, true)).then(advance).then(finish)
    .expect(s.phase == "home" and s.savedProgress == 6 and safety)
  run deniedPermissionCannotAdvanceTest = init.then(signIn).then(platformStatus(0, false))
    .then(begin).then(request).then(result(false)).then(restart)
    .expect(s.progress == 0 and s.states.get(0) == "settings" and s.requests.get(0) == 1 and safety)
  run revokedBeforeFinishTest = init.then(signIn).then(platformStatus(0, true)).then(advance)
    .then(platformStatus(1, true)).then(advance).then(platformStatus(2, true)).then(advance)
    .then(platformStatus(3, true)).then(advance).then(platformStatus(4, true)).then(advance)
    .then(platformStatus(5, true)).then(advance).then(platformStatus(2, false)).then(finish)
    .expect(s.phase == "permissions" and s.progress == 2 and not(s.completed) and safety)
  run failedProgressWriteTest = init.then(signIn).then(platformStatus(0, true)).then(storageFails)
    .then(restart).expect(s.progress == 0 and s.savedProgress == 0 and safety)
  run legacyCompletionTest = init.then(historicalInstall).then(signIn).then(finish)
    .expect(s.phase == "home" and not(allGranted) and safety)
}
