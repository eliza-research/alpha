// Mounted Calendar editors retain separate owner-bound event drafts automatically.
module CanonicalCalendarEditorClose {
  type Form = {id: int, owner: int, target: int, title: str}
  type State = {owner: int, view: str, detail: int, form: Form, retained: Form,
    saved: int -> Form, invalid: bool, lastForm: int}
  var s: State
  pure val Empty: Form = {id: 0, owner: 0, target: 0, title: ""}
  pure val Events = Set(1, 2)
  pure val ValidTitles = Set("", "event-a", "event-b", "first", "second")
  pure val Titles = ValidTitles.union(Set("oversized"))
  pure def slot(owner: int, target: int): int = owner * 3 + target
  action init = s' = {owner: 1, view: "home", detail: 0, form: Empty, retained: Empty,
    saved: Map(), invalid: false, lastForm: 0}
  val editorVisible = s.view == "calendar" and s.form != Empty
  val detailVisible = s.view == "calendar" and s.detail != 0 and s.form == Empty
  val controlsVisible = false
  val canConnect = s.form == Empty and s.retained == Empty and not(s.invalid)
  pure def opened(value: State, target: int, title: str): State = {
    val key = slot(value.owner, target)
    val hasSaved = value.saved.keys().contains(key)
    val form = if (hasSaved) value.saved.get(key)
      else {id: value.lastForm + 1, owner: value.owner, target: target, title: title}
    {...value, form: form, retained: form, saved: value.saved.put(key, form),
      invalid: false, lastForm: if (hasSaved) value.lastForm else form.id}
  }
  pure def closed(value: State): State = {...value, form: Empty,
    invalid: value.invalid and value.retained != Empty}
  action enterCalendar = all {s.view != "calendar", s.form == Empty,
    s' = {...s, view: "calendar", detail: 0}}
  action newForm = all {s.view == "calendar", s.form == Empty, s.detail == 0, s.lastForm < 6,
    s' = opened(s, 0, "")}
  action openDetail(target: int): bool = all {s.view == "calendar", s.form == Empty,
    s.detail == 0, Events.contains(target), s' = {...s, detail: target}}
  action editForm = all {detailVisible, s.lastForm < 6,
    s' = opened(s, s.detail, if (s.detail == 1) "event-a" else "event-b")}
  action editTitle(title: str): bool = all {editorVisible, Titles.contains(title),
    val form = {...s.form, title: title}
    s' = if (title == "oversized") {...s, form: form, invalid: true}
      else {...s, form: form, retained: form, saved: s.saved.put(slot(s.owner, form.target), form), invalid: false}}
  action back = all {s.view == "calendar", s.form != Empty or s.detail != 0,
    s' = if (s.form != Empty) closed(s) else {...s, detail: 0}}
  action headerClose = all {editorVisible, s' = closed(s)}
  action leaveCalendar = all {s.view == "calendar", s.form == Empty, s.detail == 0,
    s' = {...s, view: "home"}}
  action replaceOwner = all {s.owner == 1,
    s' = {...s, owner: 2, form: Empty, retained: Empty, invalid: false}}
  action step = any {enterCalendar, newForm, editForm, back, headerClose, leaveCalendar, replaceOwner,
    {nondet target = Events.oneOf(); openDetail(target)},
    {nondet title = Titles.oneOf(); editTitle(title)}, s' = s}
  val ExactDraftOwner = (s.form == Empty or s.form.owner == s.owner)
    and (s.retained == Empty or s.retained.owner == s.owner and ValidTitles.contains(s.retained.title))
  val SavedDraftOwner = s.saved.keys().forall(key =>
    slot(s.saved.get(key).owner, s.saved.get(key).target) == key and ValidTitles.contains(s.saved.get(key).title))
  val NoClosedValidationLatch = s.form != Empty or s.retained != Empty or not(s.invalid)
  val safety = ExactDraftOwner and SavedDraftOwner and NoClosedValidationLatch
  run closeAndReopenKeepsDraftTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(back).then(newForm).expect(s.form.id == 1 and s.form.title == "first" and safety)
  run invalidInputKeepsLastValidCopyTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(editTitle("oversized")).then(headerClose).then(newForm)
    .expect(not(s.invalid) and s.form.title == "first" and safety)
  run eventDraftsRemainIndependentTest = init.then(enterCalendar).then(openDetail(1)).then(editForm).then(editTitle("first"))
    .then(back).then(back).then(openDetail(2)).then(editForm).then(editTitle("second"))
    .then(back).then(back).then(openDetail(1)).then(editForm)
    .expect(s.form.title == "first" and s.form.target == 1 and safety)
  run newAndExistingDraftsRemainSeparateTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(back).then(openDetail(1)).then(editForm).then(editTitle("second")).then(back).then(back).then(newForm)
    .expect(s.form.target == 0 and s.form.title == "first" and safety)
  run returningToCalendarResumesDraftTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(back).then(leaveCalendar).then(enterCalendar).then(newForm)
    .expect(s.form.id == 1 and s.form.title == "first" and safety)
  run ownerReplacementKeepsSeparateDraftTest = init.then(enterCalendar).then(newForm).then(editTitle("first"))
    .then(replaceOwner).then(newForm).expect(s.form.owner == 2 and s.form.title == "" and s.saved.get(3).title == "first" and safety)
}
