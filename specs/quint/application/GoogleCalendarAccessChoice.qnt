// Verified Google Calendar access choice and permission continuation.
module GoogleCalendarAccessChoice {
  type Read = {owner: int, grant: str}
  type Context = {owner: int, intent: int, read: int, kind: str}
  type Capture = {context: Context, stage: str, settled: bool}
  type State = {owner: int, intent: int, lastIntent: int, read: int, lastRead: int, reads: int -> Read,
    saved: bool, choice: Context, lastCapture: int, captures: int -> Capture, consentIntent: int,
    saves: List[int], links: List[int], consents: List[int], notice: str}
  var s: State

  pure val Grants = Set("read", "write")
  pure val Captures = 1.to(6)
  pure val NoChoice: Context = {owner: 0, intent: 0, read: 0, kind: ""}
  action initWith(saved: bool): bool = s' = {owner: 1, intent: 0, lastIntent: 0, read: 0, lastRead: 0, reads: Map(),
    saved: saved, choice: NoChoice, lastCapture: 0, captures: Map(), consentIntent: 0,
    saves: List(), links: List(), consents: List(), notice: ""}
  action init = initWith(false)

  pure def loaded(value: State, grant: str): State = {
    val id = value.lastRead + 1
    {...value, read: id, lastRead: id, reads: value.reads.put(id, {owner: value.owner, grant: grant}), notice: "calendar-includes"}
  }
  action open(grant: str): bool = all {
    Grants.contains(grant), s.lastIntent < 4, s.intent != 0 or s.lastRead < 6,
    val id = s.lastIntent + 1
    val opened = {...s, intent: id, lastIntent: id}
    s' = if (s.intent == 0) loaded(opened, grant) else opened,
  }
  action close = all {s.intent != 0, s' = {...s, intent: 0, read: 0}}
  action reload(grant: str): bool = all {
    Grants.contains(grant), s.intent != 0, s.consentIntent != s.intent, s.lastRead < 6,
    s' = loaded(s, grant),
  }
  action replaceOwner(grant: str): bool = all {
    Grants.contains(grant), s.owner == 1, s.intent == 0 or (s.consentIntent != s.intent and s.lastRead < 6),
    val replaced = {...s, owner: 2}
    s' = if (s.intent == 0) replaced else loaded(replaced, grant),
  }

  pure def scopeCurrent(value: State, context: Context): bool =
    context.intent != 0 and value.intent == context.intent and value.owner == context.owner
  pure def readCurrent(value: State, context: Context): bool =
    scopeCurrent(value, context) and value.read == context.read and context.read != 0
  val choiceVisible = readCurrent(s, s.choice)
  val busy = s.captures.keys().exists(id => {
    val task = s.captures.get(id)
    not(task.settled) and task.stage == "ask" and task.context.kind == "link" and scopeCurrent(s, task.context)
  })
  pure def capture(value: State, context: Context, stage: str): State = {
    val id = value.lastCapture + 1
    {...value, lastCapture: id, captures: value.captures.put(id, {context: context, stage: stage, settled: false})}
  }
  action requestAccess = all {
    s.read != 0, not(busy), s.lastCapture < 6,
    val kind = if (s.reads.get(s.read).grant == "write") "link" else "consent"
    val base = if (kind == "link") {...s, notice: "connecting"} else s
    s' = capture(base, {owner: s.owner, intent: s.intent, read: s.read, kind: kind}, "ask"),
  }
  action allow = all {
    choiceVisible, not(busy), s.lastCapture < 6,
    s' = capture({...s, choice: NoChoice}, s.choice, "allow"),
  }
  pure def admit(value: State, task: Capture): State = {
    val read = task.context.read
    val saved = {...value, saved: true, saves: if (value.saved) value.saves else value.saves.append(read)}
    if (task.context.kind == "link") {...saved, links: saved.links.append(read), notice: "synced"}
    else {...saved, consents: saved.consents.append(read), consentIntent: task.context.intent, notice: "authorization"}
  }
  action reply(id: int, readable: bool): bool = all {
    s.captures.keys().contains(id),
    val task = s.captures.get(id)
    all {
      not(task.settled),
      val done = {...s, captures: s.captures.set(id, {...task, settled: true})}
      s' = if (not(scopeCurrent(s, task.context))) done
        else if (not(readCurrent(s, task.context))) {
          if (task.stage == "ask") {...done, notice: "unverified"} else done
        } else if (task.stage == "allow" and not(readable)) {...done, notice: "unreadable-save"}
        else if (task.stage == "allow" or readable and s.saved) admit(done, task)
        else {...done, choice: task.context, notice: if (readable) "off-choice" else "unreadable-choice"},
    },
  }

  action step = any {
    close, requestAccess, allow,
    {nondet grant = Grants.oneOf(); open(grant)},
    {nondet grant = Grants.oneOf(); reload(grant)},
    {nondet grant = Grants.oneOf(); replaceOwner(grant)},
    {nondet id = Captures.oneOf(); nondet readable = Bool.oneOf(); reply(id, readable)},
    s' = s,
  }
  val ExactChoice = not(choiceVisible) or (s.reads.get(s.choice.read).owner == s.owner
    and s.choice.kind == (if (s.reads.get(s.choice.read).grant == "write") "link" else "consent"))
  val VerifiedDispatch = s.links.indices().forall(i => s.reads.get(s.links.nth(i)).grant == "write")
    and s.consents.indices().forall(i => s.reads.get(s.consents.nth(i)).grant == "read")
  val Bounded = s.owner.in(1.to(2)) and s.lastIntent.in(0.to(4)) and s.lastRead.in(0.to(6)) and s.lastCapture.in(0.to(6))
  val safety = ExactChoice and VerifiedDispatch and Bounded

  run replacementReadOnlyRetiresOldWriteChoiceTest = init.then(open("write")).then(requestAccess).then(reply(1, true))
    .then(replaceOwner("read")).expect(not(choiceVisible) and s.saves == List() and s.links == List() and safety)
  run freshReplacementWriteReviewAdmitsItsOwnChoiceTest = init.then(open("write")).then(requestAccess).then(reply(1, true))
    .then(replaceOwner("read")).then(reload("write")).then(requestAccess).then(reply(2, true)).then(allow).then(reply(3, true))
    .expect(s.links == List(3) and s.saves == List(3) and safety)
  run newerSameOwnerReadRetiresHeldAllowTest = init.then(open("write")).then(requestAccess).then(reply(1, true))
    .then(allow).then(reload("read")).then(reply(2, true)).expect(s.links == List() and s.saves == List() and safety)
  run retiredIntentCannotShowHeldPermissionChoiceTest = init.then(open("write")).then(requestAccess)
    .then(open("write")).then(reply(1, true)).expect(not(choiceVisible) and s.saves == List() and safety)
  run freshReadOnlyAllowContinuesConsentTest = init.then(open("read")).then(requestAccess).then(reply(1, true))
    .then(allow).then(reply(2, true)).expect(s.consents == List(1) and s.links == List() and safety)
}
