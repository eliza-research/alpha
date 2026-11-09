// Calendar's owner-bound editor and held durable slot operations.
module CanonicalCalendarDraft {
  type Draft = {owner: str, title: str}
  type Slot = {present: bool, draft: Draft}
  type Write = {kind: str, lease: int, draft: Draft}
  type State = {live: bool, owner: str, bound: str, lease: int, sequence: int,
    form: Draft, text: Draft, suppressed: Draft, slots: str -> Slot, reads: str -> int,
    writes: str -> Write, opening: bool, foreign: bool, error: bool, conflict: bool, savedText: Draft, consuming: bool,
    recoveryOpen: bool, remembered: int, notices: int}
  var s: State

  pure val Owners = Set("A", "B")
  pure val OwnerClasses = Owners.union(Set(""))
  pure val Titles = Set("First A", "New A", "Current B", "Saved A", "Saved B")
  pure val NoDraft: Draft = {owner: "", title: ""}
  pure val NoSlot: Slot = {present: false, draft: NoDraft}
  pure val NoWrite: Write = {kind: "", lease: 0, draft: NoDraft}
  pure def row(draft: Draft): Slot = {present: true, draft: draft}
  pure def selected(value: State): bool = value.live and value.owner != "" and value.bound == value.owner and value.lease != 0
  val renderedForm = if (s.live and s.form.owner == s.owner) s.form.title else ""
  val resumeOffered = selected(s) and renderedForm == "" and s.text != NoDraft
  val busy = selected(s) and (s.opening or s.consuming)
  val recovery = s.bound != "" and not(s.foreign)
  val storageError = selected(s) and s.error

  action init = s' = {live: true, owner: "", bound: "", lease: 0, sequence: 0, form: NoDraft,
    text: NoDraft, suppressed: NoDraft, slots: Owners.mapBy(_ => NoSlot), reads: Owners.mapBy(_ => 0),
    writes: Owners.mapBy(_ => NoWrite), opening: true, foreign: false, error: false, conflict: false, savedText: NoDraft, consuming: false,
    recoveryOpen: false, remembered: 0, notices: 0}
  action seed(slotOwner: str, payloadOwner: str, title: str): bool = all {
    Owners.contains(slotOwner), Owners.contains(payloadOwner), Titles.contains(title),
    s.bound != slotOwner, s.reads.get(slotOwner) == 0, s.writes.get(slotOwner) == NoWrite,
    s' = {...s, slots: s.slots.set(slotOwner, row({owner: payloadOwner, title: title}))}}
  action setOwner(owner: str): bool = all {s.live, OwnerClasses.contains(owner), s' = {...s, owner: owner}}

  pure def read(value: State): State = {
    val stored = value.slots.get(value.bound).draft
    if (stored != NoDraft and stored.owner != value.bound) {...value, foreign: true}
    else {...value, text: stored, opening: false}
  }
  pure def synchronizeOwner(value: State, held: bool): State = {
    val hidden = if (value.form.owner == value.owner) value.form else NoDraft
    if (value.owner == value.bound) {...value, form: hidden}
    else {
      val reset = {...value, bound: value.owner, form: hidden, text: NoDraft, suppressed: NoDraft,
        opening: true, foreign: false, error: false, conflict: false, savedText: NoDraft, consuming: false, recoveryOpen: false}
      if (reset.bound == "") {...reset, lease: 0}
      else {
        val lease = value.sequence + 1
        val opened = {...reset, sequence: lease, lease: lease}
        if (held) {...opened, reads: opened.reads.set(opened.bound, lease)} else read(opened)
      }
    }
  }
  pure def canBind(value: State, owner: str, held: bool): bool = value.live and OwnerClasses.contains(owner)
    and (owner == value.bound or owner == "" or value.sequence < 6)
    and (not(held) or Owners.contains(owner) and owner != value.bound and value.reads.get(owner) == 0)
  action bind(owner: str, held: bool): bool = all {canBind(s, owner, held),
    s' = synchronizeOwner({...s, owner: owner}, held)}
  action synchronize = all {canBind(s, s.owner, false), s' = synchronizeOwner(s, false)}
  action releaseRead(owner: str): bool = all {Owners.contains(owner), s.reads.get(owner) != 0,
    val settled = {...s, reads: s.reads.set(owner, 0)}
    s' = if (s.bound == owner and s.lease == s.reads.get(owner)) read(settled) else settled}
  action failRead = all {s.opening, s.foreign, s' = {...s, opening: false, error: true}}

  action edit(title: str, held: bool): bool = all {
    selected(s), not(s.opening or s.error or s.conflict or s.consuming), Titles.contains(title), s.writes.get(s.bound) == NoWrite,
    val draft = {owner: s.owner, title: title}
    val visible = {...s, form: draft}
    s' = if (draft == s.suppressed or draft == s.text) visible
      else if (held) {...visible, text: draft, writes: s.writes.set(s.bound, {kind: "write", lease: s.lease, draft: draft})}
      else {...visible, text: draft, slots: s.slots.set(s.bound, row(draft))}}
  action closeForm = all {s.live, s' = {...s, form: NoDraft}}
  action resume = all {resumeOffered, s' = {...s, form: s.text}}
  action restoreSaved = all {selected(s), s.conflict, s' = {...s, conflict: false, text: s.savedText, form: s.savedText}}
  pure def canConsume(value: State): bool = selected(value) and not(value.opening or value.error or value.conflict or value.consuming)
    and value.form == NoDraft and value.text != NoDraft and value.writes.get(value.bound) == NoWrite
  pure def clear(value: State, held: bool): State =
    if (held) {...value, consuming: true, writes: value.writes.set(value.bound, {kind: "clear", lease: value.lease, draft: value.text})}
    else {...value, slots: value.slots.set(value.bound, row(NoDraft)), text: NoDraft}
  action commit(held: bool): bool = all {canConsume(s), s' = clear({...s, suppressed: s.text}, held)}
  action discard(held: bool): bool = all {canConsume(s), s' = clear(s, held)}
  action commitForeign(owner: str): bool = all {Owners.contains(owner), owner != s.owner, s' = s}
  action remember = all {selected(s), s.form == NoDraft, s' = {...s, remembered: s.lease}}
  action useRemembered = all {s.remembered != 0,
    s' = if (s.lease == s.remembered and canConsume(s)) clear(s, false) else s}
  action releaseWrite(owner: str): bool = all {Owners.contains(owner), s.writes.get(owner) != NoWrite,
    val job = s.writes.get(owner)
    val settled = {...s, writes: s.writes.set(owner, NoWrite)}
    s' = if (job.kind == "write") {...settled, slots: s.slots.set(owner, row(job.draft))}
      else if (s.bound == owner and s.lease == job.lease and selected(s) and s.text == job.draft)
        {...settled, consuming: false, text: NoDraft, slots: s.slots.set(owner, row(NoDraft))}
      // A late clear cannot erase the returned same-owner editor; it requires review.
      else if (s.bound == owner)
        {...settled, consuming: false, conflict: true, savedText: s.slots.get(owner).draft}
      else settled}
  action openRecovery = s' = if (selected(s) and recovery) {...s, recoveryOpen: true} else s
  action retire = all {s.live, s' = {...s, live: false, bound: "", lease: 0, opening: true,
    foreign: false, error: false, conflict: false, savedText: NoDraft, consuming: false, recoveryOpen: false}}

  action step = any {
    synchronize, failRead, closeForm, resume, restoreSaved, remember, useRemembered, openRecovery, retire,
    {nondet slotOwner = Owners.oneOf(); nondet payloadOwner = Owners.oneOf(); nondet title = Titles.oneOf(); seed(slotOwner,payloadOwner,title)},
    {nondet owner = OwnerClasses.oneOf(); setOwner(owner)},
    {nondet owner = OwnerClasses.oneOf(); nondet held = Bool.oneOf(); bind(owner,held)},
    {nondet owner = Owners.oneOf(); releaseRead(owner)},
    {nondet title = Titles.oneOf(); nondet held = Bool.oneOf(); edit(title,held)},
    {nondet held = Bool.oneOf(); commit(held)},
    {nondet held = Bool.oneOf(); discard(held)},
    {nondet owner = Owners.oneOf(); commitForeign(owner)},
    {nondet owner = Owners.oneOf(); releaseWrite(owner)}, s' = s,
  }

  val OwnsEditor = not(s.live) or s.text == NoDraft or s.text.owner == s.bound
  val CurrentLease = (s.lease == 0 iff s.bound == "") and s.lease.in(0.to(s.sequence)) and s.sequence.in(0.to(6))
  val ForeignUnavailable = s.foreign implies not(recovery) and not(resumeOffered)
  val OwnsWrites = Owners.forall(owner => s.writes.get(owner) == NoWrite or s.writes.get(owner).draft.owner == owner)
  val safety = OwnsEditor and CurrentLease and ForeignUnavailable and OwnsWrites and s.notices == 0

  run previousAccountBytesStayInOriginalSlotTest = init.then(bind("A",false)).then(edit("First A",false))
    .then(setOwner("")).expect(renderedForm == "").then(synchronize).then(bind("B",false))
    .expect(s.slots.get("B") == NoSlot and s.slots.get("A").draft.title == "First A" and safety)
  run oldReadCannotFillNextAccountTest = init.then(seed("A","A","Saved A")).then(seed("B","B","Saved B"))
    .then(bind("A",true)).then(bind("B",false)).then(releaseRead("A")).expect(s.text.title == "Saved B" and safety)
  run queuedEditStaysWithCapturedOwnerTest = init.then(bind("A",false)).then(edit("First A",true))
    .then(bind("B",false)).then(edit("Current B",false)).then(releaseWrite("A"))
    .expect(s.slots.get("A").draft.title == "First A" and s.text.title == "Current B" and safety)
  run lateClearKeepsOriginalAccountDraftTest = init.then(bind("A",false)).then(edit("First A",false)).then(closeForm)
    .then(commit(true)).then(bind("B",false)).then(releaseWrite("A"))
    .expect(s.slots.get("A").draft.title == "First A" and s.slots.get("B") == NoSlot and safety)
  run foreignStoredFrameCannotBeOfferedTest = init.then(seed("B","A","Saved A")).then(bind("B",false)).then(failRead)
    .then(openRecovery).expect(not(s.recoveryOpen) and not(resumeOffered) and s.slots.get("B").draft.owner == "A" and safety)
  run earlierLifetimeCannotDiscardNewDraftTest = init.then(bind("A",false)).then(edit("First A",false)).then(closeForm)
    .then(remember).then(bind("B",false)).then(bind("A",false)).then(edit("New A",false)).then(closeForm)
    .then(useRemembered).expect(s.text.title == "New A" and s.slots.get("A").draft.title == "New A" and safety)
}
