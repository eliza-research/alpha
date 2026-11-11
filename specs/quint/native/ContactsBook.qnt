// Address-book reads, owner editing and agent-proposed create/edit/delete with owner approval.
module ContactsBook {
  type State = {
    image: bool, permission: bool, front: bool, epoch: int,
    list: str, listEpoch: int,
    exists: bool, revision: int,
    editor: str, editorBase: int, dirty: bool,
    confirmDelete: bool,
    proposal: str, proposalKind: str, proposalBase: int,
    ownerWrites: int, agentWrites: int, approvals: int, notice: str
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    image: false, permission: false, front: true, epoch: 0,
    list: "none", listEpoch: -1,
    exists: true, revision: 0,
    editor: "closed", editorBase: -1, dirty: false,
    confirmDelete: false,
    proposal: "none", proposalKind: "none", proposalBase: -1,
    ownerWrites: 0, agentWrites: 0, approvals: 0, notice: "none"
  }
  val ready = s.image and s.permission and s.front
  action admitImage = s' = {image: true, ...s}
  action grant = all { s.image, s' = {permission: true, ...s} }
  // Losing access closes every surface that shows or mutates a contact.
  action revoke = all {
    s.epoch < 3,
    s' = {permission: false, epoch: s.epoch + 1, list: "none", editor: "closed", dirty: false,
      confirmDelete: false,
      proposal: if (s.proposal == "proposed") "stale" else s.proposal, ...s}
  }
  // Backgrounding or locking keeps an unsaved editor but retires reads and pending approvals.
  action pause = all {
    s.epoch < 3,
    s' = {front: false, epoch: s.epoch + 1, list: "none", confirmDelete: false,
      proposal: if (s.proposal == "proposed") "stale" else s.proposal, ...s}
  }
  action resume = s' = {front: true, ...s}
  action beginRead = all { ready, s' = {list: "reading", listEpoch: s.epoch, ...s} }
  action readReply(ticket: int, ok: bool): bool =
    if (s.list == "reading" and ticket == s.listEpoch and ticket == s.epoch and ready)
      s' = s.with("list", if (ok) "loaded" else "failed")
    else s' = s
  // Another app or sync changes the same contact.
  action externalChange = all {
    s.exists, s.revision < 3,
    s' = {revision: s.revision + 1,
      proposal: if (s.proposal == "proposed") "stale" else s.proposal, ...s}
  }
  action externalDelete = all {
    s.exists,
    s' = {exists: false, confirmDelete: false,
      proposal: if (s.proposal == "proposed" and s.proposalKind != "create") "stale" else s.proposal, ...s}
  }
  action openCreate = all {
    ready, s.editor == "closed",
    s' = {editor: "creating", editorBase: -1, dirty: false, notice: "none", ...s}
  }
  action openEdit = all {
    ready, s.list == "loaded", s.exists, s.editor == "closed",
    s' = {editor: "editing", editorBase: s.revision, dirty: false, notice: "none", ...s}
  }
  action typeText = all { s.editor != "closed", s' = {dirty: true, ...s} }
  action cancelEditor = all { s.editor != "closed", s' = {editor: "closed", dirty: false, ...s} }
  // A save against a changed or removed contact keeps the editor and reports the conflict.
  action save(ok: bool): bool = all {
    ready, s.editor != "closed", s.dirty, s.revision < 3,
    if (s.editor == "editing" and (not(s.exists) or s.editorBase != s.revision))
      s' = {notice: "conflict", ...s}
    else if (not(ok)) s' = {notice: "failed", ...s}
    else s' = {exists: true, revision: s.revision + 1, editor: "closed", dirty: false,
      ownerWrites: s.ownerWrites + 1, notice: "saved",
      proposal: if (s.proposal == "proposed") "stale" else s.proposal, ...s}
  }
  action askDelete = all {
    ready, s.list == "loaded", s.exists, s.editor == "closed", s' = {confirmDelete: true, ...s}
  }
  action cancelDelete = all { s.confirmDelete, s' = {confirmDelete: false, ...s} }
  action confirmDeleteNow(ok: bool): bool = all {
    ready, s.confirmDelete, s.exists,
    s' = if (ok) {exists: false, confirmDelete: false, ownerWrites: s.ownerWrites + 1, notice: "deleted",
        proposal: if (s.proposal == "proposed" and s.proposalKind != "create") "stale" else s.proposal, ...s}
      else {confirmDelete: false, notice: "failed", ...s}
  }
  // The agent may only propose. Edit and delete bind the revision the agent was shown.
  action propose(kind: str): bool = all {
    ready, s.proposal.in(Set("none", "applied", "declined", "stale", "failed")),
    kind.in(Set("create", "edit", "delete")),
    kind == "create" or s.exists,
    s' = {proposal: "proposed", proposalKind: kind, proposalBase: if (kind == "create") -1 else s.revision, ...s}
  }
  action decline = all { s.proposal == "proposed", s' = {proposal: "declined", ...s} }
  action approve(ok: bool): bool = all {
    ready, s.proposal == "proposed", s.revision < 3,
    if (s.proposalKind != "create" and (not(s.exists) or s.proposalBase != s.revision))
      s' = {proposal: "stale", ...s}
    else if (not(ok)) s' = {proposal: "failed", approvals: s.approvals + 1, ...s}
    else s' = {proposal: "applied", approvals: s.approvals + 1, agentWrites: s.agentWrites + 1,
      exists: s.proposalKind != "delete", revision: s.revision + 1,
      confirmDelete: false, ...s}
  }
  // A repeated approval or replayed operation id changes nothing.
  action repeat = s' = s
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet kind = Set("create", "edit", "delete").oneOf()
    any { admitImage, grant, revoke, pause, resume, beginRead, readReply(ticket, flag), externalChange,
      externalDelete, openCreate, openEdit, typeText, cancelEditor, save(flag), askDelete, cancelDelete,
      confirmDeleteNow(flag), propose(kind), decline, approve(flag), repeat }
  }
  val ListCurrent = s.list == "loaded" implies s.listEpoch == s.epoch and ready
  val AgentWritesNeedApproval = s.agentWrites <= s.approvals
  val AppliedProposalWasCurrent = s.proposal == "applied" implies s.agentWrites > 0
  val PendingProposalIsCurrent = s.proposal == "proposed" implies
    ready and (s.proposalKind == "create" or (s.exists and s.proposalBase == s.revision))
  val DeleteConfirmNeedsContact = s.confirmDelete implies s.exists and ready
  val EditorNeedsPermission = s.editor != "closed" implies s.image and s.permission
  val CleanEditorHasNoDirt = s.editor == "closed" implies not(s.dirty)
  val safety = ListCurrent and AgentWritesNeedApproval and AppliedProposalWasCurrent and
    PendingProposalIsCurrent and DeleteConfirmNeedsContact and EditorNeedsPermission and CleanEditorHasNoDirt

  run ownerEditSavesTest = init.then(admitImage).then(grant).then(beginRead).then(readReply(0, true))
    .then(openEdit).then(typeText).then(save(true))
    .then(check(safety and s.revision == 1 and s.ownerWrites == 1 and s.editor == "closed"))
  run editConflictKeepsEditorTest = init.then(admitImage).then(grant).then(beginRead).then(readReply(0, true))
    .then(openEdit).then(typeText).then(externalChange).then(save(true))
    .then(check(safety and s.notice == "conflict" and s.editor == "editing" and s.ownerWrites == 0))
  run staleReadAfterPauseTest = init.then(admitImage).then(grant).then(beginRead).then(pause).then(resume)
    .then(readReply(0, true)).then(check(safety and s.list == "none"))
  run agentEditNeedsApprovalTest = init.then(admitImage).then(grant).then(propose("edit"))
    .then(check(s.agentWrites == 0 and s.revision == 0)).then(approve(true))
    .then(check(safety and s.agentWrites == 1 and s.revision == 1 and s.proposal == "applied"))
  run agentEditGoesStaleTest = init.then(admitImage).then(grant).then(propose("edit")).then(externalChange)
    .then(check(s.proposal == "stale")).then(repeat)
    .then(check(safety and s.agentWrites == 0))
  run agentDeleteOfRemovedContactTest = init.then(admitImage).then(grant).then(propose("delete"))
    .then(externalDelete).then(check(safety and s.proposal == "stale" and s.agentWrites == 0))
  run declinedProposalWritesNothingTest = init.then(admitImage).then(grant).then(propose("create")).then(decline)
    .then(check(safety and s.agentWrites == 0 and s.approvals == 0))
  run failedApprovalIsNotAppliedTest = init.then(admitImage).then(grant).then(propose("create")).then(approve(false))
    .then(check(safety and s.proposal == "failed" and s.agentWrites == 0))
  run ownerDeleteConfirmsTest = init.then(admitImage).then(grant).then(beginRead).then(readReply(0, true))
    .then(askDelete).then(confirmDeleteNow(true)).then(check(safety and not(s.exists) and s.notice == "deleted"))
  run revokeClosesEditorTest = init.then(admitImage).then(grant).then(openCreate).then(typeText).then(revoke)
    .then(check(safety and s.editor == "closed"))
}
