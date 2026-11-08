// Mounted canonical Calendar form, Back ordering and retained draft controls.
module CanonicalCalendarEditorClose {
  type Form = {id: int, owner: int, target: int, title: str}
  type State = {owner: int, view: str, detail: int, form: Form, retained: Form,
    picker: bool, invalid: bool, discarding: Form, lastForm: int, notice: str}
  var s: State

  pure val Empty: Form = {id: 0, owner: 0, target: 0, title: ""}
  pure val Events = Set(1, 2)
  pure val ValidTitles = Set("", "event-a", "event-b", "first", "second")
  pure val Titles = ValidTitles.union(Set("oversized"))
  action init = s' = {owner: 1, view: "home", detail: 0, form: Empty, retained: Empty,
    picker: false, invalid: false, discarding: Empty, lastForm: 0, notice: ""}

  val editorVisible = s.view == "calendar" and s.form != Empty
  val pickerVisible = editorVisible and s.picker
  val detailVisible = s.view == "calendar" and s.detail != 0 and s.form == Empty
  val controlsVisible = s.view == "calendar" and s.detail == 0 and s.form == Empty and s.retained != Empty
  val controlsEnabled = controlsVisible and s.discarding == Empty
  val canConnect = s.form == Empty and s.retained == Empty and not(s.invalid) and s.discarding == Empty
  pure def opened(value: State, target: int, title: str): State = {
    val form = {id: value.lastForm + 1, owner: value.owner, target: target, title: title}
    {...value, form: form, retained: form, invalid: false, picker: false, lastForm: form.id}
  }
  pure def closed(value: State): State = {...value, form: Empty, picker: false,
    invalid: value.invalid and value.retained != Empty}

  action enterCalendar = all {
    s.view != "calendar", s.form == Empty,
    s' = {...s, view: "calendar", detail: 0},
  }
  pure def admitted(value: State, target: int, title: str): State =
    if (value.discarding != Empty) {...value, notice: "draft-busy"}
    else if (value.retained != Empty) {...value, notice: "finish-draft"}
    else opened(value, target, title)
  action newForm = all {
    s.view == "calendar", s.form == Empty, s.detail == 0, s.lastForm < 4,
    s' = admitted(s, 0, ""),
  }
  action openDetail(target: int): bool = all {
    s.view == "calendar", s.form == Empty, s.detail == 0, Events.contains(target),
    s' = {...s, detail: target},
  }
  action editForm = all {
    detailVisible, s.lastForm < 4,
    s' = admitted(s, s.detail, if (s.detail == 1) "event-a" else "event-b"),
  }
  action editTitle(title: str): bool = all {
    editorVisible, Titles.contains(title), s.discarding == Empty,
    val form = {...s.form, title: title}
    s' = if (title == "oversized") {...s, form: form, invalid: true}
      else {...s, form: form, retained: form, invalid: false},
  }
  action openPicker = all {
    editorVisible, not(s.picker), s' = {...s, picker: true},
  }
  action back = all {
    s.view == "calendar", s.form != Empty or s.detail != 0,
    s' = if (s.picker) {...s, picker: false}
      else if (s.form != Empty) closed(s)
      else {...s, detail: 0},
  }
  action leaveCalendar = all {
    s.view == "calendar", s.form == Empty, s.detail == 0,
    s' = {...s, view: "home"},
  }
  action headerClose = all {editorVisible, s' = closed(s)}
  action resume = all {
    controlsEnabled,
    s' = {...s, form: s.retained, detail: 0, picker: false, invalid: false},
  }
  action discard(accept: bool): bool = all {
    controlsEnabled,
    s' = if (accept) {...s, discarding: s.retained} else s,
  }
  action finishDiscard(ok: bool): bool = all {
    s.discarding != Empty,
    s' = if (ok and s.form == Empty and s.retained == s.discarding) {...s, discarding: Empty, retained: Empty, invalid: false}
      else {...s, discarding: Empty, notice: "draft-changed"},
  }
  action replaceOwner = all {
    s.owner == 1, s' = {...s, owner: 2, form: Empty, retained: Empty, picker: false,
      invalid: false, discarding: Empty},
  }
  action settings = all {s.view == "home", s' = {...s, view: "settings"}}
  action step = any {
    enterCalendar, newForm, editForm, openPicker, back, leaveCalendar, headerClose, resume, replaceOwner, settings,
    {nondet target = Events.oneOf(); openDetail(target)},
    {nondet title = Titles.oneOf(); editTitle(title)},
    {nondet accept = Bool.oneOf(); discard(accept)},
    {nondet ok = Bool.oneOf(); finishDiscard(ok)},
    s' = s,
  }

  val ExactDraftOwner = (s.form == Empty or s.form.owner == s.owner)
    and (s.retained == Empty or s.retained.owner == s.owner and ValidTitles.contains(s.retained.title))
    and (s.discarding == Empty or s.discarding.owner == s.owner and s.discarding == s.retained)
  val NoClosedValidationLatch = s.form != Empty or s.retained != Empty or not(s.invalid)
  val PickerBelongsToEditor = not(s.picker) or editorVisible
  val safety = ExactDraftOwner and NoClosedValidationLatch and PickerBelongsToEditor

  run pickerBackThenFormBackKeepsDraftTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(openPicker).then(back).expect(editorVisible and not(pickerVisible) and s.form.title == "first")
    .then(back).expect(controlsVisible and safety)
    .then(resume).expect(s.form.id == 1 and s.form.title == "first" and safety)
  run closeInvalidFormKeepsTheLastValidCopyTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(editTitle("oversized")).then(headerClose).expect(s.invalid and s.retained.title == "first" and safety)
    .then(resume).expect(not(s.invalid) and s.form.title == "first" and safety)
  run declinedDiscardThenConsumedDraftUnblocksSettingsTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(editTitle("oversized")).then(headerClose).then(discard(false))
    .expect(s.invalid and not(canConnect) and controlsVisible)
    .then(discard(true)).then(finishDiscard(true)).then(leaveCalendar).then(settings)
    .expect(canConnect and not(s.invalid) and safety)
  run editBackKeepsItsEventDetailTest = init.then(enterCalendar).then(openDetail(1)).then(editForm).then(editTitle("second"))
    .then(back).expect(detailVisible and not(controlsVisible) and safety)
    .then(back).then(resume).expect(s.form.target == 1 and s.form.title == "second" and safety)
  run exactRetainedEditBlocksSameOrDifferentEventTest = init.then(enterCalendar).then(openDetail(1)).then(editForm)
    .then(editTitle("first")).then(back).then(back).then(openDetail(1)).then(editForm)
    .expect(detailVisible and s.retained.target == 1 and s.notice == "finish-draft" and safety)
    .then(back).then(openDetail(2)).then(editForm)
    .expect(detailVisible and s.detail == 2 and s.retained.target == 1 and s.retained.title == "first" and safety)
  run replacedOwnerCannotResumeOldVisibleDraftTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(openPicker).then(replaceOwner).expect(canConnect and not(controlsVisible) and safety)
}
