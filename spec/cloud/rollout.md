# Rollout

Alpha Cloud runs on Cloudflare at the hosted origins in `@repo/deployment`.
Eliza's Worker (`@elizaos/cloud-worker`) serves the operator's profile on
the API origin. A web Worker serves the App Link host. Before this serve
step of [provisioning](./provisioning.md), the operator migrates, registers
and checks prices with eliza's commands against the database the API Worker
reaches through Hyperdrive.

## Story: Deploy an environment without reading a secret into the repository

> As the operator, I want one command to put an environment of Alpha's own
> cloud on Cloudflare, refusing before it changes anything when a secret, a
> resource or the configuration is not right, and never minting a key on a
> machine that would lose it.

### A rollout starts with no secret read, nothing checked and nothing deployed

```quint
type Vault = Unread | Incomplete | Complete
type Resources = Unchecked | Verified | Conflicting
type Worker = Waiting | Deployed
type Rollout = { frozen: bool, vault: Vault, generated: bool, resources: Resources, rendered: bool, api: Worker, edge: Worker }

pure val initial: Rollout = { frozen: false, vault: Unread, generated: false, resources: Unchecked, rendered: false, api: Waiting, edge: Waiting }
```

### A rollout run by CI is frozen before it reads its secrets

```quint
pure def canFreeze(r: Rollout): bool = r.vault == Unread and not(r.frozen)

pure def freeze(r: Rollout): Rollout = { ...r, frozen: true }
```

### Reading the secrets generates each missing internal secret once, except in a frozen rollout, and they are complete only when every one is there and fits its environment

```quint
pure def canReadSecrets(r: Rollout): bool = r.vault == Unread

pure def readSecrets(r: Rollout, internalMissing: bool, providedFit: bool): Rollout =
  val generates = internalMissing and not(r.frozen)
  { ...r, generated: generates, vault: if (providedFit and (not(internalMissing) or generates)) Complete else Incomplete }
```

### The Cloudflare resources are checked only once the secrets are complete

```quint
pure def canCheckResources(r: Rollout): bool = r.vault == Complete and r.resources == Unchecked

pure def checkResources(r: Rollout, recorded: bool): Rollout = { ...r, resources: if (recorded) Verified else Conflicting }
```

### The Workers are rendered only for verified resources

```quint
pure def canRender(r: Rollout): bool = r.resources == Verified and not(r.rendered)

pure def render(r: Rollout): Rollout = { ...r, rendered: true }
```

### The API Worker and the web host are each deployed once rendered

The web host reaches the API Worker through its binding, so it may follow it
or go alone when only the web host changed.

```quint
pure def canDeployApi(r: Rollout): bool = r.rendered and r.api == Waiting

pure def deployApi(r: Rollout): Rollout = { ...r, api: Deployed }

pure def canDeployEdge(r: Rollout): bool = r.rendered and r.edge == Waiting

pure def deployEdge(r: Rollout): Rollout = { ...r, edge: Deployed }
```

### Nothing is checked out of order

```quint
pure def alwaysChecksComeInOrder(r: Rollout): bool =
  (r.rendered implies r.resources == Verified) and (r.resources != Unchecked implies r.vault == Complete)
```

### Nothing is deployed before the secrets are complete, the resources verified and the configuration rendered

```quint
pure def alwaysDeployedOnlyWhenReady(r: Rollout): bool =
  (r.api == Deployed or r.edge == Deployed) implies (r.vault == Complete and r.resources == Verified and r.rendered)
```

### A frozen rollout generates no secret

A sealing or entitlement key minted on a CI runner would be lost with it, and
every phone would be signed out.

```quint
pure def alwaysFrozenGeneratesNothing(r: Rollout): bool =
  (r.frozen implies not(r.generated)) and (r.vault == Unread implies not(r.generated))
```

### A rollout can deploy both Workers

```quint
pure def sometimesBothDeployed(r: Rollout): bool = r.api == Deployed and r.edge == Deployed
```

### A rollout can stop on its secrets

```quint
pure def sometimesStoppedOnSecrets(r: Rollout): bool = r.vault == Incomplete
```

### A rollout can stop on its resources

```quint
pure def sometimesStoppedOnResources(r: Rollout): bool = r.resources == Conflicting
```

## Story: Keep every secret private and fitting its environment

> As the owner, I want the cloud's secrets kept in a file only the operator
> can read, outside the repository, and never a live payment key in staging
> or a test one in production.

### The secrets file lies outside the checkout and only its owner may read it

```quint
pure def secretsFileAccepted(insideCheckout: bool, othersMayRead: bool): bool = not(insideCheckout) and not(othersMayRead)
```

### Production takes only a live payment key, and staging only a test key

```quint
pure def paymentKeyFits(production: bool, live: bool): bool = production == live
```

## Story: Create an environment's Cloudflare resources once

> As the operator, I want provisioning to create only what is missing, to
> find by name what a stopped run already created, and to stop at a resource
> that belongs to something else, so that running it again is always safe.

### Each resource is kept when it is the one recorded, created only when absent and creating, and otherwise refused

```quint
type Observed = Absent | Recorded | Foreign
type Reconcile = Create | Keep | Refuse

pure def reconcile(observed: Observed, creating: bool): Reconcile =
  if (observed == Recorded) Keep else if (observed == Absent and creating) Create else Refuse

pure def lawNeverCreatesOverAnother(observed: Observed, creating: bool): bool =
  reconcile(observed, creating) == Create implies observed == Absent
```

## Story: Render a deployment only when it is provisioned

> As the operator, I want a Worker configuration written only for Cloudflare
> resources that exist, on hosts in Alpha's zone, and never one that points
> at the shipped Eliza Cloud.

### A configuration is rendered only for a provisioned account and database, on hosts in Alpha's zone

```quint
type ResourceId = Provisioned | Placeholder | Malformed
type RenderProblem = AccountUnprovisioned | DatabaseUnprovisioned | ApiOutsideZone | WebOutsideZone

pure def renderProblems(account: ResourceId, database: ResourceId, apiInZone: bool, webInZone: bool): List[RenderProblem] =
  (if (account == Provisioned) List() else List(AccountUnprovisioned))
    .concat(if (database == Provisioned) List() else List(DatabaseUnprovisioned))
    .concat(if (apiInZone) List() else List(ApiOutsideZone))
    .concat(if (webInZone) List() else List(WebOutsideZone))

pure def lawRenderedOnlyWhenProvisioned(account: ResourceId, database: ResourceId, apiInZone: bool, webInZone: bool): bool =
  renderProblems(account, database, apiInZone, webInZone) == List()
    implies (account == Provisioned and database == Provisioned and apiInZone and webInZone)
```

### A rendered configuration that names a host of the shipped Eliza Cloud is refused

```quint
pure def renderAccepted(problems: List[RenderProblem], namesElizaCloud: bool): bool =
  problems == List() and not(namesElizaCloud)
```

## Story: Serve one reviewed profile from the API Worker

> As the owner, I want the API Worker to serve exactly the profile the
> operator reviewed, and to ask a phone to try again rather than serve
> another.

A phone built with Alpha’s own Telegram application registration verifies its numeric
API ID (1 through 2,147,483,647) at `GET /.well-known/alpha-telegram` before starting an MTProto sign-in.
The Android build takes `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from its release
configuration. The Cloud deployment takes only `TELEGRAM_API_ID` and returns 503
until it is configured. The phone sends login codes and two-factor proofs directly to Telegram.
The signed-in Alpha owner’s exported MTProto session stays in the phone’s secure store.

With a verified profile, `GET /.well-known/alpha-slack` publishes the deployment's
registered public Slack client ID. Its operator supplies `SLACK_CLIENT_ID`
from the Alpha Slack app with PKCE enabled. Register
`alphaphone://slack/oauth/callback` for the launcher and
`alphaphone://slack/oauth/standalone` for the standalone Slack app. For browser
access, also register `/alpha-slack-return` on the deployment’s `WEB_ORIGIN`,
for example `https://cloud.alphaphone.dev/alpha-slack-return` in production.
The owner opens `/slack` on that same web origin. The opener keeps the verifier
and Slack user grant in memory for its tab. A separate return document removes
the code from browser history and sends it to the waiting tab on its own
origin. The API Worker serves these two documents and their bundled assets
from the reviewed deployment. Native callbacks continue to use the registered
launcher and standalone app addresses.
An absent or malformed ID yields a retryable 503. For live workspace
notices, the operator enables token rotation and the Slack Events API, subscribes
on behalf of users to `message.channels`, `message.groups`, `message.im` and
`message.mpim`, and registers the API host's `/api/slack/events` as the request
URL. The operator supplies `SLACK_SIGNING_SECRET`, `SLACK_APP_ID` and an
app-level `SLACK_APP_TOKEN` with `authorizations:read`. The API advertises
`notifications: true` when those bindings are present. Alpha's PKCE exchange
then passes through the Worker, which retains credential digests for the
authorized human installation for the credential's lifetime, up to 30 days.
The Worker validates Slack's signature and timestamp and acknowledges a callback
once its message reference is saved. Background dispatch continues across
pagination, rate limits and Worker restarts to resolve the individual
installations entitled to the event. It
queues up to 128 message references per recipient for an hour. A connected phone
uses its own enrolled grant. The Worker rereads each message at Slack with that
grant before returning it. A phone can connect directly to Slack when live
notices have not been configured.

### The API Worker serves only while the profile in its assets is the text its pinned digest names, and otherwise asks the caller to retry

The profile is larger than a Worker variable may be, so the Worker's static
assets carry it beside eliza's return pages, and a variable pins its digest.

```quint
type WorkerAnswer = Served | Unavailable

pure def workerAnswer(pinned: bool, found: bool, matches: bool): WorkerAnswer =
  if (pinned and found and matches) Served else Unavailable

pure def lawServesOnlyThePinnedProfile(pinned: bool, found: bool, matches: bool): bool =
  workerAnswer(pinned, found, matches) == Served implies (pinned and found and matches)
```

### The API Worker's bindings repeat its profile's origins and database, and its registry is Alpha's registration of that environment

eliza's Worker refuses to serve while a binding disagrees with its profile
(`spec/cloud/deployment.md`, "A Worker serves only after the server's own
start checks pass and its bindings agree with its profile").

```quint
type Bindings = { api: str, web: str, database: str, registryNamesAlpha: bool }

pure def bindingsRepeatTheProfile(bindings: Bindings, api: str, web: str, database: str): bool =
  bindings.api == api and bindings.web == web and bindings.database == database and bindings.registryNamesAlpha
```

## Story: Bring me back to the app when its link did not open

> As the owner, when a sign-in, payment or Google return opens in my browser
> instead of in Alpha, I want its address on the App Link host to show the
> page that takes me back to the app, and that host to answer nothing else.

The web host Worker answers its own health and hands every other address of
its origin to the API Worker of its environment, through a service binding;
the API Worker serves the asset links and eliza's return pages. For the Slack
browser consent return the web host omits the query when forwarding the static
document request. The browser itself retains the state and result until that
document delivers them to the opener.

### The web host answers its own health, hands each other https address of its own origin, without credentials, to the same path on the API origin, preserves the query except for the in-page Slack consent return, and refuses every other address

```quint
type Route = Health | Forward | NotFound

pure def edgeRoute(secure: bool, credentials: bool, onWebOrigin: bool, health: bool, staysOnApi: bool): Route =
  if (not(secure) or credentials or not(onWebOrigin)) NotFound
  else if (health) Health
  else if (staysOnApi) Forward
  else NotFound

pure def lawForwardsOnlyItsOwnSecureAddresses(secure: bool, credentials: bool, onWebOrigin: bool, health: bool, staysOnApi: bool): bool =
  edgeRoute(secure, credentials, onWebOrigin, health, staysOnApi) == Forward
    implies (secure and not(credentials) and onWebOrigin and not(health) and staysOnApi)
```

### A forwarded address is answered by the API Worker, and one it cannot reach is a retryable 503, never a final answer

```quint
type EdgeAnswer = Healthy | Answered | Retry | Missing

pure def edgeAnswer(route: Route, apiReached: bool): EdgeAnswer =
  if (route == Health) Healthy
  else if (route == NotFound) Missing
  else if (apiReached) Answered
  else Retry

pure def lawAnUnreachableApiIsRetried(route: Route): bool =
  route == Forward implies edgeAnswer(route, false) == Retry
```

### The API Worker is told the web host it was asked for, and gets none of the caller's forwarding or hop-by-hop headers

```quint
pure val hopByHop = Set("host", "forwarded", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade")

pure def headerKept(name: str, forwarding: bool): bool = not(forwarding) and not(hopByHop.contains(name))

pure def lawNoForwardingHeaderPasses(name: str): bool = not(headerKept(name, true))
```

## Story: Tell whether a deployed environment is ready

> As the operator, I want one credential-free check of what the phone needs
> from a deployed environment of Alpha's own cloud, gate by gate, before
> anyone is asked to test it on a phone.

Before connecting a workspace or a Telegram account, the operator runs
`pnpm cloud smoke --environment staging --messaging` (or selects production).
It reads both of the phone's public registration endpoints and checks for
uncached JSON, Slack's OAuth client ID and live event configuration, and
Telegram's numeric application ID. It also asks the Slack mailbox for events
without a credential and verifies that the running relay requires a grant.
It fetches the Slack browser opener, its return document and their entry modules on the web host.
It reports each result independently.
Account consent is checked on the phone.

### Alpha's own cloud is ready only when each public gate passes: the provisioning smoke reads, then the entitlement keys, Alpha's sign-in configuration, the plans and the sign-in return page on the App Link host

The first four are the smoke reads of `./provisioning.md`; the asset links
and the return page are read on the App Link host, through the web host.

```quint
type Gate = ApiHealth | ServiceDocument | SignInMethods | AssetLinks | EntitlementKeys | SignInConfiguration | Plans | ReturnPage

pure val smokeGates: List[Gate] = List(ApiHealth, ServiceDocument, SignInMethods, AssetLinks, EntitlementKeys, SignInConfiguration, Plans, ReturnPage)

pure def ready(passed: List[Gate]): bool = smokeGates.select(g => not(passed.includes(g))) == List()
```
