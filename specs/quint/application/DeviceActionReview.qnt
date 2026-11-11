/// Actual DeviceActionCoordinator approval custody, with one opaque proposal/effect.
/// Transport, durable journal and executor are observed ports, not simulated providers.
module DeviceActionReview {
  type State = {card: bool, busy: bool, journal: str, identity: bool,
    current: bool, sensitive: bool, expired: bool, aborted: bool,
    askBefore: bool, bound: bool, eligible: bool, authority: str,
    decisions: int, claims: int, dispatches: int, receipts: int,
    status: str, returned: str, synced: bool, admitted: bool}
  var s: State
  action init = s' = {card: false, busy: false, journal: "empty", identity: true,
    current: true, sensitive: false, expired: false, aborted: false,
    askBefore: false, bound: true, eligible: true, authority: "none",
    decisions: 0, claims: 0, dispatches: 0, receipts: 0,
    status: "none", returned: "none", synced: false, admitted: false}
  val valid = s.current and not(s.sensitive or s.expired or s.aborted)
  action configure(askBefore: bool, bound: bool, eligible: bool): bool = all {
    not(s.busy), s' = {...s, askBefore: askBefore, bound: bound, eligible: eligible}}
  action review(visible: bool): bool = all {not(s.busy),
    s' = {...s, card: visible, current: true}}
  action restart = all {not(s.busy), s' = {...s, card: false}}
  action changeContext = all {not(s.busy), s' = {...s, current: false}}
  action sensitive = all {not(s.busy), s' = {...s, sensitive: true, current: false}}
  action expire = s' = {...s, expired: true}
  action abort = s' = {...s, aborted: true}
  action begin(direct: bool): bool = all {
    s.card, not(s.busy), valid,
    not(direct) or (not(s.askBefore) and s.bound and s.eligible),
    s' = {...s, card: false, busy: true, returned: "none", synced: false,
      authority: if (direct) "request" else "review"}}
  action refused = all {not(s.card) or s.busy or not(valid), s' = s}
  action directRefused = all {
    s.askBefore or not(s.bound and s.eligible) or s.aborted, s' = s}
  action reserve(exact: bool): bool = all {s.busy, s.journal == "empty",
    s' = {...s, journal: "reserved", identity: exact}}
  action existing = all {s.busy, s.journal.in(Set("applying", "terminal")), s' = s}
  action decide = all {s.busy, s.journal == "reserved", s.identity, valid,
    s.decisions < 2, s' = {...s, decisions: s.decisions + 1}}
  action claim = all {s.busy, s.journal == "reserved", s.decisions > s.claims, valid,
    s' = {...s, claims: s.claims + 1}}
  action applying = all {s.busy, s.journal == "reserved", s.claims > 0, valid,
    s' = {...s, journal: "applying"}}
  action dispatch = all {s.busy, s.journal == "applying", s.identity, valid,
    s.dispatches == 0, s.authority.in(Set("review", "request")),
    s' = {...s, dispatches: 1, admitted: valid and
      (s.authority == "review" or (s.authority == "request" and not(s.askBefore) and s.bound and s.eligible))}}
  action settle(outcome: str): bool = all {
    s.busy, s.journal == "applying", outcome.in(Set("succeeded", "failed", "unknown")),
    (s.dispatches == 0) implies outcome == "failed",
    s' = {...s, journal: "terminal", status: outcome}}
  action upload = all {s.busy, s.journal == "terminal", s.receipts < 2,
    s' = {...s, receipts: s.receipts + 1}}
  action finish(synced: bool): bool = all {s.busy, s.journal == "terminal",
    s' = {...s, busy: false, returned: s.status, synced: synced}}
  /// An unclaimed reservation may survive failure; it is not evidence of an effect.
  action abandon = all {s.busy,
    s' = {...s, busy: false, returned: "unknown"}}
  action step = any {
    configure(true, true, true), configure(false, false, true), configure(false, true, false),
    review(true), review(false), restart, changeContext, sensitive, expire, abort,
    begin(true), begin(false), refused, directRefused, reserve(true), reserve(false), existing,
    decide, claim, applying, dispatch, settle("succeeded"), settle("failed"), settle("unknown"),
    upload, finish(true), finish(false), abandon, s' = s}
  val OneEffect = s.dispatches.in(0.to(1))
  val DurableClaimBeforeEffect = s.dispatches == 1 implies
    s.journal.in(Set("applying", "terminal")) and s.decisions > 0 and s.claims > 0 and s.identity
  val AuthorizedEffect = s.dispatches == 1 implies s.admitted and s.authority.in(Set("review", "request"))
  val ConsumedBeforeAwait = s.busy implies not(s.card)
  val ReceiptAfterTerminalJournal = s.receipts > 0 implies s.journal == "terminal"
  val FiniteOutcome = s.status.in(Set("none", "succeeded", "failed", "unknown")) and
    s.returned.in(Set("none", "succeeded", "failed", "unknown"))
  val safety = OneEffect and DurableClaimBeforeEffect and AuthorizedEffect and
    ConsumedBeforeAwait and ReceiptAfterTerminalJournal and FiniteOutcome
  run reviewedEffectTest = init.then(review(true)).then(begin(false)).then(reserve(true))
    .then(decide).then(claim).then(applying).then(dispatch).then(settle("succeeded"))
    .then(upload).then(finish(true)).expect(safety and s.returned == "succeeded")
  run failedUploadDoesNotReplayTest = init.then(review(true)).then(begin(false)).then(reserve(true))
    .then(decide).then(claim).then(applying).then(dispatch).then(settle("succeeded"))
    .then(upload).then(finish(false)).then(review(true)).then(begin(false)).then(existing).then(abandon)
    .expect(safety and s.dispatches == 1 and not(s.synced))
  run abortBeforeEffectTest = init.then(review(true)).then(begin(false)).then(reserve(true))
    .then(decide).then(claim).then(applying).then(abort).then(settle("failed"))
    .then(upload).then(finish(false)).expect(safety and s.dispatches == 0)
  run staleCardTest = init.then(review(true)).then(changeContext).then(refused)
    .expect(safety and s.journal == "empty" and s.dispatches == 0)
  run directRequestTest = init.then(review(true)).then(begin(true)).then(reserve(true))
    .then(decide).then(claim).then(applying).then(dispatch).then(settle("succeeded"))
    .then(upload).then(finish(true)).expect(safety and s.authority == "request")
  run askFirstTest = init.then(configure(true, true, true)).then(review(true)).then(directRefused)
    .expect(safety and s.card and s.dispatches == 0)
  run foreignRequestTest = init.then(configure(false, false, true)).then(review(true)).then(directRefused)
    .expect(safety and s.card and s.dispatches == 0)
  run changedJournalIdentityTest = init.then(review(true)).then(begin(false)).then(reserve(false)).then(abandon)
    .expect(safety and s.dispatches == 0 and s.returned == "unknown")
}
