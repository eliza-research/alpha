// Native Photos Recently deleted loader, including hidden/resumed ownership.
module PhotosTrash {
  import PhotosWindow.Row from "./PhotosWindow"
  import PhotosWindow.validRows from "./PhotosWindow"
  import PhotosWindow.sorted from "./PhotosWindow"
  import PhotosWindow.merged from "./PhotosWindow"
  type State = {hidden: bool, active: bool, disposed: bool, rows: List[Row], loaded: bool,
    loading: bool, pending: bool, next: int, epoch: int, again: bool,
    job: int, token: int, more: bool, error: bool}
  var s: State
  pure def start(value: State, more: bool): State =
    if (value.disposed or value.hidden) value
    else if (value.loading) {...value, again: true}
    else {...value, loading: true, pending: true, epoch: value.epoch + 1,
      job: value.job + 1, token: value.epoch + 1, more: more}
  pure def finish(value: State): State = {
    val ready = {...value, loading: false, pending: false}
    if (not(value.again) or value.disposed) ready else start({...ready, again: false}, false)
  }
  action init = s' = {hidden: false, active: true, disposed: false, rows: List(), loaded: false,
    loading: false, pending: false, next: 0, epoch: 0, again: false, job: 0, token: 0, more: false, error: false}
  action request(more: bool): bool = all {s.job < 4, s.epoch < 6, s' = start(s, more)}
  action reply(rows: List[Row], cursor: int, success: bool): bool = all {
    s.loading, validRows(rows), cursor.in(0.to(2)), s.job < 4 or not(s.again), s.epoch < 6 or not(s.again),
    {val current = not(s.disposed) and not(s.hidden) and s.token == s.epoch
      val result = if (not(current)) s else
        if (success) {...s, rows: if (s.more) merged(s.rows, rows) else sorted(rows),
          next: cursor, loaded: true, error: false}
        else {...s, error: true}
      s' = finish(result)}}
  action hide = all {s.epoch < 6,
    s' = if (s.disposed) {...s, hidden: true} else {...s, hidden: true,
      epoch: s.epoch + 1, rows: List(), next: 0, loaded: false}}
  action show = all {s.job < 4, s.epoch < 6,
    {val visible = {...s, hidden: false}
      s' = if (s.active and not(s.disposed) and not(s.loaded)) start(visible, false) else visible}}
  action leave = s' = {...s, active: false}
  action enter = all {s.job < 4, s.epoch < 6,
    {val active = {...s, active: true}
      s' = if (not(s.loaded) and not(s.loading)) start(active, false) else active}}
  action dispose = s' = {...s, disposed: true}
  action step = any {hide, show, leave, enter, dispose,
    {nondet more = Bool.oneOf(); request(more)},
    {nondet rows = Set(List(), List({id: 1, rank: 1, revision: 1}), List({id: 2, rank: 2, revision: 1}),
      List({id: 1, rank: 2, revision: 2}, {id: 3, rank: 3, revision: 1})).oneOf();
      nondet cursor = 0.to(2).oneOf(); nondet success = Bool.oneOf(); reply(rows, cursor, success)}, s' = s}
  val TypeOK = validRows(s.rows) and s.next.in(0.to(2)) and s.epoch.in(0.to(6)) and s.job.in(0.to(4))
  val HiddenRowsCleared = s.hidden and not(s.disposed) implies s.rows.length() == 0 and not(s.loaded)
  val LoadingOwnsRequest = s.loading == s.pending
  val safety = TypeOK and HiddenRowsCleared and LoadingOwnsRequest
  run resumeReloadsClearedTrashTest = init.then(request(false)).then(reply(List({id: 1, rank: 1, revision: 1}), 0, true))
    .then(hide).expect(not(s.loaded)).then(show).expect(s.loading and s.job == 2 and safety)
  run hiddenReplyCannotRepopulateTest = init.then(request(false)).then(hide)
    .then(reply(List({id: 1, rank: 1, revision: 1}), 0, true)).expect(s.rows == List() and not(s.loaded) and safety)
  run resumedPendingReadQueuesCurrentTest = init.then(request(false)).then(hide).then(show)
    .then(reply(List({id: 1, rank: 1, revision: 1}), 0, true)).expect(s.loading and s.job == 2 and s.rows == List() and safety)
  run oldHiddenFailureIsQuietTest = init.then(request(false)).then(hide).then(reply(List(), 0, false))
    .expect(not(s.error) and safety)
  run disposedReplyDoesNotPublishTest = init.then(request(false)).then(dispose)
    .then(reply(List({id: 1, rank: 1, revision: 1}), 0, true)).expect(s.rows == List() and not(s.loading) and safety)
}
