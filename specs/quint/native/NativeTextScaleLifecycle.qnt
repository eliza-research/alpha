// Android's installed appearance preference, per-Activity text zoom, and queued bridge writes.
module NativeTextScaleLifecycle {
  type View = { phase: str, font: str, zoom: int, writes: int }
  type Request = { owner: int, percent: int }
  type Reply = { owner: int, outcome: str, percent: int, zoom: int }
  type State = {
    viewA: View, viewB: View, visible: int, durable: int, commits: int,
    pending: List[Request], reply: Reply
  }
  var s: State
  val owners=Set(1,2)
  val values=Set(74,75,100,125,150,151)
  val inputs=Set("int","long","text","missing")
  val fonts=Set("normal","large","larger","tiny","zero","nan","negative","infinite")
  val commitModes=Set("saved","before","visible")
  val noView={phase:"absent",font:"normal",zoom:0,writes:0}
  val noReply={owner:0,outcome:"none",percent:0,zoom:0}

  action initWith(stored: int): bool = all {
    stored.in(values.union(Set(0))),
    s'={viewA:noView,viewB:noView,visible:stored,durable:stored,commits:0,pending:List(),reply:noReply}
  }
  action init = {
    nondet stored=values.union(Set(0)).oneOf()
    initWith(stored)
  }
  pure def valid(percent: int): bool = percent>=75 and percent<=150
  pure def preference(raw: int): int = if (valid(raw)) raw else 100
  pure def effective(font: str, raw: int): int = {
    val percent=preference(raw)
    if (font=="large") (percent*3+1)/2
    else if (font=="larger") percent*2
    else if (font=="tiny") 1
    else percent
  }
  pure def viewOf(state: State, owner: int): View = if (owner==1) state.viewA else state.viewB
  pure def withView(state: State, owner: int, view: View): State =
    if (owner==1) { ...state,viewA:view } else { ...state,viewB:view }
  pure def apply(view: View, raw: int): View =
    if (view.phase=="live") { ...view,zoom:effective(view.font,raw),writes:view.writes+1 } else view
  pure def replyTo(state: State, owner: int, outcome: str): State =
    { ...state,reply:{ ...noReply,owner:owner,outcome:outcome } }

  action create(owner: int, bridge: bool, font: str): bool = all {
    owners.contains(owner), fonts.contains(font), viewOf(s,owner).phase=="absent",
    val view={ ...noView,phase:if (bridge) "live" else "no-bridge",font:font }
    s'=withView(s,owner,apply(view,s.visible))
  }
  pure def active(view: View): bool = view.phase.in(Set("live","no-bridge"))
  action systemFont(owner: int, font: str): bool = all {
    owners.contains(owner), fonts.contains(font),
    val view=viewOf(s,owner)
    all { active(view), s'=withView(s,owner,{ ...view,font:font }) }
  }
  action configure(owner: int, font: str): bool = all {
    owners.contains(owner), fonts.contains(font),
    val view=viewOf(s,owner)
    all { active(view), view.writes<10, s'=withView(s,owner,apply({ ...view,font:font },s.visible)) }
  }
  action resume(owner: int): bool = all {
    owners.contains(owner),
    val view=viewOf(s,owner)
    all { active(view), view.writes<10, s'=withView(s,owner,apply(view,s.visible)) }
  }
  action finish(owner: int): bool = all {
    owners.contains(owner),
    val view=viewOf(s,owner)
    all { active(view), s'=withView(s,owner,{ ...view,phase:"finishing" }) }
  }
  action destroy(owner: int): bool = all {
    owners.contains(owner),
    val view=viewOf(s,owner)
    all { active(view) or view.phase=="finishing", s'=withView(s,owner,{ ...view,phase:"destroyed" }) }
  }

  action request(owner: int, value: int, input: str): bool = all {
    owners.contains(owner), values.contains(value), inputs.contains(input), viewOf(s,owner).zoom>0,
    not(s.pending.indices().exists(index=>s.pending[index].owner==owner)),
    s'=if (input!="int" or not(valid(value))) replyTo(s,owner,"invalid")
      else replyTo({ ...s,pending:s.pending.append({owner:owner,percent:value}) },owner,"pending")
  }
  action deliver(mode: str): bool = all {
    commitModes.contains(mode), s.pending.length()>0,
    val request=s.pending.head()
    val view=viewOf(s,request.owner)
    val base={ ...s,pending:s.pending.tail() }
    all {
      if (view.phase!="live") s'=replyTo(base,request.owner,"unavailable")
      else all {
        s.commits<8, view.writes<10,
        val stored={ ...base,commits:s.commits+1,visible:if (mode=="before") s.visible else request.percent,
          durable:if (mode=="saved") request.percent else s.durable }
        if (mode!="saved") s'=replyTo(stored,request.owner,"unconfirmed")
        else {
          val updated=apply(view,stored.visible)
          s'=withView({ ...stored,reply:{owner:request.owner,outcome:"saved",percent:request.percent,zoom:updated.zoom} },
            request.owner,updated)
        }
      }
    }
  }
  action restart = all {
    s.pending.length()==0,
    s'={ ...s,viewA:noView,viewB:noView,visible:s.durable,commits:0,reply:noReply }
  }

  val queuedOwnersExact = s.pending.length()<=2
    and s.pending.indices().forall(index=>owners.contains(s.pending[index].owner) and valid(s.pending[index].percent))
    and (if (s.pending.length()==2) s.pending[0].owner!=s.pending[1].owner else true)
  pure def validView(view: View): bool =
    view.writes>=0 and view.writes<=10 and (view.zoom==0 iff view.writes==0)
    and (view.phase=="live" implies view.zoom>=1)
    and (view.phase.in(Set("absent","no-bridge")) implies view.zoom==0)
  val zoomOnlyOnWebView = validView(s.viewA) and validView(s.viewB)
  val savedReplyMatchesDurable = s.reply.outcome=="saved" implies
    valid(s.reply.percent) and s.reply.percent==s.durable and s.reply.zoom>=1
  val safety = queuedOwnersExact and zoomOnlyOnWebView and savedReplyMatchesDurable

  action step = any {
    nondet owner=owners.oneOf()
    nondet bridge=Bool.oneOf()
    nondet font=fonts.oneOf()
    create(owner,bridge,font),
    nondet owner=owners.oneOf()
    nondet font=fonts.oneOf()
    configure(owner,font),
    nondet owner=owners.oneOf()
    nondet font=fonts.oneOf()
    systemFont(owner,font),
    nondet owner=owners.oneOf()
    resume(owner),
    nondet owner=owners.oneOf()
    finish(owner),
    nondet owner=owners.oneOf()
    destroy(owner),
    nondet owner=owners.oneOf()
    nondet value=values.oneOf()
    nondet input=inputs.oneOf()
    request(owner,value,input),
    nondet mode=commitModes.oneOf()
    deliver(mode),
    restart,s'=s
  }

  run queuedWriteUsesCurrentConfigurationTest = initWith(0).then(create(1,true,"normal"))
    .then(request(1,75,"int")).then(configure(1,"large")).then(deliver("saved"))
    .expect(s.reply.zoom==113 and s.visible==75 and s.durable==75 and s.viewA.zoom==113)
  run peerZoomRefreshesOnResumeTest = initWith(0).then(create(1,true,"normal")).then(create(2,true,"large"))
    .then(request(1,125,"int")).then(deliver("saved")).expect(s.viewA.zoom==125 and s.viewB.zoom==150)
    .then(resume(2)).expect(s.viewB.zoom==188)
  run destroyedOwnerCannotPublishToSuccessorTest = initWith(0).then(create(1,true,"normal")).then(request(1,150,"int"))
    .then(destroy(1)).then(create(2,true,"large")).then(request(2,125,"int")).then(deliver("saved"))
    .expect(s.reply.outcome=="unavailable" and s.commits==0 and s.viewB.zoom==150)
    .then(deliver("saved")).expect(s.viewB.zoom==188 and s.commits==1)
  run unconfirmedVisiblePreferenceAndRestartTest = initWith(100).then(create(1,true,"normal"))
    .then(request(1,125,"int")).then(deliver("visible"))
    .expect(s.reply.outcome=="unconfirmed" and s.visible==125 and s.durable==100 and s.viewA.zoom==100)
    .then(resume(1)).expect(s.viewA.zoom==125)
    .then(restart).then(create(1,true,"large")).expect(s.viewA.zoom==150)
  run noBridgeConfigurationCannotApplyZoomTest = initWith(151).then(create(1,false,"normal"))
    .then(configure(1,"large")).then(resume(1)).expect(s.viewA.writes==0)
    .then(create(2,true,"large")).expect(s.viewB.zoom==150)
}
