/// Projection of createStartupPermissionFlow and the versioned walkthrough record.
module StartupPermissions {
  type State = { status: str, attempted: bool, granted: bool, enabled: bool,
    requestable: bool, pending: bool, generation: int, captured: int,
    requests: int, sessionRequests: int, persistedAttempted: bool, writeWorks: bool, step: int, persistedStep: int, completed: bool }
  var s: State
  pure def statusFor(granted: bool, accessEnabled: bool, attempted: bool, requestable: bool): str =
    if (granted and accessEnabled) "ready" else if (attempted or granted or not(requestable)) "settings" else "request"
  action init = s' = { status: "checking", attempted: false, granted: false,
    enabled: false, requestable: true, pending: false, generation: 0, captured: 0,
    requests: 0, sessionRequests: 0, persistedAttempted: false, writeWorks: true, step: 0, persistedStep: 0, completed: false }
  action check = s' = { ...s, status: statusFor(s.granted, s.enabled, s.attempted, s.requestable) }
  action enable = all { not(s.pending), s.generation < 2,
    s' = { ...s, pending: true, generation: s.generation + 1, captured: s.generation + 1,
      status: statusFor(s.granted, s.enabled, s.attempted, s.requestable) } }
  action prompt = all { s.pending, s.status == "request", not(s.attempted),
    s' = { ...s, attempted: true, requests: s.requests + 1, sessionRequests: s.sessionRequests + 1,
      persistedAttempted: s.persistedAttempted or s.writeWorks } }
  action result(granted: bool): bool = all { s.pending,
    s' = { ...s, granted: granted, enabled: granted, pending: false,
      status: statusFor(granted, granted, s.attempted, s.requestable) } }
  action failed = s' = { ...s, pending: false, status: "unavailable" }
  action denied = all { not(s.pending), s' = { ...s, requestable: false, status: "settings" } }
  action persistNext = all { not(s.completed), s.step < 7,
    s' = { ...s, step: s.step + 1, persistedStep: s.step + 1, completed: s.step + 1 == 7 } }
  action persistFailed = s' = s
  action restart = s' = { ...s, pending: false, status: "checking", step: s.persistedStep,
    attempted: s.persistedAttempted, sessionRequests: 0 }
  action storageFails = s' = { ...s, writeWorks: false }
  action storageRecovers = s' = { ...s, writeWorks: true }
  action oldCompletedInstall = {
    nondet count = Set(4, 5, 6).oneOf()
    s' = { ...s, completed: true, step: count, persistedStep: count }
  }
  action resumeDuringPrompt = s' = s
  action step = any { check, enable, prompt, result(true), result(false), failed, denied,
    persistNext, persistFailed, restart, storageFails, storageRecovers, oldCompletedInstall, resumeDuringPrompt }
  /// Failed best-effort storage retains the attempt only until the flow is recreated.
  val NoRepeatedPrompt = s.sessionRequests <= 1
  val PersistedAttemptRestored = s.persistedAttempted implies s.attempted
  val DurableProgress = s.step == s.persistedStep
  val OwnedPending = s.pending implies s.captured == s.generation
  val CompletedUpgrade = s.completed implies s.step.in(Set(4, 5, 6, 7))
  val safety = NoRepeatedPrompt and PersistedAttemptRestored and DurableProgress and OwnedPending and CompletedUpgrade
  run denialRestartTest = init.then(enable).then(prompt).then(result(false)).then(restart)
    .then(check).expect(s.status == "settings" and s.requests == 1 and safety)
  run failedStorageRestartTest = init.then(storageFails).then(enable).then(prompt).then(result(false))
    .then(restart).then(enable).then(prompt).then(result(false))
    .expect(s.requests == 2 and not(s.persistedAttempted) and safety)
  run resumeWhilePromptTest = init.then(enable).then(prompt).then(resumeDuringPrompt)
    .then(result(true)).expect(s.status == "ready" and safety)
  run failedProgressTest = init.then(persistNext).then(persistFailed).then(restart)
    .expect(s.step == 1 and safety)
  run upgradeTest = init.then(oldCompletedInstall).then(restart).expect(s.completed and safety)
}
