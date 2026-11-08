module EmbeddingStoreIdentity {
  type Identity = {provider: str, model: str, width: int}
  type Pin = {provider: str, width: int}
  type State = {stored: Identity, pin: Pin, column: int, disabled: bool, warned: bool,
    writes: int, clearFailures: int, probe: int, calls: int, joined: bool,
    acknowledgement: str, fault: str, outcome: str}

  pure val none: Identity = {provider: "none", model: "none", width: 0}
  pure val candidates = Map(
    (1, {provider: "a", model: "alpha", width: 2}),
    (2, {provider: "b", model: "beta", width: 2}),
    (3, {provider: "b", model: "alpha", width: 2}),
    (4, {provider: "a", model: "none", width: 2}),
    (5, {provider: "b", model: "none", width: 2}),
    (6, {provider: "b", model: "beta", width: 3}),
    (7, {provider: "b", model: "beta", width: 2})
  )
  pure val acknowledgements = Set("none", "a", "b", "alpha", "beta")
  pure val faults = Set("none", "provider", "read", "write", "clear")
  pure val outcomes = Set("none", "success", "probe-failed", "model-mismatch", "read-failed", "write-failed")
  var state: State
  action init = state' = {stored: none, pin: {provider: "none", width: 0}, column: 2,
    disabled: false, warned: false, writes: 0, clearFailures: 0, probe: 0, calls: 0,
    joined: false, acknowledgement: "none", fault: "none", outcome: "none"}

  action start(candidate: int, acknowledgement: str, fault: str): bool = all {
    state.probe == 0, state.calls < 5, candidate.in(candidates.keys()),
    acknowledgement.in(acknowledgements), fault.in(faults),
    state' = {...state, probe: candidate, calls: state.calls + 1, joined: false, acknowledgement: acknowledgement, fault: fault}
  }

  action join = all {
    state.probe != 0, not(state.joined),
    state' = {...state, joined: true}
  }

  action finish = all {
    state.probe != 0,
    val candidate = candidates.get(state.probe)
    val sameModel = if (state.stored.model != "none" and candidate.model != "none")
      state.stored.model == candidate.model else state.stored.provider == candidate.provider
    val acceptLabel = if (candidate.model != "none") candidate.model else candidate.provider
    val accepted = state.stored == none or state.stored.width != candidate.width or sameModel
      or state.acknowledgement == acceptLabel
    val update = state.stored != candidate
    val result = if (state.fault == "provider") "probe-failed"
      else if (state.fault == "read") "read-failed"
      else if (not(accepted)) "model-mismatch"
      else if (update and state.fault == "write") "write-failed"
      else "success"
    val ok = result == "success"
    val disable = result.in(Set("probe-failed", "model-mismatch"))
    state' = {...state,
      probe: 0, joined: false, outcome: result,
      column: if (result == "probe-failed") state.column else candidate.width,
      stored: if (ok) candidate else state.stored,
      pin: if (ok) {provider: candidate.provider, width: candidate.width} else state.pin,
      disabled: if (ok) false else disable or state.disabled,
      warned: if (ok or disable) false else state.warned,
      writes: state.writes + (if (ok and update) 1 else 0),
      clearFailures: state.clearFailures + (if (ok and state.fault == "clear") 1 else 0)}
  }

  action skip = all {state.disabled, state' = {...state, warned: true}}
  action step = any {
    nondet candidate = candidates.keys().oneOf()
    nondet acknowledgement = acknowledgements.oneOf()
    nondet fault = faults.oneOf()
    start(candidate, acknowledgement, fault),
    join, finish, skip, state' = state
  }

  val persistedPin = state.pin.provider == state.stored.provider and state.pin.width == state.stored.width
  val disabledWarning = state.warned implies state.disabled
  val noSuccessWithWrongColumn = state.outcome == "success" implies state.column == state.pin.width
  val safety = persistedPin and disabledWarning and noSuccessWithWrongColumn and state.column.in(Set(2, 3))
    and state.stored.in(candidates.keys().map(id => candidates.get(id)).union(Set(none)))
    and state.probe.in(0.to(7)) and state.calls.in(0.to(5))
    and state.writes.in(0.to(state.calls)) and state.clearFailures.in(0.to(state.calls))
    and state.outcome.in(outcomes) and (state.joined implies state.probe != 0)

  run sameWidthSwapRequiresAcknowledgementTest = init.then(start(1, "none", "none")).then(finish)
    .then(start(2, "none", "none")).then(finish).expect(safety and state.disabled and state.stored.model == "alpha")
    .then(skip).then(skip).then(start(2, "beta", "none")).then(finish)
    .expect(safety and not(state.disabled) and not(state.warned) and state.stored.model == "beta" and state.writes == 2)

  run providerSwapPreservesKnownModelTest = init.then(start(1, "none", "none")).then(finish)
    .then(start(3, "none", "none")).then(finish).expect(safety and state.pin.provider == "b" and state.writes == 2)

  run cacheReadFailureCanLeaveResizedColumnTest = init.then(start(1, "none", "none")).then(finish)
    .then(start(6, "none", "read")).then(finish)
    .expect(safety and state.column == 3 and state.pin.width == 2 and not(state.disabled))

  run joinedProbeAndClearFailureTest = init.then(start(6, "none", "clear")).then(join).then(finish)
    .expect(safety and state.calls == 1 and state.clearFailures == 1 and state.pin.width == 3)
}
