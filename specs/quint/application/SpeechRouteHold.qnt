/// The speech route chosen at run time (`speechRoute`) and the hold a failed network speech request
/// places on it (`noteNetworkSpeechFailure`): the owner's own provider with a speech key, Cloud
/// speech for a signed-in account with no limit in force, otherwise this phone. A failure of the
/// network route moves the turn to on-device speech and keeps the next turns there for a time that
/// depends on the failure; the hold belongs to one account or key, lapses on its own, and is
/// dropped when on-device speech turns out to be unavailable. A failure that is not the network's
/// changes nothing. Time is in minutes.
module SpeechRouteHold {
  type State = { account: str, limited: bool, now: int, holdKey: str, holdUntil: int, route: str, lastKind: str,
    fell: bool, failures: int }
  var s: State
  pure val BRIEF = 1
  pure val ACCOUNT = 10
  pure val MAX = 60
  // The account or key a hold belongs to. Own keys without a speech key have none.
  pure def keyOf(account: str): str = if (account.in(Set("none", "directNoKey"))) "" else account
  pure def held(st: State): bool = st.holdKey != "" and st.holdKey == keyOf(st.account) and st.holdUntil > st.now
  pure def route(st: State): str =
    if (keyOf(st.account) == "" or held(st)) "device"
    else if (st.account.in(Set("direct1", "direct2"))) "direct"
    else if (st.limited) "device" else "cloud"
  // Minutes a failure keeps speech on this phone; -1 when the failure is not the network route's.
  // A rate limit holds for its stated wait, at most an hour, and briefly when none is stated.
  pure def holdFor(kind: str, wait: int): int =
    if (kind.in(Set("offline", "server"))) BRIEF
    else if (kind == "account") ACCOUNT
    else if (kind == "rate") (if (wait <= 0) BRIEF else if (wait > MAX) MAX else wait)
    else if (kind == "signIn") 0
    else -1
  // Every step ends with the route speechRoute() would now return.
  pure def routed(st: State): State = { ...st, route: route(st) }

  action init = s' = { account: "none", limited: false, now: 0, holdKey: "", holdUntil: 0, route: "device",
    lastKind: "none", fell: false, failures: 0 }
  // Sign-in, sign-out, another Cloud account, own keys with or without a speech key, a changed key.
  action accountChanges(account: str): bool = all { account != s.account, s' = routed({ ...s, account: account }) }
  // A Cloud plan or rate limit is recorded for the account, or cleared.
  action limitChanges(limited: bool): bool = all { limited != s.limited, s' = routed({ ...s, limited: limited }) }
  action timePasses(minutes: int): bool = all { s.now + minutes <= 150, s' = routed({ ...s, now: s.now + minutes }) }
  // A network speech request failed. The turn falls back to on-device speech when the failure is
  // the network route's; a hold is recorded only for a known account or key and a positive time.
  action failure(kind: str, wait: int): bool = all { s.failures < 6,
    val hold = holdFor(kind, wait)
    val key = keyOf(s.account)
    s' = routed({ ...s, lastKind: kind, fell: hold >= 0, failures: s.failures + 1,
      holdKey: if (hold > 0 and key != "") key else s.holdKey,
      holdUntil: if (hold > 0 and key != "") s.now + hold else s.holdUntil }) }
  // On-device speech is unavailable: the network route is all there is.
  action clearHold = all { s.holdKey != "", s' = routed({ ...s, holdKey: "", holdUntil: 0 }) }
  action step = {
    nondet account = Set("none", "cloudA", "cloudB", "direct1", "direct2", "directNoKey").oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet minutes = Set(1, 9, 50).oneOf()
    nondet kind = Set("cancelled", "noSpeech", "refusedBody", "offline", "server", "account", "signIn", "rate").oneOf()
    nondet wait = Set(0, 3, 120).oneOf()
    any { accountChanges(account), limitChanges(flag), timePasses(minutes), failure(kind, wait), clearHold, s' = s }
  }

  val RouteIsCurrent = s.route == route(s)
  val NoAccountIsDevice = keyOf(s.account) == "" implies route(s) == "device"
  val HeldAccountIsDevice = held(s) implies route(s) == "device"
  // The phone is chosen only for a reason: no account or key, a hold for this one, or a Cloud limit.
  val DeviceHasReason = route(s) == "device" implies
    (keyOf(s.account) == "" or held(s) or (s.account.in(Set("cloudA", "cloudB")) and s.limited))
  val OwnKeyIgnoresCloudLimit = (s.account.in(Set("direct1", "direct2")) and not(held(s))) implies route(s) == "direct"
  val HoldIsBounded = s.holdUntil <= s.now + MAX and (s.holdKey == "") == (s.holdUntil == 0)
  val FallbackNeedsNetworkFailure = s.fell == s.lastKind.in(Set("offline", "server", "account", "signIn", "rate"))
  val safety = RouteIsCurrent and NoAccountIsDevice and HeldAccountIsDevice and DeviceHasReason and OwnKeyIgnoresCloudLimit and
    HoldIsBounded and FallbackNeedsNetworkFailure

  val HoldLapsedWitness = s.holdKey == "cloudA" and s.account == "cloudA" and s.holdUntil <= s.now and route(s) == "cloud"
  val OtherAccountNotHeldWitness = s.holdKey == "cloudA" and s.holdUntil > s.now and s.account == "cloudB" and route(s) == "cloud"
  val CappedWaitWitness = s.holdUntil == s.now + MAX and s.lastKind == "rate"
  val SignInFallsBackWithoutHoldWitness = s.fell and s.lastKind == "signIn" and s.holdKey == "" and route(s) == "cloud"
  val OwnKeyHeldWitness = s.account == "direct1" and held(s) and s.limited == false
  val ChangedKeyNotHeldWitness = s.holdKey == "direct1" and s.holdUntil > s.now and s.account == "direct2" and route(s) == "direct"

  run briefHoldLapsesTest = init.then(accountChanges("cloudA")).expect(route(s) == "cloud" and safety)
    .then(failure("server", 0)).expect(s.fell and route(s) == "device" and s.holdUntil == 1 and safety)
    .then(timePasses(1)).expect(route(s) == "cloud" and safety)
  run accountRefusalHoldsLongerTest = init.then(accountChanges("cloudA")).then(failure("account", 0))
    .then(timePasses(9)).expect(route(s) == "device" and safety).then(timePasses(1)).expect(route(s) == "cloud" and safety)
  run rateLimitHoldsForStatedWaitTest = init.then(accountChanges("cloudA")).then(failure("rate", 3))
    .expect(s.holdUntil == 3 and route(s) == "device" and safety).then(failure("rate", 120))
    .expect(s.holdUntil == 60 and safety).then(failure("rate", 0)).expect(s.holdUntil == 1 and safety)
  run otherAccountIsNotHeldTest = init.then(accountChanges("cloudA")).then(failure("account", 0))
    .then(accountChanges("cloudB")).expect(route(s) == "cloud" and safety)
    .then(accountChanges("cloudA")).expect(route(s) == "device" and safety)
  run ownFailureChangesNothingTest = init.then(accountChanges("cloudA")).then(failure("cancelled", 0))
    .expect(not(s.fell) and route(s) == "cloud" and s.holdKey == "" and safety).then(failure("noSpeech", 0))
    .then(failure("refusedBody", 0)).expect(not(s.fell) and route(s) == "cloud" and s.holdKey == "" and safety)
  run signInFallsBackWithoutHoldTest = init.then(accountChanges("cloudA")).then(failure("signIn", 0))
    .expect(s.fell and s.holdKey == "" and route(s) == "cloud" and safety)
  run signedOutFailureRecordsNoHoldTest = init.then(failure("offline", 0))
    .expect(s.fell and s.holdKey == "" and route(s) == "device" and safety)
    .then(accountChanges("cloudA")).expect(route(s) == "cloud" and safety)
  run clearedHoldReturnsToNetworkTest = init.then(accountChanges("direct1")).then(failure("offline", 0))
    .expect(route(s) == "device" and safety).then(clearHold).expect(route(s) == "direct" and s.holdKey == "" and safety)
  run ownKeyIgnoresCloudLimitTest = init.then(limitChanges(true)).then(accountChanges("cloudA"))
    .expect(route(s) == "device" and safety).then(accountChanges("direct1")).expect(route(s) == "direct" and safety)
    .then(accountChanges("directNoKey")).expect(route(s) == "device" and safety)
}
