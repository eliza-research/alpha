# Home's tiles

The tiles the owner keeps on [Home](./index.md): which of Alpha's own apps
and which installed apps, in what order, read back when Alpha starts and
saved after every change. The launcher decides when a change is allowed
(only by the owner, only while Home is being edited, only for an app this
phone has) and which tiles are shown; this machine keeps the list, the read
of what was saved and the save on its way.

Old saved names, such as the Workflows tile saved under its earlier name,
or Wallet saved as `alpha:inventory` by a development build of that time
(Alpha 45f6bed30, `alpha-product-registration.ts:308`, `:326`), are turned into today's tiles by the storage service as it parses the
record; a record it cannot parse is unreadable. An earlier Alpha's record
(`alpha.launcher.favorites.v1`, its versions 1 and 2) is read only while
Home has no record of its own, so it is taken up once: the first save
writes today's record, and the earlier one is never read again.

## Story: Keep my apps on Home

> As the owner, I want my tiles kept in the order I chose, found again when
> Alpha starts, and to be told when they could not be read or saved.

### Home's tiles are Alpha's own apps and installed apps: the list shown, the list last saved, the read of what was saved and the save on its way

An installed app is named by its package, activity and profile, never by
its label. A read of what was saved finds a record, finds none, or finds
one it cannot read.

```quint
import read as R from "../../kit/read"
import attempt as A from "../../kit/attempt"
import shell as S from "../shell"

type Tile = Own({ view: S::View }) | Installed({ app: str })
type Found = Saved | Missing | Unreadable
type Tiles = { favourites: List[Tile], saved: List[Tile], load: R::Read, save: A::Attempt }
```

### A tile is there on this phone when Alpha's own app is admitted by it, or the installed app was in the last reading of its apps

The [shell](../shell/) says which of Alpha's own apps this phone admits.

```quint
pure def isInstalled(tile: Tile): bool = match tile { | Installed(i) => true | _ => false }

pure def installs(tile: Tile, app: str): bool = match tile { | Installed(i) => i.app == app | _ => false }

pure def shows(tile: Tile, view: S::View): bool = match tile { | Own(o) => o.view == view | _ => false }

pure def there(apps: Set[str], shell: S::Shell, tile: Tile): bool =
  match tile { | Own(o) => S::available(shell, o.view) | Installed(i) => apps.contains(i.app) }
```

### Home's defaults use the product's Home order, and Home holds at most 4096 tiles

Home starts with every Alpha app this phone admits in Home order. Clock
opens alarms and timers, and Reminders has its own tile beside Clock.

```quint
pure val homeOrder: List[S::View] = List(
  S::Phone, S::Messages, S::Inbox, S::Telegram, S::Slack, S::Calendar, S::Clock, S::Reminders,
  S::Browser, S::Camera, S::Photos, S::Maps, S::Notes, S::Contacts, S::Files, S::Workflows,
  S::Wallet, S::Settings)

pure val defaults: List[Tile] = List(
  Own({ view: S::Phone }), Own({ view: S::Messages }), Own({ view: S::Inbox }), Own({ view: S::Telegram }),
  Own({ view: S::Slack }), Own({ view: S::Calendar }), Own({ view: S::Clock }), Own({ view: S::Reminders }),
  Own({ view: S::Browser }), Own({ view: S::Camera }),
  Own({ view: S::Photos }), Own({ view: S::Maps }), Own({ view: S::Notes }), Own({ view: S::Contacts }),
  Own({ view: S::Files }), Own({ view: S::Workflows }), Own({ view: S::Wallet }), Own({ view: S::Settings }))

pure val maxTiles = 4096

pure val initial: Tiles = { favourites: List(), saved: List(), load: R::unread, save: A::plan(0) }
```

### The defaults hold Alpha's own apps exactly in Home order

```quint
pure val noTile: Tile = Installed({ app: "" })

pure def lawTheDefaultsAreHomeOrder(i: int): bool =
  defaults.length() == homeOrder.length()
    and ((0 <= i and i < homeOrder.length()) implies shows(defaults.nthOr(i, noTile), homeOrder.nthOr(i, S::Phone)))

pure def lawTheCatalogOffersEveryDefaultAndOptionalApp(view: S::View): bool =
  homeOrder.includes(view)
```

### What the simulator tries

```quint
pure val tileValues = Set(
  Own({ view: S::Phone }), Own({ view: S::Inbox }), Own({ view: S::Notes }),
  Installed({ app: "clock" }), Installed({ app: "mail" }))
pure val ontoValues = tileValues
pure val tilesValues = Set(
  List(),
  List(Own({ view: S::Notes }), Installed({ app: "clock" }), Own({ view: S::Inbox })),
  List(Installed({ app: "mail" }), Own({ view: S::Notes })),
  List(Own({ view: S::Inbox }), Own({ view: S::Inbox }), Installed({ app: "clock" })))
pure val leftValues = Set(List(), List(Own({ view: S::Notes })), List(Installed({ app: "clock" }), Own({ view: S::Inbox })))
pure val rightValues = leftValues
pure val iValues = Set(-1, 0, 5, homeOrder.length() - 1, homeOrder.length())
pure val ticketValues = Set(1, 2, 3, 4, 5, 6)
```

### Home shows no tile until what was saved has been read, and changes nothing before then

```quint
pure def ready(t: Tiles): bool = t.load.status == R::Loaded or t.load.status == R::Failed

pure def saving(t: Tiles): bool = t.save.outcome == A::Sent

pure def alwaysNothingIsShownBeforeTheRead(t: Tiles): bool =
  not(ready(t)) implies (t.favourites == List() and t.saved == List() and not(saving(t)))
```

### When Alpha starts, it reads what was saved, once

```quint
pure def canBegin(t: Tiles): bool = t.load.status == R::Idle

pure def begin(t: Tiles): Tiles = { ...t, load: R::ask(t.load) }
```

### What was saved comes back as it was saved, an empty Home included; with no record Home shows its defaults

A record that names a tile twice, or holds more tiles than Home can, is
unreadable. When what was saved cannot be read, Home shows its defaults
and writes nothing until the owner changes it; the launcher says so.

```quint
pure def noTileTwice(tiles: List[Tile]): bool = tiles.every(t => tiles.select(u => u == t).length() == 1)

pure def fits(tiles: List[Tile]): bool = noTileTwice(tiles) and tiles.length() <= maxTiles

pure def canSavedRead(t: Tiles, ticket: int): bool = R::canAnswer(t.load, ticket)

pure def savedRead(t: Tiles, ticket: int, found: Found, tiles: List[Tile]): Tiles =
  val read = found == Saved and fits(tiles)
  val kept = if (read) tiles else defaults
  { ...t, load: R::answer(t.load, read or found == Missing), favourites: kept, saved: kept }
```

### A saved record that fits is shown exactly; any other comes back as the defaults, and only an unreadable one counts as a failed read

```quint
pure val asking: Tiles = begin(initial)

pure def lawWhatWasSavedComesBack(tiles: List[Tile]): bool =
  val back = savedRead(asking, 1, Saved, tiles)
  (fits(tiles) implies (back.favourites == tiles and back.load.status == R::Loaded))
    and (not(fits(tiles)) implies (back.favourites == defaults and back.load.status == R::Failed))
    and savedRead(asking, 1, Missing, tiles).favourites == defaults
    and savedRead(asking, 1, Missing, tiles).load.status == R::Loaded
    and savedRead(asking, 1, Unreadable, tiles).load.status == R::Failed
```

### An app is added once, at the end, while Home holds fewer than its limit

```quint
pure def changed(tiles: List[Tile], t: Tiles): Tiles =
  { ...t, favourites: tiles, save: A::dispatch(A::record(A::plan(t.save.id + 1))) }

pure def canAddTile(t: Tiles, tile: Tile): bool =
  ready(t) and not(saving(t)) and not(t.favourites.includes(tile)) and t.favourites.length() < maxTiles

pure def addTile(t: Tiles, tile: Tile): Tiles = changed(t.favourites.append(tile), t)
```

### A tile on Home can be removed

```quint
pure def canRemoveTile(t: Tiles, tile: Tile): bool = ready(t) and not(saving(t)) and t.favourites.includes(tile)

pure def removeTile(t: Tiles, tile: Tile): Tiles = changed(t.favourites.select(u => u != tile), t)
```

### A tile is moved to just before or just after another

```quint
pure def placed(tiles: List[Tile], tile: Tile, onto: Tile, behind: bool): List[Tile] =
  tiles.foldl(List(), (placed, t) => placed.concat(
    if (t == tile) List()
    else if (t == onto) (if (behind) List(t, tile) else List(tile, t))
    else List(t)))

pure def canMoveTile(t: Tiles, tile: Tile, onto: Tile): bool =
  ready(t) and not(saving(t)) and tile != onto and t.favourites.includes(tile) and t.favourites.includes(onto)

pure def moveTile(t: Tiles, tile: Tile, onto: Tile, behind: bool): Tiles =
  changed(placed(t.favourites, tile, onto, behind), t)
```

### A moved tile lands right beside the tile it was dropped on, with everything before that tile still before it and everything after still after

```quint
pure def lawAMoveLandsBesideItsTarget(left: List[Tile], right: List[Tile], tile: Tile, onto: Tile, behind: bool): bool =
  tile != onto implies placed(left.append(onto).concat(right), tile, onto, behind)
    == placed(left, tile, onto, behind).concat(if (behind) List(onto, tile) else List(tile, onto)).concat(placed(right, tile, onto, behind))
```

### A move leaves every other tile in its order

```quint
pure def lawTheRestKeepTheirOrder(tiles: List[Tile], tile: Tile, onto: Tile, behind: bool): bool =
  placed(tiles, tile, onto, behind).select(t => t != tile) == tiles.select(t => t != tile)
```

### A move keeps exactly the same tiles on Home

```quint
pure def stepAMoveKeepsTheSameTiles(before: Tiles, via: str, after: Tiles): bool =
  via == "moveTile" implies (after.favourites.every(t => before.favourites.includes(t))
    and before.favourites.every(t => after.favourites.includes(t)))
```

### No tile is on Home twice, and Home never holds more than its limit

```quint
pure def alwaysNoTileIsOnHomeTwice(t: Tiles): bool = noTileTwice(t.favourites) and noTileTwice(t.saved)

pure def alwaysHomeHoldsNoMoreThanItsLimit(t: Tiles): bool =
  t.favourites.length() <= maxTiles and t.saved.length() <= maxTiles
```

### Every change is sent whole to be saved, one save at a time, under the next number

```quint
pure def stepEveryChangeIsSentToBeSaved(before: Tiles, via: str, after: Tiles): bool =
  (via == "addTile" or via == "removeTile" or via == "moveTile")
    implies (not(saving(before)) and saving(after) and after.save.id == before.save.id + 1)
```

### A save that lands becomes what is saved; one that fails puts Home back as it was

```quint
pure def canHomeSaved(t: Tiles, ticket: int): bool = A::canConclude(t.save, ticket)

pure def homeSaved(t: Tiles, ticket: int, ok: bool): Tiles =
  val save = A::conclude(t.save, ok, true)
  if (ok) { ...t, save: save, saved: t.favourites } else { ...t, save: save, favourites: t.saved }

pure def stepAFailedSaveChangesNothing(before: Tiles, via: str, after: Tiles): bool =
  (via == "homeSaved" and after.save.outcome == A::Refused)
    implies (after.favourites == before.saved and after.saved == before.saved)
```

### Home shows what is saved, except while a save is on its way

```quint
pure def alwaysHomeShowsWhatIsSaved(t: Tiles): bool = not(saving(t)) implies t.favourites == t.saved
```

### Only the owner's changes, the read of what was saved, a save's answer and a restart change the tiles

```quint
pure def stepOnlyTheOwnerRearrangesHome(before: Tiles, via: str, after: Tiles): bool =
  (after.favourites != before.favourites implies (via == "addTile" or via == "removeTile"
      or via == "moveTile" or via == "homeSaved" or via == "savedRead" or via == "restart"))
    and (after.saved != before.saved implies (via == "homeSaved" or via == "savedRead" or via == "restart"))
```

### A restart forgets the tiles until they are read again, and keeps its numbers rising

A save still on its way at the restart may or may not have landed; the
read after the restart says which. Nothing read or saved before the
restart can answer after it.

```quint
pure def restart(t: Tiles): Tiles =
  { favourites: List(), saved: List(), load: { status: R::Idle, ticket: t.load.ticket },
    save: { id: t.save.id, outcome: A::Planned } }

pure def stepNumbersOnlyRise(before: Tiles, via: str, after: Tiles): bool =
  after.load.ticket >= before.load.ticket and after.save.id >= before.save.id

pure def stepARestartKeepsOnlyItsNumbers(before: Tiles, via: str, after: Tiles): bool =
  via == "restart" implies (after.favourites == List() and not(ready(after)) and not(saving(after))
    and after.load.ticket == before.load.ticket and after.save.id == before.save.id)
```

### Every read and every save ends, as long as the phone's storage answers

```quint
pure def leadsToASaveEnds(t: Tiles, later: Tiles): bool =
  saving(t) implies not(saving(later) and later.save.id == t.save.id)

pure def leadsToTheReadEnds(t: Tiles, later: Tiles): bool =
  t.load.status == R::Loading implies not(later.load.status == R::Loading and later.load.ticket == t.load.ticket)

pure val fair_homeSaved = "weak"
pure val fair_savedRead = "weak"
```

### An installed app can be saved on Home

```quint
pure def sometimesAnInstalledAppIsSaved(t: Tiles): bool =
  not(saving(t)) and t.saved.some(u => match u { | Installed(i) => true | _ => false })
```

### A save can be on its way, and can fail

```quint
pure def sometimesASaveIsOnItsWay(t: Tiles): bool = saving(t)

pure def sometimesASaveFails(t: Tiles): bool = t.save.outcome == A::Refused
```

### An empty Home can be read back, and an unreadable record gives the defaults

```quint
pure def sometimesAnEmptyHomeIsKept(t: Tiles): bool = t.load.status == R::Loaded and t.favourites == List()

pure def sometimesWhatWasSavedIsUnreadable(t: Tiles): bool = t.load.status == R::Failed and t.favourites == defaults
```

### A rearranged Home can be read back after a restart

```quint
pure def sometimesARearrangedHomeIsReadBack(t: Tiles): bool =
  t.load.status == R::Loaded and t.load.ticket > 1 and t.saved.length() > 0 and t.saved != defaults
```

## Story: See what waits in an app

> As the owner, I want Phone, Messages, Inbox, Telegram and Slack to show
> that something waits in them, and no badge to distract me while I
> rearrange Home.

### Only Phone, Messages, Inbox, Telegram and Slack carry a badge, only when something waits there, and no tile does while Home is being edited

As the Sunday demo build drew them (Alpha 45f6bed30,
`apps/app/src/prototype/model.js:342`, `:828`, `:1150`;
`home-shell.ts:186`), Phone's dot is an unheard voicemail (missed
calls wait on the Phone card), Messages' an unread conversation and Inbox's
an unread message.

```quint
pure val badgeViews: Set[S::View] = Set(S::Phone, S::Messages, S::Inbox, S::Telegram, S::Slack)

pure def badged(tile: Tile, something: bool, editing: bool): bool =
  something and not(editing) and (match tile { | Own(o) => badgeViews.contains(o.view) | _ => false })

pure def lawOnlyBadgedAppsCarryABadge(view: S::View, app: str, something: bool, editing: bool): bool =
  (badged(Own({ view: view }), something, editing)
    iff (something and not(editing)
      and (view == S::Phone or view == S::Messages or view == S::Inbox or view == S::Telegram or view == S::Slack)))
    and not(badged(Installed({ app: app }), something, editing))
```
