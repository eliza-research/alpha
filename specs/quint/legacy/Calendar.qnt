// Faithful translation of the working Calendar.tla, including its updated
// undo-window and outbox semantics. Provider contents are three boolean rows.
module Calendar {
  type State = { Design: str, access: str, picked: bool, net: str, view: str, top: str, focus: int,
    server: int -> bool, local: int -> bool, op: int -> str, conflict: int -> bool,
    undo: int, bad: bool, rsvp: str, remote: int, flips: int }
  type TransitionHistory = { UndoBeforeSend: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val MaxRemote = 1
  pure val MaxFlips = 1
  pure val Ids = Set(1, 2, 3)
  pure val Fresh = 3
  pure val TopViews = Set("Day", "Week", "Month", "Schedule")
  pure val Views = TopViews.union(Set("Event", "Editor", "Search"))
  val TypeOK = Set("none", "read", "write").contains(s.access) and Set("up", "down").contains(s.net)
    and Views.contains(s.view) and TopViews.contains(s.top) and Ids.union(Set(0)).contains(s.focus)
    and s.server.keys() == Ids and s.local.keys() == Ids and s.op.keys() == Ids and s.conflict.keys() == Ids
    and Ids.forall(i => Set("none", "create", "update", "delete").contains(s.op.get(i)))
    and Ids.union(Set(0)).contains(s.undo) and Set("none", "yes", "no", "maybe").contains(s.rsvp)
    and s.remote >= 0 and s.remote <= MaxRemote and s.flips >= 0 and s.flips <= MaxFlips
  pure def initialState(design, access, net, bad) = { Design: design, access: access, picked: false,
    net: net, view: "Day", top: "Day", focus: 0, server: Ids.mapBy(i => i != Fresh),
    local: Ids.mapBy(i => i != Fresh), op: Ids.mapBy(i => "none"), conflict: Ids.mapBy(i => false),
    undo: 0, bad: bad, rsvp: "none", remote: 0, flips: 0 }
  // Persistent monitors are the exact state extension for the original
  // action properties. They observe transitions without constraining them.
  pure val initialChecks = { UndoBeforeSend: true }
  pure def UndoBeforeSendRelation(before: State, after: State): bool = Ids.forall(i => (before.undo == i and before.op.get(i) == "delete") implies
      not(after.op.get(i) == "none" and before.server.get(i) and not(after.server.get(i))))
  action Track(after: State): bool = all {
    s' = after,
    history' = { UndoBeforeSend: history.UndoBeforeSend and UndoBeforeSendRelation(s, after) }
  }
  val UndoBeforeSendInvariant = history.UndoBeforeSend
  action StartState(design, access, net, bad) = all { s' = { Design: design, access: access, picked: false,
    net: net, view: "Day", top: "Day", focus: 0, server: Ids.mapBy(i => i != Fresh),
    local: Ids.mapBy(i => i != Fresh), op: Ids.mapBy(i => "none"), conflict: Ids.mapBy(i => false),
    undo: 0, bad: bad, rsvp: "none", remote: 0, flips: 0 }, history' = initialChecks }
  action Init(design) = {
    nondet access = Set("none", "read", "write").oneOf()
    nondet net = Set("up", "down").oneOf()
    nondet bad = Bool.oneOf()
    StartState(design, access, net, bad)
  }
  action checkerInit = {
    nondet access = Set("none", "read", "write").oneOf()
    nondet net = Set("up", "down").oneOf()
    nondet bad = Bool.oneOf()
    all { s' = initialState("proposed", access, net, bad), history' = initialChecks }
  }
  action checkerCurrentInit = {
    nondet access = Set("none", "read", "write").oneOf()
    nondet net = Set("up", "down").oneOf()
    nondet bad = Bool.oneOf()
    all { s' = initialState("current", access, net, bad), history' = initialChecks }
  }
  action init = Init("proposed")
  action currentInit = Init("current")
  val GoogleShown = s.access != "none" and (s.Design == "proposed" or s.picked)
  val FeedFails = s.Design == "current" and s.bad
  val Displayed = Ids.filter(i => s.local.get(i) and not(i == 2 and s.bad)
    and (i == Fresh or (GoogleShown and not(FeedFails))))
  def Writable(i) = s.access == "write" and (s.Design == "proposed" or i == Fresh)
  action Switch(v) = all { TopViews.contains(v), TopViews.contains(s.view), v != s.view,
    v == "Schedule" implies s.Design == "proposed", Track({ ...s, view: v, top: v }) }
  action OpenSearch = all { s.Design == "proposed", TopViews.contains(s.view), Track({ ...s, view: "Search" }) }
  action OpenEvent(i) = all { TopViews.union(Set("Search")).contains(s.view), Displayed.contains(i),
    Track({ ...s, view: "Event", focus: i }) }
  val BackEnabled = not(TopViews.contains(s.view))
  action Back = all { BackEnabled,
    {
      val eventRemains = if (s.view == "Editor" and s.focus != 0) s.local.get(s.focus) else false
      Track({ ...s, view: if (eventRemains) "Event" else s.top, focus: if (eventRemains) s.focus else 0 })
    } }
  action NewEvent = all { TopViews.contains(s.view), Writable(Fresh), not(s.local.get(Fresh)), not(s.server.get(Fresh)),
    Track({ ...s, view: "Editor", focus: Fresh }) }
  val EditEnabled = if (s.view == "Event" and Writable(s.focus)) s.op.get(s.focus) != "delete" else false
  action Edit = all { EditEnabled, Track({ ...s, view: "Editor" }) }
  action Save = all { s.view == "Editor", Track({ ...s, local: s.local.set(s.focus, true),
    op: s.op.set(s.focus, if (s.server.get(s.focus)) "update" else "create"), view: "Event" }) }
  action Delete = all { s.view == "Event", Writable(s.focus), s.undo == 0,
    Track({ ...s, local: s.local.set(s.focus, false),
      op: s.op.set(s.focus, if (s.server.get(s.focus)) "delete" else "none"),
      undo: s.focus, view: s.top, focus: 0 }) }
  action UndoDelete = all { s.undo != 0,
    Track({ ...s, local: s.local.set(s.undo, true), op: s.op.set(s.undo, "none"), undo: 0 }) }
  action UndoExpires = all { s.undo != 0, Track({ ...s, undo: 0 }) }
  action Rsvp(answer) = all { s.Design == "proposed", s.view == "Event", s.focus == 1,
    Writable(1), s.local.get(1), s.rsvp != answer, Track({ ...s, rsvp: answer,
      op: s.op.set(s.focus, if (s.op.get(s.focus) == "create") "create" else "update") }) }
  action ResolveAt(keepMine, i) = all { s.Design == "proposed", s.conflict.get(i),
    Track({ ...s, conflict: s.conflict.set(i, false),
      op: s.op.set(i, if (keepMine) s.op.get(i) else "none"),
      local: s.local.set(i, if (keepMine) s.local.get(i) else s.server.get(i)) }) }
  action Resolve(keepMine) = { nondet i = Ids.oneOf(); ResolveAt(keepMine, i) }
  action PickInSettings = all { s.Design == "current", s.access != "none", not(s.picked),
    Track({ ...s, picked: true }) }
  action Sync(i) = all { s.net == "up", s.op.get(i) != "none", not(s.conflict.get(i)), s.undo != i,
    s.access == "write", s.Design == "proposed" or s.picked,
    Track({ ...s, server: s.server.set(i, s.op.get(i) != "delete"), op: s.op.set(i, "none") }) }
  action RemoteChangeTo(i, eventExists) = all { s.remote < MaxRemote, s.server.get(i), s.op.get(i) != "none",
    not(s.conflict.get(i)), Track({ ...s, remote: s.remote + 1,
      conflict: s.conflict.set(i, true), server: s.server.set(i, eventExists) }) }
  action RemoteChange(i) = { nondet eventExists = Bool.oneOf(); RemoteChangeTo(i, eventExists) }
  action NetDrop = all { s.flips < MaxFlips, s.net == "up", Track({ ...s, net: "down", flips: s.flips + 1 }) }
  action NetRecover = all { s.net == "down", Track({ ...s, net: "up" }) }
  action Nav = any {
    { nondet view = TopViews.oneOf(); Switch(view) },
    OpenSearch,
    { nondet eventId = Ids.oneOf(); OpenEvent(eventId) },
    Back
  }
  action Act = any { NewEvent, Edit, Save, Delete, UndoDelete, PickInSettings,
    { nondet answer = Set("yes", "no", "maybe").oneOf(); Rsvp(answer) } }
  action World = any { UndoExpires, NetDrop, NetRecover,
    { nondet eventId = Ids.oneOf(); RemoteChange(eventId) } }
  action AnyResolve = { nondet keepMine = Bool.oneOf(); Resolve(keepMine) }
  action AnySync = { nondet eventId = Ids.oneOf(); Sync(eventId) }
  action Next = any { Nav, Act, AnyResolve, AnySync, World }
  action step = any { Next, Track(s) }
  temporal Fairness = Ids.forall(i => Sync(i).weakFair(s)) and NetRecover.weakFair(s)
    and UndoExpires.weakFair(s) and AnyResolve.strongFair(s)
  val Initial = (history == initialChecks) and TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design, s.access, s.net, s.bad)
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(vars)) and Fairness
  temporal CurrentSpec = (Initial and s.Design == "current") and always(Next.orKeep(vars)) and Fairness
  val AlwaysBack = not(TopViews.contains(s.view)) implies BackEnabled
  val GoogleVisibleWhenConnected = s.access != "none" implies GoogleShown
  val BadEventIsolated = (GoogleShown and s.local.get(1)) implies Displayed.contains(1)
  val EditableWhenWritable = if (s.view == "Event" and s.access == "write" and Displayed.contains(s.focus))
    s.op.get(s.focus) != "delete" implies EditEnabled else true
  val SavedChangeVisible = Ids.forall(i => Set("create", "update").contains(s.op.get(i)) implies s.local.get(i))
  temporal UndoBeforeSend = always(history.UndoBeforeSend)
  temporal OutboxDrains = Ids.forall(i => leadsTo(s.op.get(i) != "none", s.op.get(i) == "none"))
  temporal CheckedUndoBeforeSend = Fairness implies UndoBeforeSend
  temporal CheckedOutboxDrains = Fairness implies OutboxDrains
  temporal CheckedTemporal = Fairness implies (UndoBeforeSend and OutboxDrains)
  val safety = TypeOK and AlwaysBack and GoogleVisibleWhenConnected and BadEventIsolated
    and EditableWhenWritable and SavedChangeVisible and UndoBeforeSendInvariant
  run createWhileOfflineTest = StartState("proposed", "write", "down", false)
    .then(NewEvent).then(Save).expect(s.local.get(Fresh) and s.op.get(Fresh) == "create" and safety)
    .then(NetRecover).then(Sync(Fresh)).expect(s.server.get(Fresh) and s.op.get(Fresh) == "none" and safety)
  run undoBeforeSendTest = StartState("proposed", "write", "up", false)
    .then(OpenEvent(1)).then(Delete).expect(s.undo == 1 and s.server.get(1) and safety)
    .then(UndoDelete).expect(s.local.get(1) and s.op.get(1) == "none" and safety)
  run expireThenDeleteTest = StartState("proposed", "write", "up", false)
    .then(OpenEvent(1)).then(Delete).then(UndoExpires).then(Sync(1))
    .expect(not(s.server.get(1)) and s.op.get(1) == "none" and safety)
  run conflictKeepsGoogleTest = StartState("proposed", "write", "up", false)
    .then(OpenEvent(1)).then(Edit).then(Save).then(RemoteChangeTo(1, false))
    .then(ResolveAt(false, 1)).expect(not(s.local.get(1)) and s.op.get(1) == "none" and safety)
  run badEventIsolationTest = StartState("proposed", "read", "up", true)
    .expect(Displayed.contains(1) and not(Displayed.contains(2)) and safety)
  run currentPickerRequiredTest = StartState("current", "write", "up", false)
    .expect(not(GoogleVisibleWhenConnected))
  run currentMalformedFeedTest = StartState("current", "write", "up", true)
    .then(PickInSettings).expect(not(BadEventIsolated))
  run currentReadOnlyGoogleTest = StartState("current", "write", "up", false)
    .then(PickInSettings).then(OpenEvent(1)).expect(not(EditableWhenWritable))
}
