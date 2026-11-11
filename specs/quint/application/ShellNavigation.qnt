/// Shell Back ordering and completed-action navigation claim fences.
module ShellNavigation {
  type State = { view: str, chat: str, shade: bool, drawer: bool, modal: bool,
    draft: str, revision: int, captured: int, claim: str, destination: str, hidden: bool, focus: bool,
    settingsRows: List[str], focusedSetting: str, intendedSetting: str, activatedSetting: str,
    pageSuspended: bool, contextSensitive: bool, pending: bool, sendEpoch: int,
    sendRevision: int, replyVisible: bool,
    // Text was typed and has not been sent.
    unsent: bool }
  var s: State
  pure def containsSetting(rows: List[str], value: str): bool = rows.foldl(false, (found, row) => found or row == value)
  pure val SettingRows = Set(List(), List("about"), List("setup", "about"), List("about", "setup"),
    List("default-apps"), List("request-home", "default-apps"), List("default-apps", "request-home"))
  pure val Views = Set("home", "assistant", "apps", "maps", "camera", "photos", "notes",
    "calendar", "notifications", "reminders", "workflows", "files", "inbox", "browser",
    "phone", "messages", "contacts", "passwords", "settings")
  action init = s' = { view: "home", chat: "input", shade: false, drawer: false,
    modal: false, draft: "", revision: 0, captured: 0, claim: "none", destination: "", hidden: false, focus: false,
      settingsRows: List(), focusedSetting: "", intendedSetting: "", activatedSetting: "",
      pageSuspended: false, contextSensitive: false, pending: false, sendEpoch: 0,
      sendRevision: 0, replyVisible: false, unsent: false }
  pure def opened(state: State, view: str): State =
    { ...state, view: view, chat: if (view == "home") "input" else "hidden",
      revision: if (view == state.view) state.revision else state.revision + 1, shade: false, drawer: false,
      pending: state.pending and view == state.view,
      claim: "none", destination: "", focus: false,
      settingsRows: if (view == "settings") List("about") else List(),
      focusedSetting: "", intendedSetting: "", activatedSetting: "" }
  action open(view: str): bool = all { view.in(Views), s.revision < 6,
    s' = opened(s, view) }
  /// A finite projection of the dynamic Settings groups. Row identity survives
  /// insertion and reordering. Removing the focused row clears its focus.
  action settingsRowsChanged(rows: List[str]): bool = all {
    s.view == "settings", rows.in(SettingRows),
    s' = { ...s, settingsRows: rows,
      focusedSetting: if (containsSetting(rows, s.focusedSetting)) s.focusedSetting else "",
      intendedSetting: if (containsSetting(rows, s.intendedSetting)) s.intendedSetting else "" }
  }
  action focusSetting(row: str): bool = all { s.view == "settings", containsSetting(s.settingsRows, row),
    not(s.contextSensitive or s.modal or s.shade),
    s' = { ...s, focusedSetting: row, intendedSetting: row, activatedSetting: "" } }
  action activateSetting = all { s.focusedSetting != "", not(s.contextSensitive or s.modal or s.shade),
    s' = { ...s, activatedSetting: s.focusedSetting, focusedSetting: "", intendedSetting: "" } }
  /// A native settings handoff leaves this renderer mounted with its focused row.
  action activateExternalSetting = all { s.focusedSetting != "", not(s.contextSensitive or s.modal or s.shade),
    s' = { ...s, activatedSetting: s.focusedSetting } }
  action expand = all { not(s.modal or s.contextSensitive), s' = { ...s, chat: "full", focus: true, shade: false,
    focusedSetting: "", intendedSetting: "" } }
  action edit = all { not(s.modal or s.contextSensitive or s.shade), s' = { ...s, draft: "draft", unsent: true, focus: true, chat: "input",
    focusedSetting: "", intendedSetting: "" } }
  action showShade = s' = { ...s, shade: true, focus: false, focusedSetting: "", intendedSetting: "" }
  action showModal = s' = { ...s, modal: true, focus: false, focusedSetting: "", intendedSetting: "" }
  action back = if (s.modal) s' = { ...s, modal: false }
    else if (s.shade) s' = { ...s, shade: false }
    else if (s.drawer) s' = { ...s, drawer: false }
    else if (s.chat == "full") s' = { ...s, chat: "sheet", focus: false }
    else if (s.chat == "sheet") s' = { ...s, chat: if (s.view == "home") "input" else "hidden", focus: false }
    else if (s.chat == "input" and s.view != "home") s' = { ...s, chat: "hidden", focus: false }
    else if (s.view != "home" and s.revision < 6) s' = { ...s, view: "home", chat: "input", revision: s.revision + 1, claim: "none", destination: "", focus: false,
      pending: false,
      settingsRows: List(), focusedSetting: "", intendedSetting: "" }
    else s' = s
  action dismissSheet = all {s.modal, s' = {...s, modal: false}}
  action assistantFromSheet = all {s.modal, not(s.contextSensitive), s' = {...s, modal: false, chat: "sheet", focus: true, shade: false, drawer: false}}
  action capture = all { not(s.contextSensitive), s.claim.in(Set("none", "delivered", "unknown")),
    s' = { ...s, captured: s.revision, claim: "captured", destination: "" } }
  action claim(view: str): bool = all { s.claim == "captured", s.captured == s.revision, not(s.contextSensitive),
    view.in(Views), s' = { ...s, claim: "claimed", destination: view } }
  /// Claim authority is checked on the original screen. The attempt's own
  /// committed view change can advance its revision before acknowledgement.
  action commitClaimedView(view: str): bool = all {
    s.claim == "claimed", s.captured == s.revision, not(s.contextSensitive),
    view == s.destination, s.revision < 6,
    val committed = opened(s, view)
    s' = { ...committed, claim: "committed", destination: view,
      chat: if (s.chat.in(Set("sheet", "full"))) s.chat else committed.chat }
  }
  action acknowledge = all { s.claim == "committed", s.destination == s.view, not(s.contextSensitive),
    s' = { ...s, claim: "delivered" } }
  action acknowledgementLost = all { s.claim == "committed",
    s' = { ...s, claim: "unknown" } }
  action send = all { not(s.pending or s.contextSensitive), s.sendEpoch < 2,
    s' = { ...s, pending: true, sendEpoch: s.sendEpoch + 1, sendRevision: s.revision,
      draft: "", unsent: false, chat: if (s.chat == "full") "full" else "sheet", replyVisible: false } }
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
      destination: if (hidden or pageSuspended) "" else s.destination,
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
    nondet rows = SettingRows.oneOf()
    nondet row = Set("about", "setup", "default-apps", "request-home").oneOf()
    any { open(view), expand, edit, showShade, showModal, dismissSheet, assistantFromSheet, back, capture, claim(view), commitClaimedView(view), acknowledge, acknowledgementLost,
      hide, resume, pageHide, pageShow, send, reply(1), reply(2),
      settingsRowsChanged(rows), focusSetting(row), activateSetting, activateExternalSetting, s' = s }
  }
  val CurrentClaim = (s.claim == "claimed" implies s.captured == s.revision and s.destination.in(Views) and not(s.contextSensitive))
    and (s.claim.in(Set("committed", "delivered", "unknown")) implies s.destination == s.view and not(s.contextSensitive))
  val VisibleFocus = s.focus implies not(s.shade or s.modal or s.contextSensitive)
  /// Typed text stays in the composer until it is sent: navigation, Back, layers and
  /// suspension never drop it.
  val DraftRetained = s.unsent == (s.draft == "draft")
  val FocusedSettingIdentity = s.focusedSetting == s.intendedSetting and
    (s.focusedSetting == "" or containsSetting(s.settingsRows, s.focusedSetting))
  val CurrentSend = s.pending implies (not(s.contextSensitive) and s.sendRevision == s.revision)
  val safety = CurrentClaim and VisibleFocus and DraftRetained and FocusedSettingIdentity and CurrentSend
  val DeliveredClaimWitness = s.claim == "delivered" and s.captured != s.revision
  val LostClaimAcknowledgementWitness = s.claim == "unknown" and s.captured != s.revision
  val DraftAwayFromHomeWitness = s.unsent and s.view != "home" and s.contextSensitive
  run navigationKeepsDraftTest = init.then(edit).then(open("notes")).then(hide).then(resume).then(back).then(back)
    .expect(s.view == "home" and s.draft == "draft" and s.unsent and safety)
    .then(send).expect(s.draft == "" and not(s.unsent) and safety)
  run sheetGripDismissTest = init.then(showModal).then(dismissSheet).expect(not(s.modal) and safety)
  run assistantAboveSheetTest = init.then(showModal).then(assistantFromSheet).expect(not(s.modal) and s.chat == "sheet" and safety)
  run backOrderTest = init.then(edit).then(expand).then(showShade).then(showModal)
    .then(back).expect(s.shade).then(back).expect(s.chat == "full")
    .then(back).expect(s.chat == "sheet" and s.draft == "draft" and safety)
  run staleNavigationTest = init.then(capture).then(open("notes"))
    .expect(s.claim == "none" and safety)
  run wrongClaimDestinationRefusedTest = init.then(capture).then(claim("notes")).then(commitClaimedView("calendar").fail())
  run acknowledgeBeforeCommitRefusedTest = init.then(capture).then(claim("notes")).then(acknowledge.fail())
  run deliveryTest = init.then(capture).then(claim("notes"))
    .then(commitClaimedView("notes")).then(acknowledge)
    .expect(s.claim == "delivered" and s.view == "notes" and s.captured != s.revision and safety)
  run lostAcknowledgementKeepsCommittedViewTest = init.then(capture).then(claim("notes"))
    .then(commitClaimedView("notes")).then(acknowledgementLost)
    .expect(s.claim == "unknown" and s.view == "notes" and safety)
    .then(commitClaimedView("calendar").fail())
  run unrelatedViewRetiresClaimTest = init.then(capture).then(claim("notes")).then(open("calendar"))
    .expect(s.view == "calendar" and safety).then(commitClaimedView("notes").fail())
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
  run settingsRoleInsertionKeepsFocusTest = init.then(open("settings"))
    .then(settingsRowsChanged(List("default-apps"))).then(focusSetting("default-apps"))
    .then(settingsRowsChanged(List("request-home", "default-apps"))).then(activateExternalSetting)
    .expect(s.activatedSetting == "default-apps" and s.focusedSetting == "default-apps" and safety)
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
    .then(capture).then(claim("notes")).then(commitClaimedView("notes")).then(acknowledge).expect(s.claim == "delivered" and safety)
}
