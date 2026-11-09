// Optional Calendar cleanup and independently authorized Google privacy revoke.
module GoogleCalendarDisconnect {
  type Result = {privacy: str, calendarPause: str, callbackRetirement: str, providerDrain: str, pauseRevision: int}
  type State = {review: str, independent: bool, pausePort: str, retirementPort: str, live: str,
    privacyCurrent: bool, aborted: bool, originalEdited: bool, phase: str, uuid: bool, budget: str, key: str,
    calls: List[str], pauseRevision: int, pauseSignal: str, pause: str, retirement: str, revoke: str,
    pauseDelivered: bool, retirementDelivered: bool, outcome: str, result: Result}
  var s: State

  pure val Reviews = Set("matching", "already-paused", "no-destination", "no-control", "duplicate", "unmapped",
    "wrong-connection", "invalid-version", "wrong-side", "wrong-provider", "wrong-grant", "invalid-revision")
  pure val Ports = Set("absent", "throw", "held")
  pure val Live = Set("exact", "none", "origin", "owner", "agent", "session", "credential", "generation",
    "incomplete", "version", "revision", "destination", "mapping")
  pure val ValidLease = Set("exact", "version", "revision", "destination", "mapping")
  pure val Keys = Set("valid", "blank", "long")
  pure val Budgets = Set("valid", "pause-low", "pause-high", "retirement-low", "retirement-high", "fraction")
  pure val PauseReplies = Set("exact", "revision", "destination", "pending", "running", "malformed", "reordered", "failed")
  pure val NoResult: Result = {privacy: "", calendarPause: "", callbackRetirement: "", providerDrain: "", pauseRevision: -1}

  action initWith(review: str, independent: bool, pausePort: str, retirementPort: str): bool = all {
    Reviews.contains(review), Ports.contains(pausePort), Ports.contains(retirementPort),
    s' = {review: review, independent: independent, pausePort: pausePort, retirementPort: retirementPort,
      live: "exact", privacyCurrent: true, aborted: false, originalEdited: false,
      phase: "idle", uuid: true, budget: "", key: "", calls: List(), pauseRevision: -1, pauseSignal: "",
      pause: "", retirement: "", revoke: "", pauseDelivered: false, retirementDelivered: false,
      outcome: "", result: NoResult},
  }
  action init = {nondet review = Reviews.oneOf(); nondet independent = Bool.oneOf();
    nondet pausePort = Ports.oneOf(); nondet retirementPort = Ports.oneOf(); initWith(review, independent, pausePort, retirementPort)}
  action setCalendar(live: str): bool = all {Live.contains(live), s' = {...s, live: live}}
  action setPrivacy(current: bool): bool = s' = {...s, privacyCurrent: current}
  action editOriginal = all {s.phase != "idle", s' = {...s, originalEdited: true}}
  pure def calendarCurrent(value: State): bool = not(value.aborted) and ValidLease.contains(value.live)
  pure def privacyAuthorized(value: State): bool = not(value.aborted)
    and (if (value.independent) value.privacyCurrent else calendarCurrent(value))
  pure def privacyError(value: State): str = if (value.aborted) "aborted" else "privacy"
  pure def denied(value: State, outcome: str): State = {...value, phase: "done", outcome: outcome}

  pure def startRetirement(value: State): State =
    if (value.retirementPort == "absent") {...value, retirement: "unavailable"}
    else {...value, calls: value.calls.append("retire"),
      retirement: if (value.retirementPort == "throw") "unknown" else "pending"}
  pure def startPause(value: State): State =
    if (Set("no-destination", "no-control").contains(value.review)) {...value, pause: "not-applicable"}
    else if (not(Set("matching", "already-paused").contains(value.review)) or value.live != "exact" or value.key != "valid" or value.pausePort == "absent")
      {...value, pause: "unavailable"}
    else {...value, calls: value.calls.append("pause"), pauseRevision: 7, pauseSignal: "live",
      pause: if (value.pausePort == "throw") "unknown" else "pending"}

  action start(uuid: bool, budget: str, key: str): bool = all {
    s.phase == "idle", Budgets.contains(budget), Keys.contains(key),
    val requested = {...s, uuid: uuid, budget: budget, key: key}
    s' = if (s.aborted) denied(requested, "aborted")
      else if (not(uuid)) denied(requested, "uuid")
      else if (not(privacyAuthorized(s))) denied(requested, "privacy")
      else if (budget != "valid") denied(requested, "budget")
      else {
        val started = startPause(startRetirement(requested))
        {...started, phase: "revoking", revoke: "pending", calls: started.calls.append("revoke")}
      },
  }

  pure def publish(value: State): State =
    if (value.phase != "cleanup" or value.pause == "pending" or value.retirement == "pending") value
    else if (not(privacyAuthorized(value))) denied(value, privacyError(value))
    else {...value, phase: "done", outcome: "returned", result: {privacy: "revoked",
      calendarPause: if (value.pause == "confirmed" and value.independent and not(calendarCurrent(value))) "unknown" else value.pause,
      callbackRetirement: value.retirement, providerDrain: "unavailable", pauseRevision: value.pauseRevision}}

  action abort = all {
    not(s.aborted),
    s' = {...s, aborted: true, pauseSignal: if (Set("revoking", "cleanup").contains(s.phase)
      and s.pauseSignal == "live") "aborted" else s.pauseSignal},
  }
  action revokeReply(ok: bool): bool = all {
    s.phase == "revoking",
    s' = if (ok) publish({...s, revoke: "confirmed", phase: "cleanup"})
      else denied({...s, revoke: "failed"}, "revoke"),
  }
  action pauseReply(response: str): bool = all {
    PauseReplies.contains(response), s.pausePort == "held", s.pauseRevision == 7, not(s.pauseDelivered),
    val settled = if (s.pause != "pending") s.pause
      else if (response == "exact" and calendarCurrent(s)) "confirmed" else "unknown"
    s' = publish({...s, pause: settled, pauseDelivered: true}),
  }
  action retirementReply(ok: bool): bool = all {
    s.retirementPort == "held", Set("pending", "unknown").contains(s.retirement), not(s.retirementDelivered),
    val settled = if (s.retirement != "pending") s.retirement else if (ok) "confirmed" else "unknown"
    s' = publish({...s, retirement: settled, retirementDelivered: true}),
  }
  action pauseTimeout = all {
    s.pause == "pending",
    s' = publish({...s, pause: "unknown", pauseSignal: if (s.pauseSignal == "live") "timeout" else s.pauseSignal}),
  }
  action retirementTimeout = all {s.retirement == "pending", s' = publish({...s, retirement: "unknown"})}

  action step = any {
    abort, editOriginal, pauseTimeout, retirementTimeout,
    {nondet live = Live.oneOf(); setCalendar(live)},
    {nondet current = Bool.oneOf(); setPrivacy(current)},
    {nondet uuid = Bool.oneOf(); nondet budget = Budgets.oneOf(); nondet key = Keys.oneOf(); start(uuid, budget, key)},
    {nondet ok = Bool.oneOf(); revokeReply(ok)},
    {nondet response = PauseReplies.oneOf(); pauseReply(response)},
    {nondet ok = Bool.oneOf(); retirementReply(ok)},
    s' = s,
  }

  val CleanupBudget = s.calls.length() <= 3
    and s.calls.indices().forall(i => s.calls.select(call => call == s.calls.nth(i)).length() == 1)
  val RevokeDoesNotWaitForCleanup = s.revoke == "" or s.calls.nth(s.calls.length() - 1) == "revoke"
  val ExactPause = s.pauseRevision == -1 or (Set("matching", "already-paused").contains(s.review) and s.key == "valid"
    and s.calls.select(call => call == "pause").length() == 1)
  val NoProviderDrainClaim = s.outcome != "returned" or (s.result.providerDrain == "unavailable"
    and s.revoke == "confirmed" and s.pause != "pending" and s.retirement != "pending")
  val safety = CleanupBudget and RevokeDoesNotWaitForCleanup and ExactPause and NoProviderDrainClaim

  run revokeStartsBeforeBothCleanupRepliesTest = initWith("matching", true, "held", "held")
    .then(start(true, "valid", "valid")).expect(s.calls == List("retire", "pause", "revoke"))
    .then(revokeReply(true)).expect(s.phase == "cleanup" and s.pause == "pending" and s.retirement == "pending")
    .then(pauseReply("exact")).then(retirementReply(true))
    .expect(s.outcome == "returned" and s.result.calendarPause == "confirmed" and safety)
  run staleCalendarLeaseCannotVetoIndependentPrivacyTest = initWith("matching", true, "held", "absent")
    .then(setCalendar("generation")).then(start(true, "valid", "valid")).then(revokeReply(true))
    .expect(s.calls == List("revoke") and s.result.calendarPause == "unavailable" and safety)
  run confirmedPauseLosesRetiredCalendarGenerationTest = initWith("matching", true, "held", "absent")
    .then(start(true, "valid", "valid")).then(pauseReply("exact")).then(setCalendar("generation")).then(revokeReply(true))
    .expect(s.pause == "confirmed" and s.result.calendarPause == "unknown" and safety)
  run finiteTimeoutCannotPublishLateCleanupTest = initWith("matching", true, "held", "held")
    .then(start(true, "valid", "valid")).then(revokeReply(true)).then(pauseTimeout).then(retirementTimeout)
    .then(pauseReply("exact")).then(retirementReply(true))
    .expect(s.result.calendarPause == "unknown" and s.result.callbackRetirement == "unknown" and s.pauseSignal == "timeout" and safety)
  run privacyRetirementSuppressesCompletedCleanupTest = initWith("matching", true, "held", "held")
    .then(start(true, "valid", "valid")).then(revokeReply(true)).then(setPrivacy(false))
    .then(pauseReply("exact")).then(retirementReply(true))
    .expect(s.outcome == "privacy" and s.result == NoResult and safety)
  run failedRevokeDoesNotWaitForCleanupTest = initWith("matching", true, "held", "held")
    .then(start(true, "valid", "valid")).then(revokeReply(false)).then(abort)
    .expect(s.outcome == "revoke" and s.pause == "pending" and s.pauseSignal == "live" and safety)
}
