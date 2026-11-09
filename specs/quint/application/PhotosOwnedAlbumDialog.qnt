module PhotosOwnedAlbumDialog {
  type Dialog = {generation: int, stage: str, album: str, name: str, selected: bool}
  type Control = {generation: int, stage: str}
  type Request = {operation: str, album: str, revision: str, name: str, media: str, mediaRevision: str}
  type State = {dialog: Dialog, generation: int, controls: int -> Control,
    active: bool, visible: bool, disposed: bool, busy: bool, pendingOwner: int,
    requests: List[Request], toasts: int}

  pure val noDialog = {generation: 0, stage: "closed", album: "", name: "", selected: false}
  pure val slots = Set(1, 2, 3)
  var s: State
  action init = s' = {dialog: noDialog, generation: 0, controls: Map(), active: true,
    visible: true, disposed: false, busy: false, pendingOwner: 0, requests: List(), toasts: 0}

  action openDialog(album: str): bool = all {
    s.active and s.visible and not(s.disposed) and s.generation < 4,
    album.in(Set("a", "b", "new", "selection")),
    (album.in(Set("new", "selection")) implies not(s.busy)),
    val nextGeneration = s.generation + 1
    s' = {...s, generation: nextGeneration, dialog: {generation: nextGeneration,
      stage: if (album == "new") "create" else if (album == "selection") "choose" else "manage",
      album: if (album.in(Set("new", "selection"))) "" else album,
      name: if (album == "a") "A" else if (album == "b") "B" else "", selected: album == "selection"}},
  }

  action renderDialog(slot: int): bool = all {
    slot.in(slots), s.dialog.generation != 0,
    s' = {...s, controls: s.controls.put(slot, {generation: s.dialog.generation, stage: s.dialog.stage})},
  }

  pure def current(st: State, control: Control): bool =
    st.active and st.visible and not(st.disposed) and st.dialog.generation != 0
      and st.dialog.generation == control.generation and st.dialog.stage == control.stage
  pure def naming(dialog: Dialog): bool = dialog.stage.in(Set("manage", "create"))
  pure def albumRevision(album: str): str = if (album == "a") "r-a" else if (album == "b") "r-b" else ""
  pure def dispatch(st: State, operation: str, album: str): State = {
    ...st, busy: true, pendingOwner: st.dialog.generation,
    requests: st.requests.append({operation: operation, album: album,
      revision: albumRevision(album), name: st.dialog.name,
      media: if (st.dialog.selected) "m:1" else "", mediaRevision: if (st.dialog.selected) "mr1" else ""}),
  }

  action invoke(slot: int, verb: str, name: str): bool = all {
    s.controls.keys().contains(slot),
    verb.in(Set("name", "ask", "save", "delete", "close", "chooseCreate", "chooseA")),
    val dialog = s.dialog
    s' = if (not(current(s, s.controls.get(slot)))) s
      else if (verb == "close") {...s, dialog: noDialog}
      else if (verb == "name" and naming(dialog)) {...s, dialog: {...dialog, name: name}}
      else if (verb == "ask" and dialog.stage == "manage" and not(s.busy))
        {...s, dialog: {...dialog, stage: "delete"}}
      else if (verb == "chooseCreate" and dialog.stage == "choose" and not(s.busy))
        {...s, dialog: {...dialog, stage: "create"}}
      else if (verb == "chooseA" and dialog.stage == "choose" and not(s.busy) and s.requests.length() < 4)
        dispatch(s, "add", "a")
      else if (verb == "save" and naming(dialog) and not(s.busy) and s.requests.length() < 4)
        dispatch(s, if (dialog.stage == "create") "create" else "rename", dialog.album)
      else if (verb == "delete" and dialog.stage == "delete" and not(s.busy) and s.requests.length() < 4)
        dispatch(s, "delete", dialog.album)
      else s,
  }

  action finish(success: bool): bool = all {
    s.busy,
    val currentOwner = not(s.disposed) and s.active and s.dialog.generation == s.pendingOwner
    val request = s.requests.nth(s.requests.length() - 1)
    s' = {...s, busy: false, pendingOwner: 0,
      dialog: if (currentOwner and success) noDialog else s.dialog,
      toasts: if (currentOwner and (not(success) or request.operation == "delete" or request.media != "")) s.toasts + 1 else s.toasts},
  }

  action visibility(visible: bool): bool = s' = {...s, visible: visible}
  action leave = s' = {...s, active: false, dialog: noDialog}
  action enter = all {not(s.disposed), s' = {...s, active: true}}
  action dispose = s' = {...s, disposed: true, active: false, dialog: noDialog}

  action step = any {
    { nondet album = Set("a", "b", "new", "selection").oneOf(); openDialog(album) },
    { nondet slot = slots.oneOf(); renderDialog(slot) },
    { nondet slot = slots.oneOf()
      nondet verb = Set("name", "ask", "save", "delete", "close", "chooseCreate", "chooseA").oneOf()
      invoke(slot, verb, "edited") },
    { nondet answer = Bool.oneOf(); any {finish(answer), visibility(answer)} },
    leave, enter, dispose, s' = s,
  }

  val ExactAlbumRevision = s.requests.indices().forall(i => {
    val request = s.requests.nth(i)
    request.revision == albumRevision(request.album)
      and (if (request.operation == "create") request.album == "" else request.album.in(Set("a", "b")))
      and (if (request.media == "") request.mediaRevision == "" else request.media == "m:1" and request.mediaRevision == "mr1")
  })
  val PendingOwnsARequest = s.busy == (s.pendingOwner != 0)
    and (s.busy implies (s.pendingOwner <= s.generation and s.requests.length() > 0))
  val safety = ExactAlbumRevision and PendingOwnsARequest

  run replacementRetiresControlsTest = init.then(openDialog("a")).then(renderDialog(1))
    .then(invoke(1, "close", "")).then(openDialog("b")).then(renderDialog(2))
    .then(invoke(1, "name", "stale")).then(invoke(1, "save", "")).then(invoke(1, "close", ""))
    .expect(s.dialog.name == "B" and s.requests == List() and safety)
    .then(invoke(2, "save", ""))
    .expect(s.requests == List({operation: "rename", album: "b", revision: "r-b", name: "B", media: "", mediaRevision: ""}))
  run deleteNeedsFreshControlsTest = init.then(openDialog("a")).then(renderDialog(1))
    .then(invoke(1, "ask", "")).then(invoke(1, "save", "")).then(invoke(1, "delete", ""))
    .expect(s.dialog.stage == "delete" and s.requests == List())
    .then(renderDialog(2)).then(invoke(2, "delete", "")).then(finish(true))
    .expect(s.dialog.stage == "closed" and s.toasts == 1 and safety)
  run lateCompletionDoesNotCloseSuccessorTest = init.then(openDialog("a")).then(renderDialog(1))
    .then(invoke(1, "save", "")).then(invoke(1, "close", "")).then(openDialog("b"))
    .then(finish(true)).expect(s.dialog.name == "B" and not(s.busy) and safety)
  run hiddenAndDepartedRejectControlTest = init.then(openDialog("new")).then(renderDialog(1))
    .then(visibility(false)).then(invoke(1, "save", "")).then(visibility(true)).then(leave)
    .then(enter).then(openDialog("new")).then(invoke(1, "save", ""))
    .expect(s.dialog.stage == "create" and s.requests == List() and safety)
  run chooserStageRetiresMembershipControlsTest = init.then(openDialog("selection")).then(renderDialog(1))
    .then(invoke(1, "chooseCreate", "")).then(invoke(1, "chooseA", "")).expect(s.requests == List())
    .then(renderDialog(2)).then(invoke(2, "name", "New collection")).then(invoke(2, "save", ""))
    .expect(s.requests == List({operation: "create", album: "", revision: "", name: "New collection", media: "m:1", mediaRevision: "mr1"}) and safety)
}
