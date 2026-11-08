/// Current StartupPermissions component over seven native or four browser flows.
/// Installation progress is best effort. Platform status remains authoritative.
module PermissionWalkthrough {
  pure val AllKeys = 0.to(6)
  pure val States = Set("checking", "request", "settings", "ready", "unavailable")
  pure val MaxGeneration = 12
  pure val LocationDescriptions = Set("", "Approximate location allowed", "Precise location allowed", "Not allowed")
  pure val PhotoDescriptions = Set("", "All photos and videos allowed", "Selected photos and videos only", "Limited photo or video access allowed", "Not allowed")
  type State = { native: bool, signedIn: bool, enabled: bool, connectionOpen: bool, googleOpen: bool, setupReady: bool, accountCreated: bool,
    active: bool, ready: bool, reopened: bool, review: bool, progress: int, choices: List[str],
    savedProgress: int, savedChoices: List[str], savedHasChoices: bool, completed: bool, legacyCompleted: bool,
    states: int -> str, attempted: Set[int], requests: int -> int, pending: int, generation: int,
    ticket: int, target: int, writeWorks: bool, operations: int -> int, flowTickets: int -> int, progressError: bool,
    canSkip: bool, checkNotice: str, pendingChoice: str, dismissed: bool, homeRequests: int, locationDescription: str, photoDescription: str }
  var s: State
  val count = if (s.native) 7 else 4
  val Keys = 0.to(count - 1)
  val selected = if (s.target >= 0) s.target else if (s.progress >= 0) s.progress else 0
  val visible = (s.active or s.ready) and (s.enabled or s.reopened) and not(s.connectionOpen or s.googleOpen)
  val busy = s.pending >= 0
  val shownPermission = if (visible and not(s.ready)) selected else -1
  val buttonDisabled = visible and (busy or (not(s.ready) and s.states.get(selected) == "checking"))
  val phase = if (not(visible)) "hidden" else if (s.ready) "ready" else "permissions"
  pure def continuedChoices(step: int): List[str] = AllKeys.fold(List(), (items, key) =>
    if (key < step) items.append("continued") else items)
  pure def initial(native: bool): State = { native: native, signedIn: false, enabled: false,
    connectionOpen: false, googleOpen: false, setupReady: false, accountCreated: false, active: true, ready: false, reopened: false, review: false,
    progress: 0, choices: List(), savedProgress: 0, savedChoices: List(), savedHasChoices: false,
    completed: false, legacyCompleted: false, states: AllKeys.mapBy(_ => "checking"),
    attempted: Set(), requests: AllKeys.mapBy(_ => 0), pending: -1, generation: 0, ticket: 0,
    target: -1, writeWorks: true, operations: AllKeys.mapBy(_ => -1), flowTickets: AllKeys.mapBy(_ => -1), progressError: false,
    canSkip: false, checkNotice: "", pendingChoice: "", dismissed: false, homeRequests: 0, locationDescription: "", photoDescription: "" }
  action init = s' = initial(true)
  action browserInit = s' = initial(false)
  pure def wrote(before: State, step: int, choices: List[str]): State = {
    val skipped = choices.foldl(false, (found, choice) => found or choice == "skipped")
    val saved = before.writeWorks and not(before.review)
    { ...before, progress: step, choices: if (step < 0) List() else choices,
      savedProgress: if (saved) (if (step < 0) (if (before.native) 7 else 4) else step) else before.savedProgress,
      savedHasChoices: if (saved) skipped else before.savedHasChoices,
      savedChoices: if (saved) (if (skipped) choices else List()) else before.savedChoices,
      completed: if (saved) step < 0 else before.completed,
      legacyCompleted: if (saved) false else before.legacyCompleted,
      progressError: if (before.review) before.progressError else not(before.writeWorks) }
  }
  pure def advanced(before: State, choice: str): State = {
    val last = before.progress + 1 == (if (before.native) 7 else 4)
    { ...wrote(before, if (last) -1 else before.progress + 1, before.choices.append(choice)),
      active: not(last), ready: last, canSkip: false, checkNotice: "" }
  }
  pure def mounted(before: State, signedIn: bool, isEnabled: bool): State = {
    val current = { ...before, signedIn: signedIn, enabled: isEnabled, generation: before.generation + 1,
      pending: -1, canSkip: false, checkNotice: "" }
    if (current.active and isEnabled and current.target < 0 and current.progress >= 0)
      wrote(current, current.progress, current.choices) else current
  }
  action mountSignedOut = all { s.generation == 0, s' = mounted(s, false, false) }
  action signIn = all { s.generation < MaxGeneration, s' = mounted(s, true, true) }
  action directEnabled = all { s.generation < MaxGeneration, s' = mounted(s, false, true) }
  action signOut = all { s.generation < MaxGeneration,
    s' = { ...s, signedIn: false, enabled: false, generation: s.generation + 1, pending: -1, canSkip: false, checkNotice: "" } }
  action ownerChange = all { s.generation < MaxGeneration,
    s' = { ...s, generation: s.generation + 1, pending: -1 } }
  action suspend = all { s.generation < MaxGeneration,
    s' = { ...s, enabled: false, generation: s.generation + 1, pending: -1, canSkip: false, checkNotice: "" } }
  action resume = all { s.generation < MaxGeneration, s' = mounted(s, s.signedIn, true) }
  action overlays(connection: bool, google: bool): bool = s' = { ...s, connectionOpen: connection, googleOpen: google,
    canSkip: false, checkNotice: "" }
  pure def authenticated(before: State, created: bool, increment: int): State = {
    val progress = if (before.progressError) before.progress else if (before.completed) -1 else before.savedProgress
    val choices = if (before.progressError) before.choices else if (before.savedHasChoices) before.savedChoices else continuedChoices(before.savedProgress)
    val current = { ...before, setupReady: true, accountCreated: created, generation: before.generation + increment,
      pending: -1, reopened: false, target: -1, review: false, active: progress >= 0, ready: created and progress < 0,
      progress: progress, choices: if (progress < 0) List() else choices, canSkip: false, checkNotice: "" }
    if (progress >= 0) wrote(current, progress, choices) else current
  }
  action authSetup(created: bool): bool = all { s.generation + 2 <= MaxGeneration,
    s' = authenticated(s, created, 2) }
  action platformState(key: int, state: str): bool = all { Keys.contains(key), States.contains(state), s.flowTickets.get(key) == -1,
    s' = { ...s, states: s.states.set(key, state) } }
  action platformDetails(location: str, photos: str): bool = all { s.native,
    LocationDescriptions.contains(location), PhotoDescriptions.contains(photos),
    s' = { ...s, locationDescription: location, photoDescription: photos } }
  action platformStatus(key: int, granted: bool): bool = platformState(key,
    if (granted) "ready" else if (s.attempted.contains(key)) "settings" else "request")
  action begin = all { visible, s.enabled or s.reopened, s.active, not(s.ready), s.pending == -1,
    Keys.contains(selected), s.states.get(selected) != "checking", s.flowTickets.get(selected) == -1,
    s' = { ...s, pending: selected, ticket: s.generation, flowTickets: s.flowTickets.set(selected, s.generation),
      pendingChoice: if (s.states.get(selected) == "ready") "continued" else "allowed", checkNotice: "" } }
  action request = all { s.pending >= 0, s.states.get(s.pending) == "request", not(s.attempted.contains(s.pending)),
    s' = { ...s, attempted: s.attempted.union(Set(s.pending)), requests: s.requests.set(s.pending, s.requests.get(s.pending) + 1), operations: s.operations.set(s.pending, s.ticket) } }
  action skipPending = all { s.pending == -1, Keys.contains(selected), s.flowTickets.get(selected) >= 0,
    s' = { ...s, ticket: s.generation, checkNotice: "" } }
  action resultState(state: str): bool = all { s.pending >= 0, States.contains(state), state != "checking", s.ticket == s.generation,
    s.flowTickets.get(s.pending) == s.ticket, {
      val current = { ...s, states: s.states.set(s.pending, state), pending: -1,
        flowTickets: s.flowTickets.set(s.pending, -1),
        operations: if (s.operations.get(s.pending) == s.ticket) s.operations.set(s.pending, -1) else s.operations,
        checkNotice: if (s.native or state == "ready") "" else if (state == "settings") "off" else "unconfirmed" }
      s' = if (state == "ready" and s.target < 0) advanced(current, s.pendingChoice) else current
    } }
  action result(granted: bool): bool = resultState(if (granted) "ready" else "settings")
  action staleResult(key: int): bool = all { Keys.contains(key), s.operations.get(key) >= 0,
    s.operations.get(key) != s.generation, s' = { ...s, operations: s.operations.set(key, -1),
      flowTickets: if (s.flowTickets.get(key) == s.operations.get(key)) s.flowTickets.set(key, -1) else s.flowTickets } }
  action retiredResult = s' = s
  action skipAvailable = all { visible, not(s.ready), s' = { ...s, canSkip: true } }
  action skip = all { visible, s.canSkip, s.generation < MaxGeneration, {
    val retired = { ...s, generation: s.generation + 1, pending: -1, canSkip: false, checkNotice: "", flowTickets: s.flowTickets.set(selected, -1) }
    s' = if (s.target >= 0) { ...retired, active: false } else advanced(retired, "skipped")
  } }
  action finish = all { visible, s.ready, s.pending == -1, s' = { ...s, active: false, ready: false, dismissed: true,
    homeRequests: if (s.reopened) s.homeRequests else s.homeRequests + 1, canSkip: false, checkNotice: "" } }
  action restoreCompleted(steps: int): bool = all { s.generation == 0,
    (s.native and Set(4, 5, 6, 7).contains(steps)) or (not(s.native) and steps == 4),
    s' = { ...s, completed: true, legacyCompleted: steps < count, savedProgress: steps,
      progress: -1, active: false } }
  action restorePending(step: int): bool = all { s.generation == 0, Keys.contains(step),
    s' = { ...s, savedProgress: step, progress: step, choices: continuedChoices(step) } }
  action reopen = all { s.generation < MaxGeneration, {
    val progress = if (s.completed) 0 else s.savedProgress
    val choices = if (s.completed) List() else if (s.savedHasChoices) s.savedChoices else continuedChoices(progress)
    val current = { ...s, generation: s.generation + 1, pending: -1, review: s.completed, reopened: true,
      active: true, ready: false, target: -1, canSkip: false, checkNotice: "" }
    s' = wrote(current, progress, choices)
  } }
  action openTarget(key: int): bool = all { Keys.contains(key), s.generation < MaxGeneration,
    s' = { ...s, generation: s.generation + 1, pending: -1, target: key,
      reopened: true, review: s.completed, active: true, ready: false, canSkip: false, checkNotice: "" } }
  action closeTarget = all { s.target >= 0, s.pending == -1,
    s' = { ...s, active: false, canSkip: false, checkNotice: "" } }
  action closeReview = all { visible, s.review, s.generation < MaxGeneration,
    s' = { ...s, generation: s.generation + 1, pending: -1, active: false, ready: false, reopened: false,
      target: -1, progress: -1, choices: List(), canSkip: false, checkNotice: "", flowTickets: s.flowTickets.set(selected, -1) } }
  action storageFails = s' = { ...s, writeWorks: false }
  action storageRecovers = s' = { ...s, writeWorks: true }
  action progressWriteFailed = s' = { ...s, progressError: true }
  action restart = {
    val resumed = { ...s, pending: -1, generation: 0, ticket: 0, operations: AllKeys.mapBy(_ => -1), flowTickets: AllKeys.mapBy(_ => -1),
      reopened: false, review: false, target: -1, ready: false, active: not(s.completed),
      states: AllKeys.mapBy(_ => "checking"), progress: if (s.completed) -1 else s.savedProgress,
      choices: if (s.completed) List() else if (s.savedHasChoices) s.savedChoices else continuedChoices(s.savedProgress),
      progressError: false, canSkip: false, checkNotice: "", pendingChoice: "", locationDescription: "", photoDescription: "" }
    val first = mounted(resumed, s.signedIn, s.enabled)
    s' = if (s.setupReady) authenticated(first, s.accountCreated, 1) else first
  }
  action blockedDismiss = s' = s
  action step = { nondet key = Keys.oneOf()
    nondet state = States.oneOf()
    nondet created = Set(false, true).oneOf()
    nondet location = LocationDescriptions.oneOf()
    nondet photos = PhotoDescriptions.oneOf()
    any { mountSignedOut, signIn, directEnabled, signOut, ownerChange, suspend, resume, authSetup(created),
      overlays(false, false), overlays(true, false), overlays(false, true), platformState(key, state), platformDetails(location, photos),
      begin, request, skipPending, resultState(state), staleResult(key), retiredResult,
      skipAvailable, skip, finish, reopen, openTarget(key), closeTarget, closeReview,
      storageFails, storageRecovers, progressWriteFailed, restart, blockedDismiss } }
  val OnePromptPerPermission = AllKeys.forall(key => s.requests.get(key) <= 1)
  val OrderedWalkthrough = (Keys.contains(s.progress) or s.progress == -1) and (s.target == -1 or Keys.contains(s.target))
    and (s.progress < 0 implies s.choices.length() == 0)
    and (s.progress >= 0 implies s.choices.length() == s.progress)
  val CurrentOperation = s.pending >= 0 implies (s.enabled or s.reopened) and s.active and not(s.ready)
    and Keys.contains(s.pending) and s.ticket == s.generation and s.flowTickets.get(s.pending) == s.ticket
  val DurableCompletion = s.completed implies (s.savedProgress == count or (s.legacyCompleted and Set(4, 5, 6).contains(s.savedProgress)))
  val InactiveKeysChecking = AllKeys.exclude(Keys).forall(key => s.states.get(key) == "checking")
  val DescriptionDomains = LocationDescriptions.contains(s.locationDescription) and PhotoDescriptions.contains(s.photoDescription)
  val TypeOK = 0.to(MaxGeneration).contains(s.generation) and 0.to(MaxGeneration).contains(s.ticket)
    and 0.to(count).contains(s.savedProgress) and s.homeRequests >= 0
    and s.attempted.subseteq(Keys) and s.states.keys() == AllKeys and s.requests.keys() == AllKeys
    and s.operations.keys() == AllKeys and s.flowTickets.keys() == AllKeys
    and AllKeys.forall(key => States.contains(s.states.get(key)) and Set(0, 1).contains(s.requests.get(key))
      and (-1).to(MaxGeneration).contains(s.operations.get(key)) and (-1).to(MaxGeneration).contains(s.flowTickets.get(key)))
    and s.choices.foldl(true, (valid, choice) => valid and Set("allowed", "continued", "skipped").contains(choice))
    and s.savedChoices.foldl(true, (valid, choice) => valid and Set("allowed", "continued", "skipped").contains(choice))
    and (s.savedHasChoices implies s.savedChoices.length() == s.savedProgress)
    and (not(s.savedHasChoices) implies s.savedChoices.length() == 0)
    and Set("", "off", "unconfirmed").contains(s.checkNotice) and Set("", "allowed", "continued").contains(s.pendingChoice)
  val safety = TypeOK and DescriptionDomains and OnePromptPerPermission and OrderedWalkthrough and CurrentOperation and DurableCompletion and InactiveKeysChecking
  run sevenPermissionProgressTest = init.then(signIn).then(platformStatus(0, true)).then(begin).then(result(true))
    .then(platformStatus(1, true)).then(begin).then(result(true))
    .then(platformStatus(2, true)).then(begin).then(result(true))
    .then(platformStatus(3, true)).then(begin).then(result(true))
    .then(platformStatus(4, true)).then(begin).then(result(true))
    .then(platformStatus(5, true)).then(begin).then(result(true))
    .then(platformStatus(6, true)).then(begin).then(result(true))
    .expect(s.ready and s.completed and s.savedProgress == 7 and safety)
    .then(finish).expect(phase == "hidden" and s.homeRequests == 1 and safety)
  run browserFourProgressTest = browserInit.then(signIn).then(platformStatus(0, true)).then(begin).then(result(true))
    .then(platformStatus(1, true)).then(begin).then(result(true))
    .then(platformStatus(2, true)).then(begin).then(result(true))
    .then(platformStatus(3, true)).then(begin).then(result(true))
    .expect(s.ready and s.savedProgress == 4 and safety)
  run failedProgressAdvancesTest = init.then(storageFails).then(signIn).then(platformStatus(0, true)).then(begin).then(result(true))
    .expect(s.progress == 1 and s.savedProgress == 0 and s.progressError and safety)
    .then(restart).expect(s.progress == 0 and safety)
  run failedCompletionResumesTest = init.then(restorePending(6)).then(storageFails).then(signIn)
    .then(platformStatus(6, true)).then(begin).then(result(true))
    .expect(s.ready and not(s.completed) and s.progressError and safety).then(finish)
    .then(restart).expect(s.progress == 6 and safety)
  run legacyReviewPreservesCompletionTest = init.then(restoreCompleted(4)).then(signIn).then(reopen).then(skipAvailable).then(skip)
    .expect(s.review and s.progress == 1 and s.savedProgress == 4 and s.completed and safety)
    .then(closeReview).expect(not(visible) and safety)
  run ownerChangeRetiresPendingTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(ownerChange).then(staleResult(0)).expect(s.pending == -1 and s.progress == 0 and safety)
  run staleCompletionKeepsNewPendingTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(ownerChange).then(openTarget(1)).then(platformStatus(1, false)).then(begin).then(request)
    .then(staleResult(0)).expect(s.pending == 1 and s.operations.get(1) == s.generation and safety)
  run skippedRequestCannotAdvanceNextTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(skipAvailable).then(skip).then(staleResult(0))
    .expect(s.progress == 1 and s.choices == List("skipped") and s.savedHasChoices and safety)
  run completedRemountTest = sevenPermissionProgressTest.then(restart).expect(not(visible) and s.progress == -1 and safety)
  run cancelledFlowRecheckTest = init.then(signIn).then(platformStatus(0, false)).then(begin).then(request)
    .then(skipAvailable).then(skip).then(openTarget(0)).then(platformStatus(0, false)).then(begin).then(result(false))
    .expect(s.operations.get(0) == 1 and s.flowTickets.get(0) == -1 and safety)
    .then(staleResult(0)).expect(s.operations.get(0) == -1 and safety)
  run nativeDisclosureTest = init.then(signIn)
    .then(platformDetails("Approximate location allowed", "Selected photos and videos only"))
    .expect(s.locationDescription == "Approximate location allowed" and s.photoDescription == "Selected photos and videos only" and safety)

  run directProviderProgressTest = init.then(mountSignedOut).then(authSetup(false)).then(directEnabled)
    .then(platformStatus(0, true)).then(begin).then(result(true))
    .expect(not(s.signedIn) and s.enabled and s.progress == 1 and safety)

}
