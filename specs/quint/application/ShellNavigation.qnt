/// Shell Back ordering and completed-action navigation claim fences.
module ShellNavigation {
  type State = { view: str, chat: str, shade: bool, drawer: bool, modal: bool,
    draft: str, revision: int, captured: int, claim: str, hidden: bool, focus: bool,
    settingsRows: List[str], focusedSetting: str, intendedSetting: str, activatedSetting: str }
  var s: State
  pure def containsSetting(rows: List[str], value: str): bool = rows.foldl(false, (found, row) => found or row == value)
  pure val Views = Set("home", "assistant", "apps", "maps", "camera", "photos", "notes",
    "calendar", "notifications", "reminders", "workflows", "files", "inbox", "browser",
    "phone", "messages", "contacts", "passwords", "settings")
  action init = s' = { view: "home", chat: "input", shade: false, drawer: false,
    modal: false, draft: "", revision: 0, captured: 0, claim: "none", hidden: false, focus: false,
    settingsRows: List(), focusedSetting: "", intendedSetting: "", activatedSetting: "" }
  action open(view: str): bool = all { view.in(Views), s.revision < 2,
    s' = { ...s, view: view, revision: s.revision + 1, shade: false, drawer: false,
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
    not(s.hidden or s.modal or s.shade),
    s' = { ...s, focusedSetting: row, intendedSetting: row, activatedSetting: "" } }
  action activateSetting = all { s.focusedSetting != "", not(s.hidden or s.modal or s.shade),
    s' = { ...s, activatedSetting: s.focusedSetting, focusedSetting: "", intendedSetting: "" } }
  action expand = all { not(s.modal or s.hidden), s' = { ...s, chat: "full", focus: true, shade: false,
    focusedSetting: "", intendedSetting: "" } }
  action edit = all { not(s.modal or s.hidden or s.shade), s' = { ...s, draft: "draft", focus: true, chat: "input",
    focusedSetting: "", intendedSetting: "" } }
  action showShade = s' = { ...s, shade: true, focus: false, focusedSetting: "", intendedSetting: "" }
  action showModal = s' = { ...s, modal: true, focus: false, focusedSetting: "", intendedSetting: "" }
  action back = if (s.modal) s' = { ...s, modal: false }
    else if (s.shade) s' = { ...s, shade: false }
    else if (s.drawer) s' = { ...s, drawer: false }
    else if (s.chat == "full") s' = { ...s, chat: "sheet", focus: false }
    else if (s.chat == "sheet") s' = { ...s, chat: "input", focus: false }
    else if (s.view != "home" and s.revision < 2) s' = { ...s, view: "home", revision: s.revision + 1, claim: "none", focus: false,
      settingsRows: List(), focusedSetting: "", intendedSetting: "" }
    else s' = s
  action capture = all { not(s.hidden), s.claim == "none",
    s' = { ...s, captured: s.revision, claim: "captured" } }
  action claim = all { s.claim == "captured", s.captured == s.revision, not(s.hidden),
    s' = { ...s, claim: "claimed" } }
  action acknowledge = all { s.claim == "claimed", s.captured == s.revision, not(s.hidden),
    s' = { ...s, claim: "delivered" } }
  action hide = s' = { ...s, hidden: true, claim: "none", focus: false, focusedSetting: "", intendedSetting: "" }
  action resume = s' = { ...s, hidden: false }
  action step = {
    nondet view = Views.oneOf()
    nondet rows = Set(List(), List("about"), List("setup", "about"), List("about", "setup")).oneOf()
    nondet row = Set("about", "setup").oneOf()
    any { open(view), expand, edit, showShade, showModal, back, capture, claim, acknowledge,
      hide, resume, settingsRowsChanged(rows), focusSetting(row), activateSetting, s' = s }
  }
  val CurrentClaim = s.claim.in(Set("none", "captured")) or (s.captured == s.revision and not(s.hidden))
  val VisibleFocus = s.focus implies not(s.shade or s.modal or s.hidden)
  val DraftBound = s.draft.in(Set("", "draft"))
  val FocusedSettingIdentity = s.focusedSetting == s.intendedSetting and
    (s.focusedSetting == "" or containsSetting(s.settingsRows, s.focusedSetting))
  val safety = CurrentClaim and VisibleFocus and DraftBound and FocusedSettingIdentity
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
}
