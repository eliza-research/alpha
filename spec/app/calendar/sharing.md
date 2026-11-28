# Calendar sharing

What a reviewed read of the phone's calendar may tell the agent, and which
of its Calendar actions the phone offers it. eliza's agent runs each read
and checks what comes back; the approvals area decides whether it runs at
all. Calendar supplies the phone's side: the sheets the owner chooses on,
the read itself, and what Calendar says it shared. Each rule here is a
law on what those give.

## Story: Choose the calendars and see the answer before it is shared

> As the owner, I want to tick the calendars an availability check may
> read, see the exact answer, and never be shown as free when the phone
> could not tell.

### Nothing is ticked at first, and Check is offered for one to sixteen ticked calendars

Calendar names and accounts stay on the phone.

```quint
pure val maxChosen = 16

pure def checkOffered(ticked: int): bool = ticked >= 1 and ticked <= maxChosen

pure def lawNothingTickedChecksNothing(ticked: int): bool = ticked <= 0 implies not(checkOffered(ticked))
```

### The phone can say the owner is free only when every calendar chosen lives on this phone

The freshness of a calendar synced from elsewhere cannot be told, so its
answer is unknown, never free.

```quint
type Answer = Free | Busy | Unknown

pure def availability(everyChosenIsLocal: bool, busyIntervals: int): Answer =
  if (not(everyChosenIsLocal)) Unknown else if (busyIntervals > 0) Busy else Free

pure def lawASyncedCalendarIsNeverFree(busyIntervals: int): bool = availability(false, busyIntervals) == Unknown

pure def lawABusyIntervalIsNeverFree(everyChosenIsLocal: bool, busyIntervals: int): bool =
  busyIntervals > 0 implies availability(everyChosenIsLocal, busyIntervals) != Free
```

### A check is asked only on Home or Calendar, while Alpha can be seen, on a screen that is not sensitive

Anywhere else nothing is asked and nothing is read; Android's access is
asked next, and a refusal reads nothing.

```quint
pure def availabilityAdmitted(homeOrCalendar: bool, sensitive: bool, shown: bool): bool = homeOrCalendar and not(sensitive) and shown

pure def lawElsewhereOrUnseenChecksNothing(sensitive: bool, shown: bool): bool =
  not(availabilityAdmitted(false, sensitive, shown)) and not(availabilityAdmitted(true, true, shown)) and not(availabilityAdmitted(true, sensitive, false))
```

### The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed

Check is the only way from the calendars to a read, the answer is shown
before Share, and Cancel, Back, Home or leaving Home and Calendar closes the
sheet with nothing shared.

```quint
type Checking = Closed | Choosing | Reading | Answered | Sharing
type Availability = { checking: Checking, offered: Set[str], ticked: Set[str], answer: Answer }

pure val initial: Availability = { checking: Closed, offered: Set(), ticked: Set(), answer: Unknown }

pure val calendarValues = Set("a", "b", "c")
pure val calendarsValues = Set(Set(), Set("a"), Set("a", "b"))

pure def canShowCalendars(s: Availability, calendars: Set[str]): bool = s.checking == Closed and calendars.size() > 0

pure def showCalendars(s: Availability, calendars: Set[str]): Availability =
  { checking: Choosing, offered: calendars, ticked: Set(), answer: Unknown }

pure def canTick(s: Availability, calendar: str): bool = s.checking == Choosing and s.offered.contains(calendar)

pure def tick(s: Availability, calendar: str): Availability =
  { ...s, ticked: if (s.ticked.contains(calendar)) s.ticked.exclude(Set(calendar)) else s.ticked.union(Set(calendar)) }

pure def canCheck(s: Availability): bool = s.checking == Choosing and checkOffered(s.ticked.size())

pure def check(s: Availability): Availability = { ...s, checking: Reading }

pure def canAnswered(s: Availability, answer: Answer): bool = s.checking == Reading and answer != Unknown

pure def answered(s: Availability, answer: Answer): Availability = { ...s, checking: Answered, answer: answer }

pure def canShare(s: Availability): bool = s.checking == Answered

pure def share(s: Availability): Availability = { ...s, checking: Sharing }

pure def canClose(s: Availability): bool = s.checking != Closed

pure def close(s: Availability): Availability = initial

pure def alwaysOnlyTickedOfferedCalendarsAreRead(s: Availability): bool =
  s.ticked.subseteq(s.offered)
    and ((s.checking == Reading or s.checking == Answered or s.checking == Sharing) implies checkOffered(s.ticked.size()))

pure def alwaysOnlyAFreeOrBusyAnswerIsShown(s: Availability): bool =
  (s.checking == Answered or s.checking == Sharing) iff s.answer != Unknown

pure def sometimesAnAnswerIsShared(s: Availability): bool = s.checking == Sharing
```

## Story: Let a reviewed step read my phone's calendars for the range I approved

> As the owner, I want an approved step to read only the calendars and
> dates I reviewed, only titles and times, and nothing when the phone could
> not read them all.

### A range is read only while Calendar can be seen and Android lets it read the calendar

A hidden page, a locked screen, or access Android refused starts nothing.

```quint
pure def rangeAdmitted(shown: bool, access: bool): bool = shown and access

pure def lawUnseenOrRefusedReadsNothing(shown: bool, access: bool): bool =
  not(rangeAdmitted(false, access)) and not(rangeAdmitted(shown, false))
```

### Only a whole read within the step's limit is shared, with titles and times alone

A read the phone cut short or refused, more events than the step allows,
or a result eliza does not admit shares nothing. Places, notes and guests
never leave the phone.

```quint
type Range = Shared | TooMany | Incomplete | Unavailable | Unverified

pure def rangeOutcome(readOk: bool, whole: bool, events: int, maximum: int, admitted: bool): Range =
  if (not(readOk)) Unavailable
  else if (not(whole)) Incomplete
  else if (events > maximum) TooMany
  else if (not(admitted)) Unverified
  else Shared

pure val eventsValues = Set(0, 1, 201)
pure val maximumValues = Set(1, 200)

pure def lawACutShortReadSharesNothing(events: int, maximum: int, admitted: bool): bool =
  rangeOutcome(true, false, events, maximum, admitted) != Shared

pure def lawOverTheLimitSharesNothing(maximum: int, admitted: bool): bool =
  rangeOutcome(true, true, maximum + 1, maximum, admitted) != Shared
```

### An event is in the range when its time overlaps it; one without length when it begins inside

An all-day event's dates are taken as the same dates in the step's time
zone.

```quint
pure def overlaps(begins: int, ends: int, start: int, end: int): bool =
  if (begins == ends) begins >= start and begins < end else begins < end and ends > start

pure val beginsValues = Set(0, 5, 10)
pure val endsValues = Set(0, 5, 10)
pure val startValues = Set(5)
pure val endValues = Set(10)

pure def lawEndingAsTheRangeStartsIsOutside(begins: int): bool = begins < 5 implies not(overlaps(begins, 5, 5, 10))
```

## Story: Be told plainly what the agent was shown of an event I named

> As the owner, I want the agent's reply about an event I named to say it
> was shared only when it was, and otherwise why not, and a change I named
> to touch only the event I have open.

### What Calendar tells the agent says shared exactly when the event was shared, and otherwise why not

The event must be open, unchanged since it was shown, and called what the
owner said; the owner can cancel the phone's Share review.

```quint
type Named = NamedShared | NotOpen | Changed | NameDiffers | Cancelled | NamedUnavailable
type Said = SaysShared | SaysOpenIt | SaysItChanged | SaysTheNameDiffers | SaysNotShared

pure def said(result: Named): Said =
  match result {
    | NamedShared => SaysShared
    | NotOpen => SaysOpenIt
    | Changed => SaysItChanged
    | NameDiffers => SaysTheNameDiffers
    | _ => SaysNotShared
  }

pure def lawSaysSharedOnlyWhenShared(result: Named): bool = (said(result) == SaysShared) iff (result == NamedShared)
```

### The phone's Share review is offered only for the event open on a Calendar screen that is not sensitive

```quint
pure def shareOffered(onCalendar: bool, sensitive: bool, selected: bool): bool = onCalendar and not(sensitive) and selected

pure def lawASensitiveScreenSharesNothing(onCalendar: bool, selected: bool): bool = not(shareOffered(onCalendar, true, selected))
```

### A change or deletion of an event the owner named is asked only for the open event, and only when its title is that name

Titles are compared trimmed, with runs of spaces folded and case folded;
the phone still checks the event's revision before anything is written.

```quint
pure def namedChangeAllowed(selected: bool, titleMatches: bool): bool = selected and titleMatches

pure def lawAnotherEventIsNeverChanged(selected: bool, titleMatches: bool): bool =
  not(namedChangeAllowed(selected, false)) and not(namedChangeAllowed(false, titleMatches))
```

## Story: Delete only after I said yes

> As the owner, I want a deletion the agent asked me about to go ahead only
> when my own reply was yes, and a no never to be overridden.

### Only the owner's first reply after the question counts, and only a yes or the event's whole title is a yes

A reply that asks something back is never a yes, and nothing the agent
plans afterwards can delete over a no.

```quint
type Reply = Yes | Title | No | Question | Other

pure def deleteConfirmed(firstReply: bool, reply: Reply, targetMatches: bool): bool =
  firstReply and (reply == Yes or reply == Title) and targetMatches

pure def lawANoNeverDeletes(firstReply: bool, targetMatches: bool): bool =
  not(deleteConfirmed(firstReply, No, targetMatches)) and not(deleteConfirmed(firstReply, Question, targetMatches))
```

## Story: Offer the agent only the Calendar actions this phone runs

> As the owner, I want the agent to ask only for the Calendar actions my
> phone can review and carry out, so it never offers one that would fail.

### A local event is always offered; the agenda read only in a browser; every other action only when the agent offers it

On the phone the agent reads the phone's own calendar through the next
event and range reads, so the agenda read is a browser's alone.

```quint
type Action = LocalEvent | AgendaRead | CreateOnPhone | NextRead | AvailabilityRead | NamedRead

pure def advertised(offer: Action, offered: bool, browser: bool): bool =
  if (offer == LocalEvent) true else if (offer == AgendaRead) offered and browser else offered

pure def lawTheAgendaReadOnlyInABrowser(offered: bool): bool = not(advertised(AgendaRead, offered, false))

pure def lawNothingUnofferedIsAdvertised(browser: bool): bool =
  not(advertised(CreateOnPhone, false, browser)) and not(advertised(NamedRead, false, browser))
```
