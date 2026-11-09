// Current Agent Calendar read actor. Accepted mutations and replay are separate.
module AgentCalendarRefresh {
  type Job = {phase: str, owner: str, session: int, query: int, revalidating: bool, aborted: bool,
    feed: str, sources: str, next: str}
  type State = {portOwner: str, portSession: int, portCurrent: bool, boundOwner: str, boundSession: int,
    query: int, epoch: int, abortEpoch: int, active: int, trailing: int, jobs: int -> Job,
    status: str, owner: str, legacy: str, feed: str, feedEpoch: int, sources: str, next: str, nextEpoch: int, nextFresh: bool,
    error: str, hasHandle: bool, clockAdvanced: bool}
  var s: State

  pure val Owners = Set("", "A", "B")
  pure val Sessions = 1.to(2)
  pure val Windows = 1.to(2)
  pure val Epochs = 1.to(8)
  pure val LegacyResults = Set("clean", "present", "unreadable", "pending", "failed")
  pure val FeedResults = Set("complete", "partial", "unavailable", "failed", "foreign", "wrong-window")
  pure val SourceResults = Set("readable", "hidden", "blocked", "none", "failed")
  pure val NextResults = Set("event", "empty", "partial", "failed", "foreign", "ended")
  pure val NoJob: Job = {phase: "", owner: "", session: 0, query: 0, revalidating: false, aborted: false,
    feed: "", sources: "", next: ""}

  pure def empty(value: State): State = {...value, status: "disconnected", owner: "", legacy: "",
    feed: "", feedEpoch: 0, sources: "", next: "", nextEpoch: 0, nextFresh: false, error: ""}
  action init = s' = {portOwner: "A", portSession: 1, portCurrent: true, boundOwner: "", boundSession: 0,
    query: 0, epoch: 0, abortEpoch: 0, active: 0, trailing: 0, jobs: Epochs.mapBy(_ => NoJob),
    status: "disconnected", owner: "", legacy: "", feed: "", feedEpoch: 0, sources: "", next: "", nextEpoch: 0, nextFresh: false,
    error: "", hasHandle: false, clockAdvanced: false}
  action setPort(owner: str, session: int, current: bool): bool = all {
    Owners.contains(owner), Sessions.contains(session), owner != "" or not(current),
    s' = {...s, portOwner: owner, portSession: session, portCurrent: current}}
  pure def staleNext(value: State): State = {...value, nextFresh: false,
    next: if (value.clockAdvanced and value.next == "event") "" else value.next,
    nextEpoch: if (value.clockAdvanced and value.next == "event") 0 else value.nextEpoch}
  action invalidateNext = s' = staleNext(s)
  action advanceClock = s' = staleNext({...s, clockAdvanced: true})
  pure def abort(value: State): State = {
    if (value.abortEpoch == 0) value else {
      val job = value.jobs.get(value.abortEpoch)
      if (job == NoJob) value else {...value, jobs: value.jobs.set(value.abortEpoch, {...job, aborted: true})}
    }
  }
  pure def sameBinding(value: State): bool = value.portCurrent and value.portOwner == value.boundOwner
    and value.portSession == value.boundSession
  pure def start(value: State, query: int): State = {
    val epoch = value.epoch + 1
    val retired = {...abort(value), epoch: epoch, abortEpoch: epoch, trailing: 0}
    if (not(value.portCurrent)) {...empty(retired), active: 0, boundOwner: "", boundSession: 0}
    else {
      val same = sameBinding(value) and value.query == query
      val keep = same and Set("ready", "partial").contains(value.status)
      val ready = if (same) retired else empty(retired)
      val started = staleNext({...ready, boundOwner: value.portOwner, boundSession: value.portSession, query: query,
        active: epoch, jobs: ready.jobs.set(epoch, {...NoJob, phase: "legacy", owner: value.portOwner,
          session: value.portSession, query: query, revalidating: keep})})
      if (keep) {...started, error: ""} else {...started, owner: value.portOwner,
        status: "loading", error: "", feed: "", feedEpoch: 0, sources: ""}
    }
  }
  action request(query: int): bool = all {Windows.contains(query), s.epoch < 8,
    s' = if (s.active != 0 and sameBinding(s) and query == s.query) staleNext({...s, trailing: query})
      else start(s, query)}
  action retire = all {s.epoch < 8,
    s' = {...empty(abort(s)), epoch: s.epoch + 1, active: 0, abortEpoch: 0, query: 0,
      boundOwner: "", boundSession: 0, trailing: 0, hasHandle: false}}

  pure def finish(value: State, id: int): State = {
    val removed = {...value, jobs: value.jobs.set(id, NoJob)}
    if (value.active != id) removed
    else {
      val ready = {...removed, active: 0, trailing: 0}
      if (value.trailing != 0 and value.epoch < 8) start(ready, value.trailing) else ready
    }
  }
  pure def owned(value: State, id: int, job: Job): bool =
    value.active == id and not(job.aborted) and value.portCurrent and job.owner == value.portOwner and job.session == value.portSession
  pure def failure(value: State, job: Job, integrity: bool): State =
    if (job.revalidating and not(integrity)) {...value, error: "load", next: "", nextEpoch: 0, nextFresh: false}
    else {...value, status: "error", error: "load", feed: "", feedEpoch: 0, sources: "", next: "", nextEpoch: 0, nextFresh: false}
  pure def inactive(value: State, id: int, job: Job): State =
    if (value.active == id) finish(failure(value, job, true), id) else finish(value, id)
  action legacyReply(id: int, result: str): bool = all {
    Epochs.contains(id), LegacyResults.contains(result), s.jobs.get(id).phase == "legacy",
    val job = s.jobs.get(id)
    val captured = {...s, legacy: result}
    s' = if (s.active != id or job.aborted) finish(s,id)
      else if (result == "failed") finish(failure(s,job,false),id)
      else if (not(owned(s,id,job))) inactive(s,id,job)
      else if (Set("unreadable","pending").contains(result))
        finish({...captured, status: "legacy-recovery", feed: "", feedEpoch: 0, sources: ""},id)
      else {...captured, jobs: s.jobs.set(id,{...job,phase: if (result == "present") "retention" else "reading"})}}
  action retentionReply(id: int, kept: bool): bool = all {
    Epochs.contains(id), s.jobs.get(id).phase == "retention",
    val job = s.jobs.get(id)
    s' = if (not(owned(s,id,job))) inactive(s,id,job)
      else if (kept) {...s,jobs: s.jobs.set(id,{...job,phase:"reading"})}
      else finish({...s,status:"transition-required",feed:"",feedEpoch:0,sources:""},id)}

  pure def publishRead(value: State, id: int, job: Job): State = {
    val nextEvent = Set("event", "partial", "ended").contains(job.next)
    val integrity = job.next == "foreign" or nextEvent and job.sources != "readable"
      or Set("foreign", "wrong-window").contains(job.feed)
    if (job.sources == "failed") failure(value, job, false)
    else if (job.next == "foreign" or nextEvent and job.sources != "readable") failure(value, job, true)
    else if (job.revalidating and job.feed == "failed") failure(value, job, false)
    else if (integrity) failure(value, job, true)
    else {
      val expired = job.next == "ended" or nextEvent and value.clockAdvanced
      val nextValue = if (job.next == "failed") {
        if (value.next == "event" and job.sources != "readable") "" else value.next
      } else if (expired) "" else if (nextEvent) "event" else "empty"
      {...value, feed: if (job.feed == "failed") "" else job.feed,
        feedEpoch: if (job.feed == "failed") 0 else id,
        sources: if (job.sources == "none") "" else job.sources, next: nextValue,
        nextEpoch: if (nextValue == "") 0 else if (job.next == "failed") value.nextEpoch else id,
        nextFresh: job.feed == "complete" and not(expired) and Set("event", "empty").contains(job.next),
        hasHandle: job.sources != "none",
        status: if (job.feed == "complete") "ready" else if (job.feed == "partial") "partial"
          else if (job.feed == "unavailable") "unavailable" else "error",
        error: if (job.feed == "failed") "feed" else if (job.next == "failed") "next" else ""}
    }
  }
  pure def receipt(value: State, id: int, job: Job): State = {
    if (job.feed == "" or job.sources == "" or job.next == "") {...value, jobs: value.jobs.set(id, job)}
    else if (not(owned(value,id,job))) inactive(value,id,job)
    else finish(publishRead(value,id,job),id)
  }
  action feedReply(id: int, result: str): bool = all {Epochs.contains(id), FeedResults.contains(result),
    s.jobs.get(id).phase == "reading", s.jobs.get(id).feed == "",
    s' = receipt(s,id,{...s.jobs.get(id),feed:result})}
  action sourcesReply(id: int, result: str): bool = all {Epochs.contains(id), SourceResults.contains(result),
    s.jobs.get(id).phase == "reading", s.jobs.get(id).sources == "",
    s' = receipt(s,id,{...s.jobs.get(id),sources:result})}
  action nextReply(id: int, result: str): bool = all {Epochs.contains(id), NextResults.contains(result),
    s.jobs.get(id).phase == "reading", s.jobs.get(id).next == "",
    s' = receipt(s,id,{...s.jobs.get(id),next:result})}

  action step = any {
    retire, invalidateNext, advanceClock,
    {nondet owner = Owners.oneOf(); nondet session = Sessions.oneOf(); nondet current = Bool.oneOf(); setPort(owner,session,current)},
    {nondet query = Windows.oneOf(); request(query)},
    {nondet id = Epochs.oneOf(); nondet result = LegacyResults.oneOf(); legacyReply(id,result)},
    {nondet id = Epochs.oneOf(); nondet kept = Bool.oneOf(); retentionReply(id,kept)},
    {nondet id = Epochs.oneOf(); nondet result = FeedResults.oneOf(); feedReply(id,result)},
    {nondet id = Epochs.oneOf(); nondet result = SourceResults.oneOf(); sourcesReply(id,result)},
    {nondet id = Epochs.oneOf(); nondet result = NextResults.oneOf(); nextReply(id,result)}, s' = s,
  }

  val OwnsActiveRead = s.active == 0 or (s.jobs.get(s.active).phase != "" and not(s.jobs.get(s.active).aborted)
    and s.jobs.get(s.active).owner == s.boundOwner and s.jobs.get(s.active).session == s.boundSession)
  val VerifiedNext = s.nextFresh implies (s.status == "ready" and s.feed == "complete" and s.next != ""
    and (s.next != "event" or s.sources == "readable"))
  val ResponseIdentity = (s.feed == "" iff s.feedEpoch == 0) and (s.next == "" iff s.nextEpoch == 0)
    and s.feedEpoch.in(0.to(s.epoch)) and s.nextEpoch.in(0.to(s.epoch))
  val Bounded = s.epoch.in(0.to(8)) and s.active.in(0.to(s.epoch)) and s.abortEpoch.in(0.to(s.epoch))
  val safety = OwnsActiveRead and VerifiedNext and ResponseIdentity and Bounded

  run completeFirst = request(1).then(legacyReply(1,"clean")).then(feedReply(1,"complete"))
    .then(sourcesReply(1,"readable")).then(nextReply(1,"event"))
  run sameWindowTransportKeepsOldFeedTest = init.then(completeFirst).then(request(1)).then(legacyReply(2,"clean"))
    .then(feedReply(2,"failed")).then(sourcesReply(2,"readable")).then(nextReply(2,"event"))
    .expect(s.feed == "complete" and s.feedEpoch == 1 and s.status == "ready" and s.error == "load" and not(s.nextFresh) and safety)
  run wrongWindowDoesNotKeepOldFeedTest = init.then(completeFirst).then(request(1)).then(legacyReply(2,"clean"))
    .then(feedReply(2,"wrong-window")).then(sourcesReply(2,"readable")).then(nextReply(2,"event"))
    .expect(s.feed == "" and s.feedEpoch == 0 and s.status == "error" and s.next == "" and safety)
  run repeatQueuesOneTrailingReadTest = init.then(request(1)).then(request(1)).then(request(1)).then(legacyReply(1,"clean"))
    .then(feedReply(1,"complete")).then(sourcesReply(1,"readable")).then(nextReply(1,"event"))
    .expect(s.epoch == 2 and s.active == 2 and s.trailing == 0 and safety)
  run staleOwnerCannotReplaceCurrentTest = init.then(request(1)).then(legacyReply(1,"clean"))
    .then(setPort("B",2,true)).then(request(2)).then(legacyReply(2,"clean"))
    .then(feedReply(2,"partial")).then(nextReply(2,"empty")).then(sourcesReply(2,"none"))
    .then(feedReply(1,"complete")).then(sourcesReply(1,"readable")).then(nextReply(1,"event"))
    .expect(s.owner == "B" and s.feed == "partial" and s.feedEpoch == 2 and safety)
  run unreadableLegacyStopsCanonicalReadsTest = init.then(request(1)).then(legacyReply(1,"unreadable"))
    .expect(s.status == "legacy-recovery" and s.active == 0 and safety)
}
