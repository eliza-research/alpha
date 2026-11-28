# Composer

The composer of the conversation open in [Messages](./), which the shell
names when it opens one: its draft and who wrote it, Alpha's suggestion,
the SIM, the pictures, the access sending needs, and the
[send](./sending.md), which it holds. Each conversation has one draft, saved
on the phone and brought back when the conversation opens again, after a
restart too. Alpha suggests a draft only where the owner has written
nothing, marks it as Alpha's, offers Undo, and never sends it: only the
owner's Send does.

## Domain

### What the composer holds

The open conversation and its recipients; its draft, who wrote it and how
far it is saved; the pictures attached and the pictures the phone saved;
the payload carried by a save and whether it needs a retry; a suggestion
asked of the agent; send and SIM access, the SIMs and the one chosen; the
send, its sealed draft revision, and any confirmed draft clear still owed.

```quint
import read as R from "../../kit/read"
import permission as P from "../../kit/permission"
import draft as D from "../../kit/draft"
import attempt as A from "../../kit/attempt"
import sending as S from "./sending"

type Author = Nobody | OwnerWrote | AlphaWrote
type Need = SendAccess | SimAccess
type Slot = { author: Author, draft: D::Draft }
type NewSource = { visit: int, revision: int }
type SavePayload = { author: Author, pictures: int }
type ClearSource = ConversationDraft | NewMessageDraft
type SentDraft = { source: ClearSource, thread: int, revision: int, id: int, visit: int }
type Composer = {
  thread: int, recipients: int,
  slot: Slot, saved: int -> Author, suggestion: R::Read,
  sending: P::Permission, simInfo: P::Permission, sims: int, sim: int, pictures: int,
  carriedDraft: SavePayload, savedPictures: int, saveFailed: bool,
  sendRevision: int, pendingClear: SentDraft,
  outgoing: S::Outgoing,
  newSend: NewSource,
}

pure val emptySlot: Slot = { author: Nobody, draft: D::blank }
pure val noNewSend: NewSource = { visit: 0, revision: 0 }
pure val noSave: SavePayload = { author: Nobody, pictures: 0 }
pure val noClear: SentDraft = { source: ConversationDraft, thread: 0, revision: 0, id: 0, visit: 0 }
pure val maxPictures = 5

pure val initial: Composer = {
  thread: 0, recipients: 0,
  slot: emptySlot, saved: Map(), suggestion: R::unread,
  sending: P::unasked, simInfo: P::unasked, sims: 1, sim: 0, pictures: 0,
  carriedDraft: noSave, savedPictures: 0, saveFailed: false,
  sendRevision: 0, pendingClear: noClear,
  outgoing: S::initial,
  newSend: noNewSend,
}
```

### What the composer asks of the phone and the agent

A conversation draft saved or an exact sent revision cleared; a suggestion
asked of the agent; Android's prompts and Settings; the messaging app
opened for what Alpha cannot send; and what the send asks.

```quint
type Effect =
  | SaveDraft({ thread: int, author: Author, base: int, edits: int, pictures: int })
  | ClearSentDraft(SentDraft)
  | Suggest({ ticket: int, thread: int })
  | Prompt({ need: Need })
  | OpenSettings
  | OpenMessagingApp
  | Sending({ effect: S::Effect })

type Moved = { state: Composer, out: List[Effect] }

pure def withSend(sent: S::Stepped, c: Composer): Moved =
  { state: { ...c, outgoing: sent.state }, out: sent.out.listMap(e => Sending({ effect: e })) }

pure def savedFor(thread: int, c: Composer): Author =
  if (c.saved.keys().contains(thread)) c.saved.get(thread) else Nobody
```

### What the simulator tries

```quint
pure val ticketValues = Set(1, 2)
pure val idValues = Set(1, 2, 3)
pure val threadValues = Set(0, 1, 2)
pure val recipientsValues = Set(0, 1, 2)
pure val visitValues = Set(1, 2)
pure val countValues = Set(0, 1, 2)
pure val simValues = Set(0, 1, 2)
pure val revisionValues = Set(0, 1, 2, 3)
pure val baseValues = Set(0, 1, 2, 3)
pure val editsValues = Set(1, 2, 3)
pure val heldValues = Set(0, 1, 2, 3)
pure val landedRevisionValues = Set(0, 2, 3, 4)
pure val sourceValues = Set(ConversationDraft, NewMessageDraft)
pure val picturesValues = Set(0, 1, 2, 5)
pure val authorValues = Set(Nobody, OwnerWrote, AlphaWrote)
pure val weight_typeText = 3
pure val weight_saveDraft = 2
pure val weight_draftSaved = 2
```

## Story: Keep my draft

> As the owner, I want one draft for each conversation, kept on the phone
> through a restart, and never lost by leaving the conversation.

### Opening a conversation brings back the draft the phone saved for it

The previous conversation's draft must be saved and closed first. Opening
uses the revision, author and ordered pictures read for this conversation
from the phone. Revision zero is the empty slot. The model counts pictures
and the shell holds their contents in order.

```quint
pure def settledDraft(c: Composer): bool = not(D::unsaved(c.slot.draft))

pure def validSavedDraft(revision: int, author: Author, pictures: int): bool =
  revision >= 0 and 0 <= pictures and pictures <= maxPictures
    and (revision == 0 implies (author == Nobody and pictures == 0))

pure def canOpenDraft(c: Composer, thread: int, recipients: int, revision: int, author: Author, pictures: int): bool =
  c.thread == 0 and settledDraft(c) and thread > 0 and recipients > 0 and validSavedDraft(revision, author, pictures)

pure def openDraft(c: Composer, thread: int, recipients: int, revision: int, author: Author, pictures: int): Composer =
  val fresh = D::blank
  { ...c, thread: thread, recipients: recipients, pictures: pictures,
    slot: { author: author, draft: { ...fresh, base: revision } },
    saved: c.saved.put(thread, author), savedPictures: pictures,
    suggestion: { ...c.suggestion, status: R::Idle } }
```

### Closing the conversation's composer waits until its draft is saved

```quint
pure def canCloseDraft(c: Composer): bool = c.thread > 0 and settledDraft(c)

pure def closeDraft(c: Composer): Composer =
  { ...c, thread: 0, recipients: 0, pictures: 0, slot: emptySlot, savedPictures: 0,
    suggestion: { ...c.suggestion, status: R::Idle } }
```

### Typing changes the draft and makes it the owner's; emptying it leaves no draft

The draft cannot change while it is being sent, while its send's outcome
is unknown, or while the phone is still clearing the confirmed revision.

```quint
pure def bound(c: Composer): bool =
  c.newSend.revision == 0 and c.outgoing.thread == c.thread
    and (S::busy(c.outgoing) or S::uncertain(c.outgoing) or c.pendingClear.id > 0)

pure def canTypeText(c: Composer, empty: bool): bool = c.thread > 0 and not(bound(c))

pure def typeText(c: Composer, empty: bool): Composer =
  { ...c, slot: { author: if (empty) Nobody else OwnerWrote, draft: D::edit(c.slot.draft) },
    suggestion: { ...c.suggestion, status: R::Idle } }
```

### An edited draft is saved for its conversation, one save at a time

Each save carries the conversation, author, base revision, edit count and
picture count of its payload. An answer applies only to that save. Edits
made during the write are still to save.

```quint
pure def canSaveDraft(c: Composer): bool = c.thread > 0 and not(c.saveFailed) and D::canSave(c.slot.draft)

pure def saveDraft(c: Composer): Moved =
  val carried = { author: c.slot.author, pictures: c.pictures }
  { state: { ...c, carriedDraft: carried, slot: { ...c.slot, draft: D::save(c.slot.draft) } },
    out: List(SaveDraft({ thread: c.thread, author: carried.author, base: c.slot.draft.base,
      edits: c.slot.draft.edits, pictures: carried.pictures })) }

pure def canDraftSaved(c: Composer, thread: int, base: int, edits: int): bool =
  c.thread > 0 and thread == c.thread and D::canLand(c.slot.draft)
    and base == c.slot.draft.base and edits == c.slot.draft.carried

pure def draftSaved(c: Composer, thread: int, base: int, edits: int): Composer =
  { ...c, slot: { ...c.slot, draft: D::land(c.slot.draft) }, saved: c.saved.put(thread, c.carriedDraft.author),
    savedPictures: c.carriedDraft.pictures, carriedDraft: noSave }
```

### A failed save keeps the draft edited and waits for the owner to retry

The owner can keep editing after a failure. Retry saves the latest edits.

```quint
pure def canDraftSaveFailed(c: Composer, thread: int, base: int, edits: int): bool = canDraftSaved(c, thread, base, edits)

pure def draftSaveFailed(c: Composer, thread: int, base: int, edits: int): Composer =
  { ...c, slot: { ...c.slot, draft: { ...c.slot.draft, sync: D::Edited } }, carriedDraft: noSave, saveFailed: true }

pure def canRetrySave(c: Composer): bool = c.thread > 0 and c.saveFailed and D::canSave(c.slot.draft)

pure def retrySave(c: Composer): Moved = saveDraft({ ...c, saveFailed: false })

pure def alwaysASaveFailureHoldsAnUnsavedDraft(c: Composer): bool =
  c.saveFailed implies (c.thread > 0 and c.slot.draft.sync == D::Edited)

pure def stepSaveFailureWaitsForARetry(before: Composer, via: str, after: Composer): bool =
  (before.saveFailed and after.slot.draft.sync == D::Saving) implies via == "retrySave"
```

### A save that finds another draft saved for the conversation meanwhile stops, and the owner chooses which draft to keep

The phone saves a draft only over the revision it was edited from, so a
draft saved elsewhere meanwhile is never written over. The conflict
reports the revision, author and picture count of the saved draft.
Choosing the saved draft takes its text and ordered pictures together.

```quint
pure def canDraftCollided(c: Composer, thread: int, base: int, edits: int, held: int, theirs: Author, pictures: int): bool =
  canDraftSaved(c, thread, base, edits) and held != base and validSavedDraft(held, theirs, pictures)

pure def draftCollided(c: Composer, thread: int, base: int, edits: int, held: int, theirs: Author, pictures: int): Composer =
  { ...c, slot: { ...c.slot, draft: D::collide(c.slot.draft, held) }, saved: c.saved.put(thread, theirs),
    savedPictures: pictures, carriedDraft: noSave }

pure def canKeepMine(c: Composer): bool = c.thread > 0 and D::canChoose(c.slot.draft)

pure def keepMine(c: Composer): Composer = { ...c, slot: { ...c.slot, draft: D::keepMine(c.slot.draft) } }

pure def canTakeSaved(c: Composer): bool = c.thread > 0 and D::canChoose(c.slot.draft) and not(bound(c))

pure def takeSaved(c: Composer): Composer =
  { ...c, slot: { author: savedFor(c.thread, c), draft: D::takeSaved(c.slot.draft) },
    pictures: c.savedPictures,
    suggestion: { ...c.suggestion, status: R::Idle } }
```

### A draft that met another one saved meanwhile is settled only by the owner's choice

```quint
pure def stepOnlyTheOwnerSettlesAConflict(before: Composer, via: str, after: Composer): bool =
  (before.slot.draft.sync == D::Conflicted and after.thread == before.thread and after.slot.draft.sync != D::Conflicted)
    implies (via == "keepMine" or via == "takeSaved")
```

### A draft can meet another saved meanwhile, and the owner can keep either

```quint
pure def sometimesDraftConflict(c: Composer): bool = c.slot.draft.sync == D::Conflicted and c.slot.author == OwnerWrote
pure def sometimesTookTheSavedDraft(c: Composer): bool =
  c.thread > 0 and c.slot.draft.sync == D::Kept and c.slot.draft.carried > 0 and c.slot.author == AlphaWrote
    and c.suggestion.status == R::Idle
```

### A restart closes the conversation and keeps the saved drafts, the send and its pending clear, access and the SIMs the phone has

A suggestion asked before the restart is not taken after it. A send that
lacked a final answer becomes unknown. Checking it reads its saved receipt.
The revision of a New draft stays sealed; its prior visit ends at restart.

```quint
pure def restart(c: Composer): Composer =
  { ...initial, saved: c.saved, outgoing: if (S::busy(c.outgoing)) S::lost(c.outgoing) else c.outgoing,
    newSend: { ...c.newSend, visit: 0 },
    sendRevision: c.sendRevision, pendingClear: { ...c.pendingClear, visit: 0 },
    sending: c.sending, simInfo: c.simInfo, sims: c.sims,
    suggestion: { ...c.suggestion, status: R::Idle } }

pure def stepSavedDraftsSurviveARestart(before: Composer, via: str, after: Composer): bool =
  val held = if (S::busy(before.outgoing)) S::lost(before.outgoing) else before.outgoing
  via == "restart" implies (after.saved == before.saved and after.outgoing == held and after.thread == 0
    and after.newSend.revision == before.newSend.revision and after.newSend.visit == 0
    and after.sendRevision == before.sendRevision and after.pendingClear == { ...before.pendingClear, visit: 0 }
    and after.sending == before.sending and after.simInfo == before.simInfo and after.sims == before.sims
    and after.suggestion.ticket == before.suggestion.ticket and after.suggestion.status == R::Idle)
```

### A draft is held only with its conversation, and a conversation's draft is let go only once saved

```quint
pure def alwaysTheDraftIsTheOpenConversations(c: Composer): bool =
  (c.thread == 0 implies (c.slot == emptySlot and c.recipients == 0)) and (c.thread > 0 implies c.recipients > 0)
    and (c.suggestion.status == R::Loading implies c.thread > 0)

pure def stepADraftIsNotLostByLeaving(before: Composer, via: str, after: Composer): bool =
  (after.thread != before.thread and via != "restart") implies settledDraft(before)
```

### A draft can be kept through a restart

```quint
pure def sometimesSavedDraftBack(c: Composer): bool =
  c.thread > 0 and c.slot.author == OwnerWrote and settledDraft(c) and c.slot.draft.base > 0
    and c.slot.draft.edits == 0 and c.outgoing.op.id == 0
```

## Story: Let Alpha suggest a draft

> As the owner, I want Alpha's suggestion offered only when I have written
> nothing, marked as Alpha's, undone with one tap, and never sent without
> my tap.

### Alpha's suggestion is asked for only when the draft is empty, and lands only if it still is

```quint
pure def canSuggest(c: Composer): bool =
  c.thread > 0 and c.slot.author == Nobody and c.suggestion.status != R::Loading and not(bound(c))

pure def suggest(c: Composer): Moved =
  val suggestion = R::ask(c.suggestion)
  { state: { ...c, suggestion: suggestion }, out: List(Suggest({ ticket: suggestion.ticket, thread: c.thread })) }

pure def canSuggested(c: Composer, ticket: int): bool = c.thread > 0 and R::canAnswer(c.suggestion, ticket)

pure def suggested(c: Composer, ticket: int, ok: bool): Composer =
  val landed = ok and c.slot.author == Nobody and not(bound(c))
  { ...c, suggestion: R::answer(c.suggestion, ok),
    slot: if (landed) { author: AlphaWrote, draft: D::edit(c.slot.draft) } else c.slot }
```

### Undo takes Alpha's draft away

Alpha's draft is shown addressed, To the conversation's name and number,
in the composer, where the owner may edit it before Send; it offers Send
and Don't send. Don't send is this Undo: the draft is left as empty as the
owner left it, and nothing is sent.

```quint
pure def canUndo(c: Composer): bool = c.slot.author == AlphaWrote and not(bound(c))

pure def undo(c: Composer): Composer = { ...c, slot: { author: Nobody, draft: D::edit(c.slot.draft) } }
```

### The agent's draft goes into the open conversation's draft only while it is empty, and never sends

The agent may ask for a reply to the conversation open on screen, or for a
draft to a number the owner wrote, whose conversation Messages opens first,
as a number handed to it. After the owner reviewed the latest sender’s full
number and the agent's reply named its Android thread, a follow-up draft
uses that exact thread only while Android still shows the same sole
recipient there. Its text becomes Alpha's draft there, for the owner to
edit and send. A draft already written, or one held by a send, is
left as it is, and the agent is told the draft is occupied; with no
conversation open it is told none is selected.

```quint
pure def canAgentDrafted(c: Composer, thread: int): bool = c.thread > 0 and thread == c.thread

pure def agentDrafted(c: Composer, thread: int): Composer =
  if (c.slot.author == Nobody and not(bound(c)))
    { ...c, slot: { author: AlphaWrote, draft: D::edit(c.slot.draft) }, suggestion: { ...c.suggestion, status: R::Idle } }
  else c
```

### An addressed send names the exact number, text and SIM before it can send

When the agent proposes sending to a number or a contact, the owner sees
the exact number, message and SIM. For a contact, the owner first chooses
the number on the phone. The review uses the selected line in Messages
or Android's default text line outside Messages. On approval it sends
through Android only if the chosen number and SIM still match the review.
An explicit request for an editable draft stays in the composer.

```quint
pure def addressedSend(draft: bool, recipient: str, body: str, shownSim: int, currentSim: int): bool =
  not(draft) and recipient != "" and body != "" and shownSim >= 0 and shownSim == currentSim

pure def lawAnAddressedDraftCannotSend(recipient: str, body: str, sim: int): bool =
  not(addressedSend(true, recipient, body, sim, sim))
```

### Alpha writes a draft only where the owner had written nothing, and a draft of Alpha's saved meanwhile replaces the owner's only by the owner's choice

```quint
pure def stepAlphaWritesOnlyAnEmptyDraft(before: Composer, via: str, after: Composer): bool =
  (after.slot.author == AlphaWrote and before.slot.author != AlphaWrote and after.thread == before.thread and via != "restart")
    implies (((via == "suggested" or via == "agentDrafted") and before.slot.author == Nobody) or via == "takeSaved")
```

### Alpha's draft can be offered, saved, and undone

```quint
pure def sometimesAlphaDraft(c: Composer): bool = c.slot.author == AlphaWrote and settledDraft(c) and c.slot.draft.base > 0
pure def sometimesAgentDraftWaits(c: Composer): bool = c.slot.author == AlphaWrote and c.suggestion.status == R::Idle and c.suggestion.ticket == 0 and c.thread > 0
pure def sometimesUndone(c: Composer): bool = c.slot.author == Nobody and c.slot.draft.base > 0 and c.thread > 0 and savedFor(c.thread, c) == AlphaWrote
```

## Story: Send a message

> As the owner, I want to choose a SIM, attach pictures, be asked for the
> access sending needs, hand off to the messaging app what Alpha cannot
> send, and have only my own tap send anything.

### Alpha asks for SMS send access or SIM access only from its Allow control, and only once each

```quint
pure def permission(need: Need, c: Composer): P::Permission = if (need == SendAccess) c.sending else c.simInfo

pure def granted(need: Need, p: P::Permission, c: Composer): Composer =
  if (need == SendAccess) { ...c, sending: p } else { ...c, simInfo: p }

pure def canAllow(c: Composer, need: Need): bool = c.thread > 0 and P::canAsk(permission(need, c))

pure def allow(c: Composer, need: Need): Moved = { state: granted(need, P::ask(permission(need, c)), c), out: List(Prompt({ need: need })) }

pure def canGoToSettings(c: Composer, need: Need): bool = c.thread > 0 and P::needsSettings(permission(need, c))

pure def goToSettings(c: Composer, need: Need): Moved = { state: c, out: List(OpenSettings) }

pure def accessReported(c: Composer, need: Need, grant: P::Grant): Composer = granted(need, P::observe(permission(need, c), grant), c)

pure def canAllowNew(c: Composer, need: Need): bool = c.thread == 0 and P::canAsk(permission(need, c))

pure def allowNew(c: Composer, need: Need): Moved = allow(c, need)

pure def canSettingsNew(c: Composer, need: Need): bool = c.thread == 0 and P::needsSettings(permission(need, c))

pure def settingsNew(c: Composer, need: Need): Moved = goToSettings(c, need)

pure def stepThePromptNeedsTheControl(before: Composer, via: str, after: Composer, out: List[Effect]): bool =
  out.some(e => match e { | Prompt(p) => true | _ => false }) implies (via == "allow" or via == "allowNew")
```

### The phone says how many SIMs it has, and with more than one the owner picks one, which needs SIM access

```quint
pure def canSimsReported(c: Composer, count: int): bool = count >= 1

pure def simsReported(c: Composer, count: int): Composer = { ...c, sims: count, sim: if (c.sim <= count) c.sim else 0 }

pure def canPickSim(c: Composer, sim: int): bool =
  c.thread > 0 and c.sims > 1 and P::allows(c.simInfo) and 1 <= sim and sim <= c.sims and sim != c.sim

pure def pickSim(c: Composer, sim: int): Composer = { ...c, sim: sim }
```

### The owner attaches up to five pictures, and removes them one by one

`fits` is the phone's word that the picture is a JPEG, PNG or GIF that keeps
the message within the carrier's MMS size; any other file is never
attached. Pictures come from the phone's pictures, several at once, or one
taken with the camera. Several recipients or any picture go as one MMS.

```quint
pure def canAttach(c: Composer, fits: bool): bool = c.thread > 0 and c.pictures < maxPictures and not(bound(c)) and fits

pure def attach(c: Composer, fits: bool): Composer =
  { ...c, pictures: c.pictures + 1, slot: { ...c.slot, draft: D::edit(c.slot.draft) } }

pure def canDetach(c: Composer): bool = c.pictures > 0 and not(bound(c))

pure def detach(c: Composer): Composer =
  { ...c, pictures: c.pictures - 1, slot: { ...c.slot, draft: D::edit(c.slot.draft) } }
```

### What Alpha cannot send is handed to the messaging app

`supported` is the phone's word that Alpha can send this message itself.
A single plain text uses SMS. Pictures and groups use one MMS. If Alpha
cannot send, the handoff opens the messaging app with the draft text for
review.

```quint
pure def canHandOff(c: Composer, supported: bool): bool = c.thread > 0 and not(supported)

pure def handOff(c: Composer, supported: bool): Moved = { state: c, out: List(OpenMessagingApp) }
```

### Only the owner's Send sends: a draft or a picture, with send access, a SIM where there is a choice, and never during a call that may be an emergency call

`clear` is Phone's fact that no call which may be an emergency call is
live. A send whose outcome is unknown is read back instead, including when
the phone can no longer send. A new send seals the draft's saved revision
and waits for any earlier confirmed draft clear. Send goes to the open
conversation's own numbers, exactly as the phone listed them for that
conversation, never to a number typed or named elsewhere. A draft that
dictation made longer than the phone sends in one text is kept whole, and
Send waits until the owner shortens it.

```quint
pure def ready(c: Composer, supported: bool, clear: bool): bool =
  c.thread > 0 and (c.slot.author != Nobody or c.pictures > 0) and P::allows(c.sending)
    and settledDraft(c) and c.slot.draft.base > 0 and (c.sims == 1 or c.sim > 0) and supported and clear

pure def canSend(c: Composer, supported: bool, clear: bool): bool =
  c.pendingClear == noClear
    and (if (S::uncertain(c.outgoing)) clear and c.newSend.revision == 0 else ready(c, supported, clear))
    and S::canSend(c.outgoing, c.thread, c.recipients)

pure def send(c: Composer, supported: bool, clear: bool): Moved =
  val revision = if (S::uncertain(c.outgoing)) c.sendRevision else c.slot.draft.base
  withSend(S::send(c.outgoing, c.thread, c.recipients), { ...c, sendRevision: revision, newSend: noNewSend })
```

### The owner's New message uses the same send and never takes another draft's place

The visible New draft and its exact recipients are reviewed together at
Send. It is held by the same journal as a conversation draft. An uncertain
send is looked up only for the same draft revision and recipients. Sending
New leaves an existing draft for that conversation alone.

```quint
pure def canSendNew(c: Composer, thread: int, recipients: int, visit: int, revision: int, supported: bool, clear: bool): bool =
  c.pendingClear == noClear and c.thread == 0 and visit > 0 and revision > 0 and clear and S::canSend(c.outgoing, thread, recipients)
    and (if (S::uncertain(c.outgoing)) c.newSend.revision == revision and c.outgoing.recipients == recipients
      else supported and P::allows(c.sending))

pure def sendNew(c: Composer, thread: int, recipients: int, visit: int, revision: int, supported: bool, clear: bool): Moved =
  withSend(S::send(c.outgoing, thread, recipients), { ...c, sendRevision: 0, newSend: { visit: visit, revision: revision } })
```

### The phone's first confirmed send receipt marks only its sealed draft revision for clearing

The conversation notes, quietly, that the message was sent, or delivered,
to the person it names. The receipt holds the clear until the phone
acknowledges it, including after a restart.

```quint
pure def sentOff(o: S::Outgoing, c: Composer): Moved =
  val done = { ...c, outgoing: o }
  val fromNew = c.newSend.revision > 0
  val source = if (fromNew) NewMessageDraft else ConversationDraft
  val revision = if (fromNew) c.newSend.revision else c.sendRevision
  val visit = if (fromNew) c.newSend.visit else 0
  if (S::sentAll(o) and not(S::sentAll(c.outgoing)) and revision > 0 and o.thread > 0 and o.op.id > 0
    and o.op.id == c.outgoing.op.id and o.thread == c.outgoing.thread and o.retired < o.op.id)
    { state: { ...done, pendingClear: { source: source, thread: o.thread, revision: revision, id: o.op.id, visit: visit } }, out: List() }
  else { state: done, out: List() }

pure def canJournaled(c: Composer, id: int): bool = S::canJournaled(c.outgoing, id)
pure def journaled(c: Composer, id: int, allowed: bool): Moved = sentOff(S::journaled(c.outgoing, id, allowed), c)

pure def canTransmit(c: Composer, id: int): bool = S::canTransmit(c.outgoing, id)
pure def transmit(c: Composer, id: int): Moved = withSend(S::transmit(c.outgoing, id), c)

pure def canPartSent(c: Composer, id: int): bool = S::canPartSent(c.outgoing, id)
pure def partSent(c: Composer, id: int, ok: bool): Moved = sentOff(S::partSent(c.outgoing, id, ok), c)

pure def canReportArrived(c: Composer, id: int): bool = S::canReportArrived(c.outgoing, id)
pure def reportArrived(c: Composer, id: int): Moved = sentOff(S::reportArrived(c.outgoing, id), c)

pure def canLost(c: Composer): bool = S::canLost(c.outgoing)
pure def lost(c: Composer): Moved = sentOff(S::lost(c.outgoing), c)

pure def canReadBack(c: Composer, id: int): bool = S::canReadBack(c.outgoing, id)
pure def readBack(c: Composer, id: int, wasSent: bool, known: bool): Moved = sentOff(S::readBack(c.outgoing, id, wasSent, known), c)

pure def canRetire(c: Composer, id: int): bool = c.pendingClear == noClear and S::canRetire(c.outgoing, id)
pure def retire(c: Composer, id: int): Moved = withSend(S::retire(c.outgoing, id), c)
```

### The phone clears only the confirmed send's saved revision and acknowledges before the send retires

If clearing fails, the request is kept for retry. The phone can confirm a
clear at the next revision, or report revision zero after checking that the
sent revision is no longer held. In that case the composer leaves any
different draft intact. If the open conversation still shows its replaced
revision, it first closes and reloads the saved draft. Clearing a New draft
keeps its receipt's visit and revision for the New form to reconcile its
own view. Conversation drafts are separate from that form.

```quint
pure def canClearSentDraft(c: Composer): bool = c.pendingClear.id > 0

pure def clearSentDraft(c: Composer): Moved =
  val pending = c.pendingClear
  { state: c, out: List(ClearSentDraft({ source: pending.source, thread: pending.thread, revision: pending.revision, id: pending.id, visit: pending.visit })) }

pure def showsSentDraft(c: Composer, thread: int, revision: int): bool =
  c.thread == thread and c.slot.draft.base == revision and settledDraft(c)

pure def canSentDraftCleared(c: Composer, source: ClearSource, thread: int, revision: int, id: int, landedRevision: int): bool =
  val pending = c.pendingClear
  canClearSentDraft(c) and pending.source == source and pending.thread == thread and pending.revision == revision and pending.id == id
    and (landedRevision == revision + 1
      or (landedRevision == 0 and (source == NewMessageDraft or not(showsSentDraft(c, thread, revision)))))

pure def sentDraftCleared(c: Composer, source: ClearSource, thread: int, revision: int, id: int, landedRevision: int): Composer =
  val clearedSend = { ...c, pendingClear: noClear }
  val draft = c.slot.draft
  if (source == ConversationDraft and landedRevision > 0 and showsSentDraft(c, thread, revision)) {
    { ...clearedSend, slot: { author: Nobody, draft: { ...draft, base: landedRevision } }, pictures: 0, savedPictures: 0,
      saved: c.saved.put(thread, Nobody) }
  } else if (source == ConversationDraft and landedRevision > 0 and c.thread != thread) { ...clearedSend, saved: c.saved.put(thread, Nobody) }
  else clearedSend
```

### Only an exact successful send can owe a clear, and only the phone's answer releases it

```quint
pure def alwaysAClearBelongsToItsConfirmedSend(c: Composer): bool =
  val pending = c.pendingClear
  pending != noClear implies (S::sentAll(c.outgoing) and pending.id > 0
    and pending.id == c.outgoing.op.id and c.outgoing.retired < pending.id
    and pending.thread > 0 and pending.thread == c.outgoing.thread and pending.revision > 0
    and (if (pending.source == NewMessageDraft) pending.revision == c.newSend.revision and pending.visit == c.newSend.visit
      else c.newSend.revision <= 0 and pending.revision == c.sendRevision and pending.visit == 0))

pure def stepOnlyAClearAnswerReleasesTheReceipt(before: Composer, via: str, after: Composer): bool =
  (before.pendingClear != noClear and after.pendingClear == noClear) implies via == "sentDraftCleared"
```

### A new send starts only from the owner's Send

```quint
pure def stepOnlyTheOwnersTapSends(before: Composer, via: str, after: Composer): bool =
  after.outgoing.op.id != before.outgoing.op.id implies (via == "send" or via == "sendNew")

pure def stepNewSendLeavesExistingDraftsAlone(before: Composer, via: str, after: Composer): bool =
  val confirmingNew = before.pendingClear == noClear and after.pendingClear.source == NewMessageDraft and after.pendingClear.id > 0
  val clearingNew = (via == "clearSentDraft" or via == "sentDraftCleared") and before.pendingClear.source == NewMessageDraft
  if (confirmingNew or clearingNew)
    before.newSend == after.newSend and before.saved == after.saved
      and before.slot == after.slot and before.pictures == after.pictures and before.savedPictures == after.savedPictures
  else true
```

### The composer holds at most five pictures and a SIM the phone has

```quint
pure def alwaysTheComposerFits(c: Composer): bool =
  0 <= c.pictures and c.pictures <= maxPictures and c.sims >= 1 and 0 <= c.sim and c.sim <= c.sims
    and 0 <= c.savedPictures and c.savedPictures <= maxPictures
    and 0 <= c.carriedDraft.pictures and c.carriedDraft.pictures <= maxPictures
    and (c.thread == 0 implies (c.pictures == 0 and c.savedPictures == 0))
```

### The send in hand keeps every rule of Sending

Discovered by the proof: the composer keeps the rules of
[Sending](./sending.md) for the send it holds; without them, a send with no
number could be reported sent and write a draft into a closed composer.

```quint
pure def alwaysTheSendKeepsItsRules(c: Composer): bool = and {
  S::alwaysOneRadioCallPerRecipient(c.outgoing),
  S::alwaysADeniedSendUsedNoRadio(c.outgoing),
  S::alwaysTheJournalComesFirst(c.outgoing),
  S::alwaysASendHasAConversation(c.outgoing),
  S::alwaysDeliveredNeedsSentAndReports(c.outgoing),
}
```

### A message with pictures can be sent on a chosen SIM, an unknown send keeps its draft, and a sent one clears it

```quint
pure def sometimesPicturesOnASim(c: Composer): bool = S::busy(c.outgoing) and c.pictures > 0 and c.sim > 1
pure def sometimesUnknownKeepsTheDraft(c: Composer): bool = S::uncertain(c.outgoing) and bound(c) and c.slot.author == AlphaWrote
pure def sometimesSentClearsTheDraft(c: Composer): bool =
  S::sentAll(c.outgoing) and c.thread == c.outgoing.thread and c.slot.author == Nobody and c.pictures == 0
    and settledDraft(c) and c.sendRevision > 0 and c.slot.draft.base == c.sendRevision + 1 and c.pendingClear == noClear
pure def sometimesSentElsewhere(c: Composer): bool = S::sentAll(c.outgoing) and c.thread != c.outgoing.thread and c.thread > 0
```
