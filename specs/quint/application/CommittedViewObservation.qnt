// A settled manual-view observation across the renderer and host waiter.
module CommittedViewObservation {
  type State = {view: str, hidden: bool, session: bool, disposed: bool, cacheView: str,
    accepted: bool, returned: str, host: str, lastReply: str, prepares: int, claims: int, replies: int, history: int}
  var s: State
  action init = s' = {view: "calendar", hidden: false, session: true, disposed: false, cacheView: "",
    accepted: false, returned: "none", host: "none", lastReply: "none", prepares: 0, claims: 0, replies: 0, history: 0}

  val modes = Set("unchanged", "before", "after", "deadline", "disposed", "retired", "retired-after-claim",
    "lost-prepare", "invalid-binding", "claim-lost", "cleanup-denied", "cleanup-retired",
    "installation-retired", "bad-nonce", "positive-lost", "negative-lost", "superseded-claim")
  val changesView = Set("before", "after", "cleanup-denied", "cleanup-retired",
    "installation-retired", "bad-nonce", "negative-lost", "superseded-claim")
  val unclaimed = Set("retired", "lost-prepare", "invalid-binding")
  val positive = Set("unchanged", "positive-lost")
  val negative = Set("before", "after", "deadline", "disposed", "negative-lost", "superseded-claim")
  val rejected = Set("installation-retired", "bad-nonce")
  val retires = Set("retired", "retired-after-claim", "cleanup-retired")

  action setView(view: str): bool = all {view.in(Set("calendar","settings")), s' = {...s, view: view}}
  action hide(hidden: bool): bool = s' = {...s, hidden: hidden}
  action observe(mode: str, retry: bool): bool = all {
    modes.contains(mode), s.prepares < 2, s.host != "pending",
    changesView.contains(mode) implies s.view == "calendar",
    val unavailable = s.hidden or not(s.session) or s.disposed
    val cached = s.cacheView == s.view and (not(retry) or s.accepted)
    val sent = positive.contains(mode) or negative.contains(mode) or rejected.contains(mode)
    val outcome = if (positive.contains(mode)) "positive" else if (negative.contains(mode)) "negative" else "pending"
    s' = if (unavailable) {...s, returned: "false"}
      else if (cached) {...s, returned: if (s.accepted) "true" else "false"}
      else {...s,
        cacheView: s.view, view: if (changesView.contains(mode)) "settings" else s.view,
        hidden: s.hidden or mode == "superseded-claim", session: not(retires.contains(mode)),
        disposed: mode == "disposed", accepted: mode == "unchanged",
        returned: if (mode == "unchanged") "true" else "false", host: outcome,
        prepares: s.prepares + 1, claims: s.claims + (if (unclaimed.contains(mode)) 0 else 1),
        replies: s.replies + (if (sent) 1 else 0),
        history: s.history + (if (outcome == "positive") 1 else 0),
        lastReply: if (positive.contains(mode)) "positive" else if (sent) "negative" else s.lastReply},
  }
  action expire = all {s.host == "pending", s' = {...s, host: "timeout"}}
  action step = any {
    setView("calendar"), setView("settings"), hide(true), hide(false), expire,
    {nondet mode = modes.oneOf(); nondet retry = Set(true,false).oneOf(); observe(mode,retry)},
    s' = s,
  }
  val RepliesFollowClaim = s.replies <= s.claims and s.claims <= s.prepares
  val HistoryFollowsHostCommit = s.history <= s.replies
  val AcceptedObservationHasHostCommit = s.accepted implies (s.host == "positive" and s.lastReply == "positive")
  val safety = RepliesFollowClaim and HistoryFollowsHostCommit and AcceptedObservationHasHostCommit

  run exactSuccessCachesOneReceiptTest = init.then(observe("unchanged",false)).then(observe("unchanged",false))
    .expect(s.history == 1 and s.prepares == 1 and s.returned == "true" and safety)
  run staleClaimSettlesNegativeTest = init.then(observe("after",false))
    .expect(s.host == "negative" and s.lastReply == "negative" and s.history == 0 and safety)
  run lostClaimWaitsForGenuineTimeoutTest = init.then(observe("claim-lost",false)).then(expire)
    .expect(s.host == "timeout" and s.replies == 0 and s.history == 0 and safety)
  run lostPositiveNeverSendsOppositeReceiptTest = init.then(observe("positive-lost",false)).then(observe("unchanged",false))
    .expect(s.returned == "false" and s.history == 1 and s.replies == 1 and safety)
  run supersededClaimReleasesNextObservationTest = init.then(observe("superseded-claim",false)).then(hide(false))
    .then(observe("unchanged",false)).expect(s.history == 1 and s.prepares == 2 and s.returned == "true" and safety)
  run failedCacheRequiresExplicitRetryTest = init.then(observe("invalid-binding",false)).then(expire)
    .then(observe("unchanged",false)).then(observe("unchanged",true))
    .expect(s.history == 1 and s.prepares == 2 and s.returned == "true" and safety)
}
