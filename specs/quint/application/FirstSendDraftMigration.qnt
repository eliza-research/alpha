// Alpha first-send source-slot cleanup over two independent durable draft stores.
module FirstSendDraftMigration {
  type Draft = {revision: str, text: str, sending: bool}
  type Dispatch = {expected: str, current: bool, destination: Draft}
  type State = {phase: str, live: bool, binding: str, source: Draft, destination: Draft,
    sourceReceipt: Draft, destinationReceipt: Draft, retries: int, attempts: int, result: str, dispatched: Dispatch}
  var s: State

  pure val draftText = "Keep draft A"
  pure val otherText = "Other committed text"
  pure val empty: Draft = {revision: "", text: "", sending: false}
  pure val clearRevisions = List("clear-1", "clear-2", "clear-3", "clear-4")
  action initDestination(text: str): bool = all {
    text.in(Set(draftText, otherText)),
    s' = {phase: "idle", live: true, binding: "destination",
      source: {revision: "source-1", text: draftText, sending: false},
      destination: {revision: "destination-1", text: text, sending: false},
      sourceReceipt: empty, destinationReceipt: empty, retries: 0, attempts: 0, result: "none",
      dispatched: {expected: "", current: false, destination: empty}},
  }
  action init = initDestination(draftText)
  val ownerCurrent = s.live and s.binding == "destination"
  pure def retryOrFinish(state: State): State =
    if (state.retries < 3) {...state, phase: "retry", retries: state.retries + 1} else {...state, phase: "done"}

  action start = all {
    s.phase == "idle",
    s' = {...s, phase: if (ownerCurrent) "destination" else "done"},
  }
  action readDestination = all {
    s.phase == "destination",
    val observed = {...s, destinationReceipt: s.destination}
    s' = if (not(ownerCurrent)) {...observed, phase: "done"}
      else if (s.destination.text == draftText) {...observed, phase: "source"}
      else retryOrFinish(observed),
  }
  action readSource = all {
    s.phase == "source",
    val observed = {...s, sourceReceipt: s.source}
    s' = if (not(ownerCurrent) or s.source.text != draftText) {...observed, phase: "done"}
      else if (s.source.sending) retryOrFinish(observed)
      else {...observed, phase: "confirmation"},
  }
  action confirmDestination = all {
    s.phase == "confirmation",
    val observed = {...s, destinationReceipt: s.destination}
    s' = if (not(ownerCurrent)) {...observed, phase: "done"}
      else if (s.destination.text != draftText) retryOrFinish(observed)
      else {...observed, phase: "clear", attempts: s.attempts + 1,
        dispatched: {expected: s.sourceReceipt.revision, current: ownerCurrent, destination: s.destination}},
  }
  action finishClear = all {
    s.phase == "clear",
    s' = if (s.source == s.sourceReceipt) {...s, phase: "done", result: "saved",
      source: {...empty, revision: clearRevisions.nth(s.attempts - 1)}}
      else retryOrFinish({...s, result: "conflict"}),
  }
  action resumeRetry = all {
    s.phase == "retry", s' = {...s, phase: if (ownerCurrent) "destination" else "done"},
  }
  action retire = all {s.live, s' = {...s, live: false}}
  action rebind = all {s.binding == "destination", s' = {...s, binding: "other"}}
  action replaceDestination(text: str): bool = all {
    text.in(Set(draftText, otherText)), s.destination.revision == "destination-1",
    s' = {...s, destination: {revision: "destination-2", text: text, sending: false}},
  }
  action replaceSource(text: str, sending: bool): bool = all {
    text.in(Set(draftText, otherText)), s.source.revision == "source-1", s.phase != "done",
    s' = {...s, source: {revision: "source-2", text: text, sending: sending}},
  }
  action step = any {
    start, readDestination, readSource, confirmDestination, finishClear, resumeRetry, retire, rebind,
    {nondet text = Set(draftText, otherText).oneOf(); replaceDestination(text)},
    {nondet text = Set(draftText, otherText).oneOf(); nondet sending = Bool.oneOf(); replaceSource(text, sending)},
    s' = s,
  }

  val ClearDispatchWasAuthorized = s.attempts > 0 implies
    (s.dispatched.current and s.dispatched.destination.text == draftText and s.dispatched.expected != "")
  val ClearUsesExactSourceReceipt = s.phase == "clear" implies
    (s.dispatched.expected == s.sourceReceipt.revision and s.sourceReceipt.text == draftText and not(s.sourceReceipt.sending))
  val ConfirmedClearIsRevisioned = s.result == "saved" implies
    (s.source.text == "" and s.source.revision == clearRevisions.nth(s.attempts - 1))
  val safety = ClearDispatchWasAuthorized and ClearUsesExactSourceReceipt and ConfirmedClearIsRevisioned

  run matchingDestinationClearsExactSourceTest = init.then(start).then(readDestination).then(readSource)
    .then(confirmDestination).then(finishClear).expect(s.result == "saved" and safety)
  run retiredBindingCannotDispatchClearTest = init.then(start).then(readDestination).then(rebind).then(readSource)
    .expect(s.phase == "done" and s.source.text == draftText and s.attempts == 0 and safety)
  run destinationDisagreementRetainsSourceTest = init.then(start).then(readDestination).then(replaceDestination(otherText))
    .then(readSource).then(confirmDestination).expect(s.phase == "retry" and s.source.text == draftText and s.attempts == 0 and safety)
  run changedSourceConflictsWithClearReceiptTest = init.then(start).then(readDestination).then(readSource)
    .then(confirmDestination).then(replaceSource(otherText, false)).then(finishClear).then(resumeRetry)
    .then(readDestination).then(readSource).expect(s.result == "conflict" and s.source.text == otherText and safety)
  run destinationReplacementAfterDispatchRemainsIndependentTest = init.then(start).then(readDestination).then(readSource)
    .then(confirmDestination).then(replaceDestination(otherText)).then(finishClear)
    .expect(s.source.text == "" and s.destination.text == otherText and safety)
}
