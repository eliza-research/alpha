// Google Calendar setup from verified grants through the renderer readback.
module GoogleCalendarLinkFlow {
  type Review = {revision: int, destination: str, paused: bool, pending: str, sources: Set[str]}
  type Plan = {owner: str, operation: str, revision: int, destination: str}
  type State = {grant: str, owner: str, current: bool, canChange: bool, aborted: bool,
    status: str, refreshing: bool, mutating: bool, phase: str, reviews: int, sent: bool,
    revision: int, latest: Review, pending: str, plans: List[Plan], writes: List[Plan],
    dispatched: List[Plan], linkReads: int, outcome: str, message: str, resultReview: Review}
  var s: State

  pure val Grants = Set("none", "read", "disconnected", "owner", "second", "both", "mixed")
  pure val Owners = Set("A", "B")
  pure val Statuses = Set("ready", "partial", "unavailable", "loading", "error")
  pure val ReadyStatuses = Set("ready", "partial", "unavailable")
  pure val Destinations = Set("", "owner-primary", "owner-team", "second-primary", "removed")
  pure val PendingIds = Set("", "pending-A", "pending-B")
  pure val SourceProfiles = Set("none", "owner", "team", "second", "both", "owner-and-team")
  pure val Revisions = 0.to(5)
  pure val LinkReplies = Set("clean", "foreign-conflict", "held", "many", "failed")
  pure val NoReview: Review = {revision: -1, destination: "", paused: false, pending: "", sources: Set()}

  action init = s' = {grant: "", owner: "A", current: true, canChange: true, aborted: false,
    status: "ready", refreshing: false, mutating: false, phase: "idle", reviews: 0, sent: false,
    revision: -1, latest: NoReview, pending: "unseen", plans: List(), writes: List(),
    dispatched: List(), linkReads: 0, outcome: "", message: "", resultReview: NoReview}

  pure def granted(grant: str): bool = Set("owner", "second", "both", "mixed").contains(grant)
  pure def authorized(grant: str, destination: str): bool =
    if (destination == "second-primary") Set("second", "both").contains(grant)
    else Set("owner", "both", "mixed").contains(grant)
  pure def rows(profile: str): Set[str] =
    if (profile == "owner") Set("owner-primary")
    else if (profile == "team") Set("owner-team")
    else if (profile == "second") Set("second-primary")
    else if (profile == "both") Set("owner-primary", "second-primary")
    else if (profile == "owner-and-team") Set("owner-primary", "owner-team")
    else Set()

  pure def fence(value: State): bool = not(value.aborted) and value.current and value.canChange
  pure def finish(value: State, outcome: str, message: str): State =
    {...value, phase: "done", outcome: outcome, message: message, resultReview: value.latest}
  pure def stopped(value: State): State =
    finish(value, "not-linked", if (value.aborted or not(value.current)) "stopped" else "draft")
  pure val Unconfirmed = Map(("abort", "unconfirmed-abort"), ("review", "unconfirmed-review"),
    ("preflight", "unconfirmed-preflight"), ("transport", "unconfirmed-transport"))
  pure val Unsent = Map(("abort", "unsent-abort"), ("review", "unsent-review"),
    ("preflight", "unsent-preflight"), ("transport", "unsent-transport"))
  pure def failed(value: State, reason: str): State =
    if (value.sent) finish(value, "unconfirmed", Unconfirmed.get(reason))
    else if (not(fence(value))) stopped(value)
    else finish(value, "not-linked", Unsent.get(reason))
  pure def advance(value: State): State =
    if (not(Set("wait-review", "wait-write").contains(value.phase))) value
    else if (value.aborted) failed(value, "abort")
    else if (value.refreshing or value.mutating or value.status == "loading") value
    else if (not(fence(value))) stopped(value)
    else if (value.phase == "wait-write") {
      val plan = value.plans.nth(value.plans.length() - 1)
      {...value, phase: "write-check", writes: value.writes.append(plan)}
    } else if (not(ReadyStatuses.contains(value.status))) {
      if (value.sent) finish(value, "unconfirmed", "unconfirmed")
      else finish(value, "not-linked", "not-ready")
    } else {...value, phase: "review", reviews: value.reviews + 1}
  pure def nextReview(value: State): State =
    if (value.reviews == 3) finish(value, "unconfirmed", "unconfirmed")
    else advance({...value, phase: "wait-review"})

  action setCalendar(status: str, refreshing: bool, mutating: bool): bool = all {
    Statuses.contains(status),
    s' = advance({...s, status: status, refreshing: refreshing, mutating: mutating}),
  }
  action setFence(current: bool, canChange: bool): bool = s' = {...s, current: current, canChange: canChange}
  action setOwner(owner: str): bool = all {Owners.contains(owner), s' = {...s, owner: owner}}
  action abort = all {not(s.aborted), s' = advance({...s, aborted: true})}
  action start(grant: str): bool = all {
    s.phase == "idle", Grants.contains(grant),
    val begun = {...s, grant: grant}
    s' = if (granted(grant)) nextReview(begun)
      else finish(begun, "needs-grant", if (grant == "read") "read-only" else "not-connected"),
  }

  pure def canChoose(value: State, sources: Set[str]): bool =
    sources.filter(row => row != "owner-team" and authorized(value.grant, row)).size() == 1
  pure def choice(value: State, sources: Set[str]): str =
    if (sources.contains("owner-primary") and authorized(value.grant, "owner-primary")) "owner-primary"
    else "second-primary"
  pure def planWrite(value: State, operation: str, target: str): State =
    advance({...value, phase: "wait-write",
      plans: value.plans.append({owner: value.owner, operation: operation, revision: value.latest.revision, destination: target})})

  pure def readback(value: State, review: Review): State = {
    val read = {...value, latest: review}
    val saved = review.destination
    if (read.revision != -1 and review.revision != read.revision) finish(read, "not-linked", "changed")
    else if (saved != "" and not(review.sources.contains(saved))) finish(read, "not-linked", "missing-destination")
    else if (saved != "" and not(authorized(read.grant, saved))) finish(read, "not-linked", "unapproved")
    else {
      val updated = {...read, pending: review.pending}
      if (saved != "" and not(review.paused)) {
        if (review.pending == "") {
          val listing = {...updated, phase: "links", linkReads: updated.linkReads + 1}
          if (listing.aborted) finish(listing, "unconfirmed", "unconfirmed-abort") else listing
        } else if (value.pending == "unseen") nextReview(updated)
        else if (value.pending == review.pending) finish(updated, "unconfirmed", "waiting")
        else finish(updated, "syncing", "syncing")
      } else if (review.pending != "") finish(updated, "not-linked", "waiting")
      else if (value.reviews == 3) finish(updated, "unconfirmed", "unconfirmed")
      else if (saved != "") planWrite(updated, "resume", saved)
      else if (canChoose(updated, review.sources)) planWrite(updated, "select", choice(updated, review.sources))
      else finish(updated, "not-linked", "choose-primary")
    }
  }
  action reviewReply(revision: int, destination: str, paused: bool, pending: str, profile: str): bool = all {
    s.phase == "review", Revisions.contains(revision), Destinations.contains(destination),
    PendingIds.contains(pending), SourceProfiles.contains(profile),
    s' = readback(s, {revision: revision, destination: destination, paused: paused, pending: pending, sources: rows(profile)}),
  }
  action reviewFailed = all {s.phase == "review", s' = failed(s, "review")}
  action writeRefused = all {s.phase == "write-check", s' = failed(s, "preflight")}
  action authorize = all {
    s.phase == "write-check",
    val write = s.writes.nth(s.writes.length() - 1)
    s' = if (fence(s)) {...s, phase: "write", sent: true, latest: NoReview, dispatched: s.dispatched.append(write)}
      else failed(s, "preflight"),
  }
  action writeReply(revision: int): bool = all {
    s.phase == "write", Revisions.contains(revision), s' = nextReview({...s, revision: revision}),
  }
  action writeFailed = all {s.phase == "write", s' = failed(s, "transport")}
  action linkReply(result: str): bool = all {
    s.phase == "links", LinkReplies.contains(result),
    s' = if (result == "failed") finish(s, "unconfirmed", "unconfirmed-links")
      else if (s.aborted) finish(s, "unconfirmed", "unconfirmed-abort")
      else if (result == "held" or result == "many") finish(s, "unconfirmed", if (result == "held") "conflict-held" else "conflict-many")
      else finish(s, "synced", "synced"),
  }

  action step = any {
    abort, reviewFailed, writeRefused, authorize, writeFailed,
    {nondet status = Statuses.oneOf(); nondet refreshing = Bool.oneOf(); nondet mutating = Bool.oneOf(); setCalendar(status, refreshing, mutating)},
    {nondet current = Bool.oneOf(); nondet canChange = Bool.oneOf(); setFence(current, canChange)},
    {nondet owner = Owners.oneOf(); setOwner(owner)},
    {nondet grant = Grants.oneOf(); start(grant)},
    {nondet revision = Revisions.oneOf(); nondet destination = Destinations.oneOf(); nondet paused = Bool.oneOf();
      nondet pending = PendingIds.oneOf(); nondet profile = SourceProfiles.oneOf(); reviewReply(revision, destination, paused, pending, profile)},
    {nondet revision = Revisions.oneOf(); writeReply(revision)},
    {nondet result = LinkReplies.oneOf(); linkReply(result)},
    s' = s,
  }

  val waiting = Set("wait-review", "wait-write").contains(s.phase)
  val ReviewBudget = s.reviews.in(0.to(3)) and s.writes.length() <= 2 and s.linkReads <= 1
    and s.dispatched.length() <= s.writes.length()
  val NoGrantNoRequest = s.grant == "" or granted(s.grant) or (s.reviews == 0 and s.writes.length() == 0 and s.linkReads == 0)
  val ReadbackRequired = s.outcome != "synced" or (s.linkReads == 1 and s.resultReview.revision != -1
    and not(s.resultReview.paused) and s.resultReview.pending == "" and authorized(s.grant, s.resultReview.destination))
  val RetainedReview = s.phase != "done" or s.resultReview == s.latest
  val safety = ReviewBudget and NoGrantNoRequest and ReadbackRequired and RetainedReview

  run selectResumeAndFinalReadbackTest = init.then(start("owner"))
    .then(reviewReply(0, "", true, "", "owner-and-team")).then(authorize).then(writeReply(1))
    .then(reviewReply(1, "owner-primary", true, "", "owner-and-team")).then(authorize).then(writeReply(2))
    .then(reviewReply(2, "owner-primary", false, "", "owner-and-team")).then(linkReply("clean"))
    .expect(s.outcome == "synced" and s.reviews == 3 and s.dispatched.length() == 2 and safety)
  run pendingDispatchNeedsChangedReadbackTest = init.then(start("owner"))
    .then(reviewReply(3, "owner-primary", false, "pending-A", "owner"))
    .then(reviewReply(3, "owner-primary", false, "pending-A", "owner"))
    .expect(s.outcome == "unconfirmed" and s.message == "waiting" and s.linkReads == 0 and safety)
  run priorReviewClearsOnlyAtSendTest = init.then(start("owner")).then(reviewReply(0, "", true, "", "owner"))
    .expect(s.latest.revision == 0).then(authorize).then(writeFailed)
    .expect(s.outcome == "unconfirmed" and s.resultReview == NoReview and safety)
  run cancellationWhileWaitingMakesNoReadTest = init.then(setCalendar("loading", true, false))
    .then(start("owner")).then(abort).expect(s.outcome == "not-linked" and s.reviews == 0 and safety)
  run changedControlRevisionDoesNotResumeTest = init.then(start("owner")).then(reviewReply(0, "", true, "", "owner"))
    .then(authorize).then(writeReply(1)).then(reviewReply(2, "owner-primary", true, "", "owner"))
    .expect(s.outcome == "not-linked" and s.message == "changed" and s.dispatched.length() == 1 and safety)
}
