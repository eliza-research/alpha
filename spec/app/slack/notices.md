# Slack notices

Per-workspace watermarked sync and notification rules for [Slack](./): DM,
`@mention` and participated-thread triggers only after a workspace's baseline
watermark (`since != 0`) is established, strict suppression of own, muted and
currently visible front `(workspace, channel, threadTs)` messages, deep-link
opening on notice tap, and per-workspace withdrawal on read, sign-out or
revocation. Live notices require a Slack Events API receiver with an active
workspace subscription. A connected handset polls its own cloud mailbox with the
current user grant, resumes from the last reply's cursor and respects a
rate-limit retry delay. Signing out stops the poll. A workspace connected
directly to Slack can enable these notices by reconnecting after the cloud
receiver becomes available. The handset keeps reading new messages and updating unread counts even when Android denies notification permission. An owner can enable the Slack channel from the workspace. A notice binds to the verified Alpha owner and the specific Slack authorization. Renewing the access token keeps that binding and fresh consent replaces it. The notice carries the durable Slack team, channel and optional parent timestamp; tapping it after a restart restores that exact conversation only for the matching account. Reading, disconnecting or blocking notices withdraws corresponding system notifications. Both signed Android surfaces report their visible workspace, channel and thread so a message already on screen stays quiet. A browser notice can open the verified thread directly from Home or another app. When the deployment has no receiver, Alpha shows
that live notifications are unavailable and offers manual refresh.

## Story: Hear about Slack DMs, mentions and thread replies per workspace

> As the owner, I want notifications for new Slack DMs, mentions and thread
> replies after each workspace connects, never for my own messages, muted
> channels or the conversation I am reading, and signing out one workspace to
> withdraw only that workspace's notices.

### Watching holds connected workspaces, per-workspace watermarks, active poll, muted channels, visible front target and posted notices

```quint
import read as R from "../../kit/read"

type ConvKind = PublicChannel | PrivateChannel | DirectMsg | GroupDm
type Target = { workspace: int, channel: int, threadTs: int }
type Incoming = { channel: int, threadTs: int, ts: int, kind: ConvKind, isOwn: bool, mentioned: bool, inThread: bool }
type Posted = { target: Target, ts: int }
type Notices = {
  connected: Set[int], notifyAllowed: bool, check: R::Read, checkingWorkspace: int,
  watermarks: int -> int, mutedChannels: Set[int],
  front: Target, up: List[Posted], posts: int,
}

type Effect =
  | ScheduleWorkspace({ workspace: int })
  | UnscheduleWorkspace({ workspace: int })
  | PollWorkspace({ ticket: int, workspace: int, since: int })
  | PostNotice({ target: Target, ts: int })
  | WithdrawTarget({ target: Target })
  | WithdrawWorkspace({ workspace: int })
  | WithdrawAll
type Noticed = { state: Notices, out: List[Effect] }

pure val noTarget: Target = { workspace: 0, channel: 0, threadTs: 0 }

pure val initial: Notices = {
  connected: Set(), notifyAllowed: false, check: R::unread, checkingWorkspace: 0,
  watermarks: Map(), mutedChannels: Set(),
  front: noTarget, up: List(), posts: 0,
}

pure def sinceOf(ws: int, m: int -> int): int =
  if (m.keys().contains(ws)) m.get(ws) else 0

pure def watching(s: Notices, workspace: int): bool =
  s.connected.contains(workspace)

pure val workspaceValues = Set(0, 1, 2)
pure val channelValues = Set(0, 1, 2)
pure val threadTsValues = Set(0, 1)
pure val pointValues = Set(1, 2)
pure val ticketValues = Set(1, 2, 3, 4)
pure val incomingValues = Set(
  { channel: 1, threadTs: 0, ts: 1, kind: DirectMsg, isOwn: false, mentioned: false, inThread: false },
  { channel: 1, threadTs: 0, ts: 2, kind: DirectMsg, isOwn: true, mentioned: false, inThread: false },
  { channel: 1, threadTs: 0, ts: 1, kind: PublicChannel, isOwn: false, mentioned: true, inThread: false },
  { channel: 1, threadTs: 1, ts: 2, kind: PublicChannel, isOwn: false, mentioned: false, inThread: true },
  { channel: 2, threadTs: 0, ts: 1, kind: PublicChannel, isOwn: false, mentioned: false, inThread: false },
  { channel: 0, threadTs: 0, ts: 0, kind: DirectMsg, isOwn: false, mentioned: false, inThread: false },
)
pure val weight_poll = 2
pure val weight_polled = 2
```

### Own, muted and currently visible front target messages are suppressed; DMs, channel mentions and participated thread replies trigger

```quint
pure def shouldNotify(
  isOwn: bool, muted: bool, front: Target, target: Target, kind: ConvKind, mentioned: bool, inThread: bool
): bool =
  target.workspace > 0 and target.channel > 0 and not(isOwn) and not(muted) and front != target
    and (kind == DirectMsg or kind == GroupDm or mentioned or (target.threadTs > 0 and inThread))

pure def lawSuppressedMessagesNeverNotify(workspace: int, channel: int, threadTs: int, kind: ConvKind, mentioned: bool, inThread: bool): bool =
  val target = { workspace: workspace, channel: channel, threadTs: threadTs }
  not(shouldNotify(true, false, noTarget, target, kind, mentioned, inThread))
    and not(shouldNotify(false, true, noTarget, target, kind, mentioned, inThread))
    and not(shouldNotify(false, false, target, target, kind, mentioned, inThread))
```

### Connecting, removing or toggling notification permission schedules and withdraws cleanly per workspace

```quint
pure def canNotifyPermissionChanged(s: Notices, notifyAllowed: bool): bool =
  notifyAllowed != s.notifyAllowed

pure def notifyPermissionChanged(s: Notices, notifyAllowed: bool): Noticed =
  if (not(notifyAllowed))
    {
      state: { ...s, notifyAllowed: false, up: List() },
      out: if (s.connected.size() > 0 or s.up.length() > 0) List(WithdrawAll) else List(),
    }
  else { state: { ...s, notifyAllowed: true }, out: List() }

pure def canWorkspaceAdded(s: Notices, workspace: int): bool =
  workspace > 0 and not(s.connected.contains(workspace))

pure def workspaceAdded(s: Notices, workspace: int): Noticed = {
  state: { ...s, connected: s.connected.union(Set(workspace)), watermarks: s.watermarks.put(workspace, 0) },
  out: List(ScheduleWorkspace({ workspace: workspace })),
}

pure def canWorkspaceRemoved(s: Notices, workspace: int): bool =
  s.connected.contains(workspace)

pure def workspaceRemoved(s: Notices, workspace: int): Noticed =
  val dropPoll = s.checkingWorkspace == workspace
  {
    state: {
      ...s,
      connected: s.connected.exclude(Set(workspace)),
      watermarks: s.watermarks.put(workspace, 0),
      check: if (dropPoll) R::drop(s.check) else s.check,
      checkingWorkspace: if (dropPoll) 0 else s.checkingWorkspace,
      front: if (s.front.workspace == workspace) noTarget else s.front,
      up: s.up.select(p => p.target.workspace != workspace),
    },
    out: List(UnscheduleWorkspace({ workspace: workspace }), WithdrawWorkspace({ workspace: workspace })),
  }

pure def canMuteChannelChanged(s: Notices, channel: int, isMuted: bool): bool =
  channel > 0 and isMuted != s.mutedChannels.contains(channel)

pure def muteChannelChanged(s: Notices, channel: int, isMuted: bool): Notices =
  { ...s, mutedChannels: if (isMuted) s.mutedChannels.union(Set(channel)) else s.mutedChannels.exclude(Set(channel)) }
```

### Polling reads updates per workspace; first answer sets baseline watermark quietly and later answers post only eligible notices

```quint
pure def canPoll(s: Notices, workspace: int): bool =
  workspace > 0 and watching(s, workspace) and s.check.status != R::Loading

pure def poll(s: Notices, workspace: int): Noticed =
  val check = R::ask(s.check)
  {
    state: { ...s, check: check, checkingWorkspace: workspace },
    out: List(PollWorkspace({ ticket: check.ticket, workspace: workspace, since: sinceOf(workspace, s.watermarks) })),
  }

pure def canPolled(s: Notices, ticket: int, ok: bool, point: int, incoming: Incoming): bool =
  s.checkingWorkspace > 0 and watching(s, s.checkingWorkspace)
    and R::canAnswer(s.check, ticket) and incoming.channel >= 0 and incoming.threadTs >= 0 and incoming.ts >= 0
    and (ok implies (point >= 1 and (sinceOf(s.checkingWorkspace, s.watermarks) != 0 implies point >= sinceOf(s.checkingWorkspace, s.watermarks))))

pure def polled(s: Notices, ticket: int, ok: bool, point: int, incoming: Incoming): Noticed =
  val ws = s.checkingWorkspace
  val prior = sinceOf(ws, s.watermarks)
  val check = R::answer(s.check, ok)
  val target = { workspace: ws, channel: incoming.channel, threadTs: incoming.threadTs }
  val eligible =
    s.notifyAllowed and ok and prior != 0 and incoming.channel > 0 and incoming.ts > 0
      and shouldNotify(
        incoming.isOwn, s.mutedChannels.contains(incoming.channel), s.front, target,
        incoming.kind, incoming.mentioned, incoming.inThread
      )
  if (not(ok)) { state: { ...s, check: check, checkingWorkspace: 0 }, out: List() }
  else if (prior == 0)
    { state: { ...s, check: check, checkingWorkspace: 0, watermarks: s.watermarks.put(ws, point) }, out: List() }
  else if (eligible)
    {
      state: {
        ...s, check: check, checkingWorkspace: 0, watermarks: s.watermarks.put(ws, point),
        up: s.up.select(p => p.target != target).append({ target: target, ts: incoming.ts }),
        posts: s.posts + 1,
      },
      out: List(PostNotice({ target: target, ts: incoming.ts })),
    }
  else { state: { ...s, check: check, checkingWorkspace: 0, watermarks: s.watermarks.put(ws, point) }, out: List() }
```

### Visible read withdraws matching target notices, and tapping a posted notice deep-links to its workspace, channel and thread

```quint
pure def canFrontChanged(s: Notices, workspace: int, channel: int, threadTs: int): bool =
  val target = { workspace: workspace, channel: channel, threadTs: threadTs }
  target != s.front and workspace >= 0 and channel >= 0 and threadTs >= 0
    and (workspace == 0 or (s.connected.contains(workspace) and channel > 0))
    and (workspace == 0 implies (channel == 0 and threadTs == 0))

pure def frontChanged(s: Notices, workspace: int, channel: int, threadTs: int): Noticed =
  val target = { workspace: workspace, channel: channel, threadTs: threadTs }
  {
    state: { ...s, front: target, up: s.up.select(p => p.target != target) },
    out: if (target != noTarget) List(WithdrawTarget({ target: target })) else List(),
  }

pure def restart(s: Notices): Notices =
  { ...s, check: R::drop(s.check), checkingWorkspace: 0, front: noTarget }
```

### Per-workspace isolation, baseline gating, withdrawal on visible read and isolated workspace revocation

```quint
pure def alwaysNoticesIsolated(s: Notices): bool =
  s.posts >= 0 and s.checkingWorkspace >= 0
    and (s.check.status == R::Loading implies (s.checkingWorkspace > 0 and watching(s, s.checkingWorkspace)))
    and (s.check.status != R::Loading implies s.checkingWorkspace == 0)
    and (not(s.notifyAllowed) implies s.up.length() == 0)
    and (s.front != noTarget implies (s.connected.contains(s.front.workspace) and s.front.channel > 0))
    and s.up.every(p => watching(s, p.target.workspace) and p.target.channel > 0 and p.ts > 0 and p.target != s.front)

pure def stepNoNoticeBeforeBaseline(before: Notices, via: str, after: Notices, out: List[Effect]): bool =
  out.every(e => match e {
    | PostNotice(p) =>
      via == "polled" and before.notifyAllowed and before.checkingWorkspace == p.target.workspace
        and sinceOf(p.target.workspace, before.watermarks) != 0
        and p.target != before.front and not(before.mutedChannels.contains(p.target.channel))
        and after.up.some(u => u.target == p.target and u.ts == p.ts)
    | _ => true
  })

pure def stepWorkspaceRevokeWithdrawsOnlyThatWorkspace(before: Notices, via: str, after: Notices, out: List[Effect]): bool =
  via == "workspaceRemoved" implies (
    after.up.every(p => before.up.includes(p))
      and out.some(e => match e { | WithdrawWorkspace(w) => not(after.connected.contains(w.workspace)) | _ => false })
      and out.some(e => match e { | UnscheduleWorkspace(w) => not(after.connected.contains(w.workspace)) | _ => false })
  )

pure def stepReadingWithdrawsNotices(before: Notices, via: str, after: Notices, out: List[Effect]): bool =
  (via == "frontChanged" and after.front != noTarget and before.up.some(p => p.target == after.front)) implies (
    not(after.up.some(p => p.target == after.front)) and out.includes(WithdrawTarget({ target: after.front }))
  )

pure def sometimesBaselineSetQuietly(s: Notices): bool = s.connected.contains(1) and sinceOf(1, s.watermarks) > 0 and s.posts == 0
pure def sometimesNoticePosted(s: Notices): bool = s.up.length() >= 1 and s.posts >= 1
pure def sometimesNoticeWithdrawnOnRead(s: Notices): bool = s.front != noTarget and s.posts >= 1 and not(s.up.some(p => p.target == s.front))
```
