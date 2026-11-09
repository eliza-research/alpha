/// Below-host input admission and gesture ownership; coordinates are native-library evidence.
module BrowserUnderlay {
  type State = { selected: bool, shown: bool, rects: bool, paused: bool, disposed: bool,
    target: str, beganOnHost: bool, pageStartedWithoutRects: bool }
  var s: State
  action init = s' = { selected: false, shown: false, rects: false, paused: false, disposed: false,
    target: "none", beganOnHost: false, pageStartedWithoutRects: false }
  action present(validRects: bool): bool = all {
    not(s.disposed),
    s' = { ...s, selected: validRects, shown: validRects and not(s.paused), rects: validRects and not(s.paused) }
  }
  action down(onHost: bool, insidePage: bool): bool = all {
    s.target == "none",
    {
      val page = s.shown and s.rects and not(s.paused) and not(s.disposed) and
        insidePage and not(onHost)
      s' = { ...s, target: if (page) "page" else "host", beganOnHost: not(page),
        pageStartedWithoutRects: page and not(s.rects) }
    }
  }
  /// Split fingers and later motion retain the owner of DOWN.
  action secondFinger = all { s.target != "none", s' = s }
  action move = all {
    s.target != "none",
    s' = if (s.target == "page" and (not(s.shown) or s.paused or s.disposed))
      { ...s, target: "cancelled" } else s
  }
  /// A withdrawn page consumes the rest of its gesture; it never falls through to host controls.
  action hide = s' = { ...s, selected: false, shown: false, rects: false,
    target: if (s.target == "page") "cancelled" else s.target }
  action pause = s' = { ...s, shown: false, paused: true, rects: false,
    target: if (s.target == "page") "cancelled" else s.target }
  action resume = all { not(s.disposed), s' = { ...s, paused: false, shown: s.selected } }
  action dispose = s' = { ...s, selected: false, disposed: true, shown: false, rects: false,
    target: if (s.target == "page") "cancelled" else s.target }
  action up = s' = { ...s, target: "none", beganOnHost: false }
  action step = any { present(true), present(false), down(true,true), down(false,true),
    down(false,false), secondFinger, move, hide, pause, resume, dispose, up }
  val TypeOK = Set("none","page","host","cancelled").contains(s.target)
  val NoHostGestureBecomesPage = not(s.beganOnHost and s.target == "page")
  val NoPageStartWithoutHostRects = not(s.pageStartedWithoutRects)
  val DisposedPageCannotBeShown = not(s.disposed and s.shown)
  val safety = TypeOK and NoHostGestureBecomesPage and NoPageStartWithoutHostRects and
    DisposedPageCannotBeShown
  run missingRectsTest = init.then(down(false,true)).expect(safety and s.target == "host")
  run hostFingerStaysHostTest = init.then(present(true)).then(down(true,true))
    .then(secondFinger).then(move).expect(safety and s.target == "host")
  run pageGestureStaysPageTest = init.then(present(true)).then(down(false,true))
    .then(secondFinger).then(move).expect(safety and s.target == "page")
  run hiddenGestureIsConsumedTest = init.then(present(true)).then(down(false,true))
    .then(hide).then(move).expect(safety and s.target == "cancelled")
  run resumeRequiresNewGeometryTest = init.then(present(true)).then(pause).then(resume)
    .then(down(false,true)).expect(safety and s.target == "host")
}
