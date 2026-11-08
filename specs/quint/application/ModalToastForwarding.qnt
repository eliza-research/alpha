module ModalToastForwarding {
  pure val Dialogs = Set(1, 2)
  pure val Messages = Set(1, 2)
  type State = {installed: int, generation: int, dialogs: List[int],
    sourceMessage: int, sourceUndo: bool, regions: Set[int],
    target: int, visible: int, undo: bool, clicks: int}
  var state: State

  pure def rendered(s: State): State = {
    val mounted = s.installed != 0
    val regions = if (mounted) s.dialogs.indices().map(i => s.dialogs.nth(i)) else Set()
    val target = if (mounted and s.sourceMessage != 0 and s.dialogs.length() > 0) s.dialogs.nth(s.dialogs.length() - 1) else 0
    {...s, regions: regions, target: target,
      visible: if (target != 0) s.sourceMessage else 0,
      undo: target != 0 and s.sourceMessage != 0 and s.sourceUndo}
  }

  action init = state' = {installed: 0, generation: 0, dialogs: [],
    sourceMessage: 0, sourceUndo: false, regions: Set(), target: 0,
    visible: 0, undo: false, clicks: 0}

  action install = all {
    state.installed != 0 or state.generation < 2,
    if (state.installed != 0) state' = state
    else state' = rendered({...state, installed: state.generation + 1, generation: state.generation + 1})
  }

  action dispose(owner: int): bool = all {
    owner.in(1.to(state.generation)),
    if (owner == state.installed) state' = rendered({...state, installed: 0})
    else state' = state
  }

  action open(id: int): bool = all {
    id.in(Dialogs), not(state.dialogs.indices().exists(i => state.dialogs.nth(i) == id)),
    state' = rendered({...state, dialogs: state.dialogs.append(id)})
  }

  action close(id: int): bool = all {
    state.dialogs.indices().exists(i => state.dialogs.nth(i) == id),
    val remaining = state.dialogs.select(dialog => dialog != id)
    state' = rendered({...state, dialogs: remaining})
  }

  action show(message: int, undo: bool): bool = all {
    message.in(Messages),
    state' = rendered({...state, sourceMessage: message, sourceUndo: undo})
  }

  action clearToast = state' = rendered({...state, sourceMessage: 0, sourceUndo: false})

  action forwardUndo = all {
    state.undo,
    state' = {...state, clicks: state.clicks + 1}
  }

  action step = any {
    install,
    nondet id = 1.to(2).oneOf()
    any {open(id), close(id), dispose(id)},
    nondet message = Messages.oneOf()
    nondet undo = Set(true, false).oneOf()
    show(message, undo),
    clearToast,
    forwardUndo,
    state' = state
  }

  val liveRegionOwner = rendered(state) == state
  val exactInstallation = state.installed == 0 or state.installed == state.generation
  val safety = liveRegionOwner and exactInstallation and state.generation.in(0.to(2))
    and state.regions.subseteq(Dialogs) and state.dialogs.length() <= 2 and state.clicks >= 0

  run newestDialogOwnsToastTest = init.then(install).then(show(1, true)).then(open(2)).then(open(1))
    .expect(safety and state.target == 1 and state.visible == 1 and state.undo)
    .then(close(1)).expect(safety and state.target == 2)
  run reopenedOlderDialogMovesAboveNewerTest = init.then(install).then(open(1)).then(open(2))
    .then(close(1)).then(open(1)).then(show(1, false))
    .expect(safety and state.target == 1 and state.visible == 1)
  run staleUninstallerCannotClearReplacementTest = init.then(install).then(open(1)).then(show(1, false))
    .then(dispose(1)).then(install).then(dispose(1))
    .expect(safety and state.installed == 2 and state.visible == 1)
    .then(dispose(2)).expect(safety and state.regions == Set())
  run oneVisibleUndoForwardsToPageTest = init.then(install).then(open(1)).then(show(1, true))
    .then(forwardUndo).then(clearToast).expect(safety and not(state.undo) and state.clicks == 1)
}
