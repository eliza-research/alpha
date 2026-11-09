// Explicit retained source selection reads only and reports its own result.
module PreviousNotesSourceOpening {
  type Request = {phase: str, target: str, owner: str, epoch: int, task: int, document: int, rows: int}
  type State = {device: bool, owner: str, mode: str, epoch: int, legacyOwner: str, status: str, failed: bool,
    editedSaved: bool, document: int, storeEpoch: int, rows: int, source: str, kept: int, canonical: str,
    refreshes: int, last: int, task: int, retention: Set[int], finished: int -> bool, retired: Set[int],
    pending: int -> Request}
  var s: State

  pure def initial(device: bool): State = {device: device, owner: "a", mode: "canonical", epoch: 0,
    legacyOwner: "", status: "canonical", failed: true, editedSaved: false, document: 0, storeEpoch: 0,
    rows: 0, source: "", kept: 0, canonical: "a", refreshes: 0, last: 0, task: 0, retention: Set(),
    finished: Map(), retired: Set(), pending: Map()}
  action initBrowser = s' = initial(false)
  action initDevice = s' = initial(true)
  action init = any {initBrowser, initDevice}

  pure def finish(state: State, id: int, accepted: bool): State = {...state,
    pending: state.pending.keys().exclude(Set(id)).mapBy(key => state.pending.get(key)),
    finished: state.finished.put(id, accepted)}
  pure def retireReads(state: State): State = {...state, retired: state.retired.union(
    state.pending.keys().filter(key => state.pending.get(key).phase != "wait"))}
  pure def begin(state: State, id: int, request: Request): State = {
    if (request.owner != state.owner or request.epoch != state.epoch or request.task != state.task
      or (state.mode == "legacy" and state.failed and not(state.editedSaved)
        and state.storeEpoch == state.epoch and state.rows == 9))
      finish(state, id, false)
    else {
      val updated = {...retireReads(state), epoch: state.epoch + 1, mode: request.target, failed: true,
        editedSaved: false, rows: 0, kept: 0, source: ""}
      if (request.target == "canonical")
        finish({...updated, legacyOwner: "", status: "canonical", canonical: state.owner, refreshes: state.refreshes + 1}, id, true)
      else
        {...updated, legacyOwner: state.owner, status: "opening", canonical: "",
          pending: state.pending.put(id, {...request, phase: "collection", epoch: updated.epoch})}
    }
  }
  action choose(target: str): bool = all {
    target.in(Set("canonical", "legacy")), s.last < 3,
    val id = s.last + 1
    val state = {...s, last: id}
    val request = {phase: "wait", target: target, owner: s.owner, epoch: s.epoch, task: s.task, document: 0, rows: 0}
    val waiting = s.retention.contains(s.task)
    all {
      // Bound to one waiter per retained task; a superseded waiter may still settle.
      not(waiting and target != s.mode and s.pending.keys().exists(key => {
        val held = s.pending.get(key)
        held.phase == "wait" and held.task == s.task
      })),
      s' = if (target == s.mode) finish(state, id, true)
        else if (waiting) {...state, pending: state.pending.put(id, request)}
        else begin(state, id, request),
    },
  }
  action startRetention(id: int): bool = all {
    id.in(Set(1, 2)), id > s.task,
    s' = {...s, task: id, retention: s.retention.union(Set(id))},
  }
  action finishRetention(id: int): bool = all {
    s.retention.contains(id),
    val state = {...s, retention: s.retention.exclude(Set(id))}
    s' = List(1, 2, 3).foldl(state, (updated, key) => {
      if (updated.pending.keys().contains(key)) {
        val request = updated.pending.get(key)
        if (request.phase == "wait" and request.task == id) begin(updated, key, request) else updated
      } else updated
    }),
  }
  action changeOwner(owner: str): bool = all {
    owner.in(Set("a", "b")),
    s' = if (s.mode == "legacy" and s.owner != owner)
      {...retireReads(s), owner: owner, mode: "canonical", legacyOwner: "", epoch: s.epoch + 1,
        status: "canonical", rows: 0, source: "", failed: true, document: 0, canonical: owner, refreshes: s.refreshes + 1}
      else {...s, owner: owner},
  }
  action failEdit(saved: bool): bool = all {
    s.mode == "legacy", s.status.in(Set("ready", "kept")),
    s' = {...s, failed: true, editedSaved: saved, rows: 9},
  }

  pure def hold(state: State, id: int, phase: str): State =
    {...state, pending: state.pending.put(id, {...state.pending.get(id), phase: phase})}
  pure def showSaved(state: State, id: int, result: str): State = {
    val request = state.pending.get(id)
    val retained = result == "kept"
    finish({...state, rows: request.rows, storeEpoch: state.epoch, failed: result == "failed",
      kept: if (retained) id else 0,
      status: if (retained) "kept" else if (result == "failed") "unreadable" else "ready"}, id, result != "failed")
  }
  pure def observeSource(state: State, id: int, source: str): State = {
    val admitted = {...state, document: state.pending.get(id).document, source: source}
    if (state.device) hold(admitted, id, "draft") else showSaved(admitted, id, "clean")
  }
  pure def observationRead(state: State, id: int, result: str): State = {
    val request = state.pending.get(id)
    val rows = if (result == "empty") 0 else id
    {...state, pending: state.pending.put(id, {...request, document: id, rows: rows,
      phase: if (rows == 0) "fingerprint" else "target"})}
  }
  pure def acceptedResponse(phase: str, result: str): bool =
    if (phase.in(Set("collection", "snapshot"))) result.in(Set("saved", "empty", "absent", "failed"))
    else if (phase == "target") result.in(Set("target", "none", "failed"))
    else if (phase == "fingerprint") result.in(Set("fingerprint", "failed"))
    else if (phase.in(Set("draftPresence", "draft"))) result.in(Set("kept", "clean", "failed"))
    else false

  action settle(id: int, result: str): bool = all {
    s.pending.keys().contains(id),
    val request = s.pending.get(id)
    val phase = request.phase
    all {
      acceptedResponse(phase, result),
      s' = if (s.mode != "legacy" or s.epoch != request.epoch or s.owner != request.owner) finish(s, id, false)
        else if (phase == "draft") showSaved(s, id, result)
        else if (result == "failed" or (phase == "snapshot" and result == "absent"))
          finish({...s, status: "recovery"}, id, false)
        else if (phase == "draftPresence") finish({...s, status: if (result == "kept") "draft-only" else "absent"}, id, false)
        else if (phase == "collection" and s.device) hold(s, id, if (result == "absent") "draftPresence" else "snapshot")
        else if (phase == "collection" and result == "absent") finish({...s, status: "absent"}, id, false)
        else if (phase.in(Set("collection", "snapshot"))) observationRead(s, id, result)
        else if (phase == "target" and result == "none") hold(s, id, "fingerprint")
        else observeSource(s, id, if (phase == "target") "target" else "fingerprint"),
    },
  }
  action step = any {
    choose("canonical"), choose("legacy"), changeOwner("a"), changeOwner("b"), failEdit(false), failEdit(true),
    startRetention(1), startRetention(2), finishRetention(1), finishRetention(2),
    {nondet id = Set(1, 2, 3).oneOf()
      nondet result = Set("saved", "empty", "absent", "failed", "target", "none", "fingerprint", "kept", "clean").oneOf()
      settle(id, result)},
    s' = s,
  }

  val NoRetiredSuccess = s.retired.intersect(s.finished.keys()).forall(id => not(s.finished.get(id)))
  val LegacySelectionHasExactOwner = s.mode == "legacy" implies s.legacyOwner == s.owner
  val EditableRowsHaveCurrentStore = not(s.failed) implies
    (s.mode == "legacy" and s.storeEpoch == s.epoch and s.document > 0 and s.source != "")
  val CanonicalReturnClearsLegacyView = s.mode == "canonical" implies (s.rows == 0 and s.source == "")
  val safety = NoRetiredSuccess and LegacySelectionHasExactOwner and EditableRowsHaveCurrentStore and CanonicalReturnClearsLegacyView

  run retiredOpenCannotReportLaterSuccessTest = initBrowser.then(choose("legacy")).then(choose("canonical")).then(choose("legacy"))
    .then(settle(3, "saved")).then(settle(3, "target")).then(settle(1, "saved"))
    .expect(s.rows == 3 and s.finished.get(3) and not(s.finished.get(1)) and safety)
  run heldRetentionKeepsCurrentSourceTest = initBrowser.then(startRetention(1)).then(choose("legacy"))
    .expect(s.mode == "canonical" and s.pending.get(1).phase == "wait" and safety)
    .then(finishRetention(1)).then(settle(1, "absent"))
    .expect(s.status == "absent" and not(s.finished.get(1)) and safety)
  run supersededRetentionRefusesOldSelectionTest = initBrowser.then(startRetention(1)).then(choose("legacy"))
    .then(startRetention(2)).then(finishRetention(1))
    .expect(s.mode == "canonical" and not(s.finished.get(1)) and safety)
  run nativeDraftReadBeforeEditableTest = initDevice.then(choose("legacy")).then(settle(1, "saved"))
    .then(settle(1, "saved")).then(settle(1, "target"))
    .expect(s.rows == 0 and s.failed and s.pending.get(1).phase == "draft" and safety)
    .then(settle(1, "kept")).expect(s.rows == 1 and s.kept == 1 and not(s.failed) and safety)
  run unreadableDraftKeepsSavedRowsReadOnlyTest = initDevice.then(choose("legacy")).then(settle(1, "saved"))
    .then(settle(1, "saved")).then(settle(1, "target")).then(settle(1, "failed"))
    .expect(s.rows == 1 and s.status == "unreadable" and s.failed and not(s.finished.get(1)) and safety)
  run draftOnlyStorageRequiresReviewTest = initDevice.then(choose("legacy")).then(settle(1, "absent")).then(settle(1, "kept"))
    .expect(s.rows == 0 and s.status == "draft-only" and not(s.finished.get(1)) and safety)
  run ownerChangeDropsHeldFingerprintTest = initBrowser.then(choose("legacy")).then(settle(1, "empty"))
    .then(changeOwner("b")).then(settle(1, "fingerprint"))
    .expect(s.mode == "canonical" and s.canonical == "b" and not(s.finished.get(1)) and safety)
  run unretainedEditRefusesCanonicalReturnTest = initBrowser.then(choose("legacy")).then(settle(1, "saved"))
    .then(settle(1, "target")).then(failEdit(false)).then(choose("canonical"))
    .expect(s.mode == "legacy" and s.rows == 9 and not(s.finished.get(2)) and safety)
}
