// CanonicalNotesUi feedback classifier at its actual controller/editor callbacks.
// The latch is a history monitor for an unreviewed failed interaction.
module CanonicalNotesFeedback {
  type State = {phase: str, review: str, failure: str, uncertain: bool}
  var s: State
  pure val Phases = Set("loading", "ready", "saving", "review", "retired")
  action init = s' = {phase: "loading", review: "none", failure: "none", uncertain: false}
  action phase(value: str): bool = all {Phases.contains(value),
    {
      val review = if (value == "review" and s.review == "none") "change" else s.review
      s' = {...s, review: review, phase: if (value == "ready" and review != "none") "review" else value}
    }}
  action failed(operation: str): bool = all {Set("read", "interact").contains(operation),
    if (operation == "interact" or s.review != "change")
      s' = {...s, failure: operation, review: if (operation == "read") "read" else "change",
        uncertain: s.uncertain or operation == "interact"}
    else s' = s}
  action changeReview = s' = {...s, review: "change", phase: "review"}
  action committed = s' = {phase: "ready", review: "none", failure: "none", uncertain: false}
  action readSnapshot(dirty: bool, current: bool, pending: bool): bool =
    if (s.review == "read" and current and not(pending) and not(dirty))
      s' = {...s, review: "none", failure: "none"}
    else s' = s
  action discard = s' = {...s, review: "none", failure: "none", uncertain: false}
  // Try again read the collection and found the draft's words already saved there.
  action retryConfirmed = s' = {phase: "ready", review: "none", failure: "none", uncertain: false}
  action step = any {
    {nondet value = Phases.oneOf(); phase(value)},
    {nondet operation = Set("read", "interact").oneOf(); failed(operation)},
    {nondet dirty = Bool.oneOf(); nondet current = Bool.oneOf(); nondet pending = Bool.oneOf(); readSnapshot(dirty, current, pending)},
    changeReview, committed, discard, retryConfirmed, s' = s}
  val TypeOK = Phases.contains(s.phase) and Set("none", "read", "change").contains(s.review)
    and Set("none", "read", "interact").contains(s.failure)
  val InteractionFailureRetained = s.uncertain implies s.review == "change" and s.failure == "interact"
  val safety = TypeOK and InteractionFailureRetained
  run acceptedReadClearsReadFailureTest = init.then(failed("read")).then(phase("review"))
    .then(readSnapshot(false, true, false)).then(phase("ready"))
    .expect(s.review == "none" and s.failure == "none" and s.phase == "ready" and safety)
  run dirtyReadFailureRetainedTest = init.then(failed("read")).then(phase("review"))
    .then(readSnapshot(true, true, false)).then(phase("ready"))
    .expect(s.review == "read" and s.phase == "review" and safety)
  run uncertainReadbackKeepsReviewTest = init.then(failed("interact")).then(phase("review"))
    .then(phase("loading")).then(failed("read")).then(phase("review"))
    .then(readSnapshot(false, true, false)).then(phase("ready"))
    .expect(s.review == "change" and s.failure == "interact" and s.uncertain and safety)
  run explicitDiscardReclassifiesReadFailureTest = init.then(failed("interact")).then(phase("review"))
    .then(discard).then(phase("loading")).then(failed("read")).then(phase("review")).then(changeReview)
    .expect(s.review == "change" and s.failure == "read" and not(s.uncertain) and safety)
  run retryReadbackClearsUncertaintyTest = init.then(failed("interact")).then(phase("review"))
    .then(phase("loading")).then(readSnapshot(true, true, false)).then(phase("ready"))
    .expect(s.review == "change" and s.phase == "review" and s.uncertain and safety)
    .then(retryConfirmed)
    .expect(s.review == "none" and s.failure == "none" and s.phase == "ready" and not(s.uncertain) and safety)
  run retryRefusalKeepsReviewTest = init.then(phase("ready")).then(changeReview)
    .then(phase("loading")).then(readSnapshot(true, true, false)).then(phase("ready"))
    .expect(s.review == "change" and s.phase == "review" and safety)
  run ownedCommitClearsUncertaintyTest = init.then(failed("interact")).then(phase("review")).then(committed)
    .expect(s.review == "none" and not(s.uncertain) and safety)
}
