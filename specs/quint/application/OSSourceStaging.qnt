/// Bound source plan; all preimages admitted before writes, with preserved recovery inputs.
module OSSourceStaging {
  type State = { source: bool, assets: bool, preimages: bool, phase: str,
    backedUp: bool, writes: int, accepted: bool }
  var s: State
  action init = s' = { source: true, assets: true, preimages: true, phase: "idle",
    backedUp: false, writes: 0, accepted: false }
  action drift = s' = { ...s, preimages: false }
  action badAssets = s' = { ...s, assets: false }
  action admit = s' = if (s.source and s.assets and s.preimages)
    { ...s, phase: "admitted" } else { ...s, phase: "refused" }
  action backup = all { s.phase == "admitted", s.preimages, s' = { ...s, backedUp: true } }
  action write = all { s.phase == "admitted", s.preimages, s.backedUp, s.writes < 2,
    s' = { ...s, writes: s.writes + 1 } }
  action failure = s' = { ...s, phase: "failed", accepted: false }
  action verify = s' = if (s.phase == "admitted" and s.writes == 2 and s.preimages)
    { ...s, phase: "complete", accepted: true } else s
  action step = any { drift, badAssets, admit, backup, write, failure, verify }
  val safety = (s.writes == 0 or s.backedUp) and (not(s.accepted) or (s.writes == 2 and s.backedUp))
  run driftCannotWriteTest = init.then(drift).then(admit).expect(s.phase == "refused" and s.writes == 0 and safety)
  run mismatchedAssetsCannotWriteTest = init.then(badAssets).then(admit).expect(s.phase == "refused" and safety)
  run partialFailureRetainsBackupTest = init.then(admit).then(backup).then(write).then(failure)
    .expect(s.backedUp and not(s.accepted) and safety)
  run completeNeedsReadbackTest = init.then(admit).then(backup).then(write).then(verify)
    .expect(not(s.accepted)).then(write).then(verify).expect(s.accepted and safety)
}
