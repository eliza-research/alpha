// Current release command boundaries with closed GitHub/storage ports.
// A restored synthetic signed bundle supplies no real signing or qualification authority.
module ProtectedAppUpdatePromotion {
  type Public = {release: bool, apk: str, pointer: str, floor: int,
    apkVerified: bool, pointerWrite: bool, receipt: bool}
  type State = {lane: str, plan: bool, unsigned: bool, candidateAttempt: int, protectedAttempt: int,
    object: bool, privateReceipt: bool,
    review: bool, restored: bool, public: Public}
  var s: State
  pure val emptyPublic: Public = {release: false, apk: "missing", pointer: "missing", floor: 1,
    apkVerified: false, pointerWrite: false, receipt: false}
  action init = s' = {lane: "none", plan: false, unsigned: false, candidateAttempt: 0, protectedAttempt: 0, object: false,
    privateReceipt: false, review: false, restored: false, public: emptyPublic}
  // A main-push candidate needs its own exact route, including the successful
  // run attempt, official archive, native input receipt and private mirror pin.
  action admit(lane: str, exact: bool): bool = all {
    s.lane == "none", lane.in(Set("dispatch", "private")),
    s' = {...s, lane: lane, plan: exact}
  }
  action admitCandidate(attempt: int, exact: bool): bool = all {
    s.lane == "none", attempt.in(Set(1, 2)),
    s' = {...s, lane: "push", plan: exact and attempt == 2,
      candidateAttempt: if (exact and attempt == 2) attempt else 0}
  }
  action restoreUnsigned(exact: bool): bool = all {
    s.plan, s.lane != "push", not(s.unsigned),
    s' = {...s, unsigned: exact}
  }
  action restoreCandidate(attempt: int, exact: bool): bool = all {
    s.lane == "push", s.plan, not(s.unsigned), attempt.in(Set(1, 2)),
    s' = {...s, unsigned: exact and attempt == s.candidateAttempt,
      protectedAttempt: if (exact and attempt == s.candidateAttempt) attempt else 0}
  }
  // Private media upload is create-if-absent. A lost response can leave a
  // complete object without a receipt. An interrupted request can commit nothing.
  action uploadPrivate(fault: str): bool = all {
    s.lane.in(Set("push", "private")), s.unsigned,
    s' = {...s, object: s.object or fault.in(Set("ok", "after")),
      privateReceipt: s.privateReceipt or (not(s.object) and fault == "ok")}
  }
  action readReview(exact: bool): bool = all {
    s.privateReceipt, not(s.restored),
    s' = {...s, review: exact}
  }
  action restoreSigned(exact: bool): bool = all {
    s.review, not(s.restored), s' = {...s, restored: exact}
  }
  action existingRelease = all {
    not(s.public.release),
    s' = {...s, public: {...s.public, release: true, pointer: "old"}}
  }
  action advanceFloor = all {
    s.public.floor == 1,
    s' = {...s, public: {...s.public, release: true, floor: 3}}
  }
  action advanceLegacyFloor = all {
    s.public.floor == 1,
    s' = {...s, public: {...s.public, floor: 2}}
  }
  pure def deliver(p: Public, fault: str): Public = {
    val release = p.release or (p.floor < 2 and fault != "create-before")
    val canUpload = p.floor < 2 and release and (p.release or fault != "create-after")
    val apk = if (not(canUpload) or p.apk != "missing" or fault == "apk-before") p.apk
      else if (fault == "apk-partial") "partial" else "exact"
    val verified = canUpload and apk == "exact" and fault != "apk-readback"
      and (p.apk != "missing" or fault != "apk-after")
    val legacyAdvanced = verified and fault == "late-legacy-floor"
    val stableAdvanced = verified and fault == "late-stable-floor"
    val removed = verified and fault == "lost-apk"
    val hidden = verified and fault == "hidden-pointer" and p.pointer != "missing"
    val finalInventory = verified and not(legacyAdvanced or stableAdvanced or removed or hidden)
    val raced = finalInventory and fault == "pointer-race"
    val pointerWrite = finalInventory and not(raced) and p.pointer != "exact"
    val pointer = if (raced) "newer" else if (not(pointerWrite) or fault == "manifest-before") p.pointer
      else if (fault == "manifest-partial") "missing" else "exact"
    val receipt = finalInventory and not(raced) and pointer == "exact" and fault != "manifest-readback"
      and (not(pointerWrite) or fault != "manifest-after")
    {release: release, apk: if (removed) "missing" else apk, pointer: pointer,
      floor: if (raced or stableAdvanced) 3 else if (legacyAdvanced) 2 else p.floor,
      apkVerified: verified, pointerWrite: pointerWrite, receipt: receipt}
  }
  action publish(fault: str): bool = all {
    s.restored,
    s' = {...s, public: deliver(s.public, fault)}
  }
  pure val PrivateFaults = Set("ok", "before", "partial", "after")
  pure val PublicFaults = Set("ok", "create-before", "create-after", "apk-before", "apk-partial", "apk-after",
    "apk-readback", "late-legacy-floor", "late-stable-floor", "lost-apk", "hidden-pointer",
    "pointer-race", "manifest-before", "manifest-partial", "manifest-after", "manifest-readback")
  action step = any {
    { nondet lane = Set("dispatch", "private").oneOf(); nondet exact = Bool.oneOf(); admit(lane, exact) },
    { nondet attempt = Set(1, 2).oneOf(); nondet exact = Bool.oneOf(); admitCandidate(attempt, exact) },
    { nondet exact = Bool.oneOf(); restoreUnsigned(exact) },
    { nondet attempt = Set(1, 2).oneOf(); nondet exact = Bool.oneOf(); restoreCandidate(attempt, exact) },
    { nondet fault = PrivateFaults.oneOf(); uploadPrivate(fault) },
    { nondet exact = Bool.oneOf(); readReview(exact) },
    { nondet exact = Bool.oneOf(); restoreSigned(exact) },
    existingRelease, advanceFloor, advanceLegacyFloor,
    { nondet fault = PublicFaults.oneOf(); publish(fault) },
    s' = s
  }
  val StagedPairRequiresReviewedPlan = s.unsigned implies
    (s.plan and s.lane.in(Set("push", "dispatch", "private")))
  val MainCandidateRequiresSameAttempt =
    (s.lane == "push" and s.plan implies s.candidateAttempt == 2)
    and (s.lane == "push" and s.unsigned implies s.protectedAttempt == s.candidateAttempt)
  val PrivateReceiptRequiresStagedPair = s.privateReceipt implies
    (s.lane.in(Set("push", "private")) and s.plan and s.unsigned and s.object)
  val RestoredRequiresReviewedReceipt = s.restored implies (s.review and s.privateReceipt)
  val PointerWriteRequiresExactAnonymousApk = s.public.pointerWrite implies
    (s.restored and s.public.apkVerified and s.public.apk == "exact")
  val ReceiptRequiresReadbacks = s.public.receipt implies
    (s.restored and s.public.release and s.public.apk == "exact" and s.public.apkVerified and s.public.pointer == "exact")
  val safety = StagedPairRequiresReviewedPlan and MainCandidateRequiresSameAttempt
    and PrivateReceiptRequiresStagedPair and RestoredRequiresReviewedReceipt
    and PointerWriteRequiresExactAnonymousApk and ReceiptRequiresReadbacks
  action ready = admit("private", true).then(restoreUnsigned(true)).then(uploadPrivate("ok"))
    .then(readReview(true)).then(restoreSigned(true))
  run mainPushWithoutExactEvidenceCannotSignTest = init.then(admitCandidate(1, true))
    .expect(not(s.plan) and not(s.unsigned) and safety)
  run exactMainCandidateNeedsFreshProtectedAdmissionTest = init
    .then(admitCandidate(2, true)).then(restoreCandidate(1, true)).then(restoreCandidate(2, false))
    .expect(s.plan and not(s.unsigned) and not(s.privateReceipt) and safety)
    .then(restoreCandidate(2, true)).then(uploadPrivate("ok")).then(readReview(false))
    .expect(s.privateReceipt and not(s.restored) and safety)
    .then(readReview(true)).then(restoreSigned(true)).then(publish("ok"))
    .expect(s.public.apk == "exact" and s.public.pointer == "exact" and s.public.receipt and safety)
  run lostPrivateResponseCannotOverwriteObjectTest = init.then(admit("private", true)).then(restoreUnsigned(true))
    .then(uploadPrivate("partial")).expect(not(s.object)).then(uploadPrivate("after"))
    .then(uploadPrivate("ok")).expect(s.object and not(s.privateReceipt) and safety)
  run staleSigningReviewAndWrongGenerationTest = init.then(admit("private", true)).then(restoreUnsigned(true))
    .then(uploadPrivate("ok")).then(readReview(false)).expect(not(s.review))
    .then(readReview(true)).then(restoreSigned(false)).expect(not(s.restored) and safety)
  run raisedFloorRefusesPublicWritesTest = init.then(ready).then(advanceFloor).then(publish("ok"))
    .expect(not(s.public.apkVerified) and not(s.public.pointerWrite) and not(s.public.receipt) and safety)
  run legacyFloorMustBeExceededTest = init.then(ready).then(advanceLegacyFloor).then(publish("ok"))
    .expect(not(s.public.release) and not(s.public.pointerWrite) and not(s.public.receipt) and safety)
  run finalInventoryCanRefuseVerifiedApkTest = init.then(ready).then(publish("lost-apk"))
    .expect(s.public.apkVerified and s.public.apk == "missing" and not(s.public.pointerWrite) and safety)
    .then(publish("late-stable-floor"))
    .expect(s.public.apkVerified and s.public.floor == 3 and not(s.public.pointerWrite) and safety)
  run partialApkCannotBeOverwrittenTest = init.then(ready).then(publish("apk-partial"))
    .then(publish("ok")).expect(s.public.apk == "partial" and not(s.public.pointerWrite) and safety)
  run pointerRepairReusesExactApkTest = init.then(ready).then(existingRelease).then(publish("manifest-partial"))
    .expect(s.public.apk == "exact" and s.public.pointer == "missing" and not(s.public.receipt))
    .then(publish("ok")).expect(s.public.pointer == "exact" and s.public.receipt and safety)
  run lostPointerResponseCanBeReconciledTest = init.then(ready).then(publish("manifest-after"))
    .expect(s.public.pointer == "exact" and not(s.public.receipt))
    .then(publish("ok")).expect(not(s.public.pointerWrite) and s.public.receipt and safety)
}
