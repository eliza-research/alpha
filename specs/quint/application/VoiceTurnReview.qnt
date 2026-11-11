/// The transcript review of a voice conversation turn (`reviewConversationTurn`) and the review
/// that a reply's phone action then requires (`conversationReviewRequired`). A finished transcript
/// is held until the person sends it, possibly edited, or discards it; nothing is sent before
/// that, and the held review settles once. A reply that needs a phone action reviewed turns the
/// microphone off: voice does not resume that request, it only closes or starts over.
module VoiceTurnReview {
  type State = { voice: bool, current: bool, review: str, text: str, outcome: str, sentText: str, settles: int,
    sends: int, reviewRequired: bool, phase: str, restarts: int }
  var s: State
  // cleanup(): the surface closes; a held review is dropped and its turn is aborted.
  pure def closed(st: State): State = { ...st, voice: false, phase: "idle",
    review: "none", outcome: if (st.review == "held") "aborted" else st.outcome,
    settles: if (st.review == "held") st.settles + 1 else st.settles }

  action init = s' = { voice: false, current: true, review: "none", text: "", outcome: "none", sentText: "", settles: 0,
    sends: 0, reviewRequired: false, phase: "idle", restarts: 0 }
  // beginConversation(): an earlier review requirement belongs to an earlier request.
  action start = all { not(s.voice), s.current, s.restarts < 3,
    s' = { ...s, voice: true, phase: "listening", reviewRequired: false, review: "none", text: "", outcome: "none",
      sentText: "", settles: 0, restarts: s.restarts + 1 } }
  // A transcript is ready and reviewed turns are on: it is shown, editable, and not sent.
  action transcriptReady = all { s.voice, s.phase == "listening", s.review == "none",
    s' = { ...s, review: "held", text: "spoken", outcome: "none", sentText: "", settles: 0, phase: "review" } }
  action edit(text: str): bool = all { s.review == "held", s.current, s' = { ...s, text: text } }
  // Send: only non-empty text from the review the panel was drawn for, while the chat is current.
  action sendReviewed = all { s.review == "held", s.current, s.text != "",
    s' = { ...s, review: "none", outcome: "sent", sentText: s.text, settles: s.settles + 1, sends: s.sends + 1, phase: "thinking" } }
  // Discard ends the conversation; the transcript is never sent.
  action discard = all { s.review == "held", s.current,
    s' = { ...closed({ ...s, review: "none" }), outcome: "discarded", settles: s.settles + 1 } }
  // The turn's signal aborts (a stop, an account change): the review is withdrawn.
  action turnAborted = all { s.review == "held",
    s' = { ...s, review: "none", outcome: "aborted", settles: s.settles + 1, phase: "listening" } }
  action currencyLost = all { s.current, s' = { ...s, current: false } }
  action currencyBack = all { not(s.current), s' = { ...s, current: true } }
  // The reply to a sent turn. A phone action awaiting review that is not an owner-input pause
  // stops the microphone for this request.
  action replyArrives(reviewRequired: bool, awaitingInput: bool, failed: bool): bool = all { s.voice, s.phase == "thinking",
    s' = { ...s, reviewRequired: reviewRequired and not(awaitingInput),
      phase: if (failed) "error" else if (awaitingInput) "awaiting-user-input" else if (reviewRequired) "idle" else "listening" } }
  // The panel's primary control: a stopped or failed conversation starts over unless a phone
  // action is waiting for review; then, and in every other phase, it closes voice.
  action recover = all { s.voice, s.current, s.review == "none", s.restarts < 3,
    s' = if ((s.phase == "error" and not(s.reviewRequired)) or s.phase == "idle")
        { ...s, phase: "listening", reviewRequired: false, outcome: "none", sentText: "", settles: 0, restarts: s.restarts + 1 }
      else closed(s) }
  action close = all { s.voice, s' = closed(s) }
  action step = {
    nondet text = Set("", "spoken", "edited").oneOf()
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    any { start, transcriptReady, edit(text), sendReviewed, discard, turnAborted, currencyLost, currencyBack,
      replyArrives(a, b, c), recover, close, s' = s }
  }

  val NothingSentWithoutSend = (s.outcome == "sent") == (s.sentText != "")
  val EmptyTextIsNeverSent = s.outcome == "sent" implies s.sentText.in(Set("spoken", "edited"))
  val ReviewSettlesOnce = s.settles <= 1 and (s.review == "held" implies s.settles == 0)
  val HeldReviewNeedsVoice = s.review == "held" implies (s.voice and s.phase == "review" and s.outcome == "none")
  val DiscardClosesVoice = s.outcome == "discarded" implies not(s.voice)
  val ReviewRequiredStopsListening = (s.reviewRequired and s.voice) implies s.phase.in(Set("idle", "error"))
  val ClosedVoiceHoldsNothing = not(s.voice) implies (s.review == "none" and s.phase == "idle")
  val SendsNeedReviews = s.sends <= 3 * s.restarts
  val safety = NothingSentWithoutSend and EmptyTextIsNeverSent and ReviewSettlesOnce and HeldReviewNeedsVoice and
    DiscardClosesVoice and ReviewRequiredStopsListening and ClosedVoiceHoldsNothing and SendsNeedReviews

  val EditedTextSentWitness = s.outcome == "sent" and s.sentText == "edited"
  val DiscardedWitness = s.outcome == "discarded" and s.sends == 0
  val ReviewRequiredClosesWitness = s.reviewRequired and not(s.voice) and s.sends == 1
  val AbortedReviewWitness = s.outcome == "aborted" and s.voice

  run reviewedTurnIsSentAsEditedTest = init.then(start).then(transcriptReady)
    .expect(s.review == "held" and s.sends == 0 and s.phase == "review" and safety)
    .then(edit("edited")).then(sendReviewed)
    .expect(s.outcome == "sent" and s.sentText == "edited" and s.sends == 1 and s.settles == 1 and safety)
  run emptyReviewCannotBeSentTest = init.then(start).then(transcriptReady).then(edit(""))
    .expect(s.review == "held" and s.text == "" and safety)
    .then(edit("spoken")).then(sendReviewed).expect(s.sentText == "spoken" and safety)
  run discardEndsConversationTest = init.then(start).then(transcriptReady).then(discard)
    .expect(not(s.voice) and s.outcome == "discarded" and s.sends == 0 and s.settles == 1 and safety)
  run closingDropsHeldReviewTest = init.then(start).then(transcriptReady).then(close)
    .expect(not(s.voice) and s.review == "none" and s.outcome == "aborted" and s.sends == 0 and safety)
  // The reply needs a phone action reviewed: the panel's control closes voice instead of
  // listening again for that request.
  run reviewRequiredDoesNotResumeTest = init.then(start).then(transcriptReady).then(sendReviewed)
    .then(replyArrives(true, false, true)).expect(s.reviewRequired and s.phase == "error" and safety)
    .then(recover).expect(not(s.voice) and s.restarts == 1 and safety)
  run failedReplyStartsOverTest = init.then(start).then(transcriptReady).then(sendReviewed)
    .then(replyArrives(false, false, true)).then(recover)
    .expect(s.voice and s.phase == "listening" and s.restarts == 2 and not(s.reviewRequired) and safety)
  run ownerInputPauseIsNotAReviewRequirementTest = init.then(start).then(transcriptReady).then(sendReviewed)
    .then(replyArrives(true, true, false))
    .expect(not(s.reviewRequired) and s.phase == "awaiting-user-input" and safety)
}
