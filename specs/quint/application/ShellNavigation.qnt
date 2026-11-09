/// Shell Back ordering and completed-action navigation claim fences.
module ShellNavigation {
  type State = { view: str, chat: str, shade: bool, drawer: bool, modal: bool,
    draft: str, revision: int, captured: int, claim: str, hidden: bool, focus: bool }
  var s: State
  pure val Views = Set("home", "assistant", "apps", "maps", "camera", "photos", "notes",
    "calendar", "notifications", "reminders", "workflows", "files", "inbox", "browser",
    "phone", "messages", "contacts", "passwords", "settings")
  action init = s' = { view: "home", chat: "input", shade: false, drawer: false,
    modal: false, draft: "", revision: 0, captured: 0, claim: "none", hidden: false, focus: false }
  action open(view: str): bool = all { view.in(Views), s.revision < 2,
    s' = { ...s, view: view, revision: s.revision + 1, shade: false, drawer: false,
      claim: "none", focus: false } }
  action expand = all { not(s.modal or s.hidden), s' = { ...s, chat: "full", focus: true, shade: false } }
  action edit = all { not(s.modal or s.hidden or s.shade), s' = { ...s, draft: "draft", focus: true, chat: "input" } }
  action showShade = s' = { ...s, shade: true, focus: false }
  action showModal = s' = { ...s, modal: true, focus: false }
  action back = if (s.modal) s' = { ...s, modal: false }
    else if (s.shade) s' = { ...s, shade: false }
    else if (s.drawer) s' = { ...s, drawer: false }
    else if (s.chat == "full") s' = { ...s, chat: "sheet", focus: false }
    else if (s.chat == "sheet") s' = { ...s, chat: "input", focus: false }
    else if (s.view != "home" and s.revision < 2) s' = { ...s, view: "home", revision: s.revision + 1, claim: "none", focus: false }
    else s' = s
  action capture = all { not(s.hidden), s.claim == "none",
    s' = { ...s, captured: s.revision, claim: "captured" } }
  action claim = all { s.claim == "captured", s.captured == s.revision, not(s.hidden),
    s' = { ...s, claim: "claimed" } }
  action acknowledge = all { s.claim == "claimed", s.captured == s.revision, not(s.hidden),
    s' = { ...s, claim: "delivered" } }
  action hide = s' = { ...s, hidden: true, claim: "none", focus: false }
  action resume = s' = { ...s, hidden: false }
  action step = {
    nondet view = Views.oneOf()
    any { open(view), expand, edit, showShade, showModal, back, capture, claim, acknowledge, hide, resume, s' = s }
  }
  val CurrentClaim = s.claim.in(Set("none", "captured")) or (s.captured == s.revision and not(s.hidden))
  val VisibleFocus = s.focus implies not(s.shade or s.modal or s.hidden)
  val DraftBound = s.draft.in(Set("", "draft"))
  val safety = CurrentClaim and VisibleFocus and DraftBound
  run backOrderTest = init.then(edit).then(expand).then(showShade).then(showModal)
    .then(back).expect(s.shade).then(back).expect(s.chat == "full")
    .then(back).expect(s.chat == "sheet" and s.draft == "draft" and safety)
  run staleNavigationTest = init.then(capture).then(open("notes"))
    .expect(s.claim == "none" and safety)
  run deliveryTest = init.then(capture).then(claim).then(acknowledge)
    .expect(s.claim == "delivered" and safety)
}
