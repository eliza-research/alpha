module RuntimeUpdatePause {
  type Record = {id: int, session: int, boot: int, baselineCode: int, baselineDigest: str,
    targetCode: int, targetDigest: str, signer: str, committing: bool}
  type Evidence = {session: str, zero: bool, boot: int, sdk: int, releaseBuild: bool,
    installedCode: int, installedDigest: str, signer: str, confirmed: bool}
  type State = {file: str, record: Record, staged: bool, syncDenied: bool, generation: int,
    executingCode: int, executingDigest: str, liveOwner: int, shutdown: bool, stops: int,
    releases: int, evidence: Evidence, outcome: str}

  pure val none: Record = {id: 0, session: 0, boot: 0, baselineCode: 0, baselineDigest: "none",
    targetCode: 0, targetDigest: "none", signer: "none", committing: false}
  pure val defaults: Evidence = {session: "absent", zero: true, boot: 1, sdk: 37, releaseBuild: true,
    installedCode: 7, installedDigest: "base", signer: "trusted", confirmed: true}
  pure val records = Set(1, 2)
  pure val sessions = Set("absent", "bound", "foreign", "sealed", "unavailable")
  pure val digests = Set("base", "target", "other")
  pure val versions = Set(7, 8)
  pure val apis = Set(29, 30, 31, 32, 33, 37, 38)
  pure val outcomes = Set("configured", "acquired", "committing", "held", "released",
    "read-error", "sync-error", "stopped", "stop-interrupted")
  pure val evidenceCases = Set(defaults, {...defaults, session: "bound", zero: false},
    {...defaults, session: "bound", sdk: 31}, {...defaults, session: "bound", sdk: 32},
    {...defaults, session: "bound", sdk: 33}, {...defaults, session: "bound", sdk: 38},
    {...defaults, session: "bound", sdk: 30, releaseBuild: false},
    {...defaults, session: "bound", zero: false, boot: 2},
    {...defaults, session: "foreign"}, {...defaults, session: "sealed"},
    {...defaults, session: "unavailable"}, {...defaults, session: "bound", boot: -1},
    {...defaults, installedCode: 8, installedDigest: "target"}, {...defaults, installedDigest: "other"},
    {...defaults, signer: "other"}, {...defaults, confirmed: false})

  var s: State
  val StartAllowed = s.file.in(Set("missing", "empty"))
  val LeaseRetained = s.shutdown
  pure def supported(e: Evidence): bool = e.session.in(sessions) and e.boot.in(Set(-1, 1, 2))
    and e.sdk.in(apis) and e.installedCode.in(versions) and e.installedDigest.in(digests)
    and e.signer.in(Set("trusted", "other"))
  pure def provenUncommitted(r: Record, e: Evidence): bool = e.session == "bound" and
    (not(r.committing) or r.boot != e.boot or
      (e.releaseBuild and (e.sdk <= 30 or (e.sdk >= 33 and e.sdk <= 37)) and e.zero))
  pure def exactBuild(code: int, digest: str, state: State): bool =
    state.evidence.installedCode == code and state.evidence.installedDigest == digest and
      state.executingCode == code and state.executingDigest == digest
  pure def save(state: State, r: Record, ok: str): State =
    {...state, record: r, file: if (r == none) "empty" else "record", staged: false,
      outcome: if (state.syncDenied) "sync-error" else ok}
  pure def settle(state: State): State = {
    val r = state.record
    val e = state.evidence
    val successor = exactBuild(r.targetCode, r.targetDigest, state)
    val baseline = exactBuild(r.baselineCode, r.baselineDigest, state)
    val ended = e.session == "absent" or provenUncommitted(r, e)
    if (state.file == "corrupt") {...state, outcome: "read-error"}
    else if (r == none or r.id == state.liveOwner) {...state, outcome: "held"}
    else if (e.session == "unavailable" or (e.session != "absent" and e.boot < 0))
      {...state, outcome: "read-error"}
    else if (e.signer != r.signer or (state.shutdown and not(e.confirmed)) or not(successor or (baseline and ended)))
      {...state, outcome: "held"}
    else {
      val saved = save(state, none, "released")
      if (saved.outcome == "sync-error") saved
      else {...saved, shutdown: false, releases: state.releases + (if (state.shutdown) 1 else 0)}
    }
  }

  action init = s' = {file: "missing", record: none, staged: false, syncDenied: false, generation: 1,
    executingCode: 7, executingDigest: "base", liveOwner: 0, shutdown: false, stops: 0, releases: 0,
    evidence: defaults, outcome: "configured"}
  action observe(e: Evidence): bool = all {supported(e), s' = {...s, evidence: e}}
  action interruptStage = all {not(s.staged), s' = {...s, staged: true}}
  action unreadable = all {s.file != "corrupt", s' = {...s, file: "corrupt", record: none}}
  action denySync(denied: bool): bool = s' = {...s, syncDenied: denied}

  action acquire(id: int): bool = all {
    id.in(records), StartAllowed, s.executingCode == 7, s.executingDigest == "base",
    s.evidence.signer == "trusted", s.evidence.boot > 0,
    s' = save({...s, liveOwner: id}, {id: id, session: 41, boot: s.evidence.boot,
      baselineCode: 7, baselineDigest: "base", targetCode: 8, targetDigest: "target",
      signer: "trusted", committing: false}, "acquired")
  }
  action committing(id: int): bool = all {
    s.file == "record", s.record.id == id,
    s' = save(s, {...s.record, committing: true}, "committing")
  }
  action retireOwner = all {s.liveOwner != 0, s' = {...s, liveOwner: 0}}
  action requestStop = all {
    s.file == "record", not(s.shutdown), s.stops < 2,
    s' = {...s, shutdown: true, stops: s.stops + 1,
      outcome: if (s.evidence.confirmed) "stopped" else "stop-interrupted"}
  }
  action reconcile = s' = settle(s)
  action rejectForeignOwner(id: int): bool = all {
    id.in(records), s.file == "record", s.record.id != id,
    s' = {...s, outcome: "held"}
  }
  action reopen(code: int, digest: str, e: Evidence): bool = all {
    s.generation == 1, code.in(versions), digest.in(digests), supported(e),
    val nextProcess = {...s, generation: 2, executingCode: code, executingDigest: digest,
      liveOwner: 0, shutdown: false, stops: 0, releases: 0, evidence: e}
    s' = {...settle(nextProcess), outcome: "configured"}
  }

  val ValidRecordBindsExactUpdate = (s.file == "record") implies
    (s.record.id.in(records) and s.record.session == 41 and s.record.baselineCode == 7
      and s.record.baselineDigest == "base" and s.record.targetCode == 8
      and s.record.targetDigest == "target" and s.record.signer == "trusted")
  val ActiveOrUnreadableRecordFencesStart = s.file.in(Set("record", "corrupt")) implies not(StartAllowed)
  val ReleasedLeasesHadOwnedStops = s.releases.in(0.to(s.stops))
  val safety = ValidRecordBindsExactUpdate and ActiveOrUnreadableRecordFencesStart and ReleasedLeasesHadOwnedStops
    and ((s.file == "record") == (s.record != none)) and s.generation.in(1.to(2))
    and s.stops.in(0.to(2)) and s.liveOwner.in(Set(0, 1, 2)) and s.outcome.in(outcomes)

  action step = any {
    nondet e = evidenceCases.oneOf()
    observe(e),
    interruptStage, unreadable, retireOwner, requestStop, reconcile,
    nondet denied = Set(true, false).oneOf()
    denySync(denied),
    nondet id = records.oneOf()
    any {acquire(id), committing(id), rejectForeignOwner(id)},
    reopen(7, "base", defaults),
    reopen(8, "target", {...defaults, installedCode: 8, installedDigest: "target", session: "sealed"}),
    s' = s
  }

  run pauseBlocksStartsAndRejectsWrongCommitOwnerTest = init.then(acquire(1))
    .expect(safety and not(StartAllowed)).then(committing(2).fail())
  run exactOldBaselineAndEndedSessionReleaseTest = init.then(acquire(1)).then(requestStop)
    .then(reconcile).expect(safety and LeaseRetained and not(StartAllowed))
    .then(retireOwner).then(reconcile).expect(safety and StartAllowed and s.releases == 1)
  run ambiguousOldReleaseRetainsItsServiceLeaseTest = init.then(acquire(1)).then(requestStop)
    .then(retireOwner).then(denySync(true)).then(reconcile)
    .expect(safety and s.outcome == "sync-error" and StartAllowed and LeaseRetained and s.releases == 0)
    .then(denySync(false)).then(reconcile).expect(safety and LeaseRetained and s.outcome == "held")
  run aPendingSessionBlocksAnOldProcessButNotItsExactSuccessorTest = init.then(acquire(1)).then(committing(1))
    .then(retireOwner).then(observe({...defaults, session: "sealed", installedCode: 8, installedDigest: "target"}))
    .then(reconcile).expect(safety and not(StartAllowed))
    .then(reopen(8, "target", {...defaults, session: "sealed", installedCode: 8, installedDigest: "target"}))
    .expect(safety and StartAllowed and s.generation == 2)
  run stagedFileDoesNotOwnAuthorityAndCorruptPrimaryFencesTest = init.then(interruptStage)
    .expect(safety and StartAllowed and s.staged)
    .then(acquire(1)).then(unreadable).then(reconcile)
    .expect(safety and not(StartAllowed) and s.outcome == "read-error")
  run oldApiZeroCannotProveCommittingSessionUncommittedTest = init.then(acquire(1)).then(committing(1))
    .then(retireOwner).then(observe({...defaults, session: "bound", sdk: 31})).then(reconcile)
    .expect(safety and not(StartAllowed))
    .then(observe({...defaults, session: "bound", sdk: 33})).then(reconcile)
    .expect(safety and StartAllowed)
}
