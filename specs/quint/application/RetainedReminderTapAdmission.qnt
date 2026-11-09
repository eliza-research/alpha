// Admission after the exact retained reminder detail's render callback.
module RetainedReminderTapAdmission {
  type State = {view: str, visit: int, detail: bool, captured: str, capturedVisit: int,
    waiting: bool, pending: str, chooser: bool, sensitive: bool, form: bool, foreground: bool,
    attempts: List[str], consumed: List[str], blockedConsume: bool}
  var s: State

  action init = s' = {view: "home", visit: 0, detail: false, captured: "", capturedVisit: 0,
    waiting: false, pending: "", chooser: false, sensitive: false, form: false, foreground: true,
    attempts: List(), consumed: List(), blockedConsume: false}
  val eligible = s.foreground and not(s.chooser or s.sensitive or s.form)
  val currentDetail = s.view == "calendar" and s.detail and s.visit == s.capturedVisit
  action enqueueOriginal = all {
    s.pending == "", s.captured == "",
    s' = {...s, pending: "original-token"},
  }
  action publish = all {
    eligible, not(s.waiting), s.pending != "", s.visit < 4,
    s' = {...s, view: "calendar", detail: true, visit: s.visit + 1,
      captured: s.pending, capturedVisit: s.visit + 1, waiting: true},
  }
  action setGate(gate: str, value: bool): bool = {
    val updated = if (gate == "chooser") {...s, chooser: value}
      else if (gate == "sensitive") {...s, sensitive: value}
      else if (gate == "form") {...s, form: value}
      else {...s, foreground: value}
    all { gate.in(Set("chooser", "sensitive", "form", "foreground")), s' = updated }
  }
  action navigate(view: str): bool = all {
    view.in(Set("notes", "calendar")), s.visit < 4,
    s' = {...s, view: view, visit: s.visit + 1, detail: view == "calendar"},
  }
  action changeDetail = all { s.view == "calendar", s' = {...s, detail: false} }
  action replaceToken = all {
    s.waiting, s.pending == "original-token",
    s' = {...s, pending: "newer-token"},
  }
  action commit = all {
    s.waiting,
    val admitted = eligible and currentDetail
    val accepted = admitted and s.pending == s.captured
    s' = {...s, waiting: false,
      attempts: if (admitted) s.attempts.append(s.captured) else s.attempts,
      consumed: if (accepted) s.consumed.append(s.captured) else s.consumed,
      pending: if (accepted) "" else s.pending},
  }
  action step = any {
    enqueueOriginal, publish, changeDetail, replaceToken, commit,
    {nondet gate = Set("chooser", "sensitive", "form", "foreground").oneOf(); nondet value = Bool.oneOf(); setGate(gate, value)},
    {nondet view = Set("notes", "calendar").oneOf(); navigate(view)},
    s' = s,
  }

  val ProtectedCommitKeepsCustody = not(s.blockedConsume)
  val CommitOwnsPublishedVisit = s.waiting implies (s.captured != "" and s.capturedVisit > 0 and s.capturedVisit <= s.visit)
  val ConsumesExactToken = s.consumed.length() > 0 implies
    (s.pending == "" and s.consumed == List(s.captured) and s.attempts.length() >= 1)
  val safety = ProtectedCommitKeepsCustody and CommitOwnsPublishedVisit and ConsumesExactToken

  run uninterruptedDetailConsumesTest = init.then(enqueueOriginal).then(publish).then(commit)
    .expect(s.consumed == List("original-token") and safety)
  run chooserCloseRechecksRetainedTokenTest = init.then(enqueueOriginal).then(publish).then(setGate("chooser", true))
    .then(commit).expect(s.attempts == List() and s.pending == "original-token" and safety)
    .then(setGate("chooser", false)).then(publish).then(commit).expect(s.consumed == List("original-token") and safety)
  run sensitiveAndFormRetainTest = init.then(enqueueOriginal).then(publish).then(setGate("sensitive", true))
    .then(commit).expect(s.attempts == List() and s.pending == "original-token" and safety)
    .then(setGate("sensitive", false)).then(publish).then(setGate("form", true)).then(commit)
    .expect(s.attempts == List() and s.pending == "original-token" and safety)
  run changedVisitRefusesSameDetailTest = init.then(enqueueOriginal).then(publish)
    .then(navigate("notes")).then(navigate("calendar")).then(commit)
    .expect(s.detail and s.attempts == List() and s.pending == "original-token" and safety)
  run nativeReplacementKeepsNewTokenTest = init.then(enqueueOriginal).then(publish).then(replaceToken).then(commit)
    .expect(s.attempts == List("original-token") and s.consumed == List() and s.pending == "newer-token" and safety)
}
