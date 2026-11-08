module GoogleAccessPublication {
  pure val Requests = Set(1, 2)
  pure val Fields = Set("gmail", "calendar")
  pure val Replies = Set("ok", "failed", "lost")
  type Access = {gmail: bool, calendar: bool}
  type Choice = {field: str, value: bool, expected: int}
  type State = {saved: Access, host: Access, previous: Access, revision: int, calls: int,
    queue: List[int], owner: int, phase: str, choices: int -> Choice, results: int -> str}
  pure val initialAccess: Access = {gmail: false, calendar: true}
  pure val noChoice: Choice = {field: "gmail", value: false, expected: 0}
  var state: State
  action init = state' = {saved: initialAccess, host: initialAccess, previous: initialAccess,
    revision: 1, calls: 0, queue: [], owner: 0, phase: "idle",
    choices: Requests.mapBy(_ => noChoice), results: Requests.mapBy(_ => "idle")}

  pure def apply(access: Access, choice: Choice): Access =
    if (choice.field == "gmail") {...access, gmail: choice.value} else {...access, calendar: choice.value}

  action submit(id: int, kind: str, value: bool, guarded: bool): bool = all {
    state.results.get(id) == "idle",
    state' = {...state, queue: state.queue.append(id),
      choices: state.choices.set(id, {field: kind, value: value, expected: if (guarded) state.revision else 0}),
      results: state.results.set(id, "pending")}
  }

  action acquire = all {
    state.phase == "idle", state.queue.length() > 0,
    val id = state.queue.nth(0)
    val choice = state.choices.get(id)
    val pending = state.queue.slice(1, state.queue.length())
    if (choice.expected != 0 and choice.expected != state.revision)
      state' = {...state, queue: pending, results: state.results.set(id, "refused")}
    else state' = {...state, queue: pending, owner: id, phase: "primary", previous: state.saved,
      saved: apply(state.saved, choice), revision: state.revision + 1, calls: state.calls + 1}
  }

  action primary(reply: str, rollbackFails: bool): bool = all {
    state.phase == "primary",
    if (reply == "ok") state' = {...state, host: state.saved, phase: "idle", owner: 0,
      results: state.results.set(state.owner, "applied")}
    else state' = {...state, phase: "correction", host: if (reply == "lost") state.saved else state.host,
      saved: if (rollbackFails) state.saved else state.previous,
      revision: state.revision + (if (rollbackFails) 0 else 1), calls: state.calls + 1}
  }

  action correction(reply: str): bool = all {
    state.phase == "correction",
    state' = {...state, phase: "idle", owner: 0, host: if (reply == "failed") state.host else state.saved,
      results: state.results.set(state.owner, "failed")}
  }

  action step = any {
    nondet id = Requests.oneOf()
    nondet kind = Fields.oneOf()
    nondet value = Set(false, true).oneOf()
    nondet guarded = Set(false, true).oneOf()
    submit(id, kind, value, guarded),
    acquire,
    nondet reply = Replies.oneOf()
    nondet rollbackFails = Set(false, true).oneOf()
    any {primary(reply, rollbackFails), correction(reply)},
    state' = state
  }
  val exactOwner = (state.phase == "idle") iff state.owner == 0
  val pendingCustody = Requests.forall(id =>
    (state.results.get(id) == "pending") iff (state.owner == id or state.queue.indices().exists(i => state.queue.nth(i) == id)))
  val safety = exactOwner and pendingCustody and state.phase.in(Set("idle", "primary", "correction"))
    and state.owner.in(0.to(2)) and state.revision.in(1.to(5)) and state.calls.in(0.to(4))
    and state.queue.length() <= 2

  run lostPublicationCorrectsBeforeSuccessorTest = init.then(submit(1, "gmail", true, false)).then(acquire)
    .then(submit(2, "calendar", false, false)).then(primary("lost", false))
    .expect(safety and state.saved == initialAccess and state.host.gmail)
    .then(correction("ok")).then(acquire).then(primary("ok", false))
    .expect(safety and state.host == state.saved and not(state.host.gmail) and not(state.host.calendar))
  run guardedStaleChoiceDoesNotReachHostTest = init.then(submit(1, "gmail", true, false))
    .then(submit(2, "calendar", false, true)).then(acquire).then(primary("ok", false)).then(acquire)
    .expect(safety and state.results.get(2) == "refused" and state.calls == 1)
  run rollbackFailurePublishesCanonicalChoiceTest = init.then(submit(1, "gmail", true, false)).then(acquire)
    .then(primary("failed", true)).then(correction("ok"))
    .expect(safety and state.host == state.saved and state.saved.gmail and state.results.get(1) == "failed")
  run twoFailedRepliesCanLeaveUncertaintyTest = init.then(submit(1, "gmail", true, false)).then(acquire)
    .then(primary("lost", false)).then(correction("failed"))
    .expect(safety and state.saved != state.host and state.results.get(1) == "failed")
}
