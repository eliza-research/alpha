# Composer

Where the owner writes to Ask Alpha: a [draft](../../kit/draft.md) kept in
the slot of the owner's conversation on the phone through a restart or an
app update, the attachments waiting to go with it, a quoted message or one
being edited to send again, and the send in two phases: the message is
held, marked as sending in the slot, then committed once it left or
released back into the composer when it never did. The
[conversation](./index.md) asks the agent and says which; files are chosen
in [attachments](./attachments.md).

## Story: Keep what I am writing

> As the owner, I want my unsent message kept through a restart or an app
> update, never lost to a save that came at the wrong time, and storage that
> fails tried again without a word by the field: told in the conversation
> only when it stays broken, with a way to try again.

A card about the draft is drawn in the conversation, never by the field.
When one is due while Ask Alpha rests at the bar or is being typed in, Ask
Alpha rises once to a sheet so the card is seen: never again for the same
card, and never over Phone, Messages or Contacts, whose own bar stands in
for Ask Alpha there.

### The composer holds the slot it is bound to, the draft, the editor, the send in hand, and the message moved from a new conversation

A slot belongs to one owner and one conversation; conversation 0 is a new
one not yet made. The slot is closed, open, damaged or unreadable, and it
is being opened while its read is loading. The draft counts edits and
saves against the slot's revisions; a write in flight carries a ticket. A
send is free, being marked in the slot, or asked of the conversation. The
editor holds the text and what waits to go with it (files, a mail, a
transcript, the photo showing, a quoted message, a message being edited
to send again); the message of the send in hand is held apart.

```quint
import read as R from "../../kit/read"
import draft as D from "../../kit/draft"
import attempt as A from "../../kit/attempt"

type Slot = Closed | Open | Damaged | Unreadable
type Away = Free | Marking | Asked
type Binding = { owner: int, conversation: int }
type Message = { text: bool, files: int, mail: bool, transcript: bool, shown: bool, quote: int, editing: int }
type Composer = {
  binding: Binding, slot: Slot, read: R::Read, draft: D::Draft, writing: int, failing: bool,
  hold: int, away: Away, marked: bool, unsettled: bool, editor: Message, held: Message,
  offeredAt: int, source: int, clear: A::Attempt, long: bool,
}

pure val blankMessage: Message = { text: false, files: 0, mail: false, transcript: false, shown: false, quote: 0, editing: 0 }

pure val initial: Composer = {
  binding: { owner: 0, conversation: 0 }, slot: Closed, read: R::unread, draft: D::blank, writing: 0, failing: false,
  hold: 0, away: Free, marked: false, unsettled: false, editor: blankMessage, held: blankMessage,
  offeredAt: 0, source: 0, clear: A::plan(0), long: false,
}

pure def opening(c: Composer): bool = c.read.status == R::Loading
```

### What the composer needs done outside comes back as an answer naming its ticket

The slot read or recovered, the draft written to its slot (marked as
sending or not), the slot of a new conversation cleared once its message
moved, and a held message asked of the conversation under its hold number.

```quint
type Effect =
  | ReadSlot({ ticket: int, binding: Binding, recover: bool, keep: bool })
  | Write({ ticket: int, binding: Binding, sending: bool })
  | Clear({ attempt: int, binding: Binding, revision: int })
  | Ask({ hold: int, attachments: int })
type Moved = { state: Composer, out: List[Effect] }

pure def written(sending: bool, c: Composer): Moved =
  val ticket = c.writing + 1
  { state: { ...c, draft: D::save(c.draft), writing: ticket },
    out: List(Write({ ticket: ticket, binding: c.binding, sending: sending })) }

pure def adopted(d: D::Draft, revision: int): D::Draft = D::takeSaved(D::collide(d, revision))

pure def attachments(m: Message): int =
  m.files + (if (m.mail) 1 else 0) + (if (m.transcript) 1 else 0) + (if (m.shown) 1 else 0)

pure def rest(binding: Binding, c: Composer): Composer =
  { ...initial, binding: binding, hold: c.hold, writing: c.writing, read: R::drop(c.read), offeredAt: c.offeredAt,
    clear: if (c.clear.outcome == A::Sent) A::conclude(c.clear, false, false) else c.clear }
```

### What the simulator tries

```quint
pure val ticketValues = Set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
pure val attemptValues = Set(1, 2)
pure val revisionValues = Set(1, 2)
pure val countValues = Set(1, 3)
pure val messageValues = Set(0, 2)
pure val holdValues = Set(1, 2, 3, 4, 5, 6)
pure val ownerValues = Set(1, 2)
pure val conversationValues = Set(0, 1, 2)
pure val weight_wrote = 4
pure val weight_slotRead = 4
pure val weight_commit = 2
pure val weight_release = 2
```

### The slot is opened when the composer is shown, and opened again after it could not be read

A slot that could not be read is opened again by itself, after one, five
and thirty seconds and each time Alpha comes back to the front, with no
words while it opens. Once those three tries have failed, the conversation
shows one card that the draft cannot be opened, with Try again.

```quint
pure def canOpen(c: Composer): bool = (c.slot == Closed or c.slot == Unreadable) and not(opening(c))

pure def open(c: Composer): Moved =
  val read = R::ask(c.read)
  { state: { ...c, slot: Closed, read: read }, out: List(ReadSlot({ ticket: read.ticket, binding: c.binding, recover: false, keep: false })) }
```

### A damaged slot is recovered on the owner's word

Only a slot whose bytes hold no readable text is damaged. The conversation,
never the field, shows one card with Keep a copy, where the slot's store
can hold one, and Discard. Keep a copy sets the bytes aside beside the slot
first, and recovers only once they are kept; recovering removes only the
exact damaged bytes it read, and never a draft that can be read.

```quint
pure def canRecover(c: Composer, keep: bool): bool = c.slot == Damaged

pure def recover(c: Composer, keep: bool): Moved =
  val read = R::ask(c.read)
  { state: { ...c, slot: Closed, read: read }, out: List(ReadSlot({ ticket: read.ticket, binding: c.binding, recover: true, keep: keep })) }
```

### The slot's answer fills the empty editor with the saved draft, or reports it damaged or unreadable

A saved draft is put in the editor as the owner left it. A draft the slot
marks as sending may already have been sent: it is held for review, never
put in the editor by itself. Bytes that are no longer a slot but still hold
a draft's text are written back in their place, as a draft with that text,
marked as sending unless they said it was not, and read as that draft; only
bytes with no readable text are reported damaged.

```quint
type Found = Nothing | Saved | Sending | Corrupt | Failure

pure def canSlotRead(c: Composer, ticket: int, revision: int): bool = R::canAnswer(c.read, ticket) and revision >= 0

pure def slotRead(c: Composer, ticket: int, found: Found, revision: int): Composer =
  val read = R::answer(c.read, found != Failure)
  if (found == Failure) { ...c, read: read, slot: Unreadable }
  else if (found == Corrupt) { ...c, read: read, slot: Damaged }
  else if (found == Sending) { ...c, read: read, slot: Open, unsettled: true, marked: true, draft: D::collide(c.draft, revision) }
  else if (found == Saved) { ...c, read: read, slot: Open, editor: { ...c.editor, text: true }, draft: adopted(c.draft, revision) }
  else { ...c, read: read, slot: Open }
```

### A draft the earlier Alpha kept for the conversation is taken once into an unused slot, and one it was sending comes back for review

The earlier Alpha kept each conversation's draft in the phone's secure
store, in a slot named from the session and the conversation
([adoption](../platform/adoption.md)). When the slot of the conversation
that opens holds nothing, the earlier text is copied into it once, as it
was marked: a draft is read as a saved draft, and a text the earlier Alpha
was sending as one that may already have been sent, so it waits for the
owner's review and is never sent by itself. A slot already used here, an
empty or unreadable earlier slot, and another conversation's slot take
nothing; the earlier slot is cleared only once this one holds the text.

```quint
pure def lawADraftTheEarlierAlphaWasSendingIsNeverHeld(c: Composer, ticket: int, revision: int): bool =
  canSlotRead(c, ticket, revision) implies
    (slotRead(c, ticket, Sending, revision).unsettled and slotRead(c, ticket, Sending, revision).away == c.away)
```

### The slot is read only while it is closed

```quint
pure def alwaysTheSlotIsReadWhileClosed(c: Composer): bool = opening(c) implies c.slot == Closed
```

### The owner writes only in an open slot, and every edit is counted at once

The shell says whether the text is blank, and whether it is longer than
the 64,000 UTF-16 units a message may hold.

```quint
pure val textLimit = 64000

pure def canEdit(c: Composer, blank: bool, long: bool): bool = c.slot == Open

pure def edit(c: Composer, blank: bool, long: bool): Composer =
  { ...c, draft: D::edit(c.draft), editor: { ...c.editor, text: not(blank) }, long: long and not(blank) }
```

### Edits are saved while no send is in hand and storage has not failed

A send in hand defers saving until it is committed or released.

```quint
pure def canSave(c: Composer): bool = c.slot == Open and c.away == Free and not(c.failing) and D::canSave(c.draft)

pure def save(c: Composer): Moved = written(false, c)
```

### A write that lands clears any sending mark, and one that finds another revision stops until both texts are kept or the message it marks is checked

A write that fails keeps the edits unsaved, to be written again. A
message whose mark could not be written goes back into the composer: it
was never asked. The first write that lands in a new conversation's slot
lets the slot the message came from be cleared. A write that finds a
revision another Alpha marked as sending, such as a second window sending
from the same conversation, puts that message under review as a slot read
does, never into the editor: the editor keeps only the owner's own text.
So does the first write of a message moved from a new conversation, whose
old slot then keeps its copy, never cleared.

```quint
type Wrote = Landed | Collided | Marked | Lost

pure def givenBack(held: Message, c: Composer): Composer =
  { ...c, away: Free, editor: { ...held, text: held.text or c.editor.text }, held: blankMessage }

pure def canWrote(c: Composer, ticket: int, revision: int): bool = D::canLand(c.draft) and ticket == c.writing and revision >= 0

pure def wrote(c: Composer, ticket: int, result: Wrote, revision: int): Moved =
  val landed = { ...c, draft: D::land(c.draft) }
  val clear = A::dispatch(A::record(A::plan(c.clear.id + 1)))
  val review = result == Marked and c.slot == Open
  val stopped =
    if (result == Lost) { ...c, draft: D::interrupt(c.draft), failing: true }
    else { ...c, draft: D::collide(c.draft, revision), unsettled: c.unsettled or review, marked: c.marked or review,
      source: if (review) 0 else c.source }
  if (result == Landed and c.away == Marking)
    { state: { ...landed, away: Asked, marked: true }, out: List(Ask({ hold: c.hold, attachments: attachments(c.held) })) }
  else if (result == Landed and c.source > 0)
    { state: { ...landed, marked: false, source: 0, clear: clear },
      out: List(Clear({ attempt: clear.id, binding: { owner: c.binding.owner, conversation: 0 }, revision: c.source })) }
  else if (result == Landed) { state: { ...landed, marked: false }, out: List() }
  else if (c.away == Marking) { state: givenBack(c.held, stopped), out: List() }
  else { state: stopped, out: List() }
```

### Retry writes the draft again after storage failed

Alpha tries again by itself, with no words by the field: at the owner's
next edit, after one, five and thirty seconds, and each time it comes back
to the front. Once those three timed tries have failed, Send stays
blocked and the conversation shows one card that the draft cannot be
kept, with Try again.

```quint
pure def canRetry(c: Composer): bool = c.failing and c.slot == Open and c.away == Free and D::canSave(c.draft)

pure def retry(c: Composer): Moved = written(false, { ...c, failing: false })
```

### A restart or an app update keeps only what the slot holds, and the hold numbers

What was saved is read again when the composer opens; attachments, the
editor and a send in hand are gone. Tickets carry on, so no answer to
what was asked before is taken after. A composer an earlier build kept
while its editor and what it held could carry a question is read without
the question, and with the rest as it was.

```quint
pure def reopen(c: Composer): Composer = rest(c.binding, c)
```

### The editor holds nothing until the slot is open, and a send is in hand only in an open slot

```quint
pure def alwaysNothingIsWrittenBeforeTheSlotOpens(c: Composer): bool =
  c.slot != Open implies (c.editor == blankMessage and c.held == blankMessage and c.away == Free and not(c.unsettled) and c.source == 0)
```

### Every write goes to the slot the composer is bound to

```quint
pure def stepEveryWriteGoesToItsOwnSlot(before: Composer, via: str, after: Composer, out: List[Effect]): bool =
  out.every(e => match e {
    | Write(w) => w.binding == after.binding and w.ticket == after.writing and w.ticket == before.writing + 1
    | ReadSlot(r) => r.binding == after.binding and r.ticket == after.read.ticket
    | _ => true
  })
```

### Tickets and hold numbers never go back

```quint
pure def stepTicketsNeverGoBack(before: Composer, via: str, after: Composer): bool =
  after.writing >= before.writing and after.read.ticket >= before.read.ticket and after.hold >= before.hold
    and after.clear.id >= before.clear.id and after.offeredAt >= before.offeredAt
```

### Storage can fail, and the slot can be damaged or unreadable

```quint
pure def sometimesStorageFailed(c: Composer): bool = c.failing and c.editor.text

pure def sometimesTheSlotIsDamaged(c: Composer): bool = c.slot == Damaged

pure def sometimesTheSlotCouldNotBeRead(c: Composer): bool = c.slot == Unreadable
```

### A saved draft can come back after a restart

```quint
pure def sometimesASavedDraftCameBack(c: Composer): bool = c.slot == Open and c.editor.text and c.draft.base > 0 and c.draft.edits == 0
```

## Story: Write in the conversation showing

> As the owner, I want what I write to stay with its conversation and with
> me: a message started before there was a conversation moves into the one
> made for it, and nothing I wrote is shown to another owner.

### Another conversation showing closes the slot and opens that conversation's, once nothing waits in this one

Chats show another conversation only when the editor's text is saved and
nothing waits to go, so what was written stays in its own slot.

```quint
pure def attached(m: Message): bool = attachments(m) > 0 or m.quote > 0 or m.editing > 0

pure def canBind(c: Composer, conversation: int): bool =
  conversation >= 0 and conversation != c.binding.conversation and c.away == Free
    and not(D::unsaved(c.draft)) and not(attached(c.editor)) and c.source == 0

pure def bind(c: Composer, conversation: int): Composer = rest({ ...c.binding, conversation: conversation }, c)
```

### Another owner or agent session drops the editor, the attachments and any send in hand

Their verified owner, agent and exact conversation slots stay as they
were on the phone. A message left marked as sending is reviewed when its
owner comes back. While no owner is verified, new text can wait in this
editor until it closes. It is never admitted to a signed-in draft. Older
slots whose authority was not recorded stay sealed.

```quint
pure def canSwitchOwner(c: Composer, owner: int): bool = owner != c.binding.owner

pure def switchOwner(c: Composer, owner: int): Composer = rest({ owner: owner, conversation: 0 }, c)
```

### A send in hand never outlives the slot it was held in

```quint
pure def stepASendStaysWithItsSlot(before: Composer, via: str, after: Composer): bool =
  after.binding != before.binding implies (after.away == Free and after.held == blankMessage and not(after.unsettled))
```

### A message written before its conversation existed moves into the new one, then its old slot is cleared on the exact revision read

When chats make the conversation, the message is written to the new
conversation's slot first. Only once that write lands is the new
conversation slot it came from cleared, and only if it still holds the
revision the message was read at: a copy changed meanwhile stays.

```quint
pure def canAdopt(c: Composer, conversation: int): bool =
  c.binding.conversation == 0 and conversation > 0 and c.slot == Open and c.away == Free
    and not(c.marked) and c.draft.sync != D::Saving and c.draft.sync != D::Conflicted and c.clear.outcome != A::Sent

pure def adopt(c: Composer, conversation: int): Moved =
  written(false, { ...c, binding: { ...c.binding, conversation: conversation }, source: c.draft.base,
    draft: D::edit(D::blank), failing: false })

pure def canCleared(c: Composer, attempt: int): bool = A::canConclude(c.clear, attempt)

pure def cleared(c: Composer, attempt: int, ok: bool, known: bool): Composer =
  { ...c, clear: A::conclude(c.clear, ok, known) }
```

### The old slot is cleared only after the message landed in its new one, on its own revision, for the same owner

```quint
pure def stepTheOldSlotIsClearedOnlyOnceTheMessageMoved(before: Composer, via: str, after: Composer, out: List[Effect]): bool =
  out.every(e => match e {
    | Clear(x) => via == "wrote" and after.draft.base == before.draft.base + 1 and after.binding == before.binding
        and after.binding.conversation > 0 and x.binding == { owner: before.binding.owner, conversation: 0 }
        and x.revision == before.source and x.revision > 0 and x.attempt == after.clear.id
        and before.clear.outcome != A::Sent and after.clear.outcome == A::Sent
    | _ => true
  })

pure def alwaysASlotRevisionIsNeverNegative(c: Composer): bool = c.draft.base >= 0

pure def alwaysOnlyAMovedMessageLeavesASlotToClear(c: Composer): bool =
  c.source >= 0 and (c.source > 0 implies (c.binding.conversation > 0 and c.clear.outcome != A::Sent and not(c.marked)))
```

### A moved message's old slot can be cleared, or kept because it changed

```quint
pure def sometimesAMovedMessageClearsItsOldSlot(c: Composer): bool = c.clear.outcome == A::Confirmed

pure def sometimesAChangedOldSlotIsKept(c: Composer): bool = c.clear.outcome == A::Refused
```

### A typed draft in a conversation that vanished moves into the new chat

When the conversation showing is no longer listed, a plain typed draft
(with no attachments, quote or edit from that conversation) moves into the
new chat's slot instead of being left behind.

```quint
pure def canCarry(c: Composer): bool =
  c.binding.conversation > 0 and c.slot == Open and c.away == Free
    and not(c.marked) and not(attached(c.editor)) and c.editor.text
    and c.source == 0 and c.draft.sync != D::Saving and c.draft.sync != D::Conflicted
    and c.clear.outcome != A::Sent

pure def carry(c: Composer): Moved =
  written(false, { ...c, binding: { ...c.binding, conversation: 0 },
    draft: D::edit(D::blank), failing: false, unsettled: false })

pure def stepACarriedDraftMovesToANewChat(before: Composer, via: str, after: Composer): bool =
  via == "carry" implies
    (before.binding.conversation > 0 and after.binding == { owner: before.binding.owner, conversation: 0 }
      and after.editor == before.editor and after.editor.text)

pure def sometimesACarriedDraftLandsInANewChat(c: Composer): bool =
  c.binding.conversation == 0 and c.slot == Open and c.editor.text and c.draft.sync == D::Saving
```

## Story: Keep both my text and the saved copy

> As the owner, when the slot holds a copy I did not expect, I want neither
> it nor my text lost: both kept in the field and saved, without being asked
> and without a word by the field.

### A conflict keeps the saved copy and the current text together, and saves them

Alpha settles a conflict by itself (restore saved). The editor takes the
saved copy, followed on a new line by the current text, and that text is
written to the slot as a new revision. Where one of the two is empty,
equal to the other, or the start of the other, only the longer is kept, so
nothing is written twice and nothing is dropped. Replace saved keeps the
current text over the saved copy directly. Restoring a message the slot
marked as sending makes it an ordinary draft again, and the mark is
written away.

```quint
pure def restored(saved: D::Draft, c: Composer): Moved =
  written(false, { ...c, draft: D::edit(D::takeSaved(saved)), editor: { ...c.editor, text: true }, unsettled: false })

pure def canRestoreSaved(c: Composer): bool = c.slot == Open and c.away == Free and D::canChoose(c.draft)

pure def restoreSaved(c: Composer): Moved = restored(c.draft, c)

pure def canReplaceSaved(c: Composer): bool = c.slot == Open and c.away == Free and D::canChoose(c.draft)

pure def replaceSaved(c: Composer): Composer = { ...c, draft: D::keepMine(c.draft), unsettled: false }
```

### A message that may already have been sent is checked by itself, and what the read found settles it

Alpha checks by itself as soon as the agent can answer, then after one,
five and thirty seconds and each time it comes back to the front. As the
message leaves, Alpha keeps its send key beside the slot, under the
revision of the mark, so the check finds the exact message in its
conversation even after a restart or from another Alpha; without that key
the conversation's one read tells. If the message arrived, or the slot no
longer holds the mark under review because the Alpha that marked it
settled it, the mark is written away and nothing is shown; if it was never
recorded, it goes back into the editor, ahead of what the owner typed
since, for the owner to send. A history read without the exact key leaves
the mark under review while the original request may still arrive.
Nothing is ever sent by itself. Once those
tries cannot tell, the conversation shows one card that the message may
already have been sent, with its text, Check again, It was sent, and Put
back in the field: It was sent keeps only what the owner typed since
(replace saved), and putting it back unchecked stays the owner's own
choice. While a message is under review, the turn note offers no check of
its own.

```quint
pure def canArrived(c: Composer, recorded: bool): bool = c.unsettled and c.away == Free

pure def arrived(c: Composer, recorded: bool): Moved =
  if (recorded) { state: { ...c, draft: D::keepMine(c.draft), unsettled: false }, out: List() } else restored(c.draft, c)
```

### A message that may already have been sent is under review until a check or the owner settles it

```quint
pure def alwaysAnUnsettledMessageIsUnderReview(c: Composer): bool =
  c.unsettled implies (c.marked and c.draft.sync == D::Conflicted)
```

### A message under review leaves it only by the owner's choice, a check, or another slot

```quint
pure def stepAReviewEndsOnlyByAChoice(before: Composer, via: str, after: Composer): bool =
  (before.unsettled and not(after.unsettled)) implies
    (via == "restoreSaved" or via == "replaceSaved" or via == "arrived" or via == "bind" or via == "switchOwner" or via == "reopen")
```

### Two copies can meet

```quint
pure def sometimesTwoCopiesAreOffered(c: Composer): bool = c.draft.sync == D::Conflicted and not(c.unsettled)
```

### A message that may already have been sent can be under review

```quint
pure def sometimesAMessageMayAlreadyHaveBeenSent(c: Composer): bool = c.unsettled
```

## Story: Send what I wrote

> As the owner, I want Send to send my message once, to clear the composer
> while it goes, to give it back if it never left, and never to send again a
> message that may already have been sent.

### A send holds the message: the composer clears, and the slot is marked as sending before anything is asked

There must be text or an attachment, the slot open and saved or edited, no
other send in hand, storage working, no mark from an earlier send left in
the slot, and no message still moving from a new conversation. The
conversation must be able to take it: the agent within reach, the screen
not sensitive and no turn in flight; otherwise Send is not offered. A new
chat offers Send on the same terms, so a message under review there is never
sent by itself: a Send that waits for its conversation to be made is spent
once the message comes under review, and only the owner's next Send sends
it. A mark holds the message's text once, and beside it the text of an
earlier sent message only where that differs.

```quint
pure def content(m: Message): bool = m.text or attachments(m) > 0

pure def canHold(c: Composer, askable: bool): bool =
  askable and c.slot == Open and c.away == Free and not(c.marked) and not(c.failing) and content(c.editor) and not(c.long)
    and c.source == 0 and c.draft.sync != D::Saving and c.draft.sync != D::Conflicted

pure def hold(c: Composer, askable: bool): Moved =
  written(true, { ...c, hold: c.hold + 1, away: Marking, editor: blankMessage, held: c.editor, draft: D::edit(c.draft), long: false })
```

### A message longer than a message may hold is kept as a draft and never sent

The owner is told it is too long, and Send is offered again once it is
short enough.

```quint
pure def lawALongMessageIsNotSent(c: Composer, askable: bool): bool = c.long implies not(canHold(c, askable))

pure def sometimesAMessageIsTooLong(c: Composer): bool = c.long and c.editor.text and c.slot == Open
```

### A held message is asked of the conversation only once its mark is written, and only once, with its attachments

The conversation takes each hold number once: no other machine counts
them.

```quint
pure def stepAMessageIsAskedOnlyOnceMarked(before: Composer, via: str, after: Composer, out: List[Effect]): bool =
  out.every(e => match e {
    | Ask(a) => via == "wrote" and before.away == Marking and after.away == Asked and a.hold == after.hold
        and a.attachments == attachments(after.held)
    | _ => true
  })

pure def alwaysAMessageAskedIsMarked(c: Composer): bool = c.away == Asked implies c.marked
```

### While a send is in hand its mark is the only write, and nothing is under review

Discovered by the proof: without it, a write landing while a message is in
the conversation's hands could clear its mark, and a commit could close a
review the owner never made.

```quint
pure def alwaysASendInHandOwnsTheSlot(c: Composer): bool =
  (c.away == Marking implies c.draft.sync == D::Saving)
    and (c.away == Asked implies (c.draft.sync == D::Kept or c.draft.sync == D::Edited))
    and (c.away != Free implies (not(c.unsettled) and c.source == 0))
    and (c.away == Free implies c.held == blankMessage)
```

### Each send takes a new hold number

```quint
pure def stepEachSendTakesANewNumber(before: Composer, via: str, after: Composer): bool =
  (before.away == Free and after.away == Marking) implies (via == "hold" and after.hold == before.hold + 1)
```

### A message that left is committed: the slot is cleared of it and what the owner typed since stays

```quint
pure def canCommit(c: Composer, hold: int): bool = c.away == Asked and hold == c.hold

pure def commit(c: Composer, hold: int): Moved = written(false, { ...c, away: Free, held: blankMessage, draft: D::edit(c.draft) })
```

### A message that never left is released back into the composer, with its attachments

The conversation says it never left, or could not ask it.

```quint
pure def canRelease(c: Composer, hold: int): bool = c.away == Asked and hold == c.hold

pure def release(c: Composer, hold: int): Moved = written(false, { ...givenBack(c.held, c), draft: D::edit(c.draft) })
```

### Released, a message comes back ahead of what I typed since, and neither is lost; committed, it never comes back

```quint
pure def stepAReleasedMessageComesBackWhole(before: Composer, via: str, after: Composer): bool =
  ((via == "release" or (via == "wrote" and before.away == Marking and after.away == Free))
      implies (after.editor == { ...before.held, text: before.held.text or before.editor.text }))
    and (via == "commit" implies after.editor == before.editor)
```

### No new send starts while the slot still carries a mark

A message that left but whose mark could not be cleared, or one found
marked after a restart, must be reviewed first.

```quint
pure def stepNoSendStartsOverAMark(before: Composer, via: str, after: Composer): bool =
  via == "hold" implies not(before.marked)
```

### Every send in hand is committed or released

The conversation answers every message it is asked, and storage every
write.

```quint
pure def leadsToASendInHandIsSettled(c: Composer, later: Composer): bool =
  c.away != Free implies later.away == Free

pure val fair_wrote = "weak"
pure val fair_commit = "weak"
pure val fair_release = "weak"
```

### A message can be marked, and in the conversation's hands

```quint
pure def sometimesASendIsBeingMarked(c: Composer): bool = c.away == Marking

pure def sometimesAMessageIsAsked(c: Composer): bool = c.away == Asked and c.editor.text
```

### A message can come back into the composer

```quint
pure def sometimesAMessageCameBack(c: Composer): bool = c.away == Free and c.editor.text and c.editor.files > 0 and c.hold > 0
```

### A message can leave while its mark could not be cleared

```quint
pure def sometimesAMarkIsLeftBehind(c: Composer): bool = c.away == Free and c.marked and c.failing
```

## Story: Attach, quote and edit again

> As the owner, I want to add files to my message within the limit I can
> see, to have the mail, the photo or the transcript I am looking at go
> with it, to quote a message, and to edit a message I sent and send it
> again.

### Files chosen are added up to the upload limit of four

Nothing is attached while a send is in hand. A file is removed one at a
time.

```quint
pure val maxFiles = 4

pure def canAttach(c: Composer, count: int): bool =
  c.slot == Open and c.away == Free and count > 0 and c.editor.files + count <= maxFiles

pure def attach(c: Composer, count: int): Composer = { ...c, editor: { ...c.editor, files: c.editor.files + count } }

pure def canRemoveFile(c: Composer): bool = c.away == Free and c.editor.files > 0

pure def removeFile(c: Composer): Composer = { ...c, editor: { ...c.editor, files: c.editor.files - 1 } }
```

### A shared result adds its file and leaves the owner's draft as written

The selected result adds one file to the same open composer slot. It
may also supply editable text when the draft is empty. Both belong to one
change. A send in hand or a draft being edited from history refuses the
handoff.

```quint
pure def canAttachQuestion(c: Composer, owner: int, conversation: int, ticket: int, seed: bool): bool =
  c.binding.owner == owner and c.binding.conversation == conversation and c.read.ticket == ticket
    and canAttach(c, 1) and attachments(c.editor) < maxFiles and c.editor.editing == 0
    and (not(seed) or not(c.editor.text))

pure def attachQuestion(c: Composer, owner: int, conversation: int, ticket: int, seed: bool): Composer =
  val added = attach(c, 1)
  if (seed) edit(added, false, false) else added

pure def stepAQuestionKeepsAnExistingDraft(before: Composer, via: str, after: Composer): bool =
  via == "attachQuestion" implies
    (after.binding == before.binding and after.editor.files == before.editor.files + 1 and
      (before.editor.text implies (after.editor.text and after.long == before.long and after.draft == before.draft)))
```

### A later reviewed photo replaces the chosen draft photo

Asking Alpha from the Photos viewer puts one photo into this owner’s open
draft. Its chip stays visible wherever the draft can be sent. An accepted
second photo takes its place in the same draft and leaves the other files,
text and attachment count as they were. An approved Camera capture can fill
this slot when it is empty, while the draft still belongs to the same owner,
conversation and read ticket. Both photos wait for the owner's Send.

```quint
pure def canReplaceReviewedPhoto(c: Composer, owner: int, conversation: int, ticket: int): bool =
  c.binding.owner == owner and c.binding.conversation == conversation and c.read.ticket == ticket
    and c.slot == Open and c.away == Free and not(c.unsettled) and c.editor.editing == 0 and c.editor.files > 0

pure def replaceReviewedPhoto(c: Composer, owner: int, conversation: int, ticket: int): Composer = c

pure def lawAReviewedPhotoReplacementKeepsTheDraft(c: Composer, owner: int, conversation: int, ticket: int): bool =
  canReplaceReviewedPhoto(c, owner, conversation, ticket) implies replaceReviewedPhoto(c, owner, conversation, ticket) == c
```

### The mail open in Inbox, the photo open in Photos, or a transcript handed over by "Ask Alpha about this" is offered once by the view showing

Each view offers at most one of each, once: once sent or removed, the same
view never offers it again.

```quint
type Kind = Mail | Transcript | Shown

pure def has(m: Message, kind: Kind): bool =
  if (kind == Mail) m.mail else if (kind == Transcript) m.transcript else m.shown

pure def canOffer(c: Composer, kind: Kind, revision: int): bool =
  c.slot == Open and c.away == Free and revision > c.offeredAt and not(has(c.editor, kind))

pure def offer(c: Composer, kind: Kind, revision: int): Composer =
  { ...c, offeredAt: revision, editor:
    if (kind == Mail) { ...c.editor, mail: true }
    else if (kind == Transcript) { ...c.editor, transcript: true }
    else { ...c.editor, shown: true } }

pure def canDetach(c: Composer, kind: Kind): bool = c.away == Free and has(c.editor, kind)

pure def detach(c: Composer, kind: Kind): Composer =
  { ...c, editor:
    if (kind == Mail) { ...c.editor, mail: false }
    else if (kind == Transcript) { ...c.editor, transcript: false }
    else { ...c.editor, shown: false } }

pure def stepAViewOffersOnce(before: Composer, via: str, after: Composer): bool =
  via == "offer" implies after.offeredAt > before.offeredAt
```

### What a view offered is dropped when another view shows before Send

```quint
pure def offered(m: Message): bool = m.mail or m.transcript or m.shown

pure def canMoveOn(c: Composer, revision: int): bool = revision > c.offeredAt and offered(c.editor)

pure def moveOn(c: Composer, revision: int): Composer =
  { ...c, editor: { ...c.editor, mail: false, transcript: false, shown: false } }

pure def stepWhatAViewOfferedLeavesWithIt(before: Composer, via: str, after: Composer): bool =
  (offered(after.editor) and not(offered(before.editor))) implies (via == "offer" or via == "release" or via == "wrote")
```

### Attachments stay within their limits, waiting or held

```quint
pure def within(m: Message): bool = 0 <= m.files and m.files <= maxFiles and m.quote >= 0 and m.editing >= 0

pure def alwaysAttachmentsStayWithinTheirLimits(c: Composer): bool = within(c.editor) and within(c.held) and c.offeredAt >= 0
```

### A quoted message goes with the next send, until the owner removes the quote

Only a message of the conversation showing that the agent recorded, and
whose turn has settled, is quoted: never a streaming reply, a card or a
line Alpha wrote itself. Chats say which.

```quint
pure def canQuote(c: Composer, message: int, recorded: bool): bool = c.slot == Open and c.away == Free and message > 0 and recorded

pure def quote(c: Composer, message: int, recorded: bool): Composer = { ...c, editor: { ...c.editor, quote: message } }

pure def canUnquote(c: Composer): bool = c.away == Free and c.editor.quote > 0

pure def unquote(c: Composer): Composer = { ...c, editor: { ...c.editor, quote: 0 } }
```

### Text another area hands to Ask Alpha goes only into an empty composer, as a draft the owner sends

Nothing handed over is sent by the area that handed it, and it never
replaces what the owner already typed.

```quint
pure def canHandOver(c: Composer): bool = c.slot == Open and c.away == Free and not(c.editor.text)

pure def handOver(c: Composer): Composer = { ...c, draft: D::edit(c.draft), editor: { ...c.editor, text: true }, long: false }

pure def stepAHandoverNeverOverwritesTyping(before: Composer, via: str, after: Composer, out: List[Effect]): bool =
  via == "handOver" implies (not(before.editor.text) and out == List())
```

### Edit and resend puts a message the owner sent in an empty composer, to be sent as a new message

Chats say whether the message is the owner's own, and whether the agent
recorded it and its turn has settled.

```quint
pure def canEditAgain(c: Composer, message: int, mine: bool, recorded: bool): bool =
  mine and recorded and c.slot == Open and c.away == Free and message > 0 and not(c.editor.text)

pure def editAgain(c: Composer, message: int, mine: bool, recorded: bool): Composer =
  { ...c, draft: D::edit(c.draft), editor: { ...c.editor, text: true, editing: message } }
```

### Back, or removing the mark, leaves an edit as an ordinary draft

The text stays in the composer to send as a new message; only the mark of
the message it came from is taken off.

```quint
pure def canStopEditing(c: Composer): bool = c.away == Free and c.editor.editing > 0

pure def stopEditing(c: Composer): Composer = { ...c, editor: { ...c.editor, editing: 0 } }

pure def lawStoppingAnEditKeepsTheText(c: Composer): bool =
  canStopEditing(c) implies (stopEditing(c).editor.text == c.editor.text and stopEditing(c).editor.editing == 0)
```

### Attachments can fill to their limit

```quint
pure def sometimesTheFilesAreFull(c: Composer): bool = c.editor.files == maxFiles and c.editor.mail
```

### A quoted message can be held with a send

```quint
pure def sometimesAQuoteIsHeld(c: Composer): bool = c.held.quote > 0 and c.away == Asked
```

### A message can be edited to send again

```quint
pure def sometimesAMessageIsEditedAgain(c: Composer): bool = c.editor.editing > 0 and c.editor.text
```
