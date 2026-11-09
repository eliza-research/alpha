// Browser recovery binds the installed workflow-request document to one live review.
module WorkflowRequestRecoveryAdmission {
  type State = {allowed: bool, seen: int, owner: int, reading: Set[int], loading: Set[int],
    offered: Set[int], closed: Set[int], captured: Set[int], saving: Set[int], published: Set[int], reported: Set[int]}
  var s: State
  action init = s' = {allowed: true, seen: 0, owner: 0, reading: Set(), loading: Set(),
    offered: Set(), closed: Set(), captured: Set(), saving: Set(), published: Set(), reported: Set()}

  pure def retire(state: State): State = {...state, owner: 0,
    closed: if (state.offered.contains(state.owner)) state.closed.union(Set(state.owner)) else state.closed}
  action block(value: bool): bool = s' = {...s, allowed: not(value)}
  action depart = s' = retire({...s, allowed: false})
  action open = all {
    s.seen < 3,
    val old = retire(s)
    val id = s.seen + 1
    s' = if (not(s.allowed)) s else {...old, seen: id, owner: id, reading: s.reading.union(Set(id))},
  }
  action read(id: int, ok: bool): bool = all {
    s.reading.contains(id),
    val base = {...s, reading: s.reading.exclude(Set(id))}
    s' = if (id != s.owner or not(s.allowed)) base
      else if (ok) {...base, loading: s.loading.union(Set(id))}
      else {...base, reported: s.reported.union(Set(id))},
  }
  action offer(id: int, ok: bool): bool = all {
    s.loading.contains(id),
    val base = {...s, loading: s.loading.exclude(Set(id))}
    s' = if (id != s.owner or not(s.allowed)) base
      else if (ok) {...base, offered: s.offered.union(Set(id))}
      else {...base, reported: s.reported.union(Set(id))},
  }
  val currentOffer = s.allowed and s.offered.contains(s.owner) and not(s.closed.contains(s.owner))
  action capture(id: int): bool = all {
    s.offered.contains(id),
    s' = if (id == s.owner and currentOffer) {...s, captured: s.captured.union(Set(id))} else s,
  }
  action reset(id: int): bool = all {
    s.offered.contains(id),
    s' = if (id == s.owner and currentOffer) {...s, saving: s.saving.union(Set(id))} else s,
  }
  action saved(id: int): bool = all {
    s.saving.contains(id),
    val base = {...s, saving: s.saving.exclude(Set(id))}
    s' = if (id == s.owner and currentOffer) {...base, published: s.published.union(Set(id))} else base,
  }
  action step = any {
    block(true), block(false), depart, open,
    { nondet id = Set(1, 2, 3).oneOf()
      nondet ok = Set(true, false).oneOf()
      any { read(id, ok), offer(id, ok), capture(id), reset(id), saved(id) } },
    s' = s,
  }
  val ClosedReviewWasOffered = s.closed.subseteq(s.offered)
  val ActiveReviewIsNotClosed = not(s.closed.contains(s.owner))
  val AllCallbacksBelongToAnOfferedReview = s.captured.union(s.saving).union(s.published).subseteq(s.offered)
  val RetiredOffersAreClosed = s.offered.exclude(Set(s.owner)) == s.closed
  val safety = ClosedReviewWasOffered and ActiveReviewIsNotClosed and AllCallbacksBelongToAnOfferedReview and RetiredOffersAreClosed

  run exactReviewCanCaptureAndResetTest = init.then(open).then(read(1, true)).then(offer(1, true))
    .then(capture(1)).then(reset(1)).then(saved(1)).expect(s.captured == Set(1) and s.published == Set(1) and safety)
  run leaveDuringModuleLoadKeepsOldReviewClosedTest = init.then(open).then(read(1, true)).then(depart)
    .then(block(false)).then(open).then(offer(1, true)).then(read(2, true)).then(offer(2, true))
    .expect(s.offered == Set(2) and s.reported == Set() and safety)
  run replacementRevokesOldCallbacksTest = init.then(open).then(read(1, true)).then(offer(1, true))
    .then(open).then(capture(1)).then(reset(1)).then(read(2, true)).then(offer(2, true)).then(capture(2))
    .expect(s.closed == Set(1) and s.captured == Set(2) and s.saving == Set() and safety)
  run departureWhileSavingKeepsCompletionSilentTest = init.then(open).then(read(1, true)).then(offer(1, true))
    .then(reset(1)).then(depart).then(saved(1)).expect(s.closed == Set(1) and s.published == Set() and safety)
  run reportOnlyCurrentFailureTest = init.then(open).then(open).then(read(1, false)).then(read(2, true)).then(offer(2, false))
    .expect(s.reported == Set(2) and s.offered == Set() and safety)
}
