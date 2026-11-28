# Toasts

A toast is a short message at the bottom of the screen: something saved,
something failed, or a change the owner can still undo. This spec says how
long each one stays, which waits for which, and where it is shown.

A toast with Undo has no time of its own: it names the change it offers to
take back (the area that raised it and its number there), and stays until
that area withdraws it, because the change can no longer be undone, or
Undo is tapped. How long the change stays undoable is the area's: it
sets the window from `duration` here at the scale this layer reads. A toast only
passes the tap on. An Undo toast takes a tap only on its Undo: a tap anywhere
else on it reaches what is under it, so it never stands in the way of a row
or a control beneath.

## Story: Read a toast before it goes

> As the owner, I want every toast to stay long enough for me to read it,
> an Undo toast long enough to use it, and longer still when I have asked
> Android for more time.

### The layer shows at most one toast, how long it has left, plain toasts and Undo toasts waiting behind it, the dialog it is shown in, and how much longer Android asks toasts to stay

Each toast is numbered and has a length in characters; one with Undo names
the area and the number of the change it offers to take back. The notices
kept until the owner dismisses them are named the same way. Android's
recommended timeout is read as a scale, in percent, through the kit's
[read](../../kit/read.md); the layer starts unscaled, during startup, with
no dialog open.

```quint
import read as R from "../../kit/read"

type Toast = { number: int, chars: int, undo: bool, area: str, about: int }
type Kept = { area: str, about: int }
type Act = Undone | AskScale
type Effect = { act: Act, area: str, number: int }
type Toasts = {
  issued: int, showing: bool, current: Toast, lasts: int, left: int, held: bool,
  next: Toast, undos: List[Toast], scale: int, scaling: R::Read, starting: bool, dialog: int, shownIn: int,
  kept: List[Kept],
}
type Shown = { state: Toasts, out: List[Effect] }

pure val none: Toast = { number: 0, chars: 0, undo: false, area: "", about: 0 }

pure val initial: Toasts = {
  issued: 0, showing: false, current: none, lasts: 0, left: 0, held: false,
  next: none, undos: List(), scale: 100, scaling: R::unread, starting: true, dialog: 0, shownIn: 0,
  kept: List(),
}

pure val charsValues = Set(10, 191, 400)
pure val scaleValues = Set(0, 100, 150, 600)
pure val ticketValues = Set(1, 2)
pure val areaValues = Set("", "deletions", "inbox")
pure val aboutValues = Set(0, 1, 2)
pure val weight_started = 3
```

### A toast stays 1.9 seconds, a long one 50 milliseconds a character and half a second more up to 12 seconds, and a change is offered for Undo at least 10 seconds; all are stretched by Android's scale

The scale a toast is shown with is kept for that toast: a later answer
changes only toasts shown after it.

```quint
pure def duration(chars: int, undo: bool, scale: int): int =
  val base = if (undo) 10000 else 1900
  val reading = chars * 50 + 500
  val capped = if (reading > 12000) 12000 else reading
  val longest = if (capped > base) capped else base
  longest * scale / 100
```

### Undo is offered never less time than a toast without it stays, nor less than ten seconds

```quint
pure def lawUndoStaysLonger(chars: int, scale: int): bool =
  scale >= 100 implies (duration(chars, true, scale) >= duration(chars, false, scale) and duration(chars, true, scale) >= 10000)
```

### More time asked of Android never shortens a toast

```quint
pure def lawExtendedTimeoutsStayLonger(chars: int, undo: bool, scale: int): bool =
  scale >= 100 implies duration(chars, undo, scale) >= duration(chars, undo, 100)
```

### Alpha asks Android how long toasts should stay, and only the newest answer counts

An answer below 100 percent counts as 100; a failed read keeps the last
scale.

```quint
pure def askScale(s: Toasts): Shown =
  val scaling = R::ask(s.scaling)
  { state: { ...s, scaling: scaling }, out: List({ act: AskScale, area: "", number: scaling.ticket }) }

pure def canScaled(s: Toasts, ticket: int): bool = R::canAnswer(s.scaling, ticket)

pure def scaled(s: Toasts, ticket: int, scale: int, ok: bool): Toasts =
  { ...s, scaling: R::answer(s.scaling, ok), scale: if (not(ok)) s.scale else if (scale >= 100) scale else 100 }
```

### A toast never stays less than its default time, however Android answers

```quint
pure def alwaysTheScaleNeverShortens(s: Toasts): bool = s.scale >= 100
```

### A plain toast showing has at least its kind's time, and never more left than it was given; an Undo toast showing has no time of its own

```quint
pure def alwaysAToastStaysItsTime(s: Toasts): bool =
  if (not(s.showing)) s.current == none and s.lasts == 0 and s.left == 0 and not(s.held)
  else if (s.current.undo) s.current.number > 0 and s.lasts == 0 and s.left == 0 and not(s.held)
  else s.current.number > 0 and s.lasts >= duration(s.current.chars, false, 100) and 0 <= s.left and s.left <= s.lasts
```

### Time passes for a plain toast only while it is shown and not held, and it goes once its time is up

```quint
pure val msValues = Set(2000, 80000)

pure def canElapse(s: Toasts, ms: int): bool = s.showing and not(s.current.undo) and not(s.held) and s.left > 0 and ms > 0

pure def elapse(s: Toasts, ms: int): Toasts = { ...s, left: if (ms >= s.left) 0 else s.left - ms }

pure def canExpire(s: Toasts): bool = s.showing and not(s.current.undo) and not(s.held) and s.left == 0

pure def expire(s: Toasts): Toasts = following(s.undos, s)
```

### A plain toast showing goes only once its time is up, or for a newer toast

```quint
pure def stepAToastGoesOnlyInItsTime(before: Toasts, via: str, after: Toasts): bool =
  (before.showing and not(before.current.undo) and after.current.number != before.current.number)
    implies ((via == "expire" and before.left == 0) or via == "raise" or via == "started")
```

### A toast that is not held goes in time

If the phone keeps time, a plain toast the owner is not holding does not
stay.

```quint
pure def leadsToAToastGoes(s: Toasts, later: Toasts): bool =
  (s.showing and not(s.current.undo) and not(s.held)) implies (later.current.number != s.current.number or later.held)

pure val fair_elapse = "weak"
pure val fair_expire = "weak"
```

### A plain toast can stay longer than twelve seconds when Android asks toasts to stay longer

```quint
pure def sometimesAnExtendedToast(s: Toasts): bool = s.showing and not(s.current.undo) and s.lasts > 12000
```

## Story: Keep an Undo in reach

> As the owner, when a toast offers Undo I want it to stay until I can use
> it, whatever other toasts arrive meanwhile.

### A toast is shown at once unless an Undo shows; behind an Undo, an Undo waits its turn and a plain toast waits, giving way to a newer plain one; nothing shows during startup, and what was raised then waits

No toast is refused. An Undo toast takes the place of a plain one showing,
and a plain one the place of a plain one.

```quint
pure def admit(toast: Toast, s: Toasts): Toasts =
  val lasts = if (toast.undo) 0 else duration(toast.chars, false, s.scale)
  if (s.starting or (s.showing and s.current.undo))
    (if (toast.undo) { ...s, undos: s.undos.append(toast) } else { ...s, next: toast })
  else { ...s, showing: true, current: toast, lasts: lasts, left: lasts, held: false, shownIn: s.dialog }

pure def canRaise(s: Toasts, chars: int, undo: bool, area: str, about: int): bool =
  chars > 0 and (undo iff about > 0) and (undo iff area != "")

pure def raise(s: Toasts, chars: int, undo: bool, area: str, about: int): Toasts =
  admit({ number: s.issued + 1, chars: chars, undo: undo, area: area, about: about }, { ...s, issued: s.issued + 1 })
```

### When startup ends, the first Undo waiting is shown, or else the plain toast waiting

```quint
pure def following(undos: List[Toast], s: Toasts): Toasts =
  val cleared = { ...s, showing: false, current: none, lasts: 0, left: 0, held: false, shownIn: 0, starting: false }
  if (undos.length() > 0) admit(undos.nthOr(0, none), { ...cleared, undos: undos.tail() })
  else if (s.next.number > 0) admit(s.next, { ...cleared, next: none })
  else cleared

pure def canStarted(s: Toasts): bool = s.starting

pure def started(s: Toasts): Toasts = following(s.undos, s)
```

### A plain toast the owner is reading is held, and its whole time starts again when they let go

```quint
pure def canHold(s: Toasts): bool = s.showing and not(s.current.undo) and not(s.held)

pure def hold(s: Toasts): Toasts = { ...s, held: true }

pure def canLetGo(s: Toasts): bool = s.held

pure def letGo(s: Toasts): Toasts = { ...s, held: false, left: s.lasts }
```

### Tapping Undo passes the tap on once, naming the change of the toast showing, and the next toast waiting is shown

```quint
pure def canTapUndo(s: Toasts): bool = s.showing and s.current.undo

pure def tapUndo(s: Toasts): Shown =
  { state: following(s.undos, s), out: List({ act: Undone, area: s.current.area, number: s.current.about }) }
```

### The area that raised an Undo toast withdraws it, showing or waiting, once its change can no longer be undone

```quint
pure def offers(t: Toast, area: str, about: int): bool = t.undo and t.area == area and t.about == about

pure def canRetract(s: Toasts, area: str, about: int): bool =
  about > 0 and ((s.showing and offers(s.current, area, about)) or s.undos.some(t => offers(t, area, about)))

pure def retract(s: Toasts, area: str, about: int): Toasts =
  if (s.showing and offers(s.current, area, about)) following(s.undos, s)
  else { ...s, undos: s.undos.select(t => not(offers(t, area, about))) }
```

### A toast waits only behind an Undo showing or during startup, and only Undo toasts wait in turn

```quint
pure def alwaysOnlyBehindAnUndoToastsWait(s: Toasts): bool =
  val behind = s.starting or (s.showing and s.current.undo)
  (s.next.number > 0 implies (behind and not(s.next.undo))) and (s.next.number == 0 implies s.next == none)
    and (s.undos.length() > 0 implies behind) and s.undos.every(t => t.undo and t.number > 0)
    and (s.starting implies not(s.showing))
```

### Every toast is numbered when raised, and an Undo toast names its change

```quint
pure def named(t: Toast, issued: int): bool = t.number <= issued and (t.undo iff t.about > 0) and (t.undo iff t.area != "")

pure def alwaysToastsAreNumbered(s: Toasts): bool =
  s.issued >= 0 and named(s.current, s.issued) and named(s.next, s.issued) and s.undos.every(t => named(t, s.issued))
```

### Every toast raised is shown at once, or waits

```quint
pure def stepNoToastIsRefused(before: Toasts, via: str, after: Toasts): bool =
  via == "raise" implies
    (after.current.number == after.issued or after.next.number == after.issued or after.undos.some(t => t.number == after.issued))
```

### An Undo toast leaves only when Undo is tapped or its change withdraws it, and one waiting is never dropped otherwise

```quint
pure def stepAnUndoIsNeverPushedAside(before: Toasts, via: str, after: Toasts): bool =
  ((before.showing and before.current.undo and after.current != before.current) implies (via == "tapUndo" or via == "retract"))
    and before.undos.every(t => after.undos.includes(t) or after.current == t or via == "retract")
```

### Undo is passed on only by a tap, for the change of the toast that offered it

```quint
pure def stepUndoIsPassedOnOnce(before: Toasts, via: str, after: Toasts, out: List[Effect]): bool =
  out.length() <= 1 and out.every(e => if (e.act == Undone)
      via == "tapUndo" and before.current.undo and e.number == before.current.about and e.area == before.current.area and e.number > 0
    else via == "askScale" and e.number == after.scaling.ticket)
```

### A plain toast and an Undo can wait behind an Undo, toasts can wait through startup, and a toast can be held while it is read

```quint
pure def sometimesPlainWaitsBehindUndo(s: Toasts): bool = s.showing and s.current.undo and s.next.number > 0

pure def sometimesAnUndoWaitsItsTurn(s: Toasts): bool = s.showing and s.current.undo and s.undos.length() > 0

pure def sometimesHeldThroughStartup(s: Toasts): bool = s.starting and (s.next.number > 0 or s.undos.length() > 0)

pure def sometimesHeldWhileReading(s: Toasts): bool = s.held
```

## Story: See a toast over a dialog

> As the owner, I want a toast raised while a dialog is open to appear in
> that dialog, not hidden behind it.

### The phone says which dialog is on top, and the toast showing moves into it

The dialog on top is a fact of the page; 0 is none, and the toast then
shows on the page itself.

```quint
pure val topValues = Set(0, 1, 2)

pure def canCover(s: Toasts, top: int): bool = top >= 0 and top != s.dialog

pure def cover(s: Toasts, top: int): Toasts = { ...s, dialog: top, shownIn: if (s.showing) top else 0 }
```

### The toast showing is shown in the dialog on top, and nothing is shown in a dialog when no toast shows

```quint
pure def alwaysAToastIsShownOnTop(s: Toasts): bool =
  (s.showing implies s.shownIn == s.dialog) and (not(s.showing) implies s.shownIn == 0) and s.dialog >= 0
```

### A toast with Undo can show inside a dialog

```quint
pure def sometimesUndoInADialog(s: Toasts): bool = s.shownIn != 0 and s.current.undo
```

## Story: Keep what I must not miss

> As the owner, I want a notice about work that was lost, or a privacy
> state left on, to stay listed after its toast has gone, until I dismiss
> it.

### An area keeps a notice under its own name and number, once; at most three are listed, and a fourth pushes out the oldest

The area raises its toast as well, which goes in its time like any other.

```quint
pure val keptLimit = 3

pure def canKeep(s: Toasts, area: str, about: int): bool = area != "" and about > 0

pure def keep(s: Toasts, area: str, about: int): Toasts =
  val one = { area: area, about: about }
  if (s.kept.includes(one)) s
  else if (s.kept.length() >= keptLimit) { ...s, kept: s.kept.tail().append(one) }
  else { ...s, kept: s.kept.append(one) }
```

### A kept notice stays listed until the owner dismisses it

```quint
pure def canDismiss(s: Toasts, area: str, about: int): bool = s.kept.includes({ area: area, about: about })

pure def dismiss(s: Toasts, area: str, about: int): Toasts = { ...s, kept: s.kept.select(k => k != { area: area, about: about }) }

pure def stepAKeptNoticeLeavesOnlyWhenDismissedOrPushedOut(before: Toasts, via: str, after: Toasts): bool =
  before.kept.every(k => after.kept.includes(k) or via == "dismiss" or (via == "keep" and before.kept.length() >= keptLimit))
```

### Never more than three notices are kept, each named by its area and number

```quint
pure def alwaysFewNoticesAreKept(s: Toasts): bool =
  s.kept.length() <= keptLimit and s.kept.every(k => k.area != "" and k.about > 0)
```

### A kept notice can outlive its toast, and the list can fill

```quint
pure def sometimesANoticeOutlivesItsToast(s: Toasts): bool = s.kept.length() > 0 and not(s.showing)

pure def sometimesTheKeptListIsFull(s: Toasts): bool = s.kept.length() == keptLimit
```
