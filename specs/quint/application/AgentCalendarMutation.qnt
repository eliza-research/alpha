// Current Calendar create/update/delete admission and read deferral.
module AgentCalendarMutation {
  type Job = {phase: str, epoch: int, owner: str, session: int, kind: str, issue: str, profile: str, aborted: bool}
  type Dispatch = {id: int, owner: str, session: int, kind: str, side: str, grant: str, calendar: str,
    external: str, version: str, scope: str, cancellation: str, retainedKey: bool}
  type State = {portOwner: str, portSession: int, portCurrent: bool, owner: str, session: int,
    status: str, profile: str, hasSource: bool, nextFresh: bool, query: int, epoch: int,
    reading: bool, active: int, deferred: int, lastId: int, jobs: int -> Job, outcomes: int -> str,
    dispatched: List[Dispatch]}
  var s: State

  pure val Owners = Set("", "A", "B")
  pure val FeedStates = Set("ready", "partial", "unavailable")
  pure val Profiles = Set("none", "organizer", "invitee", "email", "unknown", "recurring", "readonly", "unversioned")
  pure val Kinds = Set("create", "update", "delete")
  pure val Issues = Set("normal", "missing", "blank", "stale", "move", "instance")
  pure val Preservation = Set("same", "changed", "pending", "unreadable", "transport")
  pure val Replies = Set("success", "unknown", "foreign-owner", "foreign-source", "transport")
  pure val Queries = Set(1, 2)
  pure val IDs = 1.to(6)
  pure val NoJob: Job = {phase: "", epoch: 0, owner: "", session: 0, kind: "", issue: "", profile: "", aborted: false}

  action initWith(status: str, profile: str): bool = all {FeedStates.contains(status), Profiles.contains(profile),
    s' = {portOwner: "A", portSession: 1, portCurrent: true, owner: "A", session: 1, status: status,
      profile: profile, hasSource: true, nextFresh: status == "ready", query: 1, epoch: 1, reading: false,
      active: 0, deferred: 0, lastId: 0, jobs: IDs.mapBy(_ => NoJob), outcomes: IDs.mapBy(_ => ""), dispatched: List()}}
  action init = { nondet status = FeedStates.oneOf(); nondet profile = Profiles.oneOf(); initWith(status,profile) }
  action setPort(owner: str, session: int, current: bool): bool = all {
    Owners.contains(owner), session.in(1.to(2)), owner != "" or not(current),
    s' = {...s,portOwner:owner,portSession:session,portCurrent:current}}
  pure def sameBinding(value: State): bool =
    value.portCurrent and value.portOwner == value.owner and value.portSession == value.session
  pure def disconnected(value: State): State = {...value,owner:"",session:0,status:"disconnected",
    profile:"none",hasSource:false,nextFresh:false,reading:false,active:0,deferred:0}
  pure def beginRead(value: State, query: int): State = {
    val started = {...value,epoch:value.epoch+1,deferred:0,nextFresh:false}
    if (not(value.portCurrent)) disconnected(started)
    else if (sameBinding(value) and value.query == query and Set("ready","partial").contains(value.status))
      {...started,reading:true}
    else {...started,owner:value.portOwner,session:value.portSession,query:query,status:"loading",
      profile:"none",hasSource:false,reading:true}
  }
  action request(query: int): bool = all {Queries.contains(query), not(s.reading), s.epoch < 8,
    s' = if (s.active != 0) {...s,deferred:query,nextFresh:false} else beginRead(s,query)}
  action finishRead(status: str, profile: str): bool = all {s.reading, FeedStates.contains(status), Profiles.contains(profile),
    s' = if (sameBinding(s)) {...s,reading:false,status:status,profile:profile,hasSource:true,nextFresh:status=="ready"}
      else {...s,reading:false,status:"error",profile:"none",hasSource:false,nextFresh:false}}
  action retire = all {not(s.reading), s.epoch < 8,
    val retired = {...disconnected(s),epoch:s.epoch+1,query:0}
    s' = if (s.active == 0) retired else {...retired,jobs:s.jobs.set(s.active,{...s.jobs.get(s.active),aborted:true})}}

  pure def eventAdmission(value: State, kind: str, issue: str): str =
    if (value.profile == "none" or issue == "missing") "event"
    else if (issue == "stale" or Set("readonly","unversioned").contains(value.profile)) "version"
    else if (value.profile == "recurring" and issue != "instance") "scope"
    else if (kind == "update" and issue == "move") "move"
    else if (kind == "delete" and value.profile == "unknown") "disposition"
    else if (kind == "delete" and issue == "blank") "id"
    else ""
  pure def admission(value: State, kind: str, issue: str): str = {
    val initial = if (kind == "create") {
      if (not(value.hasSource) or issue == "missing") "source" else if (issue == "blank") "id" else ""
    } else eventAdmission(value,kind,issue)
    if (initial != "") initial
    else if (value.reading or value.active != 0
      or not(Set("ready","partial").contains(value.status) or kind == "create" and value.status == "unavailable")) "busy"
    else if (not(value.portCurrent) or value.portOwner != value.owner) "owner"
    else ""
  }
  action start(kind: str, issue: str): bool = all {Kinds.contains(kind), Issues.contains(issue), s.lastId < 6,
    val id = s.lastId+1
    val error = admission(s,kind,issue)
    val base = {...s,lastId:id,outcomes:s.outcomes.set(id,if(error=="") "pending" else error)}
    s' = if (error != "") base else {...base,active:id,jobs:s.jobs.set(id,
      {phase:"preservation",epoch:s.epoch,owner:s.portOwner,session:s.portSession,kind:kind,issue:issue,profile:s.profile,aborted:false})}}
  pure def stillCurrent(value: State, job: Job): bool =
    not(job.aborted) and job.epoch == value.epoch and sameBinding(value)
      and job.owner == value.portOwner and job.session == value.portSession
  pure def retiredResult(job: Job): str = if(job.aborted) "aborted" else "owner"
  pure def settle(value: State, id: int, result: str): State = {
    val done = {...value,jobs:value.jobs.set(id,NoJob),outcomes:value.outcomes.set(id,result)}
    if (value.active != id) done
    else {
      val ready = {...done,active:0,deferred:0}
      if (value.deferred != 0 and value.epoch < 8) beginRead(ready,value.deferred) else ready
    }
  }
  pure def dispatch(id: int, job: Job): Dispatch = {
    val create = job.kind == "create"
    {id:id,owner:job.owner,session:job.session,kind:job.kind,side:"owner",grant:"fixture-grant",calendar:"fixture-calendar",
      external:if(create) "" else "provider-event",version:if(create) "" else "v1",
      scope:if(not(create) and job.issue=="instance") "instance" else "",
      cancellation:if(job.kind!="delete") "" else if(job.profile=="invitee") "decline_invitation" else "organizer_cancel",
      retainedKey:job.issue!="blank"}
  }
  action preservationReply(id: int, result: str): bool = all {IDs.contains(id), Preservation.contains(result),
    s.jobs.get(id).phase == "preservation",
    val job = s.jobs.get(id)
    s' = if (result == "transport") settle(s,id,"transport")
      else if (not(stillCurrent(s,job))) settle(s,id,retiredResult(job))
      else if (result != "same") settle(s,id,"preservation")
      else {...s,jobs:s.jobs.set(id,{...job,phase:"remote"}),dispatched:s.dispatched.append(dispatch(id,job))}}
  action providerReply(id: int, result: str): bool = all {IDs.contains(id), Replies.contains(result),
    s.jobs.get(id).phase == "remote",
    val job = s.jobs.get(id)
    val foreign = job.kind != "delete" and result == "foreign-owner" or job.kind == "update" and result == "foreign-source"
    val outcome = if(result=="transport") "transport" else if(foreign) "foreign"
      else if(not(stillCurrent(s,job))) retiredResult(job)
      else if(job.kind=="create" and result=="unknown") "unknown" else "saved"
    s' = settle(s,id,outcome)}

  action step = any {
    retire,
    {nondet owner = Owners.oneOf(); nondet session = 1.to(2).oneOf(); nondet current = Bool.oneOf(); setPort(owner,session,current)},
    {nondet query = Queries.oneOf(); request(query)},
    {nondet status = FeedStates.oneOf(); nondet profile = Profiles.oneOf(); finishRead(status,profile)},
    {nondet kind = Kinds.oneOf(); nondet issue = Issues.oneOf(); start(kind,issue)},
    {nondet id = IDs.oneOf(); nondet result = Preservation.oneOf(); preservationReply(id,result)},
    {nondet id = IDs.oneOf(); nondet result = Replies.oneOf(); providerReply(id,result)}, s' = s,
  }
  val SingleActive = s.active == 0 or (s.jobs.get(s.active).phase != "" and s.jobs.get(s.active).epoch == s.epoch and not(s.reading))
  val DeferredOwnsMutation = s.deferred == 0 or s.active != 0 and not(s.nextFresh)
  val DistinctDispatch = s.dispatched.indices().forall(i =>
    s.dispatched.indices().filter(j => s.dispatched.nth(i).id == s.dispatched.nth(j).id).size() == 1)
  val Bounded = s.epoch.in(1.to(8)) and s.lastId.in(0.to(6))
  val safety = SingleActive and DeferredOwnsMutation and DistinctDispatch and Bounded

  run latestDeferredWindowStartsAfterWriteTest = initWith("ready","organizer").then(start("create","normal"))
    .then(request(1)).then(request(2)).then(preservationReply(1,"same")).expect(s.active==1 and s.deferred==2)
    .then(providerReply(1,"unknown")).expect(s.query==2 and s.reading and s.outcomes.get(1)=="unknown" and safety)
  run changedPreservationNeverDispatchesTest = initWith("ready","organizer").then(start("update","normal"))
    .then(preservationReply(1,"changed")).expect(s.dispatched==List() and s.outcomes.get(1)=="preservation" and safety)
  run recurringAndDispositionAdmissionTest = initWith("ready","recurring").then(start("delete","normal"))
    .then(start("delete","instance")).then(preservationReply(2,"same"))
    .expect(s.outcomes.get(1)=="scope" and s.dispatched.head().scope=="instance" and safety)
  run retiredResultCannotClearSuccessorMutationTest = initWith("ready","organizer").then(start("create","normal"))
    .then(preservationReply(1,"same")).then(setPort("B",2,true)).then(retire).then(request(1))
    .then(finishRead("ready","invitee")).then(start("delete","normal")).then(preservationReply(2,"same"))
    .then(providerReply(1,"success")).expect(s.active==2 and s.outcomes.get(1)=="aborted" and safety)
  run sameOwnerNewSessionRefusesOldBindingTest = initWith("ready","organizer").then(setPort("A",2,true))
    .then(start("update","normal")).then(preservationReply(1,"same"))
    .expect(s.outcomes.get(1)=="owner" and s.dispatched==List() and safety)
}
