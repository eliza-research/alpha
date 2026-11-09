module ObservationTurnDispatch {
  type State = {
    format: str, hasPeer: bool, offered: bool, currentConnection: bool, cancelled: bool,
    phase: str, background: str, statusReads: int, admitted: bool,
    posts: int, wireDay: int, ordinaryIntact: bool, wireText: str, wireFormat: str,
    beforeDispatch: bool,
  }
  var s: State

  pure val formats = Set("plain", "legacy-product", "legacy-mock")
  pure val learnResponses = Set("current", "unlisted", "legacy", "invalid", "unavailable")
  pure val compareResponses = learnResponses.union(Set("different"))
  val pendingStatus = s.phase == "learning" or s.phase == "comparing"
  val live = s.currentConnection and not(s.cancelled)
  val backgroundObservation = if (Set("supported", "unsupported").contains(s.background))
    "resolved" else s.background

  action setup(format: str, hasPeer: bool, offered: bool): bool = all {
    formats.contains(format),
    s' = {
      format: format, hasPeer: hasPeer, offered: offered, currentConnection: true, cancelled: false,
      phase: "idle", background: "none", statusReads: 0, admitted: false, posts: 0, wireDay: 0,
      ordinaryIntact: false, wireText: "none", wireFormat: "none", beforeDispatch: false,
    },
  }

  action init = {
    nondet format = formats.oneOf()
    nondet hasPeer = Bool.oneOf()
    nondet offered = Bool.oneOf()
    setup(format, hasPeer, offered)
  }

  action beginHandshake = all {
    s.hasPeer, s.phase == "idle", s.background == "none",
    s' = {...s, background: "pending", statusReads: 1},
  }

  action beginTurn = all {
    s.phase == "idle",
    val negotiate = s.format == "plain" and s.hasPeer and s.offered
    val compare = negotiate and s.background == "supported"
    val learn = negotiate and s.background == "none"
    val nextPhase = if (not(negotiate) or s.background == "unsupported") "waiting"
      else if (compare) "comparing" else "learning"
    s' = {...s, phase: nextPhase, statusReads: s.statusReads + (if (learn or compare) 1 else 0)},
  }

  action finishLearn(response: str): bool = all {
    s.phase == "learning" or s.background == "pending", learnResponses.contains(response),
    val support = response == "current"
    val compare = support and s.phase == "learning"
    val nextPhase = if (s.phase != "learning") s.phase else if (compare) "comparing" else "waiting"
    s' = {...s, phase: nextPhase, statusReads: s.statusReads + (if (compare) 1 else 0),
      background: if (s.background != "pending") s.background
        else if (support) "supported" else "unsupported"},
  }

  action finishComparison(response: str): bool = all {
    s.phase == "comparing", compareResponses.contains(response),
    s' = {...s, phase: "waiting", admitted: response == "current"},
  }

  action cancelTurn = all {
    live, pendingStatus or s.phase == "waiting",
    s' = {...s, cancelled: true, phase: if (pendingStatus) "aborted" else s.phase,
      beforeDispatch: pendingStatus},
  }

  action replaceConnection = all {
    live, pendingStatus or s.phase == "waiting",
    s' = {...s, currentConnection: false, phase: if (pendingStatus) "aborted" else s.phase,
      background: if (s.background == "pending") "aborted" else s.background,
      beforeDispatch: pendingStatus},
  }

  action ignoreLateStatus = all {
    s.phase == "aborted", s.statusReads > 0, s.background != "pending", s' = s,
  }

  action releaseView = all {
    s.phase == "waiting",
    s' = if (live) {...s, phase: "posted", posts: 1, wireDay: if (s.admitted) 1 else 0,
      ordinaryIntact: true, wireText: if (s.format == "legacy-mock") "envelope" else "authored",
      wireFormat: if (s.format == "plain") "plain-v1" else "legacy"}
    else {...s, phase: "aborted", beforeDispatch: true},
  }

  action step = any {
    beginHandshake, beginTurn, cancelTurn, replaceConnection, ignoreLateStatus, releaseView,
    { nondet response = learnResponses.oneOf(); finishLearn(response) },
    { nondet response = compareResponses.oneOf(); finishComparison(response) },
    s' = s,
  }

  val OptionalRequiresFreshMatchingSession = s.wireDay == 1 implies
    (s.admitted and s.offered and s.hasPeer and s.statusReads == 2 and s.wireFormat == "plain-v1" and live)
  val ExactOrdinaryPayload = s.posts > 0 implies
    (s.posts == 1 and s.ordinaryIntact and s.wireDay == (if (s.admitted) 1 else 0)
      and (s.wireText == "authored") == (s.format != "legacy-mock"))
  val AbortBeforeAnyPost = s.phase == "aborted" implies (s.posts == 0 and s.beforeDispatch)
  val safety = OptionalRequiresFreshMatchingSession and ExactOrdinaryPayload and AbortBeforeAnyPost

  run ExactSupportAddsOneMetadataFieldTest = setup("plain", true, true).then(beginTurn)
    .then(finishLearn("current")).then(finishComparison("current")).then(releaseView)
    .expect(s.posts == 1 and s.wireDay == 1 and s.wireText == "authored" and safety)

  run ReplacementProcessKeepsOrdinaryPlainTurnTest = setup("plain", true, true).then(beginTurn)
    .then(finishLearn("current")).then(finishComparison("different")).then(releaseView)
    .expect(s.posts == 1 and s.wireDay == 0 and s.wireFormat == "plain-v1" and safety)

  run LegacyProductBypassesObservationSessionTest = setup("legacy-product", true, true)
    .then(beginTurn).then(releaseView)
    .expect(s.posts == 1 and s.statusReads == 0 and s.wireDay == 0 and s.wireText == "authored" and safety)

  run LegacyMockEnvelopeNeverContainsOptionalDayTest = setup("legacy-mock", true, true)
    .then(beginTurn).then(releaseView)
    .expect(s.posts == 1 and s.statusReads == 0 and s.wireDay == 0 and s.wireText == "envelope" and safety)

  run ReplacementAfterAdmissionStillFencesPostTest = setup("plain", true, true).then(beginTurn)
    .then(finishLearn("current")).then(finishComparison("current")).then(replaceConnection).then(releaseView)
    .expect(s.phase == "aborted" and s.posts == 0 and safety)

  run CallerStopDuringComparisonRefusesBeforeDispatchTest = setup("plain", true, true).then(beginTurn)
    .then(finishLearn("current")).then(cancelTurn)
    .expect(s.phase == "aborted" and s.beforeDispatch and safety)

  run ActivationAndTurnShareOneStatusBeforeFreshComparisonTest = setup("plain", true, true)
    .then(beginHandshake).then(beginTurn).then(finishLearn("current")).then(finishComparison("current")).then(releaseView)
    .expect(s.posts == 1 and s.wireDay == 1 and s.statusReads == 2 and backgroundObservation == "resolved" and safety)
}
