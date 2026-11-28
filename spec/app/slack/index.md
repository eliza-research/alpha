# Slack

The owner's Slack user workspaces on Alpha: a multi-workspace registry and
switcher with strict per-workspace isolation (`(workspace, credentialRev)`),
channel, DM, MPIM and Mentions & Threads lists, workspace search, single-use
cursor pagination, local channel notification mutes, credential-bound offline cache and Home
attention. The rest of the area:

- [Authentication](./auth.md): scope consent, OAuth2 PKCE user tokens (`xoxp-`), bot-token rejection and per-workspace isolation
- [Conversation](./conversation.md): channel/DM timeline, Thread drawer (`threadTs`), pagination, visible-only mark-read, edit, delete and reactions
- [Composer](./composer.md): `(workspace, channel, threadTs)` drafts, owner vs Alpha provenance, undo, idempotent send and AP-16 split-stage drafts
- [Agent integration](./agent.md): workspace-scoped reads, bounded privacy-gated ambient context, staged drafts and revision-bound approvals
- [Notices](./notices.md): per-workspace watermarked sync, DM/mention/thread triggers, suppression, tap deep-links and per-workspace withdrawal

## Story: Switch workspaces and browse Slack conversations with strict isolation

> As the owner, I want to switch between my connected Slack workspaces, browse
> channels, DMs, mentions and threads, search inside the active workspace, page
> older results once per cursor, and never see cached data from another or
> revoked workspace.

### The list holds connected workspace links, active workspace selection, ticketed read, cursors, mute attempt, credential-bound cache and Home unread count

```quint
import read as R from "../../kit/read"
import attempt as A from "../../kit/attempt"

type Section = AllConversations | UnreadConversations | MentionsAndThreads | Channels | DirectMessages
type Failure = Fine | Offline | Revoked | Unreachable
type ListAnswer =
  | ListOk({ found: int, following: int, unread: int, mentions: int, now: int })
  | ListErr({ failure: Failure })
type WorkspaceLink = { workspace: int, credentialRev: int }
type Selection = { workspace: int, section: Section, query: str }
type Count = { workspace: int, credentialRev: int, unread: int, mentions: int, at: int, fresh: bool }
type WorkspaceList = {
  connected: List[WorkspaceLink], selected: Selection,
  list: R::Read, further: bool, failure: Failure,
  pages: int, total: int, cursor: int, spent: Set[int], saved: bool,
  kept: Selection, keptPages: int, keptTotal: int, keptCredential: int,
  muteOp: A::Attempt, mutedChannels: Set[int], count: Count,
}

type Effect =
  | ReadConversations({ ticket: int, workspace: int, section: Section, query: str, cursor: int })
  | SetChannelMute({ id: int, workspace: int, channel: int, muted: bool })
type Moved = { state: WorkspaceList, out: List[Effect] }

pure val noLink: WorkspaceLink = { workspace: 0, credentialRev: 0 }
pure val nowhere: Selection = { workspace: 0, section: AllConversations, query: "" }
pure val noCount: Count = { workspace: 0, credentialRev: 0, unread: 0, mentions: 0, at: 0, fresh: false }

pure val initial: WorkspaceList = {
  connected: List(), selected: nowhere,
  list: R::unread, further: false, failure: Fine,
  pages: 0, total: 0, cursor: 0, spent: Set(), saved: false,
  kept: nowhere, keptPages: 0, keptTotal: 0, keptCredential: 0,
  muteOp: A::plan(0), mutedChannels: Set(), count: noCount,
}

pure def linkOf(connected: List[WorkspaceLink], workspace: int): WorkspaceLink =
  connected.foldl(noLink, (found, w) => if (w.workspace == workspace) w else found)

pure def isConnected(connected: List[WorkspaceLink], workspace: int): bool =
  workspace > 0 and connected.some(w => w.workspace == workspace)

pure def credOf(connected: List[WorkspaceLink], workspace: int): int =
  linkOf(connected, workspace).credentialRev

pure def readable(s: WorkspaceList): bool =
  isConnected(s.connected, s.selected.workspace) and s.failure != Revoked

pure val workspaceValues = Set(1, 2)
pure val credentialRevValues = Set(1, 2)
pure val queryValues = Set("", "design")
pure val ticketValues = 1.to(20)
pure val idValues = Set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
pure val channelValues = Set(1, 2)
pure val answerValues = Set(
  ListOk({ found: 0, following: 0, unread: 0, mentions: 0, now: 1 }),
  ListOk({ found: 2, following: 1, unread: 2, mentions: 1, now: 5 }),
  ListOk({ found: 2, following: 2, unread: 2, mentions: 0, now: 5 }),
  ListOk({ found: 1, following: 0, unread: 1, mentions: 0, now: 5 }),
  ListErr({ failure: Offline }),
  ListErr({ failure: Revoked }),
)
pure val weight_listed = 2
pure val weight_muteAnswered = 2
```

### Changing workspace or filter restores only cache matching the exact `(workspace, section, query, credentialRev)`

```quint
pure def asking(cursor: int, s: WorkspaceList): Moved =
  val list = R::ask(s.list)
  {
    state: { ...s, list: list, further: cursor != 0 },
    out: List(ReadConversations({
      ticket: list.ticket, workspace: s.selected.workspace,
      section: s.selected.section, query: s.selected.query, cursor: cursor,
    })),
  }

pure def turned(chosen: Selection, s: WorkspaceList): WorkspaceList =
  val rev = credOf(s.connected, chosen.workspace)
  val restores = s.keptPages > 0 and s.kept == chosen and rev > 0 and s.keptCredential == rev
  {
    ...s, selected: chosen, further: false, failure: Fine, cursor: 0, spent: Set(),
    pages: if (restores) s.keptPages else 0, total: if (restores) s.keptTotal else 0, saved: restores,
    count: if (s.count.workspace != chosen.workspace) noCount else if (restores) { ...s.count, fresh: false } else s.count,
  }
```

### Connecting or removing a workspace isolates every workspace's credential revision, cache and counts

```quint
pure def canWorkspaceConnected(s: WorkspaceList, workspace: int, credentialRev: int): bool =
  workspace > 0 and credentialRev > 0 and credOf(s.connected, workspace) < credentialRev

pure def workspaceConnected(s: WorkspaceList, workspace: int, credentialRev: int): Moved =
  val nextConn = s.connected.select(w => w.workspace != workspace).append({ workspace: workspace, credentialRev: credentialRev })
  val dropKept = s.kept.workspace == workspace and s.keptCredential != credentialRev
  val dropCount = s.count.workspace == workspace and s.count.credentialRev != credentialRev
  val base = {
    ...s, connected: nextConn,
    kept: if (dropKept) nowhere else s.kept,
    keptPages: if (dropKept) 0 else s.keptPages,
    keptTotal: if (dropKept) 0 else s.keptTotal,
    keptCredential: if (dropKept) 0 else s.keptCredential,
    count: if (dropCount) noCount else s.count,
  }
  if (s.selected.workspace == 0 or s.selected.workspace == workspace)
    asking(0, turned({ workspace: workspace, section: AllConversations, query: "" }, base))
  else { state: base, out: List() }

pure def canWorkspaceRemoved(s: WorkspaceList, workspace: int): bool =
  isConnected(s.connected, workspace)

pure def workspaceRemoved(s: WorkspaceList, workspace: int): Moved =
  val rest = s.connected.select(w => w.workspace != workspace)
  val dropKept = s.kept.workspace == workspace
  val dropCount = s.count.workspace == workspace
  val nextWs = rest.nthOr(0, noLink).workspace
  val cleaned = {
    ...s, connected: rest,
    kept: if (dropKept) nowhere else s.kept,
    keptPages: if (dropKept) 0 else s.keptPages,
    keptTotal: if (dropKept) 0 else s.keptTotal,
    keptCredential: if (dropKept) 0 else s.keptCredential,
    count: if (dropCount) noCount else s.count,
  }
  if (rest.length() == 0)
    {
      state: {
        ...cleaned, selected: nowhere, list: R::drop(s.list), further: false, failure: Fine,
        pages: 0, total: 0, cursor: 0, spent: Set(), saved: false,
        muteOp: A::plan(s.muteOp.id),
      },
      out: List(),
    }
  else if (s.selected.workspace != workspace) { state: cleaned, out: List() }
  else asking(0, turned({ workspace: nextWs, section: AllConversations, query: "" }, {
    ...cleaned, muteOp: A::plan(s.muteOp.id),
  }))
```

### Switching workspace, choosing a section, searching or refreshing reads the first page under a new ticket

```quint
pure def canSwitchWorkspace(s: WorkspaceList, workspace: int): bool =
  isConnected(s.connected, workspace) and workspace != s.selected.workspace

pure def switchWorkspace(s: WorkspaceList, workspace: int): Moved =
  asking(0, turned({ workspace: workspace, section: AllConversations, query: "" }, s))

pure def canChooseSection(s: WorkspaceList, section: Section): bool =
  readable(s) and (section != s.selected.section or s.selected.query != "")

pure def chooseSection(s: WorkspaceList, section: Section): Moved =
  asking(0, turned({ ...s.selected, section: section, query: "" }, s))

pure def canSearch(s: WorkspaceList, query: str): bool =
  readable(s) and query != s.selected.query

pure def search(s: WorkspaceList, query: str): Moved =
  asking(0, turned({ ...s.selected, query: query }, s))

pure def canRefresh(s: WorkspaceList): bool = readable(s) and s.list.status != R::Loading

pure def refresh(s: WorkspaceList): Moved = asking(0, s)
```

### Only the newest read answers; revocation wipes only the revoked workspace's cache

```quint
pure def canListed(s: WorkspaceList, ticket: int): bool =
  R::canAnswer(s.list, ticket) and readable(s)

pure def listed(s: WorkspaceList, ticket: int, answer: ListAnswer): WorkspaceList =
  val rev = credOf(s.connected, s.selected.workspace)
  val counts = s.selected.section == AllConversations and s.selected.query == ""
  val okList = R::answer(s.list, true)
  val errList = R::answer(s.list, false)
  match answer {
    | ListErr(err) =>
      if (err.failure == Revoked)
        {
          ...s, list: errList, further: false, failure: Revoked,
          pages: 0, total: 0, cursor: 0, spent: Set(), saved: false,
          kept: if (s.kept.workspace == s.selected.workspace) nowhere else s.kept,
          keptPages: if (s.kept.workspace == s.selected.workspace) 0 else s.keptPages,
          keptTotal: if (s.kept.workspace == s.selected.workspace) 0 else s.keptTotal,
          keptCredential: if (s.kept.workspace == s.selected.workspace) 0 else s.keptCredential,
          count: if (s.count.workspace == s.selected.workspace) noCount else s.count,
        }
      else
        {
          ...s, list: errList, further: false,
          failure: if (err.failure == Fine) Unreachable else err.failure,
          count: { ...s.count, fresh: false },
        }
    | ListOk(page) =>
      if (not(s.further))
        {
          ...s, list: okList, failure: Fine, pages: 1,
          total: if (page.found >= 0) page.found else 0,
          cursor: page.following, spent: Set(), saved: false,
          kept: s.selected, keptPages: 1, keptTotal: if (page.found >= 0) page.found else 0, keptCredential: rev,
          count: if (counts) {
            workspace: s.selected.workspace, credentialRev: rev,
            unread: if (page.unread >= 0) page.unread else 0,
            mentions: if (page.mentions < 0) 0 else if (page.mentions > (if (page.unread >= 0) page.unread else 0)) (if (page.unread >= 0) page.unread else 0) else page.mentions,
            at: page.now, fresh: true,
          } else s.count,
        }
      else
        {
          ...s, list: okList, failure: Fine, further: false, pages: s.pages + 1,
          total: s.total + (if (page.found >= 0) page.found else 0),
          cursor: if (page.following != 0 and not(s.spent.contains(page.following))) page.following else 0,
          saved: false,
          kept: s.selected, keptPages: s.pages + 1,
          keptTotal: s.total + (if (page.found >= 0) page.found else 0), keptCredential: rev,
        }
  }
```

### Single-use cursor pagination and channel mute attempts

A channel mute suppresses Alpha notices for this connection on this device.
The resident assigns channels unique numbers across workspaces, so switching
workspaces preserves each channel’s mute.

```quint
pure def canLoadMore(s: WorkspaceList): bool =
  readable(s) and s.list.status != R::Loading and s.cursor != 0

pure def loadMore(s: WorkspaceList): Moved =
  asking(s.cursor, { ...s, cursor: 0, spent: s.spent.union(Set(s.cursor)) })

pure def canToggleMute(s: WorkspaceList, channel: int, muted: bool): bool =
  readable(s) and channel > 0 and s.muteOp.outcome != A::Sent and muted != s.mutedChannels.contains(channel)

pure def toggleMute(s: WorkspaceList, channel: int, muted: bool): Moved =
  val op = A::dispatch(A::record(A::plan(s.muteOp.id + 1)))
  { state: { ...s, muteOp: op }, out: List(SetChannelMute({ id: op.id, workspace: s.selected.workspace, channel: channel, muted: muted })) }

pure def canMuteAnswered(s: WorkspaceList, id: int, channel: int): bool =
  A::canConclude(s.muteOp, id) and channel > 0

pure def muteAnswered(s: WorkspaceList, id: int, channel: int, muted: bool, ok: bool, known: bool): WorkspaceList =
  val done = A::conclude(s.muteOp, ok, known)
  val nextMuted =
    if (not(ok) or not(known)) s.mutedChannels
    else if (muted) s.mutedChannels.union(Set(channel))
    else s.mutedChannels.exclude(Set(channel))
  { ...s, muteOp: done, mutedChannels: nextMuted }

pure def restart(s: WorkspaceList): WorkspaceList =
  val rev = credOf(s.connected, s.selected.workspace)
  val restores = readable(s) and s.keptPages > 0 and s.kept == s.selected and rev > 0 and s.keptCredential == rev
  {
    ...s, list: R::drop(s.list), further: false, failure: Fine,
    pages: if (restores) s.keptPages else 0, total: if (restores) s.keptTotal else 0,
    cursor: 0, spent: Set(), saved: restores,
    muteOp: if (s.muteOp.outcome == A::Sent) A::conclude(s.muteOp, false, false) else s.muteOp,
    count: { ...s.count, fresh: false },
  }
```

### Strict per-workspace isolation, credential-bound offline cache, single-use cursors and Home attention

```quint
pure def alwaysWorkspaceIsolation(s: WorkspaceList): bool =
  s.connected.every(w => w.workspace > 0 and w.credentialRev > 0
      and s.connected.select(x => x.workspace == w.workspace).length() == 1)
    and (s.connected.length() == 0 implies (s.selected.workspace == 0 and s.pages == 0 and s.keptPages == 0 and s.list.status != R::Loading))
    and (s.selected.workspace > 0 implies isConnected(s.connected, s.selected.workspace))
    and (s.keptPages > 0 implies (isConnected(s.connected, s.kept.workspace) and credOf(s.connected, s.kept.workspace) == s.keptCredential))
    and (s.saved implies (s.pages > 0 and s.kept == s.selected and s.keptPages == s.pages
      and credOf(s.connected, s.selected.workspace) == s.keptCredential))
    and (s.count.workspace > 0 implies (isConnected(s.connected, s.count.workspace)
      and credOf(s.connected, s.count.workspace) == s.count.credentialRev))
    and (s.count.fresh implies (s.count.workspace > 0 and s.count.workspace == s.selected.workspace and not(s.saved) and s.failure == Fine))
    and s.pages >= 0 and s.total >= 0 and s.keptPages >= 0 and s.keptTotal >= 0
    and s.count.unread >= 0 and s.count.mentions >= 0 and s.count.mentions <= s.count.unread

pure def alwaysCursorUsedOnce(s: WorkspaceList): bool =
  s.cursor != 0 implies (not(s.spent.contains(s.cursor)) and s.pages > 0 and not(s.saved))

type Standing = SignedOut | Checking | Ready | Stale | Unavailable
type Attention = { standing: Standing, unread: int, mentions: int, at: int }

pure def attention(s: WorkspaceList): Attention =
  val counted = s.count.workspace > 0 and s.count.workspace == s.selected.workspace
  val standing =
    if (s.connected.length() == 0) SignedOut
    else if (counted and s.count.fresh) Ready
    else if (counted) Stale
    else if (s.failure != Fine or s.list.status == R::Failed) Unavailable
    else Checking
  {
    standing: standing,
    unread: if (counted) s.count.unread else 0,
    mentions: if (counted) s.count.mentions else 0,
    at: if (counted) s.count.at else 0,
  }

pure def leadsToReadEnds(s: WorkspaceList, later: WorkspaceList): bool =
  s.list.status == R::Loading implies not(later.list.status == R::Loading and later.list.ticket == s.list.ticket)

pure val fair_listed = "weak"

pure def sometimesSwitchedWorkspace(s: WorkspaceList): bool = s.connected.length() >= 2 and s.selected.workspace == 2
pure def sometimesSecondPageLoaded(s: WorkspaceList): bool = s.pages >= 2 and s.cursor != 0
pure def sometimesSavedCacheShown(s: WorkspaceList): bool = s.saved and s.pages > 0
pure def sometimesHomeAttentionReady(s: WorkspaceList): bool = attention(s).standing == Ready and attention(s).unread > 0
pure def sometimesMutedChannel(s: WorkspaceList): bool = s.mutedChannels.size() > 0
```
