# Contacts

The phone's address book, on an Alpha image that admits it: the list with
favourites, one contact, and the form that adds or changes one.
What the phone holds is kept in memory only while Contacts is showing.
Calling or messaging a contact opens [Phone](../phone/) or
[Messages](../messages/) with the number filled in; nothing is dialled or
sent here. The agent never reads this list.

- [Agent requests](./agent.md): a call or a contact change the agent proposes, for the owner to approve

One contact and the form each rise over the list as Alpha's earlier build
drew them, and the list stays under them as it was; Back takes them away at
once. Before Contacts has its first answer, it shows its header, never a
blank screen.

## Domain

### What Contacts holds

The list as last read, with its filter and filter chip, and whether the
phone lets Alpha write contacts; the open contact as the phone holds it; the
form; and the one change being written. A sheet
counts what a contact has: a name, phone numbers, email addresses and
notes, and says whether its notes can be read and edited here.

```quint
import read as R from "../../kit/read"
import attempt as A from "../../kit/attempt"
import permission as P from "../../kit/permission"

type Chip = Everyone | Favourites
type Form = Shut | Adding | Changing
type Change = Create | Rewrite | Remove
type Part = Names | Phones | Emails | Notes
type Reach = Call | Message
type Source = Listing | Card
type Sheet = { names: int, phones: int, emails: int, notes: int, notable: bool }
type Contacts = {
  front: bool, access: P::Permission,
  list: R::Read, rows: int, more: bool, sought: bool, chip: Chip, editable: bool,
  opened: bool, contact: str, card: R::Read, held: Sheet, confirming: bool,
  form: Form, sheet: Sheet, dirty: bool,
  write: A::Attempt, change: Change,
}

pure val blankSheet: Sheet = { names: 0, phones: 0, emails: 0, notes: 0, notable: true }

pure val initial: Contacts = {
  front: false, access: P::unasked,
  list: R::unread, rows: 0, more: false, sought: false, chip: Everyone, editable: false,
  opened: false, contact: "", card: R::unread, held: blankSheet, confirming: false,
  form: Shut, sheet: blankSheet, dirty: false,
  write: A::plan(0), change: Create,
}
```

### What Contacts asks of the phone

A read of the list or of one contact under its ticket, Android's prompt for
address-book access, Android's Settings, Phone or Messages opened with a
number filled in, the phone's own contact editor on a new contact or the
open one, and one change to the address book under its number.

```quint
type Effect =
  | Fetch({ source: Source, ticket: int, further: bool })
  | Prompt
  | Settings
  | Open({ app: Reach })
  | Editor({ fresh: bool })
  | Write({ id: int, change: Change, contact: str })

type Moved = { state: Contacts, out: List[Effect] }

pure def writing(id: int, change: Change, contact: str): List[Effect] =
  List(Write({ id: id, change: change, contact: contact }))

pure def fetching(source: Source, ticket: int, further: bool): List[Effect] =
  List(Fetch({ source: source, ticket: ticket, further: further }))

pure def writes(out: List[Effect]): bool = out.some(e => match e { | Write(w) => true | _ => false })
```

### What the simulator tries

```quint
pure val ticketValues = Set(1, 2, 3, 4)
pure val contactValues = Set("", "7", "8")
pure val idValues = Set(1, 2, 3)
pure val countValues = Set(-1, 0, 1, 2, 33)
pure val seenValues = Set(
  blankSheet,
  { names: 1, phones: 2, emails: 1, notes: 1, notable: true },
  { names: 1, phones: 1, emails: 0, notes: 0, notable: false },
  { names: 1, phones: 33, emails: 0, notes: 0, notable: true },
  { names: 0, phones: 1, emails: 0, notes: 1, notable: false },
)
pure val weight_listed = 4
pure val weight_openContact = 3
pure val weight_contactRead = 4
pure val weight_askDelete = 4
pure val weight_erase = 4
pure val weight_writeAnswered = 4
```

## Story: Browse my contacts

> As the owner, I want my contacts listed with my favourites and filter,
> and to be told plainly when there are none, when nothing matches and when
> Alpha has no access.

Contacts are grouped from A to Z by the first letter without accents, with
other names together at the end. Names use local alphabetical order
within each section. Section headings appear from 20 contacts.

### Contacts reads the list each time it comes to the front

```quint
pure def canShow(s: Contacts): bool = not(s.front)

pure def show(s: Contacts): Moved =
  val list = R::ask(s.list)
  { state: { ...s, front: true, list: list }, out: fetching(Listing, list.ticket, false) }
```

### Leaving Contacts forgets the rows and the open contact, and keeps a form the owner was filling in

```quint
pure def canLeave(s: Contacts): bool = s.front

pure def leave(s: Contacts): Contacts =
  { ...s, front: false, rows: 0, more: false, opened: false, held: blankSheet, confirming: false }
```

### A refresh reads the list again and keeps the rows shown until it answers

```quint
pure def readable(s: Contacts): bool = s.front and P::allows(s.access)

pure def canRefresh(s: Contacts): bool = readable(s)

pure def refresh(s: Contacts): Moved =
  val list = R::ask(s.list)
  { state: { ...s, list: list }, out: fetching(Listing, list.ticket, false) }
```

### Filtering or changing the filter chip starts a new list

Contacts has no owner search button or search field, and the closed Ask
Alpha bar addresses Alpha without filtering the list. A filter Alpha
applies or a filter chip narrows the list, and clearing it or pressing Back
while filtered returns to All contacts before Back leaves Contacts.

```quint
pure def narrowed(s: Contacts): bool = s.sought or s.chip != Everyone

pure def relisted(sought: bool, chip: Chip, s: Contacts): Moved =
  val list = R::ask(s.list)
  { state: { ...s, sought: sought, chip: chip, list: list, rows: 0, more: false }, out: fetching(Listing, list.ticket, false) }

pure def canSearch(s: Contacts, typed: bool): bool = readable(s) and (typed or s.sought)

pure def search(s: Contacts, typed: bool): Moved = relisted(typed, s.chip, s)

pure def canPick(s: Contacts, chip: Chip): bool = readable(s) and chip != s.chip

pure def pick(s: Contacts, chip: Chip): Moved = relisted(s.sought, chip, s)

pure def canClearFilter(s: Contacts): bool =
  s.front and not(s.opened) and s.form == Shut and narrowed(s)

pure def clearFilter(s: Contacts): Moved =
  if (readable(s)) relisted(false, Everyone, s)
  else { state: { ...s, sought: false, chip: Everyone }, out: List() }
```

### "More contacts" reads further only when the phone said there are more

The next page is appended to the contacts already on screen.

```quint
pure def canLoadMore(s: Contacts): bool = readable(s) and s.more and s.list.status == R::Loaded

pure def loadMore(s: Contacts): Moved =
  val list = R::ask(s.list)
  { state: { ...s, list: list }, out: fetching(Listing, list.ticket, true) }
```

### Only the newest list read is taken, and with it what Android says about access

A read that fails, or that finds access missing, shows no rows. The read
also says whether the phone lets Alpha write contacts. A list read in full
also ends the wait after a change whose outcome was unknown.

```quint
pure def canListed(s: Contacts, ticket: int, count: int): bool =
  s.front and R::canAnswer(s.list, ticket) and count >= 0

pure def listed(s: Contacts, ticket: int, ok: bool, grant: P::Grant, count: int, further: bool, editable: bool): Contacts =
  val access = P::observe(s.access, grant)
  val good = ok and P::allows(access)
  val kept = if (P::allows(access)) s else { ...s, opened: false, held: blankSheet, confirming: false, form: Shut, sheet: blankSheet, dirty: false }
  { ...kept,
    access: access, list: R::answer(s.list, good), editable: if (good) editable else s.editable and P::allows(access),
    rows: if (good) count else 0, more: good and further and count > 0,
    write: if (good and s.write.outcome == A::Unknown) A::plan(s.write.id) else s.write }
```

### An empty address book, a search that matches nothing, a failed read and missing access are told apart

```quint
pure def listedEmpty(s: Contacts): bool = readable(s) and s.list.status == R::Loaded and s.rows == 0 and not(narrowed(s))
pure def noMatches(s: Contacts): bool = readable(s) and s.list.status == R::Loaded and s.rows == 0 and narrowed(s)
pure def listFailed(s: Contacts): bool = readable(s) and s.list.status == R::Failed
pure def accessNeeded(s: Contacts): bool = s.front and not(P::allows(s.access))
```

### Rows, "More contacts", the open contact and a delete confirmation exist only while Contacts is showing with access

```quint
pure def alwaysHeldOnlyWhileShowing(s: Contacts): bool =
  (s.rows > 0 or s.more or s.opened or s.confirming) implies readable(s)
```

### "More contacts" is offered only under rows

```quint
pure def alwaysMoreNeedsRows(s: Contacts): bool = s.rows >= 0 and (s.more implies s.rows > 0)
```

### The list can be empty, match nothing, fail, and offer more

```quint
pure def sometimesListedEmpty(s: Contacts): bool = listedEmpty(s)
pure def sometimesNoMatches(s: Contacts): bool = noMatches(s)
pure def sometimesListFailed(s: Contacts): bool = listFailed(s)
pure def sometimesMoreContacts(s: Contacts): bool = s.more and s.chip == Favourites
pure def sometimesRowsKeptWhileRefreshing(s: Contacts): bool = s.rows > 0 and s.list.status == R::Loading
```

## Story: Give Alpha access to my contacts

> As the owner, I want Alpha to ask for my address book once, from a
> control I tap, and afterwards to send me to Settings.

### Alpha asks for address-book access only from the Allow control, and only once

```quint
pure def canAllow(s: Contacts): bool = s.front and P::canAsk(s.access)

pure def allow(s: Contacts): Moved = { state: { ...s, access: P::ask(s.access) }, out: List(Prompt) }
```

### After asking, the control opens Android's Settings

```quint
pure def canOpenSettings(s: Contacts): bool = s.front and P::needsSettings(s.access)

pure def openSettings(s: Contacts): Moved = { state: s, out: List(Settings) }
```

### Access that arrives is used at once, and access that goes closes everything that shows or changes a contact

```quint
pure def accessReported(s: Contacts, grant: P::Grant): Moved =
  val access = P::observe(s.access, grant)
  if (not(P::allows(access)))
    { state: { ...s, access: access, rows: 0, more: false, opened: false, held: blankSheet, confirming: false, form: Shut, sheet: blankSheet, dirty: false },
      out: List() }
  else if (s.front and not(P::allows(s.access))) refresh({ ...s, access: access })
  else { state: { ...s, access: access }, out: List() }
```

### Android's prompt is shown only when the owner taps Allow

```quint
pure def stepThePromptNeedsTheControl(before: Contacts, via: str, after: Contacts, out: List[Effect]): bool =
  out.some(e => match e { | Prompt => true | _ => false }) implies (via == "allow" and not(before.access.asked) and after.access.asked)
```

### Access can be needed, and can be something only Settings changes

```quint
pure def sometimesAccessNeeded(s: Contacts): bool = accessNeeded(s) and s.list.status == R::Failed
pure def sometimesSettingsNeeded(s: Contacts): bool = s.front and P::needsSettings(s.access)
```

## Story: Look at one contact

> As the owner, I want to open a contact, see what the phone holds for it
> now, and call or message it from there.

### Opening a contact reads it from the phone afresh

The open contact is named by the phone's ID for it, which stays the same
however often it is read again.

```quint
pure def canOpenContact(s: Contacts, contact: str): bool = readable(s) and s.rows > 0 and not(s.opened) and s.form == Shut and contact != ""

pure def readCard(contact: str, s: Contacts): Moved =
  val card = R::ask(s.card)
  { state: { ...s, opened: true, contact: contact, card: card, held: blankSheet }, out: fetching(Card, card.ticket, false) }

pure def openContact(s: Contacts, contact: str): Moved = readCard(contact, s)

pure def alwaysAnOpenContactIsNamed(s: Contacts): bool = s.opened implies s.contact != ""
```

### Returning to a contact on the Ask Alpha stage reads that exact card again

The stage names the contact it left and the preceding Contacts list ticket.
The new visit rereads the list and card. If the new visit has already begun
its list read, the return starts only the card read.

```quint
pure def canRestoreStageContact(s: Contacts, contact: str, ticket: int): bool =
  P::allows(s.access) and contact != "" and contact == s.contact and not(s.opened) and s.form == Shut
    and s.list.ticket == (if (s.front) ticket + 1 else ticket)

pure def restoreStageContact(s: Contacts, contact: str, ticket: int): Moved =
  val visit = if (s.front) { state: s, out: List() } else show(s)
  val card = readCard(contact, visit.state)
  { state: card.state, out: visit.out.concat(card.out) }

pure def stepTheReturnedCardIsReadOnItsNewVisit(before: Contacts, via: str, after: Contacts): bool =
  via == "restoreStageContact" implies (after.front and after.opened and after.contact == before.contact
    and after.card.ticket == before.card.ticket + 1 and after.list.ticket == before.list.ticket + (if (before.front) 0 else 1))
```

### When the phone reports a change to the address book, Contacts reads the visible list and any open contact again

A form keeps the exact contact and the version it opened with.
The list and the open card keep their own requests in Alpha. Their reads
take turns at the phone's address book, where starting a new read retires
the preceding one.

```quint
pure def canBookChanged(s: Contacts): bool = readable(s)

pure def bookChanged(s: Contacts): Moved =
  val list = refresh(s)
  val card = readCard(s.contact, list.state)
  if (s.opened and s.form == Shut and not(s.confirming))
    { state: card.state, out: list.out.concat(card.out) }
  else list
```

### A sheet holds at most one name and one note, 32 numbers and 32 addresses, and no notes where they are unavailable

```quint
pure val maxEach = 32

pure def room(part: Part): int = if (part == Phones or part == Emails) maxEach else 1

pure def fits(sheet: Sheet): bool = and {
  0 <= sheet.names, sheet.names <= room(Names),
  0 <= sheet.phones, sheet.phones <= room(Phones),
  0 <= sheet.emails, sheet.emails <= room(Emails),
  0 <= sheet.notes, sheet.notes <= room(Notes),
  sheet.notable or sheet.notes == 0,
}
```

### Only the newest read of the open contact is shown, and only if it is a contact Alpha can show

```quint
pure def canContactRead(s: Contacts, ticket: int, seen: Sheet): bool =
  s.opened and R::canAnswer(s.card, ticket) and fits(seen)

pure def contactRead(s: Contacts, ticket: int, ok: bool, seen: Sheet): Contacts =
  { ...s, card: R::answer(s.card, ok), held: if (ok) seen else blankSheet }

pure def shown(s: Contacts): bool = s.opened and s.card.status == R::Loaded
```

### Closing the contact returns to the list

```quint
pure def canCloseContact(s: Contacts): bool = s.opened

pure def closeContact(s: Contacts): Contacts = { ...s, opened: false, held: blankSheet, confirming: false }
```

### Call and Message open Phone or Messages with the number filled in, and do nothing else

```quint
pure def canReach(s: Contacts): bool = shown(s) and s.held.phones > 0 and not(s.confirming)

pure def reach(s: Contacts, how: Reach): Moved = { state: s, out: List(Open({ app: how })) }

pure def stepReachingOnlyOpens(before: Contacts, via: str, after: Contacts, out: List[Effect]): bool =
  via == "reach" implies (after == before and not(writes(out)))
```

### What is shown of a contact is what the phone last said, and nothing while it is closed

```quint
pure def alwaysTheContactShownFits(s: Contacts): bool =
  fits(s.held) and (shown(s) or s.held == blankSheet)
```

### A contact can be shown with notes unavailable

```quint
pure def sometimesNotesUnavailable(s: Contacts): bool = shown(s) and not(s.held.notable) and s.held.phones > 0
```

## Story: Add or change a contact

> As the owner, I want to add a contact or change one, with several numbers
> and addresses, and to keep what I typed if the phone refuses it.

### A new contact starts from a blank form, and a change from the contact as the phone holds it now

A contact is not opened for changes while a change to the address book is
being written.

```quint
pure def canCompose(s: Contacts): bool = readable(s) and s.editable and s.form == Shut and not(s.opened)

pure def compose(s: Contacts): Contacts = { ...s, form: Adding, sheet: blankSheet, dirty: false }

pure def canAmend(s: Contacts): bool = shown(s) and s.editable and s.form == Shut and not(s.confirming) and not(pending(s))

pure def amend(s: Contacts): Contacts = { ...s, form: Changing, sheet: s.held, dirty: false }
```

### Where the phone does not let Alpha write contacts, New and Edit open the phone's own contact editor instead

Alpha writes nothing then; the list is read again when Contacts next comes
to the front.

```quint
pure def canComposeElsewhere(s: Contacts): bool = readable(s) and not(s.editable) and s.form == Shut and not(s.opened)

pure def composeElsewhere(s: Contacts): Moved = { state: s, out: List(Editor({ fresh: true })) }

pure def canAmendElsewhere(s: Contacts): bool = shown(s) and not(s.editable) and s.form == Shut and not(s.confirming)

pure def amendElsewhere(s: Contacts): Moved = { state: s, out: List(Editor({ fresh: false })) }

pure def stepTheFormOpensOnlyWhereAlphaMayWrite(before: Contacts, via: str, after: Contacts, out: List[Effect]): bool =
  (before.form == Shut and after.form != Shut) implies before.editable

pure def sometimesTheEditorIsHandedOver(s: Contacts): bool = shown(s) and not(s.editable) and s.list.status == R::Loaded
```

### The form takes a name, several numbers and addresses, and notes only where the contact's notes are available

Nothing is typed while a change is being written.

```quint
pure def pending(s: Contacts): bool = s.write.outcome == A::Sent
pure def uncertain(s: Contacts): bool = s.write.outcome == A::Unknown

pure def canFill(s: Contacts, part: Part, count: int): bool =
  s.form != Shut and not(pending(s)) and 0 <= count and count <= room(part) and (part != Notes or s.sheet.notable)

pure def fill(s: Contacts, part: Part, count: int): Contacts =
  val sheet =
    if (part == Names) { ...s.sheet, names: count }
    else if (part == Phones) { ...s.sheet, phones: count }
    else if (part == Emails) { ...s.sheet, emails: count }
    else { ...s.sheet, notes: count }
  { ...s, sheet: sheet, dirty: true }
```

### Cancel closes the form and drops what was typed

```quint
pure def canDiscard(s: Contacts): bool = s.form != Shut and not(pending(s))

pure def discard(s: Contacts): Contacts = { ...s, form: Shut, sheet: blankSheet, dirty: false }
```

### One change is written at a time, never while the last one's outcome is unknown, and never during a call that may be an emergency call

`clear` is Phone's fact that no call which may be an emergency call is
live. Nothing is written where the phone does not let Alpha write contacts.

```quint
pure def writable(s: Contacts, clear: bool): bool =
  clear and P::allows(s.access) and s.editable and not(pending(s)) and not(uncertain(s))

pure def written(change: Change, s: Contacts): Moved =
  val write = A::dispatch(A::record(A::plan(s.write.id + 1)))
  { state: { ...s, write: write, change: change }, out: writing(write.id, change, if (change == Create) "" else s.contact) }
```

### Save writes a form that was changed and has a name, a number or an address

A change names the version of the contact the phone last read, and is
written over the contact as the phone holds it: a number or an address it
already had keeps its label, and its name stays as the phone holds it unless
the form renames it. A contact changed on the phone since it was read is
refused as stale: nothing is written, and the form stays for another try.

```quint
pure def canSave(s: Contacts, clear: bool): bool =
  s.form != Shut and s.dirty and s.sheet.names + s.sheet.phones + s.sheet.emails > 0 and writable(s, clear)

pure def save(s: Contacts, clear: bool): Moved = written(if (s.form == Adding) Create else Rewrite, s)
```

### The form is open only with access, fits a contact, and is clean when shut

```quint
pure def alwaysTheFormFits(s: Contacts): bool =
  fits(s.sheet) and (s.form != Shut implies P::allows(s.access)) and (s.form == Shut implies (not(s.dirty) and s.sheet == blankSheet))
```

### A form can hold several numbers, and can be kept while Contacts is not showing

```quint
pure def sometimesSeveralNumbers(s: Contacts): bool = s.form == Adding and s.sheet.phones > 1 and s.sheet.emails > 1
pure def sometimesFormKeptWhileAway(s: Contacts): bool = not(s.front) and s.form != Shut and s.dirty
```

## Story: Delete a contact

> As the owner, I want a contact deleted only after I confirm it.

### Delete asks first, and Keep closes the question

```quint
pure def canAskDelete(s: Contacts): bool =
  shown(s) and s.editable and s.form == Shut and not(s.confirming) and not(pending(s)) and not(uncertain(s))

pure def askDelete(s: Contacts): Contacts = { ...s, confirming: true }

pure def canKeep(s: Contacts): bool = s.confirming

pure def keep(s: Contacts): Contacts = { ...s, confirming: false }
```

### Confirming deletes the contact that was shown

```quint
pure def canErase(s: Contacts, clear: bool): bool = s.confirming and writable(s, clear)

pure def erase(s: Contacts, clear: bool): Moved = written(Remove, { ...s, confirming: false })
```

### The question is asked only over a contact that is shown, with no form open

```quint
pure def alwaysDeleteIsAskedOverAShownContact(s: Contacts): bool =
  s.confirming implies (shown(s) and s.form == Shut)
```

### No delete question is open while a change is pending

Discovered by the proof: without it, a deletion confirmed while the
question stood open again would close the contact and leave the question
over nothing.

```quint
pure def alwaysNoQuestionWhileAChangeIsPending(s: Contacts): bool = pending(s) implies not(s.confirming)
```

### A contact being deleted is never opened for changes

Nothing can then be saved over a contact the phone has removed.

```quint
pure def alwaysNoChangeToAContactBeingDeleted(s: Contacts): bool =
  (pending(s) and s.change == Remove) implies s.form != Changing
```

### A contact is deleted only by confirming

```quint
pure def stepDeletingNeedsTheConfirmation(before: Contacts, via: str, after: Contacts, out: List[Effect]): bool =
  out.some(e => match e { | Write(w) => w.change == Remove | _ => false }) implies (via == "erase" and before.confirming)
```

## Story: Know what happened to my change

> As the owner, I want to see that a change is pending, to keep my form if
> the phone refuses it, and to be told when Alpha cannot tell whether it
> was made.

### The phone's answer ends the change it names

A change that was made closes the form, and a deletion closes the contact;
the list is read again. An edited contact that is still open is read again
too. A refused change keeps the form for another try.
If Android queues a deletion, the change stays pending until the receipt
for that deletion settles. A deleted receipt confirms it. A kept contact
or a conflict refuses it.
When no answer can be trusted the form, the question and the contact close,
and Contacts says the outcome is unknown.

```quint
pure def canWriteAnswered(s: Contacts, id: int): bool = A::canConclude(s.write, id)

pure def canWriteLost(s: Contacts): bool = pending(s)

pure def writeLost(s: Contacts): Moved = writeAnswered(s, s.write.id, false, false)

pure def writeAnswered(s: Contacts, id: int, made: bool, known: bool): Moved =
  val write = A::conclude(s.write, made, known)
  val after =
    if (write.outcome == A::Refused) { ...s, write: write }
    else if (write.outcome == A::Unknown)
      { ...s, write: write, form: Shut, sheet: blankSheet, dirty: false, opened: false, held: blankSheet, confirming: false }
    else if (s.change == Remove) { ...s, write: write, opened: false, held: blankSheet }
    else { ...s, write: write, form: Shut, sheet: blankSheet, dirty: false }
  if (write.outcome == A::Confirmed and readable(after)) bookChanged(after)
  else { state: after, out: List() }
```

### "Contact change pending" and "Outcome unknown: refresh" say what the last change is doing

```quint
pure def refused(s: Contacts): bool = s.write.outcome == A::Refused
```

### Each change is written once, under the next number, when nothing is pending or unknown

```quint
pure def stepAChangeIsWrittenOnce(before: Contacts, via: str, after: Contacts, out: List[Effect]): bool =
  if (via == "save" or via == "erase")
    out == writing(before.write.id + 1, after.change, if (after.change == Create) "" else before.contact)
      and after.write.id == before.write.id + 1 and after.write.outcome == A::Sent
      and not(pending(before)) and not(uncertain(before))
  else not(writes(out)) and after.write.id == before.write.id
```

### After an unknown outcome nothing is written until the list has been read again

```quint
pure def stepAnUnknownOutcomeWaitsForARefresh(before: Contacts, via: str, after: Contacts): bool =
  (uncertain(before) and not(uncertain(after))) implies (via == "listed" and after.list.status == R::Loaded)
```

### A change is pending only after it was sent, and its number is never negative

```quint
pure def alwaysWriteIsWellFormed(s: Contacts): bool =
  s.write.id >= 0 and s.write.outcome != A::Recorded and (s.write.id == 0 implies s.write.outcome == A::Planned)
```

### A pending change ends

It ends with the phone's answer, or as unknown when Alpha stops waiting
for one.

```quint
pure def leadsToAPendingChangeEnds(s: Contacts, later: Contacts): bool =
  pending(s) implies not(pending(later))

pure val fair_writeAnswered = "weak"
pure val fair_writeLost = "weak"
```

### A change can be pending, refused with the form kept, unknown, and cleared by a refresh

```quint
pure def sometimesChangePending(s: Contacts): bool = pending(s) and s.form == Changing
pure def sometimesRefusedKeepsTheForm(s: Contacts): bool = refused(s) and s.form != Shut and s.dirty
pure def sometimesOutcomeUnknown(s: Contacts): bool = uncertain(s) and s.front
pure def sometimesUnknownClearedByRefresh(s: Contacts): bool = s.write.id > 0 and s.write.outcome == A::Planned
pure def sometimesContactDeleted(s: Contacts): bool = s.write.outcome == A::Confirmed and s.change == Remove
```
