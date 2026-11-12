// Renderer control and retained intent for one LifeOps scheduled task.
module ScheduledTaskControls {
  type Request = {verb: str, text: str, cron: str, zone: str, minutes: int}
  type Intent = {owner: str, request: Request}
  type Send = {owner: str, request: Request, retained: bool}
  type State = {
    owner: str, visible: bool, kind: str, storedStatus: str, storedText: str, storedCron: str,
    catalog: str, source: str, detail: bool, shownStatus: str, editing: bool, draft: str, time: str, days: str,
    review: Request, pending: Intent, message: str, sends: List[Send], intents: Set[Intent]
  }
  var s: State
  val Empty = {verb: "", text: "", cron: "", zone: "", minutes: 0}
  val Idle = {owner: "", request: Empty}
  val InitialText = "Review the week."
  val EditedText = "New instructions."
  val Drafts = Set("", InitialText, EditedText, "  New instructions.  ")
  val Times = Set("", "08:00", "09:30", "25:00")
  val Kinds = Set("preset", "custom", "manual")
  val Terminal = Set("completed", "dismissed", "skipped", "expired", "failed")
  val Catalogs = Set("available", "missing-partial", "failed")
  val KnownFire = Set("raced", "skipped", "dispatch_deferred", "dispatch_failed")
  val Unconfirmed = Set("wrong-id", "missing-id", "wrong-skipped-id", "transport-lost", "bad-edit")

  pure def status(kind: str, current: str): str =
    if (kind == "manual" and not(Terminal.contains(current))) "paused" else current
  pure def menuFor(current: str): List[str] =
    if (Terminal.contains(current)) List("reopen") else List("fire", "edit", "snooze")
  pure def ownerHasIntent(state: State): bool = state.intents.exists(entry => entry.owner == state.owner)
  pure def retired(state: State): State =
    {...state, detail: false, shownStatus: "", editing: false, draft: "", review: Empty, message: ""}
  pure def readList(state: State): State =
    if (state.catalog == "missing-partial")
      {...retired(state), source: "missing", message: state.message, time: if (state.detail) "" else state.time}
    else if (state.catalog == "failed") {...state, source: "failed"}
    else {...state, source: "available",
      shownStatus: if (state.detail) status(state.kind, state.storedStatus) else ""}

  action initFor(kind: str, current: str): bool = all {
    Kinds.contains(kind), current == "scheduled" or Terminal.contains(current),
    s' = {owner: "a", visible: true, kind: kind, storedStatus: current, storedText: InitialText,
      storedCron: if (kind == "preset") "0 8 * * 1" else if (kind == "custom") "0 8 1 * *" else "",
      catalog: "available", source: "available", detail: false, shownStatus: "", editing: false, draft: "", time: "", days: "*",
      review: Empty, pending: Idle, message: "", sends: List(), intents: Set()},
  }
  action init = {
    nondet kind = Kinds.oneOf()
    nondet current = Terminal.union(Set("scheduled")).oneOf()
    initFor(kind, current)
  }

  val busy = s.visible and s.pending.owner == s.owner
  val locked = s.detail and ownerHasIntent(s) and not(busy)
  val reviewVerb = s.review.verb
  val clockEditable = s.detail and s.kind == "preset"
  val menu = if (s.detail and not(s.editing) and reviewVerb == "") menuFor(s.shownStatus) else List()
  val menuDisabled = not(menu.length() == 0) and (busy or locked or s.source != "available")
  action open = all {
    s.visible, s.source == "available", not(busy), not(s.detail),
    s' = {...s, detail: true, shownStatus: status(s.kind, s.storedStatus), editing: false, draft: "", review: Empty, message: ""},
  }
  action pick(verb: str): bool = all {
    menu.indices().exists(i => menu.nth(i) == verb), not(menuDisabled),
    s' = if (verb == "edit")
      {...s, editing: true, draft: s.storedText, days: if (Set("0 8 * * 0,6", "30 9 * * 0,6").contains(s.storedCron)) "0,6" else if (Set("0 8 * * 1,3,5", "30 9 * * 1,3,5").contains(s.storedCron)) "1,3,5" else if (clockEditable) "1" else "*", time: if (Set("0 8 * * 1", "0 8 * * 0,6", "0 8 * * 1,3,5").contains(s.storedCron)) "08:00" else if (clockEditable) "09:30" else ""}
      else {...s, review: {...Empty, verb: verb, minutes: if (verb == "snooze") 10 else 0}, message: ""},
  }
  action enter(text: str, time: str): bool = all {
    s.editing, Drafts.contains(text), Times.contains(time), clockEditable or time == "",
    s' = {...s, draft: text, time: time},
  }
  action save = all {
    s.editing, s.draft != "", not(busy), not(locked), s.source == "available",
    val cron = if (s.time == "09:30") (if (s.days == "0,6") "30 9 * * 0,6" else if (s.days == "1,3,5") "30 9 * * 1,3,5" else "30 9 * * 1") else (if (s.days == "0,6") "0 8 * * 0,6" else if (s.days == "1,3,5") "0 8 * * 1,3,5" else "0 8 * * 1")
    val changed = clockEditable and cron != s.storedCron
    val text = if (s.draft == "  New instructions.  ") EditedText else s.draft
    s' = if (clockEditable and (not(Set("08:00", "09:30").contains(s.time)) or s.days == ""))
      {...s, message: "invalid-time"}
      else {...s, editing: false, draft: "", review: {...Empty, verb: "edit", text: text,
        cron: if (changed) cron else "",
        zone: if (changed) "UTC" else ""}, message: ""},
  }
  action chooseDays(days: str): bool = all {s.editing, clockEditable, Set("", "1", "0,6", "1,3,5").contains(days), s' = {...s, days: days}}
  action cancelEdit = all {s.editing, s' = {...s, editing: false, draft: ""}}
  action cancelReview = all {reviewVerb != "", s' = {...s, review: Empty}}
  action chooseCatalog(catalog: str): bool = all {Catalogs.contains(catalog), s' = {...s, catalog: catalog}}
  action refresh = all {s.visible, not(busy), s' = readList({...s, message: ""})}

  action confirm = all {
    s.visible, reviewVerb != "", s.pending == Idle, not(locked), s.sends.length() < 3,
    val exact = {owner: s.owner, request: s.review}
    s' = if (s.source != "available") readList({...s, review: Empty, message: "source-unavailable"})
      else {...s, review: Empty, pending: exact, intents: s.intents.union(Set(exact)),
        sends: s.sends.append({owner: exact.owner, request: exact.request, retained: true}), message: ""},
  }
  action answer(result: str): bool = all {
    s.pending != Idle, result == "exact" or KnownFire.contains(result) or Unconfirmed.contains(result),
    val verb = s.pending.request.verb
    val request = s.pending.request
    val success = result == "exact"
    val retained = if (success or KnownFire.contains(result)) s.intents.exclude(Set(s.pending)) else s.intents
    val stored = if (success and verb == "edit") {...s, storedText: request.text,
      storedCron: if (request.cron == "") s.storedCron else request.cron}
      else if (success and verb == "reopen") {...s, storedStatus: "scheduled"} else s
    val message = if (success) (if (verb == "fire") "started" else "")
      else if (result == "raced") "raced" else if (KnownFire.contains(result)) "not-run" else "unknown"
    all {
      verb == "fire" or not(KnownFire.contains(result)),
      s' = if (busy) readList({...stored, pending: Idle, intents: retained, message: message})
        else {...stored, pending: Idle},
    },
  }
  action release(allowed: bool): bool = all {
    s.visible, not(busy), locked,
    s' = if (allowed) {...s, intents: s.intents.filter(entry => entry.owner != s.owner), message: ""} else s,
  }
  action switchOwner = all {
    s.visible, s.owner == "a",
    s' = readList({...retired(s), owner: "b"}),
  }
  action leave = all {s.visible, s' = {...retired(s), visible: false, source: "idle"}}
  action step = any {
    open, save, cancelEdit, cancelReview, confirm, refresh, switchOwner, leave,
    {nondet verb = Set("fire", "edit", "snooze", "reopen").oneOf(); pick(verb)},
    {nondet days = Set("", "1", "0,6", "1,3,5").oneOf(); chooseDays(days)},
    {nondet text = Drafts.oneOf(); nondet time = Times.oneOf(); enter(text, time)},
    {nondet catalog = Catalogs.oneOf(); chooseCatalog(catalog)},
    {nondet result = KnownFire.union(Unconfirmed).union(Set("exact")).oneOf(); answer(result)},
    {nondet allowed = Bool.oneOf(); release(allowed)},
    s' = s,
  }

  val SentWithExactIntent = s.sends.indices().forall(i => s.sends.nth(i).retained)
  val PendingRemainsJournaled = s.pending != Idle implies s.intents.contains(s.pending)
  val UnconfirmedStaysLocked = s.message == "unknown" implies ownerHasIntent(s)
  val TerminalHasReopenOnly = s.detail and Terminal.contains(s.shownStatus) implies menu == List() or menu == List("reopen")
  val FailedSourceDisablesControls = s.source != "available" and menu.length() > 0 implies menuDisabled
  val safety = SentWithExactIntent and PendingRemainsJournaled and UnconfirmedStaysLocked and TerminalHasReopenOnly and FailedSourceDisablesControls

  run editReviewBindsExactRequestTest = initFor("preset", "scheduled").then(open).then(pick("edit"))
    .then(enter("  New instructions.  ", "09:30")).then(save).expect(s.sends == List())
    .then(confirm).expect(s.pending.request.cron == "30 9 * * 1" and s.pending.request.text == EditedText and safety)
    .then(answer("exact")).expect(s.storedCron == "30 9 * * 1" and s.intents == Set() and safety)
  run mismatchedFireRemainsLockedTest = initFor("preset", "scheduled").then(open).then(pick("fire"))
    .then(confirm).then(answer("wrong-id")).expect(locked and s.message == "unknown" and safety)
  run racedFireDoesNotClaimSuccessTest = initFor("preset", "scheduled").then(open).then(pick("fire"))
    .then(confirm).then(answer("raced")).expect(not(locked) and s.message == "raced" and safety)
  run terminalManualReopenTest = initFor("manual", "completed").then(open).expect(menu == List("reopen"))
    .then(pick("reopen")).then(confirm).then(answer("exact")).expect(s.shownStatus == "paused" and safety)
  run partialAbsenceRetiresDetailTest = initFor("preset", "scheduled").then(open).then(pick("fire"))
    .then(confirm).then(chooseCatalog("missing-partial")).then(answer("exact"))
    .expect(not(s.detail) and s.source == "missing" and safety)
  run failedListCannotDispatchReviewedActionTest = initFor("preset", "scheduled").then(open).then(pick("fire"))
    .then(chooseCatalog("failed")).then(refresh).then(confirm)
    .expect(s.detail and s.sends == List() and menuDisabled and safety)
  run retiredReplyDoesNotReleaseTest = initFor("preset", "scheduled").then(open).then(pick("fire")).then(confirm)
    .then(switchOwner).then(answer("exact")).expect(s.intents.size() == 1 and s.message == "" and safety)
}
