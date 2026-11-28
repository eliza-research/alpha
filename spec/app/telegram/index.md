# Telegram

The owner's personal Telegram user account on Alpha: the chat list gated by an
authenticated user session, folder and search filters, single-use cursor
pagination, mute changes, offline caching within the authenticated session, and Home attention.
The rest of the area:

- [Authentication](./auth.md): phone code, two-factor password and QR user-account login, FloodWait, revocation and sign-out wipe
- [Conversation](./conversation.md): message timeline, pagination, visible-only mark-read, inline reply, edit, delete and reactions
- [Composer](./composer.md): per-chat drafts, owner vs Alpha provenance, undo, idempotent send and AP-16 split-stage drafts
- [Agent integration](./agent.md): direct reads, bounded privacy-gated ambient context, staged drafts and revision-bound approvals
- [Notices](./notices.md): watermarked sync, suppression, tap deep-links and withdrawal on read or sign-out

## Story: Browse and search my Telegram chats

> As the owner, I want to filter my Telegram chats by folder or unread status,
> search across chats, page back without repeating cursors, mute noisy chats,
> see my last list if the connection drops during my session, and have
> everything wiped the moment my session ends.

### The chat list holds the session gate, selection, ticketed read, pagination cursors, mute attempt, credential-bound cache and Home unread count

```quint
import read as R from "../../kit/read"
import attempt as A from "../../kit/attempt"

type Filter = AllChats | UnreadChats | PinnedChats | ArchivedChats | FolderChat
type Failure = Fine | Offline | Revoked | Unreachable
type ListAnswer =
  | ListOk({ found: int, following: int, unread: int, mentions: int, now: int })
  | ListErr({ failure: Failure })
type Selection = { tab: Filter, folderId: int, query: str }
type Count = { credentialRev: int, unread: int, mentions: int, at: int, fresh: bool }
type ChatList = {
  authenticated: bool, credentialRev: int, selected: Selection,
  list: R::Read, further: bool, failure: Failure,
  pages: int, total: int, cursor: int, spent: Set[int], saved: bool,
  kept: Selection, keptPages: int, keptTotal: int, keptCredential: int,
  muteOp: A::Attempt, mutedChats: Set[int], count: Count,
}

type Effect =
  | ReadChats({ ticket: int, tab: Filter, folderId: int, query: str, cursor: int })
  | SetMute({ id: int, chat: int, muted: bool })
type Moved = { state: ChatList, out: List[Effect] }

pure val defaultSelection: Selection = { tab: AllChats, folderId: 0, query: "" }
pure val noCount: Count = { credentialRev: 0, unread: 0, mentions: 0, at: 0, fresh: false }

pure val initial: ChatList = {
  authenticated: false, credentialRev: 0, selected: defaultSelection,
  list: R::unread, further: false, failure: Fine,
  pages: 0, total: 0, cursor: 0, spent: Set(), saved: false,
  kept: defaultSelection, keptPages: 0, keptTotal: 0, keptCredential: 0,
  muteOp: A::plan(0), mutedChats: Set(), count: noCount,
}

pure val credentialRevValues = Set(1, 2)
pure val folderIdValues = Set(0, 1, 2)
pure val queryValues = Set("", "alex")
pure val ticketValues = 1.to(20)
pure val idValues = Set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
pure val chatValues = Set(1, 2)
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

### A chat list is readable only while authenticated and not revoked

```quint
pure def readable(s: ChatList): bool = s.authenticated and s.credentialRev > 0 and s.failure != Revoked

pure def asking(cursor: int, s: ChatList): Moved =
  val list = R::ask(s.list)
  {
    state: { ...s, list: list, further: cursor != 0 },
    out: List(ReadChats({
      ticket: list.ticket, tab: s.selected.tab, folderId: s.selected.folderId,
      query: s.selected.query, cursor: cursor,
    })),
  }

pure def turned(chosen: Selection, s: ChatList): ChatList =
  val restores = s.keptPages > 0 and s.kept == chosen and s.keptCredential == s.credentialRev
  {
    ...s, selected: chosen, further: false, cursor: 0, spent: Set(),
    pages: if (restores) s.keptPages else 0, total: if (restores) s.keptTotal else 0, saved: restores,
    count: if (restores) { ...s.count, fresh: false } else s.count,
  }
```

### Authentication opens the list under its credential revision; sign-out or revocation wipes the screen, cached list, counts and in-flight reads

```quint
pure def canSessionAuthenticated(s: ChatList, credentialRev: int): bool =
  credentialRev > s.credentialRev and (not(s.authenticated) or credentialRev != s.credentialRev)

pure def sessionAuthenticated(s: ChatList, credentialRev: int): Moved =
  val base = {
    ...initial, authenticated: true, credentialRev: credentialRev,
    list: R::drop(s.list), muteOp: A::plan(s.muteOp.id),
  }
  asking(0, base)

pure def canSessionEnded(s: ChatList): bool = s.authenticated

pure def sessionEnded(s: ChatList): ChatList = {
  ...initial, credentialRev: s.credentialRev,
  list: R::drop(s.list), muteOp: A::plan(s.muteOp.id),
}

pure def stepSignOutWipesEverything(before: ChatList, via: str, after: ChatList): bool =
  via == "sessionEnded" implies (
    not(after.authenticated) and after.pages == 0 and after.keptPages == 0 and after.keptCredential == 0
      and not(after.saved) and after.cursor == 0 and after.list.status != R::Loading
      and after.mutedChats.size() == 0 and after.count == noCount
  )
```

### Choosing a filter, folder, search or refresh reads the first page under a new ticket

```quint
pure def validSelection(tab: Filter, folderId: int): bool =
  (tab == FolderChat and folderId > 0) or (tab != FolderChat and folderId == 0)

pure def canChooseFilter(s: ChatList, tab: Filter, folderId: int): bool =
  readable(s) and validSelection(tab, folderId)
    and (tab != s.selected.tab or folderId != s.selected.folderId or s.selected.query != "")

pure def chooseFilter(s: ChatList, tab: Filter, folderId: int): Moved =
  asking(0, turned({ tab: tab, folderId: folderId, query: "" }, s))

pure def canSearch(s: ChatList, query: str): bool =
  readable(s) and query != s.selected.query

pure def search(s: ChatList, query: str): Moved =
  asking(0, turned({ ...s.selected, query: query }, s))

pure def canRefresh(s: ChatList): bool = readable(s) and s.list.status != R::Loading

pure def refresh(s: ChatList): Moved = asking(0, s)
```

### Only the newest read's answer is taken; revocation wipes cached data, offline failures keep what was on screen as stale

```quint
pure def canListed(s: ChatList, ticket: int): bool =
  R::canAnswer(s.list, ticket) and readable(s)

pure def listed(s: ChatList, ticket: int, answer: ListAnswer): ChatList =
  val counts = s.selected.tab == AllChats and s.selected.query == ""
  val okList = R::answer(s.list, true)
  val errList = R::answer(s.list, false)
  match answer {
    | ListErr(err) =>
      if (err.failure == Revoked)
        {
          ...initial, authenticated: false, credentialRev: s.credentialRev,
          list: errList, failure: Revoked, muteOp: A::plan(s.muteOp.id),
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
          kept: s.selected, keptPages: 1, keptTotal: if (page.found >= 0) page.found else 0, keptCredential: s.credentialRev,
          count: if (counts) {
            credentialRev: s.credentialRev,
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
          keptTotal: s.total + (if (page.found >= 0) page.found else 0), keptCredential: s.credentialRev,
        }
  }
```

### Single-use cursor pagination spends each cursor when loading older chats

```quint
pure def canLoadMore(s: ChatList): bool =
  readable(s) and s.list.status != R::Loading and s.cursor != 0

pure def loadMore(s: ChatList): Moved =
  asking(s.cursor, { ...s, cursor: 0, spent: s.spent.union(Set(s.cursor)) })

pure def alwaysCursorUsedOnce(s: ChatList): bool =
  s.cursor != 0 implies (not(s.spent.contains(s.cursor)) and s.pages > 0 and not(s.saved))

pure def stepCursorSpentOnLoadMore(before: ChatList, via: str, after: ChatList): bool =
  via == "loadMore" implies (after.cursor == 0 and after.spent.contains(before.cursor))
```

### Muting or unmuting a chat runs as a once-only attempt

```quint
pure def canToggleMute(s: ChatList, chat: int, muted: bool): bool =
  readable(s) and chat > 0 and s.muteOp.outcome != A::Sent and muted != s.mutedChats.contains(chat)

pure def toggleMute(s: ChatList, chat: int, muted: bool): Moved =
  val op = A::dispatch(A::record(A::plan(s.muteOp.id + 1)))
  { state: { ...s, muteOp: op }, out: List(SetMute({ id: op.id, chat: chat, muted: muted })) }

pure def canMuteAnswered(s: ChatList, id: int, chat: int): bool =
  A::canConclude(s.muteOp, id) and chat > 0

pure def muteAnswered(s: ChatList, id: int, chat: int, muted: bool, ok: bool, known: bool): ChatList =
  val done = A::conclude(s.muteOp, ok, known)
  val nextMuted =
    if (not(ok) or not(known)) s.mutedChats
    else if (muted) s.mutedChats.union(Set(chat))
    else s.mutedChats.exclude(Set(chat))
  { ...s, muteOp: done, mutedChats: nextMuted }
```

### Reopening the list restores saved counts only for the same authenticated credential and selection

On a cold start, Telegram must confirm the active owner's account before Alpha
shows their chats. If Telegram is unreachable, the phone retains the sealed
grant and keeps the chat list closed. It retries when the owner returns.

```quint
pure def restart(s: ChatList): ChatList =
  val restores = s.authenticated and s.keptPages > 0 and s.kept == s.selected and s.keptCredential == s.credentialRev
  {
    ...s, list: R::drop(s.list), further: false, failure: Fine,
    pages: if (restores) s.keptPages else 0, total: if (restores) s.keptTotal else 0,
    cursor: 0, spent: Set(), saved: restores,
    muteOp: if (s.muteOp.outcome == A::Sent) A::conclude(s.muteOp, false, false) else s.muteOp,
    count: { ...s.count, fresh: false },
  }

pure def alwaysSavedCacheBoundToCredential(s: ChatList): bool =
  (s.keptPages > 0 implies (s.authenticated and s.keptCredential == s.credentialRev))
    and (s.saved implies (s.authenticated and s.pages > 0 and s.kept == s.selected and s.keptPages == s.pages and s.keptCredential == s.credentialRev))
    and (not(s.authenticated) implies (s.pages == 0 and s.keptPages == 0 and s.keptCredential == 0 and s.list.status != R::Loading))
    and s.pages >= 0 and s.total >= 0 and s.keptPages >= 0 and s.keptTotal >= 0 and s.credentialRev >= 0
```

### Home attention reports unread and mention counts only for the active session, never fresh when stale or failed

```quint
type Standing = SignedOut | Checking | Ready | Stale | Unavailable
type Attention = { standing: Standing, unread: int, mentions: int, at: int }

pure def attention(s: ChatList): Attention =
  val counted = s.authenticated and s.count.credentialRev == s.credentialRev and s.count.credentialRev > 0
  val standing =
    if (not(s.authenticated)) SignedOut
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

pure def alwaysAFreshCountWasRead(s: ChatList): bool =
  (s.count.credentialRev > 0 implies (s.authenticated and s.count.credentialRev == s.credentialRev))
    and (s.count.fresh implies (s.authenticated and not(s.saved) and s.failure == Fine and s.count.credentialRev == s.credentialRev))
    and s.count.unread >= 0 and s.count.mentions >= 0 and s.count.mentions <= s.count.unread

pure def leadsToReadEnds(s: ChatList, later: ChatList): bool =
  s.list.status == R::Loading implies not(later.list.status == R::Loading and later.list.ticket == s.list.ticket)

pure val fair_listed = "weak"

pure def sometimesSearchShown(s: ChatList): bool = s.selected.query != "" and s.list.status == R::Loaded and s.total > 0
pure def sometimesSecondPageLoaded(s: ChatList): bool = s.pages >= 2 and s.cursor != 0
pure def sometimesSavedCacheShown(s: ChatList): bool = s.saved and s.pages > 0
pure def sometimesHomeAttentionReady(s: ChatList): bool = attention(s).standing == Ready and attention(s).unread > 0
pure def sometimesMutedChat(s: ChatList): bool = s.mutedChats.size() > 0
```
