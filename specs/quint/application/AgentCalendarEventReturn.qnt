// Current canonical Calendar selection and return readback.
module AgentCalendarEventReturn {
  type Reference = {key: str, version: str, source: str}
  type Attempt = {reference: Reference, epoch: int, owner: str, session: int, scope: int,
    cancelled: bool, dispatched: bool, feed: str, sources: str, outcome: str}
  type State = {portOwner: str, portSession: int, portScope: int, portCurrent: bool,
    owner: str, session: int, scope: int, epoch: int, profile: str, selection: Reference,
    origin: Reference, refreshing: bool, mutating: bool, lastId: int, attempts: int -> Attempt}
  var s: State

  pure val Owners = Set("", "A", "B")
  pure val Identities = Set(1, 2)
  pure val IDs = 1.to(4)
  pure val Profiles = Set("normal", "updated", "padded", "none", "no-etag", "no-grant",
    "ambiguous-source", "different-connector", "loose", "loose-alt", "hidden")
  pure val Issues = Set("exact", "key", "version", "source", "unsafe", "overflow", "pre-abort")
  pure val FeedReplies = Set("exact", "padded", "missing", "moved", "changed", "cancelled",
    "partial", "wrong-window", "foreign", "ambiguous", "failed")
  pure val SourceReplies = Set("owner", "writer", "reader", "mixed", "hidden", "blocked",
    "missing", "wrong-connector", "ambiguous", "failed")
  pure val NoRef: Reference = {key: "", version: "", source: ""}
  pure val NoAttempt: Attempt = {reference: NoRef, epoch: 0, owner: "", session: 0, scope: 0,
    cancelled: false, dispatched: false, feed: "", sources: "", outcome: ""}

  pure def selectionFor(profile: str): Reference =
    if (Set("normal", "updated", "padded", "loose", "loose-alt", "hidden").contains(profile))
      {key: if (Set("loose", "loose-alt").contains(profile)) "loose" else "event",
       version: if (profile == "updated") "v2" else "v1",
       source: if (profile == "loose-alt") "alternate" else "primary"}
    else NoRef

  action initWith(profile: str): bool = all {
    Profiles.contains(profile),
    s' = {portOwner: "A", portSession: 1, portScope: 1, portCurrent: true,
      owner: "A", session: 1, scope: 1, epoch: 1, profile: profile, selection: selectionFor(profile),
      origin: NoRef, refreshing: false, mutating: false, lastId: 0,
      attempts: IDs.mapBy(_ => NoAttempt)},
  }
  action init = { nondet profile = Profiles.oneOf(); initWith(profile) }
  action setPort(owner: str, session: int, scope: int, current: bool): bool = all {
    Owners.contains(owner), Identities.contains(session), Identities.contains(scope), owner != "" or not(current),
    s' = {...s, portOwner: owner, portSession: session, portScope: scope, portCurrent: current},
  }
  pure def portOwns(value: State, owner: str, session: int, scope: int): bool =
    value.portCurrent and value.portOwner == owner and value.portSession == session and value.portScope == scope
  pure def bindingCurrent(value: State): bool = portOwns(value, value.owner, value.session, value.scope)
  pure def disconnected(value: State): State =
    {...value, owner: "", session: 0, scope: 0, profile: "absent", selection: NoRef, refreshing: false}

  action refresh(profile: str): bool = all {
    Profiles.contains(profile), not(s.refreshing or s.mutating), s.epoch < 8,
    val updated = {...s, epoch: s.epoch + 1}
    s' = if (s.portCurrent) {...updated, owner: s.portOwner, session: s.portSession, scope: s.portScope,
      profile: profile, selection: selectionFor(profile)} else disconnected(updated),
  }
  action startReread = all {
    bindingCurrent(s), s.profile != "absent", not(s.refreshing or s.mutating), s.epoch < 8,
    s' = {...s, epoch: s.epoch + 1, refreshing: true},
  }
  action finishReread(profile: str): bool = all {
    s.refreshing, Profiles.contains(profile),
    s' = if (bindingCurrent(s)) {...s, refreshing: false, profile: profile, selection: selectionFor(profile)}
      else {...s, refreshing: false, profile: "absent", selection: NoRef},
  }
  action retire = all {
    not(s.refreshing or s.mutating), s.epoch < 8,
    s' = disconnected({...s, epoch: s.epoch + 1}),
  }
  action startMutation = all {
    not(s.refreshing or s.mutating), s.profile != "absent", s.portCurrent, s.portOwner == s.owner,
    s' = {...s, mutating: true},
  }
  action finishMutation = all { s.mutating, s' = {...s, mutating: false} }
  action capture = s' = {...s, origin: s.selection}

  pure def requestReference(origin: Reference, issue: str): Reference =
    if (issue == "key") {...origin, key: "other"}
    else if (issue == "version") {...origin, version: "other"}
    else if (issue == "source") {...origin, source: "other"} else origin
  pure def admission(value: State, reference: Reference, issue: str): str =
    if (value.portOwner == "" or value.mutating or reference == NoRef
      or reference != value.selection or issue == "unsafe") "unknown"
    else if (issue == "pre-abort") "aborted"
    else if (not(bindingCurrent(value))) "owner"
    else if (issue == "overflow") "date"
    else "pending"

  action start(issue: str): bool = all {
    Issues.contains(issue), s.lastId < 4,
    val id = s.lastId + 1
    val reference = requestReference(s.origin, issue)
    val outcome = admission(s, reference, issue)
    val attempt: Attempt = {...NoAttempt, reference: reference, epoch: s.epoch,
      owner: s.portOwner, session: s.portSession, scope: s.portScope,
      cancelled: issue == "pre-abort", dispatched: outcome == "pending", outcome: outcome}
    s' = {...s, lastId: id, attempts: s.attempts.set(id, attempt)},
  }
  action cancel(id: int): bool = all {
    IDs.contains(id), s.attempts.get(id).outcome == "pending",
    s' = {...s, attempts: s.attempts.set(id, {...s.attempts.get(id), cancelled: true})},
  }

  pure def readable(attempt: Attempt): bool =
    Set("owner", "writer", "reader", "mixed").contains(attempt.sources)
      or (attempt.sources == "wrong-connector" and attempt.reference.key == "loose")
  pure def readback(value: State, attempt: Attempt): str =
    if (value.epoch != attempt.epoch or not(bindingCurrent(value))) "owner"
    else if (value.mutating or value.selection != attempt.reference
      or Set("partial", "wrong-window", "foreign", "ambiguous").contains(attempt.feed)) "unknown"
    else if (attempt.feed != "exact" or not(readable(attempt))) "missing"
    else "found"

  pure def reply(value: State, attempt: Attempt, response: str): Attempt = {
    val outcome =
      if (attempt.outcome != "pending") attempt.outcome
      else if (response == "failed") "transport"
      else if (attempt.cancelled) "aborted"
      else if (not(portOwns(value, attempt.owner, attempt.session, attempt.scope))) "owner"
      else if (attempt.feed != "" and attempt.sources != "") readback(value, attempt)
      else "pending"
    {...attempt, outcome: outcome}
  }
  action feedReply(id: int, response: str): bool = all {
    IDs.contains(id), FeedReplies.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.dispatched, attempt.feed == "",
      s' = {...s, attempts: s.attempts.set(id, reply(s, {...attempt, feed: response}, response))},
    },
  }
  action sourcesReply(id: int, response: str): bool = all {
    IDs.contains(id), SourceReplies.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.dispatched, attempt.sources == "",
      s' = {...s, attempts: s.attempts.set(id, reply(s, {...attempt, sources: response}, response))},
    },
  }

  action step = any {
    capture, retire, startReread, startMutation, finishMutation,
    { nondet owner = Owners.oneOf(); nondet session = Identities.oneOf(); nondet scope = Identities.oneOf();
      nondet current = Bool.oneOf(); setPort(owner, session, scope, current) },
    { nondet profile = Profiles.oneOf(); refresh(profile) },
    { nondet profile = Profiles.oneOf(); finishReread(profile) },
    { nondet issue = Issues.oneOf(); start(issue) },
    { nondet id = IDs.oneOf(); cancel(id) },
    { nondet id = IDs.oneOf(); nondet response = FeedReplies.oneOf(); feedReply(id, response) },
    { nondet id = IDs.oneOf(); nondet response = SourceReplies.oneOf(); sourcesReply(id, response) },
    s' = s,
  }
  val FoundRequiresReadback = IDs.forall(id => {
    val attempt = s.attempts.get(id)
    attempt.outcome != "found" or (attempt.dispatched and not(attempt.cancelled)
      and attempt.reference != NoRef and attempt.feed == "exact" and readable(attempt))
  })
  val PendingOwnsTwoReads = IDs.forall(id => {
    val attempt = s.attempts.get(id)
    attempt.outcome != "pending" or (attempt.dispatched and (attempt.feed == "" or attempt.sources == "")
      and attempt.feed != "failed" and attempt.sources != "failed")
  })
  val SelectionProjection = s.selection == selectionFor(s.profile)
  val Bounded = s.epoch.in(1.to(8)) and s.lastId.in(0.to(4)) and not(s.refreshing and s.mutating)
  val safety = FoundRequiresReadback and PendingOwnsTwoReads and SelectionProjection and Bounded

  run exactReadbackWaitsForBothRepliesTest = initWith("normal").then(capture).then(start("exact"))
    .then(sourcesReply(1, "reader")).expect(s.attempts.get(1).outcome == "pending")
    .then(feedReply(1, "exact")).expect(s.attempts.get(1).outcome == "found" and safety)
  run sameEpochSelectionChangeRefusesReadbackTest = initWith("loose").then(capture).then(startReread)
    .then(start("exact")).then(feedReply(1, "exact")).then(finishReread("loose-alt"))
    .then(sourcesReply(1, "owner")).expect(s.attempts.get(1).outcome == "unknown" and safety)
  run oldEpochCannotReturnWhileNewAttemptSucceedsTest = initWith("normal").then(capture).then(start("exact"))
    .then(refresh("updated")).then(capture).then(start("exact")).then(feedReply(1, "exact"))
    .then(sourcesReply(1, "owner")).then(feedReply(2, "exact")).then(sourcesReply(2, "owner"))
    .expect(s.attempts.get(1).outcome == "owner" and s.attempts.get(2).outcome == "found" and safety)
  run hiddenDuplicateSourceCannotCreateOriginTest = initWith("ambiguous-source").then(capture).then(start("exact"))
    .expect(s.origin == NoRef and s.attempts.get(1).outcome == "unknown" and not(s.attempts.get(1).dispatched) and safety)
  run transportRefusalPrecedesDelayedCancellationCheckTest = initWith("normal").then(capture).then(start("exact"))
    .then(cancel(1)).then(feedReply(1, "failed")).then(sourcesReply(1, "owner"))
    .expect(s.attempts.get(1).outcome == "transport" and safety)
}
