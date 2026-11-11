/// What the address bar does with a submission: the shared parser's verdict, the product's
/// corrections to it, and the one outcome of every submission (open, search or refuse).
module AddressInput {
  // The properties of the trimmed text that the decision looks at.
  type Input = {
    tooLong: bool,
    // The shared parser's reading: "url", "search" or "rejected", and why it rejected.
    verdict: str, reason: str,
    // digits:digits (10:30), which the parser reads as host:port.
    timeLike: bool,
    // Begins with http: or https:.
    webScheme: bool,
    // The NFKC-normalized text contains an @.
    hasAt: bool,
    // Exactly one @ in normalized text, with no URL delimiters, percent escapes, or controls.
    simpleAtSearch: bool,
    // One to three groups of digits separated by dots (3.14).
    shortDecimal: bool,
    // The parsed address has no host.
    hostEmpty: bool,
    // A bare localhost, with an optional path.
    localhostAlias: bool
  }
  type State = { input: Input, approved: bool, outcome: str, corrected: bool }
  var s: State
  pure val word: Input = { tooLong: false, verdict: "search", reason: "none", timeLike: false,
    webScheme: false, hasAt: false, simpleAtSearch: false, shortDecimal: false, hostEmpty: false,
    localhostAlias: false }
  // Combinations of properties that one text can have.
  pure def possible(i: Input): bool = and {
    i.verdict.in(Set("url", "search", "rejected")),
    i.reason.in(Set("none", "unsupported-protocol", "credentials", "other")),
    (i.verdict == "rejected") iff (i.reason != "none"),
    i.timeLike implies (i.verdict == "url" and not(i.webScheme or i.simpleAtSearch or i.shortDecimal)),
    i.simpleAtSearch implies (i.hasAt and not(i.webScheme)),
    i.shortDecimal implies not(i.hasAt or i.webScheme),
    i.hostEmpty implies i.verdict == "url",
    i.localhostAlias implies (i.verdict == "search" and not(i.simpleAtSearch or i.webScheme))
  }
  // Typed text that only looks like an address is searched instead of opened or refused: a
  // word:body that is not a web address, simple @ text and a short decimal. An approved
  // destination is never reread this way.
  pure def typedCorrection(i: Input, approved: bool): bool =
    not(approved) and not(i.webScheme) and
      (if (i.verdict == "rejected")
        (i.reason == "unsupported-protocol" and not(i.hasAt)) or (i.reason == "credentials" and i.simpleAtSearch)
      else i.verdict == "url" and not(i.timeLike) and i.shortDecimal)
  pure def kind(i: Input, approved: bool): str =
    if (i.tooLong) "rejected"
    else if (i.verdict == "url" and i.timeLike) "search"
    else if (typedCorrection(i, approved)) "search"
    else i.verdict
  // A typed refusal shows a message; a refused approved destination fails its request.
  pure def result(i: Input, approved: bool): str = {
    val k = kind(i, approved)
    val refuseSearch = k == "search" and (approved or (i.hasAt and not(i.simpleAtSearch)))
    if (k == "rejected" or (k == "url" and i.hostEmpty) or refuseSearch)
      (if (approved) "throw" else "toast")
    else if (k == "url" or i.localhostAlias) "open"
    else "search"
  }
  action init = s' = { input: word, approved: false, outcome: "none", corrected: false }
  action submit(i: Input, approved: bool): bool = all {
    possible(i),
    s' = { input: i, approved: approved, outcome: result(i, approved),
      corrected: not(i.tooLong) and kind(i, approved) != i.verdict }
  }
  action step = {
    nondet tooLong = Set(false, true).oneOf()
    nondet verdict = Set("url", "search", "rejected").oneOf()
    nondet reason = Set("none", "unsupported-protocol", "credentials", "other").oneOf()
    nondet timeLike = Set(false, true).oneOf()
    nondet webScheme = Set(false, true).oneOf()
    nondet hasAt = Set(false, true).oneOf()
    nondet simpleAtSearch = Set(false, true).oneOf()
    nondet shortDecimal = Set(false, true).oneOf()
    nondet hostEmpty = Set(false, true).oneOf()
    nondet localhostAlias = Set(false, true).oneOf()
    nondet approved = Set(false, true).oneOf()
    any {
      submit({ tooLong: tooLong, verdict: verdict, reason: reason, timeLike: timeLike, webScheme: webScheme,
        hasAt: hasAt, simpleAtSearch: simpleAtSearch, shortDecimal: shortDecimal, hostEmpty: hostEmpty,
        localhostAlias: localhostAlias }, approved),
      s' = s
    }
  }
  val submitted = s.outcome != "none"
  val ExactlyOneOutcome = s.outcome.in(Set("none", "open", "search", "toast", "throw"))
  val RefusalMatchesCaller = (s.outcome == "throw" implies s.approved) and (s.outcome == "toast" implies not(s.approved))
  val TooLongRefused = (submitted and s.input.tooLong) implies s.outcome.in(Set("toast", "throw"))
  val OpenedHasHost = s.outcome == "open" implies
    ((s.input.verdict == "url" and not(s.input.hostEmpty) and not(s.input.timeLike)) or s.input.localhostAlias)
  // Text that may carry credentials is never sent to the search provider.
  val CredentialsNeverSearched = (s.input.reason == "credentials" and not(s.input.simpleAtSearch)) implies
    s.outcome != "search"
  val ExplicitAddressNeverSearched = (s.input.webScheme and s.input.verdict != "search") implies s.outcome != "search"
  val TimeNeverOpens = s.input.timeLike implies s.outcome != "open"
  val ApprovedNotReread = (s.approved and s.corrected) implies s.input.timeLike
  val UnsafeAtNeverSearched = (s.input.hasAt and not(s.input.simpleAtSearch)) implies s.outcome != "search"
  val ApprovedSearchRefused = (submitted and s.approved and kind(s.input, true) == "search") implies s.outcome == "throw"
  val safety = ExactlyOneOutcome and RefusalMatchesCaller and TooLongRefused and OpenedHasHost and
    CredentialsNeverSearched and ExplicitAddressNeverSearched and TimeNeverOpens and ApprovedNotReread and
    UnsafeAtNeverSearched and ApprovedSearchRefused
  val SchemeLikeWordSearchedWitness = s.outcome == "search" and s.input.reason == "unsupported-protocol"
  val SimpleAtSearchedWitness = s.outcome == "search" and s.input.simpleAtSearch and s.input.reason == "credentials"
  val DecimalSearchedWitness = s.outcome == "search" and s.input.shortDecimal and s.input.verdict == "url"
  val ApprovedRefusedWitness = s.outcome == "throw" and s.input.verdict == "search" and not(s.input.tooLong)
  // "site:example.com cats", "define:x", "user@example.com", "3.14" and "10:30" are searches.
  run colonQueriesSearchTest = init
    .then(submit({ ...word, verdict: "rejected", reason: "unsupported-protocol" }, false))
    .expect(s.outcome == "search" and s.corrected)
    .then(submit({ ...word, verdict: "rejected", reason: "credentials", hasAt: true, simpleAtSearch: true }, false))
    .expect(s.outcome == "search")
    .then(submit({ ...word, verdict: "url", shortDecimal: true }, false)).expect(s.outcome == "search")
    .then(submit({ ...word, verdict: "url", timeLike: true }, false)).expect(s.outcome == "search" and safety)
  run hostOpensTest = init.then(submit({ ...word, verdict: "url" }, false))
    .expect(s.outcome == "open" and not(s.corrected) and safety)
    .then(submit({ ...word, localhostAlias: true }, false)).expect(s.outcome == "open" and safety)
  run credentialsRefusedTest = init
    .then(submit({ ...word, verdict: "rejected", reason: "credentials", hasAt: true }, false))
    .expect(s.outcome == "toast")
    .then(submit({ ...word, verdict: "rejected", reason: "credentials", hasAt: true, webScheme: true }, false))
    .expect(s.outcome == "toast")
    .then(submit({ ...word, verdict: "rejected", reason: "unsupported-protocol", hasAt: true }, false))
    .expect(s.outcome == "toast")
    .then(submit({ ...word, hasAt: true }, false))
    .expect(s.outcome == "toast")
    .then(submit({ ...word, hasAt: true, localhostAlias: true }, false))
    .expect(s.outcome == "toast" and safety)
  run approvedDestinationTest = init.then(submit({ ...word, verdict: "url", webScheme: true }, true))
    .expect(s.outcome == "open")
    .then(submit({ ...word, verdict: "rejected", reason: "unsupported-protocol" }, true))
    .expect(s.outcome == "throw" and not(s.corrected))
    .then(submit(word, true)).expect(s.outcome == "throw")
    .then(submit({ ...word, localhostAlias: true }, true)).expect(s.outcome == "throw")
    .then(submit({ ...word, verdict: "url", timeLike: true }, true)).expect(s.outcome == "throw" and s.corrected and safety)
  run malformedRefusedTest = init.then(submit({ ...word, tooLong: true, verdict: "url" }, false))
    .expect(s.outcome == "toast")
    .then(submit({ ...word, verdict: "url", hostEmpty: true }, false)).expect(s.outcome == "toast" and safety)
  run impossibleTextTest = init.then(submit({ ...word, verdict: "search", reason: "credentials" }, false)).fail()
}
