/// The Contacts view's in-memory address-book read: availability, epoch fence and loading flag.
module ContactsSession {
  type State = {
    // The view is open, admitted by the image and the page is visible; `active` is the adapter's copy.
    viewOpen: bool, admitted: bool, hidden: bool, active: bool,
    epoch: int, reads: Set[int], loading: bool, editorOpen: bool,
    readable: bool, rows: bool, more: bool, limit: int
  }
  var s: State
  action init = s' = {
    viewOpen: false, admitted: true, hidden: false, active: false,
    epoch: 0, reads: Set(), loading: false, editorOpen: false,
    readable: false, rows: false, more: false, limit: 1
  }
  pure def availableIn(v: State): bool = v.viewOpen and v.admitted and not(v.hidden)
  /// The environment changed and the adapter synchronised: becoming available starts a read,
  /// becoming unavailable clears rows, access and the loading flag under a new epoch.
  def synced(target: State): State =
    if (availableIn(target) == s.active) target
    else if (availableIn(target))
      { ...target, active: true, epoch: s.epoch + 1, reads: s.reads.union(Set(s.epoch + 1)), loading: true }
    else { ...target, active: false, epoch: s.epoch + 1, rows: false, readable: false, more: false, loading: false }
  /// A deferred view is not offered, so it cannot be opened.
  action openView = all { not(s.viewOpen), s.admitted, s.epoch < 6, s' = synced({ ...s, viewOpen: true }) }
  action closeView = all { s.viewOpen, s.epoch < 6, s' = synced({ ...s, viewOpen: false }) }
  action hide = all { not(s.hidden), s.epoch < 6, s' = synced({ ...s, hidden: true }) }
  action show = all { s.hidden, s.epoch < 6, s' = synced({ ...s, hidden: false }) }
  /// The image withdraws or restores Contacts. An open view leaves before the view is deferred.
  action admission(admitted: bool): bool = all {
    s.admitted != admitted, s.epoch < 6,
    s' = synced({ ...s, admitted: admitted, viewOpen: s.viewOpen and admitted })
  }
  /// A refresh, a return to the app or a permission request. Rows already shown stay until it answers.
  action refresh = all {
    s.epoch < 6,
    s' = if (s.active) { ...s, epoch: s.epoch + 1, reads: s.reads.union(Set(s.epoch + 1)), loading: true }
      else { ...s, epoch: s.epoch + 1 }
  }
  action loadMore = all {
    s.active, s.more, s.limit < 4, s.epoch < 6,
    s' = { ...s, limit: s.limit + 1, epoch: s.epoch + 1, reads: s.reads.union(Set(s.epoch + 1)), loading: true }
  }
  action search = all {
    s.active, s.epoch < 6,
    s' = { ...s, limit: 1, epoch: s.epoch + 1, reads: s.reads.union(Set(s.epoch + 1)), loading: true }
  }
  /// A read answers: no access, a page of rows, or a failure. A superseded read changes nothing.
  action readCompletes(token: int, outcome: str, more: bool): bool = all {
    token.in(s.reads), outcome.in(Set("no-access", "rows", "error")),
    s' = if (token != s.epoch) { ...s, reads: s.reads.exclude(Set(token)) }
      else { ...s, reads: s.reads.exclude(Set(token)), loading: false,
        readable: if (outcome == "error") s.readable else outcome == "rows",
        rows: outcome == "rows", more: outcome == "rows" and more }
  }
  /// The system contact editor opens over the view and, on return, the list is read again.
  action openEditor = all {
    s.active, not(s.loading), not(s.editorOpen), s' = { ...s, loading: true, editorOpen: true }
  }
  action editorReturned = all {
    s.editorOpen, s.epoch < 6,
    s' = if (s.active) { ...s, editorOpen: false, epoch: s.epoch + 1, reads: s.reads.union(Set(s.epoch + 1)), loading: true }
      else { ...s, editorOpen: false, epoch: s.epoch + 1, loading: false }
  }
  action step = {
    nondet token = 0.to(6).oneOf()
    nondet outcome = Set("no-access", "rows", "error").oneOf()
    nondet more = Set(true, false).oneOf()
    nondet admitted = Set(true, false).oneOf()
    any { openView, closeView, hide, show, admission(admitted), refresh, loadMore, search,
      readCompletes(token, outcome, more), openEditor, editorReturned, s' = s }
  }
  val ActiveMatchesAvailability = s.active == availableIn(s)
  val InactiveHoldsNoRows = not(s.active) implies not(s.rows or s.readable or s.more)
  val RowsNeedAccess = s.rows implies s.readable
  val MoreNeedsRows = s.more implies s.rows
  /// The loading flag always has a current read or an open editor that will clear it.
  val LoadingHasCurrentWork = s.loading implies s.epoch.in(s.reads) or s.editorOpen
  val DeferredViewNotOpen = not(s.admitted) implies not(s.viewOpen)
  val TypeOK = s.epoch.in(0.to(6)) and s.limit.in(1.to(4)) and s.reads.subseteq(1.to(6))
  val safety = TypeOK and ActiveMatchesAvailability and InactiveHoldsNoRows and RowsNeedAccess and
    MoreNeedsRows and LoadingHasCurrentWork and DeferredViewNotOpen

  val RowsKeptWhileLoadingWitness = s.rows and s.loading and not(s.editorOpen)
  val SupersededReadWitness = s.active and s.reads.exists(token => token != s.epoch)
  val RevokedWhileOpenWitness = not(s.admitted) and not(s.active) and s.epoch > 1
  val EditorOverLoadedListWitness = s.editorOpen and s.rows

  run readRowsTest = init.then(openView).expect(s.loading).then(readCompletes(1, "rows", true))
    .expect(s.rows and s.more and not(s.loading) and safety)
    .then(loadMore).expect(RowsKeptWhileLoadingWitness and s.limit == 2)
    .then(readCompletes(2, "rows", false)).expect(not(s.more or s.loading) and safety)
  /// Leaving while a read is in flight clears the loading flag, and the late answer shows nothing.
  run answerAfterLeaveTest = init.then(openView).then(closeView)
    .expect(not(s.loading) and not(s.active))
    .then(readCompletes(1, "rows", true)).expect(not(s.rows or s.loading) and safety)
  run supersededReadTest = init.then(openView).then(search).then(readCompletes(2, "rows", false))
    .then(readCompletes(1, "no-access", false)).expect(s.rows and s.readable and safety)
  /// Losing the image's Contacts admission while the view is open closes it and clears the rows.
  run revokedWhileOpenTest = init.then(openView).then(readCompletes(1, "rows", false))
    .then(admission(false)).expect(RevokedWhileOpenWitness and not(s.viewOpen or s.rows) and safety)
    .then(admission(true)).expect(not(s.active) and safety)
  run editorReturnRereadsTest = init.then(openView).then(readCompletes(1, "rows", false)).then(openEditor)
    .expect(EditorOverLoadedListWitness and s.loading).then(editorReturned)
    .expect(s.loading and s.epoch == 2).then(readCompletes(2, "rows", false))
    .expect(not(s.loading) and safety)
  run noAccessTest = init.then(openView).then(readCompletes(1, "no-access", false))
    .expect(not(s.rows or s.readable or s.loading) and safety)
}
