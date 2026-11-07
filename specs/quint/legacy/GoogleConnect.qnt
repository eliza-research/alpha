// Faithful translation of docs/flow-redesign-2026-11/tla/GoogleConnect.tla.
module GoogleConnect {
  type State = { Design: str, gms: bool, scopes: Set[str], screen: str, browser: str,
    requested: Set[str], inboxView: str, calView: str, calPicked: bool, taps: int, detours: int }
  type TransitionHistory = { ScopesNeverShrink: bool, TwoTapsToMail: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val MaxDetours = 2
  pure val MaxTaps = 9
  pure val GmailRead = "gmail.read"
  pure val GmailWrite = "gmail.write"
  pure val CalRead = "cal.read"
  pure val CalWrite = "cal.write"
  pure val AllScopes = Set(GmailRead, GmailWrite, CalRead, CalWrite)
  pure def InboxFor(scopes) = if (scopes.contains(GmailRead)) "mail" else "connect"
  pure def calFor(design, scopes, picked) =
    if (scopes.contains(CalRead) and (design == "proposed" or picked)) "google" else "local"
  def CalFor(scopes, picked) = calFor(s.Design, scopes, picked)
  val TypeOK = s.scopes.subseteq(AllScopes) and s.requested.subseteq(AllScopes)
    and Set("Inbox", "Calendar", "Panel", "Browser").contains(s.screen)
    and Set("none", "consent", "returning", "cloudSuccess", "cloudUnverified").contains(s.browser)
    and Set("connect", "mail").contains(s.inboxView) and Set("local", "google").contains(s.calView)
    and s.taps >= 0 and s.taps <= MaxTaps and s.detours >= 0 and s.detours <= MaxDetours
  pure def initialState(design, gms, scopes, screen) = { Design: design, gms: gms,
    scopes: scopes, screen: screen, browser: "none", requested: Set(),
    inboxView: InboxFor(scopes), calView: calFor(design, scopes, false), calPicked: false, taps: 0, detours: 0 }
  // Persistent monitors are the exact state extension for the original
  // action properties. They observe transitions without constraining them.
  pure val initialChecks = { ScopesNeverShrink: true, TwoTapsToMail: true }
  pure def ScopesNeverShrinkRelation(before: State, after: State): bool = {
      val revoked = before.scopes != Set() and before.detours < MaxDetours and after == { ...before,
        scopes: Set(), detours: before.detours + 1,
        inboxView: if (before.Design == "proposed") "connect" else before.inboxView,
        calView: if (before.Design == "proposed") "local" else before.calView }
      revoked or before.scopes.subseteq(after.scopes)
    }
  pure def TwoTapsToMailRelation(before: State, after: State): bool = (before.inboxView != "mail" and after.inboxView == "mail" and after.detours == 0) implies after.taps <= 2
  action Track(after: State): bool = all {
    s' = after,
    history' = { ScopesNeverShrink: history.ScopesNeverShrink and ScopesNeverShrinkRelation(s, after),
      TwoTapsToMail: history.TwoTapsToMail and TwoTapsToMailRelation(s, after) }
  }
  val ScopesNeverShrinkInvariant = history.ScopesNeverShrink
  val TwoTapsToMailInvariant = history.TwoTapsToMail
  action StartState(design, gms, scopes, screen) = all { s' = { Design: design, gms: gms,
    scopes: scopes, screen: screen, browser: "none", requested: Set(),
    inboxView: InboxFor(scopes), calView: calFor(design, scopes, false), calPicked: false, taps: 0, detours: 0 }, history' = initialChecks }
  action Init(design) = {
    nondet gms = Bool.oneOf()
    nondet scopes = AllScopes.powerset().oneOf()
    nondet screen = Set("Inbox", "Calendar").oneOf()
    StartState(design, gms, scopes, screen)
  }
  action checkerInit = {
    nondet gms = Bool.oneOf()
    nondet scopes = AllScopes.powerset().oneOf()
    nondet screen = Set("Inbox", "Calendar").oneOf()
    all { s' = initialState("proposed", gms, scopes, screen), history' = initialChecks }
  }
  action checkerCurrentInit = {
    nondet gms = Bool.oneOf()
    nondet scopes = AllScopes.powerset().oneOf()
    nondet screen = Set("Inbox", "Calendar").oneOf()
    all { s' = initialState("current", gms, scopes, screen), history' = initialChecks }
  }
  action init = Init("proposed")
  action currentInit = Init("current")
  val Tap = if (s.taps < MaxTaps) s.taps + 1 else s.taps
  val InApp = Set("Inbox", "Calendar", "Panel").contains(s.screen)
  def Request(cur) = if (s.Design == "proposed") AllScopes else Set(GmailRead, CalRead)
  def Boxes(req) = if (s.Design == "proposed") Set(Set(GmailRead, GmailWrite), Set(CalRead, CalWrite))
    .filter(box => box.subseteq(req)) else req.map(scope => Set(scope))
  def Grantable(req) = Boxes(req).powerset().exclude(Set(Set())).map(boxes => boxes.flatten())
  action TapConnect = all { Set("Inbox", "Calendar").contains(s.screen), s.requested == Set(),
    if (s.Design == "proposed") all {
      (s.screen == "Inbox" and s.inboxView == "connect") or
        (s.screen == "Calendar" and not(s.scopes.contains(CalRead))) or not(AllScopes.subseteq(s.scopes)),
      Track({ ...s, taps: Tap, requested: Request(s.scopes),
        browser: if (s.gms) "none" else "consent", screen: if (s.gms) s.screen else "Browser" })
    } else all { s.screen == "Inbox", s.inboxView == "connect", Track({ ...s, taps: Tap, screen: "Panel" }) } }
  action PanelConnect = all { s.Design == "current", s.screen == "Panel", s.browser == "none",
    Track({ ...s, taps: Tap, requested: Request(s.scopes), browser: "consent", screen: "Browser" }) }
  action PanelPickCalendar = all { s.Design == "current", s.screen == "Panel", s.scopes.contains(CalRead), not(s.calPicked),
    Track({ ...s, taps: Tap, calPicked: true }) }
  action ManualRefresh = all { s.Design == "current", InApp, s.browser == "none",
    Track({ ...s, taps: Tap, inboxView: InboxFor(s.scopes), calView: CalFor(s.scopes, s.calPicked) }) }
  action ClosePanel = all { s.screen == "Panel", Track({ ...s, taps: Tap, screen: "Inbox" }) }
  action ConsentWith(granted) = all { s.requested != Set(),
    (s.Design == "proposed" and s.gms and s.browser == "none" and InApp) or s.browser == "consent",
    Grantable(s.requested).contains(granted),
    {
      val scopes = if (s.Design == "proposed") s.scopes.union(granted) else granted
      val native = s.Design == "proposed" and s.browser == "none"
      Track({ ...s, taps: Tap, scopes: scopes, requested: Set(),
        detours: if (granted == s.requested or s.detours >= MaxDetours) s.detours else s.detours + 1,
        browser: if (s.browser == "consent") "returning" else s.browser,
        inboxView: if (native) InboxFor(scopes) else s.inboxView,
        calView: if (native) CalFor(scopes, s.calPicked) else s.calView })
    } }
  action Consent = { nondet granted = Grantable(s.requested).oneOf(); ConsentWith(granted) }
  action Decline = all { s.browser == "consent", s.detours < MaxDetours,
    Track({ ...s, taps: Tap, detours: s.detours + 1, browser: "none", requested: Set(),
      screen: if (s.Design == "proposed") "Inbox" else "Panel" }) }
  action SwitchBackToAlpha = all { Set("cloudSuccess", "cloudUnverified").contains(s.browser), s.screen == "Browser",
    Track({ ...s, taps: Tap, screen: "Panel" }) }
  action CloseBrowserTab = all { Set("cloudSuccess", "cloudUnverified").contains(s.browser), s.screen != "Browser",
    Track({ ...s, taps: Tap, browser: "none" }) }
  action SwitchApp = all { Set("Inbox", "Calendar").contains(s.screen), Track({ ...s,
    screen: if (s.screen == "Inbox") "Calendar" else "Inbox",
    inboxView: if (s.Design == "proposed") InboxFor(s.scopes) else s.inboxView,
    calView: if (s.Design == "proposed") CalFor(s.scopes, s.calPicked) else s.calView }) }
  action Return = all { s.browser == "returning",
    if (s.Design == "proposed") Track({ ...s, browser: "none", screen: "Inbox",
      inboxView: InboxFor(s.scopes), calView: CalFor(s.scopes, s.calPicked) })
    else { nondet browser = Set("cloudSuccess", "cloudUnverified").oneOf(); Track({ ...s, browser: browser }) } }
  action Revoke = all { s.scopes != Set(), s.detours < MaxDetours,
    Track({ ...s, scopes: Set(), detours: s.detours + 1,
      inboxView: if (s.Design == "proposed") "connect" else s.inboxView,
      calView: if (s.Design == "proposed") "local" else s.calView }) }
  action User = any { TapConnect, PanelConnect, PanelPickCalendar, ManualRefresh, ClosePanel,
    Consent, SwitchBackToAlpha, CloseBrowserTab, SwitchApp }
  action Next = any { User, Decline, Return, Revoke }
  action step = any { Next, Track(s) }
  temporal Fairness = Return.weakFair(s) and TapConnect.strongFair(s) and PanelConnect.strongFair(s)
    and Consent.strongFair(s) and SwitchBackToAlpha.strongFair(s) and ManualRefresh.strongFair(s)
  val Initial = (history == initialChecks) and TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design, s.gms, s.scopes, s.screen)
    and Set("Inbox", "Calendar").contains(s.screen)
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(vars)) and Fairness
  temporal CurrentSpec = (Initial and s.Design == "current") and always(Next.orKeep(vars)) and Fairness
  val NoCloudWebPage = not(Set("cloudSuccess", "cloudUnverified").contains(s.browser))
  val NoTabLeftBehind = Set("Inbox", "Calendar").contains(s.screen) implies s.browser == "none"
  val InboxFresh = (s.screen == "Inbox" and s.browser == "none") implies s.inboxView == InboxFor(s.scopes)
  val OneGrantForBoth = (s.screen == "Calendar" and s.browser == "none" and s.scopes.contains(CalRead))
    implies s.calView == "google"
  temporal ScopesNeverShrink = always(history.ScopesNeverShrink)
  temporal TwoTapsToMail = always(history.TwoTapsToMail)
  temporal ReturnsToApp = leadsTo(s.browser == "returning",
    Set("Inbox", "Calendar").contains(s.screen) and s.browser == "none")
  temporal CheckedTwoTapsToMail = Fairness implies TwoTapsToMail
  temporal CheckedScopesNeverShrink = Fairness implies ScopesNeverShrink
  temporal CheckedReturnsToApp = Fairness implies ReturnsToApp
  temporal CheckedTemporal = Fairness implies (ScopesNeverShrink and TwoTapsToMail and ReturnsToApp)
  val safety = TypeOK and NoCloudWebPage and NoTabLeftBehind and InboxFresh and OneGrantForBoth and ScopesNeverShrinkInvariant and TwoTapsToMailInvariant
  run nativeConsentTest = StartState("proposed", true, Set(), "Inbox").then(TapConnect)
    .then(ConsentWith(AllScopes)).expect(s.inboxView == "mail" and s.taps == 2 and safety)
    .then(SwitchApp).expect(s.calView == "google" and safety)
  run returnRefreshesTest = StartState("proposed", false, Set(), "Inbox").then(TapConnect)
    .then(ConsentWith(AllScopes)).then(Return).expect(s.inboxView == "mail" and s.browser == "none" and safety)
  run incrementalGrantTest = StartState("proposed", true, Set(CalRead, CalWrite), "Inbox")
    .then(TapConnect).then(ConsentWith(Set(GmailRead, GmailWrite)))
    .expect(s.scopes == AllScopes and safety)
  run revokeAndDeclineTest = StartState("proposed", false, AllScopes, "Inbox").then(Revoke)
    .then(TapConnect).then(Decline).expect(s.scopes == Set() and s.inboxView == "connect" and safety)
  run currentCloudPageTest = StartState("current", false, Set(), "Inbox").then(TapConnect)
    .then(PanelConnect).then(ConsentWith(Set(GmailRead, CalRead))).then(Return).expect(not(NoCloudWebPage))
  run currentPickerTest = StartState("current", true, AllScopes, "Calendar").expect(not(OneGrantForBoth))
  run currentGrantShrinksTest = StartState("current", false, Set(CalRead, CalWrite), "Inbox")
    .then(TapConnect).then(PanelConnect).then(ConsentWith(Set(GmailRead, CalRead)))
    .expect(not(s.scopes.contains(CalWrite)) and not(ScopesNeverShrinkInvariant))
  run currentStaleInboxTest = StartState("current", true, AllScopes, "Inbox").then(Revoke)
    .expect(not(InboxFresh))
  run currentTabAndTapCountTest = StartState("current", false, Set(), "Inbox").then(TapConnect)
    .then(PanelConnect).then(ConsentWith(Set(GmailRead, CalRead))).then(Return)
    .then(SwitchBackToAlpha).then(ClosePanel).expect(not(NoTabLeftBehind))
    .then(CloseBrowserTab).then(ManualRefresh).expect(not(TwoTapsToMailInvariant))
}

