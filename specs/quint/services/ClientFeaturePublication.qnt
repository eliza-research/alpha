// A complete private client cache is published once; a collision loser only reads.
module ClientFeaturePublication {
  type Worker = {phase: str, target: int, candidate: bool, aside: int,
    retirements: int, publications: int, reads: int, accepted: int, outcome: str}
  type State = {visible: int, kind: str, workers: int -> Worker, foreignUsed: bool}
  pure val Actors = Set(1, 2, 3)
  pure val Trees = Set(0, 1, 2, 3)
  pure val Targets = Set(2, 3)
  pure val Kinds = Set("regular", "unrecognized", "linked")
  pure val Phases = Set("idle", "ready", "publishing", "readback", "cleanup", "done", "failed")
  pure val emptyWorker: Worker = {phase: "idle", target: 2, candidate: false, aside: 0,
    retirements: 0, publications: 0, reads: 0, accepted: 0, outcome: "none"}
  var s: State

  action initFor(visible: int, kind: str): bool = all {
    visible.in(Trees), kind.in(Kinds),
    s' = {visible: visible, kind: kind,
      workers: Map(1 -> emptyWorker, 2 -> emptyWorker, 3 -> emptyWorker), foreignUsed: false},
  }
  action init = initFor(1, "regular")

  // Source authentication, a private copy and its stamp finish before the first rename.
  // Initial unknown or linked paths are refused before retirement; stale regular trees repair.
  action prepare(actor: int, target: int): bool = all {
    actor.in(Actors), target.in(Targets), s.workers.get(actor).phase == "idle",
    val refused = s.kind != "regular"
    val reused = not(refused) and s.visible == target
    val worker = {...emptyWorker, target: target,
      phase: if (refused or reused) "done" else "ready", candidate: not(refused or reused),
      accepted: if (reused) target else 0,
      outcome: if (refused) "refused" else if (reused) "reused" else "prepared"}
    s' = {...s, workers: s.workers.set(actor, worker)},
  }
  action sourceRefusal(actor: int): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "idle",
    s' = {...s, workers: s.workers.set(actor, {...emptyWorker, phase: "done", outcome: "refused"})},
  }
  action retire(actor: int): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "ready", s.kind == "regular",
    val worker = s.workers.get(actor)
    s' = {...s, visible: 0, workers: s.workers.set(actor,
      {...worker, phase: "publishing", aside: s.visible, retirements: worker.retirements + 1})},
  }
  action publish(actor: int): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "publishing", s.kind == "regular",
    val worker = s.workers.get(actor)
    val installed = s.visible == 0
    s' = {...s, visible: if (installed) worker.target else s.visible,
      workers: s.workers.set(actor, {...worker, publications: worker.publications + 1,
        phase: if (installed) "cleanup" else "readback", candidate: not(installed),
        accepted: if (installed) worker.target else 0,
        outcome: if (installed) "published" else "contended"})},
  }
  // A directory lstat is only a probe, never authenticated success.
  // reads is the finite class 0,1,2-or-more; it is not the source's 30-second deadline.
  action probe(actor: int): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "readback",
    val worker = s.workers.get(actor)
    s' = {...s, workers: s.workers.set(actor,
      {...worker, reads: if (worker.reads < 2) worker.reads + 1 else 2})},
  }
  // stable=false represents a vanished/replaced directory, not accepted authentication.
  // A successful source read includes both inode checks and the complete stamp/inventory.
  action readback(actor: int, stable: bool): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "readback",
    val worker = s.workers.get(actor)
    val refused = stable and s.kind != "regular"
    val accepted = stable and s.kind == "regular" and s.visible == worker.target
    s' = {...s, workers: s.workers.set(actor, {...worker,
      phase: if (refused or accepted) "cleanup" else "readback",
      accepted: if (accepted) worker.target else 0,
      outcome: if (refused) "refused" else if (accepted) "reused" else "waiting"})},
  }
  action expire(actor: int): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "readback",
    s' = {...s, workers: s.workers.set(actor,
      {...s.workers.get(actor), phase: "cleanup", outcome: "timeout"})},
  }
  action ioFailure(actor: int): bool = all {
    actor.in(Actors), s.workers.get(actor).phase.in(Set("ready", "publishing", "readback")),
    s' = {...s, workers: s.workers.set(actor,
      {...s.workers.get(actor), phase: "cleanup", outcome: "io-error"})},
  }
  action cleanupAside(actor: int, succeeds: bool): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "cleanup",
    val worker = s.workers.get(actor)
    s' = {...s, workers: s.workers.set(actor, if (succeeds)
      {...worker, aside: 0}
      else {...worker, phase: "failed", accepted: 0, outcome: "cleanup-error"})},
  }
  action cleanupStage(actor: int, succeeds: bool): bool = all {
    actor.in(Actors), s.workers.get(actor).phase == "cleanup", s.workers.get(actor).aside == 0,
    val worker = s.workers.get(actor)
    s' = {...s, workers: s.workers.set(actor, if (succeeds)
      {...worker, phase: "done", candidate: false}
      else {...worker, phase: "failed", accepted: 0, outcome: "cleanup-error"})},
  }
  action cleanup(actor: int, succeeds: bool): bool = if (succeeds)
    cleanupAside(actor, true).then(cleanupStage(actor, true))
    else cleanupAside(actor, false)
  // One outside writer can leave a different or unrecognized winner during readback.
  // Its tree remains outside this caller's private cleanup paths.
  action foreignWinner(kind: str): bool = all {
    not(s.foreignUsed), kind.in(Kinds),
    Actors.exists(actor => s.workers.get(actor).phase == "readback"),
    s' = {...s, visible: 3, kind: kind, foreignUsed: true},
  }

  val RetireAndPublishAtMostOnce = Actors.forall(actor => {
    val worker = s.workers.get(actor)
    worker.retirements.in(Set(0, 1)) and worker.publications.in(Set(0, 1))
      and worker.publications <= worker.retirements
  })
  val AcceptedOnlyExactTarget = Actors.forall(actor => {
    val worker = s.workers.get(actor)
    worker.accepted == 0 or (worker.accepted == worker.target and worker.outcome.in(Set("published", "reused")))
  })
  val PrivateCandidateBeforePublish = Actors.forall(actor => {
    val worker = s.workers.get(actor)
    worker.phase.in(Set("ready", "publishing", "readback")) implies worker.candidate
  })
  val SuccessfulCleanupOwnsNoSidecars = Actors.forall(actor => {
    val worker = s.workers.get(actor)
    worker.phase == "done" implies (not(worker.candidate) and worker.aside == 0)
  })
  val TypeOK = s.visible.in(Trees) and s.kind.in(Kinds) and Actors.forall(actor => {
    val worker = s.workers.get(actor)
    worker.phase.in(Phases) and worker.target.in(Targets) and worker.aside.in(Trees)
      and worker.reads.in(0.to(2)) and worker.accepted.in(Set(0, 2, 3))
  })
  val safety = TypeOK and RetireAndPublishAtMostOnce and AcceptedOnlyExactTarget
    and PrivateCandidateBeforePublish and SuccessfulCleanupOwnsNoSidecars
  val candidates = Actors.mapBy(actor => s.workers.get(actor).candidate)
  val asides = Actors.mapBy(actor => s.workers.get(actor).aside)
  val retirements = Actors.mapBy(actor => s.workers.get(actor).retirements)
  val publications = Actors.mapBy(actor => s.workers.get(actor).publications)
  val reads = Actors.mapBy(actor => s.workers.get(actor).reads)
  val accepted = Actors.mapBy(actor => s.workers.get(actor).accepted)
  val completed = Actors.mapBy(actor => s.workers.get(actor).phase == "done")

  action step = any {
    nondet actor = Actors.oneOf()
    nondet target = Targets.oneOf()
    nondet stable = Bool.oneOf()
    any {prepare(actor, target), sourceRefusal(actor), retire(actor), publish(actor),
      probe(actor), readback(actor, stable), expire(actor), ioFailure(actor),
      cleanupAside(actor, stable), cleanupStage(actor, stable)},
    nondet kind = Kinds.oneOf()
    foreignWinner(kind),
    s' = s,
  }

  // The source campaign's first checkpoint joins three fully authenticated private copies.
  action preparedPublishers = init.then(prepare(1, 2)).then(prepare(2, 2)).then(prepare(3, 2))

  run loserOnlyReadsWhileLaterPeerRetiresWinnerTest = init
    .then(prepare(1, 2)).then(prepare(2, 2)).then(prepare(3, 2))
    .then(retire(1)).then(retire(2)).then(publish(2)).then(publish(1))
    .then(retire(3)).then(readback(1, false)).expect(s.visible == 0 and safety)
    .then(publish(3)).then(readback(1, true)).then(cleanup(1, true))
    .then(cleanup(2, true)).then(cleanup(3, true))
    .expect(safety and s.workers.get(1).retirements == 1 and s.workers.get(1).accepted == 2)
  run readbackCannotRetireAgainTest = init.then(prepare(1, 2)).then(prepare(2, 2))
    .then(retire(1)).then(retire(2)).then(publish(2)).then(publish(1))
    .expect(safety).then(retire(1).fail())
  run changedDirectoryCannotAuthenticateTest = init.then(prepare(1, 2)).then(prepare(2, 2))
    .then(retire(1)).then(retire(2)).then(publish(2)).then(publish(1))
    .then(readback(1, false)).expect(safety and s.workers.get(1).accepted == 0)
    .then(readback(1, true)).then(cleanup(1, true)).expect(safety and s.workers.get(1).accepted == 2)
  run differentWinnerTimesOutWithoutReplacementTest = init.then(prepare(1, 2)).then(prepare(2, 3))
    .then(retire(1)).then(retire(2)).then(publish(2)).then(publish(1))
    .then(readback(1, true)).then(expire(1)).then(cleanup(1, true))
    .expect(safety and s.visible == 3 and s.workers.get(1).outcome == "timeout")
  run unrecognizedOrLinkedInitialTreeIsPreservedTest = initFor(1, "unrecognized").then(prepare(1, 2))
    .expect(safety and s.visible == 1 and s.workers.get(1).retirements == 0)
    .then(initFor(1, "linked")).then(prepare(1, 2)).expect(safety and s.visible == 1)
  run readbackRefusalCannotDeleteForeignTreeTest = init.then(prepare(1, 2)).then(prepare(2, 2))
    .then(retire(1)).then(retire(2)).then(publish(2)).then(publish(1))
    .then(foreignWinner("linked")).then(readback(1, true)).then(cleanup(1, true))
    .expect(safety and s.visible == 3 and s.kind == "linked" and s.workers.get(1).accepted == 0)
  run failedIoAndCleanupRetainOnlyOwnedScratchTest = init.then(prepare(1, 2)).then(retire(1))
    .then(ioFailure(1)).then(cleanup(1, false))
    .expect(safety and s.workers.get(1).phase == "failed" and s.workers.get(1).aside == 1)
  run unauthenticatedSourceCannotRetireTest = init.then(sourceRefusal(1))
    .expect(safety and s.visible == 1).then(retire(1).fail())
}
