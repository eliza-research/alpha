module CloudConnectionNotices {
  pure val kinds = Set("plan", "sign-in")
  type State = { required: Set[str], dismissed: Set[str], settings: bool,
    compact: bool, largeText: bool }
  var s: State
  action init = s' = { required: kinds, dismissed: Set(), settings: false,
    compact: false, largeText: false }

  val mounted = s.required.exclude(s.dismissed)
  val exposed = if (s.settings) Set() else mounted
  val order = List("plan", "sign-in").select(kind => kind.in(exposed))
  action enterSettings = all { not(s.settings), s' = {...s, settings: true} }
  action leaveSettings = all { s.settings, s' = {...s, settings: false} }
  action dismiss(kind: str): bool = all {
    kind.in(exposed),
    s' = {...s, dismissed: s.dismissed.union(Set(kind))},
  }
  action compact = all { not(s.compact), s' = {...s, compact: true} }
  action largeText = all { not(s.largeText), s' = {...s, largeText: true} }
  action step = any {
    enterSettings, leaveSettings, dismiss("plan"), dismiss("sign-in"), compact, largeText, s' = s
  }
  val ExactDismissal = s.dismissed.subseteq(s.required) and mounted.intersect(s.dismissed) == Set()
  val SettingsOwnership = if (s.settings) exposed == Set() else exposed == mounted
  val RenderOrder = order.length() == exposed.size() and s.required == kinds
  val safety = ExactDismissal and SettingsOwnership and RenderOrder

  run simultaneousNoticesSuspendAndReturnTest = init.then(enterSettings)
    .expect(safety and mounted == kinds and exposed == Set())
    .then(leaveSettings).expect(safety and order == ["plan", "sign-in"])
  run dismissPlanKeepsExactSignInTest = init.then(compact).then(largeText)
    .then(dismiss("plan")).then(enterSettings).then(leaveSettings)
    .expect(safety and order == ["sign-in"] and s.dismissed == Set("plan"))
  run dismissSignInKeepsExactPlanTest = init.then(dismiss("sign-in")).then(enterSettings).then(leaveSettings)
    .expect(safety and order == ["plan"] and s.dismissed == Set("sign-in"))
}
