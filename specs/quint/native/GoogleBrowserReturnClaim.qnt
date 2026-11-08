// One prepared Google browser attempt and its native callback admission.
module GoogleBrowserReturnClaim {
  type Work = {kind: str, claim: bool}
  type State = {live: bool, paused: bool, hint: bool, hintElapsed: bool,
    claimed: bool, received: bool, cancelled: bool, pending: str,
    credentialCurrent: bool, retirementFence: bool, outcome: str, exchanged: bool,
    retainedNotice: bool, lastCapture: str, work: List[Work], grace: List[str]}
  var s: State

  pure val Captures = Set("success", "foreign", "hint", "error", "mfa-error", "link-error", "query-code", "invalid")
  pure val Pending = Set("matching", "expired", "replacement", "unreadable", "missing")
  pure val Outcomes = Set("waiting", "none", "authenticated", "browser-closed", "app-link-unverified",
    "cancelled", "provider-refused", "mfa-browser", "expired", "storage")
  pure def matches(pending: str): bool = pending == "matching" or pending == "expired"
  pure def addWork(value: State, kind: str, claim: bool): State =
    {...value, work: value.work.append({kind: kind, claim: claim})}

  action initWith(live: bool, expired: bool): bool = s' = {
    live: live, paused: false, hint: false, hintElapsed: false, claimed: false,
    received: false, cancelled: false, pending: if (expired) "expired" else "matching",
    credentialCurrent: true, retirementFence: false, outcome: if (live) "waiting" else "none",
    exchanged: false, retainedNotice: false, lastCapture: "none", work: List(), grace: List()}
  action init = {
    nondet live = Bool.oneOf(); nondet expired = Bool.oneOf(); initWith(live, expired)
  }

  action pause = s' = {...s, paused: s.paused or s.live}
  action resume = all {s.grace.length() < 4,
    s' = if (s.live and s.paused) {...s, grace: s.grace.append("resume")} else s}
  action receive(kind: str): bool = all {
    Captures.contains(kind), s.work.length() < 4,
    val claim = s.live and not(s.received or s.retirementFence or s.claimed) and kind != "foreign"
    s' = if (kind == "invalid") {...s, lastCapture: "rejected"}
      else addWork({...s, claimed: s.claimed or claim, lastCapture: "accepted"},
        if (kind == "query-code") "hint" else kind, claim)}
  action changePending(pending: str): bool = all {s.live,
    Set("replacement", "unreadable", "missing").contains(pending), s' = {...s, pending: pending}}
  action supersedeCredential = all {s.live, s' = {...s, credentialCurrent: false}}

  pure def end(value: State, outcome: str): State =
    {...value, live: false, cancelled: true, outcome: outcome}
  pure def closeBrowser(value: State): State =
    addWork({...end(value, "browser-closed"), retirementFence: true}, "burn", false)
  pure def releaseClaim(value: State, claim: bool): State = {
    val released = if (claim) {...value, claimed: false} else value
    if (not(claim and released.live and not(released.received))) released
    else if (released.hintElapsed) end(released, "app-link-unverified")
    else if (released.paused and not(released.hint)) closeBrowser(released)
    else released
  }

  action cancelScope(matching: bool): bool = all {s.work.length() < 4,
    s' = if (matching and s.live)
      addWork({...end(s, "cancelled"), retirementFence: true}, "cancel", false)
      else s}

  pure def clearRetirement(value: State): State = {...value, retirementFence: false,
    pending: if (matches(value.pending)) "missing" else value.pending}
  pure def consume(value: State, kind: str): State = {
    val consumed = {...value, pending: "missing", received: true}
    if (value.pending == "expired") end(consumed, "expired")
    else if (kind == "success") {...consumed, live: false, outcome: "authenticated", exchanged: true}
    else if (kind == "mfa-error") end(consumed, "mfa-browser")
    else if (kind == "link-error") end(consumed, "app-link-unverified")
    else end(consumed, "provider-refused")
  }
  pure def receiveWork(value: State, kind: str): State =
    if (value.retirementFence or not(matches(value.pending)) or kind == "foreign") value
    else if (kind == "hint" and value.pending == "expired") value
    else if (not(value.live)) {...value, retainedNotice: true}
    else if (kind == "hint") {...value, hint: true, grace: value.grace.append("hint")}
    else if (not(value.credentialCurrent)) {...end(value, "storage"), retirementFence: true}
    else consume(value, kind)

  action runWorker = all {s.work.length() > 0, s.grace.length() < 4,
    val job = s.work.head()
    val rest = {...s, work: s.work.tail()}
    s' = if (job.kind == "cancel" or job.kind == "burn" and s.credentialCurrent) clearRetirement(rest)
      else if (job.kind == "burn") rest
      else releaseClaim(receiveWork(rest, job.kind), job.claim)}

  action runGrace = all {s.grace.length() > 0, s.work.length() < 4,
    val kind = s.grace.head()
    val rest = {...s, grace: s.grace.tail()}
    s' = if (not(s.live) or s.received) rest
      else if (kind == "hint") {
        val elapsed = {...rest, hintElapsed: true}
        if (s.claimed) elapsed else end(elapsed, "app-link-unverified")
      } else if (s.hint or s.claimed) rest else closeBrowser(rest)}

  action step = any {
    pause, resume, runWorker, runGrace, supersedeCredential,
    {nondet kind = Captures.oneOf(); receive(kind)},
    {nondet pending = Set("replacement", "unreadable", "missing").oneOf(); changePending(pending)},
    {nondet matching = Bool.oneOf(); cancelScope(matching)},
    s' = s,
  }

  val TypeOK = Pending.contains(s.pending) and Outcomes.contains(s.outcome)
    and s.lastCapture.in(Set("none", "accepted", "rejected"))
    and s.work.length() <= 4 and s.grace.length() <= 4
  val ClaimHasWorker = {
    val claims = s.work.indices().filter(i => s.work.nth(i).claim)
    claims.size() == (if (s.claimed) 1 else 0)
  }
  val ExchangeUsesConsumedRecord = s.exchanged implies
    s.received and s.pending == "missing" and s.outcome == "authenticated" and not(s.live)
  val ClaimedResultSurvivesGrace = s.claimed implies
    s.outcome != "browser-closed" and (s.outcome != "app-link-unverified" or s.received)
  val GraceAndRetirement = (s.hintElapsed implies s.hint)
    and (s.retirementFence implies not(s.live))
    and (s.live iff s.outcome == "waiting")
  val safety = TypeOK and ClaimHasWorker and ExchangeUsesConsumedRecord and ClaimedResultSurvivesGrace and GraceAndRetirement

  run ownResultSurvivesResumeGraceTest = initWith(true, false).then(pause).then(resume).then(receive("success"))
    .then(runGrace).expect(s.live and s.claimed).then(runWorker).expect(s.exchanged and safety)
  run foreignResultLeavesResumeGraceTest = initWith(true, false).then(pause).then(resume).then(receive("foreign"))
    .then(runGrace).then(runWorker).then(runWorker).expect(s.outcome == "browser-closed" and not(s.exchanged) and safety)
  run matchingResultSurvivesHintGraceTest = initWith(true, false).then(receive("hint")).then(runWorker).then(receive("success"))
    .then(runGrace).expect(s.live and s.hintElapsed and s.claimed).then(runWorker).expect(s.exchanged and safety)
  run unconsumableResultReleasesElapsedHintTest = initWith(true, false).then(receive("hint")).then(runWorker)
    .then(receive("success")).then(changePending("unreadable")).then(runGrace).then(runWorker)
    .expect(s.outcome == "app-link-unverified" and not(s.claimed) and s.pending == "unreadable" and safety)
  run cancelFencesQueuedResultTest = initWith(true, false).then(receive("success")).then(cancelScope(true))
    .then(runWorker).then(runWorker).expect(s.outcome == "cancelled" and s.pending == "missing" and not(s.exchanged) and safety)
  run coldReturnHasNoCredentialAuthorityTest = initWith(false, false).then(receive("success")).then(runWorker)
    .expect(s.retainedNotice and not(s.exchanged) and s.pending == "matching" and safety)
  run staleCredentialCannotConsumeTest = initWith(true, false).then(receive("success")).then(supersedeCredential).then(runWorker)
    .expect(s.outcome == "storage" and s.retirementFence and s.pending == "matching" and not(s.exchanged) and safety)
}
