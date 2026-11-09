// Durable native digest consent, exact source identity and closed source readback.
module NativeDigestConsent {
  type Grant = {present: bool, revoked: bool, integrity: bool, scope: int, reviewed: int, expiry: int}
  type GrantReply = {scope: int, expiry: int, revoked: bool}
  type State = {rows: int -> Grant, owner: int, generation: int, now: int, foreground: bool,
    transport: bool, calendarRevision: int, calendarPermission: bool, writes: int, calendarReads: int,
    reminderReads: int, restarts: int, reply: str, requestKind: str, grantReply: GrantReply,
    events: int, reminders: List[str], readOwner: int, readSource: int, readGeneration: int,
    readKind: str, readProfile: str, readScope: int}
  var s: State

  val week = 604800000
  val sources = Set(1,2)
  val owners = Set(0,1,2)
  val scopeKinds = Set("both","reminders","calendar","small","no-source","no-egress","bad-zone","duplicate","too-large")
  val addresses = Set("exact","owner","agent","install","enroll","session","revision","extra","provider")
  val faults = Set("none","before","after","foreground-after")
  val readKinds = Set("morning","evening","describe","explicit-morning")
  val profiles = Set("normal","calendar-many","bytes")
  val clocks = Set(0,100,101,120000,week,week+1)
  val occurrences = Set(-2100001,-2100000,0,100,120000,120001)
  val emptyGrant: Grant = {present:false,revoked:false,integrity:true,scope:0,reviewed:0,expiry:0}
  val emptyReply: GrantReply = {scope:0,expiry:0,revoked:false}
  action init: bool = s'={
    rows:Map((11,emptyGrant),(12,emptyGrant),(21,emptyGrant),(22,emptyGrant)),
    owner:1,generation:1,now:0,foreground:true,transport:true,calendarRevision:1,calendarPermission:true,
    writes:0,calendarReads:0,reminderReads:0,restarts:0,reply:"none",requestKind:"none",grantReply:emptyReply,
    events:0,reminders:List(),readOwner:0,readSource:0,readGeneration:0,readKind:"none",readProfile:"none",readScope:0
  }
  pure def key(owner: int, source: int): int = (if (owner==0) 1 else owner)*10+source
  pure def scopeId(kind: str): int =
    if (kind=="reminders") 1 else if (kind=="calendar") 2 else if (kind=="small") 3 else if (kind=="both") 4 else 0
  pure def hasCalendar(scope: int): bool = scope.in(Set(2,3,4))
  pure def hasReminders(scope: int): bool = scope.in(Set(1,3,4))
  pure def selectedSource(st: State, scope: int): bool = not(hasCalendar(scope)) or st.calendarRevision==1
  pure def live(st: State, row: Grant): bool = row.present and not(row.revoked) and row.integrity and row.expiry>st.now
  pure def connected(st: State): bool = st.owner!=0 and st.transport
  pure def answer(st: State, kind: str, reply: str): State =
    {...st,requestKind:kind,reply:reply,grantReply:emptyReply,events:0,reminders:List()}
  pure def returnGrant(st: State, kind: str, result: str, row: Grant): State =
    {...answer(st,kind,result),grantReply:{scope:row.scope,expiry:row.expiry,revoked:row.revoked}}

  action environment(front: bool, link: bool, permission: bool, revision: int): bool = all {
    revision.in(Set(1,2)),s'={...s,foreground:front,transport:link,calendarPermission:permission,calendarRevision:revision}
  }
  action connect(owner: int): bool = all {owner.in(owners),s.generation<6,s'={...s,owner:owner,generation:s.generation+1}}
  action clock(time: int): bool = all {time.in(clocks),time>=s.now,s'={...s,now:time}}
  action restart: bool = all {s.restarts<2,s.readOwner==0,s'={...s,restarts:s.restarts+1}}
  action corrupt(source: int): bool = all {
    source.in(sources),s.owner!=0,
    val slot=key(s.owner,source)
    val row=s.rows.get(slot)
    all {row.present,row.scope!=3,s'={...s,rows:s.rows.set(slot,{...row,scope:3,integrity:false})}}
  }

  pure def save(st: State, slot: int, row: Grant, fault: str): State =
    {...st,writes:st.writes+1,rows:if (fault=="before") st.rows else st.rows.set(slot,row),
      foreground:st.foreground and fault!="foreground-after"}
  pure def applyConsent(st: State, source: int, kind: str, expiry: int, fault: str, address: str, revoke: bool): State = {
    val command=if (revoke) "revoke" else "approve"
    val refused=answer(st,command,"refused")
    val scope=scopeId(kind)
    val slot=key(st.owner,source)
    val row=st.rows.get(slot)
    if (not(connected(st) and st.foreground) or address!="exact") refused
    else if (revoke) {
      if (not(row.present)) answer(st,command,"revoked")
      else answer(save(st,slot,{...row,revoked:true},fault),command,
        if (fault.in(Set("before","after"))) "refused" else "revoked")
    }
    else if (scope==0 or not(selectedSource(st,scope)) or expiry<=st.now or expiry-st.now>week) refused
    else if (row.present) {
      if (not(row.revoked) and row.reviewed==scope and row.expiry==expiry) returnGrant(st,command,"approved",row)
      else refused
    }
    else {
      val grant={present:true,revoked:false,integrity:true,scope:scope,reviewed:scope,expiry:expiry}
      val changed=save(st,slot,grant,fault)
      if (fault=="none") returnGrant(changed,command,"approved",grant) else answer(changed,command,"refused")
    }
  }
  action consent(source: int,kind: str,expiry: int,fault: str,address: str,revoke: bool): bool = all {
    source.in(sources),kind.in(scopeKinds),expiry.in(clocks),fault.in(faults),address.in(addresses),
    s.writes<12,
    s.readProfile!="identity" or revoke or not(hasCalendar(scopeId(kind))),
    s'=applyConsent(s,source,kind,expiry,fault,address,revoke)
  }

  pure def occurrenceValid(st: State, occurrence: int): bool = st.now-occurrence<=2100000 and occurrence-st.now<=120000
  pure def projected(st: State, kind: str, scope: int): State = {
    val accepted=answer(st,kind,"read")
    val reminders=if (not(hasReminders(scope))) List()
      else if (kind=="evening") List("overdue","today","done","recurring") else List("overdue","today")
    {...accepted,events:if (hasCalendar(scope)) 1 else 0,reminders:reminders}
  }
  pure def projectedRead(st: State, kind: str, scope: int, profile: str): State = {
    val calendar=hasCalendar(scope)
    val reminders=hasReminders(scope)
    val counted={...st,calendarReads:st.calendarReads+(if (calendar and st.calendarPermission) 1 else 0)}
    if (calendar and (not(st.calendarPermission) or profile=="calendar-many")) answer(counted,kind,"refused")
    else {
      val done={...counted,reminderReads:st.reminderReads+(if (reminders) 1 else 0)}
      if (scope==3 or calendar and profile=="bytes") answer(done,kind,"refused") else projected(done,kind,scope)
    }
  }
  pure def readNow(st: State, source: int, kind: str, address: str, occurrence: int, profile: str): State = {
    val row=st.rows.get(key(st.owner,source))
    if (not(connected(st)) or address.in(Set("extra","provider"))) answer(st,kind,"refused")
    else if (address!="exact" or not(live(st,row))) answer(st,kind,"changed")
    else if (not(selectedSource(st,row.scope))) answer(st,kind,"refused")
    else if (kind=="describe") returnGrant(st,kind,"described",row)
    else if (kind=="explicit-morning" or not(occurrenceValid(st,occurrence))) answer(st,kind,"refused")
    else projectedRead(st,kind,row.scope,profile)
  }
  action read(source: int,kind: str,address: str,occurrence: int,profile: str): bool = all {
    source.in(sources),kind.in(readKinds),address.in(addresses.exclude(Set("session"))),
    occurrence.in(occurrences),profile.in(profiles),s.readOwner==0,s.calendarReads<12,s.reminderReads<12,
    s'=readNow(s,source,kind,address,occurrence,profile)
  }
  action holdRead(source: int,kind: str,port: str): bool = all {
    source.in(sources),kind.in(Set("describe","morning","evening")),s.readOwner==0,connected(s),
    s.calendarReads<12,s.reminderReads<12,
    val row=s.rows.get(key(s.owner,source))
    all {
      live(s,row), selectedSource(s,row.scope),
      (port=="identity" and kind=="describe" and hasCalendar(row.scope)) or
      (kind!="describe" and ((port=="calendar" and hasCalendar(row.scope) and s.calendarPermission) or
        (port=="reminders" and row.scope==1))),
      s'={...s,readOwner:s.owner,readSource:source,readGeneration:s.generation,readKind:kind,
        readProfile:port,readScope:row.scope,
        calendarReads:s.calendarReads+(if (port=="calendar") 1 else 0),
        reminderReads:s.reminderReads+(if (port=="reminders") 1 else 0)}
    }
  }
  action finishRead: bool = all {
    s.readOwner!=0,
    val kind=s.readKind
    val scope=s.readScope
    val row=s.rows.get(key(s.readOwner,s.readSource))
    val cleared={...s,readOwner:0,readSource:0,readGeneration:0,readKind:"none",readProfile:"none",readScope:0}
    val same=connected(s) and s.owner==s.readOwner and s.generation==s.readGeneration
    val counted={...cleared,reminderReads:s.reminderReads+(if (s.readProfile=="calendar" and hasReminders(scope)
      and s.calendarPermission) 1 else 0)}
    // As built, describe returns the grant captured before the Calendar identity check.
    val snapshot={present:true,revoked:false,integrity:true,scope:scope,reviewed:scope,expiry:row.expiry}
    s'=if (kind=="describe") {
      if (not(same and selectedSource(s,scope))) answer(cleared,kind,"refused")
      else returnGrant(cleared,kind,"described",snapshot)
    } else if (s.readProfile=="calendar" and not(s.calendarPermission)) answer(cleared,kind,"refused")
      else if (scope==3 or not(same and selectedSource(s,scope))) answer(counted,kind,"refused")
      else if (not(live(s,row))) answer(counted,kind,"changed")
      else projected(counted,kind,scope)
  }

  val NoPayloadOnRefusal = not(s.reply.in(Set("refused","changed"))) or
    (s.grantReply==emptyReply and s.events==0 and s.reminders==List())
  val ExactSelectionCustody = s.readOwner!=0 or (s.readSource==0 and s.readGeneration==0 and s.readScope==0)
  val BoundedProjectedOutput = s.events+s.reminders.length()<=12
  val NoUnreviewedReminder = s.reminders.indices().forall(i => s.reminders.nth(i).in(Set("today","overdue","done","recurring")))
  val safety=all {NoPayloadOnRefusal,ExactSelectionCustody,BoundedProjectedOutput,NoUnreviewedReminder}
  action step = any {
    { nondet front=Bool.oneOf(); nondet link=Bool.oneOf(); nondet permission=Bool.oneOf();
      nondet revision=Set(1,2).oneOf(); environment(front,link,permission,revision) },
    { nondet owner=owners.oneOf(); connect(owner) },
    { nondet time=clocks.oneOf(); clock(time) },
    restart,
    { nondet source=sources.oneOf(); corrupt(source) },
    { nondet source=sources.oneOf(); nondet kind=scopeKinds.oneOf(); nondet expiry=clocks.oneOf();
      nondet fault=faults.oneOf(); nondet address=addresses.oneOf(); nondet revoke=Bool.oneOf();
      consent(source,kind,expiry,fault,address,revoke) },
    { nondet source=sources.oneOf(); nondet kind=readKinds.oneOf(); nondet address=addresses.exclude(Set("session")).oneOf();
      nondet occurrence=occurrences.oneOf(); nondet profile=profiles.oneOf(); read(source,kind,address,occurrence,profile) },
    { nondet source=sources.oneOf(); nondet kind=Set("describe","morning","evening").oneOf();
      nondet port=Set("identity","calendar","reminders").oneOf(); holdRead(source,kind,port) },
    finishRead,s'=s,
  }

  run describeCanReturnRevokedSnapshotAsBuiltTest = init
    .then(consent(1,"both",week,"none","exact",false)).then(holdRead(1,"describe","identity"))
    .then(consent(1,"both",0,"none","exact",true)).then(finishRead)
    .expect(s.rows.get(11).revoked and s.reply=="described" and not(s.grantReply.revoked))
  run describeCanReturnExpiredSnapshotAsBuiltTest = init
    .then(consent(1,"both",100,"none","exact",false)).then(holdRead(1,"describe","identity")).then(clock(100))
    .then(finishRead).expect(s.reply=="described" and s.grantReply.expiry==s.now)
  run heldContentRejectsRevokedGrantTest = init
    .then(consent(1,"both",week,"none","exact",false)).then(holdRead(1,"morning","calendar"))
    .then(consent(1,"both",0,"none","exact",true)).then(finishRead)
    .expect(s.reply=="changed" and s.events==0 and s.reminders==List())
  run expiredWhileReadingNeverPublishesTest = init
    .then(consent(1,"both",100,"none","exact",false)).then(holdRead(1,"morning","calendar"))
    .then(clock(100)).then(finishRead).expect(s.reply=="changed" and s.calendarReads==1 and s.reminderReads==1)
  run storeRefusalAfterCommitKeepsGrantTest = init
    .then(consent(1,"both",week,"after","exact",false)).expect(s.reply=="refused" and s.rows.get(11).present)
    .then(restart).then(read(1,"describe","exact",0,"normal")).expect(s.reply=="described")
  run bothTemplatesReadOnlyApprovedProjectionTest = init
    .then(consent(1,"both",week,"none","exact",false))
    .then(read(1,"morning","exact",0,"normal")).expect(s.events==1 and s.reminders==List("overdue","today"))
    .then(read(1,"evening","exact",0,"normal")).expect(s.reminders==List("overdue","today","done","recurring"))
  run noCalendarPortForReminderOnlyTest = init.then(environment(true,true,false,2))
    .then(consent(1,"reminders",week,"none","exact",false))
    .then(read(1,"evening","exact",0,"normal")).expect(s.reply=="read" and s.events==0 and s.calendarReads==0)
}
