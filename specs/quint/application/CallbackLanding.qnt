/// Static delegation-return page. Query values are finite validity classes.
module CallbackLanding {
  type Query = {
    stateCount: int, validState: bool, codeCount: int, codePresent: bool,
    codeFits: bool, errorCount: int, errorPresent: bool,
    descriptionCount: int, descriptionPresent: bool, descriptionFits: bool,
    knownKeys: bool
  }
  type Landing = { phase: str, query: Query, urlHasQuery: bool, link: str }
  val validCode: Query = {
    stateCount: 1, validState: true, codeCount: 1, codePresent: true,
    codeFits: true, errorCount: 0, errorPresent: false,
    descriptionCount: 0, descriptionPresent: false, descriptionFits: true,
    knownKeys: true
  }
  pure def accepted(q: Query): bool = q.stateCount == 1 and q.validState
    and q.codeCount <= 1 and q.errorCount <= 1 and q.descriptionCount <= 1
    and (not(q.descriptionPresent) or (q.errorPresent and q.descriptionFits))
    and q.knownKeys and (q.codePresent or q.errorPresent)
    and not(q.codePresent and q.errorPresent)
    and (not(q.codePresent) or q.codeFits)
  var s: Landing
  action init = s' = { phase: "new", query: validCode, urlHasQuery: true, link: "none" }
  action receive(q: Query): bool = all { s.phase == "new", s' = { ...s, query: q, phase: "parsed" } }
  action scrub = all { s.phase == "parsed", s' = { ...s, urlHasQuery: false, phase: "scrubbed" } }
  action validate = all {
    s.phase == "scrubbed",
    s' = { ...s, phase: if (accepted(s.query)) "ready" else "rejected",
      link: if (accepted(s.query)) { if (s.query.codePresent) "code" else "access_denied" } else "none" }
  }
  action followLink = all { s.phase == "ready", s' = { ...s, phase: "handed-off" } }
  action load = all { s.phase == "new", {
    nondet stateCount = 0.to(2).oneOf()
    nondet validState = Set(false, true).oneOf()
    nondet codeCount = 0.to(2).oneOf()
    nondet codePresent = Set(false, true).oneOf()
    nondet codeFits = Set(false, true).oneOf()
    nondet errorCount = 0.to(2).oneOf()
    nondet errorPresent = Set(false, true).oneOf()
    nondet descriptionCount = 0.to(2).oneOf()
    nondet descriptionPresent = Set(false, true).oneOf()
    nondet descriptionFits = Set(false, true).oneOf()
    nondet knownKeys = Set(false, true).oneOf()
    receive({ stateCount: stateCount, validState: validState, codeCount: codeCount,
      codePresent: codePresent, codeFits: codeFits, errorCount: errorCount,
      errorPresent: errorPresent, descriptionCount: descriptionCount,
      descriptionPresent: descriptionPresent, descriptionFits: descriptionFits, knownKeys: knownKeys })
  } }
  action step = any { load, scrub, validate, followLink, s' = s }
  val TypeOK = s.phase.in(Set("new", "parsed", "scrubbed", "ready", "rejected", "handed-off"))
    and s.link.in(Set("none", "code", "access_denied"))
  val QueryRemovedBeforeLink = s.link != "none" implies not(s.urlHasQuery)
  val OnlyValidReturnsExposed = s.link != "none" implies accepted(s.query)
  val InvalidReturnsHaveNoLink = s.phase == "rejected" implies s.link == "none"
  val OutputMatchesAcceptedKind = s.link == "code" implies s.query.codePresent
  val ErrorDetailsNotForwarded = s.link == "access_denied" implies s.query.errorPresent and not(s.query.codePresent)
  val safety = TypeOK and QueryRemovedBeforeLink and OnlyValidReturnsExposed
    and InvalidReturnsHaveNoLink and OutputMatchesAcceptedKind and ErrorDetailsNotForwarded
  run validCodeTest = init.then(receive(validCode)).then(scrub).then(validate)
    .expect(s.link == "code" and safety).then(followLink).expect(safety)
  run errorReturnTest = init.then(receive({ ...validCode, codeCount: 0, codePresent: false,
    errorCount: 1, errorPresent: true, descriptionCount: 1, descriptionPresent: true }))
    .then(scrub).then(validate).expect(s.link == "access_denied" and safety)
  run duplicateStateTest = init.then(receive({ ...validCode, stateCount: 2 }))
    .then(scrub).then(validate).expect(s.phase == "rejected" and not(s.urlHasQuery) and safety)
  run wrongStateShapeTest = init.then(receive({ ...validCode, validState: false }))
    .then(scrub).then(validate).expect(s.phase == "rejected" and safety)
  run conflictingResultsTest = init.then(receive({ ...validCode, errorCount: 1, errorPresent: true }))
    .then(scrub).then(validate).expect(s.phase == "rejected" and safety)
  run unsolicitedDescriptionTest = init.then(receive({ ...validCode, descriptionCount: 1, descriptionPresent: true }))
    .then(scrub).then(validate).expect(s.phase == "rejected" and safety)
  run oversizedCodeTest = init.then(receive({ ...validCode, codeFits: false }))
    .then(scrub).then(validate).expect(s.phase == "rejected" and safety)
  run unknownParameterTest = init.then(receive({ ...validCode, knownKeys: false }))
    .then(scrub).then(validate).expect(s.phase == "rejected" and safety)
}
