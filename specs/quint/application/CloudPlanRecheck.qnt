/// One minute is one clock step. Failed server reads do not create network-return permits.
module CloudPlanRecheck {
  type State = { online: bool, visible: bool, scope: int, lost: int,
    clock: int, last: int, reading: bool, startedOffline: bool, reads: int }
  var s: State
  action init = s' = { online: true, visible: true, scope: 0, lost: -1,
    clock: 0, last: -1, reading: false, startedOffline: false, reads: 0 }
  action network(online: bool): bool = s' = if (online == s.online) s else
    { ...s, online: online, lost: if (online) s.lost else s.scope }
  action visibility(visible: bool): bool = s' = { ...s, visible: visible }
  action replaceScope = s' = { ...s, scope: 1, reading: false, lost: -1 }
  action minute = all { s.clock < 2, s' = { ...s, clock: s.clock + 1 } }
  action request = s' = if (s.visible and not(s.reading) and s.reads < 4
    and (s.last < s.clock or (s.online and s.lost == s.scope)))
      { ...s, reading: true, startedOffline: not(s.online), reads: s.reads + 1,
        last: s.clock, lost: if (s.online) -1 else s.lost } else s
  action settle = s' = if (s.reading) { ...s, reading: false,
    lost: if (s.startedOffline) s.scope else s.lost } else s
  action cancelForOwnerAction = s' = { ...s, reading: false, last: -1 }
  action step = any { network(false), network(true), visibility(false), visibility(true),
    replaceScope, minute, request, settle, cancelForOwnerAction }
  val safety = s.reads >= 0 and s.reads <= 4 and s.last <= s.clock
    and s.lost.in(Set(-1, 0, 1)) and (not(s.reading) or s.reads > 0)
  run serverOutageKeepsRetryClockTest = init.then(request).then(settle).then(request)
    .expect(s.reads == 1 and safety).then(minute).then(request).expect(s.reads == 2 and safety)
  run realNetworkReturnAllowsOneImmediateCheckTest = init.then(request).then(settle)
    .then(network(false)).then(network(true)).then(request).then(settle).then(request)
    .expect(s.reads == 2 and safety)
  run backgroundNetworkReturnWaitsForVisibilityTest = init.then(request).then(settle)
    .then(visibility(false)).then(network(false)).then(network(true)).then(request)
    .expect(s.reads == 1).then(visibility(true)).then(request).expect(s.reads == 2 and safety)
  run changedScopeCannotSpendOldNetworkPermitTest = init.then(request).then(settle)
    .then(network(false)).then(network(true)).then(replaceScope).then(request)
    .expect(s.reads == 1 and safety)
}
