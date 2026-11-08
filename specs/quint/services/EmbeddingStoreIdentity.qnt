module EmbeddingStoreIdentity {
  type Identity = {provider: str, model: str, width: int}
  type Pin = {provider: str, width: int}
  type State = {stored: Identity, pin: Pin, column: int, disabled: bool, warned: bool, fenced: bool, selected: bool, committed: bool,
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
  pure val faults = Set("none", "provider", "read", "resize", "write", "write-false", "write-committed", "clear")
  pure val outcomes = Set("none", "success", "probe-failed", "model-mismatch", "read-failed", "resize-failed", "write-failed")
  var state: State
  action init = state' = {stored: none, pin: {provider: "none", width: 0}, column: 2,
    disabled: false, warned: false, fenced: false, selected: false, committed: false, writes: 0, clearFailures: 0, probe: 0, calls: 0,
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

  val candidate = candidates.get(state.probe)
  val sameModel = if (state.stored.model != "none" and candidate.model != "none")
    state.stored.model == candidate.model else state.stored.provider == candidate.provider
  val acceptLabel = if (candidate.model != "none") candidate.model else candidate.provider
  val accepted = state.stored == none or state.stored.width != candidate.width or sameModel
    or state.acknowledgement == acceptLabel
  val needsWrite = state.stored != candidate
  val maySelect = not(state.fault.in(Set("provider", "read"))) and accepted

  action selectWidth = all {
    state.probe != 0, not(state.selected), maySelect,
    val newFence = not(state.fenced) and (needsWrite or state.pin.width != candidate.width)
    state' = {...state, selected: true, column: candidate.width,
      fenced: state.fenced or newFence, disabled: state.disabled or newFence,
      warned: state.warned and not(newFence)}
  }

  val mayCommit = state.selected and needsWrite and not(state.fault.in(Set("resize", "write", "write-false")))

  action commitIdentity = all {
    state.probe != 0, mayCommit,
    state' = {...state, stored: candidate, writes: state.writes + 1, committed: true}
  }

  action finish = all {
    state.probe != 0, state.selected == maySelect, not(mayCommit),
    val result = if (state.fault == "provider") "probe-failed"
      else if (state.fault == "read") "read-failed"
      else if (not(accepted)) "model-mismatch"
      else if (state.fault == "resize") "resize-failed"
      else if (needsWrite and state.fault.in(Set("write", "write-false"))) "write-failed"
      else if (state.committed and state.fault == "write-committed") "write-failed"
      else "success"
    val ok = result == "success"
    val disable = result.in(Set("probe-failed", "model-mismatch"))
    state' = {...state,
      probe: 0, joined: false, selected: false, committed: false, outcome: result,
      pin: if (ok) {provider: candidate.provider, width: candidate.width} else state.pin,
      fenced: state.fenced and not(ok),
      disabled: if (ok) false else disable or state.disabled,
      warned: if (ok or disable) false else state.warned,
      clearFailures: state.clearFailures + (if (ok and state.fault == "clear") 1 else 0)}
  }

  action skip = all {state.disabled, state' = {...state, warned: true}}
  action step = any {
    nondet candidate = candidates.keys().oneOf()
    nondet acknowledgement = acknowledgements.oneOf()
    nondet fault = faults.oneOf()
    start(candidate, acknowledgement, fault),
    join, selectWidth, commitIdentity, finish, skip, state' = state
  }

  val persistedPin = not(state.fenced) implies
    (state.pin.provider == state.stored.provider and state.pin.width == state.stored.width)
  val enabledPinMatchesColumn = (not(state.disabled) and state.pin.width != 0) implies state.column == state.pin.width
  val unconfirmedTransitionDisablesGeneration = state.fenced implies state.disabled
  val disabledWarning = state.warned implies state.disabled
  val safety = persistedPin and disabledWarning and enabledPinMatchesColumn
    and unconfirmedTransitionDisablesGeneration and state.column.in(Set(2, 3))
    and state.stored.in(candidates.keys().map(id => candidates.get(id)).union(Set(none)))
    and state.probe.in(0.to(7)) and state.calls.in(0.to(5))
    and state.writes.in(0.to(state.calls)) and state.clearFailures.in(0.to(state.calls))
    and state.outcome.in(outcomes) and ((state.joined or state.selected) implies state.probe != 0)
    and (state.committed implies (state.selected and state.fenced))

  run sameWidthSwapRequiresAcknowledgementTest = init.then(start(1, "none", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .then(start(2, "none", "none")).then(finish).expect(safety and state.disabled and state.stored.model == "alpha")
    .then(skip).then(skip).then(start(2, "beta", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .expect(safety and not(state.disabled) and not(state.warned) and state.stored.model == "beta" and state.writes == 2)

  run providerSwapPreservesKnownModelTest = init.then(start(1, "none", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .then(start(3, "none", "none")).then(selectWidth).then(commitIdentity).then(finish).expect(safety and state.pin.provider == "b" and state.writes == 2)

  run cacheReadFailureKeepsPriorColumnTest = init.then(start(1, "none", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .then(start(6, "none", "read")).then(finish)
    .expect(safety and state.column == 2 and state.pin.width == 2 and not(state.disabled))

  run ambiguousCommitFencesAndRetryDoesNotRewriteTest = init.then(start(1, "none", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .then(start(6, "none", "write-committed")).then(selectWidth)
    .expect(safety and state.fenced and state.disabled and state.column == 3 and state.pin.width == 2)
    .then(commitIdentity).expect(safety and state.committed and state.pin.width == 2 and state.stored.width == 3)
    .then(finish).expect(safety and state.fenced and state.stored.width == 3 and state.writes == 2)
    .then(start(6, "none", "read")).then(finish).expect(safety and state.fenced and state.disabled)
    .then(start(6, "none", "none")).then(selectWidth).then(finish)
    .expect(safety and not(state.disabled) and state.pin.width == 3 and state.writes == 2)

  run falseWriteResponseCannotPublishPinTest = init.then(start(1, "none", "write-false")).then(selectWidth).then(finish)
    .expect(safety and state.fenced and state.pin.width == 0 and state.writes == 0)
    .then(start(1, "none", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .expect(safety and not(state.fenced) and state.pin.width == 2 and state.writes == 1)

  run resizedColumnStaysFencedAfterAdapterFailureTest = init.then(start(1, "none", "none")).then(selectWidth).then(commitIdentity).then(finish)
    .then(start(6, "none", "resize")).then(selectWidth).then(finish)
    .expect(safety and state.fenced and state.column == 3 and state.pin.width == 2 and state.stored.width == 2)

  run joinedProbeAndClearFailureTest = init.then(start(6, "none", "clear")).then(join).then(selectWidth).then(commitIdentity).then(finish)
    .expect(safety and state.calls == 1 and state.clearFailures == 1 and state.pin.width == 3)
}
