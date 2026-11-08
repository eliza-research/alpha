/// Native isolated-profile admission, per-origin decisions and HTTP authentication.
module BrowserSiteState {
  type Site = {
    privateTab: bool, phase: str, foreground: bool, selected: bool,
    navigation: int, origin: int, thirdParty: bool, passkeys: bool,
    normalCookie: bool, privateCookie: bool, decisions: int -> str,
    prompt: str, requestedOrigin: int, requestedNavigation: int,
    permissionChoice: str, androidAllowed: bool, permissionResult: bool,
    authAttempts: int, passwordPresent: bool, passwordSubmitted: bool,
    autofillExposed: bool, authSave: bool
  }
  var s: Site
  action initFor(privateTab: bool): bool = s' = {
    privateTab: privateTab, phase: "new", foreground: true, selected: true,
    navigation: 0, origin: 1, thirdParty: false, passkeys: false,
    normalCookie: false, privateCookie: false, decisions: Map(1 -> "unset", 2 -> "unset"),
    prompt: "none", requestedOrigin: 0, requestedNavigation: 0,
    permissionChoice: "unset", androidAllowed: false, permissionResult: false,
    authAttempts: 0, passwordPresent: false, passwordSubmitted: false,
    autofillExposed: false, authSave: false }
  action init = {
    nondet privateTab = Set(false, true).oneOf()
    initFor(privateTab)
  }
  /// Profile/cookie isolation and multiprocess engine admission precede a usable tab. WebAuthn remains at the fresh WebView disabled default.
  action build(cookiePolicyAccepted: bool, engineAvailable: bool): bool = all {
    s.phase == "new",
    s' = { ...s, phase: if (cookiePolicyAccepted and engineAvailable) "ready" else "failed",
      thirdParty: cookiePolicyAccepted and engineAvailable and not(s.privateTab) }
  }
  action navigate(origin: int): bool = all {
    s.phase.in(Set("ready", "committed")), s.navigation < 2, origin.in(Set(1, 2)),
    s' = { ...s, phase: "loading", origin: origin, navigation: s.navigation + 1,
      prompt: "none", permissionResult: false, passwordPresent: false,
      passwordSubmitted: false, autofillExposed: false, authSave: false }
  }
  action commit = all { s.phase == "loading", s' = { ...s, phase: "committed" } }
  action cookie = all {
    s.phase == "committed",
    s' = { ...s, normalCookie: if (s.privateTab) s.normalCookie else true,
      privateCookie: if (s.privateTab) true else s.privateCookie }
  }
  action permissionRequest(origin: int): bool = all {
    s.phase == "committed", s.foreground, s.selected, s.prompt == "none",
    origin == s.origin,
    s' = { ...s, requestedOrigin: origin, requestedNavigation: s.navigation,
      permissionChoice: if (s.privateTab) "unset" else s.decisions.get(origin),
      prompt: if (not(s.privateTab) and s.decisions.get(origin) == "deny") "none"
        else if (not(s.privateTab) and s.decisions.get(origin) == "allow") "runtime" else "site",
      permissionResult: false }
  }
  action permissionDecision(allow: bool): bool = all {
    s.prompt == "site",
    s' = { ...s, prompt: if (allow) "runtime" else "none",
      permissionChoice: if (allow) "allow" else "deny",
      decisions: if (s.privateTab) s.decisions
        else s.decisions.set(s.requestedOrigin, if (allow) "allow" else "deny") }
  }
  action androidResult(granted: bool): bool = all {
    s.prompt == "runtime",
    s' = { ...s, prompt: "none", androidAllowed: granted,
      permissionResult: granted and s.phase == "committed" and
        s.requestedOrigin == s.origin and s.requestedNavigation == s.navigation }
  }
  /// Standard WebView supplies host/realm only, so current HTTP auth stays manual.
  action authChallenge(secureSameHost: bool): bool = all {
    s.phase.in(Set("loading", "committed")), s.foreground, s.selected, s.prompt == "none",
    s.authAttempts < 3,
    s' = { ...s, prompt: if (secureSameHost) "auth" else "none",
      authAttempts: if (secureSameHost) s.authAttempts + 1 else s.authAttempts,
      passwordPresent: false, passwordSubmitted: false,
      autofillExposed: false, authSave: false }
  }
  action typePassword = all { s.prompt == "auth", s' = { ...s, passwordPresent: true } }
  action submitPassword = all {
    s.prompt == "auth", s.passwordPresent,
    s' = { ...s, prompt: "none", passwordPresent: false, passwordSubmitted: true }
  }
  action dismiss = s' = { ...s, prompt: "none", passwordPresent: false, autofillExposed: false }
  action hide = s' = { ...s, foreground: false, prompt: "none", passwordPresent: false }
  action resume = s' = { ...s, foreground: true }
  action deselect = s' = { ...s, selected: false, prompt: "none", passwordPresent: false }
  action selectTab = s' = { ...s, selected: true }
  action clearSite = s' = { ...s, normalCookie: if (s.privateTab) s.normalCookie else false,
    privateCookie: if (s.privateTab) false else s.privateCookie,
    decisions: if (s.privateTab) s.decisions else s.decisions.set(s.origin, "unset"),
    permissionResult: false, prompt: "none", passwordPresent: false }
  action close = s' = { ...s, phase: "closed", privateCookie: false,
    prompt: "none", passwordPresent: false, autofillExposed: false, permissionResult: false }
  action step = any {
    build(true, true), build(false, true), build(true, false), navigate(1), navigate(2), commit,
    cookie, permissionRequest(1), permissionRequest(2), permissionDecision(true),
    permissionDecision(false), androidResult(true), androidResult(false),
    authChallenge(true), authChallenge(false), typePassword, submitPassword,
    dismiss, hide, resume, deselect, selectTab, clearSite, close, s' = s
  }
  val PrivateCookiePolicy = s.privateTab implies not(s.thirdParty or s.normalCookie)
  val PrivatePermissionPolicy = s.privateTab implies s.decisions == Map(1 -> "unset", 2 -> "unset")
  val CurrentPermission = s.permissionResult implies s.androidAllowed and
    s.permissionChoice == "allow" and s.requestedOrigin == s.origin and s.requestedNavigation == s.navigation
  val PasskeysDisabled = not(s.passkeys)
  val StandardHttpAuthManual = not(s.autofillExposed or s.authSave)
  val PasswordLifetime = s.passwordPresent implies s.prompt == "auth"
  val TypeOK = s.phase.in(Set("new", "ready", "failed", "loading", "committed", "closed")) and s.prompt.in(Set("none", "site", "runtime", "auth")) and s.navigation.in(0.to(2)) and s.authAttempts.in(0.to(3))
  val safety = TypeOK and PrivateCookiePolicy and PrivatePermissionPolicy and CurrentPermission and
    PasskeysDisabled and StandardHttpAuthManual and PasswordLifetime and s.authAttempts <= 3
  run privateGrantTest = initFor(true).then(build(true, true)).then(navigate(1)).then(commit)
    .then(cookie).then(permissionRequest(1)).then(permissionDecision(true)).then(androidResult(true))
    .expect(s.permissionResult and s.privateCookie and safety).then(close)
    .expect(not(s.privateCookie) and safety)
  run storedDecisionStillNeedsAndroidTest = initFor(false).then(build(true, true)).then(navigate(1))
    .then(commit).then(permissionRequest(1)).then(permissionDecision(true)).then(androidResult(false))
    .then(permissionRequest(1)).expect(s.prompt == "runtime")
    .then(androidResult(true)).expect(s.permissionResult and safety)
  run providerAdmissionTest = initFor(true).then(build(false, true)).expect(s.phase == "failed" and safety)
  run manualAuthTest = initFor(false).then(build(true, true)).then(navigate(1))
    .then(authChallenge(true)).then(typePassword).then(submitPassword)
    .expect(s.passwordSubmitted and not(s.passwordPresent or s.authSave) and safety)
  run switchedTabCancelsPromptTest = initFor(false).then(build(true, true)).then(navigate(1))
    .then(commit).then(permissionRequest(1)).then(deselect).expect(s.prompt == "none" and safety)
}
