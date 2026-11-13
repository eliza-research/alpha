/// Native seven-permission React coordinator. Progress is installation UI state.
/// Platform status is authority. Old platform calls may outlive a UI generation.
module PermissionWalkthrough {
  pure val Keys = 0.to(6)
  pure val States = Set("checking", "request", "settings", "ready", "unavailable")
  pure val MaxGeneration = 6
  type State = { signedIn: bool, enabled: bool, phase: str, surface: str, states: int -> str,
    attempted: Set[int], persistedAttempted: Set[int], requests: int -> int, sessionRequests: int -> int, progress: int, savedProgress: int,
    completed: bool, legacyCompleted: bool, pending: int, generation: int,
    ticket: int, target: int, writeWorks: bool, operations: int -> int,
    progressError: bool, reopened: bool, review: bool, attemptWriteWorks: bool }
  var s: State
  action init = s' = { signedIn: false, enabled: false, phase: "signin", surface: "permissions", states: Keys.mapBy(_ => "checking"),
    attempted: Set(), persistedAttempted: Set(), requests: Keys.mapBy(_ => 0), sessionRequests: Keys.mapBy(_ => 0), progress: 0, savedProgress: 0,
    completed: false, legacyCompleted: false, pending: -1, generation: 0,
    ticket: 0, target: -1, writeWorks: true, operations: Keys.mapBy(_ => -1),
    progressError: false, reopened: false, review: false, attemptWriteWorks: true }
  val selected = if (s.target >= 0) s.target else s.progress
  val allGranted = Keys.forall(key => s.states.get(key) == "ready")
  action mountSignedOut = all { not(s.signedIn), s.generation == 0,
    s' = { ...s, generation: 1 } }
  action signIn = all { s.generation < MaxGeneration,
    s' = { ...s, signedIn: true, enabled: true, generation: s.generation + 1,
      phase: s.surface, pending: -1 } }
  action signOut = all { s.generation < MaxGeneration,
    s' = { ...s, signedIn: false, enabled: false, phase: "signin", pending: -1,
      generation: s.generation + 1 } }
  action ownerChange = all { s.signedIn, s.generation < MaxGeneration,
    s' = { ...s, pending: -1, generation: s.generation + 1 } }
  action suspend = all { s.generation < MaxGeneration,
    s' = { ...s, enabled: false, pending: -1, generation: s.generation + 1 } }
  action resume = all { s.generation < MaxGeneration,
    s' = { ...s, enabled: true, pending: -1, generation: s.generation + 1 } }
  action authSetup(accountCreated: bool): bool = all { s.signedIn, s.generation + 2 <= MaxGeneration,
    val resume = if (s.progressError) s.progress else if (s.completed) -1 else s.savedProgress
    s' = { ...s, generation: s.generation + 2, pending: -1, target: -1,
      reopened: false, review: false, progress: resume,
      phase: if (resume >= 0) "permissions" else if (accountCreated) "ready" else "home",
      surface: if (resume >= 0) "permissions" else if (accountCreated) "ready" else "home" } }
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
      requests: s.requests.set(s.pending, s.requests.get(s.pending) + 1),
      sessionRequests: s.sessionRequests.set(s.pending, s.sessionRequests.get(s.pending) + 1),
      persistedAttempted: if (s.attemptWriteWorks) s.persistedAttempted.union(Set(s.pending)) else s.persistedAttempted } }
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
  /// A reviewed choice advances this session even when its durable write fails.
  /// The last choice records completion. The Ready button only acknowledges that UI result.
  action advance = all { s.signedIn, s.enabled or s.reopened, s.phase == "permissions", s.pending == -1,
    s.target == -1, s.progress.in(Keys), s.states.get(s.progress) == "ready",
    val finalStep = s.progress == 6
    val written = s.writeWorks and not(s.review)
    s' = { ...s, phase: if (finalStep) "ready" else "permissions",
      surface: if (finalStep) "ready" else "permissions",
      progress: if (finalStep) -1 else s.progress + 1,
      savedProgress: if (written) { if (finalStep) 7 else s.progress + 1 } else s.savedProgress,
      completed: if (written) finalStep else s.completed,
      legacyCompleted: if (written) false else s.legacyCompleted,
      progressError: if (s.review) s.progressError else not(s.writeWorks) } }
  action finish = all { s.signedIn, s.enabled or s.reopened, s.phase == "ready", s.pending == -1,
    s' = { ...s, phase: "home", surface: "home" } }
  action restoreCompleted(count: int): bool = all { not(s.signedIn), count.in(Set(4, 5, 6, 7)),
    s' = { ...s, completed: true, legacyCompleted: count < 7, progress: -1, savedProgress: count, surface: "home" } }
  action historicalInstall = { nondet count = Set(4, 5, 6).oneOf(); restoreCompleted(count) }
  action openTarget(key: int): bool = all { s.signedIn, key.in(Keys), s.generation < MaxGeneration,
    s' = { ...s, phase: "permissions", surface: "permissions", target: key, pending: -1,
      generation: s.generation + 1, reopened: true, review: s.completed } }
  action closeTarget = all { s.target >= 0, s.pending == -1,
    s' = { ...s, phase: if (s.signedIn) "home" else "signin", surface: "home" } }
  action attemptStorageFails = s' = { ...s, attemptWriteWorks: false }
  action storageFails = s' = { ...s, writeWorks: false }
  action progressWriteFailed = s' = { ...s, progressError: true }
  action storageRecovers = s' = { ...s, writeWorks: true }
  action restart = s' = { ...s, pending: -1, generation: 1, ticket: 0,
    operations: Keys.mapBy(_ => -1), reopened: false, review: false,
    attempted: s.persistedAttempted, sessionRequests: Keys.mapBy(_ => 0),
    states: Keys.mapBy(_ => "checking"), progress: if (s.completed) -1 else s.savedProgress,
    progressError: not(s.writeWorks) and not(s.completed),
    phase: if (not(s.signedIn)) "signin" else if (s.completed) "home" else "permissions",
    surface: if (s.completed) "home" else "permissions" }
  action blockedDismiss = s' = s
  action step = {
    nondet key = Keys.oneOf()
    nondet granted = Set(false, true).oneOf()
    nondet state = States.oneOf()
    any { mountSignedOut, signIn, signOut, ownerChange, suspend, resume, authSetup(true), authSetup(false), platformState(key, state),
      begin, request, skipPending, result(granted), staleResult(key), retiredResult, advance,
      finish, historicalInstall, openTarget(key), closeTarget, storageFails,
      storageRecovers, attemptStorageFails, progressWriteFailed, restart, blockedDismiss }
  }
  val OnePromptPerPermission = Keys.forall(key => s.sessionRequests.get(key) <= 1)
  val OrderedWalkthrough = (s.progress.in(Keys) or s.progress == -1) and
    (s.target == -1 or s.target.in(Keys))
  val SignedInActions = s.pending >= 0 implies s.signedIn and (s.enabled or s.reopened) and s.pending.in(Keys) and
    s.ticket == s.generation and s.operations.get(s.pending) == s.ticket
  val DurableCompletion = s.completed implies s.savedProgress == 7 or (s.legacyCompleted and s.savedProgress.in(Set(4, 5, 6)))
  val PersistedAttemptsRetained = s.persistedAttempted.subseteq(s.attempted)
  val CurrentSurface = s.phase == (if (s.signedIn) s.surface else "signin")
  val safety = CurrentSurface and OnePromptPerPermission and PersistedAttemptsRetained and OrderedWalkthrough and SignedInActions and DurableCompletion
  run orderedProgressTest = init.then(signIn).then(platformStatus(0, true)).then(advance)
    .then(platformStatus(1, true)).then(advance).then(platformStatus(2, true)).then(advance)
    .then(platformStatus(3, true)).then(advance).then(platformStatus(4, true)).then(advance)
    .then(platformStatus(5, true)).then(advance).then(platformStatus(6, true)).then(advance).then(finish)
    .expect(s.phase == "home" and s.savedProgress == 7 and s.progress == -1 and safety)
  run deniedPermissionCannotAdvanceTest = init.then(signIn).then(platformStatus(0, false))
    .then(begin).then(request).then(result(false)).then(restart).then(platformStatus(0, false))
    .expect(s.progress == 0 and s.states.get(0) == "settings" and s.requests.get(0) == 1 and safety)
  run revokedAfterReviewPreservesCompletionTest = orderedProgressTest.then(platformStatus(2, false))
    .expect(s.phase == "home" and s.completed and not(allGranted) and safety)
  run failedProgressWriteTest = init.then(signIn).then(platformStatus(0, true)).then(storageFails)
    .then(restart).expect(s.progress == 0 and s.savedProgress == 0 and s.progressError and safety)
  run legacyCompletionTest = init.then(historicalInstall).then(signIn).then(authSetup(true)).then(finish)
    .expect(s.phase == "home" and not(allGranted) and safety)
  run failedAttemptWriteRestartTest = init.then(signIn).then(attemptStorageFails).then(platformStatus(0, false))
    .then(begin).then(request).then(result(false)).then(restart).then(platformStatus(0, false))
    .then(begin).then(request).then(result(false))
    .expect(s.requests.get(0) == 2 and not(s.persistedAttempted.contains(0)) and safety)
  run failedChoiceWriteStillAdvancesTest = init.then(signIn).then(platformStatus(0, true)).then(storageFails)
    .then(advance).expect(s.progress == 1 and s.savedProgress == 0 and s.progressError and safety)
  run ownerChangeRetiresPendingTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(ownerChange).then(staleResult(0)).expect(s.pending == -1 and s.progress == 0 and safety)
  run staleCompletionKeepsNewPendingTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(ownerChange).then(openTarget(1)).then(platformStatus(1, false)).then(begin).then(request)
    .then(staleResult(0)).expect(s.pending == 1 and s.operations.get(1) == s.generation and safety)
  run completedRemountTest = orderedProgressTest.then(restart).expect(s.phase == "home" and s.progress == -1 and safety)
  /// Image provisioning supplies platform status, not a completed installation marker. The
  /// existing advance transition needs a ready row and never issues a permission request.
  run imageGrantedProgressTest = orderedProgressTest
    .expect(Keys.forall(key => s.requests.get(key) == 0) and s.completed and s.savedProgress == 7 and safety)
}
