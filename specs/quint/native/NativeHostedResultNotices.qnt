// Actual HostedResultNotices ledger. The Android poster and retained inbox
// are input boundaries. Four fixed routes stand for exact identity tuples.
module NativeHostedResultNotices {
  type State = {
    owner: int,
    retained: int -> int,
    phases: int -> str,
    digests: int -> int,
    posted: Set[int],
    postCount: int -> int,
    pending: int,
    question: bool,
    token: int,
    issued: int,
    outcome: str
  }
  var s: State

  val routes = Set(1, 2, 3, 4)
  val owners = Set(0, 1, 2, 3, 4)
  pure def routeOwner(key: int): int = if (key == 4) 2 else 1
  pure def workflow(key: int): int = if (key == 3) 2 else 1
  def matches(key: int): bool = s.owner == -1 or s.owner == routeOwner(key)
  def hasRetained(key: int): bool = s.retained.get(key).in(Set(1, 2))
  val readKey = if (s.pending != 0 and matches(s.pending)) s.pending else 0
  val readToken = if (readKey == 0) 0 else s.token
  val readQuestion = readKey != 0 and s.question
  val readRetained = if (readKey == 0) false else hasRetained(readKey) and s.digests.get(readKey) == s.retained.get(readKey)

  action init = s' = {
    owner: -1,
    retained: routes.mapBy(_key => 0),
    phases: routes.mapBy(_key => "none"),
    digests: routes.mapBy(_key => 0),
    posted: Set(),
    postCount: routes.mapBy(_key => 0),
    pending: 0, question: false, token: 0, issued: 0, outcome: "none"
  }

  // Class 0 is absent, 1 is original, 2 is changed payload, 3 is route mismatch.
  action retain(key: int, result: int): bool = all {
    routes.contains(key),
    result.in(0.to(3)),
    s' = { ...s, retained: s.retained.set(key, result) }
  }

  def superseded(key: int): Set[int] = routes.filter(prior =>
    prior != key and prior != s.pending and s.phases.get(prior) == "posted" and
    routeOwner(prior) == routeOwner(key) and workflow(prior) == workflow(key))

  action publish(key: int, mode: str): bool = all {
    routes.contains(key),
    Set("complete", "permission", "security", "before-post", "after-post", "before-write", "repair-write").contains(mode),
    if (not(matches(key))) s' = { ...s, outcome: "owner-changed" }
    else if (not(hasRetained(key))) s' = { ...s, outcome: "rejected" }
    else if (s.phases.get(key) != "none") {
      if (s.digests.get(key) != s.retained.get(key)) s' = { ...s, outcome: "rejected" }
      else if (s.phases.get(key) == "dispatching") {
        val result = if (s.posted.contains(key)) "posted" else "uncertain"
        if (mode.in(Set("before-write", "repair-write"))) s' = { ...s, outcome: "rejected" }
        else s' = { ...s, phases: s.phases.set(key, result), outcome: result }
      } else s' = { ...s, outcome: s.phases.get(key) }
    } else all {
      mode != "repair-write",
      val removed = superseded(key)
      val phase = if (Set("permission", "security").contains(mode)) "denied"
        else if (mode == "complete") "posted" else "dispatching"
      val effect = Set("complete", "after-post").contains(mode)
      s' = if (mode == "before-write")
        { ...s, posted: s.posted.exclude(removed), outcome: "rejected" }
      else {
        ...s,
        phases: removed.fold(s.phases.set(key, phase), (rows, prior) => rows.set(prior, "superseded")),
        digests: s.digests.set(key, s.retained.get(key)),
        posted: s.posted.exclude(removed).union(if (effect) Set(key) else Set()),
        postCount: if (effect) s.postCount.set(key, s.postCount.get(key) + 1) else s.postCount,
        outcome: if (Set("before-post", "after-post").contains(mode)) "rejected" else phase
      }
    }
  }

  action expire(key: int): bool = all {
    routes.contains(key),
    s' = { ...s, posted: s.posted.exclude(Set(key)) }
  }

  action capture(key: int, question: bool, written: bool): bool = all {
    key.in(0.to(4)),
    val admitted = if (not(routes.contains(key))) false else matches(key) and s.phases.get(key) == "posted" and
      (key != s.pending or question != s.question)
    if (not(admitted)) s' = { ...s, outcome: "captured" }
    else all {
      s.issued < 4,
      s' = if (written) { ...s, pending: key, question: question, token: s.issued + 1,
        issued: s.issued + 1, outcome: "captured" }
      else { ...s, outcome: "rejected" }
    }
  }

  action release(token: int, written: bool): bool = all {
    token.in(0.to(4)),
    s' = if (s.pending != 0 and s.question and token == s.token and written)
      { ...s, pending: 0, question: false, token: 0, outcome: "released" }
    else { ...s, outcome: "rejected" }
  }

  // The exact source token check is independent of the owner check in peek.
  // A refused withdrawal can leave the prior pending token durable.
  action consume(token: int, mode: str): bool = all {
    token.in(0.to(4)),
    Set("complete", "ledger", "pending", "cancel").contains(mode),
    if (s.pending == 0 or token != s.token or mode == "ledger") s' = { ...s, outcome: "rejected" }
    else {
      val rows = s.phases.set(s.pending, "opened")
      s' = if (mode == "pending") { ...s, phases: rows, outcome: "rejected" }
      else {
        ...s, phases: rows, pending: 0, question: false, token: 0,
        posted: if (mode == "cancel") s.posted else s.posted.exclude(Set(s.pending)),
        outcome: if (mode == "cancel") "rejected" else "consumed"
      }
    }
  }

  action withdraw(owner: int, mode: str): bool = all {
    owners.contains(owner),
    Set("complete", "owner", "ledger", "cancel", "pending").contains(mode),
    val foreign = routes.filter(key => s.phases.get(key) != "none" and routeOwner(key) != owner)
    // Failed sweeps bound the failing prefix to one foreign row. Successful
    // sweeps cover every foreign row without relying on JSONObject key order.
    all {
      mode.in(Set("complete", "owner")) or foreign.size() == 1,
      mode != "pending" or foreign.contains(s.pending),
      if (mode == "owner") s' = { ...s, outcome: "rejected" }
      else if (mode == "ledger") s' = { ...s, owner: owner, outcome: "rejected" }
      else {
        val cleared = mode == "complete" and foreign.contains(s.pending)
        s' = {
          ...s, owner: owner,
          phases: foreign.fold(s.phases, (rows, key) => rows.set(key, "owner-withdrawn")),
          posted: if (mode == "cancel") s.posted else s.posted.exclude(foreign),
          pending: if (cleared) 0 else s.pending,
          token: if (cleared) 0 else s.token,
          question: not(cleared) and s.question,
          outcome: if (mode == "complete") "withdrawn" else "rejected"
        }
      }
    }
  }

  val ExactReadOwner = readKey == 0 or matches(readKey)
  val PendingHasRoute = if (s.pending == 0) s.token == 0 and not(s.question)
    else s.phases.get(s.pending) != "none" and s.token == s.issued and s.token > 0
  val NoReplayPost = routes.forall(key => s.postCount.get(key) <= 1)
  val DigestPrecedesEffect = s.posted.forall(key => s.digests.get(key).in(Set(1, 2)) and s.phases.get(key) != "none")
  val ReadRetentionIsExact = if (readRetained) s.retained.get(readKey) == s.digests.get(readKey) else true
  val safety = ExactReadOwner and PendingHasRoute and NoReplayPost and DigestPrecedesEffect and ReadRetentionIsExact

  action step = any {
    nondet key = routes.oneOf()
    nondet result = 0.to(3).oneOf()
    retain(key, result),
    nondet key = routes.oneOf()
    nondet mode = Set("complete", "permission", "security", "before-post", "after-post", "before-write", "repair-write").oneOf()
    publish(key, mode),
    nondet key = routes.oneOf()
    expire(key),
    nondet key = 0.to(4).oneOf()
    nondet question = Bool.oneOf()
    nondet written = Bool.oneOf()
    capture(key, question, written),
    nondet token = 0.to(4).oneOf()
    nondet written = Bool.oneOf()
    release(token, written),
    nondet token = 0.to(4).oneOf()
    nondet mode = Set("complete", "ledger", "pending", "cancel").oneOf()
    consume(token, mode),
    nondet owner = owners.oneOf()
    nondet mode = Set("complete", "owner", "ledger", "cancel", "pending").oneOf()
    withdraw(owner, mode),
    s' = s
  }

  action posted = init.then(withdraw(1, "complete")).then(retain(1, 1)).then(publish(1, "complete"))

  run uncertainNeverRepostsTest = init.then(retain(1, 1)).then(publish(1, "before-post"))
    .then(publish(1, "complete")).expect(s.outcome == "uncertain" and s.postCount.get(1) == 0)

  run lostPostedReplyRepairsExactRowTest = init.then(retain(1, 1)).then(publish(1, "after-post"))
    .then(publish(1, "complete")).expect(s.outcome == "posted" and s.postCount.get(1) == 1)

  run pendingProtectedFromSupersessionTest = posted.then(capture(1, false, true))
    .then(retain(2, 1)).then(publish(2, "complete"))
    .expect(readKey == 1 and s.phases.get(1) == "posted" and s.phases.get(2) == "posted")

  run replacementAndStaleTokenTest = posted.then(capture(1, true, true))
    .then(capture(1, false, true)).then(consume(1, "complete"))
    .expect(s.outcome == "rejected" and readToken == 2)

  run foreignReadHiddenAfterPartialWithdrawalTest = posted.then(capture(1, false, true))
    .then(withdraw(0, "cancel")).expect(readKey == 0 and s.pending == 1 and s.token == 1)
    .then(consume(1, "complete")).expect(s.pending == 0 and s.phases.get(1) == "opened")

  run foreignQuestionReleaseLeavesNotificationTest = posted.then(capture(1, true, true))
    .then(withdraw(0, "cancel")).expect(readKey == 0 and s.pending == 1 and s.posted.contains(1))
    .then(release(1, true)).expect(s.pending == 0 and s.phases.get(1) == "owner-withdrawn" and s.posted.contains(1))

  run retainedBytesChangeDisablesExactReadTest = posted.then(capture(1, true, true))
    .then(retain(1, 2)).expect(readKey == 1 and not(readRetained))
    .then(publish(1, "complete")).expect(s.outcome == "rejected" and s.postCount.get(1) == 1)

  run consumeCanLeaveOpenedRowAndPendingTest = posted.then(capture(1, false, true))
    .then(consume(1, "pending")).expect(readToken == 1 and s.phases.get(1) == "opened")
    .then(consume(1, "complete")).expect(readToken == 0 and not(s.posted.contains(1)))
}
