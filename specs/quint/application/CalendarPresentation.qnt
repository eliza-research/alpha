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
    lastReadGeneration: int, lastPublishedGeneration: int, truncated: bool,
    // readToken numbers each read; only the latest one may publish or end loading.
    readToken: int, lastReadToken: int,
    nextCreation: int, saved: bool
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
    lastReadGeneration: -1, lastPublishedGeneration: -1, truncated: false,
    readToken: 0, lastReadToken: 0, nextCreation: 0, saved: false }
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
    s' = { ...s, openEvent: id, openDay: day, form: "none", menu: false, restoredDraft: false,
      saveRequested: false } }
  action askDelete = all { s.active, CanEditSelected, s.form == "none",
    s' = { ...s, deleteSheet: true, menu: false } }
  action expandChat = all { s.active, not(s.menu or s.deleteSheet), s' = { ...s, chat: "sheet" } }
  // The + button resumes a retained creation form instead of starting another.
  action newForm = all { s.active, not(s.menu or s.deleteSheet), not(s.durableDraft), s.nextCreation < 3,
    s' = { ...s, form: "new", formDay: s.day, creationId: s.nextCreation + 1,
      nextCreation: s.nextCreation + 1, validTime: true,
      restoredDraft: false, saveRequested: false, menu: false } }
  action editForm = all { s.active, CanEditSelected, not(s.menu or s.deleteSheet),
    s' = { ...s, form: "edit", formDay: s.openDay, creationId: 0,
      validTime: true, saveRequested: false, restoredDraft: false } }
  action invalidClockTime = all { s.form != "none", s' = { ...s, validTime: false } }
  action saveDraft = all { s.form == "new",
    s' = { ...s, durableDraft: true, savedCreationId: s.creationId } }
  // A restored creation draft keeps its idempotency key and civil date, with no provider authority.
  action restoreDraft = all { s.durableDraft, s.active,
    s' = { ...s, form: "new", creationId: s.savedCreationId, openEvent: 0,
      restoredDraft: true, saveRequested: false } }
  action discardDraft = all { s.durableDraft, s.active, s.form == "new", not(s.saveRequested),
    s' = { ...s, form: "none", durableDraft: false, restoredDraft: false, openEvent: 0 } }
  action requestSave = all { s.active, s.form != "none", s.validTime,
    s.form == "new" or CanEditSelected, s' = { ...s, saveRequested: true, submittedTimeValid: s.validTime } }
  action failedSave = all { s.saveRequested, s' = { ...s, saveRequested: false } }
  // A confirmed save closes the submitted form and shows its day. Schedule always runs from
  // today, so the saved day applies there only through the opened event.
  action saveSucceeded = all { s.saveRequested, s.form != "none", s.generation < 5,
    s' = { ...s, form: "none", saveRequested: false, restoredDraft: false, openEvent: 0,
      month: 0, day: if (s.view == "schedule") 0 else s.formDay, saved: true,
      durableDraft: if (s.form == "new") false else s.durableDraft,
      generation: s.generation + 1 } }
  // A forced read starts while another is in flight; the newer read supersedes the older.
  action request(force: bool): bool = all { s.active, not(s.loading) or force, s.readToken < 6,
    s' = { ...s, loading: true, requestRange: s.desiredRange, requestDay: s.day,
      requestGeneration: s.generation, requestOwner: s.owner, readToken: s.readToken + 1 } }
  action reply(token: int, owner: int, truncated: bool): bool = all { s.loading,
    if (token != s.readToken or owner != s.requestOwner) s' = s
    else if (s.requestGeneration != s.generation or owner != s.owner or s.requestRange != s.desiredRange)
      s' = { ...s, loading: false }
    else s' = { ...s, loading: false, localRows: s.localAccess, googleRows: s.googleAccess,
      googleRowsOwner: if (s.googleAccess) owner else 0,
      truncated: truncated, lastReadToken: token,
      lastReadGeneration: s.requestGeneration, lastPublishedGeneration: s.generation } }
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
  // The shell lowers the conversation first; the view then closes one layer per Back.
  action back = if (s.chat != "rest") s' = { ...s, chat: "rest" }
    else if (s.form != "none") s' = { ...s, form: "none", saveRequested: false, restoredDraft: false }
    else if (s.deleteSheet) s' = { ...s, deleteSheet: false }
    else if (s.openEvent != 0) s' = { ...s, openEvent: 0,
      day: if (s.view == "schedule") 0 else s.openDay }
    else if (s.menu) s' = { ...s, menu: false }
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
    { nondet token = 0.to(6).oneOf(); nondet owner = Set(1, 2).oneOf();
      nondet truncated = Bool.oneOf(); reply(token, owner, truncated) },
    openMenu, openSearch, askDelete, expandChat, newForm, editForm, invalidClockTime,
    saveDraft, restoreDraft, discardDraft, requestSave, failedSave, saveSucceeded,
    request(false), request(true), hideGoogle, showGoogle,
    toggleLocal, revokeLocal, revokeGoogle, changeOwner, back, leave, enter, s' = s
  }
  val ScheduleStartsToday = s.view == "schedule" implies s.day == 0
  val MonthOffsetScoped = s.view == "month" or s.month == 0
  val ExclusiveTransientOverlay = not(s.menu and s.deleteSheet)
  // Published rows were read for the view generation they are published under.
  val CurrentReadCommitted = s.lastReadGeneration == s.lastPublishedGeneration
  // Only the newest read is awaited: a superseded read neither publishes nor ends loading.
  val LatestReadWins = s.lastReadToken <= s.readToken and (s.loading implies s.lastReadToken < s.readToken)
  val GoogleCacheOwnerBound = s.googleRows implies s.googleRowsOwner == s.owner
  val RevokedSourcesHidden = (not(s.localAccess) implies not(Visible.contains(1)))
    and (not(s.googleAccess) implies not(Visible.contains(2)))
  val RestoredCreationKeepsId = s.durableDraft and s.form == "new" implies s.creationId == s.savedCreationId
  val SaveNeedsValidTime = s.saveRequested implies s.submittedTimeValid
  val NoRestoredAuthority = s.restoredDraft implies s.form == "new" and s.openEvent == 0
  val TransientsEndWithVisit = not(s.active) implies not(s.menu or s.deleteSheet)
  val TypeOK = Views.contains(s.view) and s.day.in((-1).to(1)) and s.month.in((-1).to(1))
    and s.owner.in(Set(1, 2)) and s.generation.in(0.to(5)) and s.openEvent.in(0.to(2))
    and s.readToken.in(0.to(6)) and s.creationId.in(0.to(3))
  val safety = ScheduleStartsToday and MonthOffsetScoped and ExclusiveTransientOverlay
    and CurrentReadCommitted and LatestReadWins and GoogleCacheOwnerBound and RevokedSourcesHidden
    and RestoredCreationKeepsId and SaveNeedsValidTime and NoRestoredAuthority
    and TransientsEndWithVisit and TypeOK

  val SavedInScheduleWitness = s.saved and s.view == "schedule"
  val OverlappingReadWitness = s.loading and s.readToken - s.lastReadToken >= 2
  val GoogleEventOpenWitness = s.openEvent == 2
  val RestoredDraftWitness = s.restoredDraft and s.durableDraft

  // The shell lowers the conversation before the view closes its own layers.
  run overlayBackOrderTest = init.then(request(false)).then(reply(1, 1, false)).then(showEvent(1, 1))
    .then(expandChat).then(askDelete).then(back).expect(s.deleteSheet and s.chat == "rest")
    .then(back).expect(not(s.deleteSheet) and s.openEvent == 1)
    .then(back).expect(s.openEvent == 0 and s.day == 1 and safety)
  run formClosesBeforeEventTest = init.then(request(false)).then(reply(1, 1, false)).then(showEvent(1, 1))
    .then(editForm).then(back).expect(s.form == "none" and s.openEvent == 1 and safety)
  run staleRangeReplyTest = init.then(request(false)).then(openSearch).then(reply(1, 1, false))
    .expect(not(s.localRows) and not(s.googleRows)).then(request(false)).then(reply(2, 1, true))
    .expect(s.localRows and s.googleRows and s.truncated and safety)
  // A forced read supersedes the one in flight: the older answer changes nothing.
  run supersededReadTest = init.then(request(false)).then(request(false).fail())
  run latestReadWinsTest = init.then(request(false)).then(request(true))
    .expect(OverlappingReadWitness).then(reply(1, 1, true))
    .expect(s.loading and not(s.localRows) and not(s.truncated))
    .then(reply(2, 1, false)).expect(not(s.loading) and s.localRows and s.lastReadToken == 2 and safety)
  run accountPreferenceIsolationTest = init.then(hideGoogle).then(changeOwner).then(request(false))
    .then(reply(1, 2, false)).expect(Visible.contains(2) and safety)
    .then(changeOwner).expect(not(Visible.contains(2)) and s.hidden.get(1) and safety)
  run scheduleReturnTest = init.then(chooseView("schedule")).then(request(false)).then(reply(1, 1, false))
    .then(showEvent(1, -1)).then(back).expect(s.day == 0 and safety)
  run formBlocksViewChangeTest = init.then(chooseDay(1)).then(newForm).then(chooseView("schedule").fail())
  // A save from Schedule keeps Schedule on today; other views show the saved day.
  run scheduleSaveTest = init.then(chooseDay(1)).then(chooseView("schedule")).then(request(false))
    .then(reply(1, 1, false)).then(showEvent(1, 1)).then(editForm).then(requestSave).then(saveSucceeded)
    .expect(s.form == "none" and s.day == 0 and s.openEvent == 0 and safety)
  run daySaveShowsSavedDayTest = init.then(chooseDay(1)).then(newForm).then(chooseDay(-1))
    .then(requestSave).then(saveSucceeded)
    .expect(s.form == "none" and s.day == 1 and not(s.durableDraft) and safety)
  // Changing account closes the open event and its delete sheet.
  run accountChangeClosesEventTest = init.then(request(false)).then(reply(1, 1, false))
    .then(showEvent(2, 0)).then(askDelete).expect(GoogleEventOpenWitness).then(changeOwner)
    .expect(s.openEvent == 0 and not(s.deleteSheet) and safety)
  run draftClockAndIdentityTest = init.then(newForm).then(invalidClockTime).then(saveDraft)
    .then(back).then(restoreDraft).expect(not(s.validTime) and s.creationId == 1 and not(s.saveRequested) and safety)
  run failedSaveRetainsFormTest = init.then(newForm).then(requestSave).then(failedSave)
    .expect(s.form == "new" and s.creationId == 1 and safety)
  run editsAfterSubmitPreserveSnapshotTest = init.then(newForm).then(requestSave).then(invalidClockTime)
    .expect(s.saveRequested and s.submittedTimeValid and not(s.validTime) and safety)
}

