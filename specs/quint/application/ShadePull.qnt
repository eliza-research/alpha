/// A downward pull on empty Home and the one notification surface it reaches: Android's own
/// shade on the launcher, the development stand-in in a browser build, a truthful fallback
/// anywhere else. Android's answer is awaited for a bounded time.
module ShadePull {
  type State = {
    // The build's surface: "android", "simulated" or "none".
    surface: str,
    mounted: bool, home: bool, secure: bool,
    // The overflow-pull listeners exist only while Home is showing.
    listening: bool,
    // The request being waited for, and requests Android still owns after their wait ended.
    asking: bool, waiting: bool, late: int,
    standIn: bool,
    requests: int, fallbacks: int, opened: int, ignoredPulls: int
  }
  var s: State

  pure val Surfaces = Set("android", "simulated", "none")
  pure def more(n: int): int = if (n < 3) n + 1 else 3
  pure def watched(v: State): State = { ...v, listening: v.mounted and v.home }

  action initWith(surface: str): bool = all { surface.in(Surfaces),
    s' = { surface: surface, mounted: true, home: true, secure: false, listening: true, asking: false,
      waiting: false, late: 0, standIn: false, requests: 0, fallbacks: 0, opened: 0, ignoredPulls: 0 } }
  action init = { nondet surface = Surfaces.oneOf() initWith(surface) }
  action leaveHome = all { s.mounted, s.home, s' = watched({ ...s, home: false, standIn: false }) }
  action showHome = all { s.mounted, not(s.home), s' = watched({ ...s, home: true }) }
  action secureHome(flag: bool): bool = all { s.mounted, s' = { ...s, secure: flag } }
  action unmount = all { s.mounted, s' = watched({ ...s, mounted: false, standIn: false }) }
  /// A pull while Android is still being asked is ignored; a locked Home shows no notifications.
  action pull = all { s.mounted, s.home, not(s.standIn),
    s' = if (s.secure) { ...s, fallbacks: more(s.fallbacks) }
      else if (s.surface == "android")
        (if (s.asking or s.requests == 3) { ...s, ignoredPulls: more(s.ignoredPulls) }
         else { ...s, asking: true, waiting: true, requests: s.requests + 1 })
      else if (s.surface == "simulated") { ...s, standIn: true }
      else { ...s, fallbacks: more(s.fallbacks) } }
  action closeStandIn = all { s.standIn, s' = { ...s, standIn: false } }
  /// Android answers in time: only an opened shade passes without a message.
  action answer(openedShade: bool): bool = all { s.waiting,
    s' = { ...s, asking: false, waiting: false,
      opened: if (openedShade) more(s.opened) else s.opened,
      fallbacks: if (openedShade or not(s.mounted)) s.fallbacks else more(s.fallbacks) } }
  /// The wait ends: the pull reads as unsupported and later pulls are taken again.
  action waitEnds = all { s.waiting,
    s' = { ...s, asking: false, waiting: false, late: s.late + 1, fallbacks: if (s.mounted) more(s.fallbacks) else s.fallbacks } }
  /// Android still owns the request; its late answer changes nothing on the page.
  action lateAnswer = all { s.late > 0, s' = { ...s, late: s.late - 1 } }
  action step = {
    nondet flag = Set(true, false).oneOf()
    any { leaveHome, showHome, secureHome(flag), unmount, pull, closeStandIn, answer(flag), waitEnds, lateAnswer, s' = s }
  }

  /// One surface per build: Android is never asked where the stand-in is drawn, and no build
  /// without the stand-in draws it.
  val OneShade = (s.standIn implies s.surface == "simulated") and (s.requests > 0 implies s.surface == "android")
  val AskingIsBounded = s.asking == s.waiting
  val ListenersOnlyOnHome = s.listening == (s.mounted and s.home)
  val StandInOverHome = s.standIn implies s.mounted and s.home
  val RequestsAccounted = s.requests >= s.opened + s.late + (if (s.waiting) 1 else 0) and s.requests <= 3
  val safety = OneShade and AskingIsBounded and ListenersOnlyOnHome and StandInOverHome and RequestsAccounted

  val UnansweredRequestWitness = s.late > 0 and s.asking and s.fallbacks > 0
  val IgnoredPullWitness = s.ignoredPulls > 0 and s.asking
  val StandInWitness = s.standIn
  val AndroidOpenedWitness = s.opened > 0 and s.fallbacks == 0

  // Android never answers: the fallback is shown and the next pull is taken.
  run unansweredRequestReleasesPullTest = initWith("android").then(pull).expect(s.asking)
    .then(pull).expect(s.requests == 1 and s.ignoredPulls == 1)
    .then(waitEnds).expect(not(s.asking) and s.fallbacks == 1 and safety)
    .then(pull).expect(s.asking and s.requests == 2 and s.late == 1 and safety)
    .then(lateAnswer).expect(s.asking and s.late == 0 and s.opened == 0 and safety)
  run openedShadeIsSilentTest = initWith("android").then(pull).then(answer(true))
    .expect(not(s.asking) and s.opened == 1 and s.fallbacks == 0 and safety)
  run refusedShadeSaysSoTest = initWith("android").then(pull).then(answer(false))
    .expect(s.opened == 0 and s.fallbacks == 1 and safety)
  run browserBuildDrawsStandInTest = initWith("simulated").then(pull)
    .expect(s.standIn and s.requests == 0 and safety).then(leaveHome).expect(not(s.standIn) and not(s.listening) and safety)
  run standaloneHasNoShadeTest = initWith("none").then(pull)
    .expect(not(s.standIn) and s.requests == 0 and s.fallbacks == 1 and safety)
  run lockedHomeShowsNoNotificationsTest = initWith("android").then(secureHome(true)).then(pull)
    .expect(s.requests == 0 and s.fallbacks == 1 and safety)
  run pullNeedsHomeTest = initWith("android").then(leaveHome).then(pull.fail())
}
