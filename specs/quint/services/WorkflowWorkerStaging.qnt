// Host worker artifact verification and staged directory publication.
module WorkflowWorkerStaging {
  type State = {
    source: int, quality: str, target: int, previous: int, lastSource: int,
    backup: int, indexed: bool, temporary: bool, result: str
  }
  var s: State

  pure val Generations = Set(1, 2)
  pure val Corruptions = Set("hash", "missing", "extra", "wrongPin", "wrongLock", "overlay", "symlink")
  pure val Faults = Set("none", "copyBytes", "manifestDrift", "publishRefusal", "restoreRefusal", "cleanupRefusal")
  action initFor(target: int): bool = all {
    target.in(Set(0, 1)),
    s' = {source: 2, quality: "ready", target: target, previous: target, lastSource: 0, backup: 0,
      indexed: target != 0, temporary: false, result: "none"},
  }
  action init = initFor(0)
  action replaceSource(generation: int): bool = all {
    generation.in(Generations),
    s' = {...s, source: generation, quality: "ready"},
  }
  action corrupt(kind: str): bool = all {
    s.quality == "ready", kind.in(Corruptions),
    s' = {...s, quality: kind},
  }
  action stage(fault: str): bool = all {
    fault.in(Faults),
    s.quality == "ready" or fault == "none",
    fault.in(Set("restoreRefusal", "cleanupRefusal")) implies (s.target != 0 and s.backup == 0),
    val healthy = s.quality == "ready"
    val published = healthy and fault.in(Set("none", "cleanupRefusal"))
    val stranded = healthy and fault == "restoreRefusal"
    val pendingBackup = healthy and fault.in(Set("restoreRefusal", "cleanupRefusal"))
    val nextTarget = if (published) s.source else if (stranded) 0 else s.target
    val result = if (published) { if (pendingBackup) "publishUnconfirmed" else "published" }
      else if (stranded) "stranded" else "refused"
    s' = {...s, source: if (fault == "manifestDrift") 3-s.source else s.source,
      target: nextTarget, previous: s.target, lastSource: s.source,
      backup: if (pendingBackup) s.target else s.backup,
      indexed: nextTarget != 0, temporary: false, result: result},
  }
  action step = any {
    { nondet generation = Generations.oneOf(); replaceSource(generation) },
    { nondet kind = Corruptions.oneOf(); corrupt(kind) },
    { nondet fault = Faults.oneOf(); stage(fault) },
    s' = s,
  }

  val VisibleIndexMatchesTarget = s.indexed == (s.target != 0) and not(s.temporary)
  val PublicationMatchesVerifiedSource = s.result.in(Set("published", "publishUnconfirmed")) implies s.target == s.lastSource
  val OrdinaryRefusalKeepsPrevious = s.result == "refused" implies s.target == s.previous
  val UncertainWriteRetainsBackup = (s.result == "stranded" implies (s.target == 0 and s.backup == s.previous and s.backup != 0))
    and (s.result == "publishUnconfirmed" implies (s.backup == s.previous and s.backup != 0))
  val safety = VisibleIndexMatchesTarget and PublicationMatchesVerifiedSource and OrdinaryRefusalKeepsPrevious and UncertainWriteRetainsBackup

  run firstPublicationTest = init.then(stage("none"))
    .expect(s.result == "published" and s.target == 2 and safety)
  run corruptInputPreservesPreviousTest = initFor(1).then(corrupt("hash")).then(stage("none"))
    .expect(s.target == 1 and s.result == "refused" and safety)
    .then(replaceSource(2)).then(stage("none")).expect(s.target == 2 and safety)
  run coherentManifestReplacementStillRefusedTest = initFor(1).then(stage("manifestDrift"))
    .expect(s.source == 1 and s.lastSource == 2 and s.target == 1 and s.result == "refused" and safety)
  run refusedPublishRestoresExactPreviousTest = initFor(1).then(stage("publishRefusal"))
    .expect(s.target == 1 and s.backup == 0 and s.result == "refused" and safety)
  run refusedRestoreLeavesBackupTest = initFor(1).then(stage("restoreRefusal"))
    .expect(s.target == 0 and s.backup == 1 and s.result == "stranded" and safety)
  run cleanupFailureExposesPublishedTargetAndBackupTest = initFor(1).then(stage("cleanupRefusal"))
    .expect(s.target == 2 and s.backup == 1 and s.result == "publishUnconfirmed" and safety)
}
