// A rendered review authorizes one exact local draft suggestion.
module EmailSuggestionReview {
  type Environment = {session: int, cloud: int, token: int, text: str, front: str,
    ready: bool, room: bool, appendMode: bool}
  type Review = {id: int, session: int, cloud: int, token: int, text: str,
    ready: bool, appendMode: bool, notice: str}
  type Controls = {session: int, text: str, canOpen: bool, review: int}
  type Insert = {token: int, text: str, appendMode: bool}
  type State = {env: Environment, review: Review, serial: int, controls: int -> Controls,
    inserts: List[Insert], used: Set[int], toasts: int}
  var s: State

  pure val none = {id: 0, session: 0, cloud: 0, token: 0, text: "",
    ready: false, appendMode: false, notice: ""}
  action init = s' = {
    env: {session: 1, cloud: 1, token: 1, text: "short", front: "normal",
      ready: true, room: true, appendMode: false},
    review: none, serial: 0, controls: Map(), inserts: List(), used: Set(), toasts: 0,
  }

  pure def presenting(e: Environment): bool = e.front.in(Set("normal", "hidden", "chooser"))
  pure def fit(e: Environment, text: str): bool = e.ready and e.room and text != "long"
  pure def snapshot(e: Environment, id: int, session: int, cloud: int, text: str, notice: str): Review = {
    id: id, session: session, cloud: cloud, token: e.token, text: text,
    ready: fit(e, text), appendMode: e.appendMode, notice: notice,
  }
  pure def refresh(st: State, cloud: int, notice: str): State =
    {...st, serial: st.serial + 1,
      review: snapshot(st.env, st.serial + 1, st.review.session, cloud, st.review.text, notice)}

  action setSession(session: int): bool = all {
    session.in(Set(1, 2)), s' = {...s, env: {...s.env, session: session}},
  }
  action setCloud(cloud: int): bool = all {
    cloud.in(Set(1, 2)), s' = {...s, env: {...s.env, cloud: cloud}},
  }
  action setText(text: str): bool = all {
    text.in(Set("short", "edited", "long", "missing")), s' = {...s, env: {...s.env, text: text}},
  }
  action setFront(front: str): bool = all {
    front.in(Set("normal", "hidden", "chooser", "away", "chat", "lock")),
    s' = {...s, env: {...s.env, front: front}},
  }
  action setTarget(token: int, ready: bool, room: bool, appendMode: bool): bool = all {
    token.in(Set(1, 2, 3)),
    s' = {...s, env: {...s.env, token: token, ready: ready, room: room, appendMode: appendMode}},
  }
  action render(slot: int): bool = all {
    slot.in(Set(1, 2, 3)),
    val visible = presenting(s.env) and s.env.text != "missing" and s.review.text == s.env.text
    val review = if (visible) s.review else none
    s' = {...s, review: review, controls: s.controls.put(slot, {
      session: s.env.session, text: s.env.text, review: review.id,
      canOpen: s.env.front != "away" and s.env.text != "missing",
    })},
  }
  action open(slot: int): bool = all {
    s.controls.keys().contains(slot), s.serial < 4,
    val control = s.controls.get(slot)
    val current = control.canOpen and control.session == s.env.session and control.text == s.env.text
    s' = if (current and presenting(s.env))
      refresh({...s, review: {...none, session: control.session, text: control.text}}, s.env.cloud, "")
      else s,
  }
  action close(slot: int): bool = all {
    s.controls.keys().contains(slot),
    s' = if (s.controls.get(slot).review == s.review.id) {...s, review: none} else s,
  }
  action confirm(slot: int): bool = all {
    s.controls.keys().contains(slot), s.serial < 4,
    val e = s.env
    val r = s.review
    s' = if (s.controls.get(slot).review != r.id or not(r.ready)) s
      else if (e.session != r.session or e.text != r.text) {...s, review: none, toasts: s.toasts + 1}
      else if (not(presenting(e))) {...s, review: none}
      else if (e.front != "normal") refresh(s, r.cloud, "front")
      else if (e.cloud != r.cloud) refresh(s, e.cloud, "cloud")
      else if (e.token != r.token or not(e.ready)) refresh(s, r.cloud, "target")
      else {...s, review: none, env: {...e, front: "chat"},
        inserts: s.inserts.append({token: r.token, text: r.text, appendMode: r.appendMode}),
        used: s.used.union(Set(r.id))},
  }

  action step = any {
    { nondet i = Set(1, 2, 3).oneOf(); render(i) },
    { nondet i = s.controls.keys().oneOf(); any {open(i), close(i), confirm(i)} },
    { nondet i = Set(1, 2).oneOf(); any {setSession(i), setCloud(i)} },
    { nondet text = Set("short", "edited", "long", "missing").oneOf(); setText(text) },
    { nondet front = Set("normal", "hidden", "chooser", "away", "chat", "lock").oneOf(); setFront(front) },
    { nondet token = Set(1, 2, 3).oneOf()
      nondet ready = Bool.oneOf()
      nondet room = Bool.oneOf()
      nondet appendMode = Bool.oneOf()
      setTarget(token, ready, room, appendMode) },
    s' = s,
  }

  val safety = s.inserts.length() == s.used.size()
    and s.inserts.indices().forall(i => s.inserts.nth(i).text.in(Set("short", "edited")))
    and (s.review.id != 0 implies not(s.used.contains(s.review.id)))

  run replacementRetiresControlsTest = init.then(render(1)).then(open(1)).then(render(1))
    .then(setTarget(2, true, true, true)).then(open(1)).then(confirm(1)).then(close(1))
    .expect(s.inserts == List() and s.review.token == 2)
    .then(render(2)).then(confirm(2))
    .expect(s.inserts == List({token: 2, text: "short", appendMode: true}) and safety)
  run refreshedReviewRequiresNewControlTest = init.then(render(1)).then(open(1)).then(render(1))
    .then(setCloud(2)).then(confirm(1)).then(confirm(1)).expect(s.inserts == List() and s.review.notice == "cloud")
    .then(render(2)).then(confirm(2)).expect(s.inserts.length() == 1 and safety)
  run lateConfirmAfterChatClosesTest = init.then(render(1)).then(open(1)).then(render(1))
    .then(setFront("chat")).then(confirm(1)).expect(s.inserts == List() and s.review == none and safety)
  run retiredOpenerCannotAdoptReplyTest = init.then(render(1)).then(setText("edited"))
    .then(open(1)).expect(s.review == none)
    .then(render(2)).then(open(2)).expect(s.review.text == "edited" and safety)
}
