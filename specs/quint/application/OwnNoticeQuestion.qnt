/// A question about one of the phone's own notifications (`reviewOwnNoticeQuestion`): the review
/// sheet, the recheck and the consumption of the notification tap, and the draft placed in the
/// composer. Dismissing releases the tap; Home or a lost focus cancels; the review ends once.
module OwnNoticeQuestion {
  type State = { phase: str, current: bool, canceled: bool, composing: bool, ended: bool, closedCalls: int,
    consumed: int, released: int, composed: int, report: str }
  var s: State
  // done(): the listeners are removed and the publisher is told the review closed, once.
  pure def done(st: State): State =
    if (st.ended) st else { ...st, ended: true, closedCalls: st.closedCalls + 1 }

  action init = s' = { phase: "idle", current: true, canceled: false, composing: false, ended: false,
    closedCalls: 0, consumed: 0, released: 0, composed: 0, report: "none" }
  // Only a current notification with a reviewable excerpt opens the sheet.
  action open(reviewable: bool): bool = all { s.phase == "idle",
    s' = if (s.current and reviewable) { ...s, phase: "review" }
      else { ...s, phase: "refused", report: "unavailable" } }
  action noticeChanged = all { s.current, s' = { ...s, current: false } }
  // The person closes the sheet: the tap is released so the notification can be opened again.
  action dismiss = all { s.phase == "review", not(s.composing),
    s' = done({ ...s, phase: "closed", canceled: true, released: s.released + 1 }) }
  // The sheet hands the question over only for a notification that is still current; for one that
  // changed it reports that and stays open.
  action chooseCompose = all { s.phase == "review", not(s.canceled), s.current,
    s' = { ...s, phase: "rechecking", composing: true } }
  // Home or a lost window focus. A question already being composed keeps running to its own end.
  action abort = all { s.phase.in(Set("review", "rechecking", "consuming")), not(s.ended),
    s' = done({ ...s, canceled: true, phase: if (s.phase == "review") "closed" else s.phase }) }
  action recheckSettles(ok: bool): bool = all { s.phase == "rechecking",
    s' = if (s.canceled or not(s.current) or not(ok)) done({ ...s, phase: "closed", report: "changed" })
      else { ...s, phase: "consuming" } }
  // The tap is spent once its consumption resolves, so a later Home or blur still drafts the question.
  action consumeSettles(ok: bool): bool = all { s.phase == "consuming",
    s' = if (not(ok)) done({ ...s, phase: "closed", report: "changed" })
      else if (not(s.current)) done({ ...s, phase: "closed", consumed: s.consumed + 1, report: "not-kept" })
      else done({ ...s, phase: "closed", consumed: s.consumed + 1, composed: s.composed + 1 }) }
  action step = {
    nondet ok = Set(false, true).oneOf()
    any { open(ok), noticeChanged, dismiss, chooseCompose, abort, recheckSettles(ok), consumeSettles(ok), s' = s }
  }

  val DraftNeedsSpentTap = s.composed <= s.consumed and s.consumed <= 1
  val ReleaseExcludesConsume = s.released + s.consumed <= 1
  val ClosedOnce = s.closedCalls <= 1 and s.ended == (s.closedCalls == 1)
  val EndedWhenSettled = s.phase == "closed" implies s.ended
  val SpentTapIsReported = (s.consumed == 1 and s.composed == 0) implies s.report == "not-kept"
  val ChangedNoticeDraftsNothing = s.report.in(Set("changed", "unavailable")) implies (s.composed == 0 and s.consumed == 0)
  val CancelBeforeConsumeStops = (s.canceled and s.phase == "consuming") implies s.ended
  val safety = DraftNeedsSpentTap and ReleaseExcludesConsume and ClosedOnce and EndedWhenSettled and
    SpentTapIsReported and ChangedNoticeDraftsNothing and CancelBeforeConsumeStops

  val DraftAfterCancelWitness = s.canceled and s.composed == 1
  val ReleasedWitness = s.released == 1 and s.ended
  val SpentButNotKeptWitness = s.report == "not-kept"

  run questionIsDraftedTest = init.then(open(true)).then(chooseCompose).then(recheckSettles(true))
    .then(consumeSettles(true)).expect(s.composed == 1 and s.consumed == 1 and s.closedCalls == 1 and safety)
  // Home is pressed while the tap is being consumed: the tap is spent, so the question is still
  // drafted, and the publisher hears that the review closed only once.
  run homeDuringConsumeStillDraftsTest = init.then(open(true)).then(chooseCompose).then(recheckSettles(true))
    .then(abort).expect(s.ended and s.closedCalls == 1 and s.composed == 0)
    .then(consumeSettles(true)).expect(s.composed == 1 and s.consumed == 1 and s.closedCalls == 1 and safety)
  run homeDuringRecheckSpendsNothingTest = init.then(open(true)).then(chooseCompose).then(abort)
    .then(recheckSettles(true)).expect(s.consumed == 0 and s.composed == 0 and s.report == "changed" and safety)
  run dismissReleasesTapTest = init.then(open(true)).then(dismiss)
    .expect(s.released == 1 and s.consumed == 0 and s.closedCalls == 1 and safety)
  run changedNoticeAfterConsumeIsReportedTest = init.then(open(true)).then(chooseCompose).then(recheckSettles(true))
    .then(noticeChanged).then(consumeSettles(true))
    .expect(s.consumed == 1 and s.composed == 0 and s.report == "not-kept" and safety)
  run unreviewableNoticeIsRefusedTest = init.then(open(false))
    .expect(s.phase == "refused" and s.report == "unavailable" and s.closedCalls == 0 and safety)
}
