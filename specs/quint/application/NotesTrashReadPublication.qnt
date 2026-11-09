// Previous Notes Trash read admission and publication into the shell.
module NotesTrashReadPublication {
  type Write = {id: int, latest: int, readEpoch: int, activeEpoch: int, live: bool, mode: str}
  type State = {live: bool, mode: str, epoch: int, started: int, pending: int -> int,
    rows: List[str], error: bool, writes: int, lastWrite: Write}
  var s: State
  pure val Sources = Set("canonical", "legacy")
  pure val Results = Set("first", "second", "empty", "error")
  pure val NoWrite: Write = {id: 0, latest: 0, readEpoch: 0, activeEpoch: 0, live: false, mode: "canonical"}

  action init = s' = {live: true, mode: "canonical", epoch: 0, started: 0, pending: Map(),
    rows: List(), error: false, writes: 0, lastWrite: NoWrite}
  action chooseSource(mode: str): bool = all {
    s.live, Sources.contains(mode), s.mode != mode, s.epoch < 4,
    s' = {...s, mode: mode, epoch: s.epoch + 1},
  }
  action unmount = all {s.live, s' = {...s, live: false, epoch: s.epoch + 1}}
  action signal = if (not(s.live) or s.mode != "legacy") s' = s else all {
    s.started < 3,
    val id = s.started + 1
    s' = {...s, started: id, pending: s.pending.put(id, s.epoch)},
  }
  action complete(id: int, result: str): bool = all {
    s.pending.keys().contains(id), Results.contains(result),
    val owner = s.pending.get(id)
    val settled = {...s, pending: s.pending.keys().exclude(Set(id)).mapBy(key => s.pending.get(key))}
    s' = if (not(s.live) or s.mode != "legacy" or id != s.started or owner != s.epoch) settled
      else {...settled, rows: if (Set("empty", "error").contains(result)) List() else List(result),
        error: result == "error", writes: s.writes + 1,
        lastWrite: {id: id, latest: s.started, readEpoch: owner, activeEpoch: s.epoch, live: s.live, mode: s.mode}},
  }
  action step = any {
    chooseSource("canonical"), chooseSource("legacy"), signal, unmount,
    {nondet id = Set(1, 2, 3).oneOf(); nondet result = Results.oneOf(); complete(id, result)},
    s' = s,
  }

  val ExactPublication = s.writes == 0 or (s.lastWrite.id == s.lastWrite.latest
    and s.lastWrite.readEpoch == s.lastWrite.activeEpoch and s.lastWrite.mode == "legacy" and s.lastWrite.live)
  val ConsistentReadCount = s.started.in(0.to(3)) and s.writes + s.pending.keys().size() <= s.started
    and s.pending.keys().forall(id => id.in(1.to(s.started)) and s.pending.get(id).in(1.to(s.epoch)))
  val ReadErrorHidesRows = not(s.error) or s.rows == List()
  val safety = ExactPublication and ConsistentReadCount and ReadErrorHidesRows

  run canonicalDoesNotReadTest = init.then(signal)
    .expect(s.started == 0 and s.writes == 0 and safety)
  run newerResultCannotBeReplacedTest = init.then(chooseSource("legacy")).then(signal).then(signal)
    .then(complete(2, "second")).then(complete(1, "first"))
    .expect(s.rows == List("second") and s.writes == 1 and safety)
  run pendingSuccessorAlreadyOwnsReadTest = init.then(chooseSource("legacy")).then(signal).then(signal)
    .then(complete(1, "error")).expect(s.pending.keys() == Set(2) and s.writes == 0 and safety)
    .then(complete(2, "first")).expect(s.rows == List("first") and s.writes == 1 and safety)
  run canonicalSwitchDropsHeldSuccessTest = init.then(chooseSource("legacy")).then(signal)
    .then(chooseSource("canonical")).then(complete(1, "first"))
    .expect(s.rows == List() and s.writes == 0 and safety)
  run sourceReturnDoesNotReviveHeldErrorTest = init.then(chooseSource("legacy")).then(signal)
    .then(chooseSource("canonical")).then(chooseSource("legacy")).then(complete(1, "error"))
    .expect(not(s.error) and s.writes == 0 and safety)
    .then(signal).then(complete(2, "second")).expect(s.rows == List("second") and s.writes == 1 and safety)
  run currentFailureAndEmptyReadTest = init.then(chooseSource("legacy")).then(signal).then(complete(1, "first"))
    .then(signal).then(complete(2, "error")).expect(s.error and s.rows == List() and safety)
    .then(signal).then(complete(3, "empty")).expect(not(s.error) and s.rows == List() and s.writes == 3 and safety)
  run unmountDropsHeldReadAndListenerTest = init.then(chooseSource("legacy")).then(signal).then(unmount)
    .then(signal).then(complete(1, "first")).expect(s.started == 1 and s.writes == 0 and safety)
}
