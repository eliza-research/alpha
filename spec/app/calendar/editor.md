# Calendar editor

A new event or a change to one, and every write Alpha makes to the phone's
calendar: a save, a delete, an answer to an invitation. The form's edits are
kept on the phone as they are typed, so a restart loses nothing; a save
builds on the revision the edits began from; a write is sent once, and one
whose outcome is unknown holds what depends on it until a read shows what
happened. People, video calls and alerts are written by Android Calendar,
never by Alpha. An answer to an invitation of the agent's calendar goes to
the agent. What a form may set, and why Save is off, are the
[writing rules](./writing.md). The [calendar](./index.md) shows the events
this writes.

## Story: Write an event

> As the owner, I want to write a new event or change one, its title, its
> day and time in its time zone, whether it lasts all day, how it repeats and
> which occurrences a change applies to, and have it saved once, by the
> account I am signed in to.

### The editor holds the form and the event it edits, the form's draft and recovery banner, the one write in flight, and what is in doubt

A form is for a new event or for an existing one, on screen or kept aside.
Its day is a civil date, never an offset from today, so a form opened
before midnight keeps its date after it. Its draft counts the
owner's edits and the event revision they build on; it is kept on the phone,
in the slot of the owner signed in (0 is no owner), unless the phone failed
to keep it, or the owner's slot holds a draft the phone can no longer read.
Whether the form has a title is known. One write to the phone's
calendar is in flight at a time. A create whose outcome is unknown, and the
events whose change is unknown, are remembered across a restart. A
discard or a replace waits for the owner to confirm it.

```quint
import draft as D from "../../kit/draft"
import attempt as A from "../../kit/attempt"
import read as R from "../../kit/read"

type Form = NoForm | NewEvent | EditEvent | EditReminder
type Scope = Unchosen | ThisOne | ThisAndFollowing | WholeSeries
type Banner = NoBanner | Available | Conflict | Failed
type Write = Create | CreateReminder | Update | UpdateReminder | RescheduleReminder | Remove | Reply
type Confirm = NoConfirm | ConfirmDiscard | ConfirmReplace | ConfirmReschedule

type Editor = {
  owner: int, form: Form, shown: bool, target: int, day: int, revision: int, titled: bool,
  allDay: bool, start: int, end: int, repeats: bool, scope: Scope, extras: bool,
  draft: D::Draft, kept: bool, banner: Banner, confirming: Confirm,
  write: A::Attempt, kind: Write, writing: int, filed: bool,
  unknownCreate: bool, separate: bool, receipts: R::Read, latched: Set[int], unreadable: bool,
}

type Effect =
  | Send({ attempt: int, kind: Write, id: int, scope: Scope, base: int })
  | Answer({ attempt: int, id: int, going: bool, base: int })
  | HandOff({ id: int, day: int })
  | CheckReceipts({ ticket: int })
  | KeepDraft
  | ResetSlot

type Composed = { state: Editor, out: List[Effect] }

pure val initial: Editor = {
  owner: 0, form: NoForm, shown: false, target: 0, day: 0, revision: 0, titled: false,
  allDay: false, start: 0, end: 1, repeats: false, scope: Unchosen, extras: false,
  draft: D::blank, kept: false, banner: NoBanner, confirming: NoConfirm,
  write: A::plan(0), kind: Create, writing: 0, filed: false,
  unknownCreate: false, separate: false, receipts: R::unread, latched: Set(), unreadable: false,
}

pure val idValues = Set(1, 2)
pure val revisionValues = Set(0, 1, 2)
pure val dayValues = Set(0, 1)
pure val startValues = Set(0, 1, 2)
pure val endValues = Set(0, 1, 2)
pure val attemptValues = Set(1, 2, 3, 4)
pure val ticketValues = Set(1, 2, 3)
pure val ownerValues = Set(0, 1, 2)

pure def inFlight(s: Editor): bool = A::canConclude(s.write, s.write.id)

pure def withoutForm(write: A::Attempt, s: Editor): Editor =
  { ...s, write: write, form: NoForm, shown: false, target: 0, revision: 0, titled: false, draft: D::blank, kept: false, banner: NoBanner,
    confirming: NoConfirm, separate: false }
```

### A new form opens for a day, and an event opens for editing at the revision read, only when no other draft is kept

A kept draft is restored or discarded first, so it is never replaced
unseen. A new form reads the phone's creation receipts at once: a create is
sent only after they were read.

```quint
pure def opened(day: int, s: Editor): Editor =
  { ...s, form: NewEvent, shown: true, target: 0, day: day, revision: 0, titled: false, allDay: false, start: 0, end: 1,
    repeats: false, scope: Unchosen, extras: false, draft: D::blank, kept: false, banner: NoBanner, separate: false }

pure def readingReceipts(receipts: R::Read, s: Editor): Composed =
  val asked = R::ask(receipts)
  if (receipts.status == R::Loading) { state: s, out: List() }
  else { state: { ...s, receipts: asked }, out: List(CheckReceipts({ ticket: asked.ticket })) }

pure def canNewEvent(s: Editor): bool = s.form == NoForm

pure def newEvent(s: Editor, day: int): Composed = readingReceipts(s.receipts, opened(day, s))

pure def canEditEvent(s: Editor, id: int, revision: int): bool = s.form == NoForm and id > 0 and revision >= 0

pure def editEvent(s: Editor, id: int, revision: int, day: int, repeats: bool): Editor =
  { ...s, form: EditEvent, shown: true, target: id, day: day, revision: revision, titled: true, allDay: false, start: 0, end: 1,
    repeats: repeats, scope: Unchosen, extras: false, draft: { ...D::blank, base: revision }, kept: false,
    banner: NoBanner, separate: false }
```

### Editing a dated reminder opens its own Calendar form at the selected reminder revision

The reminder keeps its resident identity and fields that Calendar does not
edit. There is no provider Calendar event to create, edit or resend. The
carrier opens this form only for the reminder in front of the owner, then
compares the same record and revision before making any write.

```quint
pure def canEditReminder(s: Editor, id: int, revision: int): bool =
  canEditEvent(s, id, revision) and revision > 0

pure def editReminder(s: Editor, id: int, revision: int, day: int): Editor =
  { ...editEvent(s, id, revision, day, false), form: EditReminder, kept: not(s.unreadable),
    draft: { ...D::edit(D::blank), base: revision } }
```

### A note or a scan opens a new event already filled in, as edits to review, only when no other draft is kept

What the note or the scan said is the form's first edit: nothing is saved
until the owner saves it. Where Calendar refuses it, because a draft is
already open or kept, or the phone cannot keep it, the note or the scan
stays as it was and says Calendar did not take it.

```quint
pure def canFromNote(s: Editor): bool = s.form == NoForm and not(s.unreadable)

pure def fromNote(s: Editor, day: int): Composed = readingReceipts(s.receipts, { ...opened(day, s), titled: true, draft: D::edit(D::blank), kept: true })

pure def sometimesFilledFromANote(s: Editor): bool = s.form == NewEvent and s.draft.edits == 1 and s.write.id == 0 and s.kept
```

### Each edit is counted and kept on the phone at once, unless the phone failed to keep the draft

Edits wait while a save is in flight and while the owner chooses between
two drafts. Over a slot the phone cannot read, edits are counted but never
kept, so what the slot holds is not written over.

```quint
pure def typable(s: Editor): bool =
  s.shown and s.draft.sync != D::Saving and not(D::canChoose(s.draft))
    and (s.banner == NoBanner or s.banner == Failed) and s.confirming == NoConfirm

pure def typed(d: D::Draft, edited: Editor): Editor = { ...edited, draft: D::edit(d), kept: edited.banner != Failed and not(edited.unreadable) }

pure def canEditTitle(s: Editor, blank: bool): bool = typable(s)

pure def editTitle(s: Editor, blank: bool): Editor = typed(s.draft, { ...s, titled: not(blank) })

pure def canSetAllDay(s: Editor, allDay: bool): bool = typable(s) and allDay != s.allDay

pure def setAllDay(s: Editor, allDay: bool): Editor = typed(s.draft, { ...s, allDay: allDay })

pure def canSetRepeats(s: Editor, repeats: bool): bool = typable(s) and repeats != s.repeats

pure def setRepeats(s: Editor, repeats: bool): Editor =
  typed(s.draft, { ...s, repeats: repeats, scope: if (repeats) s.scope else Unchosen })
```

### An event ends after it starts

The time zone travels with the times; an all-day event spans whole days.

```quint
pure def canSetTiming(s: Editor, start: int, end: int): bool = typable(s) and end > start and (start != s.start or end != s.end)

pure def setTiming(s: Editor, start: int, end: int): Editor = typed(s.draft, { ...s, start: start, end: end })

pure def alwaysAnEventEndsAfterItStarts(s: Editor): bool = s.end > s.start
```

### A change to a repeating event says which occurrences it applies to: this one, this and following, or the whole series

```quint
pure def canChooseScope(s: Editor, scope: Scope): bool =
  s.shown and s.form == EditEvent and s.repeats and scope != Unchosen and scope != s.scope and s.draft.sync != D::Saving

pure def chooseScope(s: Editor, scope: Scope): Editor = { ...s, scope: scope }
```

### Saving sends the form once, as a new numbered write built on the revision its edits began from

Only an edited draft with a title is saved; not while a banner asks the
owner something, not while another write is in flight, not while a change
is in doubt for its event, and a new event only once the phone's creation receipts were
read, and not while an earlier create is in doubt unless the owner asked
for a separate event. A receipt read that failed holds the create:
recovery is unavailable until the receipts are read again. Save says why it
is off, one reason, in the writing rules' order.

```quint
pure def sent(kind: Write, id: int, s: Editor): Composed =
  val w = A::dispatch(A::record(A::plan(s.write.id + 1)))
  { state: { ...s, write: w, kind: kind, writing: id, filed: false }, out: List(Send({ attempt: w.id, kind: kind, id: id, scope: s.scope, base: s.draft.base })) }

pure def canSave(s: Editor): bool =
  (s.form == NewEvent or s.form == EditEvent) and s.shown and D::canSave(s.draft)
    and s.titled and s.banner == NoBanner and s.confirming == NoConfirm and not(inFlight(s)) and not(s.extras)
    and (if (s.form == NewEvent) s.receipts.status == R::Loaded and (not(s.unknownCreate) or s.separate)
         else not(s.latched.contains(s.target)) and (not(s.repeats) or s.scope != Unchosen))

pure def save(s: Editor): Composed =
  sent(if (s.form == NewEvent) Create else Update, s.target, { ...s, draft: D::save(s.draft) })
```

### The Calendar's Reminders destination saves a dated reminder through its own on-device store

The form carries its own title, note, date and time, and the reminder's repeat
and lead time. Resolving a Calendar event's provider receipt cannot save or
discard this reminder. A repeated attempt to save the same retained reminder
form looks for its own creation identity before it can add anything.

```quint
pure def canSaveReminder(s: Editor): bool =
  (s.form == NewEvent or s.form == EditReminder) and s.shown and D::canSave(s.draft) and s.titled
    and s.banner == NoBanner and s.confirming == NoConfirm and not(inFlight(s))

pure def saveReminder(s: Editor): Composed =
  sent(if (s.form == EditReminder) UpdateReminder else CreateReminder, s.target, { ...s, draft: D::save(s.draft) })
```

### Moving a completed reminder keeps its edited draft on screen until the owner approves rescheduling

Cancel leaves the draft and the completed reminder as they were. Approval
saves the edited fields and reopens the same reminder in one write.

```quint
pure def canAskReschedule(s: Editor): bool = s.form == EditReminder and canSaveReminder(s)

pure def askReschedule(s: Editor): Editor = { ...s, confirming: ConfirmReschedule }

pure def canReschedule(s: Editor): bool =
  s.confirming == ConfirmReschedule and s.form == EditReminder and canSaveReminder({ ...s, confirming: NoConfirm })

pure def reschedule(s: Editor): Composed =
  sent(RescheduleReminder, s.target, { ...s, draft: D::save(s.draft), confirming: NoConfirm })
```

### A write in flight for the form is the shown form's own save: a create for a new event, a change for an existing one

While a delete or an answer is in flight, no form waits on a save.
Discovered by the proof: without it, a delete could end while a form's save
was in doubt, with neither holding the other.

```quint
pure def alwaysASaveInFlightIsTheShownForm(s: Editor): bool =
  ((inFlight(s) and (s.kind == Create or s.kind == CreateReminder or s.kind == Update or s.kind == UpdateReminder or s.kind == RescheduleReminder))
    implies (s.shown and s.draft.sync == D::Saving and s.writing == s.target and s.banner == NoBanner))
    and ((inFlight(s) and (s.kind == Create or s.kind == CreateReminder)) implies s.form == NewEvent)
    and ((inFlight(s) and s.kind == Update) implies s.form == EditEvent)
    and ((inFlight(s) and (s.kind == UpdateReminder or s.kind == RescheduleReminder)) implies s.form == EditReminder)
    and ((inFlight(s) and (s.kind == Remove or s.kind == Reply)) implies s.draft.sync != D::Saving)
```

### A repeating event's change in flight says which occurrences

```quint
pure def alwaysARepeatingChangeSaysWhichOccurrences(s: Editor): bool =
  (inFlight(s) and s.kind == Update and s.repeats) implies s.scope != Unchosen
```

### Every write takes the next number, and carries it

```quint
pure def stepAWriteTakesTheNextNumber(before: Editor, after: Editor, out: List[Effect]): bool =
  out.every(e => match e {
    | Send(w) => w.attempt == after.write.id and after.write.id == before.write.id + 1
    | Answer(a) => a.attempt == after.write.id and after.write.id == before.write.id + 1
    | _ => true
  })
```

### A saved form closes; a refused one keeps its edits to save again

A change the phone refused because the event moved on is a conflict for the
owner to choose. A saved event's day is then the day Calendar shows. A
write the agent took as a request for the owner's
approval is made only once the owner approves its card: its form closes,
nothing is held in doubt, and Calendar says the change waits for approval.

```quint
pure def canWritten(s: Editor, attempt: int, filed: bool): bool = A::canConclude(s.write, attempt)

pure def written(s: Editor, attempt: int, confirmed: bool, known: bool, filed: bool): Editor =
  val w = A::conclude(s.write, confirmed, known)
  val told = { ...s, write: w, filed: filed and w.outcome == A::Confirmed }
  if (s.kind == CreateReminder or s.kind == UpdateReminder or s.kind == RescheduleReminder) (
    if (w.outcome == A::Confirmed) withoutForm(w, told)
    else { ...told, draft: D::keepMine(s.draft) })
  else if (told.filed) (if (s.kind == Create or s.kind == Update) withoutForm(w, told) else told)
  else if (w.outcome == A::Confirmed)
    (if (s.kind == Create or s.kind == Update) withoutForm(w, told) else if (s.kind == Reply) { ...told, latched: s.latched.union(Set(s.writing)) } else told)
  else if (w.outcome == A::Refused)
    (if (s.kind == Create) { ...told, draft: D::keepMine(s.draft) }
     else if (s.kind == Update) { ...told, revision: s.revision + 1, draft: D::collide(s.draft, s.revision + 1) }
     else told)
  else if (s.kind == Create) { ...told, unknownCreate: true, separate: false }
  else { ...told, latched: s.latched.union(Set(s.writing)) }
```

### The form's edits always build on the revision of the event as last read

```quint
pure def alwaysEditsBuildOnTheEventAsRead(s: Editor): bool =
  s.draft.base == s.revision and (D::canChoose(s.draft) implies s.form == EditEvent)
```

### A form can be saved, and a change to a whole series can be sent

```quint
pure def sometimesSeriesChangeSent(s: Editor): bool = inFlight(s) and s.kind == Update and s.scope == WholeSeries

pure def sometimesAChangeWaitsForApproval(s: Editor): bool = s.filed and s.kind == Update and s.form == NoForm

pure def sometimesSavedAfterEdits(s: Editor): bool = s.write.outcome == A::Confirmed and s.write.id >= 2 and s.form == NoForm
```

## Story: Hand Android Calendar what Alpha cannot write

> As the owner, I want an event with people, a video call or alerts handed
> to Android Calendar to finish, rather than saved without them.

A new event shows its video link, how it repeats and
its alert whenever this phone's calendar is there to take it, whichever
calendar is chosen. The form never moves an event to another calendar on
its own: while the agent's calendar is chosen, these rows offer only what
that calendar holds (once, no alert, no video link), so Save stays in
reach. Choosing the agent's calendar sets them back to that.

### People, a video call or alerts make the form one for Android Calendar

```quint
pure def canSetExtras(s: Editor, extras: bool): bool = typable(s) and extras != s.extras

pure def setExtras(s: Editor, extras: bool): Editor = typed(s.draft, { ...s, extras: extras })
```

### Such a form is handed to Android Calendar and closes; Alpha writes nothing of it

```quint
pure def canHandOff(s: Editor): bool = s.shown and s.extras and s.draft.sync != D::Saving and s.banner == NoBanner

pure def handOff(s: Editor): Composed = { state: withoutForm(s.write, s), out: List(HandOff({ id: s.target, day: s.day })) }

pure def alwaysNothingWithPeopleOrVideoIsWritten(s: Editor): bool =
  (inFlight(s) and (s.kind == Create or s.kind == Update)) implies not(s.extras)
```

## Story: Never create an event twice

> As the owner, I want a new event created once even when the phone never
> said whether it was, and to choose myself to create a separate one.

### While a create is in doubt its form waits; checking the phone's receipts finds it or not

Found, the event exists and its form closes as saved. Not found, the form
keeps its edits, and only a separate event the owner asks for can be
created; the owner may also let the doubt go.

```quint
pure def canCheckReceipts(s: Editor): bool = (s.unknownCreate or s.receipts.status == R::Failed) and s.receipts.status != R::Loading

pure def checkReceipts(s: Editor): Composed =
  val asked = R::ask(s.receipts)
  { state: { ...s, receipts: asked }, out: List(CheckReceipts({ ticket: asked.ticket })) }

pure def canReceiptsChecked(s: Editor, ticket: int): bool = R::canAnswer(s.receipts, ticket)

pure def receiptsChecked(s: Editor, ticket: int, found: bool): Editor =
  val told = { ...s, receipts: R::answer(s.receipts, true) }
  val waiting = s.form == NewEvent and s.draft.sync == D::Saving and not(inFlight(s))
  if (not(s.unknownCreate)) told
  else if (found) (if (waiting) withoutForm(s.write, { ...told, unknownCreate: false }) else { ...told, unknownCreate: false, separate: false })
  else if (waiting) { ...told, draft: D::keepMine(s.draft) }
  else told

pure def canReceiptsFailed(s: Editor, ticket: int): bool = R::canAnswer(s.receipts, ticket)

pure def receiptsFailed(s: Editor, ticket: int): Editor = { ...s, receipts: R::answer(s.receipts, false) }

pure def canLetDoubtGo(s: Editor): bool = s.unknownCreate and not(s.form == NewEvent and s.draft.sync == D::Saving)

pure def letDoubtGo(s: Editor): Editor = { ...s, unknownCreate: false, separate: false }
```

### "Create a separate event" is offered only beside a create in doubt

```quint
pure def canCreateSeparately(s: Editor): bool =
  s.shown and s.form == NewEvent and s.unknownCreate and not(s.separate) and s.draft.sync != D::Saving

pure def createSeparately(s: Editor): Editor = { ...s, separate: true }

pure def alwaysSeparateOnlyWhileACreateIsInDoubt(s: Editor): bool = s.separate implies (s.unknownCreate and s.form == NewEvent)
```

### No create is sent while an earlier one is in doubt, unless the owner asked for a separate event

```quint
pure def alwaysNoBlindDuplicate(s: Editor): bool = (inFlight(s) and s.kind == Create and s.unknownCreate) implies s.separate
```

### A save in doubt holds its form until a read or the receipts show what happened

```quint
pure def alwaysASaveInDoubtHoldsItsForm(s: Editor): bool =
  (s.draft.sync == D::Saving and not(inFlight(s)))
    implies (s.shown and ((s.form == NewEvent and s.unknownCreate) or (s.form == EditEvent and s.latched.contains(s.target))))
```

### A separate event can be created beside one in doubt

```quint
pure def sometimesSeparateCreateSent(s: Editor): bool = inFlight(s) and s.kind == Create and s.separate
```

### A create in doubt can be found, and a failed receipt read can hold a create

```quint
pure def sometimesReceiptsUnreadable(s: Editor): bool = s.form == NewEvent and s.receipts.status == R::Failed and D::canSave(s.draft) and s.titled

pure def sometimesDoubtFound(s: Editor): bool = s.receipts.status == R::Loaded and not(s.unknownCreate) and s.write.outcome == A::Unknown
```

## Story: Delete an event, or answer an invitation

> As the owner, I want to delete one occurrence, this and the following, or
> the whole series, and to accept or decline an invitation, each sent once.

### A delete names which occurrences, and only a repeating event offers more than this one

```quint
pure def canDeleteEvent(s: Editor, id: int, revision: int, scope: Scope, repeating: bool): bool =
  not(s.shown) and not(inFlight(s)) and not(s.latched.contains(id)) and id > 0 and revision >= 0
    and scope != Unchosen and (scope == ThisOne or repeating)

pure def deleteEvent(s: Editor, id: int, revision: int, scope: Scope, repeating: bool): Composed =
  val w = A::dispatch(A::record(A::plan(s.write.id + 1)))
  { state: { ...s, write: w, kind: Remove, writing: id, filed: false },
    out: List(Send({ attempt: w.id, kind: Remove, id: id, scope: scope, base: revision })) }
```

### An invitation is answered Going or Maybe once, at the revision shown, and Decline is the deletion's decline

Going and Maybe are offered, each except the answer already given, only
where the writing rules offer answers. The answer names the event and its
revision as shown, so the agent refuses it for any other; a confirmed
answer counts as saved only once a read of the event shows it, and until
then the event is held like a change in doubt.

```quint
pure def canRespond(s: Editor, id: int, revision: int, going: bool, offered: bool): bool =
  not(s.shown) and not(inFlight(s)) and not(s.latched.contains(id)) and id > 0 and revision >= 0 and offered

pure def respond(s: Editor, id: int, revision: int, going: bool, offered: bool): Composed =
  val w = A::dispatch(A::record(A::plan(s.write.id + 1)))
  { state: { ...s, write: w, kind: Reply, writing: id, filed: false }, out: List(Answer({ attempt: w.id, id: id, going: going, base: revision })) }
```

### A confirmed answer holds its event until a read shows it

```quint
pure def stepAnAnswerIsSavedOnlyOnceRead(before: Editor, via: str, after: Editor): bool =
  (via == "written" and before.kind == Reply and after.write.outcome == A::Confirmed and not(after.filed)) implies after.latched.contains(before.writing)
```

### No change, delete or answer is sent to an event while its own change is in doubt

The event whose change is unknown is shown as uncertain until the calendar
reads its day again. Only that event is held: another event can still be
changed, deleted or answered.

```quint
pure def alwaysNothingIsSentOverAChangeInDoubt(s: Editor): bool =
  (inFlight(s) and s.kind != Create and s.kind != CreateReminder and s.kind != UpdateReminder and s.kind != RescheduleReminder) implies not(s.latched.contains(s.writing))

pure def sometimesAnotherEventChangedBesideOneInDoubt(s: Editor): bool =
  inFlight(s) and s.kind != Create and s.latched.size() > 0
```

### A series can be deleted, and an invitation answered

```quint
pure def sometimesSeriesDeleteSent(s: Editor): bool = inFlight(s) and s.kind == Remove and s.scope != ThisOne

pure def sometimesInvitationAnswered(s: Editor): bool = s.kind == Reply and s.write.outcome == A::Confirmed and not(s.latched.contains(s.writing))
```

## Story: Know what happened to a change in doubt

> As the owner, I want a change whose outcome is unknown shown as uncertain,
> and released as soon as the calendar reads the event again, never held for
> ever and never sent twice.

### A read of the event releases the doubt; a form waiting on it then shows the event as it now is

The calendar reads the event's day and finds it at a revision, or finds it
gone. Only a whole read of the window around the event's own day releases
its doubt: a read of a window that leaves that day out, or one the phone cut
short or Google gave only in part, does not. A form whose save was in doubt keeps its edits: if the event moved on,
the owner chooses between theirs and the saved one; if not, they are still
to save. A form with no edits simply follows the event. Alpha keeps with
each event's number where the event was last seen, so a doubt whose event
went while Alpha was closed is let go by the first whole read of that day
that no longer has it. A doubt held under a number that names no event
Alpha kept a number for, as one kept before Alpha kept its numbers, can
never be read back, and is let go as an event gone lets it go.

```quint
pure def canEventRead(s: Editor, id: int, revision: int, whole: bool): bool =
  id > 0 and revision >= 0 and ((s.form == EditEvent and s.target == id) implies revision >= s.revision)

pure def eventRead(s: Editor, id: int, revision: int, whole: bool): Editor =
  val released = { ...s, latched: if (whole) s.latched.exclude(Set(id)) else s.latched }
  val ours = s.form == EditEvent and s.target == id and not(inFlight(s))
  if (not(ours) or revision == s.revision)
    (if (ours and s.draft.sync == D::Saving) { ...released, draft: D::keepMine(s.draft) } else released)
  else if (s.draft.sync == D::Kept) { ...released, revision: revision, draft: { ...s.draft, base: revision } }
  else { ...released, revision: revision, draft: D::collide(s.draft, revision) }

pure def canEventMissing(s: Editor, id: int, whole: bool): bool = id > 0 and s.latched.contains(id) and whole

pure def eventMissing(s: Editor, id: int, whole: bool): Editor =
  if (s.form == EditEvent and s.target == id and s.draft.sync == D::Saving) withoutForm(s.write, { ...s, latched: s.latched.exclude(Set(id)) })
  else { ...s, latched: s.latched.exclude(Set(id)) }
```

### When the event moved on, the owner keeps their changes or takes the saved ones

```quint
pure def canKeepMyChanges(s: Editor): bool = s.shown and D::canChoose(s.draft)

pure def keepMyChanges(s: Editor): Editor = { ...s, draft: D::keepMine(s.draft) }

pure def canTakeSavedChanges(s: Editor): bool = s.shown and D::canChoose(s.draft)

pure def takeSavedChanges(s: Editor): Editor = { ...s, draft: D::takeSaved(s.draft) }
```

### A change can be in doubt, and released by a read

```quint
pure def sometimesChangeInDoubt(s: Editor): bool = s.latched.size() > 0 and s.shown and s.draft.sync == D::Saving

pure def sometimesTheOwnerChooses(s: Editor): bool = D::canChoose(s.draft) and s.write.outcome == A::Unknown
```

## Story: Keep my draft through a restart

> As the owner, I want what I typed kept on the phone, offered back after a
> restart or when I return, and told plainly when it could not be kept or
> when another copy replaced it.

### Closing a form with edits kept on the phone sets it aside, offered back by a banner; otherwise the form is gone

```quint
pure def canClose(s: Editor): bool =
  s.shown and s.draft.sync != D::Saving and s.banner != Conflict and s.confirming == NoConfirm

pure def close(s: Editor): Editor =
  if (D::unsaved(s.draft) and s.kept) { ...s, shown: false, banner: Available } else withoutForm(s.write, s)
```

### A restart forgets what was in memory: a write in flight becomes one in doubt, and kept edits are offered back

```quint
pure def restart(s: Editor): Editor =
  val flying = inFlight(s)
  val w = if (flying) A::conclude(s.write, false, false) else s.write
  val doubted = {
    ...s, write: w, separate: false, confirming: NoConfirm,
    receipts: if (s.receipts.status == R::Loading) R::answer(s.receipts, false) else s.receipts,
    unknownCreate: s.unknownCreate or (flying and s.kind == Create),
    latched: if (flying and s.kind != Create and s.kind != CreateReminder and s.kind != UpdateReminder and s.kind != RescheduleReminder) s.latched.union(Set(s.writing)) else s.latched,
  }
  val draft = if (s.draft.sync == D::Saving) D::keepMine(s.draft) else s.draft
  if (s.form != NoForm and s.kept and D::unsaved(draft)) { ...doubted, draft: draft, shown: false, banner: Available }
  else withoutForm(w, doubted)
```

### The owner restores the draft offered, read against the event as it now is, or discards it

```quint
pure def canRestore(s: Editor, revision: int): bool = s.banner == Available and revision >= s.revision

pure def restore(s: Editor, revision: int): Editor =
  val shown = { ...s, shown: true, banner: NoBanner, confirming: NoConfirm }
  if (s.form == EditEvent and revision != s.revision) { ...shown, revision: revision, draft: D::collide(s.draft, revision) }
  else shown

pure def discardable(s: Editor): bool =
  s.banner == Available or (s.shown and s.form == NewEvent and s.banner == NoBanner
    and s.kept and D::unsaved(s.draft) and s.draft.sync != D::Saving and not(inFlight(s)))

pure def canDiscard(s: Editor): bool = discardable(s) and s.confirming == ConfirmDiscard

pure def discard(s: Editor): Editor = withoutForm(s.write, s)
```

### When the phone cannot keep the draft, a banner says so and Retry keeps it again

A draft too large for the phone's store is one it cannot keep; a kept
draft the phone can no longer read opens as a blank form, never as a
crash.

```quint
pure def canKeepFailed(s: Editor): bool = s.shown and s.banner == NoBanner and s.draft.sync != D::Saving

pure def keepFailed(s: Editor): Editor = { ...s, banner: Failed, kept: false, confirming: NoConfirm }

pure def canRetryKeeping(s: Editor): bool = s.banner == Failed and not(s.unreadable)

pure def retryKeeping(s: Editor): Composed = { state: s, out: List(KeepDraft) }

pure def canDraftKept(s: Editor): bool = s.banner == Failed and not(s.unreadable)

pure def draftKept(s: Editor): Editor = { ...s, banner: NoBanner, kept: true }
```

### When another copy replaced the kept draft, the owner keeps theirs or takes the other

```quint
pure def canReplacedElsewhere(s: Editor): bool = s.shown and s.kept and s.banner == NoBanner and s.draft.sync != D::Saving

pure def replacedElsewhere(s: Editor): Editor = { ...s, banner: Conflict, confirming: NoConfirm }

pure def canKeepMyDraft(s: Editor): bool = s.banner == Conflict

pure def keepMyDraft(s: Editor): Composed = { state: { ...s, banner: NoBanner, confirming: NoConfirm }, out: List(KeepDraft) }

pure def canTakeOtherDraft(s: Editor): bool = s.banner == Conflict and s.confirming == ConfirmReplace

pure def takeOtherDraft(s: Editor): Editor = { ...s, banner: NoBanner, confirming: NoConfirm, draft: D::edit(s.draft) }
```

### Discarding a draft and replacing it with the other copy each wait for the owner to confirm, and can be called off

```quint
pure def canAskDiscard(s: Editor): bool = discardable(s) and s.confirming == NoConfirm

pure def askDiscard(s: Editor): Editor = { ...s, confirming: ConfirmDiscard }

pure def canAskReplace(s: Editor): bool = s.banner == Conflict and s.confirming == NoConfirm

pure def askReplace(s: Editor): Editor = { ...s, confirming: ConfirmReplace }

pure def canCallOff(s: Editor): bool = s.confirming != NoConfirm

pure def callOff(s: Editor): Editor = { ...s, confirming: NoConfirm }

pure def alwaysAConfirmationBelongsToItsBanner(s: Editor): bool =
  (s.confirming == ConfirmDiscard implies discardable(s)) and (s.confirming == ConfirmReplace implies s.banner == Conflict)
    and (s.confirming == ConfirmReschedule implies s.form == EditReminder and s.shown and s.banner == NoBanner)

pure def sometimesAskedToConfirm(s: Editor): bool = s.confirming == ConfirmReplace and D::unsaved(s.draft)
```

### A banner belongs to its form: an offered draft is set aside, and a failure or a conflict is over the form shown

```quint
pure def alwaysBannersBelongToTheirForm(s: Editor): bool =
  (s.shown implies s.form != NoForm)
    and (s.form == NoForm implies s.banner == NoBanner)
    and (s.banner == Available implies (s.form != NoForm and not(s.shown)))
    and ((s.banner == Conflict or s.banner == Failed) implies s.shown)
    and (s.banner == Failed implies not(s.kept))
```

### A draft is set aside only with edits kept on the phone

```quint
pure def alwaysASetAsideDraftIsKept(s: Editor): bool =
  (s.form != NoForm and not(s.shown)) implies (s.banner == Available and s.kept and D::unsaved(s.draft))
```

### Without a form nothing is kept, and only an edited event can conflict with a newer revision

Discovered by the proof: without stating this, opening an unreadable slot
could appear to keep a draft with no form open, or resolving a conflict
could appear to leave a discard or reschedule confirmation open.

```quint
pure def alwaysFormsKeepTheirDraftState(s: Editor): bool =
  (s.form == NoForm implies not(s.kept)) and (D::canChoose(s.draft) implies s.form == EditEvent)
```

### Kept edits are lost only by saving, discarding or handing off, or when their event is gone; another owner signing in leaves them in the old owner's slot

```quint
pure def stepKeptEditsAreLostOnlyByChoice(before: Editor, via: str, after: Editor): bool =
  (before.form != NoForm and before.kept and D::unsaved(before.draft) and after.form == NoForm)
    implies (via == "discard" or via == "handOff" or via == "written" or via == "receiptsChecked" or via == "eventMissing" or via == "ownerChanged")
```

### Cancel, Back, a hidden page, a locked screen or leaving Calendar closes the form and its confirmations; the slot keeps the edits

A form with edits kept on the phone is set aside, offered back by its
banner; any other form is gone. A save in flight keeps its form until it
ends.

```quint
pure def canLeave(s: Editor): bool = (s.shown and s.draft.sync != D::Saving) or s.confirming != NoConfirm

pure def leave(s: Editor): Editor =
  if (s.shown and s.draft.sync != D::Saving)
    (if (D::unsaved(s.draft) and s.kept) { ...s, shown: false, banner: Available, confirming: NoConfirm } else withoutForm(s.write, s))
  else { ...s, confirming: NoConfirm }

pure def sometimesSetAsideOnLeaving(s: Editor): bool = s.banner == Available and s.form == EditEvent and s.write.id == 0
```

### A draft can be offered back after a restart, fail to be kept, or meet another copy

```quint
pure def sometimesOfferedAfterRestart(s: Editor): bool = s.banner == Available and s.write.outcome == A::Unknown

pure def sometimesKeepingFailed(s: Editor): bool = s.banner == Failed and D::unsaved(s.draft)

pure def sometimesAnotherCopy(s: Editor): bool = s.banner == Conflict and s.form == EditEvent
```

## Story: Recover a draft the phone cannot read

> As the owner, I want a draft Alpha cannot read kept as it is and
> explained, and in development to reset only the copy I confirmed.

### A slot the phone cannot read is kept and explained; only a development build resets it, and only as it was when the owner confirmed

The shell says when the owner's slot holds a draft it cannot read. Nothing
is kept over it: new forms open blank and say their edits are not kept.
A production build only explains that the data is kept. A development
build, with the test mocks on, offers to reset it: the slot is removed only
while it still holds exactly what was read when the owner confirmed, and
any write since leaves it.

```quint
pure def canSlotUnreadable(s: Editor): bool = s.form == NoForm and not(s.unreadable)

pure def slotUnreadable(s: Editor): Editor = { ...s, unreadable: true }

pure def canResetSlot(s: Editor, development: bool): bool = s.unreadable and development and s.form == NoForm

pure def resetSlot(s: Editor, development: bool): Composed = { state: s, out: List(ResetSlot) }

pure def canSlotReset(s: Editor, ok: bool): bool = s.unreadable

pure def slotReset(s: Editor, ok: bool): Editor = { ...s, unreadable: not(ok) }

pure def alwaysAnUnreadableSlotIsNeverWritten(s: Editor): bool = s.unreadable implies not(s.kept)

pure def sometimesAFormOverAnUnreadableSlot(s: Editor): bool = s.unreadable and s.form == NewEvent and D::unsaved(s.draft)
```

## Story: Keep each account's draft with that account

> As the owner, I want what I typed for one account kept for that account,
> and nothing typed for one account saved by another.

### Another owner signing in closes the editor; the old owner's slot keeps its edits

The shell keeps each owner's draft in that owner's own slot, so the edits
are offered back when that owner signs in again. A write in flight ends
first.

```quint
pure def canOwnerChanged(s: Editor, owner: int): bool = owner != s.owner and owner >= 0 and not(inFlight(s))

pure def ownerChanged(s: Editor, owner: int): Editor = { ...withoutForm(s.write, s), owner: owner, unreadable: false }
```

### A draft can be set aside when another owner signs in

```quint
pure def sometimesClosedForAnotherOwner(s: Editor): bool = s.owner == 2 and s.form == NoForm and s.write.outcome == A::Confirmed
```
