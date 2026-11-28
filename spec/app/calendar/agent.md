# The agent's calendar

What the resident agent may do with the owner's Google Calendar. It reads
events and asks about free time whenever it likes. It creates, changes or
deletes an event, or answers an invitation, only after the owner approves a
card that shows exactly that change, every field of it; one change is under way at a time; what it changed is read
back before the agent is told it is done. A calendar someone else manages
refuses deletes and changes to a whole series. The
[calendar](./index.md) shows what the agent's calendar holds.

## Story: Let the agent read my calendar

> As the owner, I want my agent to read my calendar and find free time
> without asking me each time, since reading changes nothing.

### The agent's calendar holds the agent's last read, the one change under way with its card, the write that carries it, and how it ended

The owner approves, the agent asks and proposes, and Google (the world)
answers. A change names the request the agent filed for it, the event and
the revision of it the agent selected, the answer it gives an invitation,
whether its card shows every field the change would set, and whether the
card shows the event again after a change in Google.

```quint
import read as R from "../../kit/read"
import review as V from "../../kit/review"
import attempt as A from "../../kit/attempt"

type Actor = Owner | Agent | World
type Query = Events | FreeTime
type Change = Create | Update | Delete | Respond
type Reply = NoReply | Going | Maybe | NotGoing
type Stage = Idle | Awaiting | Sending | ReadingBack
type Result = NoResult | Done | NotFound | Refused | InDoubt | Declined | Withdrawn | DeletedByReceipt | Unverified

type AgentCalendar = {
  feed: R::Read, query: Query,
  stage: Stage, change: Change, reply: Reply, complete: bool, filing: int, id: int, series: bool, managed: bool, bound: int, revision: int,
  updated: bool, card: V::Review, write: A::Attempt, check: R::Read, result: Result,
}

type Effect =
  | Ask({ ticket: int, query: Query })
  | Send({ attempt: int, filing: int, change: Change, reply: Reply, id: int, series: bool, revision: int })
  | Reject({ filing: int })
  | ReadBack({ ticket: int, id: int, filing: int })
  | Report({ result: Result })

type Acted = { state: AgentCalendar, out: List[Effect] }

pure val initial: AgentCalendar = {
  feed: R::unread, query: Events,
  stage: Idle, change: Create, reply: NoReply, complete: false, filing: 0, id: 0, series: false, managed: false, bound: 0, revision: 0,
  updated: false, card: V::unreviewed, write: A::plan(0), check: R::unread, result: NoResult,
}

pure val filingValues = Set(1, 2)
pure val idValues = Set(0, 1)
pure val revisionValues = Set(0, 1, 2)
pure val ticketValues = Set(1, 2, 3, 4, 5, 6)
pure val attemptValues = Set(1, 2, 3, 4, 5, 6)

pure def inFlight(s: AgentCalendar): bool = A::canConclude(s.write, s.write.id)
```

### The agent reads events or free time directly, at any moment, and only the newest answer counts

Free time is what the events of the window read leave open, so both reads
read the agent's calendar feed for the week from today.

```quint
pure def canRead(s: AgentCalendar, by: Actor): bool = by == Agent

pure def read(s: AgentCalendar, query: Query, by: Actor): Acted =
  val asked = R::ask(s.feed)
  { state: { ...s, feed: asked, query: query }, out: List(Ask({ ticket: asked.ticket, query: query })) }

pure def canFeedAnswered(s: AgentCalendar, ticket: int, by: Actor): bool = by == World and R::canAnswer(s.feed, ticket)

pure def feedAnswered(s: AgentCalendar, ticket: int, ok: bool, by: Actor): AgentCalendar = { ...s, feed: R::answer(s.feed, ok) }
```

### The agent can read while a card waits for the owner

```quint
pure def sometimesReadWhileACardWaits(s: AgentCalendar): bool = s.stage == Awaiting and s.feed.status == R::Loaded and s.query == FreeTime
```

## Story: Approve what the agent changes

> As the owner, I want every event my agent creates, changes or deletes to
> wait for my approval on a card that shows exactly that change, and my
> approval to apply only to what the card showed.

### The agent proposes one change at a time, for the revision of the event it selected, and the card shows it

A new event names no event; a change, a delete or an answer to an
invitation names one. Only an answer to an invitation says Going, Maybe or
No.

The agent files each change as a request in its approvals list, which
Calendar reads whenever it reads the day; the oldest pending Calendar
request is proposed while no change is under way. The card shows the
change as the request holds it: the title, the day and times with their
time zone, the place, the calendar, the people and that no invitations are
sent unless the request says so, all day, and this occurrence or every one.
Its heading names the change as Sunday's v119 did: Add event for a new
event and Change event for a change.
A request gone from the list is withdrawn; a new revision of the same
request is a change of its event. What a read of the list finds counts
only for the card it was read for: an answer that comes back after that
card ended, or after another card took its place, neither revises nor
completes the card shown then. A card waits until the owner answers it, as
Sunday's v119 kept each request's card until it was answered: leaving
Calendar, Back, a hidden page or a locked screen leave it waiting, in
Calendar and under the reply that filed it. A card shows only with the
request Calendar read for it: a changed owner drops the requests Calendar
read, so a card still waiting for them ends unsent and the list is read
again at once. Each read of the list is for the owner Calendar last read
when it began, signed out counting as one: its answer is refused if
Calendar has read another since, so a read begun for one owner never shows
that owner's requests once Calendar holds another, or no one. A change the
owner declined, the agent withdrew or Google refused reads the list again at once, so the next
pending request's card shows without waiting for Calendar's next read; the
request just declined is not proposed again while its decline is on its
way to the agent.

```quint
pure def readsRequestsAgain(result: Result): bool = result == Declined or result == Withdrawn or result == Refused

pure def lawAnEndedCardMakesWayForTheNext(change: Change): bool =
  readsRequestsAgain(Declined) and readsRequestsAgain(Withdrawn) and readsRequestsAgain(Refused) and not(readsRequestsAgain(NoResult))
```

```quint
pure def canPropose(s: AgentCalendar, change: Change, reply: Reply, complete: bool, filing: int, id: int, series: bool, managed: bool, revision: int, by: Actor): bool =
  by == Agent and s.stage == Idle and revision >= 0 and filing > 0
    and (if (change == Create) id == 0 else id > 0)
    and ((change == Respond) iff (reply != NoReply))
    and (managed implies (change != Delete and not(series)))

pure def propose(s: AgentCalendar, change: Change, reply: Reply, complete: bool, filing: int, id: int, series: bool, managed: bool, revision: int, by: Actor): AgentCalendar =
  { ...s, stage: Awaiting, change: change, reply: reply, complete: complete, filing: filing, id: id, series: series, managed: managed, bound: revision, revision: revision,
    updated: false, card: V::present(V::revise(s.card)), result: NoResult }
```

### A card that leaves out a field its change would set can be declined, never approved

The title, the day and times with their time zone, the place, the
calendar, the occurrences and the answer to an invitation are each shown
when the change sets them. A change Alpha cannot show whole waits for the
owner to decline it, or for the agent to withdraw it.

```quint
pure def alwaysOnlyAWholeCardIsApproved(s: AgentCalendar): bool =
  (s.stage == Sending or s.stage == ReadingBack) implies s.complete

pure def sometimesAPartialCardWaits(s: AgentCalendar): bool = s.stage == Awaiting and not(s.complete) and V::canConfirm(s.card)
```

### An invitation is answered Going, Maybe or No only through its card

```quint
pure def alwaysOnlyAnAnswerCarriesAReply(s: AgentCalendar): bool =
  s.stage != Idle implies ((s.change == Respond) iff (s.reply != NoReply))

pure def sometimesAnInvitationAnswered(s: AgentCalendar): bool = s.result == Done and s.change == Respond and s.reply == Maybe
```

### A calendar someone else manages is never asked to delete an event or change a whole series

```quint
pure def alwaysAManagedCalendarKeepsItsEventsAndSeries(s: AgentCalendar): bool =
  (s.stage != Idle and s.managed) implies (s.change != Delete and not(s.series))
```

### When the event changes in Google, the card waiting for the owner no longer counts

```quint
pure def canEventChanged(s: AgentCalendar, revision: int, by: Actor): bool = by == World and revision > s.revision

pure def eventChanged(s: AgentCalendar, revision: int, by: Actor): AgentCalendar =
  { ...s, revision: revision, card: if (s.stage == Awaiting and s.change != Create) V::revise(s.card) else s.card }
```

### A card voided by a change in Google is shown again at the event's new revision, marked updated

The change is checked again against the event as it now is, so its card is
whole only if it still is.

```quint
pure def canShowUpdated(s: AgentCalendar, complete: bool, by: Actor): bool =
  by == World and s.stage == Awaiting and not(V::canConfirm(s.card))

pure def showUpdated(s: AgentCalendar, complete: bool, by: Actor): AgentCalendar =
  { ...s, bound: s.revision, complete: complete, updated: true, card: V::present(s.card) }

pure def sometimesAnUpdatedCardApproved(s: AgentCalendar): bool = s.stage == Sending and s.updated
```

### A card the owner can still approve shows the event at the revision it now has

A card never shows a version of the change newer than the change itself.
Discovered by the proof: without it, a change in Google could leave a card
approvable.

```quint
pure def alwaysAnApprovableCardShowsTheEventAsItIs(s: AgentCalendar): bool =
  s.card.shown <= s.card.revision
    and ((s.stage == Awaiting and V::canConfirm(s.card) and s.change != Create) implies s.bound == s.revision)
```

### Only the owner approves, and approving sends the change once, under a new number

An approval names the request its card shows, so it approves nothing once
the calendar holds another request.

```quint
pure def canApprove(s: AgentCalendar, filing: int, by: Actor): bool =
  by == Owner and s.stage == Awaiting and V::canConfirm(s.card) and s.complete and filing == s.filing

pure def approve(s: AgentCalendar, filing: int, by: Actor): Acted =
  val w = A::dispatch(A::record(A::plan(s.write.id + 1)))
  { state: { ...s, stage: Sending, card: V::confirm(s.card), write: w },
    out: List(Send({ attempt: w.id, filing: s.filing, change: s.change, reply: s.reply, id: s.id, series: s.series, revision: s.bound })) }
```

### The request is read again at the tap; a newer revision is shown as updated, and nothing is sent

Approving reads the agent's request again before the agent is asked to
make it. Where the request or its event moved on since the card showed it,
the approval is spent unsent and the card shows the change again at its
new revision, marked updated, for the owner to approve or decline once
more. A decision whose answer was lost is never sent again. Approving is
for the owner Calendar last read when the tap began, signed out counting as
one: if Calendar has read another by the time the agent would be asked,
nothing is sent and the card ends quietly, as one the agent withdrew, with
no words for the owner Calendar holds now; the request stays the agent's.

```quint
pure def canStaleAtTap(s: AgentCalendar, attempt: int, revision: int, complete: bool, by: Actor): bool =
  by == World and s.stage == Sending and A::canConclude(s.write, attempt) and revision > s.revision

pure def staleAtTap(s: AgentCalendar, attempt: int, revision: int, complete: bool, by: Actor): AgentCalendar =
  { ...s, write: A::conclude(s.write, false, true), stage: Awaiting, revision: revision, bound: revision, complete: complete,
    updated: true, card: V::present(V::revise(s.card)) }

pure def sometimesStaleAtTap(s: AgentCalendar): bool = s.stage == Awaiting and s.updated and s.write.outcome == A::Refused

pure def canOwnerChangedAtTap(s: AgentCalendar, attempt: int, by: Actor): bool =
  by == World and s.stage == Sending and A::canConclude(s.write, attempt)

pure def ownerChangedAtTap(s: AgentCalendar, attempt: int, by: Actor): Acted =
  { state: { ...s, write: A::conclude(s.write, false, true), stage: Idle, card: V::dismiss(s.card), result: Withdrawn },
    out: List(Report({ result: Withdrawn })) }
```

### The owner declines, or the agent withdraws, and nothing is sent

A decline tells the agent to drop its request; nothing reaches the
calendar. Like an approval, it names the request its card shows.

```quint
pure def canDecline(s: AgentCalendar, filing: int, by: Actor): bool = by == Owner and s.stage == Awaiting and filing == s.filing

pure def decline(s: AgentCalendar, filing: int, by: Actor): Acted =
  { state: { ...s, stage: Idle, card: V::dismiss(s.card), result: Declined }, out: List(Reject({ filing: s.filing }), Report({ result: Declined })) }

pure def canWithdraw(s: AgentCalendar, by: Actor): bool = by == Agent and s.stage == Awaiting

pure def withdraw(s: AgentCalendar, by: Actor): Acted =
  { state: { ...s, stage: Idle, card: V::dismiss(s.card), result: Withdrawn }, out: List(Report({ result: Withdrawn })) }
```

### What is sent is exactly the change approved, for the revision the agent selected

```quint
pure def stepSendsWhatWasApproved(before: AgentCalendar, via: str, after: AgentCalendar, out: List[Effect]): bool =
  out.every(e => match e {
    | Send(x) => via == "approve" and V::canConfirm(before.card) and before.complete and x.filing == before.filing and x.change == before.change
        and x.reply == before.reply and x.id == before.id and x.series == before.series and x.revision == before.bound and x.attempt == before.write.id + 1
    | Reject(x) => via == "decline" and x.filing == before.filing
    | _ => true
  })
```

### One change is under way at a time: a card waits, a write is in flight, or its result is read back

A change being read back is one Google confirmed, and no result is
reported while a change is under way. Discovered by the proof: without
them, a change could be reported done before it was confirmed.

```quint
pure def alwaysOneChangeAtATime(s: AgentCalendar): bool =
  (s.stage == Awaiting iff s.card.showing)
    and (s.stage == Sending iff inFlight(s))
    and (s.stage == ReadingBack implies (s.check.status == R::Loading and s.write.outcome == A::Confirmed))
    and (s.stage != Idle implies s.result == NoResult)
```

### A card can be voided by a change in Google, and a change to a managed calendar approved

```quint
pure def sometimesACardVoided(s: AgentCalendar): bool = s.stage == Awaiting and not(V::canConfirm(s.card))

pure def sometimesAManagedChangeSent(s: AgentCalendar): bool = s.stage == Sending and s.managed and s.change == Update
```

### The owner can decline

```quint
pure def sometimesDeclined(s: AgentCalendar): bool = s.result == Declined and s.write.id == 0
```

### The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken

A reply whose Calendar action filed a request shows
the card in Ask Alpha, below that reply, whether the owner typed or
talked: the same card as in Calendar, with the same Approve and Decline,
so the owner approves where they asked and never has to open Calendar to
find it. Which replies filed a request is read from the Calendar action's
own result, never from the owner's words. While a change is under way its
card stays at the foot of each conversation where a reply filed one. Once
it ends, how it ended shows under the reply that filed it, as Sunday's v119
showed each request on its own reply's card, so it never reads as a later
reply's outcome, until the owner asks something else.

The card at the foot of a conversation is bound to the request the
calendar holds: it shows, and its Approve and Decline act, only while that
request is one a reply of this conversation filed. While the calendar holds a request no
reply here filed, no card shows here, so nothing here approves or declines
it. When two replies here filed requests, the card shows the one the
calendar holds, then the next once that one ends.

```quint
type InAskAlpha = NothingToShow | ChangeUnderWay | ChangeEnded

pure def inAskAlpha(s: AgentCalendar, filedByAReply: bool): InAskAlpha =
  if (s.stage != Idle) ChangeUnderWay
  else if (filedByAReply and s.result != NoResult and s.result != Withdrawn) ChangeEnded
  else NothingToShow

pure def shownInAskAlpha(shown: InAskAlpha, filedHere: bool, latestReply: bool): bool =
  filedHere and (shown == ChangeUnderWay or (shown == ChangeEnded and latestReply))

pure def lawACardUnderWayShowsWhereItWasAsked(latestReply: bool): bool = shownInAskAlpha(ChangeUnderWay, true, latestReply)

pure def lawNoCardShowsWhereNoReplyFiledTheRequestHeld(shown: InAskAlpha, latestReply: bool): bool = not(shownInAskAlpha(shown, false, latestReply))

pure def lawACardDecidesOnlyTheRequestItShows(s: AgentCalendar, filing: int): bool =
  (canApprove(s, filing, Owner) or canDecline(s, filing, Owner)) implies filing == s.filing

pure def lawAnEndedChangeLeavesWithTheNextQuestion(filedHere: bool): bool = not(shownInAskAlpha(ChangeEnded, filedHere, false))
```

## Story: Know what the agent's change did

> As the owner, I want the agent told a change is done only once it is seen
> in my calendar, and a change whose outcome is unknown never sent again on
> its own.

### A change Google confirms is read back; a refused or unknown one ends there and is reported

```quint
pure def canSent(s: AgentCalendar, attempt: int, by: Actor): bool = by == World and A::canConclude(s.write, attempt)

pure def sent(s: AgentCalendar, attempt: int, confirmed: bool, known: bool, by: Actor): Acted =
  val w = A::conclude(s.write, confirmed, known)
  val asked = R::ask(s.check)
  val result = if (w.outcome == A::Refused) Refused else InDoubt
  if (w.outcome == A::Confirmed)
    { state: { ...s, write: w, stage: ReadingBack, check: asked }, out: List(ReadBack({ ticket: asked.ticket, id: s.id, filing: s.filing })) }
  else { state: { ...s, write: w, stage: Idle, result: result }, out: List(Report({ result: result })) }
```

### The read back says whether the change is there as approved, and the agent is told

The read back reads the calendar the receipt names, over the window around
the event's own day. A new event is there when an event of that calendar
has every field the card showed: its title, start, end, all day and place.
A change is there when the event it named has every field the change set;
an answer when the owner's own reply is the one given. A deletion is there
unless the event is still found at the version the owner reviewed: gone,
or at its receipt's `deleted:` version, it is deleted. `asAsked` is that
comparison: for a deletion, that the reviewed version is still there.

```quint
pure def seen(change: Change, asAsked: bool): bool = if (change == Delete) not(asAsked) else asAsked

pure def canReadBack(s: AgentCalendar, ticket: int, by: Actor): bool = by == World and s.stage == ReadingBack and R::canAnswer(s.check, ticket)

pure def readBack(s: AgentCalendar, ticket: int, asAsked: bool, by: Actor): Acted =
  val found = seen(s.change, asAsked)
  val result = if (found) Done else NotFound
  { state: { ...s, check: R::answer(s.check, found), stage: Idle, result: result }, out: List(Report({ result: result })) }
```

### A restart drops a waiting card, counts a write in flight as unknown, and reads back again

```quint
pure def canRestart(s: AgentCalendar, by: Actor): bool = by == World

pure def restart(s: AgentCalendar, by: Actor): Acted =
  val asked = R::ask(s.check)
  if (s.stage == Awaiting)
    { state: { ...s, stage: Idle, card: V::dismiss(s.card), result: Withdrawn }, out: List(Report({ result: Withdrawn })) }
  else if (s.stage == Sending)
    { state: { ...s, stage: Idle, write: A::conclude(s.write, false, false), result: InDoubt }, out: List(Report({ result: InDoubt })) }
  else if (s.stage == ReadingBack)
    { state: { ...s, check: asked }, out: List(ReadBack({ ticket: asked.ticket, id: s.id, filing: s.filing })) }
  else { state: s, out: List() }
```

### A read back that fails leaves a confirmed deletion deleted by its receipt, and any other change sent but unverified

A deletion Google confirmed is never reported as an event Calendar could
not look up: its receipt, `calendar.event.deleted` at `deleted:<etag>` of
the event as read before, says it is gone. A create, a change or an answer
whose read back failed is said to be sent, never saved.

```quint
pure def canReadBackFailed(s: AgentCalendar, ticket: int, by: Actor): bool = by == World and s.stage == ReadingBack and R::canAnswer(s.check, ticket)

pure def readBackFailed(s: AgentCalendar, ticket: int, by: Actor): Acted =
  val result = if (s.change == Delete) DeletedByReceipt else Unverified
  { state: { ...s, check: R::answer(s.check, false), stage: Idle, result: result }, out: List(Report({ result: result })) }

pure def alwaysDeletedByReceiptOnlyWhenConfirmed(s: AgentCalendar): bool =
  (s.result == DeletedByReceipt or s.result == Unverified) implies (s.write.outcome == A::Confirmed and s.check.status == R::Failed)

pure def sometimesDeletedByReceipt(s: AgentCalendar): bool = s.result == DeletedByReceipt

pure def sometimesUnverified(s: AgentCalendar): bool = s.result == Unverified and s.change == Respond
```

### The agent is told a change is done only after Google confirmed it and it was read back

```quint
pure def alwaysDoneOnlyAfterReadBack(s: AgentCalendar): bool =
  s.result == Done implies (s.check.status == R::Loaded and s.write.outcome == A::Confirmed)
```

### The agent is told once, when its change ends

```quint
pure def stepToldWhenAChangeEnds(before: AgentCalendar, after: AgentCalendar, out: List[Effect]): bool =
  out.every(e => match e {
    | Report(r) => before.stage != Idle and after.stage == Idle and r.result == after.result
    | _ => true
  })
```

### An approved change is reported in the end, or shown again updated if it moved on

Google's answers to the write and to the read back are not put off for
ever; a restart may come between them.

```quint
pure def leadsToAnApprovedChangeIsReported(s: AgentCalendar, later: AgentCalendar): bool =
  (s.stage == Sending or s.stage == ReadingBack) implies (later.stage == Idle or (later.stage == Awaiting and later.updated))

pure val fair_sent = "weak"
pure val fair_readBack = "weak"
```

### A change can be done, missing from the read back, or in doubt

```quint
pure def sometimesDone(s: AgentCalendar): bool = s.result == Done and s.change == Delete

pure def sometimesNotFound(s: AgentCalendar): bool = s.result == NotFound

pure def sometimesInDoubt(s: AgentCalendar): bool = s.result == InDoubt and s.write.outcome == A::Unknown
```

## Story: Read where a Calendar request stands

> As the owner, I want a request's card to say whether it waits for me, was
> declined, expired or may not have been applied, and to be offered for
> approval only when Alpha could check exactly what it would change.

### The status follows the request's state and whether its owner was verified

The approvals area keeps the request; its card says Waiting for you,
Expired, Approval unavailable, Retryable, Declined, Closed or Not
confirmed, and a request it cannot find is unavailable.

```quint
type RequestState = RequestPending | RequestExpired | RequestRetryable | RequestRejected | RequestDone | RequestFailed
type RequestStatus = StatusUnavailable | StatusExpired | StatusAwaiting | StatusApprovalUnavailable | StatusRetryable
  | StatusDeclined | StatusClosed | StatusNotConfirmed

pure def requestStatus(found: bool, verified: bool, request: RequestState): RequestStatus =
  if (not(found)) StatusUnavailable
  else if (request == RequestExpired) StatusExpired
  else if (request == RequestPending) (if (verified) StatusAwaiting else StatusApprovalUnavailable)
  else if (request == RequestRetryable) StatusRetryable
  else if (request == RequestRejected) StatusDeclined
  else if (request == RequestDone) StatusClosed
  else StatusNotConfirmed

pure def lawUnverifiedIsNeverAwaiting(request: RequestState): bool = requestStatus(true, false, request) != StatusAwaiting
```

### A card is complete only with known fields, a valid time and, for a change, a verified target

A change, a deletion or an answer is verified only when exactly one
calendar and one event match it, the event still starts when the request
says, and it still has the version the request was made against; an event
outside the window read is verified by one read of its own calendar at its
start. The card's `complete` is this.

```quint
pure def targetVerified(sources: int, events: int, startMatches: bool, versionMatches: bool): bool =
  sources == 1 and events == 1 and startMatches and versionMatches

pure def cardComplete(change: Change, onlyKnownFields: bool, verified: bool, timeValid: bool): bool =
  onlyKnownFields and timeValid and (change == Create or verified)

pure def lawAnUnverifiedChangeIsIncomplete(onlyKnownFields: bool, timeValid: bool): bool =
  not(cardComplete(Update, onlyKnownFields, false, timeValid)) and not(cardComplete(Delete, onlyKnownFields, false, timeValid))

pure def lawTwoMatchesNeverVerify(startMatches: bool, versionMatches: bool): bool =
  not(targetVerified(1, 2, startMatches, versionMatches)) and not(targetVerified(2, 1, startMatches, versionMatches))
```

### Only a change the calendar applied refreshes Calendar and Home

A declined or withdrawn card, a refused or doubtful write and a change
read back missing refresh nothing.

```quint
pure def refreshes(result: Result): bool = result == Done or result == DeletedByReceipt or result == Unverified

pure def lawADeclinedCardRefreshesNothing(change: Change): bool = not(refreshes(Declined)) and not(refreshes(Withdrawn)) and not(refreshes(Refused))
```
