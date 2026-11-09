module ScreenFocusOwnership {
  pure val WaitFrames = 12
  pure val Screens = Set(-1, 0, 1)
  pure val Elements = 0.to(5)
  type State = {installed: int, generation: int, screen: int, active: int, held: int,
    composer: bool, title: bool, region: bool, drawer: bool, selfFocus: bool,
    phase: int, cause: str, resizeOwner: int, remaining: int}
  var state: State

  pure def exposed(s: State, id: int): bool =
    if (id == 1) s.composer
    else if (id == 2) true
    else if (id == 3) s.title
    else if (id == 4) s.region
    else if (id == 5) s.drawer
    else false

  pure def target(s: State): int =
    if (s.selfFocus) 0
    else if (s.drawer) 5
    else if (s.screen <= 0) 2
    else if (s.title) 3
    else if (s.region) 4
    else 0

  pure def stop(s: State): State =
    {...s, phase: 0, cause: "idle", remaining: 0, resizeOwner: 0}

  pure def schedule(s: State, cause: str, owner: int): State =
    if (s.installed == 0 or s.screen == -1 or
        (cause == "resize" and s.cause == "screen")) s
    else {...s, phase: 1, cause: cause, resizeOwner: owner, remaining: WaitFrames}

  action init = state' = {installed: 0, generation: 0, screen: -1, active: 0, held: 0,
    composer: true, title: true, region: true, drawer: false, selfFocus: false,
    phase: 0, cause: "idle", resizeOwner: 0, remaining: 0}

  action install = all {
    state.installed != 0 or state.generation < 2,
    if (state.installed != 0) state' = state
    else state' = {...state, installed: state.generation + 1, generation: state.generation + 1, held: 0}
  }

  action dispose(owner: int): bool = all {
    owner.in(1.to(state.generation)),
    if (owner == state.installed) state' = stop({...state, installed: 0, held: 0})
    else state' = state
  }

  action screen(view: int): bool = all {
    view.in(Screens),
    val updated = {...state, screen: view}
    if (state.screen != view and state.screen != -1 and view != -1)
      state' = schedule(updated, "screen", 0)
    else state' = updated
  }

  action home = state' = schedule(state, "screen", 0)

  action focus(id: int): bool = all {
    id.in(Elements), exposed(state, id),
    state' = {...state, active: id, held: if (state.installed != 0) id else 0}
  }

  action blur = state' = {...state, active: 0}

  action composerVisible(value: bool): bool =
    state' = {...state, composer: value,
      active: if (not(value) and state.active == 1) 0 else state.active}

  action appName(title: bool, region: bool): bool =
    state' = {...state, title: title, region: region,
      active: if ((state.active == 3 and not(title)) or (state.active == 4 and not(region))) 0 else state.active}

  action drawer(open: bool): bool = all {
    state.drawer != open,
    val updated = {...state, drawer: open, active: if (not(open) and state.active == 5) 0 else state.active}
    state' = if (open) schedule(updated, "screen", 0) else updated
  }

  action selfFocused(open: bool): bool = state' = {...state, selfFocus: open}

  action resize =
    if (state.held != 0 and state.active != state.held)
      state' = schedule(state, "resize", state.held)
    else state' = state

  action frame = all {
    state.phase != 0,
    if (state.phase == 1) state' = {...state, phase: 2}
    else if (exposed(state, state.active)) state' = stop(state)
    else {
      val destination = target(state)
      val allowed = state.screen != -1 and
        (state.cause == "screen" or not(exposed(state, state.resizeOwner)))
      if (allowed and destination != 0)
        state' = stop({...state, active: destination, held: destination})
      else if (state.remaining == 1) state' = stop(state)
      else state' = {...state, remaining: state.remaining - 1}
    }
  }

  action step = any {
    install,
    nondet id = 1.to(2).oneOf()
    dispose(id),
    nondet view = Screens.oneOf()
    screen(view),
    home, resize, blur, frame,
    nondet id = Elements.oneOf()
    focus(id),
    nondet flag = Set(true, false).oneOf()
    any {composerVisible(flag), drawer(flag), selfFocused(flag)},
    nondet title = Set(true, false).oneOf()
    nondet region = Set(true, false).oneOf()
    appName(title, region),
    state' = state
  }

  val exactObserver = state.installed == 0 or state.installed == state.generation
  val pendingOwner = if (state.phase == 0)
    state.remaining == 0 and state.resizeOwner == 0 and state.cause == "idle"
    else state.installed != 0 and state.remaining.in(1.to(WaitFrames)) and
      ((state.cause == "screen" and state.resizeOwner == 0) or
       (state.cause == "resize" and state.resizeOwner.in(1.to(5))))
  val safety = exactObserver and pendingOwner and state.phase.in(0.to(2)) and
    state.screen.in(Screens) and state.active.in(Elements) and state.held.in(Elements)

  run firstScreenLeavesFocusUntouchedTest = init.then(install).then(screen(0))
    .expect(safety and state.active == 0 and state.phase == 0)
  run resizeCannotNarrowPendingNavigationTest = init.then(install).then(screen(0))
    .then(focus(1)).then(blur).then(screen(1)).then(resize)
    .expect(safety and state.cause == "screen").then(frame).then(frame)
    .expect(safety and state.active == 3)
  run voluntaryBlurRemainsUnfocusedOnResizeTest = init.then(install).then(screen(0))
    .then(focus(1)).then(blur).then(resize).then(frame).then(frame)
    .expect(safety and state.active == 0 and state.remaining == 11)
  run realFocusAndNativeModalKeepOwnershipTest = init.then(install).then(screen(0))
    .then(focus(1)).then(screen(1)).then(frame).then(frame).expect(safety and state.active == 1)
    .then(blur).then(selfFocused(true)).then(home).then(frame).then(frame)
    .expect(safety and state.active == 0 and state.remaining == 11)
  run lateNameAndDrawerCanReceiveFocusTest = init.then(install).then(screen(0))
    .then(appName(false, false)).then(screen(1)).then(frame).then(frame)
    .then(appName(false, true)).then(frame).expect(safety and state.active == 4)
    .then(blur).then(drawer(true)).then(frame).then(frame).expect(safety and state.active == 5)
  run oldUninstallerCannotRemoveReplacementTest = init.then(install).then(screen(0))
    .then(home).then(dispose(1)).then(install).then(dispose(1)).then(home).then(frame).then(frame)
    .expect(safety and state.installed == 2 and state.active == 2)
}
