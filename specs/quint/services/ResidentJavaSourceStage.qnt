// Host Java and its provenance manifest share one settled publication generation.
module ResidentJavaSourceStage {
  type State = {selected: int, admission: str, occupied: bool, published: int,
    previous: int, candidate: int, before: int, result: str}
  var s: State

  pure val Generations = Set(1, 2)
  pure val Admission = Set("ready", "wrongPin", "noStamp", "dirty")
  pure val Faults = Set("none", "manifest", "move", "publish", "restore")
  pure val Refusals = Set("sourceRefused", "rewriteRefused", "manifestRefused",
    "outputRefused", "moveRefused", "publishRefused")

  action initFor(published: int): bool = all {
    published.in(Set(0, 1)),
    s' = {selected: 1, admission: "ready", occupied: false, published: published,
      previous: 0, candidate: 0, before: 0, result: "none"},
  }
  action init = initFor(0)

  action selectGeneration(generation: int): bool = all {
    generation.in(Set(1, 2, 3)),
    s' = {...s, selected: generation, admission: "ready", before: 0, result: "none"},
  }
  action setAdmission(admission: str): bool = all {
    admission.in(Admission),
    s' = {...s, admission: admission, before: 0, result: "none"},
  }
  action occupy(value: bool): bool = all {
    value != s.occupied,
    s' = {...s, occupied: value, before: 0, result: "none"},
  }

  action stage(fault: str): bool = {
    val result = if (s.admission != "ready") "sourceRefused"
      else if (s.selected == 3) "rewriteRefused"
      else if (fault == "manifest") "manifestRefused"
      else if (s.occupied) "outputRefused"
      else if (fault == "move") "moveRefused"
      else if (fault == "publish") "publishRefused"
      else if (fault == "restore") "stranded"
      else "published"
    all {
      fault.in(Faults),
      fault == "move" implies s.published != 0,
      fault == "restore" implies (s.published != 0 and s.previous == 0),
      s' = {...s, before: s.published, result: result,
        published: if (result == "published") s.selected else if (result == "stranded") 0 else s.published,
        previous: if (result == "stranded") s.published else s.previous,
        candidate: if (result == "stranded") s.selected else s.candidate},
    }
  }

  action step = any {
    { nondet generation = Set(1, 2, 3).oneOf(); selectGeneration(generation) },
    { nondet admission = Admission.oneOf(); setAdmission(admission) },
    occupy(not(s.occupied)),
    { nondet fault = Faults.oneOf(); stage(fault) },
    s' = s,
  }

  val PublishedPairUsesReviewedGeneration = s.published.in(Generations.union(Set(0)))
    and (s.result == "published" implies (s.published == s.selected and s.admission == "ready"))
  val RefusalPreservesPublishedPair = s.result.in(Refusals) implies s.published == s.before
  val FailedRestoreRetainsBothPairs = (s.previous == 0 and s.candidate == 0
      or s.previous.in(Generations) and s.candidate.in(Generations))
    and (s.result == "stranded" implies (s.published == 0 and s.previous == s.before and s.candidate == s.selected))
  val safety = PublishedPairUsesReviewedGeneration and RefusalPreservesPublishedPair and FailedRestoreRetainsBothPairs

  run publishReplacementTest = init.then(stage("none")).then(stage("none")).then(selectGeneration(2)).then(stage("none"))
    .expect(s.published == 2 and s.previous == 0 and safety)
  run anchorFailureKeepsPriorTest = initFor(1).then(selectGeneration(3)).then(stage("none"))
    .expect(s.result == "rewriteRefused" and s.published == 1 and safety).then(selectGeneration(2)).then(stage("none"))
    .expect(s.published == 2 and safety)
  run inputAdmissionTest = initFor(1).then(setAdmission("wrongPin")).then(stage("none"))
    .then(setAdmission("noStamp")).then(stage("none")).then(setAdmission("dirty")).then(stage("none"))
    .expect(s.result == "sourceRefused" and s.published == 1 and safety)
  run privateCandidateFailureTest = initFor(1).then(selectGeneration(2)).then(stage("manifest"))
    .expect(s.result == "manifestRefused" and s.published == 1 and safety)
  run restorePriorOnPublicationFailureTest = initFor(1).then(selectGeneration(2)).then(stage("move")).then(stage("publish"))
    .expect(s.result == "publishRefused" and s.published == 1 and s.previous == 0 and safety)
  run refusedRestoreKeepsBackupAcrossRetryTest = initFor(1).then(selectGeneration(2)).then(stage("restore"))
    .expect(s.result == "stranded" and s.published == 0 and s.previous == 1 and safety).then(stage("none"))
    .expect(s.published == 2 and s.previous == 1 and s.candidate == 2 and safety)
  run unexpectedOutputIsPreservedTest = initFor(1).then(occupy(true)).then(stage("none"))
    .expect(s.result == "outputRefused" and s.published == 1 and s.occupied and safety)
}
