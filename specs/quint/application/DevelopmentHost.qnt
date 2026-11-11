/// Browser Cloud bridge private-store transactions, request fencing and resident retirement.
module DevelopmentHost {
  type State = { environment: str, credential: int, previous: int, claim: int,
    loginPending: bool, expired: bool, host: str, bound: int, generation: int,
    active: Set[int], requestOwners: int -> int, repliedOwner: int,
    retiring: bool, closed: bool, childCount: int, stopping: bool }
  var s: State
  action init = {
    nondet environment = Set("production", "staging").oneOf()
    s' = { environment: environment, credential: 0, previous: 0, claim: 0,
    loginPending: false, expired: false, host: "stopped", bound: 0, generation: 0,
    active: Set(), requestOwners: Map(1 -> 0, 2 -> 0), repliedOwner: 0,
    retiring: false, closed: false, childCount: 2, stopping: false }
  }
  action beginLogin = all { not(s.closed), not(s.loginPending),
    s' = { ...s, loginPending: true, previous: s.credential, claim: 0 } }
  action receiveClaim = all { s.loginPending, s.previous == s.credential, s.credential < 2,
    s' = { ...s, claim: s.credential + 1, loginPending: false } }
  action retireResident = all { not(s.closed), not(s.retiring),
    s' = { ...s, retiring: true, host: "retiring", repliedOwner: 0 } }
  action stopped = all { s.retiring,
    s' = { ...s, retiring: false, host: "stopped", bound: 0 } }
  action commitCredential = all { not(s.closed), s.claim > 0, s.previous == s.credential,
    not(s.retiring), s.host == "stopped", s.generation < 2,
    s' = { ...s, credential: s.claim, claim: 0, expired: false,
      generation: s.generation + 1, active: Set(), repliedOwner: 0 } }
  action bind = all { not(s.closed), not(s.retiring), s.credential > 0, not(s.expired),
    s.host == "stopped", s' = { ...s, host: "starting", bound: s.credential } }
  action ready = all { s.host == "starting", s.bound == s.credential, not(s.expired),
    s' = { ...s, host: "ready" } }
  action request(id: int): bool = all { not(s.closed), s.credential > 0, not(s.expired),
    not(s.active.contains(id)), s.active.size() < 2,
    s' = { ...s, active: s.active.union(Set(id)), requestOwners: s.requestOwners.set(id, s.credential) } }
  action response(id: int): bool = all { s.active.contains(id), not(s.expired),
    s.requestOwners.get(id) == s.credential,
    s' = { ...s, active: s.active.exclude(Set(id)), repliedOwner: s.credential } }
  action cancel(id: int): bool = s' = { ...s, active: s.active.exclude(Set(id)) }
  action expire = s' = { ...s, expired: true, bound: 0, host: "stopped", active: Set(), repliedOwner: 0 }
  action signOut = all { not(s.retiring), s.host == "stopped", s.generation < 2,
    s' = { ...s, credential: 0, claim: 0, loginPending: false, active: Set(),
      repliedOwner: 0, generation: s.generation + 1 } }
  action childFailed = all { s.childCount > 0,
    s' = { ...s, stopping: true, childCount: s.childCount - 1 } }
  action stopChildren = s' = { ...s, stopping: true, childCount: 0 }
  action close = all { s.host == "stopped", s' = { ...s, closed: true, active: Set(), loginPending: false } }
  action step = {
    nondet id = Set(1, 2).oneOf()
    any { beginLogin, receiveClaim, retireResident, stopped, commitCredential, bind, ready,
      request(id), response(id), cancel(id), expire, signOut, childFailed, stopChildren, close, s' = s }
  }
  val BoundedRequests = s.active.size() <= 2
  val CurrentResponse = s.repliedOwner == 0 or s.repliedOwner == s.credential
  val ReadyBinding = s.host == "ready" implies s.bound == s.credential and not(s.expired) and not(s.retiring)
  /// A claim is only ever the successor of the credential it was requested against.
  val ClaimSucceedsCredential = s.claim == 0 or s.claim == s.previous + 1
  val ActiveRequestsOwned = s.active.forall(id => s.requestOwners.get(id) != 0)
  val ClosedIsQuiet = s.closed implies s.host == "stopped" and not(s.loginPending)
  val TypeOK = s.host.in(Set("stopped", "starting", "ready", "retiring")) and s.credential.in(0.to(2))
    and s.generation.in(0.to(2)) and s.childCount.in(0.to(2))
  val safety = TypeOK and BoundedRequests and CurrentResponse and ReadyBinding and ClaimSucceedsCredential and
    ActiveRequestsOwned and ClosedIsQuiet
  val ReadyWitness = s.host == "ready" and s.bound != 0
  val ClaimHeldWhileRetiringWitness = s.claim != 0 and s.retiring
  val RequestInFlightWitness = s.active.size() > 0 and s.host == "ready"
  run claimedSignInTest = init.then(beginLogin).then(receiveClaim).then(commitCredential).then(bind).then(ready)
    .expect(s.host == "ready" and s.bound == 1 and safety)
  run replacementAbortsRequestsTest = init.then(beginLogin).then(receiveClaim).then(commitCredential)
    .then(bind).then(ready).then(request(1)).then(beginLogin).then(receiveClaim)
    .then(retireResident).then(stopped).then(commitCredential)
    .expect(s.credential == 2 and s.active.size() == 0 and safety)
  run failedRetirementStopsReplacementTest = init.then(retireResident).expect(s.retiring and s.host == "retiring" and safety)
  run expiryStopsInferenceTest = init.then(beginLogin).then(receiveClaim).then(commitCredential).then(bind).then(ready)
    .then(expire).expect(s.bound == 0 and s.host == "stopped" and safety)
  run childrenStopTogetherTest = init.then(childFailed).then(stopChildren).expect(s.childCount == 0 and s.stopping and safety)
}
