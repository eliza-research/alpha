/// The chat dock's pointer gesture: one captured drag or tap, the detent it settles in, and the
/// compatibility click the platform may deliver afterwards. Time is counted in ticks; the
/// suppression window is two ticks long.
module ChatDock {
  type Drag = { active: bool, mode: str, view: str, moved: bool, tap: str }
  type State = {
    // "" is Home; one view rests on the composer bar and one on the pill.
    view: str, chat: str, voice: bool,
    drag: Drag,
    // Whether a sheet height was left by a drag, and ticks since the last suppression stamp and
    // the last real drag (Window or more is expired).
    remembered: bool, swallowAge: int, dragAge: int,
    // A click the platform still owes the last gesture, and the control it will land on.
    ghost: bool, ghostLabel: str,
    // Effects of the current gesture: detent changes and voice starts, late clicks included.
    effects: int, clickThrough: bool, ignored: int,
    // Home's bar was pulled down to the pill.
    dismissed: bool
  }
  var s: State

  pure val Window = 2
  pure val BarView = "barView"
  pure val PillView = "pillView"
  pure val Surfaces = Set("", BarView, PillView)
  pure val Modes = Set("hidden", "input", "sheet", "full")
  // Controls a tap or a late click can land on. The toolbar size button is not a drag handle.
  pure val Handles = Set("none", "focus", "open", "type", "talk", "resize")
  pure val Controls = Handles.union(Set("toolbar"))
  pure val NoDrag: Drag = { active: false, mode: "", view: "", moved: false, tap: "none" }

  pure def rest(view: str): str = if (view == PillView) "hidden" else "input"
  /// Where a released chat goes; the bool is whether the released height is remembered.
  pure def release(mode: str, direction: str, zone: str, flick: bool): (str, bool) =
    if (mode == "sheet" or mode == "full")
      if (flick) (if (direction == "up") "full" else "hidden", false)
      else if (zone == "floor") ("hidden", false)
      else if (zone == "top") ("full", false)
      else ("sheet", true)
    else if (direction == "down") ("hidden", false)
    else if (zone == "top") ("full", false)
    else ("sheet", not(flick) and zone != "floor")
  pure def swallowed(v: State): bool = v.swallowAge < Window
  /// What a control does when activated; "talk" starts voice and leaves the detent.
  pure def activate(v: State, label: str): State =
    if (label == "open") { ...v, chat: "sheet" }
    else if (label == "type") { ...v, chat: "input" }
    else if (label == "talk") { ...v, voice: true }
    else if (label == "resize" or label == "toolbar") { ...v, chat: if (v.chat == "full") "sheet" else "full" }
    else v
  pure def changed(before: State, after: State): int =
    if (before.chat != after.chat or before.voice != after.voice) 1 else 0
  pure def settled(v: State): State =
    { ...v, dismissed: v.dismissed and v.view == "" and v.chat == "hidden" }

  action init = s' = { view: "", chat: "input", voice: false, drag: NoDrag, remembered: false,
    swallowAge: Window, dragAge: Window, ghost: false, ghostLabel: "none", effects: 0,
    clickThrough: false, ignored: 0, dismissed: false }

  /// A fresh press is a deliberate action: it lifts the suppression left by the last gesture.
  action down(label: str): bool = all { not(s.drag.active), not(s.voice), label.in(Handles),
    (label == "focus" or label == "type") implies s.chat == "input" or s.chat == "hidden",
    label == "open" or label == "talk" implies s.chat == "hidden" or s.chat == "input",
    label == "resize" implies s.chat == "sheet",
    s' = { ...s, drag: { active: true, mode: s.chat, view: s.view, moved: false, tap: label },
      swallowAge: Window, ghost: false, ghostLabel: "none", effects: 0 } }
  action move = all { s.drag.active, s' = { ...s, drag: { ...s.drag, moved: true } } }
  /// Release without movement runs the pressed control once and stamps the suppression window.
  action tap = all { s.drag.active, not(s.drag.moved),
    val acted = settled(activate({ ...s, drag: NoDrag }, s.drag.tap))
    s' = if (s.drag.tap == "none") { ...acted, ghost: false }
      else { ...acted, swallowAge: 0, ghost: true, ghostLabel: s.drag.tap, effects: s.effects + changed(s, acted) } }
  /// A moved drag settles in one detent. An open chat collapses to its surface's rest; only the
  /// bar itself is dismissed to the pill.
  action settle(direction: str, zone: str, flick: bool, over: str): bool = all {
    s.drag.active, s.drag.moved, direction.in(Set("up", "down")), zone.in(Set("floor", "middle", "top")),
    over.in(Controls),
    val collapsed = s.drag.mode == "input" or s.drag.mode == "hidden"
    val target = release(s.drag.mode, direction, zone, flick)
    val chat = if (target._1 == "hidden" and not(collapsed)) rest(s.view) else target._1
    val after = { ...s, drag: NoDrag, chat: chat, remembered: s.remembered or target._2,
      dismissed: chat == "hidden" and s.view == "" and (s.dismissed or s.drag.mode == "input") }
    s' = { ...after, swallowAge: 0, dragAge: 0, ghost: over != "none", ghostLabel: over,
      effects: s.effects + changed(s, after) } }
  /// Too little travel, a resize, blur, a hidden page or a shell change under the finger ends
  /// the gesture where it began. A moved drag still suppresses its click.
  action cancel = all { s.drag.active,
    s' = if (s.drag.moved) { ...s, drag: NoDrag, swallowAge: 0, dragAge: 0 } else { ...s, drag: NoDrag } }
  /// The platform's click for the finished gesture, delivered inside the window.
  action lateClick = all { s.ghost, not(s.drag.active), swallowed(s),
    val passes = s.ghostLabel == "toolbar" and s.dragAge >= Window
    val acted = settled(activate(s, s.ghostLabel))
    s' = if (passes) { ...acted, ghost: false, effects: s.effects + changed(s, acted), clickThrough: changed(s, acted) > 0 }
      else { ...s, ghost: false, ignored: if (s.ignored < 3) s.ignored + 1 else 3 } }
  /// A keyboard activation or a deliberate tap on the toolbar size button after the window.
  action sizeButton = all { not(s.drag.active), not(s.ghost), s.chat == "sheet" or s.chat == "full",
    s' = { ...activate(s, "toolbar"), effects: 1 } }
  action closeChat = all { not(s.ghost), s.chat == "sheet" or s.chat == "full",
    s' = settled({ ...s, drag: NoDrag, chat: rest(s.view), effects: 1 }) }
  /// Navigation and voice change the shell under a held finger: the drag is retired.
  action navigate(view: str): bool = all { view.in(Surfaces), view != s.view,
    s' = { ...s, view: view, chat: rest(view), dismissed: false,
      drag: NoDrag, swallowAge: if (s.drag.moved) 0 else s.swallowAge, dragAge: if (s.drag.moved) 0 else s.dragAge } }
  action voiceEnds = all { s.voice, s' = { ...s, voice: false } }
  action tick = s' = { ...s, swallowAge: if (s.swallowAge < Window) s.swallowAge + 1 else Window,
    dragAge: if (s.dragAge < Window) s.dragAge + 1 else Window,
    ghost: s.ghost and s.swallowAge + 1 < Window }
  action step = {
    nondet label = Handles.oneOf()
    nondet over = Controls.oneOf()
    nondet direction = Set("up", "down").oneOf()
    nondet zone = Set("floor", "middle", "top").oneOf()
    nondet flick = Set(true, false).oneOf()
    nondet view = Surfaces.oneOf()
    any { down(label), move, tap, settle(direction, zone, flick, over), cancel, lateClick, sizeButton,
      closeChat, navigate(view), voiceEnds, tick, s' = s }
  }

  val OneEffectPerGesture = s.effects <= 1
  val NoClickThrough = not(s.clickThrough)
  /// A held drag was started in the detent, surface and voice state the shell still shows.
  val DragMatchesShell = s.drag.active implies s.drag.mode == s.chat and s.drag.view == s.view and not(s.voice)
  /// Home rests on its bar; it shows the pill only after the bar was pulled down.
  val HomeRest = s.view == "" and s.chat == "hidden" implies s.dismissed
  /// A pending click is always inside the suppression window of the gesture that owes it.
  val GhostInsideWindow = s.ghost implies swallowed(s) or s.drag.active
  val ValidDetent = s.chat.in(Modes) and (s.dismissed implies s.view == "" and s.chat == "hidden")
  val safety = OneEffectPerGesture and NoClickThrough and DragMatchesShell and HomeRest and
    GhostInsideWindow and ValidDetent

  val HomePillWitness = s.view == "" and s.chat == "hidden"
  val SwallowedClickWitness = s.ignored > 0
  val RememberedHeightWitness = s.remembered and s.chat == "sheet"
  val FlickDismissWitness = s.view == PillView and s.chat == "hidden" and s.swallowAge == 0 and s.effects == 1

  // A drag that opens the sheet ends over the Talk button: its click must not also start voice.
  run dragEndsOverButtonTest = init.then(down("none")).then(move).then(settle("up", "middle", false, "talk"))
    .expect(s.chat == "sheet" and s.remembered and s.ghost)
    .then(lateClick).expect(s.chat == "sheet" and not(s.voice) and s.ignored == 1 and safety)
  run tapOpensOnceTest = init.then(down("open")).then(tap).expect(s.chat == "sheet" and s.effects == 1)
    .then(lateClick).expect(s.chat == "sheet" and s.effects == 1 and safety)
  run homeBarPullsDownToPillTest = init.then(down("none")).then(move).then(settle("down", "floor", false, "none"))
    .expect(s.view == "" and s.chat == "hidden" and s.dismissed and safety)
  run openChatCollapsesToRestTest = init.then(down("open")).then(tap).then(tick).then(tick)
    .then(down("none")).then(move).then(settle("down", "floor", true, "none"))
    .expect(s.chat == "input" and safety)
  run toolbarAfterOpenTapTest = init.then(down("open")).then(tap).then(lateClick).then(sizeButton)
    .expect(s.chat == "full" and safety)
  run dragOverToolbarIsSuppressedTest = init.then(down("open")).then(tap).then(tick).then(tick)
    .then(down("none")).then(move).then(settle("up", "middle", false, "toolbar")).then(lateClick)
    .expect(s.chat == "sheet" and s.ignored == 1 and safety)
  run navigationRetiresDragTest = init.then(down("none")).then(move).then(navigate(PillView))
    .expect(not(s.drag.active) and s.chat == "hidden" and s.swallowAge == 0 and safety)
    .then(settle("up", "top", false, "none").fail())
  run expiredClickIsDroppedTest = init.then(down("open")).then(tap).then(tick).then(tick)
    .expect(not(s.ghost) and safety).then(lateClick.fail())
  run freshPressLiftsSuppressionTest = init.then(down("none")).then(move).then(settle("up", "middle", false, "none"))
    .then(down("resize")).then(tap).expect(s.chat == "full" and s.effects == 1 and safety)
}
