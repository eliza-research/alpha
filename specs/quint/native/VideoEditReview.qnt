// The video trim editor: a loaded source, a clamped trim range, one save per editor and the
// trim clock. Trim positions are tenths of a second over a four-tenths source.
module VideoEditReview {
  pure val Duration = 4
  type Edit = { start: int, end: int, rotation: int, crop: bool }
  type State = {
    loaded: bool, busy: bool, closed: bool, hidden: bool, playing: bool,
    edit: Edit, submitted: Edit, saves: int, outcome: str, aborted: bool
  }
  var s: State
  pure val untouched: Edit = { start: 0, end: Duration, rotation: 0, crop: false }
  action init = s' = {
    loaded: false, busy: false, closed: false, hidden: false, playing: false,
    edit: untouched, submitted: untouched, saves: 0, outcome: "none", aborted: false
  }
  /// Minutes and tenths of a second shown for a position in hundredths of a second. The value
  /// is rounded to tenths first, so the seconds field never reaches 60.
  pure def clockMinutes(hundredths: int): int = ((hundredths + 5) / 10) / 600
  pure def clockSecondTenths(hundredths: int): int = ((hundredths + 5) / 10) % 600
  pure def clamp(low: int, value: int, high: int): int = if (value < low) low else if (value > high) high else value
  val editable = s.loaded and not(s.busy) and not(s.closed)
  action sourceLoaded = all { not(s.closed), s' = { ...s, loaded: true } }
  action sourceError = all { not(s.closed), s' = { ...s, loaded: false, playing: false } }
  // A handle is clamped to keep at least a tenth of a second and stay inside the source.
  action trim(key: str, value: int): bool = all { editable, Set("start", "end").contains(key),
    s' = { ...s, playing: false, edit: if (key == "start") { ...s.edit, start: clamp(0, value, s.edit.end - 1) }
      else { ...s.edit, end: clamp(s.edit.start + 1, value, Duration) } } }
  action rotate = all { editable, s' = { ...s, edit: { ...s.edit, rotation: (s.edit.rotation + 90) % 360 } } }
  action toggleCrop = all { editable, s' = { ...s, edit: { ...s.edit, crop: not(s.edit.crop) } } }
  action play = all { editable, s' = { ...s, playing: true } }
  action pause = all { s.playing, s' = { ...s, playing: false } }
  // Save submits a copy of the edit. The editor stays busy: a second save needs a reopened editor.
  action commit = all { editable,
    s' = { ...s, busy: true, playing: false, submitted: s.edit, saves: s.saves + 1 } }
  action saveSettled(result: str): bool = all { s.busy, s.outcome == "none", Set("saved", "not-saved", "rejected").contains(result),
    s' = if (s.closed) { ...s, outcome: "dropped" }
      else if (result == "saved") { ...s, outcome: "saved", closed: true, aborted: true }
      else { ...s, outcome: if (result == "rejected") "unconfirmed" else "not-saved" } }
  // Close, back and a hidden page dispose the editor and abort its save signal.
  action close = all { not(s.closed), s' = { ...s, closed: true, aborted: true, playing: false } }
  action hide = s' = { ...s, hidden: true, closed: true, aborted: true, playing: false }
  action show = s' = { ...s, hidden: false }
  action step = {
    nondet key = Set("start", "end").oneOf()
    nondet value = (-1).to(Duration + 1).oneOf()
    nondet result = Set("saved", "not-saved", "rejected").oneOf()
    any { sourceLoaded, sourceError, trim(key, value), rotate, toggleCrop, play, pause, commit,
      saveSettled(result), close, hide, show, s' = s }
  }
  val TrimValid = 0 <= s.edit.start and s.edit.start <= s.edit.end - 1 and s.edit.end <= Duration
  val SubmittedEditFrozen = s.busy implies s.edit == s.submitted
  val OneSavePerEditor = s.saves.in(Set(0, 1)) and (s.saves == 1) == s.busy
  val HiddenEditorClosed = s.hidden implies s.closed
  val ClosedAbortsSave = s.closed implies s.aborted and not(s.playing)
  val SavedOutcomeCloses = s.outcome == "saved" implies s.closed
  pure val ClockSecondsBelowSixty = Set(0, 4, 5, 5994, 5995, 5996, 5999, 6000, 11996, 11997, 35999).forall(value =>
    clockSecondTenths(value) < 600 and clockMinutes(value) * 600 + clockSecondTenths(value) == (value + 5) / 10)
  val safety = TrimValid and SubmittedEditFrozen and OneSavePerEditor and HiddenEditorClosed
    and ClosedAbortsSave and SavedOutcomeCloses
  val TightestTrimWitness = s.edit.end - s.edit.start == 1 and s.edit.start > 0
  val UnsavedCopyWitness = s.outcome == "not-saved" and s.busy and not(s.closed)
  val LateResultDroppedWitness = s.outcome == "dropped"
  val SavedCopyWitness = s.outcome == "saved" and s.submitted.rotation == 90
  run trimClampedTest = init.then(sourceLoaded).then(trim("start", 5)).expect(s.edit.start == 3 and safety)
    .then(trim("end", -1)).expect(s.edit.end == 4 and safety).then(trim("start", 1)).then(trim("end", 0))
    .expect(s.edit.start == 1 and s.edit.end == 2 and safety)
  // 59.96 seconds is shown as one minute, never as 0:60.0.
  run clockRoundsIntoMinutesTest = init.expect(clockMinutes(5996) == 1 and clockSecondTenths(5996) == 0
    and clockMinutes(5994) == 0 and clockSecondTenths(5994) == 599
    and clockMinutes(11997) == 2 and clockSecondTenths(11997) == 0 and ClockSecondsBelowSixty and safety)
  run saveOnceThenCloseTest = init.then(sourceLoaded).then(rotate).then(commit)
    .expect(s.busy and s.submitted.rotation == 90 and safety).then(saveSettled("saved"))
    .expect(s.closed and s.outcome == "saved" and safety)
  run failedSaveNeedsReopenTest = init.then(sourceLoaded).then(commit).then(saveSettled("not-saved"))
    .expect(s.busy and not(s.closed) and s.saves == 1 and s.outcome == "not-saved" and safety)
  run hiddenPageDropsResultTest = init.then(sourceLoaded).then(commit).then(hide).then(saveSettled("saved"))
    .expect(s.closed and s.aborted and s.outcome == "dropped" and safety)
}
