# Dock

How the owner's finger and the keyboard move Ask Alpha. The height Ask
Alpha is raised to belongs to the [shell](../shell/): a gesture here only
chooses where it lands, and asks the shell to raise it there or to go back
by a step or two. The dock keeps one gesture at a time, the moment until which a stray click
is ignored, the height a sheet was left at, and whether a resting bar was
tucked to the pill.

The sheet draws only the arrows Alpha's Sunday v119 build drew (old-line
Alpha 45f6bed30, template.html:4447-4740): Minimize's chevron down, the
chevron of a card that opens, and Send's arrow up while there is text. The
way back to a call or a conversation, the strip above them, the way back
to a fork's original, Earlier, Later and a digest's rows have no arrow.

## Story: Drag Ask Alpha where I want it

> As the owner, I want a drag or a flick of Ask Alpha to land where my
> finger meant: open it fully, keep it at the height I left it, or put it
> away, with one press doing one thing, and the composer never hidden by
> the keyboard.

As in Alpha before VibeStack (the Sunday v119 demo build, old-line Alpha
45f6bed30, which the owner named the reference on 2026-11-26), the sheet
follows the finger while its handle, the strip above a full-screen call or
conversation, or the resting bar is dragged (the bar's background, Alpha's
mark, an empty field, or anywhere on the pill, its buttons too), and lands
where the release says. Each height is reached in order both ways: the
bar, a sheet at any height between the zones, and the full screen; a sheet
dragged down and let go between the zones stays there, so a second drag
down takes it lower again. A finger counts as a drag once it
has moved 8 points. While the sheet rises from the bar or the pill, the
bar or pill is hidden and the sheet shows its own composer; while an open
sheet is pulled down it fades by how far it has gone into the floor's zone
and the bar or pill it will rest on shows through it; as in v119
(chat-overlay-motion-adapter.ts:1037-1039), the floor is the bar drawn when
the finger went down, or 62 points where none is, and 28 more. A release is a flick
when the finger rose or fell at 1 point a millisecond over the last 100
milliseconds before it lifted, and was not held still for 80 milliseconds;
a flick goes the way it was aimed. Once released, the sheet moves to where
it landed over 420 milliseconds on v119's curve, and a tap that opens or
closes it from the bar grows it from the bar or shrinks it onto the bar the
same way, keeping its composer until the bar shows. A sheet put away
shrinks and fades over the bar or pill already drawn under it, which then
stays in place with its own controls in their own colours: no control of
the sheet's, such as its black Talk, is carried onto the bar. As v119's
one field did, which stayed in the sheet until the bar took it (old-line
Alpha 45f6bed30, chat-overlay-motion-adapter.ts:1356-1360), only one field
shows words at a time: the bar or pill drawn under a sheet being pulled
down shows none, and the bar's own words show at once under a sheet put
away: one a tap put away shrinks with its field empty, and one a drag put
away falls with no composer at all, as v119's did once the finger let go
(chat-overlay-motion-adapter.ts:613-651), so its Talk and + never show
over the bar's or under it, and its header slides down onto the bar as it
fades.
A drag on the conversation
that reaches its end moves nothing else: the sheet stays where it is, as
v119's did. Alpha's mark at the start of the open sheet's header is tapped
in v119's box, 46 points wide. A resting
bar dragged down and let go becomes the pill where it is, with no entrance:
as v119 left the bar or pill in place after any drag (45f6bed30
chat-overlay-motion-adapter.ts:637-646), it does not drop and rise again.
A tap or a drag on the
page outside an open sheet lowers Ask Alpha when it ends; outside the bar
being typed in, it only leaves the field, which rests the bar once.

### A released drag lands on the bar, a sheet at a height, or the full screen

Near the top it fills the screen and near the floor it goes to the bar;
the zones are 120 points deep, or a third of the travel when that is less.
An open sheet flicked up fills the screen and flicked down goes to the bar.
Pulled down from the bar or typing, it stays on the bar detent and tucks to
the compact pill. Between the zones a sheet keeps the height it was left at;
height 0 is its fitted height.

```quint
import shell as S from "../shell"

type Direction = Up | Down
type Landing = { detent: S::Detent, height: int }

pure val snapZone = 120

pure def zone(floor: int, full: int): int = if (snapZone < (full - floor) / 3) snapZone else (full - floor) / 3

pure def isOpen(detent: S::Detent): bool = detent == S::Sheet or detent == S::Full

pure def landing(start: S::Detent, direction: Direction, flick: bool, height: int, floor: int, full: int): Landing =
  val z = zone(floor, full)
  val nearTop = height >= full - z
  val nearFloor = height <= floor + z
  if (isOpen(start))
    if (flick) { detent: if (direction == Up) S::Full else S::Bar, height: 0 }
    else if (nearFloor) { detent: S::Bar, height: 0 }
    else if (nearTop) { detent: S::Full, height: 0 }
    else { detent: S::Sheet, height: height }
  else if (direction == Down) { detent: S::Bar, height: 0 }
  else if (nearTop) { detent: S::Full, height: 0 }
  else { detent: S::Sheet, height: if (flick or nearFloor) 0 else height }
```

### A gesture asks the shell to raise Ask Alpha, to go back a step or two, or nothing; a press that did not move is a tap on its control

```quint
type Effect = Raise({ detent: S::Detent }) | Lower({ steps: int }) | Tap

pure def asked(start: S::Detent, target: S::Detent): List[Effect] =
  if (S::height(target) > S::height(start)) List(Raise({ detent: target }))
  else if (target == start) List()
  else List(Lower({ steps: if (start == S::Full and target == S::Bar) 2 else 1 }))

pure def applied(asks: List[Effect], s: S::Shell): S::Shell =
  val first = asks.nthOr(0, Tap)
  match first {
    | Raise(r) => if (S::canRaise(s, r.detent)) S::raise(s, r.detent) else s
    | Lower(l) => if (l.steps == 2) S::goBack(S::goBack(s)) else S::goBack(s)
    | _ => s
  }

pure def moves(e: Effect): bool = match e { | Tap => false | _ => true }
```

### What the shell is asked brings Ask Alpha exactly where the gesture landed

```quint
pure val phoneValues = Set(S::initial,
  { ...S::initial, trail: List(S::Notes), assistant: S::Sheet },
  { ...S::initial, trail: List(S::Calendar, S::Notes), assistant: S::Full, image: true },
  { ...S::initial, assistant: S::Typing, contacts: true },
  { ...S::initial, drawer: true, assistant: S::Sheet },
  { ...S::initial, trail: List(S::Calendar), assistant: S::Bar })

pure def lawTheShellSettlesWhereTheGestureLands(phone: S::Shell, direction: Direction, flick: bool, height: int, floor: int, full: int): bool =
  applied(asked(phone.assistant, landing(phone.assistant, direction, flick, height, floor, full).detent), phone).assistant
    == landing(phone.assistant, direction, flick, height, floor, full).detent
```

### A flick of an open sheet goes by its direction alone

```quint
pure def lawAFlickGoesByItsDirection(start: S::Detent, direction: Direction, height: int, floor: int, full: int): bool =
  isOpen(start) implies
    landing(start, direction, true, height, floor, full).detent == (if (direction == Up) S::Full else S::Bar)
```

### Pulled down from the bar or from typing, Ask Alpha rests on the bar

Swiping down from an open sheet or full screen rests on the bar first;
swiping down on the resting bar or while typing keeps the bar detent and
tucks the bar into the compact pill everywhere, including on Home and the
Browser. Tucking Home's resting bar departs from v119's `!home` rule, under
which Home's bar was never dismissed (old-line Alpha 45f6bed30,
chat-overlay-motion-adapter.ts:337-339, :866-869); it is pending the
owner's decision. Home and the Browser still rest on the whole bar until it
is swiped down.

```quint
pure def lawPulledDownAtRestStaysOnTheBar(start: S::Detent, flick: bool, height: int, floor: int, full: int): bool =
  not(isOpen(start)) implies landing(start, Down, flick, height, floor, full).detent == S::Bar
```

### A sheet keeps the height it was left at only between the two zones

```quint
pure def lawAKeptHeightLiesBetweenTheZones(start: S::Detent, direction: Direction, flick: bool, height: int, floor: int, full: int): bool =
  val l = landing(start, direction, flick, height, floor, full)
  val z = zone(floor, full)
  l.height != 0 implies (l.detent == S::Sheet and l.height == height and floor + z < height and height < full - z)
```

### A short, slow pull of the bar or the pill leaves Ask Alpha where it was

As v119 settled a release: a finger that ended within 8 points of where it
pressed goes nowhere; from the bar a pull that was not quick (half a point
a millisecond, over the whole pull or its last move) and travelled less
than 24 points goes nowhere, and from the pill less than 56 (the pull
distance every v119 gesture shared). The gesture is dropped as a shifted
one is: nothing is asked and its late click is ignored. An open sheet
moved past the 8 points always settles.

```quint
pure val tapSlop = 8

pure val barReach = 24

pure val pillReach = 56

pure def stays(start: S::Detent, pill: bool, travel: int, quick: bool): bool =
  travel < tapSlop or (not(isOpen(start)) and not(quick) and travel < (if (pill) pillReach else barReach))

pure def lawAnOpenSheetAlwaysSettles(start: S::Detent, pill: bool, travel: int, quick: bool): bool =
  (isOpen(start) and travel >= tapSlop) implies not(stays(start, pill, travel, quick))

pure def lawAQuickPullAlwaysSettles(start: S::Detent, pill: bool, travel: int): bool =
  travel >= tapSlop implies not(stays(start, pill, travel, true))
```

### A sheet keeps the share of the screen it was left at

As v119 remembered it, the height a sheet was left at is kept as its share
of the full height, in thousandths, so it keeps its place on a screen that
changes size.

```quint
pure val shareScale = 1000

pure def keptShare(height: int, full: int): int = if (full > 0) height * shareScale / full else 0

pure def lawAKeptShareIsBelowTheFullScreen(start: S::Detent, direction: Direction, flick: bool, height: int, floor: int, full: int): bool =
  val l = landing(start, direction, flick, height, floor, full)
  (0 <= floor and floor < full and l.detent == S::Sheet) implies (0 <= keptShare(l.height, full) and keptShare(l.height, full) < shareScale)
```

### The dock holds the gesture under the finger, where it started, until when a click is ignored, the height the sheet was left at, whether a resting bar was tucked to the pill, and whether a drag left the bar or pill in place

```quint
type Gesture = Idle | Pressed | Dragging
type Dock = { gesture: Gesture, start: S::Detent, quiet: int, at: int, kept: int, voice: bool, tucked: bool, placed: bool }

pure val initial: Dock = { gesture: Idle, start: S::Bar, quiet: 0, at: 0, kept: 0, voice: false, tucked: false, placed: false }

pure val clickWindow = 400

type Moved = { state: Dock, out: List[Effect] }
```

### What the simulator tries

```quint
pure val nowValues = Set(100, 300, 700)
pure val heightValues = Set(0, 300, 700)
pure val floorValues = Set(80)
pure val fullValues = Set(800)
pure val travelValues = Set(4, 10, 30, 60)
```

### A press starts one gesture, on Ask Alpha as it stands

```quint
pure def canPress(d: Dock, detent: S::Detent, now: int): bool = d.gesture == Idle and now >= d.at

pure def press(d: Dock, detent: S::Detent, now: int): Dock = { ...d, gesture: Pressed, start: detent, at: now }

pure def canDrag(d: Dock): bool = d.gesture == Pressed and not(d.voice)

pure def drag(d: Dock): Dock = { ...d, gesture: Dragging }
```

### A drag released asks the shell once for where it landed, and keeps a sheet's height

The click Android sends after the finger lifts is ignored for a moment, so
a drag that ends over Talk does not also start voice. As v119 kept it
(45f6bed30 chat-overlay-motion-adapter.ts:859, :961-965), a sheet raised to
the full screen keeps the height it was left at, so shrinking it again
returns there; only a sheet put away forgets it.

```quint
pure def canRelease(d: Dock, direction: Direction, flick: bool, height: int, floor: int, full: int, now: int): bool =
  d.gesture == Dragging and now >= d.at and 0 <= floor and floor < full and 0 <= height

pure def release(d: Dock, direction: Direction, flick: bool, height: int, floor: int, full: int, now: int): Moved =
  val l = landing(d.start, direction, flick, height, floor, full)
  val tucked = not(isOpen(d.start)) and direction == Down
  { state: { ...d, gesture: Idle, at: now, quiet: now + clickWindow, kept: if (l.detent == S::Sheet) keptShare(l.height, full) else if (l.detent == S::Full) d.kept else 0, tucked: tucked, placed: not(isOpen(l.detent)) },
    out: asked(d.start, l.detent) }

pure def lawSwipingDownAtRestTucksToThePill(d: Dock, flick: bool, height: int, floor: int, full: int, now: int): bool =
  (canRelease(d, Down, flick, height, floor, full, now) and not(isOpen(d.start))) implies release(d, Down, flick, height, floor, full, now).state.tucked

pure def lawClosingAnOpenSheetRestsOnTheBarFirst(d: Dock, direction: Direction, flick: bool, height: int, floor: int, full: int, now: int): bool =
  (canRelease(d, direction, flick, height, floor, full, now) and isOpen(d.start)) implies not(release(d, direction, flick, height, floor, full, now).state.tucked)
```

### A press that did not move taps its control once

```quint
pure def canLift(d: Dock, now: int): bool = d.gesture == Pressed and now >= d.at

pure def lift(d: Dock, now: int): Moved = { state: { ...d, gesture: Idle, at: now, quiet: now + clickWindow, tucked: false }, out: List(Tap) }
```

### An empty Browser composer can start a drag without taking focus

At rest, the empty and editable Browser field can start the same drag as
the mark. A drag leaves the field unfocused. A press and lift in the field
leaves the tap to the field, so a touch can focus it and open the keyboard.
An open composer or one that holds text uses normal field gestures.

```quint
pure def browserFieldPull(s: S::Shell, blank: bool, editable: bool): bool =
  s.assistant == S::Bar and S::showing(s, S::Browser) and blank and editable

pure def canFieldLift(d: Dock, now: int): bool = canLift(d, now) and d.start == S::Bar

pure def fieldLift(d: Dock, now: int): Dock =
  { ...d, gesture: Idle, at: now, quiet: now + clickWindow }
```

### A click of a control taps it, unless it is the late click of a gesture just ended

```quint
pure def canClick(d: Dock, now: int): bool = d.gesture == Idle and now >= d.at

pure def click(d: Dock, now: int): Moved =
  val fires = now >= d.quiet
  { state: { ...d, at: now, tucked: if (fires) false else d.tucked }, out: if (fires) List(Tap) else List() }
```

### A gesture under the finger is dropped when the shell changes beneath it

Navigation, voice, a resize or the window losing focus ends the gesture:
it asks for nothing, and its late click is ignored.

```quint
pure def canShift(d: Dock, now: int): bool = now >= d.at

pure def shift(d: Dock, now: int): Moved =
  { state: { ...d, gesture: Idle, at: now, quiet: if (d.gesture == Idle) d.quiet else now + clickWindow,
      placed: d.placed or (d.gesture == Dragging and not(isOpen(d.start))) }, out: List() }
```

### A bar or pill a drag left in place changes between them without an entrance until the sheet next opens

As v119 kept its dock shown after a drag (45f6bed30
chat-overlay-motion-adapter.ts:640, :960, :978), the bar or pill a drag
leaves at rest is already where it belongs: tapping Type on a pill that a
drag tucked shows the bar in place at once, and the pill comes back the same
way. The sheet opening ends it, and the bar and pill rise again after that.

```quint
pure def canOpened(d: Dock): bool = d.placed

pure def opened(d: Dock): Dock = { ...d, placed: false }

pure def lawADragLeftAtRestLeavesTheDockInPlace(d: Dock, direction: Direction, flick: bool, height: int, floor: int, full: int, now: int): bool =
  (canRelease(d, direction, flick, height, floor, full, now) and not(isOpen(landing(d.start, direction, flick, height, floor, full).detent)))
    implies release(d, direction, flick, height, floor, full, now).state.placed

pure def stepOnlyTheSheetOpeningUndoesThePlace(before: Dock, via: str, after: Dock): bool =
  (before.placed and not(after.placed)) implies (via == "opened" or via == "release")
```

### While voice owns Ask Alpha nothing drags it, a drag under way is let go, and it is dragged again once voice ends

As on v119, while Talk or dictation holds the chat no drag starts from the
bar, the pill or the sheet, so the voice controls stay where they are; a
press on them still taps.

```quint
pure def canVoicing(d: Dock, on: bool, now: int): bool = on != d.voice and now >= d.at

pure def voicing(d: Dock, on: bool, now: int): Moved =
  { state: { ...d, voice: on, at: now, gesture: if (on and d.gesture == Dragging) Idle else d.gesture,
      quiet: if (on and d.gesture == Dragging) now + clickWindow else d.quiet }, out: List() }

pure def alwaysVoiceDragsNothing(d: Dock): bool = d.voice implies d.gesture != Dragging

pure def sometimesVoiceHoldsTheSheet(d: Dock): bool = d.voice and isOpen(d.start) and d.gesture == Pressed
```

### Ask Alpha put away forgets the height its sheet was left at

```quint
pure def canPutAway(d: Dock, now: int): bool = now >= d.at

pure def putAway(d: Dock, now: int): Moved = { state: { ...d, gesture: Idle, at: now, kept: 0, tucked: false }, out: List() }

pure def stepAPutAwaySheetForgetsItsHeight(before: Dock, via: str, after: Dock): bool =
  (via == "putAway" implies (after.kept == 0 and not(after.tucked))) and (after.kept != before.kept implies (via == "release" or via == "putAway"))
```

### One gesture asks the shell once, and only a drag released asks it to move

```quint
pure def stepOneGestureAsksOnce(before: Dock, via: str, after: Dock, out: List[Effect]): bool =
  out.length() <= 1 and out.every(e => moves(e) implies (via == "release" and before.gesture == Dragging))
```

### A press does one thing: a tap is never also a drag, and a late click never taps

As on v121, the resting bar drags from anywhere on it, not only its handle:
from its background, the Alpha mark and an empty field. Nothing is taken
until the finger moves a few points, so a tap stays a tap. Its other
controls (Send, Talk, Stop, the chat actions) keep their own presses, and a
field with a draft in it scrolls by finger instead of dragging.

```quint
pure def stepAPressDoesOneThing(before: Dock, via: str, after: Dock, out: List[Effect]): bool =
  out.every(e => match e {
    | Tap => (via == "lift" and before.gesture == Pressed) or (via == "click" and before.gesture == Idle and after.at >= before.quiet)
    | _ => true
  })
```

### The dock's clock never goes back

```quint
pure def stepTimeNeverGoesBack(before: Dock, via: str, after: Dock): bool = after.at >= before.at

pure def alwaysAKeptHeightIsAShare(d: Dock): bool = d.kept >= 0 and d.kept < shareScale
```

### A drag can be under way, a sheet can keep its height, and a click can be ignored

```quint
pure def sometimesADragIsUnderWay(d: Dock): bool = d.gesture == Dragging

pure def sometimesASheetKeepsItsHeight(d: Dock): bool = d.kept > 0

pure def sometimesALateClickIsIgnored(d: Dock): bool = d.gesture == Idle and d.at < d.quiet and d.at > 0

pure def sometimesTheBarIsTucked(d: Dock): bool = d.tucked

pure def sometimesADragLeftTheDockInPlace(d: Dock): bool = d.placed
```

## Story: Type without losing the composer

> As the owner, I want the composer to stay above the keyboard while I
> type, and Ask Alpha to rest again when the keyboard goes.

### While typing the composer sits above the keyboard and the navigation bar; otherwise on the navigation bar alone

```quint
pure def composerLift(typing: bool, keyboard: int, navigation: int): int =
  if (typing and keyboard > navigation) keyboard else navigation

pure def lawTheComposerClearsTheKeyboardWhileTyping(keyboard: int, navigation: int): bool =
  composerLift(true, keyboard, navigation) >= keyboard and composerLift(true, keyboard, navigation) >= navigation

pure def lawTheKeyboardLiftsNothingElse(keyboard: int, navigation: int): bool =
  composerLift(false, keyboard, navigation) == navigation
```

### Focusing the composer on the bar raises Ask Alpha to typing

As on v121, a tap in the resting bar's field types there: the bar rises
above the keyboard and the page keeps its place behind it.

```quint
pure def focused(detent: S::Detent): List[Effect] = if (detent == S::Bar) List(Raise({ detent: S::Typing })) else List()

pure def lawFocusingTheBarTypes(phone: S::Shell): bool =
  applied(focused(phone.assistant), phone).assistant == (if (phone.assistant == S::Bar) S::Typing else phone.assistant)
```

### Sending from the bar opens the sheet, where the reply shows

As on v121, a message sent from the bar or while typing on it opens the
conversation sheet; an open sheet or the full screen stays as it is.

```quint
pure def sent(detent: S::Detent): List[Effect] = if (not(isOpen(detent))) List(Raise({ detent: S::Sheet })) else List()

pure def lawSendingShowsTheReply(phone: S::Shell): bool =
  applied(sent(phone.assistant), phone).assistant == (if (not(isOpen(phone.assistant))) S::Sheet else phone.assistant)
```

### A touch of the bar or of Type while the conversation holds a card about the draft opens the sheet, where the card shows

Ask Alpha at the bar or typing shows no conversation, so a card about the
draft, such as Try again after storage failed, is out of sight there and
the bar gives no Send. While such a card waits, focusing the composer or
tapping Type opens the sheet with the card instead of typing on the bar;
an open sheet or the full screen stays as it is. Nothing raises Ask Alpha
again by itself: only the owner's touch does.

```quint
pure def touched(detent: S::Detent, carded: bool): List[Effect] =
  if (carded and not(isOpen(detent))) List(Raise({ detent: S::Sheet })) else focused(detent)

pure def lawATouchShowsTheDraftsCard(phone: S::Shell): bool =
  applied(touched(phone.assistant, true), phone).assistant == (if (not(isOpen(phone.assistant))) S::Sheet else phone.assistant)

pure def lawWithoutACardATouchTypes(detent: S::Detent): bool =
  touched(detent, false) == focused(detent)
```

### A tap of Alpha's mark opens the sheet, and a tap of the open sheet's handle fills the screen

As on v121, the mark on the bar or the pill opens the conversation sheet
without taking the keyboard, and the handle of a half-open sheet toggles
it to the full screen.

```quint
pure def tapped(detent: S::Detent): List[Effect] =
  if (not(isOpen(detent))) List(Raise({ detent: S::Sheet }))
  else if (detent == S::Sheet) List(Raise({ detent: S::Full }))
  else List()

pure def lawATapOpensTheSheetOrFillsTheScreen(phone: S::Shell): bool =
  applied(tapped(phone.assistant), phone).assistant ==
    (if (not(isOpen(phone.assistant))) S::Sheet else if (phone.assistant == S::Sheet) S::Full else phone.assistant)
```

### A keyboard closed while typing puts Ask Alpha back on the bar

Leaving the field for anything outside Ask Alpha closes the keyboard too, as
a tap beside the raised bar did in Alpha before VibeStack: a hardware
keyboard or a browser never reports a keyboard going. Only one of the two
lowers it, since the second finds Ask Alpha already on the bar.

```quint
pure def keyboardClosed(detent: S::Detent): List[Effect] = if (detent == S::Typing) List(Lower({ steps: 1 })) else List()

pure def lawAClosedKeyboardLeavesTypingForTheBar(phone: S::Shell): bool =
  applied(keyboardClosed(phone.assistant), phone).assistant == (if (phone.assistant == S::Typing) S::Bar else phone.assistant)
```

## Story: Keep the app's screen while Ask Alpha rests

> As the owner, I want Ask Alpha at rest inside an app to take as little of
> the screen as it did before VibeStack: a small pill centred above the
> bottom edge with Alpha's mark, Type and Talk, while Home and the Browser
> start with the whole bar to type in.

The Browser's bar tucks into that same pill when it is swiped down, as
v119's did. Home's bar tucks too, as #1733 left it. That departs from v119's
`!home` rule (45f6bed30 chat-overlay-motion-adapter.ts:337-339, :866-869)
and is pending the owner's decision, so it is not part of the owner's story
yet.

### Inside an app other than the Browser, Ask Alpha at rest is the pill; Type raises it to typing, where the whole bar shows, and a swipe up from it opens the sheet

The pill is how the bar is drawn in an app other than the Browser, and also
on Home or the Browser after the owner swipes down on the resting bar
(`tucked = true`), not another height: Back, gestures and every guard treat
it as the bar. Both Home and the Browser rest on the whole bar until it is
swiped down; tucking Home's bar into the pill departs from v119's `!home`
rule (chat-overlay-motion-adapter.ts:337-339, :866-869) and is pending the
owner's decision. Tapping Type, opening the sheet or full screen, or changing views clears
`tucked`. Alpha's mark opens the sheet, Type focuses the
composer, and Talk starts a spoken turn. A swipe up that starts on one of
the pill's buttons opens the sheet, which follows the finger as it does from
the bar, as the pill in Alpha before VibeStack did; a press there that does
not move stays that button's tap.

```quint
pure def pill(phone: S::Shell, tucked: bool): bool =
  phone.assistant == S::Bar and (tucked or (phone.trail.length() > 0 and not(S::showing(phone, S::Browser))))

pure def lawThePillIsAlwaysAtTheBarDetent(phone: S::Shell, tucked: bool): bool =
  pill(phone, tucked) implies phone.assistant == S::Bar

pure def lawTuckingAtRestShowsThePillEverywhere(phone: S::Shell): bool =
  phone.assistant == S::Bar implies pill(phone, true)

pure def lawTypeLeavesThePill(phone: S::Shell, tucked: bool): bool =
  pill(phone, tucked) implies not(pill(applied(focused(phone.assistant), phone), false))
```
