# Slack authentication

Signing in to one or more Slack workspaces as the owner's own user account via
scope consent and OAuth2 PKCE user tokens, including rotating user tokens. Bot tokens (`xoxb-`) and
non-user tokens are strictly rejected. OAuth authorization codes, PKCE
verifiers, user tokens and refresh tokens are typed as Quint secrets so they can
never enter public state or Ask Alpha context. Every auth or consent screen, and
every unauthenticated state, is marked sensitive.

A deployment that offers a Slack Events receiver exchanges the PKCE code via
Alpha Cloud and renews that grant at the same cloud endpoint. Direct Slack
grants continue to renew at Slack, including grants saved before a receiver
was offered.

## Story: Connect and manage my Slack workspaces with user tokens only

> As the owner, I want to review user scopes before connecting a Slack
> workspace via OAuth2 PKCE, connect multiple workspaces with strict isolation,
> reject any bot token, and revoke or sign out one workspace without disrupting
> the others.

### Auth tracks the OAuth step, state nonce, connected user workspaces, credential revisions and trouble

```quint
type SecretOAuthCode = str
type SecretPkceVerifier = str
type SecretUserToken = str
type SecretRefreshToken = str

type TokenKind = UserToken | BotToken | OtherToken
type Step = Idle | ScopeConsent | BrowserOAuth | Exchanging
type Trouble =
  | Fine
  | ConsentDeclined
  | StateMismatch
  | BotTokenRejected
  | ExchangeFailed
  | Offline
  | WorkspaceRevoked
type ExchangeOutcome =
  | ExchangeUser({ workspace: int, userId: int })
  | ExchangeBot
  | ExchangeErr
type WorkspaceAuth = { workspace: int, userId: int, credentialRev: int, tokenKind: TokenKind }
type Auth = {
  step: Step, ticket: int, nonce: int, nextRev: int,
  connected: List[WorkspaceAuth], revokedWorkspace: int, trouble: Trouble,
}

type Effect =
  | OpenOAuthBrowser({ ticket: int, nonce: int })
  | ExchangeOAuthCode({ ticket: int, nonce: int, code: SecretOAuthCode, verifier: SecretPkceVerifier })
  | StoreWorkspaceToken({ workspace: int, credentialRev: int, token: SecretUserToken, refresh: SecretRefreshToken })
  | ActivateWorkspace({ workspace: int, credentialRev: int })
  | DetachWorkspace({ workspace: int })
  | WipeWorkspace({ workspace: int, credentialRev: int })
  | StopWorkspaceSync({ workspace: int })
type Moved = { state: Auth, out: List[Effect] }

pure val initial: Auth = {
  step: Idle, ticket: 0, nonce: 0, nextRev: 0,
  connected: List(), revokedWorkspace: 0, trouble: Fine,
}

pure def hasWorkspace(connected: List[WorkspaceAuth], workspace: int): bool =
  connected.some(w => w.workspace == workspace)

pure def upsertWorkspace(connected: List[WorkspaceAuth], entry: WorkspaceAuth): List[WorkspaceAuth] =
  connected.select(w => w.workspace != entry.workspace).append(entry)

pure val ticketValues = Set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
pure val nonceValues = Set(1, 2, 3, 4, 5, 6)
pure val workspaceValues = Set(1, 2)
pure val replyValues = Set(
  ExchangeUser({ workspace: 1, userId: 1 }),
  ExchangeUser({ workspace: 2, userId: 2 }),
  ExchangeBot,
  ExchangeErr,
)
pure val codeValues = Set("oauth-code-1")
pure val verifierValues = Set("pkce-verifier-1")
pure val tokenValues = Set("xoxp-user-1")
pure val refreshValues = Set("xoxe-refresh-1")
pure val weight_callbackReceived = 2
pure val weight_exchanged = 2
```

### Every scope consent, OAuth or unauthenticated state is sensitive

```quint
pure def sensitive(s: Auth): bool = s.step != Idle or s.connected.length() == 0

pure def alwaysAuthScreensAreSensitive(s: Auth): bool =
  (s.step != Idle implies sensitive(s)) and (s.connected.length() == 0 implies sensitive(s))
```

### Adding a workspace presents scope consent first, then opens PKCE OAuth with a fresh state nonce

Alpha Cloud publishes the public client ID for this deployment. The phone opens
Slack in a browser with a fresh verifier and the registered return address.
If the registration or browser is unavailable, or the owner declines in Slack,
only that attempt ends and existing workspaces remain connected.

```quint
pure def canStartConnect(s: Auth): bool = s.step == Idle

pure def startConnect(s: Auth): Auth = { ...s, step: ScopeConsent, trouble: Fine }

pure def canDeclineConsent(s: Auth): bool = s.step == ScopeConsent

pure def declineConsent(s: Auth): Auth = { ...s, step: Idle, trouble: ConsentDeclined }

pure def canApproveConsent(s: Auth, online: bool): bool = s.step == ScopeConsent and online

pure def approveConsent(s: Auth, online: bool): Moved =
  val ticket = s.ticket + 1
  val nonce = s.nonce + 1
  {
    state: { ...s, step: BrowserOAuth, ticket: ticket, nonce: nonce, trouble: Fine },
    out: List(OpenOAuthBrowser({ ticket: ticket, nonce: nonce })),
  }
```

### OAuth callback verifies the state nonce and exchanges the secret code and PKCE verifier; only user tokens (`UserToken`) are admitted

The launcher and standalone Slack package receive separate registered callbacks. The
phone keeps each workspace grant under its Alpha owner in encrypted storage. Two
open surfaces reserve the same workspace refresh atomically before requesting a
replacement. An old response cannot revoke a renewed grant, and an expired access
token can be renewed before retrying an operation Slack refused.

```quint
pure def canCallbackReceived(s: Auth, nonce: int): bool = s.step == BrowserOAuth and nonce >= 0

pure def callbackReceived(s: Auth, nonce: int, code: SecretOAuthCode, verifier: SecretPkceVerifier): Moved =
  val ticket = s.ticket + 1
  if (nonce != s.nonce or nonce == 0)
    { state: { ...s, step: Idle, trouble: StateMismatch }, out: List() }
  else {
    state: { ...s, step: Exchanging, ticket: ticket, trouble: Fine },
    out: List(ExchangeOAuthCode({ ticket: ticket, nonce: nonce, code: code, verifier: verifier })),
  }

pure def canExchanged(s: Auth, ticket: int): bool =
  s.step == Exchanging and ticket == s.ticket

pure def exchanged(
  s: Auth, ticket: int, reply: ExchangeOutcome, token: SecretUserToken, refresh: SecretRefreshToken
): Moved =
  val rev = s.nextRev + 1
  match reply {
    | ExchangeErr =>
      { state: { ...s, step: Idle, trouble: ExchangeFailed }, out: List() }
    | ExchangeBot =>
      { state: { ...s, step: Idle, trouble: BotTokenRejected }, out: List() }
    | ExchangeUser(u) =>
      if (u.workspace > 0 and u.userId > 0)
        {
          state: {
            ...s, step: Idle, nextRev: rev,
            connected: upsertWorkspace(s.connected, { workspace: u.workspace, userId: u.userId, credentialRev: rev, tokenKind: UserToken }),
            revokedWorkspace: if (s.revokedWorkspace == u.workspace) 0 else s.revokedWorkspace,
            trouble: Fine,
          },
          out: List(StoreWorkspaceToken({ workspace: u.workspace, credentialRev: rev, token: token, refresh: refresh })),
        }
      else { state: { ...s, step: Idle, trouble: ExchangeFailed }, out: List() }
  }

pure def canBrowserFailed(s: Auth, nonce: int): bool = s.step == BrowserOAuth and nonce == s.nonce

pure def browserFailed(s: Auth, nonce: int, denied: bool): Auth =
  { ...s, step: Idle, trouble: if (denied) ConsentDeclined else ExchangeFailed }

pure def canCancelOAuth(s: Auth): bool = s.step == BrowserOAuth

pure def cancelOAuth(s: Auth): Auth = { ...s, step: Idle, trouble: Fine }
```

### Revoking or signing out one workspace wipes only that workspace and leaves other workspaces connected

```quint
pure def canWorkspaceRevoked(s: Auth, workspace: int): bool =
  workspace > 0 and hasWorkspace(s.connected, workspace)

pure def workspaceRevoked(s: Auth, workspace: int): Moved =
  val rev = s.nextRev + 1
  {
    state: {
      ...s, nextRev: rev,
      connected: s.connected.select(w => w.workspace != workspace),
      revokedWorkspace: workspace, trouble: WorkspaceRevoked,
    },
    out: List(WipeWorkspace({ workspace: workspace, credentialRev: rev }), StopWorkspaceSync({ workspace: workspace })),
  }

pure def canSignOutWorkspace(s: Auth, workspace: int): bool =
  s.step == Idle and workspace > 0 and hasWorkspace(s.connected, workspace)

pure def signOutWorkspace(s: Auth, workspace: int): Moved =
  val rev = s.nextRev + 1
  {
    state: {
      ...s, nextRev: rev,
      connected: s.connected.select(w => w.workspace != workspace),
      trouble: Fine,
    },
    out: List(
      WipeWorkspace({ workspace: workspace, credentialRev: rev }),
      StopWorkspaceSync({ workspace: workspace }),
    ),
  }

pure def restart(s: Auth): Auth = { ...s, step: Idle, trouble: Fine }
```

### Bot tokens are never admitted into connected workspaces, and per-workspace sign-out preserves all other workspaces

```quint
pure def alwaysBotTokensRejected(s: Auth): bool =
  s.ticket >= 0 and s.nonce >= 0 and s.nextRev >= 0
    and s.connected.every(w =>
      w.tokenKind == UserToken and w.workspace > 0 and w.userId > 0
        and w.credentialRev > 0 and w.credentialRev <= s.nextRev
        and s.connected.select(x => x.workspace == w.workspace).length() == 1
    )

pure def stepPerWorkspaceSignOutIsIsolated(before: Auth, via: str, after: Auth, out: List[Effect]): bool =
  (via == "signOutWorkspace" or via == "workspaceRevoked") implies (
    after.connected.every(w => before.connected.includes(w))
      and after.nextRev == before.nextRev + 1
      and out.some(e => match e { | WipeWorkspace(x) => not(hasWorkspace(after.connected, x.workspace)) | _ => false })
      and out.some(e => match e { | StopWorkspaceSync(x) => not(hasWorkspace(after.connected, x.workspace)) | _ => false })
  )

pure def leadsToOAuthExchangeEnds(s: Auth, later: Auth): bool =
  s.step == Exchanging implies later.step != Exchanging

pure val fair_exchanged = "weak"

pure def sometimesMultipleWorkspacesConnected(s: Auth): bool = s.connected.length() >= 2
pure def sometimesBotTokenRejected(s: Auth): bool = s.trouble == BotTokenRejected
pure def sometimesStateMismatchRefused(s: Auth): bool = s.trouble == StateMismatch
pure def sometimesWorkspaceRevoked(s: Auth): bool = s.trouble == WorkspaceRevoked and s.revokedWorkspace > 0
```

### Reopening restores only the user workspaces whose grants the phone kept

The first read after launch restores the signed-in owner’s workspaces. When the Alpha account changes, its previous workspace views close and their cached messages and drafts are cleared. The new owner’s stored workspaces open under fresh workspace identifiers. Each owner keeps their encrypted grants.

```quint
pure def recovered(entries: List[WorkspaceAuth]): Auth =
  { ...initial, connected: entries, nextRev: entries.foldl(0, (n, w) => if (n > w.credentialRev) n else w.credentialRev) }

pure def canRestoreConnections(s: Auth, entries: List[WorkspaceAuth]): bool =
  (s == initial or s.connected != entries or s.step != Idle) and alwaysBotTokensRejected(recovered(entries))

pure def restoreConnections(s: Auth, entries: List[WorkspaceAuth]): Moved =
  val restored = recovered(entries)
  val removed = s.connected.foldl(List(), (items, w) => items.append(DetachWorkspace({ workspace: w.workspace })))
  {
    state: { ...restored, ticket: s.ticket, nonce: s.nonce, nextRev: if (restored.nextRev > s.nextRev) restored.nextRev else s.nextRev },
    out: entries.foldl(removed, (items, w) => items.append(ActivateWorkspace({ workspace: w.workspace, credentialRev: w.credentialRev }))),
  }

pure val entriesValues = Set(List(), List({ workspace: 1, userId: 1, credentialRev: 1, tokenKind: UserToken }))
```
