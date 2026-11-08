/// Shell Back ordering and completed-action navigation claim fences.
module ShellNavigation {
  type State = { view: str, chat: str, shade: bool, drawer: bool, modal: bool,
    draft: str, revision: int, captured: int, claim: str, hidden: bool, focus: bool,
    settingsRows: List[str], focusedSetting: str, intendedSetting: str, activatedSetting: str,
    pageSuspended: bool, contextSensitive: bool, pending: bool, sendEpoch: int,
    sendRevision: int, replyVisible: bool }
  var s: State
  pure def containsSetting(rows: List[str], value: str): bool = rows.foldl(false, (found, row) => found or row == value)
  pure val Views = Set("home", "assistant", "apps", "maps", "camera", "photos", "notes",
    "calendar", "notifications", "reminders", "workflows", "files", "inbox", "browser",
    "phone", "messages", "contacts", "passwords", "settings")
  action init = s' = { view: "home", chat: "input", shade: false, drawer: false,
    modal: false, draft: "", revision: 0, captured: 0, claim: "none", hidden: false, focus: false,
      settingsRows: List(), focusedSetting: "", intendedSetting: "", activatedSetting: "",
      pageSuspended: false, contextSensitive: false, pending: false, sendEpoch: 0,
      sendRevision: 0, replyVisible: false }
  action open(view: str): bool = all { view.in(Views), s.revision < 6,
    s' = { ...s, view: view, chat: if (view == "home") "input" else "hidden",
      revision: if (view == s.view) s.revision else s.revision + 1, shade: false, drawer: false,
      pending: s.pending and view == s.view,
      claim: "none", focus: false,
      settingsRows: if (view == "settings") List("about") else List(),
      focusedSetting: "", intendedSetting: "", activatedSetting: "" } }
  /// A finite projection of the dynamic Settings groups. Row identity survives
  /// insertion and reordering. Removing the focused row clears its focus.
  action settingsRowsChanged(rows: List[str]): bool = all {
    s.view == "settings", rows.in(Set(List(), List("about"), List("setup", "about"), List("about", "setup"))),
    s' = { ...s, settingsRows: rows,
      focusedSetting: if (containsSetting(rows, s.focusedSetting)) s.focusedSetting else "",
      intendedSetting: if (containsSetting(rows, s.intendedSetting)) s.intendedSetting else "" }
  }
  action focusSetting(row: str): bool = all { s.view == "settings", containsSetting(s.settingsRows, row),
    not(s.contextSensitive or s.modal or s.shade),
    s' = { ...s, focusedSetting: row, intendedSetting: row, activatedSetting: "" } }
  action activateSetting = all { s.focusedSetting != "", not(s.contextSensitive or s.modal or s.shade),
    s' = { ...s, activatedSetting: s.focusedSetting, focusedSetting: "", intendedSetting: "" } }
  action expand = all { not(s.modal or s.contextSensitive), s' = { ...s, chat: "full", focus: true, shade: false,
    focusedSetting: "", intendedSetting: "" } }
  action edit = all { not(s.modal or s.contextSensitive or s.shade), s' = { ...s, draft: "draft", focus: true, chat: "input",
    focusedSetting: "", intendedSetting: "" } }
  action showShade = s' = { ...s, shade: true, focus: false, focusedSetting: "", intendedSetting: "" }
  action showModal = s' = { ...s, modal: true, focus: false, focusedSetting: "", intendedSetting: "" }
  action back = if (s.modal) s' = { ...s, modal: false }
    else if (s.shade) s' = { ...s, shade: false }
    else if (s.drawer) s' = { ...s, drawer: false }
    else if (s.chat == "full") s' = { ...s, chat: "sheet", focus: false }
    else if (s.chat == "sheet") s' = { ...s, chat: if (s.view == "home") "input" else "hidden", focus: false }
    else if (s.chat == "input" and s.view != "home") s' = { ...s, chat: "hidden", focus: false }
    else if (s.view != "home" and s.revision < 6) s' = { ...s, view: "home", chat: "input", revision: s.revision + 1, claim: "none", focus: false,
      pending: false,
      settingsRows: List(), focusedSetting: "", intendedSetting: "" }
    else s' = s
  action capture = all { not(s.contextSensitive), s.claim == "none",
    s' = { ...s, captured: s.revision, claim: "captured" } }
  action claim = all { s.claim == "captured", s.captured == s.revision, not(s.contextSensitive),
    s' = { ...s, claim: "claimed" } }
  action acknowledge = all { s.claim == "claimed", s.captured == s.revision, not(s.contextSensitive),
    s' = { ...s, claim: "delivered" } }
  action send = all { not(s.pending or s.contextSensitive), s.sendEpoch < 2,
    s' = { ...s, pending: true, sendEpoch: s.sendEpoch + 1, sendRevision: s.revision,
      draft: "", chat: if (s.chat == "full") "full" else "sheet", replyVisible: false } }
  action reply(ticket: int): bool =
    if (s.pending and not(s.contextSensitive) and ticket == s.sendEpoch and s.sendRevision == s.revision)
      s' = { ...s, pending: false, replyVisible: true }
    else s' = s
  action suspend(hidden: bool, pageSuspended: bool): bool = all { s.revision < 6,
    s' = { ...s, hidden: hidden, pageSuspended: pageSuspended,
      contextSensitive: hidden or pageSuspended,
      revision: if (s.contextSensitive == (hidden or pageSuspended)) s.revision else s.revision + 1,
      pending: s.pending and not(hidden or pageSuspended),
      claim: if (hidden or pageSuspended) "none" else s.claim,
      focus: s.focus and not(hidden or pageSuspended),
      focusedSetting: if (hidden or pageSuspended) "" else s.focusedSetting,
      intendedSetting: if (hidden or pageSuspended) "" else s.intendedSetting }
  }
  action hide = suspend(true, s.pageSuspended)
  action resume = suspend(false, s.pageSuspended)
  action pageHide = suspend(s.hidden, true)
  action pageShow = suspend(s.hidden, false)
  action step = {
    nondet view = Views.oneOf()
    nondet rows = Set(List(), List("about"), List("setup", "about"), List("about", "setup")).oneOf()
    nondet row = Set("about", "setup").oneOf()
    any { open(view), expand, edit, showShade, showModal, back, capture, claim, acknowledge,
      hide, resume, pageHide, pageShow, send, reply(1), reply(2),
      settingsRowsChanged(rows), focusSetting(row), activateSetting, s' = s }
  }
  val CurrentClaim = s.claim.in(Set("none", "captured")) or (s.captured == s.revision and not(s.contextSensitive))
  val VisibleFocus = s.focus implies not(s.shade or s.modal or s.contextSensitive)
  val DraftBound = s.draft.in(Set("", "draft"))
  val FocusedSettingIdentity = s.focusedSetting == s.intendedSetting and
    (s.focusedSetting == "" or containsSetting(s.settingsRows, s.focusedSetting))
  val CurrentSend = s.pending implies (not(s.contextSensitive) and s.sendRevision == s.revision)
  val safety = CurrentClaim and VisibleFocus and DraftBound and FocusedSettingIdentity and CurrentSend
  run backOrderTest = init.then(edit).then(expand).then(showShade).then(showModal)
    .then(back).expect(s.shade).then(back).expect(s.chat == "full")
    .then(back).expect(s.chat == "sheet" and s.draft == "draft" and safety)
  run staleNavigationTest = init.then(capture).then(open("notes"))
    .expect(s.claim == "none" and safety)
  run deliveryTest = init.then(capture).then(claim).then(acknowledge)
    .expect(s.claim == "delivered" and safety)
  run settingsInsertionKeepsFocusTest = init.then(open("settings")).then(focusSetting("about"))
    .then(settingsRowsChanged(List("setup", "about"))).then(activateSetting)
    .expect(s.activatedSetting == "about" and safety)
  run settingsReorderKeepsFocusTest = init.then(open("settings"))
    .then(settingsRowsChanged(List("setup", "about"))).then(focusSetting("about"))
    .then(settingsRowsChanged(List("about", "setup")))
    .expect(s.focusedSetting == "about" and safety)
  run settingsRemovalClearsFocusTest = init.then(open("settings"))
    .then(settingsRowsChanged(List("setup", "about"))).then(focusSetting("setup"))
    .then(settingsRowsChanged(List("about")))
    .expect(s.focusedSetting == "" and s.intendedSetting == "" and safety)
  run sameViewKeepsSendTest = init.then(open("notes")).then(send).then(open("notes"))
    .then(reply(1)).expect(s.replyVisible and safety)
  run backKeepsSendTest = init.then(send).then(back).then(reply(1))
    .expect(s.replyVisible and s.chat == "input" and safety)
  run changedViewRetiresSendTest = init.then(send).then(open("notes")).then(reply(1))
    .expect(not(s.replyVisible or s.pending) and safety)
  run hiddenRetiresSendTest = init.then(send).then(hide).then(reply(1)).then(resume)
    .expect(not(s.replyVisible or s.pending or s.contextSensitive) and safety)
  run suspendedRetiresSendTest = init.then(send).then(pageHide).then(reply(1)).then(pageShow)
    .expect(not(s.replyVisible or s.pending or s.contextSensitive) and safety)
  run suspendedClaimRefusedTest = init.then(pageHide).then(capture.fail())
  run resumedClaimTest = init.then(pageHide).then(pageShow)
    .then(capture).then(claim).then(acknowledge).expect(s.claim == "delivered" and safety)
}
