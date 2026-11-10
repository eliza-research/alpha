// Two trusted GitHub run numbers, two attempts and three ordered release-floor classes.
// Calls settle serially; remote inventory and archive admission are explicit inputs.
// A receipt is unsigned build evidence, never a reservation or release authority.
module AppUpdateCandidate {
  type Candidate = {attempt: int, firstAttempt: int, finalAttempt: int,
    firstFloor: int, finalFloor: int, versionWrites: int, receiptWrites: int,
    beforeVersionWrites: int, beforeReceiptWrites: int,
    signed: bool, qualified: bool, outcome: str}
  type State = {floor: int, candidates: int -> Candidate}
  pure val Actors = Set(1, 2)
  pure val Floors = Set(1, 2, 3)
  pure val Codes = Map(1 -> 2, 2 -> 3)
  pure val empty: Candidate = {attempt: 1, firstAttempt: 0, finalAttempt: 0,
    firstFloor: 0, finalFloor: 0, versionWrites: 0, receiptWrites: 0,
    beforeVersionWrites: 0, beforeReceiptWrites: 0,
    signed: false, qualified: false, outcome: "none"}
  var s: State
  action init = s' = {floor: 1, candidates: Map(1 -> empty, 2 -> empty)}

  // Retained stable assets and the release record must not lose their version floor.
  // A later release can make an already-written unsigned receipt stale.
  action advanceFloor(floor: int): bool = all {
    floor.in(Floors), floor > s.floor,
    s' = {...s, floor: floor}
  }
  // A rerun keeps its GitHub run number. Its attempt identity changes.
  action rerun(actor: int): bool = all {
    actor.in(Actors), s.candidates.get(actor).attempt == 1,
    s' = {...s, candidates: s.candidates.set(actor,
      {...s.candidates.get(actor), attempt: 2})}
  }
  action version(actor: int, inventoryAndIdentityValid: bool): bool = {
    val old = s.candidates.get(actor)
    val admitted = inventoryAndIdentityValid and Codes.get(actor) > s.floor
      and old.versionWrites == 0
    all {
      actor.in(Actors),
      s' = {...s, candidates: s.candidates.set(actor, {...old,
        beforeVersionWrites: old.versionWrites, beforeReceiptWrites: old.receiptWrites,
        firstAttempt: if (admitted) old.attempt else old.firstAttempt,
        firstFloor: if (admitted) s.floor else old.firstFloor,
        versionWrites: if (admitted) 1 else old.versionWrites,
        outcome: if (admitted) "version" else "refused"})}
    }
  }
  // finalAdmissionValid covers the independently read inventory, current identity,
  // complete source freeze and exact archive bytes; it is not a model-produced fact.
  action receipt(actor: int, finalAdmissionValid: bool): bool = {
    val old = s.candidates.get(actor)
    val admitted = finalAdmissionValid and Codes.get(actor) > s.floor
      and old.versionWrites == 1 and old.firstAttempt == old.attempt
      and old.receiptWrites == 0
    all {
      actor.in(Actors),
      s' = {...s, candidates: s.candidates.set(actor, {...old,
        beforeVersionWrites: old.versionWrites, beforeReceiptWrites: old.receiptWrites,
        finalAttempt: if (admitted) old.attempt else old.finalAttempt,
        finalFloor: if (admitted) s.floor else old.finalFloor,
        receiptWrites: if (admitted) 1 else old.receiptWrites,
        signed: false, qualified: false,
        outcome: if (admitted) "receipt" else "refused"})}
    }
  }
  action step = any {
    nondet actor = Actors.oneOf()
    nondet valid = Bool.oneOf()
    any {version(actor, valid), receipt(actor, valid), rerun(actor)},
    nondet floor = Floors.oneOf()
    advanceFloor(floor),
    s' = s
  }
  val TypeOK = s.floor.in(Floors) and Actors.forall(actor => {
    val candidate = s.candidates.get(actor)
    candidate.attempt.in(Set(1, 2)) and candidate.firstAttempt.in(Set(0, 1, 2))
      and candidate.finalAttempt.in(Set(0, 1, 2))
      and candidate.firstFloor.in(Set(0, 1, 2, 3))
      and candidate.finalFloor.in(Set(0, 1, 2, 3))
      and candidate.versionWrites.in(Set(0, 1)) and candidate.receiptWrites.in(Set(0, 1))
      and candidate.beforeVersionWrites.in(Set(0, 1)) and candidate.beforeReceiptWrites.in(Set(0, 1))
      and candidate.outcome.in(Set("none", "version", "receipt", "refused"))
  })
  val FirstReadAdmitsAdvancingCode = Actors.forall(actor => {
    val candidate = s.candidates.get(actor)
    candidate.versionWrites == 1 implies (Codes.get(actor) > candidate.firstFloor
      and candidate.firstFloor.in(Floors) and candidate.firstAttempt.in(Set(1, 2)))
  })
  val FinalReadAndAttemptOwnReceipt = Actors.forall(actor => {
    val candidate = s.candidates.get(actor)
    candidate.receiptWrites == 1 implies (candidate.versionWrites == 1
      and Codes.get(actor) > candidate.finalFloor
      and candidate.finalAttempt == candidate.firstAttempt
      and candidate.finalFloor.in(Floors) and candidate.finalAttempt.in(Set(1, 2)))
  })
  val UnsignedEvidenceOnly = Actors.forall(actor => {
    val candidate = s.candidates.get(actor)
    not(candidate.signed) and not(candidate.qualified)
  })
  val RefusalPreservesEvidence = Actors.forall(actor => {
    val candidate = s.candidates.get(actor)
    candidate.outcome == "refused" implies
      (candidate.versionWrites == candidate.beforeVersionWrites
        and candidate.receiptWrites == candidate.beforeReceiptWrites)
  })
  val safety = TypeOK and FirstReadAdmitsAdvancingCode and FinalReadAndAttemptOwnReceipt
    and UnsignedEvidenceOnly and RefusalPreservesEvidence

  run earlierCandidateRefusedAfterReleaseAdvancesTest = init.then(version(1, true))
    .then(advanceFloor(2)).then(receipt(1, true))
    .expect(safety and s.candidates.get(1).versionWrites == 1 and s.candidates.get(1).receiptWrites == 0)
    .then(version(2, true)).then(receipt(2, true))
    .expect(safety and s.candidates.get(2).receiptWrites == 1)
  run attemptChangeCannotReuseEarlierAdmissionTest = init.then(version(1, true))
    .then(rerun(1)).then(receipt(1, true))
    .expect(safety and s.candidates.get(1).firstAttempt == 1 and s.candidates.get(1).receiptWrites == 0)
  run missingOrMalformedReadNeverWritesTest = init.then(version(1, false))
    .then(receipt(1, false)).expect(safety and s.candidates.get(1).versionWrites == 0 and s.candidates.get(1).receiptWrites == 0)
  run finalArchiveOrIdentityRefusalPreservesVersionTest = init.then(version(1, true))
    .then(receipt(1, false)).expect(safety and s.candidates.get(1).versionWrites == 1 and s.candidates.get(1).receiptWrites == 0)
  run rerunUsesSameCodeAndCannotOverwriteEvidenceTest = init.then(version(1, true))
    .then(receipt(1, true)).then(rerun(1)).then(version(1, true)).then(receipt(1, true))
    .expect(safety and s.candidates.get(1).versionWrites == 1 and s.candidates.get(1).receiptWrites == 1 and s.candidates.get(1).finalAttempt == 1)
  run laterFloorCanStaleUnsignedReceiptTest = init.then(version(1, true))
    .then(receipt(1, true)).then(advanceFloor(3))
    .expect(safety and s.candidates.get(1).receiptWrites == 1 and not(s.candidates.get(1).qualified))
}
