module MountedUpdateAdmission {
  pure val Activations = Set(1, 2)
  pure val Bridges = Set(1, 2)
  pure val Phases = Set("preparing", "paused")
  pure val Outcomes = Set("canceled", "failed", "installed", "unknown")
  type State = {active: int, bridge: int, phase: str, panel: bool, canContinue: bool,
    acknowledged: int, pending: Set[int], positive: Set[int], negative: Set[int],
    reconnect: int, localRefusal: bool, restarts: List[int], notices: int,
    continuing: bool, continues: List[int]}
  var state: State

  action init = state' = {active: 0, bridge: 0, phase: "idle", panel: false, canContinue: false,
    acknowledged: 0, pending: Set(), positive: Set(), negative: Set(), reconnect: 0,
    localRefusal: false, restarts: [], notices: 0, continuing: false, continues: []}

  action notify(id: int, bridge: int, phase: str, show: bool): bool = all {
    id.in(Activations), bridge.in(Bridges), phase.in(Phases),
    if (state.active == 0)
      state' = {...state, active: id, bridge: bridge, phase: phase, panel: show}
    else state' = state
  }

  action readPending(id: int, bridge: int, phase: str, canContinue: bool, show: bool): bool = all {
    id.in(Activations), bridge.in(Bridges), phase.in(Phases),
    if (state.active != 0 and state.bridge != bridge) state' = state
    else {
      val opened = state.panel or show
      val updated = {...state, active: id, bridge: bridge, phase: phase, panel: opened,
        canContinue: opened and phase == "paused" and canContinue}
      if (phase != "preparing" or id == state.acknowledged) state' = updated
      else all {
        not(id.in(state.pending)) and not(id.in(state.positive)) and not(id.in(state.negative)),
        state' = {...updated, acknowledged: id, reconnect: 0, localRefusal: not(opened),
          pending: if (opened) state.pending.union(Set(id)) else state.pending,
          negative: if (opened) state.negative else state.negative.union(Set(id))}
      }
    }
  }

  action prepared(id: int, ready: bool): bool = all {
    id.in(state.pending),
    val remaining = state.pending.exclude(Set(id))
    if (state.active != id or state.phase != "preparing") state' = {...state, pending: remaining}
    else state' = {...state, pending: remaining, reconnect: if (ready) id else 0,
      localRefusal: not(ready),
      positive: if (ready) state.positive.union(Set(id)) else state.positive,
      negative: if (ready) state.negative else state.negative.union(Set(id))}
  }

  action readTerminal(id: int, bridge: int, result: str, idle: bool, resume: bool): bool = all {
    id.in(0.to(2)), bridge.in(Bridges), result.in(Outcomes),
    val terminal = id == state.active and result != "unknown"
    val matching = state.acknowledged == state.active
    if (state.active != 0 and bridge == state.bridge and (terminal or idle))
      state' = {...state, active: 0, bridge: 0, phase: "idle", panel: false,
        canContinue: false, reconnect: 0, localRefusal: false,
        restarts: if (terminal and matching and result == "canceled" and resume and state.reconnect == id)
          state.restarts.append(id) else state.restarts,
        notices: state.notices + (if (terminal and matching and result == "failed" and state.localRefusal) 1 else 0)}
    else state' = state
  }

  action readUncertain = state' = state

  action clickContinue =
    if (state.canContinue and not(state.continuing))
      state' = {...state, continuing: true, continues: state.continues.append(state.active)}
    else state' = state

  action continued = all {
    state.continuing,
    state' = {...state, continuing: false}
  }

  action step = any {
    nondet id = Activations.oneOf()
    nondet bridge = Bridges.oneOf()
    nondet phase = Phases.oneOf()
    nondet show = Set(true, false).oneOf()
    nondet canContinue = Set(true, false).oneOf()
    any {notify(id, bridge, phase, show), readPending(id, bridge, phase, canContinue, show)},
    nondet id = Activations.oneOf()
    nondet ready = Set(true, false).oneOf()
    prepared(id, ready),
    nondet id = 0.to(2).oneOf()
    nondet bridge = Bridges.oneOf()
    nondet result = Outcomes.oneOf()
    nondet idle = Set(true, false).oneOf()
    nondet resume = Set(true, false).oneOf()
    readTerminal(id, bridge, result, idle, resume),
    readUncertain, clickContinue, continued
  }

  val navigationBlocked = state.active != 0
  val owner = if (navigationBlocked) state.bridge.in(Bridges) and state.phase.in(Phases)
    else state.bridge == 0 and state.phase == "idle" and not(state.panel) and state.reconnect == 0
  val continuation = not(state.canContinue) or (navigationBlocked and state.panel and state.phase == "paused")
  val exactAcknowledgement = state.positive.intersect(state.negative) == Set()
    and state.pending.intersect(state.positive.union(state.negative)) == Set()
  val safety = owner and continuation and exactAcknowledgement and state.notices >= 0

  run staleReadAndPreparationCannotRetireSuccessorTest = init.then(notify(1, 1, "preparing", true))
    .then(readPending(1, 1, "preparing", false, true))
    .then(readPending(2, 1, "preparing", false, true)).then(prepared(1, true))
    .then(readTerminal(2, 2, "canceled", true, true))
    .expect(safety and state.active == 2 and state.positive == Set())
  run onlyExactCancelCanReconnectTest = init.then(readPending(1, 1, "preparing", false, true))
    .then(prepared(1, true)).then(readTerminal(2, 1, "canceled", false, true))
    .expect(safety and navigationBlocked and state.restarts.length() == 0)
    .then(readTerminal(1, 1, "canceled", false, true))
    .expect(safety and not(navigationBlocked) and state.restarts == [1])
  run pauseCoalescesContinueTest = init.then(readPending(1, 1, "paused", true, true))
    .then(clickContinue).then(clickContinue).then(continued)
    .expect(safety and state.continues == [1] and navigationBlocked)
    .then(readTerminal(2, 1, "unknown", true, true))
    .expect(safety and not(navigationBlocked) and state.restarts.length() == 0)
  run refusalExplainedOnlyAtExactFailureTest = init.then(readPending(1, 1, "preparing", false, false))
    .expect(safety and state.negative == Set(1) and navigationBlocked)
    .then(readUncertain).then(readTerminal(1, 1, "failed", false, false))
    .expect(safety and state.notices == 1 and not(navigationBlocked))
}
