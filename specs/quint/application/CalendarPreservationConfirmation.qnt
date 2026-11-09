// Exact mounted review admission and owner-keyed saved Calendar retention.
module CalendarPreservationConfirmation {
  type Attempt = {owner: int, session: int, review: int, stage: str, result: str, aborted: bool, expected: int}
  type Marker = {review: int, receipt: int}
  type State = {owner: int, session: int, view: bool, hidden: bool, inventory: int, review: int,
    active: int, lastAttempt: int, attempts: int -> Attempt, writes: Set[int], committed: Set[int],
    markers: int -> Marker, published: List[int], notices: List[str]}
  var s: State

  pure val Owners = Set(1, 2)
  pure val Ids = 1.to(4)
  pure val Errors = Set("review-changed", "storage-error")
  action init = s' = {owner: 1, session: 1, view: false, hidden: false, inventory: 1, review: 1,
    active: 0, lastAttempt: 0, attempts: Map(), writes: Set(), committed: Set(), markers: Map(),
    published: List(), notices: List()}

  pure def approved(value: State, owner: int, review: int): bool =
    value.markers.keys().contains(owner) and value.markers.get(owner).review == review
  pure def receipt(value: State, owner: int): int =
    if (value.markers.keys().contains(owner)) value.markers.get(owner).receipt else 0
  pure def displayed(value: State): int =
    if (approved(value, value.owner, value.inventory)) 0 else value.inventory
  pure def retire(value: State): State =
    if (value.active == 0) value
    else {...value, active: 0, attempts: value.attempts.set(value.active, {...value.attempts.get(value.active), aborted: true})}

  action openReview = all {not(s.view), s' = {...s, view: true}}
  action leaveReview = all {s.view, s' = retire({...s, view: false})}
  action hide = all {not(s.hidden), s' = retire({...s, hidden: true})}
  action show = all {s.hidden, s' = {...s, hidden: false, review: displayed(s)}}
  action pageHide = all {s.active != 0, s' = retire(s)}
  action replacePort(owner: int): bool = all {
    Owners.contains(owner), s.session < 4,
    val replacement = retire({...s, owner: owner, session: s.session + 1})
    s' = {...replacement, review: displayed(replacement)},
  }
  action changeInventory = all {s.inventory == 1, s' = {...s, inventory: 2}}
  action reload = s' = retire({...s, review: displayed(s)})

  val reviewVisible = s.view and s.review != 0
  action begin = all {
    reviewVisible, not(s.hidden), s.active == 0, s.lastAttempt < 4,
    val id = s.lastAttempt + 1
    s' = {...s, active: id, lastAttempt: id, attempts: s.attempts.put(id,
      {owner: s.owner, session: s.session, review: s.review, stage: "capture", result: "", aborted: false, expected: 0})},
  }
  action captureValidated(id: int): bool = all {
    s.active == id, s.attempts.keys().contains(id),
    val task = s.attempts.get(id)
    all {
      task.stage == "capture", task.review == s.inventory,
      s' = {...s, attempts: s.attempts.set(id, {...task, stage: "validated"})},
    },
  }
  action markerRead(id: int): bool = all {
    s.active == id, s.attempts.keys().contains(id),
    val task = s.attempts.get(id)
    all {
      task.stage == "validated",
      s' = {...s, attempts: s.attempts.set(id, {...task, stage: "marker-read"})},
    },
  }
  action markerReceipt(id: int): bool = all {
    s.active == id, s.attempts.keys().contains(id),
    val task = s.attempts.get(id)
    all {
      task.stage == "marker-read",
      s' = {...s, attempts: s.attempts.set(id, {...task, stage: "marker-ready", expected: receipt(s, task.owner)})},
    },
  }
  action dispatch(id: int): bool = all {
    s.active == id, s.attempts.keys().contains(id),
    val task = s.attempts.get(id)
    all {
      task.stage == "marker-ready", task.expected == 0 or s.attempts.get(task.expected).review != task.review,
      s' = {...s, writes: s.writes.union(Set(id)), attempts: s.attempts.set(id, {...task, stage: "marker-dispatch"})},
    },
  }
  action commit(id: int): bool = all {
    s.writes.contains(id), not(s.committed.contains(id)),
    val task = s.attempts.get(id)
    all {
      task.result == "", receipt(s, task.owner) == task.expected,
      s' = {...s, committed: s.committed.union(Set(id)), markers: s.markers.put(task.owner, {review: task.review, receipt: id})},
    },
  }
  action markerReadback(id: int): bool = all {
    s.active == id, s.attempts.keys().contains(id),
    val task = s.attempts.get(id)
    all {
      (task.stage == "marker-ready" and task.expected != 0 and s.attempts.get(task.expected).review == task.review)
        or (task.stage == "marker-dispatch" and s.committed.contains(id)),
      s' = {...s, attempts: s.attempts.set(id, {...task, stage: "marker-readback"})},
    },
  }
  action finish(id: int, result: str, notice: str): bool = all {
    s.attempts.keys().contains(id),
    val task = s.attempts.get(id)
    all {
      task.result == "",
      if (task.aborted) result.in(Set("aborted", "rejected")) and notice == ""
      else if (result == "success") task.stage == "marker-readback" and approved(s, task.owner, task.review) and notice == ""
      else result == "rejected" and Errors.contains(notice),
      val done = {...s, active: if (s.active == id) 0 else s.active,
        attempts: s.attempts.set(id, {...task, result: result})}
      s' = if (s.active != id) done
        else if (result == "success") {...done, published: done.published.append(id), review: displayed(done)}
        else {...done, notices: done.notices.append(notice)},
    },
  }

  action step = any {
    openReview, leaveReview, hide, show, pageHide, changeInventory, reload, begin,
    {nondet owner = Owners.oneOf(); replacePort(owner)},
    {nondet id = Ids.oneOf(); captureValidated(id)},
    {nondet id = Ids.oneOf(); markerRead(id)},
    {nondet id = Ids.oneOf(); markerReceipt(id)},
    {nondet id = Ids.oneOf(); dispatch(id)},
    {nondet id = Ids.oneOf(); commit(id)},
    {nondet id = Ids.oneOf(); markerReadback(id)},
    {nondet id = Ids.oneOf(); nondet result = Set("success", "aborted", "rejected").oneOf();
      nondet notice = Errors.union(Set("")).oneOf(); finish(id, result, notice)},
    s' = s,
  }

  val ActiveReviewOwnsVisit = s.active == 0 or {
    val task = s.attempts.get(s.active)
    s.view and not(s.hidden) and s.review != 0 and task.owner == s.owner and task.session == s.session
      and task.review == s.review and not(task.aborted) and task.result == ""
  }
  val MarkerHasDispatch = s.committed.subseteq(s.writes)
    and s.markers.keys().forall(owner => s.committed.exists(id => {
      val task = s.attempts.get(id)
      task.owner == owner and task.review == s.markers.get(owner).review and id == s.markers.get(owner).receipt
    }))
  val PublishedHasCurrentReadback = s.published.indices().forall(index => {
    val task = s.attempts.get(s.published.nth(index))
    task.stage == "marker-readback" and task.result == "success" and not(task.aborted)
  })
  val safety = ActiveReviewOwnsVisit and MarkerHasDispatch and PublishedHasCurrentReadback

  run sameOwnerReplacementBeforeDispatchTest = init.then(openReview).then(begin).then(captureValidated(1)).then(markerRead(1))
    .then(replacePort(1)).then(finish(1, "aborted", ""))
    .expect(s.writes == Set() and s.notices == List() and s.review == 1 and safety)
  run reentryAndOldFinallyTest = init.then(openReview).then(begin).then(captureValidated(1)).then(markerRead(1)).then(leaveReview)
    .then(openReview).then(begin).then(finish(1, "aborted", ""))
    .expect(s.active == 2 and s.writes == Set() and safety)
  run committedMarkerSurvivesRetirementTest = init.then(openReview).then(begin).then(captureValidated(1)).then(markerRead(1))
    .then(markerReceipt(1)).then(dispatch(1)).then(replacePort(2)).then(commit(1)).then(finish(1, "aborted", ""))
    .expect(s.markers == Map(1 -> {review: 1, receipt: 1}) and s.published == List() and s.review == 1 and safety)
  run currentExactMarkerPublishesTest = init.then(openReview).then(begin).then(captureValidated(1)).then(markerRead(1))
    .then(markerReceipt(1)).then(dispatch(1)).then(commit(1)).then(markerReadback(1)).then(finish(1, "success", ""))
    .expect(s.review == 0 and s.markers == Map(1 -> {review: 1, receipt: 1}) and s.published == List(1) and safety)
  run changedInventoryRequiresFreshReviewTest = init.then(openReview).then(begin).then(changeInventory)
    .then(finish(1, "rejected", "review-changed")).then(reload)
    .expect(s.review == 2 and s.markers == Map() and s.notices == List("review-changed") and safety)
  run pageHideRetiresHeldApprovalTest = init.then(openReview).then(begin).then(captureValidated(1)).then(markerRead(1))
    .then(pageHide).then(finish(1, "aborted", ""))
    .expect(s.active == 0 and s.writes == Set() and s.published == List() and safety)
}
