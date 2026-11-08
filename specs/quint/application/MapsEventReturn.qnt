// View-owned Calendar return from the Maps renderer.
module MapsEventReturn {
  type Origin = {event: str, kind: str}
  type Attempt = {origin: int, aborted: bool, settled: bool}
  type Opened = {origin: int, event: str, kind: str, day: int}
  type State = {view: str, visible: bool, suspended: bool, disposed: bool, navigating: bool,
    calendarStack: bool, origin: int, lastOrigin: int, origins: int -> Origin, active: int,
    lastId: int, attempts: int -> Attempt, opened: List[Opened], notices: List[str], unwinds: int}
  var s: State

  pure val Events = Set("A", "B")
  pure val Kinds = Set("canonical", "native")
  pure val Origins = 1.to(6)
  pure val IDs = 1.to(5)
  pure val Replies = Set("found", "missing", "unknown", "permission", "ambiguous", "rejected")
  pure val NoOrigin: Origin = {event: "", kind: ""}
  pure val NoAttempt: Attempt = {origin: 0, aborted: false, settled: false}

  action init = s' = {view: "home", visible: true, suspended: false, disposed: false,
    navigating: false, calendarStack: false, origin: 0, lastOrigin: 0, origins: Origins.mapBy(_ => NoOrigin),
    active: 0, lastId: 0, attempts: IDs.mapBy(_ => NoAttempt), opened: List(), notices: List(), unwinds: 0}

  pure def retire(value: State): State =
    if (value.active == 0) value
    else {...value, active: 0, attempts: value.attempts.set(value.active,
      {...value.attempts.get(value.active), aborted: true})}
  pure def canReturn(value: State, origin: int): bool =
    not(value.disposed or value.suspended or value.navigating) and value.visible and value.view == "maps"
      and value.calendarStack and origin != 0 and origin == value.origin
  action enter(event: str, kind: str): bool = all {
    not(s.disposed), s.lastOrigin < 6, Events.contains(event), Kinds.contains(kind),
    val id = s.lastOrigin + 1
    s' = {...s, view: "maps", navigating: false, calendarStack: true, origin: id, lastOrigin: id,
      origins: s.origins.set(id, {event: event, kind: kind})},
  }
  action leave = all {
    s.view == "maps", not(s.disposed),
    s' = retire({...s, view: "home", calendarStack: false, navigating: false}),
  }
  action hide = all {s.visible, not(s.disposed), s' = retire({...s, visible: false})}
  action show = all {not(s.visible), not(s.disposed), s' = {...s, visible: true}}
  action pagehide = all {not(s.disposed or s.suspended), s' = retire({...s, suspended: true})}
  action pageshow = all {s.suspended, not(s.disposed), s' = {...s, suspended: false}}
  action dispose = all {not(s.disposed), s' = retire({...s, disposed: true})}
  action setNavigation(active: bool): bool = all {
    s.view == "maps", not(s.disposed),
    s' = {...s, navigating: active},
  }
  action setStack(calendar: bool): bool = all {
    s.view == "maps", not(s.disposed),
    s' = {...s, calendarStack: calendar},
  }

  action tap(origin: int): bool = all {
    origin.in(1.to(s.lastOrigin)), s.lastId < 5,
    val current = s.active != 0 and s.attempts.get(s.active).origin == origin
    val base = retire(s)
    val id = s.lastId + 1
    s' = if (not(canReturn(s, origin)) or current) s
      else {...base, active: id, lastId: id, attempts: base.attempts.set(id, {...NoAttempt, origin: origin})},
  }
  pure def applyReply(value: State, origin: int, reply: str): State =
    if (reply == "found") {
      val ref = value.origins.get(origin)
      retire({...value, view: "calendar", calendarStack: false, unwinds: value.unwinds + 1,
        opened: value.opened.append({origin: origin, event: ref.event, kind: ref.kind,
          day: if (ref.event == "A") 1 else 2})})
    } else if (reply == "missing" or reply == "ambiguous")
      {...value, origin: 0, notices: value.notices.append("missing")}
    else {...value, notices: value.notices.append(if (reply == "permission") "permission" else "unknown")}
  action reply(id: int, outcome: str): bool = all {
    id.in(1.to(s.lastId)), Replies.contains(outcome),
    val attempt = s.attempts.get(id)
    all {
      not(attempt.settled),
      s.origins.get(attempt.origin).kind == "native" or not(Set("permission", "ambiguous").contains(outcome)),
      val done = {...s, attempts: s.attempts.set(id, {...attempt, settled: true})}
      val result = if (s.active == id and canReturn(s, attempt.origin)) applyReply(done, attempt.origin, outcome) else done
      s' = if (result.active == id) {...result, active: 0} else result,
    },
  }

  action step = any {
    leave, hide, show, pagehide, pageshow, dispose,
    {nondet event = Events.oneOf(); nondet kind = Kinds.oneOf(); enter(event, kind)},
    {nondet active = Bool.oneOf(); setNavigation(active)},
    {nondet calendar = Bool.oneOf(); setStack(calendar)},
    {nondet origin = Origins.oneOf(); tap(origin)},
    {nondet id = IDs.oneOf(); nondet outcome = Replies.oneOf(); reply(id, outcome)},
    s' = s,
  }
  val CurrentAttemptOwns = s.active == 0 or {
    val attempt = s.attempts.get(s.active)
    attempt.origin != 0 and not(attempt.aborted or attempt.settled) and not(s.disposed or s.suspended)
      and s.visible and s.view == "maps"
  }
  val ExactReturn = s.opened.indices().forall(i => {
    val row = s.opened.nth(i)
    val origin = s.origins.get(row.origin)
    row.event == origin.event and row.kind == origin.kind and row.day == (if (origin.event == "A") 1 else 2)
      and s.opened.indices().filter(j => s.opened.nth(j).origin == row.origin).size() == 1
  })
  val UnwindsOnce = s.unwinds == s.opened.length()
  val Bounded = s.lastOrigin.in(0.to(6)) and s.lastId.in(0.to(5))
  val safety = CurrentAttemptOwns and ExactReturn and UnwindsOnce and Bounded

  run newVisitKeepsOwnershipAfterLatePriorReplyTest = init.then(enter("A", "canonical")).then(tap(1)).then(leave)
    .then(enter("B", "canonical")).then(tap(2)).then(reply(1, "found")).then(tap(2))
    .expect(s.active == 2 and s.lastId == 2 and s.opened == List())
    .then(reply(2, "found")).expect(s.view == "calendar" and s.opened.nth(0).event == "B" and safety)
  run visiblePagehideRetiresBeforePageshowTest = init.then(enter("A", "canonical")).then(tap(1))
    .then(pagehide).then(reply(1, "found")).then(tap(1))
    .expect(s.opened == List() and s.lastId == 1 and s.attempts.get(1).aborted)
    .then(pageshow).then(tap(1)).then(reply(2, "found")).expect(s.view == "calendar" and safety)
  run nativeLatePermissionDoesNotReplaceLatestNoticeTest = init.then(enter("A", "native")).then(tap(1))
    .then(hide).then(show).then(tap(1)).then(reply(1, "permission")).then(reply(2, "missing"))
    .expect(s.notices == List("missing") and s.origin == 0 and safety)
  run staleHandlerCannotIssueNativeReadTest = init.then(enter("A", "native")).then(enter("B", "native")).then(tap(1))
    .expect(s.lastId == 0).then(tap(2)).then(reply(1, "found"))
    .expect(s.opened.nth(0).event == "B" and safety)
  run navigationRejectsReadbackWithoutDroppingOriginTest = init.then(enter("A", "canonical")).then(tap(1))
    .then(setNavigation(true)).then(reply(1, "found")).then(setNavigation(false)).then(tap(1))
    .expect(s.origin == 1 and s.active == 2 and s.opened == List() and safety)
}
