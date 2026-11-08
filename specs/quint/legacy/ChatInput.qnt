// Faithful translation of docs/ui-refresh-2026-11/tla/ChatInput.tla.
// Design is immutable state so the same actions check both historical designs.
module ChatInput {
  type State = { Design: str, view: str, mode: str, focus: bool, draft: str,
    leak: bool, stray: bool, skipped: bool, lost: bool }
  var s: State
  val vars = s
  pure val Views = Set("home", "browser", "app")
  pure val Modes = Set("hidden", "input", "sheet", "full")
  pure val Origins = Set("dock", "content", "bottomEdge")
  pure def Rest(v) = if (Set("home", "browser").contains(v)) "input" else "hidden"
  val Ghosts = (s.leak, s.stray, s.skipped, s.lost)
  val Raised = s.mode == "sheet" or (s.mode == "input" and (Rest(s.view) == "hidden" or s.focus))
  val Guarded = if (s.Design == "current") s.mode == "sheet" else Raised
  val TypeOK = Views.contains(s.view) and Modes.contains(s.mode)
    and Set("empty", "text").contains(s.draft) and Set("current", "proposed").contains(s.Design)
  pure def initialState(design) = { Design: design, view: "home", mode: Rest("home"),
    focus: false, draft: "empty", leak: false, stray: false, skipped: false, lost: false }
  action Init(design) = s' = initialState(design)
  action checkerInit = s' = initialState("proposed")
  action checkerCurrentInit = s' = initialState("current")
  action init = Init("proposed")
  action currentInit = Init("current")
  action TapAlpha = all { Set("hidden", "input").contains(s.mode),
    s' = { ...s, mode: "sheet", focus: false } }
  action TapType = all { s.mode == "hidden", s' = { ...s, mode: "input", focus: true } }
  action FocusComposer = all { Set("input", "sheet", "full").contains(s.mode), not(s.focus),
    s' = { ...s, focus: true } }
  action TypeText = all { s.focus, s.draft == "empty", s' = { ...s, draft: "text" } }
  action Send = all { s.draft == "text", Set("input", "sheet", "full").contains(s.mode),
    s' = { ...s, draft: "empty", mode: if (s.mode == "full") "full" else "sheet" } }
  action ImeHide = all { s.focus, s' = { ...s, focus: false } }
  action Activate = s' = { ...s, leak: s.leak or Raised, focus: false,
    view: if (s.view == "home") "app" else s.view,
    mode: if (s.view == "home") Rest("app") else s.mode }
  action TapOutside = all { s.mode != "full",
    if (Guarded) s' = { ...s, mode: Rest(s.view), focus: false } else Activate }
  action SwipeUp(origin) = all { Set("hidden", "input").contains(s.mode),
    if (origin == "bottomEdge") s' = { ...s, view: "home", mode: Rest("home"), focus: false }
    else if (origin == "dock") s' = { ...s, mode: "sheet", focus: false }
    else if (s.Design == "current" and s.view == "home")
      s' = { ...s, mode: "sheet", focus: false, stray: true }
    else s' = s }
  action GrabUp = all { s.mode == "sheet", s' = { ...s, mode: "full" } }
  action GrabDown = all { Set("sheet", "full").contains(s.mode),
    s' = { ...s, mode: if (s.mode == "full") "sheet" else Rest(s.view), focus: false } }
  action LeaveView = all { s.view != "home", s' = { ...s, view: "home", mode: Rest("home"),
    focus: false, skipped: s.skipped or Raised } }
  action Back = if (s.focus) s' = { ...s, focus: false }
    else if (s.mode == "full") s' = { ...s, mode: "sheet" }
    else if (s.mode == "sheet") s' = { ...s, mode: Rest(s.view) }
    else if (s.Design == "proposed" and s.mode == "input" and Rest(s.view) == "hidden")
      s' = { ...s, mode: "hidden" }
    else if (s.view != "home") LeaveView else s' = s
  action OpenView(v) = all { v != s.view, s' = { ...s, view: v, mode: Rest(v), focus: false } }
  action Next = {
    nondet o = Origins.oneOf()
    nondet v = Views.oneOf()
    any { TapAlpha, TapType, FocusComposer, TypeText, Send, ImeHide,
      TapOutside, GrabUp, GrabDown, Back, SwipeUp(o), OpenView(v) }
  }
  action step = any { Next, s' = s }
  val Initial = TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design)
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(s))
  val NoLeak = not(s.leak)
  val NoStrayOpen = not(s.stray)
  val BackInOrder = not(s.skipped)
  val DraftKept = not(s.lost)
  val FocusNeedsComposer = s.focus implies Set("input", "sheet", "full").contains(s.mode)
  val OneTouchDown = Raised implies (Guarded or s.mode == "full")
  val safety = TypeOK and NoLeak and NoStrayOpen and BackInOrder and DraftKept and FocusNeedsComposer and OneTouchDown
  run outsideGuardTest = init.then(FocusComposer).then(TypeText).then(TapOutside)
    .expect(s.view == "home" and s.draft == "text" and not(s.focus) and safety)
  run backOrderTest = init.then(OpenView("app")).then(TapType).then(Back)
    .expect(s.view == "app" and s.mode == "input")
    .then(Back).expect(s.view == "app" and s.mode == "hidden" and safety)
    .then(Back).expect(s.view == "home" and safety)
  run currentLeakTest = currentInit.then(FocusComposer).then(TapOutside).expect(not(NoLeak))
  run currentStrayTest = currentInit.then(SwipeUp("content")).expect(not(NoStrayOpen))
  run currentBackTest = currentInit.then(OpenView("app")).then(TapType).then(ImeHide)
    .then(Back).expect(not(BackInOrder))
  run currentOneTouchTest = currentInit.then(OpenView("app")).then(TapType)
    .expect(not(OneTouchDown))
}
