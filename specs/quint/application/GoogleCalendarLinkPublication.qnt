// Current mounted Google panel, with separate link and account-read ownership.
module GoogleCalendarLinkPublication {
  type Intent = {current: bool, authorizing: bool, review: int}
  type Read = {owner: int, settled: bool, grant: str}
  type Link = {intent: int, owner: int, read: int, phase: str, aborted: bool}
  type State = {browser: bool, owner: int, intent: int, lastIntent: int, intents: int -> Intent,
    lastRead: int, reads: int -> Read, accountActive: int, verifiedRead: int, grant: str, lastLink: int,
    links: int -> Link, linkActive: int, hostCalls: List[int], helperCalls: List[int], consents: int, notice: str}
  var s: State

  pure val GrantReplies = Set("none", "read", "write", "failed")
  pure val Outcomes = Set("synced", "syncing", "needs-grant", "not-linked", "unconfirmed")
  pure val Owners = 1.to(3)
  pure val ReadIds = 1.to(6)
  pure val LinkIds = 1.to(5)
  pure val IntentIds = 1.to(4)
  pure val NewIntent: Intent = {current: true, authorizing: false, review: 0}

  action initWith(browser: bool): bool = s' = {browser: browser, owner: 1, intent: 0, lastIntent: 0,
    intents: Map(), lastRead: 0, reads: Map(), accountActive: 0, verifiedRead: 0, grant: "none",
    lastLink: 0, links: Map(), linkActive: 0, hostCalls: List(), helperCalls: List(), consents: 0, notice: ""}
  action init = { nondet browser = Bool.oneOf(); initWith(browser) }

  pure def retireLink(value: State): State =
    if (value.linkActive == 0) value
    else {...value, linkActive: 0, links: value.links.set(value.linkActive, {...value.links.get(value.linkActive), aborted: true})}
  pure def beginRead(value: State): State = {
    val id = value.lastRead + 1
    {...value, lastRead: id, accountActive: id, verifiedRead: 0, grant: "none", notice: "checking",
      reads: value.reads.put(id, {owner: value.owner, settled: false, grant: ""})}
  }
  action open = all {
    s.lastIntent < 4, s.intent != 0 or s.lastRead < 6,
    val id = s.lastIntent + 1
    val updated = retireLink({...s, intent: id, lastIntent: id, intents: s.intents.put(id, NewIntent)})
    s' = if (s.intent == 0) beginRead(updated) else updated,
  }
  action close = all {s.intent != 0, s' = retireLink({...s, intent: 0})}
  action replaceOwner = all {
    s.owner < 3, s.intent == 0 or s.lastRead < 6,
    val updated = retireLink({...s, owner: s.owner + 1})
    s' = if (s.intent == 0) updated else beginRead(updated),
  }
  action reload = all {s.intent != 0, s.lastRead < 6, s' = beginRead(s)}
  action setScope(current: bool): bool = all {
    s.intent != 0, s' = {...s, intents: s.intents.set(s.intent, {...s.intents.get(s.intent), current: current})},
  }

  pure def finishRead(value: State, read: int): State =
    if (read != 0 and value.accountActive == read) {...value, accountActive: 0} else value
  pure def hasVerified(value: State): bool =
    value.intent != 0 and value.verifiedRead != 0 and value.reads.get(value.verifiedRead).owner == value.owner
  pure def beginLink(value: State, read: int): State =
    if (value.linkActive != 0) finishRead(value, read)
    else if (not(value.intents.get(value.intent).current)) finishRead({...value, notice: "connecting"}, read)
    else {
      val id = value.lastLink + 1
      val host = value.browser and value.grant == "write"
      {...value, lastLink: id, linkActive: id, notice: "connecting",
        links: value.links.put(id, {intent: value.intent, owner: value.owner, read: read,
          phase: if (host) "host" else "helper", aborted: false}),
        hostCalls: if (host) value.hostCalls.append(id) else value.hostCalls,
        helperCalls: if (host) value.helperCalls else value.helperCalls.append(id)}
    }

  action readReply(id: int, grant: str): bool = all {
    s.reads.keys().contains(id), GrantReplies.contains(grant), s.lastLink < 5,
    val read = s.reads.get(id)
    all {
      not(read.settled),
      val done = {...s, reads: s.reads.set(id, {...read, settled: true, grant: grant})}
      s' = if (s.intent == 0 or read.owner != s.owner or s.accountActive != id) finishRead(done, id)
        else if (grant == "failed") finishRead({...done, notice: "unverified"}, id)
        else {
          val verified = {...done, verifiedRead: id, grant: grant, notice: if (grant == "none") "no-account" else "calendar-includes"}
          if (s.intents.get(s.intent).authorizing) beginLink(verified, id) else finishRead(verified, id)
        },
    },
  }

  val busy = s.accountActive != 0 or s.linkActive != 0
  val verified = if (hasVerified(s)) s.verifiedRead else 0
  val panelInert = s.intent != 0
  action sync = all {
    not(busy), hasVerified(s), s.grant == "write", s.lastLink < 5,
    s' = beginLink(s, 0),
  }
  action authorize = all {
    not(busy), hasVerified(s), s.grant == "read", s.intents.get(s.intent).current, s.consents < 2,
    s' = {...s, consents: s.consents + 1, notice: "authorization",
      intents: s.intents.set(s.intent, {...s.intents.get(s.intent), authorizing: true})},
  }
  pure def linkCurrent(value: State, id: int, job: Link): bool =
    value.linkActive == id and not(job.aborted) and value.intent == job.intent and value.owner == job.owner
      and value.intents.get(job.intent).current
  pure def finishLink(value: State, id: int, job: Link): State = {
    val settled = {...value, linkActive: if (value.linkActive == id) 0 else value.linkActive,
      links: value.links.set(id, {...job, phase: "done"})}
    finishRead(settled, job.read)
  }
  action hostReply(id: int, allow: bool): bool = all {
    s.links.keys().contains(id),
    val job = s.links.get(id)
    all {
      job.phase == "host",
      s' = if (not(linkCurrent(s, id, job))) finishLink(s, id, job)
        else if (allow) {...s, links: s.links.set(id, {...job, phase: "helper"}), helperCalls: s.helperCalls.append(id)}
        else finishLink({...s, notice: "host-refused", intents: s.intents.set(job.intent,
          {...s.intents.get(job.intent), authorizing: false})}, id, job),
    },
  }
  action linkReply(id: int, outcome: str, revision: int): bool = all {
    s.links.keys().contains(id), Outcomes.contains(outcome), revision.in(0.to(3)),
    val job = s.links.get(id)
    all {
      job.phase == "helper",
      val result = if (not(linkCurrent(s, id, job))) s
        else if (outcome == "needs-grant") {...s, notice: outcome}
        else {...s, notice: outcome, intents: s.intents.set(job.intent,
          {...s.intents.get(job.intent), review: revision, authorizing: false})}
      s' = finishLink(result, id, job),
    },
  }

  action step = any {
    open, close, replaceOwner, reload, sync, authorize,
    {nondet current = Bool.oneOf(); setScope(current)},
    {nondet id = ReadIds.oneOf(); nondet grant = GrantReplies.oneOf(); readReply(id, grant)},
    {nondet id = LinkIds.oneOf(); nondet allow = Bool.oneOf(); hostReply(id, allow)},
    {nondet id = LinkIds.oneOf(); nondet outcome = Outcomes.oneOf(); nondet revision = 0.to(3).oneOf(); linkReply(id, outcome, revision)},
    s' = s,
  }
  val LinkOwnsBusy = s.linkActive == 0 or {
    val job = s.links.get(s.linkActive)
    job.intent == s.intent and job.owner == s.owner and not(job.aborted)
      and Set("host", "helper").contains(job.phase)
  }
  val SeparateAccountRead = s.accountActive == 0 or s.reads.keys().contains(s.accountActive)
  val Bounded = s.owner.in(Owners) and s.lastIntent.in(0.to(4)) and s.lastRead.in(0.to(6)) and s.lastLink.in(0.to(5))
  val HelperOnce = s.helperCalls.indices().forall(i =>
    s.helperCalls.select(call => call == s.helperCalls.nth(i)).length() == 1)
  val safety = LinkOwnsBusy and SeparateAccountRead and Bounded and HelperOnce

  run staleSameIntentResultCannotReplaceLatestReviewTest = initWith(false).then(open).then(readReply(1, "write")).then(sync)
    .then(replaceOwner).then(readReply(2, "write")).then(sync).then(linkReply(2, "synced", 2))
    .then(linkReply(1, "unconfirmed", 1)).expect(s.intents.get(1).review == 2 and s.notice == "synced" and safety)
  run staleFinallyKeepsReplacementReadBusyTest = initWith(false).then(open).then(readReply(1, "write")).then(sync)
    .then(replaceOwner).then(linkReply(1, "not-linked", 0))
    .expect(s.accountActive == 2 and s.linkActive == 0 and busy and safety)
  run staleHostPermissionCannotStartHelperTest = initWith(true).then(open).then(readReply(1, "write")).then(sync)
    .then(replaceOwner).then(hostReply(1, true)).expect(s.helperCalls == List() and s.accountActive == 2 and safety)
  run retiredIntentCannotPublishLateResultTest = initWith(false).then(open).then(readReply(1, "write")).then(sync)
    .then(open).then(sync).then(linkReply(1, "synced", 1)).expect(s.linkActive == 2 and s.intents.get(1).review == 0 and safety)
  run needsGrantKeepsCurrentRetainedReviewTest = initWith(false).then(open).then(readReply(1, "write")).then(sync)
    .then(linkReply(1, "synced", 1)).then(sync).then(linkReply(2, "needs-grant", 0))
    .expect(s.intents.get(1).review == 1 and s.notice == "needs-grant" and safety)
  run hostRefusalEndsAuthorizationAfterVerifiedReturnTest = initWith(true).then(open).then(readReply(1, "read"))
    .then(authorize).then(reload).then(readReply(2, "write")).then(hostReply(1, false))
    .expect(not(s.intents.get(1).authorizing) and not(busy) and s.notice == "host-refused" and safety)
}
