/// The agent's phone-side Calendar operations (device actions on the phone's own calendar):
/// create, read next, read/update/delete the selected event. None is on the direct allow-list;
/// every one needs the owner's card, and the native calendar then shows its own review, which
/// the owner may cancel. A delete is queued with a short Undo window and is reported as unknown
/// until that window settles. Canonical Calendar edits by the agent are AgentCalendarMutation;
/// admission, journal and claim are DeviceActionReview; the deletion journal is DeletionJournal.
module CalendarAgentWrites {
  type State = {
    op: str, authority: str, view: str, sensitive: bool, hidden: bool, permission: str,
    selected: bool, targetCurrent: bool, native: str, outcome: str,
    events: int, edits: int, shared: int, queued: bool, queues: int, deleted: int, undone: int,
    appliedSelected: bool, appliedCurrent: bool}
  var s: State
  pure val unbound = Set("calendar_create_local", "calendar_read_next")
  pure val selectedOps = Set("calendar_create", "calendar_read_selected", "calendar_update", "calendar_delete")
  pure val writes = Set("calendar_create_local", "calendar_create", "calendar_update", "calendar_delete")
  action init = s' = {op: "calendar_create_local", authority: "none", view: "home", sensitive: false,
    hidden: false, permission: "granted", selected: false, targetCurrent: true, native: "none",
    outcome: "none", events: 0, edits: 0, shared: 0, queued: false, queues: 0, deleted: 0, undone: 0,
    appliedSelected: true, appliedCurrent: true}
  val idle = s.authority == "none"
  val running = not(idle) and s.outcome == "none"
  /// Screen binding: the selected-record operations need Calendar with that record selected.
  val bound = not(s.sensitive) and not(s.hidden) and
    (s.op.in(unbound) or (s.view == "calendar" and s.selected))
  action scene(view: str, sensitive: bool, selected: bool, permission: str): bool = all {idle,
    view.in(Set("home", "calendar")), permission.in(Set("granted", "denied")),
    s' = {...s, view: view, sensitive: sensitive, selected: selected, permission: permission,
      hidden: false, targetCurrent: true}}
  action propose(op: str): bool = all {idle, not(s.queued), op.in(unbound.union(selectedOps)),
    s' = {...s, op: op, native: "none", outcome: "none"}}
  action eventChanges = s' = {...s, targetCurrent: false}
  action hide = s' = {...s, hidden: true}
  /// There is no direct path: the only way in is the owner's card on the bound screen.
  action approve = all {idle, bound, s' = {...s, authority: "review"}}
  /// Create-on-phone and read-next ask for Calendar access first.
  action permissionRefused = all {running, s.native == "none", s.op.in(unbound),
    s.permission != "granted" or not(bound), s' = {...s, outcome: "unknown"}}
  action nativeReview = all {running, s.native == "none", bound,
    s.op.in(unbound) implies s.permission == "granted", s' = {...s, native: "reviewing"}}
  action nativeCancel = all {running, s.native == "reviewing", s' = {...s, native: "cancelled", outcome: "failed"}}
  /// The native side re-reads the selected record; a changed record is refused there.
  action nativeTargetChanged = all {running, s.native == "reviewing", s.op.in(selectedOps),
    not(s.targetCurrent), s' = {...s, native: "refused", outcome: "failed"}}
  action nativeApply = all {running, s.native == "reviewing",
    s.op.in(selectedOps) implies s.targetCurrent, s.op != "calendar_delete",
    s' = {...s, native: "applied", outcome: "succeeded",
      appliedSelected: s.op.in(unbound) or s.selected, appliedCurrent: s.targetCurrent,
      events: s.events + (if (s.op.in(Set("calendar_create_local", "calendar_create"))) 1 else 0),
      edits: s.edits + (if (s.op == "calendar_update") 1 else 0),
      shared: s.shared + (if (s.op.in(Set("calendar_read_next", "calendar_read_selected"))) 1 else 0)}}
  /// A delete is only queued; the receipt says unknown while Undo is still possible.
  action nativeQueueDelete = all {running, s.native == "reviewing", s.op == "calendar_delete",
    s.targetCurrent, s' = {...s, native: "queued", queued: true, queues: s.queues + 1, outcome: "unknown"}}
  action nativeUnknown = all {running, s.native == "reviewing", s' = {...s, native: "unknown", outcome: "unknown"}}
  action undo = all {s.queued, s' = {...s, queued: false, undone: s.undone + 1}}
  action windowEnds = all {s.queued, s' = {...s, queued: false, deleted: s.deleted + 1}}
  action settle = all {not(idle), s.outcome != "none", s' = {...s, authority: "none", outcome: "none", native: "none"}}
  action step = any {
    scene("home", false, false, "granted"), scene("home", false, false, "denied"),
    scene("calendar", false, true, "granted"), scene("calendar", false, false, "granted"),
    scene("calendar", true, true, "granted"),
    propose("calendar_create_local"), propose("calendar_read_next"), propose("calendar_create"),
    propose("calendar_read_selected"), propose("calendar_update"), propose("calendar_delete"),
    eventChanges, hide, approve, permissionRefused, nativeReview, nativeCancel, nativeTargetChanged,
    nativeApply, nativeQueueDelete, nativeUnknown, undo, windowEnds, settle}

  val NoCalendarOperationIsDirect = s.authority.in(Set("none", "review"))
  val CreateNeedsNativeConfirm = (s.outcome == "succeeded") implies s.native == "applied"
  val UpdateBoundToSelectedRevision = (s.outcome == "succeeded" and s.op.in(selectedOps)) implies
    (s.appliedSelected and s.appliedCurrent)
  val QueuedDeleteIsUnknownUntilSettled = (s.op == "calendar_delete" and not(idle)) implies s.outcome != "succeeded"
  /// Every queued delete ends exactly once: deleted when the window ends, or undone.
  val UndoneDeleteDeletesNothing = s.deleted + s.undone + (if (s.queued) 1 else 0) == s.queues
  val CancelledReviewChangesNothing = s.native == "cancelled" implies s.outcome == "failed"
  val ProtectedScreenBlocksCalendar = (s.sensitive and not(idle)) implies s.native == "none"
  val safety = NoCalendarOperationIsDirect and CreateNeedsNativeConfirm and UpdateBoundToSelectedRevision and
    QueuedDeleteIsUnknownUntilSettled and UndoneDeleteDeletesNothing and CancelledReviewChangesNothing and
    ProtectedScreenBlocksCalendar

  /// KNOWN DIVERGENCE (app review AGENT-06, phone side): denied Calendar access, or a screen that
  /// changed while access was asked, throws in the executor before the native calendar is
  /// called. Nothing happened, yet the action is journaled and reported as "unknown".
  /// Registered as an expected violation.
  val UnknownOnlyAfterNativeCall = s.outcome == "unknown" implies s.native != "none"
  val UnknownWithoutNativeCall = s.outcome == "unknown" and s.native == "none"

  run createNeedsBothReviewsTest = init.then(approve).then(nativeReview)
    .expect(safety and s.events == 0).then(nativeApply).expect(safety and s.events == 1)
  run nativeCancelTest = init.then(approve).then(nativeReview).then(nativeCancel)
    .expect(safety and s.events == 0 and s.outcome == "failed")
  run updateNeedsSelectionTest = init.then(propose("calendar_update"))
    .expect(not(bound)).then(scene("calendar", false, true, "granted")).then(approve).then(nativeReview)
    .then(nativeApply).expect(safety and s.edits == 1)
  run changedEventTest = init.then(scene("calendar", false, true, "granted")).then(propose("calendar_update"))
    .then(approve).then(nativeReview).then(eventChanges).then(nativeTargetChanged)
    .expect(safety and s.edits == 0 and s.outcome == "failed")
  run queuedDeleteTest = init.then(scene("calendar", false, true, "granted")).then(propose("calendar_delete"))
    .then(approve).then(nativeReview).then(nativeQueueDelete)
    .expect(safety and s.outcome == "unknown" and s.deleted == 0).then(windowEnds)
    .expect(safety and s.deleted == 1)
  run undoneDeleteTest = init.then(scene("calendar", false, true, "granted")).then(propose("calendar_delete"))
    .then(approve).then(nativeReview).then(nativeQueueDelete).then(undo)
    .expect(safety and s.deleted == 0 and s.undone == 1)
  run deniedAccessTest = init.then(scene("home", false, false, "denied")).then(approve).then(permissionRefused)
    .expect(safety and UnknownWithoutNativeCall and not(UnknownOnlyAfterNativeCall) and s.events == 0)
}
