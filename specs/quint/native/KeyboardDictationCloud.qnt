// One explicit native dictation request under a captured selected voice route.
module KeyboardDictationCloud {
  type State = { route: str, phase: str, authority: bool, provider: bool, account: bool,
    password: bool, expired: bool, cancelled: bool, connection: bool, requests: int,
    sent: int, zeroed: bool, disconnected: bool, accepted: bool }
  var s: State
  pure def initial(route: str): State = {route: route, phase: "ready", authority: true,
    provider: true, account: true, password: false, expired: false, cancelled: false,
    connection: false, requests: 0, sent: 0, zeroed: false, disconnected: false, accepted: false}
  action initCloud = s' = initial("cloud")
  action initDirect = s' = initial("direct")
  action init = any {initCloud, initDirect}
  pure def current(st: State): bool = st.authority and st.provider and not(st.password)
    and not(st.cancelled) and (st.route == "direct" or (st.account and not(st.expired)))
  action mutate(kind: str): bool = all {
    kind.in(Set("authority", "provider", "account", "password", "expiry", "cancel")),
    s' = {...s,
      authority: s.authority and kind != "authority", provider: s.provider and kind != "provider",
      account: s.account and kind != "account", password: s.password or kind == "password",
      expired: s.expired or kind == "expiry", cancelled: s.cancelled or kind == "cancel",
      disconnected: s.disconnected or (kind == "cancel" and s.connection)},
  }
  action begin = all {s.phase == "ready", current(s),
    s' = {...s, phase: "response", connection: true, requests: 1, sent: 1}}
  action rejectBeforeRequest = all {s.phase == "ready", not(current(s)),
    s' = {...s, phase: "done"}}
  action settle(httpOk: bool, validText: bool, providerHeader: bool): bool = all {
    s.phase == "response",
    s' = {...s, phase: "done", connection: false, zeroed: true, disconnected: true,
      accepted: httpOk and validText and (s.route == "direct" or providerHeader) and current(s)},
  }
  action step = any {begin, rejectBeforeRequest,
    {nondet kind = Set("authority", "provider", "account", "password", "expiry", "cancel").oneOf(); mutate(kind)},
    {nondet httpOk = Bool.oneOf(); nondet valid = Bool.oneOf(); nondet header = Bool.oneOf(); settle(httpOk, valid, header)}, s' = s}
  val safety = (s.accepted implies (s.phase == "done" and s.sent == 1 and s.zeroed and s.disconnected))
    and (s.phase == "done" and s.sent == 1 implies not(s.connection) and s.zeroed)
  run cloudSuccessTest = initCloud.then(begin).then(settle(true,true,true)).expect(s.accepted and safety)
  run providerSwitchRefusesResultTest = initDirect.then(begin).then(mutate("provider"))
    .then(settle(true,true,true)).expect(not(s.accepted) and safety)
  run cancelledConnectionCleansUpTest = initCloud.then(begin).then(mutate("cancel"))
    .then(settle(true,true,true)).expect(not(s.accepted) and s.disconnected and safety)
  run changedAccountCannotStartTest = initCloud.then(mutate("account")).then(rejectBeforeRequest)
    .expect(s.requests == 0 and not(s.accepted) and safety)
  run directDoesNotBorrowCloudAccountTest = initDirect.then(mutate("account")).then(begin)
    .then(settle(true,true,true)).expect(s.accepted and safety)
  run malformedReplyStillWipesAudioTest = initCloud.then(begin).then(settle(true,false,true))
    .expect(not(s.accepted) and s.zeroed and safety)
}
