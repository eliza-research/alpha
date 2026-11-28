# Calendar deletions

A deletion the owner reviewed and confirmed is held for a moment, with Undo
on a notice, before the [editor](./editor.md) sends it; meanwhile its event
is hidden.
The Undo notice belongs to the [notices](../notices/) area; the
[calendar](./index.md) leaves out the events this hides.

## Story: Undo a deletion before it is sent

> As the owner, I want a deletion I confirmed held for a moment with Undo,
> sent once I leave or the moment passes, and never sent for an account I
> am no longer signed in to.

### Deletions hold the owner they are for, the deletion under review, the one waiting with its Undo window and whether its notice shows, the one being sent, and the one sent that a read has yet to confirm

An event is named by its number, and 0 is none. An occurrence of a
repeating event on the phone is an event of its own, named by its series
and its start. Alpha keeps each event's number on the phone with the event
it names, for the phone's events and the agent's alike, so an event keeps
its number across a restart and no other event is ever given it: a
deletion, or a form of the [editor](./editor.md), kept across a restart is
for the event it was for. The number of an event long unseen may be let
go, and then names no event. Where the phone cannot read the numbers Alpha
kept, nothing kept under them is let go, it numbers apart from every other
start, and Alpha reads them again at its next start; kept numbers that are
not whole numbers held exactly are set aside, never numbered on from. A
deletion reaches its event, the series from this occurrence on, or the
whole series, as the owner chose, at the revision the owner confirmed it
from; the occurrences of a repeating event
on the phone share one revision, counted from the series' title, place, notes
and whether it is all day, and not from when they fall: moving the series
leaves it as it was, and the phone itself refuses to delete an occurrence
that is no longer where the owner confirmed it. It also holds Android's
timeout scale, a percentage never under a hundred, whether a restart paused
it, and the event a deletion was dropped or refused for, and whether it was
refused because the event changed, so the owner is told it was not deleted
and why. Times are milliseconds, passed in by the shell.

```quint
import undo as U from "../../kit/undo"

type Reach = OneEvent | FromThisOn | WholeSeries

type Deletions = {
  owner: int, asked: int, askedReach: Reach, askedRevision: int,
  waiting: int, reach: Reach, revision: int, undo: U::Undo, notice: bool, scale: int, paused: bool,
  sending: int, sendingReach: Reach, hiding: int, hidingReach: Reach, dropped: int, failed: int, changed: bool,
}

type Effect = Release({ id: int, reach: Reach, revision: int })

type Step = { state: Deletions, out: List[Effect] }

pure val initial: Deletions = {
  owner: 0, asked: 0, askedReach: OneEvent, askedRevision: 0,
  waiting: 0, reach: OneEvent, revision: 0, undo: U::free, notice: false, scale: 100, paused: false,
  sending: 0, sendingReach: OneEvent, hiding: 0, hidingReach: OneEvent, dropped: 0, failed: 0, changed: false,
}

pure val undoWindow = 10000

pure val idValues = Set(1, 2)
pure val revisionValues = Set(0, 1)
pure val nowValues = Set(0, 6000, 12000, 25000)
pure val ownerValues = Set(0, 1, 2)
pure val scaleValues = Set(100, 200)

pure def hidden(id: int, s: Deletions): bool = id > 0 and (id == s.waiting or id == s.sending or id == s.hiding)
```

### A deletion hides its event, the series from this occurrence on, or the whole series, and only rows of the same source

```quint
pure def rowHidden(reach: Reach, sameEvent: bool, sameSeries: bool, notBefore: bool, sameSource: bool): bool =
  sameSource and (sameEvent or (sameSeries and (reach == WholeSeries or (reach == FromThisOn and notBefore))))

pure def lawOtherSourcesStayVisible(reach: Reach, sameEvent: bool, sameSeries: bool, notBefore: bool): bool =
  not(rowHidden(reach, sameEvent, sameSeries, notBefore, false))

pure def lawEarlierOccurrencesStayForFromThisOn(sameSource: bool): bool =
  not(rowHidden(FromThisOn, false, true, false, sameSource))
```

### The Undo window is ten seconds, scaled by Android's timeout setting

```quint
pure def canScaleChanged(s: Deletions, scale: int): bool = scale >= 100 and scale != s.scale

pure def scaleChanged(s: Deletions, scale: int): Deletions = { ...s, scale: scale }

pure def windowOf(scale: int): int = undoWindow * scale / 100

pure def lawTheWindowIsNeverShorterThanTenSeconds(scale: int): bool = scale >= 100 implies windowOf(scale) >= undoWindow
```

### Delete asks first, over the open event: what goes, from which calendar, when, which occurrences, and that no guest is told

Delete, or Decline for an invitation the owner was asked to, opens a
review of the event shown: "Delete event?" or "Decline invitation?", its
title, its calendar, its interval and the occurrences it reaches, and "No
guest notification will be sent." Deleting one event with no guests, a
single occurrence of a series included, gets the shorter review, Yes or No
with "Undo available for 10 seconds". No keeps the event; another owner
signing in, a restart or leaving Calendar closes the review unsent.

```quint
pure def canAskDelete(s: Deletions, id: int, reach: Reach, revision: int): bool =
  id > 0 and revision >= 0 and s.asked == 0 and not(hidden(id, s)) and s.sending == 0 and not(s.paused)

pure def askDelete(s: Deletions, id: int, reach: Reach, revision: int): Deletions =
  { ...s, asked: id, askedReach: reach, askedRevision: revision }

pure def canKeepEvent(s: Deletions): bool = s.asked != 0

pure def keepEvent(s: Deletions): Deletions = { ...s, asked: 0 }

pure def shortReview(reach: Reach, guests: int): bool = reach == OneEvent and guests == 0

pure def lawASeriesAlwaysGetsTheFullReview(guests: int): bool = not(shortReview(WholeSeries, guests)) and not(shortReview(FromThisOn, guests))

pure def lawAGuestAlwaysGetsTheFullReview(reach: Reach): bool = not(shortReview(reach, 1))

pure def alwaysTheReviewedEventShows(s: Deletions): bool = s.asked >= 0 and (s.asked != 0 implies not(hidden(s.asked, s)))

pure def sometimesReviewedBesideAWaitingOne(s: Deletions): bool = s.asked != 0 and s.waiting != 0
```

### Confirming the review holds the deletion; a deletion still waiting is sent first, so the only Undo shown is the newest

The phone's calendar reviews a deletion of one of its events as the owner
confirms it, while Calendar is still in front, since it reviews nothing
while Alpha is out of sight or the phone is locked. When the deletion is
sent, after its Undo window or once the owner leaves, it is the one the
phone reviewed, and the phone still refuses it if the event changed since.

```quint
pure def canConfirm(s: Deletions, now: int): bool = s.asked != 0 and s.sending == 0 and not(s.paused)

pure def confirm(s: Deletions, now: int): Step =
  val held = {
    ...s, asked: 0, waiting: s.asked, reach: s.askedReach, revision: s.askedRevision, undo: U::hold(now, windowOf(s.scale)), notice: true,
    dropped: 0, failed: 0, changed: false,
  }
  if (s.waiting != 0) { state: { ...held, sending: s.waiting, sendingReach: s.reach }, out: List(Release({ id: s.waiting, reach: s.reach, revision: s.revision })) }
  else { state: held, out: List() }
```

### Undo inside the window sends nothing, and shows the event again

```quint
pure def canUndo(s: Deletions, now: int): bool = s.waiting != 0 and not(s.paused) and U::canUndo(s.undo, now)

pure def undo(s: Deletions, now: int): Deletions = { ...s, waiting: 0, undo: U::undo(s.undo), notice: false, paused: false }
```

### The window ends only once its Undo notice is no longer shown

The notices area says when the notice goes; a notice still shown keeps
Undo possible past the window.

```quint
pure def canNoticeGone(s: Deletions): bool = s.notice and not(s.paused)

pure def noticeGone(s: Deletions): Deletions = { ...s, notice: false }

pure def canUndoShown(s: Deletions): bool = s.waiting != 0 and s.notice and s.undo.holding == U::Held

pure def undoShown(s: Deletions): Deletions = { ...s, waiting: 0, undo: U::undo(s.undo), notice: false, paused: false }

pure def canWindowEnded(s: Deletions, now: int): bool = s.waiting != 0 and U::canRelease(s.undo, now) and not(s.notice) and s.sending == 0 and not(s.paused)

pure def windowEnded(s: Deletions, now: int): Step =
  { state: { ...s, waiting: 0, undo: U::release(s.undo), sending: s.waiting, sendingReach: s.reach }, out: List(Release({ id: s.waiting, reach: s.reach, revision: s.revision })) }
```

### Leaving Calendar sends a waiting deletion at once, and closes a review unsent

```quint
pure def canLeave(s: Deletions): bool = s.asked != 0 or (s.waiting != 0 and s.sending == 0 and not(s.paused))

pure def leave(s: Deletions): Step =
  if (s.waiting != 0 and s.sending == 0 and not(s.paused))
    { state: { ...s, asked: 0, waiting: 0, undo: U::release(s.undo), notice: false, sending: s.waiting, sendingReach: s.reach }, out: List(Release({ id: s.waiting, reach: s.reach, revision: s.revision })) }
  else { state: { ...s, asked: 0 }, out: List() }
```

### A restart pauses a deletion still in its window; the owner sends it or keeps the event

A deletion that was being sent is hidden until a read shows what happened.
A paused deletion whose number names no event Alpha kept a number for, as
one kept before Alpha kept its numbers, is never sent: it is kept unsent, as
Keep it does, and its event stays as the calendar has it.

```quint
pure def canRestart(s: Deletions): bool = true

pure def restart(s: Deletions): Deletions =
  { ...s, asked: 0, paused: s.waiting != 0, notice: s.waiting != 0, sending: 0, sendingReach: OneEvent,
    hiding: if (s.sending != 0) s.sending else s.hiding, hidingReach: if (s.sending != 0) s.sendingReach else s.hidingReach }

pure def canSendPaused(s: Deletions): bool = s.paused and s.sending == 0

pure def sendPaused(s: Deletions): Step =
  { state: { ...s, waiting: 0, undo: U::release(s.undo), notice: false, paused: false, sending: s.waiting, sendingReach: s.reach },
    out: List(Release({ id: s.waiting, reach: s.reach, revision: s.revision })) }
```

### Another owner signing in drops a waiting deletion unsent, and says the event was not deleted

```quint
pure def canOwnerChanged(s: Deletions, owner: int): bool = owner != s.owner and owner >= 0

pure def ownerChanged(s: Deletions, owner: int): Deletions =
  { ...s, owner: owner, asked: 0, waiting: 0, undo: if (s.waiting != 0) U::undo(s.undo) else s.undo, notice: false, paused: false, hiding: 0, hidingReach: OneEvent,
    dropped: if (s.waiting != 0) s.waiting else 0, failed: 0, changed: false }
```

### A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged

Nothing is sent unless the event is still as the owner confirmed it: the
phone's calendar inspects the event before anything is dispatched, an
event changed since it was read is refused and its day read again, and one
the phone says only Android Calendar may delete is opened there. While a
deletion is sent Calendar says Deleting…, or Declining… for an invitation.
A declined invitation stays in the calendar, changed, so the read that
shows it changed shows it again. The owner is told "Event changed." or
"Couldn't delete this event." Only a whole read of its own source, for a
window that holds the day it was last seen on, shows a hidden event gone.

```quint
pure def canEnded(s: Deletions, id: int, done: bool, changed: bool): bool = id > 0 and id == s.sending

pure def ended(s: Deletions, id: int, done: bool, changed: bool): Deletions =
  { ...s, sending: 0, sendingReach: OneEvent, hiding: if (done) id else s.hiding, hidingReach: if (done) s.sendingReach else s.hidingReach,
    failed: if (done) 0 else id, changed: not(done) and changed }

pure def alwaysOnlyARefusalChanged(s: Deletions): bool = s.changed implies s.failed != 0

pure def sometimesRefusedAsChanged(s: Deletions): bool = s.changed and s.sending == 0

pure def canReadShows(s: Deletions, id: int, unchanged: bool): bool = id > 0 and id == s.hiding

pure def readShows(s: Deletions, id: int, unchanged: bool): Deletions =
  { ...s, hiding: if (unchanged) s.hiding else 0, hidingReach: if (unchanged) s.hidingReach else OneEvent }
```

### A deletion waits only while its Undo holds, and one is sent at a time

```quint
pure def alwaysAWaitingDeletionIsHeld(s: Deletions): bool =
  (s.waiting != 0 implies s.undo.holding == U::Held) and (s.waiting == 0 or s.waiting != s.sending) and (s.paused implies s.waiting != 0)
```

### A deletion is sent only when its window ended with its notice gone, when the owner leaves, when a newer one is confirmed, or when the owner sends one a restart paused, at the revision confirmed

```quint
pure def stepSentOnlyWhenItMayBe(before: Deletions, via: str, after: Deletions, out: List[Effect]): bool =
  out.every(e => match e {
    | Release(r) => r.id == before.waiting and r.reach == before.reach and r.revision == before.revision
        and (via == "windowEnded" or via == "leave" or via == "confirm" or via == "sendPaused")
  })
```

### A deletion can be undone, sent after its notice went, sent on leaving, or dropped for another owner

```quint
pure def sometimesUndone(s: Deletions): bool = s.undo.holding == U::Undone and s.waiting == 0 and s.owner == 0

pure def sometimesSentAfterTheNotice(s: Deletions): bool = s.sending != 0 and s.undo.holding == U::Released and not(s.notice)

pure def sometimesHiddenUntilRead(s: Deletions): bool = s.hiding != 0 and s.sending == 0

pure def sometimesDroppedForAnotherOwner(s: Deletions): bool = s.owner == 2 and s.undo.holding == U::Undone and s.dropped != 0

pure def sometimesPausedByARestart(s: Deletions): bool = s.paused

pure def sometimesRefusedSaysNotDeleted(s: Deletions): bool = s.failed != 0 and s.sending == 0

pure def sometimesFromThisOn(s: Deletions): bool = s.sending != 0 and s.sendingReach == FromThisOn

pure def sometimesAScaledWindow(s: Deletions): bool = s.waiting != 0 and s.scale == 200
```
