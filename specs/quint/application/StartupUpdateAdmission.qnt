module StartupUpdateAdmission {
  pure val Activations = Set(1, 2)
  pure val Bridges = Set(1, 2)
  pure val Phases = Set("preparing", "paused")
  pure val Outcomes = Set("canceled", "failed", "installed", "unknown")
  type State = {pending: int, bridge: int, acknowledged: int, ready: Set[int],
    panel: bool, canContinue: bool, continuing: bool, continues: List[int], released: bool}
  var state: State

  action init = state' = {pending: 0, bridge: 0, acknowledged: 0, ready: Set(),
    panel: false, canContinue: false, continuing: false, continues: [], released: false}

  action readPending(id: int, bridge: int, phase: str, canContinue: bool): bool = all {
    not(state.released), id.in(Activations), bridge.in(Bridges), phase.in(Phases),
    if (state.pending != 0 and state.bridge != bridge)
      state' = {...state, panel: true, canContinue: false}
    else {
      val acknowledge = phase == "preparing" and id != state.acknowledged
      all {
        not(acknowledge) or not(id.in(state.ready)),
        state' = {...state, pending: id, bridge: bridge, panel: true,
          canContinue: phase == "paused" and canContinue,
          acknowledged: if (acknowledge) id else state.acknowledged,
          ready: if (acknowledge) state.ready.union(Set(id)) else state.ready}
      }
    }
  }

  action readTerminal(id: int, bridge: int, result: str, idle: bool): bool = all {
    not(state.released), id.in(0.to(2)), bridge.in(Bridges), result.in(Outcomes),
    val releases = state.pending == 0 or
      (state.bridge == bridge and (idle or (id == state.pending and result != "unknown")))
    state' = {...state, panel: not(releases), canContinue: false, released: releases}
  }

  action readUncertain = all {
    not(state.released),
    state' = {...state, panel: true, canContinue: false}
  }

  action clickContinue =
    if (state.canContinue and not(state.continuing))
      state' = {...state, continuing: true, continues: state.continues.append(state.pending)}
    else state' = state

  action continued = all {
    state.continuing,
    state' = {...state, continuing: false}
  }

  action step = any {
    nondet id = Activations.oneOf()
    nondet bridge = Bridges.oneOf()
    nondet phase = Phases.oneOf()
    nondet canContinue = Set(true, false).oneOf()
    readPending(id, bridge, phase, canContinue),
    nondet id = 0.to(2).oneOf()
    nondet bridge = Bridges.oneOf()
    nondet result = Outcomes.oneOf()
    nondet idle = Set(true, false).oneOf()
    readTerminal(id, bridge, result, idle),
    readUncertain, clickContinue, continued, state' = state
  }

  val exactBridge = if (state.pending == 0) state.bridge == 0 else state.bridge.in(Bridges)
  val mountCustody = not(state.released) or (not(state.panel) and not(state.canContinue))
  val continuation = not(state.canContinue) or (state.panel and state.pending.in(Activations))
  val safety = exactBridge and mountCustody and continuation and state.ready.subseteq(Activations)

  run idleCanReleaseWithoutPendingStartupTest = init.then(readTerminal(0, 1, "unknown", false))
    .expect(safety and state.released and not(state.panel))
  run uncertainReadAndWrongBridgeHoldStartupTest = init.then(readUncertain)
    .then(readPending(1, 1, "preparing", false)).then(readPending(1, 1, "preparing", false))
    .then(readTerminal(1, 2, "canceled", true)).expect(safety and state.panel and state.ready == Set(1))
    .then(readTerminal(1, 1, "canceled", false)).expect(safety and state.released)
  run pausedContinueIsSingleFlightTest = init.then(readPending(1, 1, "paused", true))
    .then(clickContinue).then(clickContinue).then(continued)
    .expect(safety and state.continues == [1] and not(state.released))
    .then(readTerminal(2, 1, "unknown", true)).expect(safety and state.released)
  run sameBridgeReplacesThePendingActivationTest = init.then(readPending(1, 1, "preparing", false))
    .then(readPending(2, 1, "preparing", false)).then(readTerminal(1, 1, "installed", false))
    .expect(safety and state.pending == 2 and not(state.released) and state.ready == Set(1, 2))
    .then(readTerminal(2, 1, "failed", false)).expect(safety and state.released)
}
