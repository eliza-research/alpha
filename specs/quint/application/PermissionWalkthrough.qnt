/// Native six-permission React coordinator. Progress is installation UI state.
/// Platform status is authority. Old platform calls may outlive a UI generation.
module PermissionWalkthrough {
  pure val Keys = 0.to(5)
  pure val States = Set("checking", "request", "settings", "ready", "unavailable")
  pure val MaxGeneration = 6
  type State = { signedIn: bool, enabled: bool, phase: str, states: int -> str,
    attempted: Set[int], requests: int -> int, progress: int, savedProgress: int,
    completed: bool, legacyCompleted: bool, pending: int, generation: int,
    ticket: int, target: int, writeWorks: bool, operations: int -> int,
    progressError: bool, reopened: bool, completedReady: bool }
  var s: State
  action init = s' = { signedIn: false, enabled: false, phase: "signin", states: Keys.mapBy(_ => "checking"),
    attempted: Set(), requests: Keys.mapBy(_ => 0), progress: 0, savedProgress: 0,
    completed: false, legacyCompleted: false, pending: -1, generation: 0,
    ticket: 0, target: -1, writeWorks: true, operations: Keys.mapBy(_ => -1),
    progressError: false, reopened: false, completedReady: false }
  val selected = if (s.target >= 0) s.target else s.progress
  val allGranted = Keys.forall(key => s.states.get(key) == "ready")
  val firstMissing = Keys.fold(6, (first, key) => if (s.states.get(key) != "ready" and key < first) key else first)
  action mountSignedOut = all { not(s.signedIn), s.generation == 0,
    s' = { ...s, generation: 1 } }
  action signIn = all { s.generation < MaxGeneration,
    s' = { ...s, signedIn: true, enabled: true, generation: s.generation + 1,
      phase: if (s.completed) "home" else "permissions", pending: -1 } }
  action signOut = all { s.generation < MaxGeneration,
    s' = { ...s, signedIn: false, enabled: false, phase: "signin", pending: -1,
      generation: s.generation + 1 } }
  action ownerChange = all { s.signedIn, s.generation < MaxGeneration,
    s' = { ...s, pending: -1, generation: s.generation + 1 } }
  action suspend = all { s.generation < MaxGeneration,
    s' = { ...s, enabled: false, pending: -1, generation: s.generation + 1 } }
  action resume = all { s.generation < MaxGeneration,
    s' = { ...s, enabled: true, pending: -1, generation: s.generation + 1 } }
  action authSetup = all { s.signedIn, s.generation < MaxGeneration,
    s' = { ...s, generation: s.generation + 1, pending: -1, target: -1,
      reopened: false, completedReady: s.completed,
      phase: if (s.completed) "ready" else "permissions" } }
  action platformState(key: int, state: str): bool = all { key.in(Keys), state.in(States),
    s' = { ...s, states: s.states.set(key, state) } }
  action platformStatus(key: int, granted: bool): bool = platformState(key,
    if (granted) "ready" else if (s.attempted.contains(key)) "settings" else "request")
  action begin = all { s.signedIn, s.enabled or s.reopened, s.phase == "permissions", s.pending == -1,
    selected.in(Keys), s.states.get(selected) != "checking", s.operations.get(selected) == -1,
    s' = { ...s, pending: selected, ticket: s.generation,
      operations: s.operations.set(selected, s.generation) } }
  action request = all { s.pending >= 0, s.states.get(s.pending) == "request", not(s.attempted.contains(s.pending)),
    s' = { ...s, attempted: s.attempted.union(Set(s.pending)),
      requests: s.requests.set(s.pending, s.requests.get(s.pending) + 1) } }
  action skipPending = all { s.pending == -1, selected.in(Keys), s.operations.get(selected) >= 0,
    s' = { ...s, ticket: s.generation } }
  action resultState(state: str): bool = all { s.pending >= 0, state.in(States),
    s.ticket == s.generation, s.operations.get(s.pending) == s.ticket,
    s' = { ...s, pending: -1, states: s.states.set(s.pending, state),
      operations: s.operations.set(s.pending, -1) } }
  action result(granted: bool): bool = resultState(if (granted) "ready" else "settings")
  action staleResult(key: int): bool = all { key.in(Keys), s.operations.get(key) >= 0,
    s.operations.get(key) != s.generation,
    s' = { ...s, operations: s.operations.set(key, -1) } }
  action retiredResult = s' = s
  action advance = all { s.signedIn, s.enabled or s.reopened, s.phase == "permissions", s.pending == -1,
    s.target == -1, s.progress.in(Keys), s.states.get(s.progress) == "ready", s.progress == 5 or s.writeWorks,
    s' = if (s.progress == 5) { ...s, phase: "ready" }
      else { ...s, progress: s.progress + 1, savedProgress: s.progress + 1,
        completed: false, legacyCompleted: false, progressError: false } }
  action blockedAdvance = all { s.phase == "permissions", s.pending == -1, s.target == -1,
    s.progress.in(0.to(4)), s.states.get(s.progress) == "ready", not(s.writeWorks),
    s' = { ...s, progressError: true } }
  action finish = all { s.signedIn, s.enabled or s.reopened, s.phase == "ready", s.pending == -1,
    s.writeWorks or s.completedReady and s.completed,
    s' = if (s.completedReady and s.completed)
      { ...s, phase: "home", progress: -1, ticket: s.generation }
    else if (allGranted)
      { ...s, phase: "home", completed: true, legacyCompleted: false, progress: -1,
        savedProgress: 6, progressError: false, ticket: s.generation }
    else { ...s, phase: "permissions", progress: firstMissing, savedProgress: firstMissing,
      completed: false, legacyCompleted: false, progressError: false, ticket: s.generation } }
  action blockedFinish = all { s.phase == "ready", not(s.writeWorks), not(s.completedReady and s.completed),
    s' = { ...s, progressError: true, ticket: s.generation,
      phase: if (allGranted) "ready" else "permissions" } }
  action restoreCompleted(count: int): bool = all { not(s.signedIn), count.in(Set(4, 5, 6)),
    s' = { ...s, completed: true, legacyCompleted: count < 6, progress: -1, savedProgress: count } }
  action historicalInstall = { nondet count = Set(4, 5).oneOf(); restoreCompleted(count) }
  action openTarget(key: int): bool = all { s.signedIn, key.in(Keys), s.generation < MaxGeneration,
    s' = { ...s, phase: "permissions", target: key, pending: -1,
      generation: s.generation + 1, reopened: true, completedReady: false } }
  action closeTarget = all { s.target >= 0, s.pending == -1, s' = { ...s, phase: "home" } }
  action storageFails = s' = { ...s, writeWorks: false }
  action progressWriteFailed = s' = { ...s, progressError: true }
  action storageRecovers = s' = { ...s, writeWorks: true }
  action restart = s' = { ...s, pending: -1, generation: 1, ticket: 0,
    operations: Keys.mapBy(_ => -1), reopened: false, completedReady: false,
    states: Keys.mapBy(_ => "checking"), progress: if (s.completed) -1 else s.savedProgress,
    progressError: not(s.writeWorks) and not(s.completed),
    phase: if (not(s.signedIn)) "signin" else if (s.completed) "home" else "permissions" }
  action rewind = all { s.target == -1, s.progress.in(Keys), firstMissing < s.progress, s.writeWorks,
    s' = { ...s, phase: "permissions", progress: firstMissing, savedProgress: firstMissing,
      progressError: false } }
  action blockedDismiss = s' = s
  action step = {
    nondet key = Keys.oneOf()
    nondet granted = Set(false, true).oneOf()
    nondet state = States.oneOf()
    any { mountSignedOut, signIn, signOut, ownerChange, suspend, resume, authSetup, platformState(key, state),
      begin, request, skipPending, result(granted), staleResult(key), retiredResult, advance, blockedAdvance,
      finish, blockedFinish, historicalInstall, openTarget(key), closeTarget, storageFails,
      storageRecovers, progressWriteFailed, restart, rewind, blockedDismiss }
  }
  val OnePromptPerPermission = Keys.forall(key => s.requests.get(key) <= 1)
  val OrderedWalkthrough = (s.progress.in(Keys) or s.progress == -1 and s.completed) and
    (s.target == -1 or s.target.in(Keys))
  val SignedInActions = s.pending >= 0 implies s.signedIn and (s.enabled or s.reopened) and s.pending.in(Keys) and
    s.ticket == s.generation and s.operations.get(s.pending) == s.ticket
  val DurableCompletion = s.completed implies s.savedProgress == 6 or (s.legacyCompleted and s.savedProgress.in(Set(4, 5)))
  val safety = OnePromptPerPermission and OrderedWalkthrough and SignedInActions and DurableCompletion
  run orderedProgressTest = init.then(signIn).then(platformStatus(0, true)).then(advance)
    .then(platformStatus(1, true)).then(advance).then(platformStatus(2, true)).then(advance)
    .then(platformStatus(3, true)).then(advance).then(platformStatus(4, true)).then(advance)
    .then(platformStatus(5, true)).then(advance).then(finish)
    .expect(s.phase == "home" and s.savedProgress == 6 and s.progress == -1 and safety)
  run deniedPermissionCannotAdvanceTest = init.then(signIn).then(platformStatus(0, false))
    .then(begin).then(request).then(result(false)).then(restart).then(platformStatus(0, false))
    .expect(s.progress == 0 and s.states.get(0) == "settings" and s.requests.get(0) == 1 and safety)
  run revokedBeforeFinishTest = init.then(signIn).then(platformStatus(0, true)).then(advance)
    .then(platformStatus(1, true)).then(advance).then(platformStatus(2, true)).then(advance)
    .then(platformStatus(3, true)).then(advance).then(platformStatus(4, true)).then(advance)
    .then(platformStatus(5, true)).then(advance).then(platformStatus(2, false)).then(finish)
    .expect(s.phase == "permissions" and s.progress == 2 and not(s.completed) and safety)
  run failedProgressWriteTest = init.then(signIn).then(platformStatus(0, true)).then(storageFails)
    .then(restart).expect(s.progress == 0 and s.savedProgress == 0 and s.progressError and safety)
  run legacyCompletionTest = init.then(historicalInstall).then(signIn).then(authSetup).then(finish)
    .expect(s.phase == "home" and not(allGranted) and safety)
  run ownerChangeRetiresPendingTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(ownerChange).then(staleResult(0)).expect(s.pending == -1 and s.progress == 0 and safety)
  run staleCompletionKeepsNewPendingTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(ownerChange).then(openTarget(1)).then(platformStatus(1, false)).then(begin).then(request)
    .then(staleResult(0)).expect(s.pending == 1 and s.operations.get(1) == s.generation and safety)
  run completedRemountTest = orderedProgressTest.then(restart).expect(s.phase == "home" and s.progress == -1 and safety)
}
