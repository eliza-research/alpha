/// One current Calendar mutation ledger entry and the linked-sync consent boundary.
/// Queued/checking/dispatching/done name abstract phases, not persisted source enum strings.
module CalendarSync {
  type Calendar = {
    owner: int, epoch: int, operationOwner: int, requestEpoch: int,
    phase: str, kind: str, writable: bool, consent: bool, online: bool,
    undoOpen: bool, clockKnown: bool, holder: int, instance: int,
    baseRevision: int, remoteRevision: int, dispatchRevision: int,
    checked: bool, retryAuthorized: bool, sends: int, applied: bool,
    resultVisible: bool, linked: bool, localRevision: int, consentReview: bool,
    consentOwner: int, consentRevision: int
  }
  var s: Calendar
  action init = s' = { owner: 1, epoch: 0, operationOwner: 0, requestEpoch: 0,
    phase: "empty", kind: "create", writable: true, consent: false, online: true,
    undoOpen: false, clockKnown: true, holder: 0, instance: 1,
    baseRevision: 0, remoteRevision: 0, dispatchRevision: 0,
    checked: false, retryAuthorized: true, sends: 0, applied: false,
    resultVisible: false, linked: false, localRevision: 0, consentReview: false,
    consentOwner: 0, consentRevision: 0 }
  action reviewConsent = s' = { ...s, consentReview: true,
    consentOwner: s.owner, consentRevision: s.localRevision }
  action localChange = all {
    s.localRevision < 2,
    s' = { ...s, localRevision: s.localRevision + 1, consentReview: false }
  }
  action setConsent(value: bool): bool = all {
    not(value) or (s.consentReview and s.consentOwner == s.owner and s.consentRevision == s.localRevision),
    s' = { ...s, consent: value, consentReview: false }
  }
  action enqueue(kind: str, linked: bool): bool = all {
    s.phase == "empty", s.writable, kind.in(Set("create", "update", "delete")),
    not(linked) or s.consent,
    s' = { ...s, phase: "queued", kind: kind, operationOwner: s.owner,
      undoOpen: kind == "delete", clockKnown: true, baseRevision: s.remoteRevision,
      applied: false, retryAuthorized: true, resultVisible: true, linked: linked, sends: 0 }
  }
  action undo = all {
    s.phase.in(Set("queued", "paused", "conflict", "failed")), s.operationOwner == s.owner,
    s.kind != "delete" or s.undoOpen or s.phase == "paused", s.operationOwner == s.owner,
    s' = { ...s, phase: "empty", undoOpen: false, resultVisible: false }
  }
  action deadline = all { s.undoOpen, s' = { ...s, undoOpen: false } }
  action rebootClock = all {
    s.phase == "queued", s.kind == "delete", s.undoOpen,
    s' = { ...s, phase: "paused", clockKnown: false }
  }
  action resolvePaused(send: bool): bool = all {
    s.phase == "paused", s.operationOwner == s.owner,
    s' = { ...s, phase: if (send) "queued" else "empty",
      clockKnown: true, undoOpen: false, resultVisible: send }
  }
  action claim = all {
    s.phase == "queued", s.online, s.writable, s.retryAuthorized,
    s.operationOwner == s.owner, not(s.linked) or s.consent,
    not(s.undoOpen), s.clockKnown,
    s' = { ...s, phase: "checking", holder: s.instance,
      requestEpoch: s.epoch, checked: s.kind == "create" }
  }
  action checkRevision = all {
    s.phase == "checking", s.operationOwner == s.owner, s.requestEpoch == s.epoch,
    s' = { ...s, checked: s.kind == "create" or s.baseRevision == s.remoteRevision,
      phase: if (s.kind != "create" and s.baseRevision != s.remoteRevision) "conflict" else "checking",
      holder: if (s.kind != "create" and s.baseRevision != s.remoteRevision) 0 else s.holder }
  }
  /// Native/Cloud preconditions still apply after the durable claim.
  action dispatch = all {
    s.phase == "checking", s.checked, s.online, s.writable,
    s.operationOwner == s.owner, s.requestEpoch == s.epoch,
    not(s.linked) or s.consent, s.sends < 2,
    s' = { ...s, phase: "dispatching", sends: s.sends + 1,
      dispatchRevision: s.remoteRevision, retryAuthorized: false }
  }
  action completed = all {
    s.phase == "dispatching", s.requestEpoch == s.epoch, s.operationOwner == s.owner,
    s' = { ...s, phase: "done", holder: 0, applied: true, resultVisible: true }
  }
  action lostReply = all {
    s.phase == "dispatching",
    s' = { ...s, phase: "uncertain",
      holder: 0, retryAuthorized: false, checked: false }
  }
  /// Only explicit provider non-acceptance or a read-only preflight failure is retryable.
  action providerFailure = all {
    s.phase.in(Set("checking", "dispatching")),
    s' = { ...s, phase: "failed", holder: 0, checked: false, retryAuthorized: true }
  }
  action retryKnownFailure = all {
    s.phase == "failed", s.retryAuthorized, s.operationOwner == s.owner,
    s' = { ...s, phase: "queued", checked: false }
  }
  /// `found` means an exact source-bound receipt/readback, never existence alone.
  action findCreated(found: bool): bool = all {
    s.phase == "uncertain", s.online, s.operationOwner == s.owner,
    s' = { ...s, phase: if (found) "done" else "uncertain", applied: found }
  }
  /// Hiding an ambiguous operation retains its durable uncertainty. A retry needs
  /// a provider-confirmed non-acceptance, which is a different transition.
  action resolveUncertain(send: bool): bool = all {
    s.phase == "uncertain", s.operationOwner == s.owner, not(send),
    s' = { ...s, consent: false, resultVisible: false }
  }
  action resolveConflict(mine: bool): bool = all {
    s.phase == "conflict", s.operationOwner == s.owner,
    s' = { ...s, phase: if (mine) "queued" else "empty",
      baseRevision: s.remoteRevision, retryAuthorized: mine, resultVisible: mine }
  }
  action remoteEdit = all {
    s.remoteRevision < 2, s.phase != "dispatching",
    s' = { ...s, remoteRevision: s.remoteRevision + 1, checked: false }
  }
  action network = s' = { ...s, online: not(s.online) }
  action revoke = s' = { ...s, writable: false }
  /// A fresh current-account permission read changes admission, not the durable operation.
  action restorePermission = s' = { ...s, writable: true }
  action restart = all {
    s.instance < 2,
    s' = { ...s, instance: s.instance + 1, holder: 0, checked: false,
      phase: if (s.phase == "dispatching") "uncertain"
        else if (s.phase.in(Set("checking", "dispatching"))) "queued" else s.phase,
      retryAuthorized: if (s.phase == "dispatching") false else s.retryAuthorized }
  }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      resultVisible: false, checked: false, consent: false, consentReview: false }
  }
  action step = any {
    reviewConsent, localChange, setConsent(true), setConsent(false), enqueue("create", false), enqueue("update", false),
    enqueue("delete", false), enqueue("update", true), undo, deadline,
    rebootClock, resolvePaused(true), resolvePaused(false), claim, checkRevision, dispatch,
    completed, lostReply, providerFailure, retryKnownFailure, findCreated(false), findCreated(true),
    resolveUncertain(false), resolveUncertain(true), resolveConflict(false), resolveConflict(true),
    remoteEdit, network, revoke, restorePermission, restart, switchOwner, s' = s
  }
  val NoAutomaticUnknownWrite = s.phase == "uncertain" implies not(s.retryAuthorized)
  val UndoBeforeDispatch = s.phase == "dispatching" implies not(s.undoOpen)
  val PausedNeedsDecision = s.phase == "paused" implies not(s.clockKnown)
  val DurableClaim = s.phase == "dispatching" implies s.holder != 0
  val VisibleOwnerBound = s.resultVisible implies s.operationOwner == s.owner
  val TypeOK = s.phase.in(Set("empty", "queued", "paused", "checking", "dispatching", "uncertain", "conflict", "failed", "done")) and s.kind.in(Set("create", "update", "delete")) and s.epoch.in(0.to(2)) and s.sends.in(0.to(2)) and s.instance.in(1.to(2)) and s.remoteRevision.in(0.to(2))
  val safety = TypeOK and NoAutomaticUnknownWrite and UndoBeforeDispatch and PausedNeedsDecision and DurableClaim and VisibleOwnerBound
  run reviewedSyncConsentTest = init.then(reviewConsent).then(localChange)
    .expect(not(s.consentReview) and not(s.consent))
    .then(reviewConsent).then(setConsent(true)).then(enqueue("update", true))
    .then(claim).then(checkRevision).then(setConsent(false))
    .expect(not(s.consent) and s.sends == 0 and safety)
  run undoDeleteTest = init.then(enqueue("delete", false)).then(undo)
    .expect(s.phase == "empty" and s.sends == 0 and safety)
  run conflictTest = init.then(enqueue("update", false)).then(remoteEdit).then(claim)
    .then(checkRevision).expect(s.phase == "conflict")
    .then(resolveConflict(true)).then(claim).then(checkRevision).then(dispatch)
    .then(completed).expect(s.applied and safety)
  run uncertainCreateTest = init.then(enqueue("create", false)).then(claim).then(dispatch)
    .then(lostReply).then(findCreated(false)).expect(s.phase == "uncertain" and s.sends == 1)
    .then(resolveUncertain(false)).expect(s.phase == "uncertain" and not(s.resultVisible) and safety)
  run restartDeleteTest = init.then(enqueue("delete", false)).then(rebootClock)
    .expect(s.phase == "paused").then(resolvePaused(true)).then(claim)
    .then(checkRevision).then(dispatch).then(restart).expect(s.phase == "uncertain" and not(s.retryAuthorized) and safety)
  run unknownUpdateTest = init.then(enqueue("update", false)).then(claim).then(checkRevision)
    .then(dispatch).then(lostReply).then(restart)
    .expect(s.phase == "uncertain" and not(s.retryAuthorized) and s.sends == 1 and safety)
  run knownFailureRetryTest = init.then(enqueue("update", false)).then(claim).then(checkRevision)
    .then(dispatch).then(providerFailure).then(retryKnownFailure).then(claim).then(checkRevision)
    .then(dispatch).then(completed).expect(s.phase == "done" and s.sends == 2 and safety)
  run permissionRestorationTest = init.then(enqueue("update", false)).then(revoke)
    .expect(s.phase == "queued" and not(s.writable) and s.sends == 0)
    .then(restorePermission).then(claim).then(checkRevision).then(dispatch).then(completed)
    .expect(s.applied and s.sends == 1 and safety)
  run restoredPermissionKeepsUnknownTest = init.then(enqueue("create", false)).then(claim).then(dispatch)
    .then(lostReply).then(revoke).then(restorePermission)
    .expect(s.phase == "uncertain" and not(s.retryAuthorized) and s.sends == 1 and safety)
  run restoredPermissionKeepsOwnerFenceTest = init.then(enqueue("update", false)).then(claim)
    .then(revoke).then(switchOwner).then(restorePermission)
    .expect(s.operationOwner != s.owner and s.requestEpoch != s.epoch and s.sends == 0 and safety)
  run retiredOwnerTest = init.then(enqueue("update", false)).then(claim).then(switchOwner)
    .expect(not(s.resultVisible) and safety)
}
