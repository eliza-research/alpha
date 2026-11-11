/// The assistant's reviewed change to the device photo library: one pending review over the
/// visible Photos grid, opened only after the provider confirms the revisions the assistant
/// read, confirmed by the owner, re-validated, dispatched once and checked again by Android.
module PhotoLibraryAgentReview {
  type Request = { phase: str, token: int, revision: int }
  type Confirm = { review: int, pending: bool }
  type State = {
    visible: bool, hostReview: bool, epoch: int, disposed: bool, revision: int,
    requests: int -> Request, review: int, reviewRevision: int, reviewEpoch: int, serial: int,
    confirms: int -> Confirm, acting: int, actingRevision: int,
    dispatched: List[int], applied: List[int],
    refusedBusy: int, refusedLeft: int, staleClosed: int, androidStale: int
  }
  var s: State
  pure val Slots = Set(1, 2)
  pure val idle: Request = { phase: "none", token: 0, revision: 0 }
  pure val unpressed: Confirm = { review: 0, pending: false }
  pure def bump(n: int): int = if (n < 2) n + 1 else 2
  action init = s' = {
    visible: true, hostReview: false, epoch: 0, disposed: false, revision: 0,
    requests: Slots.mapBy(_ => idle), review: 0, reviewRevision: 0, reviewEpoch: 0, serial: 0,
    confirms: Slots.mapBy(_ => unpressed), acting: 0, actingRevision: 0,
    dispatched: [], applied: [], refusedBusy: 0, refusedLeft: 0, staleClosed: 0, androidStale: 0
  }
  val reviewBusy = s.acting != 0 or s.review != 0 or s.hostReview
  /// An approved change request names the revision the assistant read. It is admitted only over
  /// the visible grid with no review open, then the provider is asked whether it is current.
  action request(slot: int, read: int): bool = all {
    Slots.contains(slot), s.requests.get(slot).phase == "none", not(s.disposed), s.visible, not(reviewBusy),
    read <= s.revision, read >= 0,
    s' = { ...s, requests: s.requests.set(slot, { phase: "validating", token: s.epoch, revision: read }) }
  }
  /// The provider answers. Photos may have been left or another review opened meanwhile.
  action validated(slot: int): bool = all {
    Slots.contains(slot), s.requests.get(slot).phase == "validating",
    val asked = s.requests.get(slot)
    val settled = { ...s, requests: s.requests.set(slot, idle) }
    s' = if (asked.revision != s.revision) settled
      else if (asked.token != s.epoch or s.disposed) { ...settled, refusedLeft: bump(s.refusedLeft) }
      else if (reviewBusy or not(s.visible)) { ...settled, refusedBusy: bump(s.refusedBusy) }
      else { ...settled, review: s.serial + 1, serial: s.serial + 1, reviewRevision: asked.revision, reviewEpoch: s.epoch }
  }
  /// The owner presses Confirm; a second press can arrive before the first re-validation returns.
  action confirmPress(slot: int): bool = all {
    Slots.contains(slot), not(s.confirms.get(slot).pending), s.review != 0, s.acting == 0,
    s' = { ...s, confirms: s.confirms.set(slot, { review: s.review, pending: true }) }
  }
  /// Re-validation returns. Only the press that still finds its own review open goes on: a
  /// changed item closes the review, a current one is handed to Android exactly once.
  action confirmValidated(slot: int): bool = all {
    Slots.contains(slot), s.confirms.get(slot).pending,
    val pressed = s.confirms.get(slot)
    val settled = { ...s, confirms: s.confirms.set(slot, unpressed) }
    s' = if (s.review != pressed.review) settled
      else if (s.reviewRevision != s.revision) { ...settled, review: 0, staleClosed: bump(s.staleClosed) }
      else { ...settled, review: 0, acting: pressed.review, actingRevision: s.reviewRevision,
        dispatched: s.dispatched.append(pressed.review) }
  }
  /// Android's own dialog settles. It applies the change only at the reviewed revision.
  action androidSettles(approved: bool): bool = all { s.acting != 0,
    s' = if (approved and s.actingRevision == s.revision) { ...s, acting: 0, applied: s.applied.append(s.acting) }
      else { ...s, acting: 0, androidStale: if (approved) bump(s.androidStale) else s.androidStale }
  }
  action cancel = all { s.review != 0, s' = { ...s, review: 0 } }
  /// Leaving Photos drops the open review and retires every request still being validated.
  action leave = all { s.epoch < 3, s' = { ...s, review: 0, epoch: s.epoch + 1, visible: false, hostReview: false } }
  action show = all { not(s.disposed), not(s.visible), s' = { ...s, visible: true } }
  action hostReviewOpens = all { s.visible, not(reviewBusy), s' = { ...s, hostReview: true } }
  action hostReviewCloses = all { s.hostReview, s' = { ...s, hostReview: false } }
  action sourceChanges = all { s.revision < 2, s' = { ...s, revision: s.revision + 1 } }
  action dispose = all { not(s.disposed), s.epoch < 3,
    s' = { ...s, disposed: true, epoch: s.epoch + 1, visible: false, hostReview: false } }
  action step = {
    nondet slot = Slots.oneOf()
    nondet read = 0.to(2).oneOf()
    nondet approved = Bool.oneOf()
    any { request(slot, read), validated(slot), confirmPress(slot), confirmValidated(slot), androidSettles(approved),
      cancel, leave, show, hostReviewOpens, hostReviewCloses, sourceChanges, dispose, s' = s }
  }
  pure def unique(list: List[int]): bool =
    list.indices().forall(i => list.indices().forall(j => i == j or list.nth(i) != list.nth(j)))
  val SinglePendingReview = not(s.review != 0 and s.acting != 0) and not(s.review != 0 and s.hostReview)
  val OpenReviewBelongsToCurrentVisit = (s.review != 0 and not(s.disposed)) implies (s.reviewEpoch == s.epoch and s.visible)
  val EachReviewDispatchedOnce = unique(s.dispatched)
  val AppliedOnceAfterDispatch = unique(s.applied)
    and s.applied.indices().forall(i => s.dispatched.select(id => id == s.applied.nth(i)).length() == 1)
  val ActingReviewWasDispatched = s.acting != 0 implies s.dispatched.select(id => id == s.acting).length() == 1
  val safety = SinglePendingReview and OpenReviewBelongsToCurrentVisit and EachReviewDispatchedOnce
    and AppliedOnceAfterDispatch and ActingReviewWasDispatched
  val StaleReviewClosedWitness = s.staleClosed > 0 and s.dispatched.length() == 0
  val SecondRequestRefusedWitness = s.refusedBusy > 0 and s.review != 0
  val LeftDuringValidationWitness = s.refusedLeft > 0 and s.visible and not(s.disposed)
  val ChangedWhileAndroidAsksWitness = s.acting != 0 and s.actingRevision != s.revision
  val TwoReviewsAppliedWitness = s.applied.length() == 2
  run doubleConfirmDispatchesOnceTest = init.then(request(1, 0)).then(validated(1))
    .expect(s.review == 1 and safety).then(confirmPress(1)).then(confirmPress(2)).then(confirmValidated(1))
    .then(confirmValidated(2)).expect(s.dispatched == [1] and s.acting == 1 and s.review == 0 and safety)
    .then(androidSettles(true)).expect(s.applied == [1] and s.acting == 0 and safety)
  /// Photos is left and shown again while the provider checks: the answer opens no review.
  run leftDuringValidationOpensNothingTest = init.then(request(1, 0)).then(leave).then(show).then(validated(1))
    .expect(s.review == 0 and s.refusedLeft == 1 and safety)
  run concurrentRequestsOpenOneReviewTest = init.then(request(1, 0)).then(request(2, 0)).then(validated(1))
    .then(validated(2)).expect(s.review == 1 and s.serial == 1 and s.refusedBusy == 1 and safety)
  run changedItemClosesReviewTest = init.then(request(1, 0)).then(validated(1)).then(sourceChanges)
    .then(confirmPress(1)).then(confirmValidated(1))
    .expect(s.review == 0 and s.dispatched == [] and s.staleClosed == 1 and safety)
  run changedAfterConfirmRefusedByAndroidTest = init.then(request(1, 0)).then(validated(1)).then(confirmPress(1))
    .then(confirmValidated(1)).then(sourceChanges).then(androidSettles(true))
    .expect(s.dispatched == [1] and s.applied == [] and s.androidStale == 1 and safety)
  run staleReadOpensNoReviewTest = init.then(sourceChanges).then(request(1, 0)).then(validated(1))
    .expect(s.review == 0 and s.refusedBusy == 0 and safety)
}
