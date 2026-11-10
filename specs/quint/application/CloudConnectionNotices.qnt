module CloudConnectionNotices {
  pure val kinds = Set("plan", "sign-in")
  type State = { required: Set[str], dismissed: Set[str], covered: bool,
    compact: bool, largeText: bool }
  var s: State
  action init = s' = { required: kinds, dismissed: Set(), covered: false,
    compact: false, largeText: false }

  val mounted = s.required.exclude(s.dismissed)
  val exposed = if (s.covered) Set() else mounted
  val order = List("plan", "sign-in").select(kind => kind.in(exposed))
  action coverScreen = all { not(s.covered), s' = {...s, covered: true} }
  action returnHome = all { s.covered, s' = {...s, covered: false} }
  action dismiss(kind: str): bool = all {
    kind.in(exposed),
    s' = {...s, dismissed: s.dismissed.union(Set(kind))},
  }
  action compact = all { not(s.compact), s' = {...s, compact: true} }
  action largeText = all { not(s.largeText), s' = {...s, largeText: true} }
  action step = any {
    coverScreen, returnHome, dismiss("plan"), dismiss("sign-in"), compact, largeText, s' = s
  }
  val ExactDismissal = s.dismissed.subseteq(s.required) and mounted.intersect(s.dismissed) == Set()
  val ForegroundOwnership = if (s.covered) exposed == Set() else exposed == mounted
  val RenderOrder = order.length() == exposed.size() and s.required == kinds
  val safety = ExactDismissal and ForegroundOwnership and RenderOrder

  run simultaneousNoticesSuspendAndReturnTest = init.then(coverScreen)
    .expect(safety and mounted == kinds and exposed == Set())
    .then(returnHome).expect(safety and order == ["plan", "sign-in"])
  run dismissPlanKeepsExactSignInTest = init.then(compact).then(largeText)
    .then(dismiss("plan")).then(coverScreen).then(returnHome)
    .expect(safety and order == ["sign-in"] and s.dismissed == Set("plan"))
  run dismissSignInKeepsExactPlanTest = init.then(dismiss("sign-in")).then(coverScreen).then(returnHome)
    .expect(safety and order == ["plan"] and s.dismissed == Set("sign-in"))
}
