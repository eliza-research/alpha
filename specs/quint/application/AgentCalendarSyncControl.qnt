// Renderer ownership and source revalidation for linked Calendar control.
module AgentCalendarSyncControl {
  type Binding = {owner: str, session: int, scope: int}
  type Candidate = {key: str, version: int}
  type Review = {binding: Binding, revision: int, destination: str, paused: bool, pending: bool,
    candidates: List[Candidate], visibleLocal: List[str]}
  type Attempt = {kind: str, phase: str, binding: Binding, epoch: int, key: bool, target: str,
    captured: Review, selected: Candidate, control: str, sources: str, reviewStarted: bool,
    aborted: bool, outcome: str, returnedRevision: int, links: List[str]}
  type Dispatch = {id: int, binding: Binding, operation: str, revision: int, destination: str, key: int}
  type State = {port: Binding, usable: bool, bound: Binding, epoch: int, status: str,
    canChange: bool, active: int, lastId: int, review: Review, attempts: int -> Attempt,
    sending: List[int], dispatches: List[Dispatch]}
  var s: State

  pure val Owners = Set("", "A", "B")
  pure val Versions = Set(1, 2)
  pure val IDs = 1.to(7)
  pure val Statuses = Set("ready", "partial", "unavailable")
  pure val Kinds = Set("review", "select", "resume", "pause", "recover", "links")
  pure val Targets = Set("", "primary", "secondary", "removed")
  pure val Preservations = Set("same", "changed", "pending", "unreadable", "failed")
  pure val Controls = Set("unselected", "paused", "pending", "enabled", "removed", "failed")
  pure val SourceLists = Set("both", "primary", "secondary", "empty", "failed")
  pure val Freshness = Set("exact", "hidden", "other-version", "version", "connector", "reader", "guest", "other", "empty", "failed")
  pure val LinkReplies = Set("empty", "held", "malformed", "failed")
  pure val WriteReplies = Set(0, 12, 13)
  pure val NoBinding: Binding = {owner: "", session: 0, scope: 0}
  pure val NoCandidate: Candidate = {key: "", version: 0}
  pure val Primary: Candidate = {key: "primary", version: 1}
  pure val Secondary: Candidate = {key: "secondary", version: 2}
  pure val NoReview: Review = {binding: NoBinding, revision: 0, destination: "", paused: false, pending: false,
    candidates: List(), visibleLocal: List()}
  pure val NoAttempt: Attempt = {kind: "", phase: "", binding: NoBinding, epoch: 0, key: false,
    target: "", captured: NoReview, selected: NoCandidate, control: "", sources: "", reviewStarted: false,
    aborted: false, outcome: "", returnedRevision: 0, links: List()}

  action initWith(status: str): bool = all {
    Statuses.contains(status),
    val owner = {owner: "A", session: 1, scope: 1}
    s' = {port: owner, usable: true, bound: owner, epoch: 1, status: status,
      canChange: true, active: 0, lastId: 0, review: NoReview, attempts: Map(),
      sending: List(), dispatches: List()},
  }
  action init = { nondet status = Statuses.oneOf(); initWith(status) }
  action setPort(owner: str, session: int, scope: int, usable: bool): bool = all {
    Owners.contains(owner), Versions.contains(session), Versions.contains(scope), owner != "" or not(usable),
    s' = {...s, port: {owner: owner, session: session, scope: scope}, usable: usable},
  }
  action setDraft(canChange: bool): bool = s' = {...s, canChange: canChange}
  action refresh(status: str): bool = all {
    s.active == 0, s.epoch < 8, Statuses.contains(status),
    s' = {...s, epoch: s.epoch + 1, bound: if (s.usable) s.port else NoBinding,
      status: if (s.usable) status else "disconnected"},
  }
  action retire = all {
    s.epoch < 8,
    val retired = {...s, epoch: s.epoch + 1, bound: NoBinding, status: "disconnected", active: 0}
    s' = if (s.active == 0) retired else {...retired,
      attempts: retired.attempts.set(s.active, {...s.attempts.get(s.active), aborted: true})},
  }

  pure def current(value: State, attempt: Attempt): bool =
    not(attempt.aborted) and value.usable and attempt.epoch == value.epoch
      and value.bound == value.port and attempt.binding == value.port
  pure def readCurrent(value: State, attempt: Attempt): bool =
    not(attempt.aborted) and value.usable and value.bound == value.port and attempt.binding == value.port
  pure def ownershipError(attempt: Attempt): str = if (attempt.aborted) "aborted" else "owner"
  pure def admission(value: State, kind: str, key: bool): str =
    if (kind == "links") {
      if (value.usable and value.port == value.bound) "" else "owner"
    } else if (kind != "review" and not(value.canChange)) "draft"
    else if (kind != "review" and (value.port.owner == "" or value.review.binding != value.port
      or value.bound.owner != value.port.owner)) "owner"
    else if (kind != "review" and not(key)) "key"
    else if (value.active != 0 or not(Statuses.contains(value.status))) "busy"
    else if (not(value.usable) or value.port.owner != value.bound.owner) "owner"
    else ""

  action start(kind: str, target: str, key: bool): bool = all {
    Kinds.contains(kind), Targets.contains(target), s.lastId < 7,
    kind == "select" or target == "", kind == "select" or kind == "resume" or kind == "pause" or kind == "recover" or key,
    kind == "review" or kind == "links" or s.review.binding != NoBinding,
    val error = admission(s, kind, key)
    val id = s.lastId + 1
    val attempt = {...NoAttempt, kind: kind, binding: s.port, epoch: s.epoch, key: key, target: target,
      captured: if (kind == "review" or kind == "links") NoReview else s.review,
      phase: if (error != "") "done" else if (kind == "links") "links" else "preservation",
      outcome: if (error != "") error else "pending"}
    s' = {...s, lastId: id, attempts: s.attempts.put(id, attempt),
      active: if (error == "" and kind != "links") id else s.active},
  }

  pure def recordAttempt(value: State, id: int, attempt: Attempt): State = {...value, attempts: value.attempts.set(id, attempt)}
  pure def settle(value: State, id: int, attempt: Attempt, outcome: str): State =
    recordAttempt({...value, active: if (value.active == id) 0 else value.active},
      id, {...attempt, phase: "done", outcome: outcome})
  pure def selected(attempt: Attempt): Candidate = {
    val key = if (attempt.kind == "select") attempt.target else attempt.captured.destination
    val matches = attempt.captured.candidates.select(candidate => candidate.key == key)
    if (matches.length() == 0) NoCandidate else matches.head()
  }
  pure def dispatch(value: State, id: int, attempt: Attempt): State =
    recordAttempt({...value, sending: value.sending.append(id),
      dispatches: value.dispatches.append({id: id, binding: attempt.binding, operation: attempt.kind,
        revision: attempt.captured.revision, destination: if (attempt.kind == "select") attempt.selected.key else "",
        key: id})}, id, {...attempt, phase: "write"})

  action preserve(id: int, response: str): bool = all {
    s.attempts.keys().contains(id), Preservations.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.phase == "preservation",
      s' = if (response == "failed") settle(s, id, attempt, "transport")
        else if (not(current(s, attempt))) settle(s, id, attempt, ownershipError(attempt))
        else if (response != "same") settle(s, id, attempt, "preservation")
        else if (attempt.kind == "review") recordAttempt(s, id, {...attempt, phase: "review", reviewStarted: true})
        else if (Set("select", "resume").contains(attempt.kind)) {
          val candidate = selected(attempt)
          if (candidate == NoCandidate) settle(s, id, attempt, "source")
          else recordAttempt(s, id, {...attempt, phase: "fresh", selected: candidate})
        } else if (not(s.canChange)) settle(s, id, attempt, "context")
        else dispatch(s, id, attempt),
    },
  }

  pure def reviewFrom(attempt: Attempt): Review = {
    val code = attempt.control
    val listed = attempt.sources
    {binding: attempt.binding, revision: if (code == "unselected") 7 else if (code == "paused") 8
        else if (code == "pending") 9 else if (code == "enabled") 10 else 11,
      destination: if (code == "unselected") "" else if (code == "enabled") "secondary"
        else if (code == "removed") "removed" else "primary",
      paused: code != "enabled", pending: code == "pending",
      candidates: if (listed == "both") List(Primary, Secondary) else if (listed == "primary") List(Primary)
        else if (listed == "secondary") List(Secondary) else List(),
      visibleLocal: List("built-in")}
  }
  pure def reviewed(value: State, id: int, attempt: Attempt, response: str): State =
    if (attempt.phase != "review") recordAttempt(value, id, attempt)
    else if (response == "failed") settle(value, id, attempt, "transport")
    else if (not(current(value, attempt))) settle(value, id, attempt, ownershipError(attempt))
    else if (attempt.control == "" or attempt.sources == "") recordAttempt(value, id, attempt)
    else settle({...value, review: reviewFrom(attempt)}, id, attempt, "reviewed")

  action controlReply(id: int, response: str): bool = all {
    s.attempts.keys().contains(id), Controls.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.reviewStarted, attempt.control == "",
      s' = reviewed(s, id, {...attempt, control: response}, response),
    },
  }
  action sourceReply(id: int, response: str): bool = all {
    s.attempts.keys().contains(id), SourceLists.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.reviewStarted, attempt.sources == "",
      s' = reviewed(s, id, {...attempt, sources: response}, response),
    },
  }
  action freshReply(id: int, response: str): bool = all {
    s.attempts.keys().contains(id), Freshness.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.phase == "fresh",
      s' = if (response == "failed") settle(s, id, attempt, "transport")
        else if (not(current(s, attempt))) settle(s, id, attempt, ownershipError(attempt))
        else if (not(Set("exact", "hidden", "other-version").contains(response))) settle(s, id, attempt, "source-changed")
        else if (not(s.canChange)) settle(s, id, attempt, "context")
        else dispatch(s, id, attempt),
    },
  }
  action writeReply(id: int, revision: int): bool = all {
    s.attempts.keys().contains(id), WriteReplies.contains(revision),
    val attempt = s.attempts.get(id)
    all {
      attempt.phase == "write",
      s' = if (revision == 0) settle(s, id, attempt, "transport")
        else if (not(current(s, attempt))) settle(s, id, attempt, ownershipError(attempt))
        else settle(s, id, {...attempt, returnedRevision: revision}, "changed"),
    },
  }
  action cancelLinks(id: int): bool = all {
    s.attempts.keys().contains(id), s.attempts.get(id).phase == "links",
    s' = recordAttempt(s, id, {...s.attempts.get(id), aborted: true}),
  }
  action linkReply(id: int, response: str): bool = all {
    s.attempts.keys().contains(id), LinkReplies.contains(response),
    val attempt = s.attempts.get(id)
    all {
      attempt.phase == "links",
      s' = if (response == "failed") settle(s, id, attempt, "transport")
        else if (not(readCurrent(s, attempt))) settle(s, id, attempt, ownershipError(attempt))
        else if (response == "malformed") settle(s, id, attempt, "malformed")
        else settle(s, id, {...attempt, links: if (response == "held") List("held-link") else List()}, "listed"),
    },
  }

  action step = any {
    retire,
    {nondet owner = Owners.oneOf(); nondet session = Versions.oneOf(); nondet scope = Versions.oneOf();
      nondet usable = Bool.oneOf(); setPort(owner, session, scope, usable)},
    {nondet canChange = Bool.oneOf(); setDraft(canChange)},
    {nondet status = Statuses.oneOf(); refresh(status)},
    {nondet kind = Kinds.oneOf(); nondet target = Targets.oneOf(); nondet key = Bool.oneOf(); start(kind, target, key)},
    {nondet id = IDs.oneOf(); nondet response = Preservations.oneOf(); preserve(id, response)},
    {nondet id = IDs.oneOf(); nondet response = Controls.oneOf(); controlReply(id, response)},
    {nondet id = IDs.oneOf(); nondet response = SourceLists.oneOf(); sourceReply(id, response)},
    {nondet id = IDs.oneOf(); nondet response = Freshness.oneOf(); freshReply(id, response)},
    {nondet id = IDs.oneOf(); nondet revision = WriteReplies.oneOf(); writeReply(id, revision)},
    {nondet id = IDs.oneOf(); cancelLinks(id)},
    {nondet id = IDs.oneOf(); nondet response = LinkReplies.oneOf(); linkReply(id, response)},
    s' = s,
  }

  val ActiveOwnsEpoch = s.active == 0 or {
    val attempt = s.attempts.get(s.active)
    attempt.epoch == s.epoch and attempt.outcome == "pending" and not(attempt.aborted)
      and Set("preservation", "review", "fresh", "write").contains(attempt.phase)
  }
  val DispatchMatchesReview = s.dispatches.indices().forall(i => {
    val sent = s.dispatches.nth(i)
    val attempt = s.attempts.get(sent.id)
    sent.operation == attempt.kind and sent.revision == attempt.captured.revision and sent.revision > 0
      and sent.binding == attempt.captured.binding and attempt.key and sent.key == sent.id
      and s.dispatches.indices().filter(j => s.dispatches.nth(j).id == sent.id).size() == 1
      and (if (sent.operation == "select") sent.destination == attempt.selected.key and sent.destination != ""
           else sent.destination == "")
  })
  val ExactSending = s.sending.length() == s.dispatches.length()
    and s.dispatches.indices().forall(i => s.sending.nth(i) == s.dispatches.nth(i).id)
  val Bounded = s.epoch.in(1.to(8)) and s.lastId.in(0.to(7)) and s.attempts.keys() == IDs.filter(id => id <= s.lastId)
  val safety = ActiveOwnsEpoch and DispatchMatchesReview and ExactSending and Bounded

  action reviewedPrimary = start("review", "", true).then(preserve(1, "same"))
    .then(controlReply(1, "paused")).then(sourceReply(1, "both"))
  run resumeRevalidatesExactSourceVersionTest = initWith("ready").then(reviewedPrimary)
    .then(start("resume", "", true)).then(preserve(2, "same")).then(freshReply(2, "version"))
    .expect(s.attempts.get(2).outcome == "source-changed" and s.dispatches == List() and safety)
  run draftFenceWithdrawnWhileSourceReadsTest = initWith("ready").then(reviewedPrimary)
    .then(start("select", "secondary", true)).then(preserve(2, "same")).then(setDraft(false))
    .then(freshReply(2, "exact")).expect(s.attempts.get(2).outcome == "context" and s.dispatches == List() and safety)
  run selectSendsCapturedRevisionAndExactDestinationTest = initWith("partial").then(reviewedPrimary)
    .then(start("select", "secondary", true)).then(preserve(2, "same")).then(freshReply(2, "exact"))
    .then(writeReply(2, 13)).expect(s.dispatches.nth(0).revision == 8 and s.dispatches.nth(0).destination == "secondary"
      and s.attempts.get(2).returnedRevision == 13 and safety)
  run retiredReviewCannotAdmitNewScopeTest = initWith("ready").then(reviewedPrimary)
    .then(setPort("A", 1, 2, true)).then(retire).then(refresh("ready")).then(start("pause", "", true))
    .expect(s.attempts.get(2).outcome == "owner" and s.dispatches == List() and safety)
  run listCancelsIndependentlyOfControlMutationTest = initWith("unavailable").then(reviewedPrimary)
    .then(start("pause", "", true)).then(start("links", "", true)).then(cancelLinks(3))
    .then(linkReply(3, "held")).expect(s.active == 2 and s.attempts.get(3).outcome == "aborted" and safety)
}
