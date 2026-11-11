/// The single pending saved-copy request. Admission is a compare-and-swap from empty, so a second
/// request never replaces an unresolved one, and acknowledgement removes exactly the request
/// the caller holds. The browser stores a fresh revision with each request; Android stores the
/// token alone.
module MediaCopyIntent {
  /// `id` is the admission that wrote the request. Storage keeps only the token and, in the
  /// browser, the revision; the id is never compared.
  type Intent = { token: int, revision: int, id: int }
  type State = {
    browser: bool, slot: Intent, serial: int, held: int -> Intent,
    admitted: int, acknowledged: int, refusedAdmits: int, refusedAcks: int, restarts: int,
    clearedId: int, heldIdAtClear: int
  }
  var s: State
  pure val none: Intent = { token: 0, revision: 0, id: 0 }
  pure val Callers = Set(1, 2)
  pure def same(a: Intent, b: Intent): bool = a.token == b.token and a.revision == b.revision
  action initFor(browser: bool): bool = s' = {
    browser: browser, slot: none, serial: 0, held: Callers.mapBy(_ => none),
    admitted: 0, acknowledged: 0, refusedAdmits: 0, refusedAcks: 0, restarts: 0,
    clearedId: 0, heldIdAtClear: 0
  }
  action init = {
    nondet browser = Bool.oneOf()
    initFor(browser)
  }
  /// Admit a copy request for a token. An occupied slot refuses and keeps its request.
  action admit(caller: int, token: int): bool = all {
    Callers.contains(caller), Set(1, 2).contains(token), s.held.get(caller) == none, s.serial < 4,
    if (s.slot != none) s' = { ...s, refusedAdmits: if (s.refusedAdmits < 2) s.refusedAdmits + 1 else 2 }
    else {
      val request = { token: token, revision: if (s.browser) s.serial + 1 else 0, id: s.serial + 1 }
      s' = { ...s, slot: request, serial: s.serial + 1, held: s.held.set(caller, request), admitted: s.admitted + 1 }
    }
  }
  /// Acknowledge the request this caller holds. A slot that stores anything else is left alone.
  action acknowledge(caller: int): bool = all {
    Callers.contains(caller), s.held.get(caller) != none,
    if (s.slot != none and same(s.slot, s.held.get(caller)))
      s' = { ...s, slot: none, held: s.held.set(caller, none), acknowledged: s.acknowledged + 1,
        clearedId: s.slot.id, heldIdAtClear: s.held.get(caller).id }
    else s' = { ...s, held: s.held.set(caller, none), refusedAcks: if (s.refusedAcks < 2) s.refusedAcks + 1 else 2 }
  }
  /// The stored request can be read back by any flow, after a restart or beside its admitter, and
  /// its outcome checked before anything new is admitted.
  action restart = all { s.restarts < 2,
    s' = { ...s, restarts: s.restarts + 1, held: Callers.mapBy(_ => none) } }
  action recover(caller: int): bool = all { Callers.contains(caller), s.slot != none, s.held.get(caller) == none,
    s' = { ...s, held: s.held.set(caller, s.slot) } }
  action step = {
    nondet caller = Callers.oneOf()
    nondet token = Set(1, 2).oneOf()
    any { admit(caller, token), acknowledge(caller), restart, recover(caller), s' = s }
  }
  val SinglePendingRequest = s.admitted - s.acknowledged == (if (s.slot == none) 0 else 1)
  /// With a stored revision, an acknowledgement removes only the admission its caller read.
  val BrowserClearsExactAdmission = s.browser implies s.clearedId == s.heldIdAtClear
  val BrowserRevisionIdentifiesAdmission = s.browser implies s.slot.revision == s.slot.id
  val AndroidStoresTokenOnly = not(s.browser) implies s.slot.revision == 0
  val safety = SinglePendingRequest and BrowserClearsExactAdmission and BrowserRevisionIdentifiesAdmission
    and AndroidStoresTokenOnly
  val SecondRequestRefusedWitness = s.refusedAdmits > 0 and s.slot != none
  val RecoveredAfterRestartWitness = s.restarts > 0 and s.slot != none and Callers.exists(caller => s.held.get(caller) == s.slot)
  val StaleAcknowledgeRefusedWitness = s.browser and s.refusedAcks > 0 and s.slot != none
  /// Android identifies a request by its token alone: a token admitted again is the same request
  /// to a caller that read the earlier admission.
  val AndroidReadmittedTokenClearedWitness = not(s.browser) and s.clearedId != s.heldIdAtClear
  run unresolvedRequestBlocksNextTest = initFor(true).then(admit(1, 1)).then(admit(2, 2))
    .expect(s.slot.token == 1 and s.refusedAdmits == 1 and s.held.get(2) == none and safety)
    .then(acknowledge(1)).then(admit(2, 2)).expect(s.slot.token == 2 and s.admitted == 2 and safety)
  run restartRecoversPendingRequestTest = initFor(false).then(admit(1, 1)).then(restart).then(admit(2, 2))
    .expect(s.slot.token == 1 and s.refusedAdmits == 1 and safety).then(recover(2)).then(acknowledge(2))
    .expect(s.slot == none and s.acknowledged == 1 and safety)
  /// A caller still holding a request that was already settled and replaced cannot clear the new one.
  run staleHolderCannotClearNewRequestTest = initFor(true).then(admit(1, 1)).then(recover(2))
    .then(acknowledge(2)).then(admit(2, 1)).then(acknowledge(1))
    .expect(s.slot.token == 1 and s.slot.revision == 2 and s.refusedAcks == 1 and s.acknowledged == 1 and safety)
  run androidReadmittedTokenIsSameRequestTest = initFor(false).then(admit(1, 1)).then(recover(2))
    .then(acknowledge(2)).then(admit(2, 1)).then(acknowledge(1))
    .expect(s.slot == none and s.acknowledged == 2 and s.clearedId == 2 and s.heldIdAtClear == 1 and safety)
}
