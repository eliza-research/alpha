// Faithful translation of docs/ui-refresh-2026-11/tla/HomeLayout.tla.
module HomeLayout {
  type State = { Design: str, cal: str, flows: str, mail: str, brief: bool,
    insets: str, dock: str, top0: int }
  var s: State
  val vars = s
  pure val H = 871
  pure val G = 370
  pure val PadTop = 20
  pure val Short = 196
  pure val Tall = 236
  pure val Fixed = 212
  pure val CalStates = Set("loading", "none", "event", "error", "denied")
  pure val FlowStates = Set("noagent", "loading", "none", "paused", "active", "failed")
  pure val MailStates = Set("unconnected", "loading", "none", "unread", "error")
  pure val Docks = Set("pill", "bar", "keyboard")
  val Google = s.mail != "unconnected"
  val Shown = if (s.Design == "current") Set("calendar", "workflows", "inbox")
      .union(if (s.brief) Set("brief") else Set())
    else (if (s.cal == "event") Set("calendar") else Set())
      .union(if (s.flows == "active") Set("workflows") else Set())
      .union(if (s.mail == "unread") Set("inbox") else Set())
      .union(if (s.brief) Set("brief") else Set())
  val DateLine = s.Design == "proposed" and Shown == Set()
  val SetupLink = DateLine and not(Google)
  def HasContent(c) = if (c == "calendar") s.cal == "event"
    else if (c == "workflows") s.flows == "active"
    else if (c == "inbox") s.mail == "unread" else s.brief
  def Loading(c) = if (c == "calendar") s.cal == "loading"
    else if (c == "workflows") s.flows == "loading"
    else if (c == "inbox") s.mail == "loading" else false
  pure def Max(a, b) = if (a > b) a else b
  // TLA+ integer division floors negative values; Quint / truncates to zero.
  pure def HalfFloor(n) = if (n >= 0) n / 2 else -((-n + 1) / 2)
  pure def gridTop(design, cal, flows, mail, insets, dock) = {
    val clear = if (insets == "pending") 28 else 60
    val measured = if (insets == "pending") 102 else clear +
      (if (dock == "pill") 54 else if (dock == "bar") 62 else 342)
    val rowH = if (design == "proposed") Fixed
      else if (cal == "event" or mail == "unread" or Set("active", "paused").contains(flows)) Tall else Short
    val above = PadTop + rowH
    if (design == "current") above + HalfFloor(H - Max(108, measured + 6) - above - G)
    else H - (clear + 62 + 24) - G
  }
  val Clear = if (s.insets == "pending") 28 else 60
  val MeasuredRest = if (s.insets == "pending") 102 else Clear +
    (if (s.dock == "pill") 54 else if (s.dock == "bar") 62 else 342)
  val RowH = if (s.Design == "proposed") Fixed
    else if (s.cal == "event" or s.mail == "unread" or Set("active", "paused").contains(s.flows)) Tall else Short
  val GridTop = gridTop(s.Design, s.cal, s.flows, s.mail, s.insets, s.dock)
  val TypeOK = CalStates.contains(s.cal) and FlowStates.contains(s.flows)
    and MailStates.contains(s.mail) and Set("pending", "native").contains(s.insets) and Docks.contains(s.dock)
  pure def initialState(design) = {
    val insets = if (design == "current") "pending" else "native"
    { Design: design, cal: "loading", flows: "loading", mail: "loading", brief: false,
      insets: insets, dock: "bar", top0: gridTop(design, "loading", "loading", "loading", insets, "bar") }
  }
  action Init(design) = s' = initialState(design)
  action checkerInit = s' = initialState("proposed")
  action checkerCurrentInit = s' = initialState("current")
  action init = Init("proposed")
  action currentInit = Init("current")
  action CalendarSource(c) = s' = { ...s, cal: c }
  action WorkflowSource(f) = s' = { ...s, flows: f }
  action MailSource(m) = s' = { ...s, mail: m }
  action BriefSource = s' = { ...s, brief: not(s.brief) }
  action Source = {
    nondet c = CalStates.oneOf()
    nondet f = FlowStates.oneOf()
    nondet m = MailStates.oneOf()
    any { CalendarSource(c), WorkflowSource(f), MailSource(m), BriefSource }
  }
  action InsetsArrive = all { s.insets == "pending", s' = { ...s, insets: "native" } }
  action ChangeDock(d) = s' = { ...s, dock: d }
  action Next = { nondet d = Docks.oneOf(); any { Source, InsetsArrive, ChangeDock(d) } }
  action step = any { Next, s' = s }
  val Initial = TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design)
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(s))
  val GridStable = GridTop == s.top0
  val CardsHaveContent = Shown.forall(c => HasContent(c))
  val NoLoadingCards = Shown.forall(c => not(Loading(c)))
  val TopNeverBlank = Shown != Set() or DateLine
  val SetupOnlyWhenNeeded = SetupLink implies not(Google)
  val safety = TypeOK and GridStable and CardsHaveContent and NoLoadingCards and TopNeverBlank and SetupOnlyWhenNeeded
  run stableGridTest = init.then(CalendarSource("event")).then(ChangeDock("keyboard"))
    .then(MailSource("unread")).expect(safety and GridTop == s.top0)
  run dateLineTest = init.then(CalendarSource("none")).then(WorkflowSource("none"))
    .then(MailSource("unconnected")).expect(DateLine and SetupLink and safety)
  run negativeGridDivisionTest = currentInit.then(InsetsArrive).then(CalendarSource("event"))
    .then(ChangeDock("keyboard")).expect(GridTop == 174)
  run currentGridShiftTest = currentInit.then(InsetsArrive).expect(not(GridStable))
  run currentEmptyCardsTest = currentInit.expect(not(CardsHaveContent) and not(NoLoadingCards))
}
