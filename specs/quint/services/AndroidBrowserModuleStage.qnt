// The independently compiled browser module binds one patched-native key to its host profile.
module AndroidBrowserModuleStage {
  type State = {selected: int, reviewed: bool, patchValid: bool, stage1: str, stage2: str,
    host: str, hostGeneration: int, fresh: bool, result: str}
  var s: State

  pure val Generations = Set(1, 2)
  pure val Faults = Set("none", "publish", "hostWrite")
  pure def stageFor(state: State, generation: int): str = if (generation == 1) state.stage1 else state.stage2
  pure def withStage(state: State, generation: int, status: str): State =
    if (generation == 1) {...state, stage1: status} else {...state, stage2: status}
  pure def withFreshness(state: State): State = {...state, fresh: state.hostGeneration == state.selected and state.reviewed}

  action init = s' = {selected: 1, reviewed: true, patchValid: true, stage1: "absent", stage2: "absent",
    host: "absent", hostGeneration: 0, fresh: false, result: "none"}
  action selectManifest(generation: int): bool = all {
    generation.in(Generations), s' = withFreshness({...s, selected: generation, result: "none"}),
  }
  action setRoute(reviewed: bool): bool = s' = withFreshness({...s, reviewed: reviewed, result: "none"})
  action setPatchValid(valid: bool): bool = s' = {...s, patchValid: valid, result: "none"}
  action driftCache = all {
    stageFor(s, s.selected) == "exact",
    s' = withStage({...s, result: "none"}, s.selected, "drift"),
  }
  action occupy(value: bool): bool = all {
    if (value) s.host == "absent" else s.host == "unowned",
    s' = {...s, host: if (value) "unowned" else "absent", result: "none"},
  }

  action generate(fault: str): bool = all {
    fault.in(Faults),
    val existing = stageFor(s, s.selected)
    if (not(s.patchValid)) s' = {...s, result: "patchRefused"}
    else if (existing == "drift") s' = {...s, result: "cacheRefused"}
    else if (existing == "absent" and fault == "publish") s' = {...s, result: "publishRefused"}
    else {
      val staged = withStage(s, s.selected, "exact")
      if (not(s.reviewed)) s' = {...staged, result: "routeRefused"}
      else if (s.host == "unowned") s' = {...staged, result: "collisionRefused"}
      else if (fault == "hostWrite") s' = withFreshness({...staged, hostGeneration: s.selected,
        host: if (s.host == "published") "published" else "ownedIncomplete", result: "hostWriteRefused"})
      else s' = withFreshness({...staged, hostGeneration: s.selected, host: "published", result: "generated"})
    },
  }

  action verifyReceipt(generation: int): bool = all {
    generation.in(Generations), s.patchValid,
    stageFor(s, s.selected) == "exact", stageFor(s, generation) != "absent",
    s' = {...s, result: if (generation == s.selected) "receiptAccepted" else "receiptRefused"},
  }

  action step = any {
    selectManifest(1), selectManifest(2), setRoute(true), setRoute(false), setPatchValid(true), setPatchValid(false),
    driftCache, occupy(true), occupy(false), generate("none"), generate("publish"), generate("hostWrite"),
    verifyReceipt(1), verifyReceipt(2), s' = s,
  }

  val PublishedHostReferencesStagedModule = s.hostGeneration != 0 implies stageFor(s, s.hostGeneration) != "absent"
  val SuccessBindsCurrentReviewedCache = s.result == "generated" implies
    (s.host == "published" and s.fresh and s.reviewed and s.patchValid and stageFor(s, s.selected) == "exact")
  val OwnedIncompleteHostHasProfile = s.host == "ownedIncomplete" implies s.hostGeneration.in(Generations)
  val SuccessfulReceiptRequiresExactCurrentCache = s.result == "receiptAccepted" implies
    (s.patchValid and stageFor(s, s.selected) == "exact")
  val safety = PublishedHostReferencesStagedModule and SuccessBindsCurrentReviewedCache and
    OwnedIncompleteHostHasProfile and SuccessfulReceiptRequiresExactCurrentCache

  run publishAndReuseTest = init.then(generate("none")).then(generate("none"))
    .expect(s.hostGeneration == 1 and s.stage1 == "exact" and s.stage2 == "absent" and safety)
  run badPatchPreservesHostTest = init.then(generate("none")).then(selectManifest(2)).then(setPatchValid(false))
    .then(generate("none")).expect(s.result == "patchRefused" and s.hostGeneration == 1 and s.stage2 == "absent" and safety)
  run publicationFailurePreservesPriorTest = init.then(generate("none")).then(selectManifest(2)).then(generate("publish"))
    .expect(s.result == "publishRefused" and s.hostGeneration == 1 and s.stage1 == "exact" and s.stage2 == "absent" and safety)
  run cacheDriftRefusesReuseTest = init.then(generate("none")).then(driftCache).then(generate("none"))
    .expect(s.result == "cacheRefused" and s.stage1 == "drift" and s.hostGeneration == 1 and safety)
  run badRouteKeepsPriorHostTest = init.then(generate("none")).then(selectManifest(2)).then(setRoute(false)).then(generate("none"))
    .expect(s.result == "routeRefused" and s.hostGeneration == 1 and s.stage2 == "exact" and not(s.fresh) and safety)
  run markerAllowsInterruptedHostRetryTest = init.then(generate("hostWrite"))
    .expect(s.host == "ownedIncomplete" and s.stage1 == "exact" and safety).then(generate("none"))
    .expect(s.host == "published" and s.hostGeneration == 1 and safety)
  run unownedOutputIsPreservedTest = init.then(occupy(true)).then(generate("none"))
    .expect(s.result == "collisionRefused" and s.host == "unowned" and s.stage1 == "exact" and safety)
  run receiptMustMatchCurrentGenerationTest = init.then(generate("none")).then(selectManifest(2)).then(generate("none"))
    .then(verifyReceipt(1)).expect(s.result == "receiptRefused" and safety)
    .then(verifyReceipt(2)).expect(s.result == "receiptAccepted" and safety)
}
