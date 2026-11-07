// Current Calendar views, transient overlays, read generations and account-scoped preferences.
// Provider mutations are composed with CalendarSync rather than executed by this model.
module CalendarPresentation {
  type State = {
    view: str, day: int, month: int, active: bool, menu: bool, deleteSheet: bool,
    search: bool, chat: str, openEvent: int, openDay: int, form: str,
    formDay: int, creationId: int, savedCreationId: int, durableDraft: bool,
    restoredDraft: bool, validTime: bool, saveRequested: bool, submittedTimeValid: bool,
    owner: int, hidden: int -> bool, localAccess: bool, googleAccess: bool,
    localVisible: bool, localRows: bool, googleRows: bool, googleRowsOwner: int,
    generation: int, desiredRange: str, requestRange: str, requestDay: int,
    requestGeneration: int, requestOwner: int, loading: bool,
    lastReadGeneration: int, lastPublishedGeneration: int, truncated: bool
  }
  var s: State
  pure val Views = Set("day", "week", "month", "schedule")
  action init = s' = { view: "day", day: 0, month: 0, active: true,
    menu: false, deleteSheet: false, search: false, chat: "rest", openEvent: 0,
    openDay: 0, form: "none", formDay: 0, creationId: 0, savedCreationId: 0,
    durableDraft: false, restoredDraft: false, validTime: true, saveRequested: false, submittedTimeValid: false,
    owner: 1, hidden: Map(1 -> false, 2 -> false), localAccess: true, googleAccess: true,
    localVisible: true, localRows: false, googleRows: false, googleRowsOwner: 0,
    generation: 0, desiredRange: "months", requestRange: "months", requestDay: 0,
    requestGeneration: -1, requestOwner: 0, loading: false,
    lastReadGeneration: -1, lastPublishedGeneration: -1, truncated: false }
  val Visible = (if (s.localRows and s.localAccess and s.localVisible) Set(1) else Set())
    .union(if (s.googleRows and s.googleAccess and not(s.hidden.get(s.owner))
      and s.googleRowsOwner == s.owner) Set(2) else Set())
  val CanEditSelected = s.openEvent != 0 and Visible.contains(s.openEvent) and not(s.restoredDraft)
  action chooseView(view: str): bool = all { Views.contains(view), s.active, not(s.deleteSheet), s.form == "none", s.generation < 5,
    s' = { ...s, view: view, day: if (view == "schedule") 0 else s.day, month: 0,
      menu: false, openEvent: 0, desiredRange: if (s.search) "search" else "months",
      generation: s.generation + 1 } }
  action chooseDay(day: int): bool = all { day.in((-1).to(1)), s.active, s.generation < 5,
    s' = { ...s, day: day, view: "day", month: 0, openEvent: 0, generation: s.generation + 1 } }
  action moveMonth(offset: int): bool = all { s.view == "month", offset.in((-1).to(1)), s.generation < 5,
    s' = { ...s, month: offset, generation: s.generation + 1 } }
  action openMenu = all { s.active, not(s.deleteSheet), s.form == "none", s' = { ...s, menu: true } }
  action openSearch = all { s.active, s.form == "none", s.generation < 5,
    s' = { ...s, search: true, menu: false, desiredRange: "search", generation: s.generation + 1 } }
  action showEvent(id: int, day: int): bool = all { s.active, Visible.contains(id), day.in((-1).to(1)),
    s' = { ...s, openEvent: id, openDay: day, form: "none", menu: false, restoredDraft: false } }
  action askDelete = all { s.active, CanEditSelected, s.form == "none",
    s' = { ...s, deleteSheet: true, menu: false } }
  action expandChat = all { s.active, not(s.menu or s.deleteSheet), s' = { ...s, chat: "sheet" } }
  action newForm = all { s.active, not(s.menu or s.deleteSheet),
    s' = { ...s, form: "new", formDay: s.day, creationId: 1, validTime: true,
      restoredDraft: false, saveRequested: false } }
  action editForm = all { s.active, CanEditSelected,
    s' = { ...s, form: "edit", formDay: s.openDay, creationId: 0,
      validTime: true, saveRequested: false, restoredDraft: false } }
  action invalidClockTime = all { s.form != "none", s' = { ...s, validTime: false } }
  action saveDraft = all { s.form == "new",
    s' = { ...s, durableDraft: true, savedCreationId: s.creationId } }
  // A restored creation draft keeps its idempotency key and civil date, with no provider authority.
  action restoreDraft = all { s.durableDraft, s.active,
    s' = { ...s, form: "new", creationId: s.savedCreationId, openEvent: 0,
      restoredDraft: true, saveRequested: false } }
  action requestSave = all { s.active, s.form != "none", s.validTime,
    s.form == "new" or CanEditSelected, s' = { ...s, saveRequested: true, submittedTimeValid: s.validTime } }
  action failedSave = all { s.saveRequested, s' = { ...s, saveRequested: false } }
  action request = all { s.active, not(s.loading),
    s' = { ...s, loading: true, requestRange: s.desiredRange, requestDay: s.day,
      requestGeneration: s.generation, requestOwner: s.owner } }
  action reply(generation: int, owner: int, truncated: bool): bool = all { s.loading,
    if (generation != s.requestGeneration or owner != s.requestOwner) s' = s
    else if (generation != s.generation or owner != s.owner or s.requestRange != s.desiredRange)
      s' = { ...s, loading: false }
    else s' = { ...s, loading: false, localRows: s.localAccess, googleRows: s.googleAccess,
      googleRowsOwner: if (s.googleAccess) owner else 0, truncated: truncated,
      lastReadGeneration: generation, lastPublishedGeneration: s.generation } }
  action hideGoogle = s' = { ...s, hidden: s.hidden.set(s.owner, true) }
  action showGoogle = s' = { ...s, hidden: s.hidden.set(s.owner, false) }
  action toggleLocal = s' = { ...s, localVisible: not(s.localVisible) }
  action revokeLocal = all { s.generation < 5,
    s' = { ...s, localAccess: false, localRows: false, generation: s.generation + 1 } }
  action revokeGoogle = all { s.generation < 5,
    s' = { ...s, googleAccess: false, googleRows: false, generation: s.generation + 1 } }
  action changeOwner = all { s.generation < 5,
    s' = { ...s, owner: 3 - s.owner, generation: s.generation + 1, googleRows: false,
      googleRowsOwner: 0, openEvent: 0, deleteSheet: false, saveRequested: false } }
  action back = if (s.menu) s' = { ...s, menu: false }
    else if (s.deleteSheet) s' = { ...s, deleteSheet: false }
    else if (s.chat != "rest") s' = { ...s, chat: "rest" }
    else if (s.form != "none") s' = { ...s, form: "none", saveRequested: false, restoredDraft: false }
    else if (s.openEvent != 0) s' = { ...s, openEvent: 0,
      day: if (s.view == "schedule") 0 else s.openDay }
    else if (s.search and s.generation < 5) s' = { ...s, search: false,
      desiredRange: "months", day: if (s.view == "schedule") 0 else s.day,
      generation: s.generation + 1 }
    else s' = s
  action leave = s' = { ...s, active: false, menu: false, deleteSheet: false, saveRequested: false }
  action enter = s' = { ...s, active: true }
  action step = any {
    { nondet view = Views.oneOf(); chooseView(view) },
    { nondet day = (-1).to(1).oneOf(); chooseDay(day) },
    { nondet offset = (-1).to(1).oneOf(); moveMonth(offset) },
    { nondet id = Set(1, 2).oneOf(); nondet day = (-1).to(1).oneOf(); showEvent(id, day) },
    { nondet token = (-1).to(5).oneOf(); nondet owner = Set(1, 2).oneOf();
      nondet truncated = Bool.oneOf(); reply(token, owner, truncated) },
    openMenu, openSearch, askDelete, expandChat, newForm, editForm, invalidClockTime,
    saveDraft, restoreDraft, requestSave, failedSave, request, hideGoogle, showGoogle,
    toggleLocal, revokeLocal, revokeGoogle, changeOwner, back, leave, enter, s' = s
  }
  val ScheduleStartsToday = s.view == "schedule" implies s.day == 0
  val MonthOffsetScoped = s.view == "month" or s.month == 0
  val ExclusiveTransientOverlay = not(s.menu and s.deleteSheet)
  val CurrentReadCommitted = s.lastReadGeneration == s.lastPublishedGeneration
  val GoogleCacheOwnerBound = s.googleRows implies s.googleRowsOwner == s.owner
  val RevokedSourcesHidden = (not(s.localAccess) implies not(Visible.contains(1)))
    and (not(s.googleAccess) implies not(Visible.contains(2)))
  val RestoredCreationKeepsId = s.durableDraft and s.form == "new" implies s.creationId == s.savedCreationId
  val SaveNeedsValidTime = s.saveRequested implies s.submittedTimeValid
  val NoRestoredAuthority = s.restoredDraft implies s.form == "new" and s.openEvent == 0
  val TransientsEndWithVisit = not(s.active) implies not(s.menu or s.deleteSheet)
  val TypeOK = Views.contains(s.view) and s.day.in((-1).to(1)) and s.month.in((-1).to(1))
    and s.owner.in(Set(1, 2)) and s.generation.in(0.to(5)) and s.openEvent.in(0.to(2))
  val safety = ScheduleStartsToday and MonthOffsetScoped and ExclusiveTransientOverlay
    and CurrentReadCommitted and GoogleCacheOwnerBound and RevokedSourcesHidden
    and RestoredCreationKeepsId and SaveNeedsValidTime and NoRestoredAuthority
    and TransientsEndWithVisit and TypeOK
  run overlayBackOrderTest = init.then(request).then(reply(0, 1, false)).then(showEvent(1, 1))
    .then(expandChat).then(askDelete).then(back).expect(not(s.deleteSheet) and s.chat == "sheet")
    .then(back).expect(s.chat == "rest" and s.openEvent == 1)
    .then(back).expect(s.openEvent == 0 and s.day == 1 and safety)
  run staleRangeReplyTest = init.then(request).then(openSearch).then(reply(0, 1, false))
    .expect(not(s.localRows) and not(s.googleRows)).then(request).then(reply(1, 1, true))
    .expect(s.localRows and s.googleRows and s.truncated and safety)
  run accountPreferenceIsolationTest = init.then(hideGoogle).then(changeOwner).then(request)
    .then(reply(1, 2, false)).expect(Visible.contains(2) and safety)
    .then(changeOwner).expect(not(Visible.contains(2)) and s.hidden.get(1) and safety)
  run scheduleReturnTest = init.then(chooseView("schedule")).then(request).then(reply(1, 1, false))
    .then(showEvent(1, -1)).then(back).expect(s.day == 0 and safety)
  run draftClockAndIdentityTest = init.then(newForm).then(invalidClockTime).then(saveDraft)
    .then(back).then(restoreDraft).expect(not(s.validTime) and s.creationId == 1 and not(s.saveRequested) and safety)
  run failedSaveRetainsFormTest = init.then(newForm).then(requestSave).then(failedSave)
    .expect(s.form == "new" and s.creationId == 1 and safety)
  run editsAfterSubmitPreserveSnapshotTest = init.then(newForm).then(requestSave).then(invalidClockTime)
    .expect(s.saveRequested and s.submittedTimeValid and not(s.validTime) and safety)
}

