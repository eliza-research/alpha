/// Cached authorization and exact managed-service route admission are separate decisions.
module ServiceAuthorization {
  type Authorization = {
    owner: int, epoch: int, tokenOwner: int, tokenEpoch: int,
    plan: str, source: str, fallback: str, validFor: int, refresh: str, failures: int,
    signedRefusal: bool, credits: bool, localReady: bool,
    request: str, dispatched: bool, requestOwner: int, requestEpoch: int
  }
  var s: Authorization
  action init = s' = {
    owner: 1, epoch: 0, tokenOwner: 0, tokenEpoch: 0,
    plan: "unknown", source: "none", fallback: "none", validFor: 0, refresh: "idle", failures: 0,
    signedRefusal: false, credits: false, localReady: true,
    request: "none", dispatched: false, requestOwner: 0, requestEpoch: 0
  }
  action beginRefresh = all {
    s.refresh == "idle", s.owner != 0,
    s' = { ...s, refresh: "pending", fallback: "none", tokenOwner: s.owner, tokenEpoch: s.epoch }
  }
  /// An absent signed route permits an authenticated billing snapshot.
  action noSignedToken = all {
    s.refresh == "pending", s.fallback == "none",
    s' = { ...s, fallback: "absent" }
  }
  /// Signed no-plan can be supplemented only by explicit organization-credit mode.
  action signedNoPlan = all {
    s.refresh == "pending", s.fallback == "none",
    s' = { ...s, fallback: "no-plan" }
  }
  action refreshReply(plan: str): bool = all {
    s.refresh == "pending", s.tokenOwner == s.owner, s.tokenEpoch == s.epoch,
    s.fallback == "none", plan.in(Set("active", "past-due", "inactive", "invalid")),
    s' = { ...s, refresh: "idle", plan: plan, source: "signed", failures: 0,
      validFor: if (plan.in(Set("active", "past-due"))) 2 else 0,
      signedRefusal: plan.in(Set("inactive", "invalid")), credits: false }
  }
  action snapshotReply(plan: str): bool = all {
    s.refresh == "pending", s.tokenOwner == s.owner, s.tokenEpoch == s.epoch,
    s.fallback.in(Set("absent", "no-plan")),
    plan.in(Set("active", "past-due", "inactive", "no-plan", "credits")),
    val accepted = s.fallback == "absent" or plan == "credits"
    s' = { ...s, refresh: "idle", fallback: "none", failures: 0,
      plan: if (accepted) plan else "no-plan",
      source: if (not(accepted)) "signed" else if (plan == "credits") "credits" else "snapshot",
      validFor: 0, credits: accepted and plan == "credits", signedRefusal: false }
  }
  action refreshOutage = all {
    s.refresh == "pending",
    val preserveSigned = s.source == "signed" and
      (s.plan.in(Set("active", "past-due")) and s.validFor > 0 or s.plan == "expired")
    s' = { ...s, refresh: "idle", fallback: "none",
      failures: if (s.failures < 2) s.failures + 1 else 2,
      plan: if (s.fallback == "no-plan") "no-plan" else if (preserveSigned) s.plan else "unavailable",
      source: if (s.fallback == "no-plan") "signed" else s.source,
      validFor: if (s.fallback == "no-plan") 0 else s.validFor,
      signedRefusal: false, credits: false }
  }
  /// Snapshot/credit views have no signed lifetime. Their refresh timer is independent.
  action tick = all {
    s.source == "signed", s.validFor > 0,
    s' = { ...s, validFor: s.validFor - 1,
      plan: if (s.validFor == 1) "expired" else s.plan }
  }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      refresh: "idle", plan: "unknown", source: "none", fallback: "none", validFor: 0, credits: false,
      signedRefusal: false, dispatched: false, request: "none" }
  }
  pure def allowedRoute(route: str): bool = route.in(Set("identity", "maps", "gmail", "calendar", "self-revoke"))
  val inferenceAdmitted = s.plan.in(Set("active", "past-due")) and
    (s.source == "snapshot" or s.validFor > 0) or s.credits
  /// This is transport route admission. Cloud still authorizes every service request.
  action serviceRequest(route: str, serverAllows: bool): bool = all {
    allowedRoute(route), serverAllows, s.owner != 0,
    s' = { ...s, request: route, dispatched: true,
      requestOwner: s.owner, requestEpoch: s.epoch }
  }
  action rejectRoute(route: str): bool = all { not(allowedRoute(route)), s' = s }
  action stopRefresh = all { s.refresh == "pending", s' = { ...s, refresh: "idle", fallback: "none" } }
  action step = any {
    beginRefresh, noSignedToken, signedNoPlan, refreshReply("active"), refreshReply("past-due"),
    refreshReply("inactive"), refreshReply("invalid"), snapshotReply("active"), snapshotReply("past-due"),
    snapshotReply("inactive"), snapshotReply("no-plan"), snapshotReply("credits"), refreshOutage,
    tick, switchOwner, serviceRequest("maps", true), serviceRequest("gmail", true),
    serviceRequest("calendar", true), rejectRoute("hosted-agent"), stopRefresh, s' = s
  }
  val RefusalNotUpgraded = s.signedRefusal implies not(s.credits)
  val ExpiryHonest = s.source == "signed" and s.plan.in(Set("active", "past-due")) implies s.validFor > 0
  val SnapshotHasNoSignedLifetime = s.source.in(Set("snapshot", "credits")) implies s.validFor == 0
  val CanonicalCreditView = s.credits implies s.source == "credits" and s.plan == "credits"
  val LocalIndependent = s.localReady
  val ExactManagedRoute = s.dispatched implies allowedRoute(s.request)
  val CurrentDispatch = s.dispatched implies s.requestOwner == s.owner and s.requestEpoch == s.epoch
  val TypeOK = s.plan.in(Set("unknown", "unavailable", "active", "past-due", "inactive", "invalid", "no-plan", "credits", "expired"))
    and s.source.in(Set("none", "signed", "snapshot", "credits"))
    and s.fallback.in(Set("none", "absent", "no-plan"))
    and s.refresh.in(Set("idle", "pending")) and s.epoch.in(0.to(2)) and s.validFor.in(0.to(2)) and s.failures.in(0.to(2))
  val safety = TypeOK and RefusalNotUpgraded and ExpiryHonest and SnapshotHasNoSignedLifetime and
    CanonicalCreditView and LocalIndependent and ExactManagedRoute and CurrentDispatch

  run signedExpiryTest = init.then(beginRefresh).then(refreshReply("active"))
    .then(tick).then(tick).expect(s.plan == "expired" and not(inferenceAdmitted) and safety)
  run localOutageTest = init.then(beginRefresh).then(refreshOutage)
    .then(rejectRoute("hosted-agent")).expect(s.localReady and not(s.dispatched) and safety)
  run refusalTest = init.then(beginRefresh).then(refreshReply("invalid"))
    .expect(s.signedRefusal and not(s.credits) and safety)
  run ownerChangeTest = init.then(serviceRequest("gmail", true)).then(switchOwner)
    .expect(not(s.dispatched) and safety)
  run snapshotWithoutExpiryTest = init.then(beginRefresh).then(noSignedToken).then(snapshotReply("active"))
    .expect(inferenceAdmitted and s.validFor == 0 and safety)
    .then(beginRefresh).then(refreshOutage).expect(s.plan == "unavailable" and not(inferenceAdmitted) and safety)
  run creditRefreshFailureTest = init.then(beginRefresh).then(noSignedToken).then(snapshotReply("credits"))
    .then(beginRefresh).then(refreshOutage).expect(not(s.credits or inferenceAdmitted) and s.plan == "unavailable" and safety)
  run signedNoPlanCreditOnlyTest = init.then(beginRefresh).then(signedNoPlan).then(snapshotReply("active"))
    .expect(s.plan == "no-plan" and not(inferenceAdmitted)).then(beginRefresh).then(signedNoPlan)
    .then(snapshotReply("credits")).expect(s.credits and inferenceAdmitted and safety)
  run signedOutageKeepsUnexpiredTest = init.then(beginRefresh).then(refreshReply("active"))
    .then(beginRefresh).then(refreshOutage).expect(s.plan == "active" and inferenceAdmitted and safety)
}
