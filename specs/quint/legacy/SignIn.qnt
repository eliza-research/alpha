// Faithful translation of docs/flow-redesign-2026-11/tla/SignIn.tla.
module SignIn {
  type State = { Design: str, gms: bool, appLink: bool, stewardOk: bool,
    net: str, cred: str, screen: str, browser: str, method: str,
    offered: Set[str], retryShown: bool, waiting: bool, scopes: Set[str],
    taps: int, detours: int, flips: int }
  var s: State
  val vars = s
  pure val MaxDetours = 2
  pure val MaxFlips = 2
  pure val MaxTaps = 9
  pure val Scopes = Set("gmail", "calendar")
  pure val Screens = Set("Boot", "Gate", "Checking", "Choose", "Google", "Code", "Home")
  pure def googleReady(x: State): bool = if (x.Design == "current") x.appLink and x.stewardOk
    else x.gms or (x.appLink and x.stewardOk)
  pure def localMethods(x: State): Set[str] = Set("email", "phone")
    .union(if (googleReady(x)) Set("google") else Set())
  val GoogleReady = googleReady(s)
  val NativeGoogle = s.Design == "proposed" and s.gms
  val LocalMethods = localMethods(s)
  val TypeOK = Set("up", "down").contains(s.net) and Set("none", "valid", "rejected").contains(s.cred)
    and Screens.contains(s.screen) and Set("none", "google", "returning", "cloudWeb").contains(s.browser)
    and Set("none", "google", "email", "phone").contains(s.method)
    and s.offered.subseteq(Set("google", "email", "phone")) and s.scopes.subseteq(Scopes)
    and s.taps >= 0 and s.taps <= MaxTaps and s.detours >= 0 and s.detours <= MaxDetours
    and s.flips >= 0 and s.flips <= MaxFlips
  pure def initialState(design, gms, appLink, stewardOk, net, cred, scopes) = { Design: design, gms: gms, appLink: appLink, stewardOk: stewardOk,
      net: net, cred: cred, screen: "Boot", browser: "none", method: "none",
      offered: Set(), retryShown: false, waiting: false, scopes: scopes, taps: 0, detours: 0, flips: 0 }
  action StartState(design, gms, appLink, stewardOk, net, cred, scopes) =
    s' = { Design: design, gms: gms, appLink: appLink, stewardOk: stewardOk,
      net: net, cred: cred, screen: "Boot", browser: "none", method: "none",
      offered: Set(), retryShown: false, waiting: false, scopes: scopes, taps: 0, detours: 0, flips: 0 }
  action Init(design) = {
    nondet gms = Bool.oneOf()
    nondet appLink = Bool.oneOf()
    nondet stewardOk = Bool.oneOf()
    nondet net = Set("up", "down").oneOf()
    nondet cred = Set("none", "valid").oneOf()
    nondet scopes = (if (cred == "valid") Scopes.powerset() else Set(Set())).oneOf()
    StartState(design, gms, appLink, stewardOk, net, cred, scopes)
  }
  action checkerInit = {
    nondet gms = Bool.oneOf()
    nondet appLink = Bool.oneOf()
    nondet stewardOk = Bool.oneOf()
    nondet net = Set("up", "down").oneOf()
    nondet cred = Set("none", "valid").oneOf()
    nondet scopes = (if (cred == "valid") Scopes.powerset() else Set(Set())).oneOf()
    s' = initialState("proposed", gms, appLink, stewardOk, net, cred, scopes)
  }
  action checkerCurrentInit = {
    nondet gms = Bool.oneOf()
    nondet appLink = Bool.oneOf()
    nondet stewardOk = Bool.oneOf()
    nondet net = Set("up", "down").oneOf()
    nondet cred = Set("none", "valid").oneOf()
    nondet scopes = (if (cred == "valid") Scopes.powerset() else Set(Set())).oneOf()
    s' = initialState("current", gms, appLink, stewardOk, net, cred, scopes)
  }
  action init = Init("proposed")
  action currentInit = Init("current")
  // Source Tap and Detour are partial updates. These values are inserted in
  // each corresponding simultaneous full-record update.
  val Tap = if (s.taps < MaxTaps) s.taps + 1 else s.taps
  val Detour = s.detours + 1
  action Boot = all { s.screen == "Boot", s' = { ...s,
    screen: if (s.cred == "valid")
      (if (s.Design == "current" and s.net == "down") "Gate" else "Home")
      else (if (s.Design == "current") "Gate" else "Choose"),
    retryShown: s.Design == "current" and s.cred == "valid" and s.net == "down",
    offered: if (s.Design == "proposed" and s.cred != "valid") LocalMethods else Set() } }
  action Probe = all { s.Design == "current", s.screen == "Checking", s' = { ...s,
    screen: "Choose", offered: if (s.net == "up") LocalMethods else Set("email"), retryShown: s.net == "down" } }
  action AutoResume = all { s.Design == "proposed", s.waiting, s.net == "up",
    if (Set("email", "phone").contains(s.method) and s.screen == "Choose")
      s' = { ...s, waiting: false, screen: "Code" }
    else if (s.screen == "Google") {
      nondet scopes = Scopes.powerset().oneOf()
      s' = { ...s, waiting: false, screen: "Home", cred: "valid", scopes: scopes }
    } else s' = { ...s, waiting: false } }
  action GoogleReturn = all { s.screen == "Google", s.browser == "returning", s.net == "up",
    if (s.appLink) {
      nondet scopes = (if (s.Design == "proposed") Scopes.powerset() else Set(s.scopes)).oneOf()
      s' = { ...s, browser: "none", cred: "valid", screen: "Home", scopes: scopes }
    } else s' = { ...s, browser: "cloudWeb" } }
  action KeyRejected = all { s.screen == "Home", s.cred == "valid", s.net == "up", s.detours < MaxDetours,
    s' = { ...s, cred: "rejected", method: "none", detours: Detour,
      screen: if (s.Design == "current") "Gate" else "Choose",
      offered: if (s.Design == "current") Set() else LocalMethods } }
  action NetDrop = all { s.flips < MaxFlips, s.net == "up", s' = { ...s, net: "down", flips: s.flips + 1 } }
  action NetRecover = all { s.net == "down", s' = { ...s, net: "up" } }
  action TapCloudSignIn = all { s.Design == "current", s.screen == "Gate",
    s' = { ...s, taps: Tap, screen: "Checking" } }
  action TapRetry = all { s.Design == "current", s.retryShown,
    any {
      all { s.screen == "Gate", s.cred == "valid", s' = { ...s, taps: Tap,
        screen: if (s.net == "up") "Home" else s.screen,
        retryShown: if (s.net == "up") false else s.retryShown } },
      all { s.screen == "Choose", s' = { ...s, taps: Tap, screen: "Checking", retryShown: false } }
    } }
  action ChooseGoogle = all { s.screen == "Choose", s.offered.contains("google"), not(s.waiting),
    s' = { ...s, taps: Tap, screen: "Google", method: "google", browser: if (NativeGoogle) "none" else "google" } }
  action NativeConsent = all { s.screen == "Google", s.browser == "none", NativeGoogle, not(s.waiting),
    if (s.net == "up") {
      nondet scopes = Scopes.powerset().oneOf()
      s' = { ...s, taps: Tap, cred: "valid", screen: "Home", waiting: false, scopes: scopes }
    } else s' = { ...s, taps: Tap, waiting: true } }
  action TabConsent = all { s.screen == "Google", s.browser == "google",
    s' = { ...s, taps: Tap, browser: "returning" } }
  action CloseBrowser = all { s.browser != "none", s.detours < MaxDetours,
    s' = { ...s, taps: Tap, detours: Detour, browser: "none",
      screen: if (s.screen == "Google") "Choose" else s.screen,
      method: if (s.screen == "Google") "none" else s.method } }
  action EnterAddress(m) = all { s.screen == "Choose", s.offered.contains(m),
    Set("email", "phone").contains(m), not(s.waiting), s' = { ...s, method: m, taps: Tap,
      screen: if (s.net == "up") "Code" else s.screen,
      waiting: if (s.net == "up") false else if (s.Design == "proposed") true else s.waiting } }
  action EnterCode = all { s.screen == "Code", s.net == "up",
    s' = { ...s, taps: Tap, cred: "valid", screen: "Home" } }
  action WrongCode = all { s.screen == "Code", s.net == "up", s.detours < MaxDetours,
    s' = { ...s, taps: Tap, detours: Detour } }
  action Back = all { Set("Code", "Google").contains(s.screen), s.detours < MaxDetours,
    s' = { ...s, taps: Tap, detours: Detour, screen: "Choose", method: "none", browser: "none", waiting: false } }
  action System = any { Boot, Probe, AutoResume, GoogleReturn }
  action User = any { TapCloudSignIn, TapRetry, ChooseGoogle, NativeConsent, TabConsent,
    EnterAddress("email"), EnterAddress("phone"), EnterCode }
  action Mistake = any { CloseBrowser, WrongCode, Back }
  action Env = any { NetDrop, NetRecover, KeyRejected }
  action Done = all { s.screen == "Home", s' = s }
  action Next = any { System, User, Mistake, Env, Done }
  action step = any { Next, s' = s }
  temporal Fairness = System.weakFair(s) and NetRecover.weakFair(s)
    and TapCloudSignIn.strongFair(s) and TapRetry.strongFair(s) and ChooseGoogle.strongFair(s)
    and NativeConsent.strongFair(s) and TabConsent.strongFair(s) and EnterCode.strongFair(s)
    and EnterAddress("email").strongFair(s)
  val Initial = TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design, s.gms, s.appLink, s.stewardOk, s.net, s.cred, s.scopes)
    and Set("none", "valid").contains(s.cred) and (s.cred == "none" implies s.scopes == Set())
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(s)) and Fairness
  temporal CurrentSpec = (Initial and s.Design == "current") and always(Next.orKeep(s)) and Fairness
  val NoCloudWebPage = s.browser != "cloudWeb"
  val CodesStayInApp = Set("email", "phone").contains(s.method) implies s.browser == "none"
  val NoManualRetry = not(s.retryShown)
  val SavedSignInNeverAsked = s.cred == "valid" implies not(Set("Gate", "Checking", "Choose", "Code").contains(s.screen))
  val NoTabLeftBehind = s.screen == "Home" implies s.browser == "none"
  val TwoTaps = (s.screen == "Home" and s.detours == 0 and s.flips == 0 and s.method != "none") implies s.taps <= 2
  val GoogleWhenPossible = (s.screen == "Choose" and (s.gms or (s.appLink and s.stewardOk)) and s.net == "up")
    implies s.offered.contains("google")
  temporal ReachesHome = eventually(s.screen == "Home")
  temporal CheckedReachesHome = Fairness implies ReachesHome
  temporal CheckedTemporal = Fairness implies ReachesHome
  val safety = TypeOK and NoCloudWebPage and CodesStayInApp and NoManualRetry
    and SavedSignInNeverAsked and NoTabLeftBehind and TwoTaps and GoogleWhenPossible
  run nativeGoogleTest = StartState("proposed", true, false, false, "up", "none", Set())
    .then(Boot).then(ChooseGoogle).then(NativeConsent).expect(s.screen == "Home" and safety)
  run customTabTest = StartState("proposed", false, true, true, "up", "none", Set())
    .then(Boot).then(ChooseGoogle).then(TabConsent).then(GoogleReturn).expect(s.screen == "Home" and safety)
  run offlineSavedTest = StartState("proposed", false, false, false, "down", "valid", Set())
    .then(Boot).expect(s.screen == "Home" and safety)
  run offlineEmailResumesTest = StartState("proposed", false, false, false, "down", "none", Set())
    .then(Boot).then(EnterAddress("email")).expect(s.waiting and safety)
    .then(NetRecover).then(AutoResume).then(EnterCode).expect(s.screen == "Home" and safety)
  run currentSavedSignInTest = StartState("current", false, false, false, "down", "valid", Set())
    .then(Boot).expect(not(SavedSignInNeverAsked) and not(NoManualRetry))
  run currentMissingGoogleTest = StartState("current", true, false, false, "up", "none", Set())
    .then(Boot).then(TapCloudSignIn).then(Probe).expect(not(GoogleWhenPossible))
  run currentThreeTapEmailTest = StartState("current", false, false, false, "up", "none", Set())
    .then(Boot).then(TapCloudSignIn).then(Probe).then(EnterAddress("email")).then(EnterCode)
    .expect(not(TwoTaps))
}

