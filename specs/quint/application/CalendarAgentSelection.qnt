// What Calendar exposes to the assistant as "the selected object": the open device event after
// an inspection, or the device calendar a new-event form will save to. An epoch retires every
// inspection that was started for something no longer shown.
module CalendarAgentSelection {
  type Selection = { kind: str, open: int, revision: int }
  type State = {
    // open: the event whose detail is shown (0 when none). shown/provider: the event's revision
    // as loaded in the rows and as the provider has it now.
    open: int, shown: int -> int, provider: int -> int,
    // form: "none" | "local" (a new-event form saving to the on-phone calendar) | "other".
    form: str,
    selection: Selection, selectionEpoch: int,
    // keyOpen/keyRevision: the detail the current inspection was started for.
    keyOpen: int, keyRevision: int, epoch: int,
    // The awaited inspection or source preparation (kind "none" when nothing is awaited).
    pending: str, pendingToken: int, pendingOpen: int
  }
  var s: State
  pure val none: Selection = { kind: "none", open: 0, revision: 0 }
  action init = s' = { open: 0, shown: Map(1 -> 0, 2 -> 0), provider: Map(1 -> 0, 2 -> 0),
    form: "none", selection: none, selectionEpoch: 0, keyOpen: 0, keyRevision: 0, epoch: 0,
    pending: "none", pendingToken: 0, pendingOpen: 0 }
  pure def retired(state: State): State =
    { ...state, selection: none, keyOpen: 0, keyRevision: 0, epoch: state.epoch + 1 }
  // The selection handed to the assistant: an event only while that event's detail is open, a
  // calendar source only while the form still targets the calendar it was prepared for.
  val Exposed = if (s.selection.kind == "source") (if (s.form == "local") s.selection else none)
    else if (s.selection.kind == "event" and s.open == s.selection.open) s.selection
    else none

  action openEvent(e: int): bool = all {
    Set(1, 2).contains(e), s.form == "none", s' = { ...s, open: e }
  }
  // Rendering a detail whose event or loaded content differs from the last one inspected drops
  // the selection and starts a new inspection.
  action renderDetail = all {
    s.open != 0, s.epoch < 6,
    s.keyOpen != s.open or s.keyRevision != s.shown.get(s.open),
    s' = { ...s, selection: none, keyOpen: s.open, keyRevision: s.shown.get(s.open),
      epoch: s.epoch + 1, pending: "event", pendingToken: s.epoch + 1, pendingOpen: s.open }
  }
  // The inspection answers for the provider's current revision. It is kept only if nothing
  // retired it and the same detail is still open.
  action inspected(ready: bool): bool = all {
    s.pending == "event",
    s' = if (ready and s.pendingToken == s.epoch and s.open == s.pendingOpen)
        { ...s, pending: "none", selectionEpoch: s.epoch,
          selection: { kind: "event", open: s.pendingOpen, revision: s.provider.get(s.pendingOpen) } }
      else { ...s, pending: "none" }
  }
  // Close is a control of the rendered detail, so it exists only once that detail was rendered.
  action closeEvent = all {
    s.open != 0, s.keyOpen == s.open, s.epoch < 6, s' = { ...retired(s), open: 0 }
  }
  // Every device-calendar read retires the selection; the rows then show the provider's revisions.
  action refresh = all { s.epoch < 6, s' = { ...retired(s), shown: s.provider } }
  // A committed change to another event reads the rows again. The inspected event is handed
  // back afterwards only when its detail is still open and its row came back unchanged.
  action commitElsewhere = all {
    s.epoch < 6,
    s' = if (s.selection.kind == "event" and s.open == s.selection.open
          and s.provider.get(s.open) == s.keyRevision)
        { ...s, shown: s.provider, epoch: s.epoch + 1, selectionEpoch: s.epoch + 1 }
      else { ...retired(s), shown: s.provider }
  }
  action providerChange(e: int): bool = all {
    Set(1, 2).contains(e), s.provider.get(e) < 2,
    s' = { ...s, provider: s.provider.set(e, s.provider.get(e) + 1) }
  }
  // A new-event form asks native to prepare the on-phone calendar as the assistant's target.
  // The new-event control belongs to the day list, which an open detail covers.
  action newForm = all {
    s.epoch < 6, s.open == 0,
    s' = { ...retired(s), form: "local", pending: "source", pendingToken: s.epoch + 1,
      pendingOpen: 0 }
  }
  action sourcePrepared(ready: bool): bool = all {
    s.pending == "source",
    s' = if (ready and s.pendingToken == s.epoch and s.form == "local")
        { ...s, pending: "none", selectionEpoch: s.epoch,
          selection: { kind: "source", open: 0, revision: 0 } }
      else { ...s, pending: "none" }
  }
  action pickCalendar(local: bool): bool = all {
    s.form != "none", s' = { ...s, form: if (local) "local" else "other" }
  }
  action closeForm = all { s.form != "none", s' = { ...s, form: "none" } }
  action step = {
    nondet e = Set(1, 2).oneOf()
    nondet flag = Bool.oneOf()
    any {
      openEvent(e), renderDetail, inspected(flag), closeEvent, refresh, commitElsewhere, providerChange(e), newForm,
      sourcePrepared(flag), pickCalendar(flag), closeForm, s' = s
    }
  }

  // The assistant never receives an event other than the one whose detail is open.
  val ExposedEventIsOpen = Exposed.kind == "event" implies Exposed.open == s.open and s.open != 0
  val ExposedSourceMatchesForm = Exposed.kind == "source" implies s.form == "local"
  // A selection always comes from the newest inspection: anything that retires it bumps the epoch.
  val SelectionFromCurrentEpoch = s.selection.kind != "none" implies s.selectionEpoch == s.epoch
  // The inspected event is the one the detail was rendered for.
  val SelectionMatchesKey = s.selection.kind == "event" implies s.selection.open == s.keyOpen
  val RevisionWasProviders = s.selection.kind == "event"
    implies s.selection.revision <= s.provider.get(s.selection.open)
  val TypeOK = s.open.in(0.to(2)) and s.form.in(Set("none", "local", "other"))
    and s.pending.in(Set("none", "event", "source")) and s.epoch.in(0.to(6))
    and s.selection.kind.in(Set("none", "event", "source"))
  val safety = TypeOK and ExposedEventIsOpen and ExposedSourceMatchesForm
    and SelectionFromCurrentEpoch and SelectionMatchesKey and RevisionWasProviders

  val EventSelectedWitness = Exposed.kind == "event"
  val SourceSelectedWitness = Exposed.kind == "source"
  val RetiredInspectionWitness = s.pending == "event" and s.pendingToken != s.epoch
  val SourceHiddenByCalendarChoiceWitness = s.selection.kind == "source" and s.form == "other"

  run inspectedEventSelectedTest = init.then(openEvent(1)).then(renderDetail).then(inspected(true))
    .expect(EventSelectedWitness and Exposed.open == 1 and safety)
    .then(renderDetail.fail())
  // The owner opens another event before the first inspection answers: the late answer is dropped.
  run lateInspectionDroppedTest = init.then(openEvent(1)).then(renderDetail).then(closeEvent)
    .then(openEvent(2)).expect(RetiredInspectionWitness).then(inspected(true))
    .expect(Exposed.kind == "none" and s.selection.kind == "none" and safety)
    .then(renderDetail).then(inspected(true)).expect(Exposed.open == 2 and safety)
  run refreshRetiresSelectionTest = init.then(openEvent(1)).then(renderDetail).then(inspected(true))
    .then(providerChange(1)).then(refresh).expect(Exposed.kind == "none" and safety)
    .then(renderDetail).then(inspected(true))
    .expect(Exposed.revision == 1 and s.keyRevision == 1 and safety)
  // Another event was committed: the open event's row is unchanged, so its selection is kept.
  run commitElsewhereKeepsSelectionTest = init.then(openEvent(1)).then(renderDetail).then(inspected(true))
    .then(providerChange(2)).then(commitElsewhere)
    .expect(Exposed.kind == "event" and Exposed.open == 1 and s.shown.get(2) == 1 and safety)
  // The open event itself changed underneath: the read drops the selection until it is inspected again.
  run commitElsewhereDropsChangedRowTest = init.then(openEvent(1)).then(renderDetail).then(inspected(true))
    .then(providerChange(1)).then(commitElsewhere).expect(Exposed.kind == "none" and safety)
    .then(renderDetail).then(inspected(true)).expect(Exposed.revision == 1 and safety)
  run failedInspectionSelectsNothingTest = init.then(openEvent(1)).then(renderDetail)
    .then(inspected(false)).expect(Exposed.kind == "none" and safety)
  run sourceFollowsFormCalendarTest = init.then(newForm).then(sourcePrepared(true))
    .expect(SourceSelectedWitness and safety).then(pickCalendar(false))
    .expect(SourceHiddenByCalendarChoiceWitness and Exposed.kind == "none" and safety)
    .then(pickCalendar(true)).expect(Exposed.kind == "source" and safety)
  run sourceForOtherCalendarDroppedTest = init.then(newForm).then(pickCalendar(false))
    .then(sourcePrepared(true)).expect(s.selection.kind == "none" and safety)
}
