module DockClearanceOwnership {
  pure val Headers = Set(0, 60, 100, 140)
  pure val Docks = Set(0, 1, 2)
  pure val Scales = Set(1, 2)
  type State = {installed: int, generation: int, screen: bool, scale: int,
    conversation: bool, half: bool, dock: int, appBottom: int, chatBottom: int,
    clearance: int, rest: int, header: int}
  var state: State

  pure def measured(s: State): State =
    if (s.installed == 0 or not(s.screen)) s
    else {...s, header: if (s.conversation and not(s.half)) s.chatBottom else s.appBottom,
      clearance: if (s.dock == 0) s.clearance else if (s.dock == 1) 80 else 110,
      rest: if (s.dock == 0) s.rest else if (s.dock == 1) 40 else 60}

  action init = state' = {installed: 0, generation: 0, screen: true, scale: 1,
    conversation: true, half: true, dock: 1, appBottom: 60, chatBottom: 140,
    clearance: -1, rest: -1, header: -1}

  action install = all {
    state.installed != 0 or state.generation < 2,
    if (state.installed != 0) state' = state
    else state' = measured({...state, installed: state.generation + 1, generation: state.generation + 1})
  }

  action dispose(owner: int): bool = all {
    owner.in(1.to(state.generation)),
    if (owner == state.installed) state' = {...state, installed: 0, clearance: -1, rest: -1, header: -1}
    else state' = state
  }

  action screen(value: bool): bool = state' = measured({...state, screen: value})
  action conversation(value: bool): bool = state' = measured({...state, conversation: value})
  action splitChat(value: bool): bool = state' = measured({...state, half: value})

  action setScale(value: int): bool = all {
    value.in(Scales),
    state' = measured({...state, scale: value})
  }
  action changeDock(value: int): bool = all {
    value.in(Docks),
    state' = measured({...state, dock: value})
  }
  action headers(app: int, chat: int): bool = all {
    app.in(Headers), chat.in(Headers),
    state' = measured({...state, appBottom: app, chatBottom: chat})
  }

  action step = any {
    install,
    nondet owner = 1.to(2).oneOf()
    dispose(owner),
    nondet flag = Set(true, false).oneOf()
    any {screen(flag), conversation(flag), splitChat(flag)},
    nondet scale = Scales.oneOf()
    setScale(scale),
    nondet dock = Docks.oneOf()
    changeDock(dock),
    nondet app = Headers.oneOf()
    nondet chat = Headers.oneOf()
    headers(app, chat),
    state' = state
  }

  val exactInstaller = state.installed == 0 or state.installed == state.generation
  val visibleHeader = not(state.screen) or state.installed == 0 or
    state.header == (if (state.conversation and not(state.half)) state.chatBottom else state.appBottom)
  val safeInsets = (state.clearance == -1 and state.rest == -1) or
    (state.rest > 0 and state.rest <= state.clearance)
  val safety = exactInstaller and visibleHeader and safeInsets and
    (state.installed != 0 or (state.clearance == -1 and state.header == -1))

  run chatModeSelectsHeaderWithoutResizingTest = init.then(install).then(splitChat(false))
    .expect(safety and state.header == 140 and state.clearance == 80)
    .then(conversation(false)).expect(safety and state.header == 60)
  run retiredDockKeepsLastFootprintTest = init.then(install).then(changeDock(0)).then(setScale(2))
    .expect(safety and state.clearance == 80 and state.rest == 40)
    .then(changeDock(2)).expect(safety and state.clearance == 110 and state.rest == 60)
  run screenRestorationMeasuresCurrentLayoutTest = init.then(install).then(screen(false))
    .then(splitChat(false)).then(headers(100, 60)).expect(safety and state.header == 60)
    .then(headers(100, 140)).then(screen(true)).expect(safety and state.header == 140)
  run staleCleanupCannotEraseReplacementMeasurementsTest = init.then(install).then(dispose(1))
    .then(changeDock(2)).then(install).then(dispose(1))
    .expect(safety and state.installed == 2 and state.clearance == 110).then(dispose(2))
    .expect(safety and state.clearance == -1 and state.rest == -1 and state.header == -1)
}
