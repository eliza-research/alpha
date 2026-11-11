/// The web build's read-aloud review: the excerpt dialog, the public page text that may fill it,
/// the sensitive-text refusal, and one local speech at a time fenced by a generation.
module WebReadingReview {
  pure val MaxGeneration = 6
  type State = {
    open: bool,
    // Reading is refused for this review; it never becomes available again.
    blocked: bool,
    // The page text has not arrived yet, and whether its request can still report.
    sourcePending: bool, sourceLive: bool,
    edited: bool,
    // What the excerpt field holds: "empty", "page", "user" or "sensitive".
    text: str,
    // Moves with every start and stop of speech; a speech applies its end only at its own value.
    generation: int, speaking: bool,
    // Speech requests that have not reported their end.
    unsettled: Set[int],
    // What the user last typed: "none", "user" or "sensitive".
    typed: str
  }
  var s: State
  action initFor(sensitiveAddress: bool): bool = s' = { open: true, blocked: sensitiveAddress,
    sourcePending: true, sourceLive: true, edited: false, text: "empty", generation: 0, speaking: false,
    unsettled: Set(), typed: "none" }
  action init = {
    nondet sensitiveAddress = Set(false, true).oneOf()
    initFor(sensitiveAddress)
  }
  pure def refused(t: State): State = { ...t, blocked: true, text: "empty", typed: "none" }
  pure def silenced(t: State): State = { ...t, generation: t.generation + 1, speaking: false }
  // The field is disabled while blocked and while speech runs.
  action typeText(sensitive: bool): bool = all {
    s.open, not(s.blocked), not(s.speaking),
    s' = { ...s, edited: true, text: if (sensitive) "sensitive" else "user",
      typed: if (sensitive) "sensitive" else "user" }
  }
  // The page text arrives: "text", "none" (not readable from here), "blocked" (looks sensitive)
  // or "failed". A page that changed meanwhile, like a failure, refuses reading. Text the user
  // already typed is kept.
  action sourceSettles(result: str, current: bool): bool = all {
    s.open, s.sourceLive, s.sourcePending, result.in(Set("text", "none", "blocked", "failed")),
    s' = if (not(current) or result.in(Set("blocked", "failed"))) refused({ ...s, sourcePending: false, sourceLive: false })
      else if (s.blocked) { ...s, sourcePending: false, sourceLive: false }
      else { ...s, sourcePending: false, sourceLive: false,
        text: if (result == "text" and not(s.edited)) "page" else s.text }
  }
  // Read is offered only after the page text settled. The page must still be the reviewed one;
  // an empty excerpt reads nothing and a sensitive one refuses the review.
  action read(current: bool): bool = all {
    s.open, not(s.blocked), not(s.sourcePending), not(s.speaking), s.generation < MaxGeneration,
    s' = if (not(current)) { ...silenced(s), open: false, sourceLive: false }
      else if (s.text == "empty") { ...s, edited: true }
      else if (s.text == "sensitive") refused({ ...s, edited: true })
      else { ...s, edited: true, generation: s.generation + 1, speaking: true,
        unsettled: s.unsettled.union(Set(s.generation + 1)) }
  }
  action stop = all { s.open, s.speaking, s.generation < MaxGeneration, s' = silenced(s) }
  // A speech ends (finished, failed, or its page stopped being current). Only the speech that is
  // still the current one changes the dialog.
  action speechSettles(id: int): bool = all {
    s.unsettled.contains(id),
    s' = if (s.open and id == s.generation and s.generation < MaxGeneration)
        { ...silenced(s), unsettled: s.unsettled.exclude(Set(id)) }
      else { ...s, unsettled: s.unsettled.exclude(Set(id)) }
  }
  // Close, Back, Escape, hiding the app, leaving the page or the owner cancelling.
  action finish = all { s.open, s.generation < MaxGeneration,
    s' = { ...silenced(s), open: false, sourceLive: false } }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet result = Set("text", "none", "blocked", "failed").oneOf()
    nondet id = 1.to(MaxGeneration).oneOf()
    any { typeText(flag), sourceSettles(result, flag), read(flag), stop, speechSettles(id), finish, s' = s }
  }
  val SpeechNeedsOpenReview = s.speaking implies (s.open and not(s.blocked) and s.unsettled.contains(s.generation))
  val ReadWaitsForSource = s.speaking implies not(s.sourcePending)
  val SensitiveNeverSpoken = s.speaking implies s.text.in(Set("page", "user"))
  val BlockedHoldsNoText = s.blocked implies (s.text == "empty" and not(s.speaking))
  val ClosedIsInert = not(s.open) implies not(s.speaking or s.sourceLive)
  val TypedTextKept = (s.typed != "none" implies s.text == s.typed) and (s.text == "page" implies not(s.sourcePending))
  val OnlyCurrentSpeechEnds = s.unsettled.forall(id => id <= s.generation) and
    (not(s.speaking) implies not(s.unsettled.contains(s.generation)) or not(s.open))
  val TypeOK = s.text.in(Set("empty", "page", "user", "sensitive")) and s.generation.in(0.to(MaxGeneration)) and
    s.unsettled.subseteq(1.to(MaxGeneration)) and
    s.typed.in(Set("none", "user", "sensitive"))
  val safety = TypeOK and SpeechNeedsOpenReview and ReadWaitsForSource and SensitiveNeverSpoken and
    BlockedHoldsNoText and ClosedIsInert and TypedTextKept and OnlyCurrentSpeechEnds
  val EarlierSpeechUnsettledWitness = s.speaking and s.unsettled.size() > 1
  // A page that stopped being current while its text was fetched leaves the review open and refused.
  val RefusedOpenReviewWitness = s.open and s.blocked and s.edited
  val UserTextSpokenWitness = s.speaking and s.text == "user"
  // A stopped speech that ends late must not stop the speech started after it.
  run staleSpeechEndTest = initFor(false).then(sourceSettles("text", true)).then(read(true))
    .expect(s.speaking and s.generation == 1).then(stop).then(read(true))
    .expect(s.speaking and s.generation == 3 and s.unsettled == Set(1, 3)).then(speechSettles(1))
    .expect(s.speaking and s.generation == 3 and safety).then(speechSettles(3))
    .expect(not(s.speaking) and s.unsettled.size() == 0 and safety)
  run sensitiveExcerptRefusedTest = initFor(false).then(sourceSettles("none", true)).then(typeText(true))
    .then(read(true)).expect(s.blocked and s.text == "empty" and not(s.speaking) and safety)
    .then(read(true)).fail()
  run typedTextKeptTest = initFor(false).then(typeText(false)).then(sourceSettles("text", true))
    .expect(s.text == "user" and not(s.sourcePending)).then(read(true))
    .expect(s.speaking and s.text == "user" and safety)
  run readWaitsForSourceTest = initFor(false).then(typeText(false)).then(read(true)).fail()
  run changedPageClosesReviewTest = initFor(false).then(sourceSettles("text", true)).then(read(false))
    .expect(not(s.open) and not(s.speaking) and safety)
  run closeStopsSpeechTest = initFor(false).then(sourceSettles("text", true)).then(read(true)).then(finish)
    .expect(not(s.open) and not(s.speaking)).then(speechSettles(1))
    .expect(not(s.speaking) and s.generation == 2 and safety)
  run sensitiveAddressTest = initFor(true).then(sourceSettles("text", true))
    .expect(s.blocked and s.text == "empty" and safety).then(typeText(false)).fail()
}
