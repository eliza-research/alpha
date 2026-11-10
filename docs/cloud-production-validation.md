# Cloud production validation

Initial read-only inspection on 2026-09-30; subsequent observations are dated below. No account was created, no Cloud organization credential was minted or consumed, and no credits or deployments were changed by this validation.

## October 2: normal Google browser login succeeds

Using the official `eliza.app` Sign in link and Google account chooser, the authorized `shawmakesmagic@gmail.com` account reached Cloud's authenticated dedicated-hosting offer. The visible page showed a $9,999.40 balance, $0.24/day ($0.01/hour) pricing, and a $0.72 starting minimum. These supersede the September 30 balance observation only; no administrative balance grant was performed in this validation.

Selecting **Not now** displayed “Couldn't open your Eliza” and “Dedicated setup was not started.” **Try again** returned to the same hosting offer. No **Start Dedicated** action was taken. The page does not establish whether the account has an existing reusable agent; source/account inspection remains necessary. The transient “Starting your Dedicated agent…” loading text is not evidence that provisioning happened.

The source-confirmed `/cloud/agents` page then displayed the authenticated account menu and an **Eliza · Shared · Free** card, with **Upgrade to Dedicated** and an explanation that signed-in chat requires dedicated hosting. This is live evidence of the visible shared-agent account state, not proof that every organization agent row is absent. No upgrade or provisioning action was taken.

This establishes normal website Google sign-in, not the phone's CLI-session credential exchange, owner-bound agent connection, Gmail OAuth, voice, or restart acceptance. The earlier Gmail token-exchange HTTP401 remains unresolved. A request to approve bounded dedicated hosting and the separate 90-day organization credential grant is pending; no organization key was minted or retrieved. The original live browser tab is no longer available at the later October 2 check. Resume from the official sign-in/account page after the pending grants are answered; do not treat the earlier visible offer as current authorization or provisioning.

### Phone creation compatibility gap

The October 2 source audit identifies a concrete mismatch: Alpha sends `{agentName, forceCreate:true, autoProvision:false}` without a tier, while both inspected Cloud repositories default to Shared and reject `forceCreate` for Shared. The former synthetic loopback test asserted that body and fabricated success; that path and its fabricated success coverage are now removed. This is a source-contract finding, not an observed failure against the deployed endpoint.

The supported personal-agent onboarding conductor reads personal identity, reviews a current activation/adoption quote, requires explicit price confirmation, reattaches accepted work, polls provisioning and completes history cutover. Alpha now implements that personal conductor in the phone connection chooser, retaining native CLI authentication and owner-bound credential storage; never infer no agents from a failed read or silently add paid hosting to the old create request. Validate deployed compatibility, then real login/reuse-or-activation/chat/restart. Exact source pins and flow mapping: `test-results/cloud-login-current-review/REPORT.md` and `source-pins.json`.

### Implemented personal onboarding and bounded qualification

The new flow reviews current price/target data, stores a nonsecret owner-scoped write intent before dispatch, and never automatically repeats uncertain activation or cutover. Refresh reads status. Sleeping/stopped personal agents retain the same target. Account, organization, credential generation and runtime origin are checked before connection. Generic Create/Start controls are removed with a deferral comment. Management opens the verified Cloud account site through the native browser handoff.

All14 frozen-renderer full flows pass, plus17 loopback protocol scenarios. The browser suite covers accepted/lost responses, reload, changed quotes, failed persistence, stopped-agent recovery, explicit adoption and account changes. Repository verification passes. Evidence: `test-results/cloud-personal-isolated/RESULT.md` and source hashes. These controlled checks do not establish deployed onboarding, native login, paid hosting, Gmail, voice or live Cerebras model use. Live grants remain pending.

## Confirmed deployment

Railway CLI is authenticated as Shaw (`shawmakesmagic@gmail.com`). Its `eliza-cloud` project is `42973b82-c563-47ce-8bec-a7d90f5b358f`; production environment is `94a9662c-2682-4a71-99d1-df0e016edfba`, staging is `c07f0df1-4602-4735-83f0-0d8e7ac6a64d`.

The public API is Cloudflare Worker `eliza-cloud-api-prod`, routed at `api.eliza.app`. Read-only deployed Worker settings confirmed its `HYPERDRIVE` binding to `9f59e4ec65f048f7b87e29e7b9c5d728` (`eliza-prod-pg`). Comparing origin fields privately identified Railway service `postgres-auth-restore-drill-20260825`, ID `f9c9bdc0-8861-4648-853e-50ab8898a881`, as the matching production database. The service named `Postgres` is a different database and must not be assumed to be the current writer. Matching service deployment `07b7fc8f-b792-4292-aba1-9634c4e9394d` reported `SUCCESS`, not stopped. This is infrastructure metadata, not a database health or account acceptance result.

Railway also lists shared `agent-server` (`8baf830a-2dc3-465d-b7ed-725fae3eaa56`). Voice services live in project `eliza-voice-services` (`cf5dd3aa-04a2-4e79-94cc-e28f9e08dc0e`): `whisper-stt` (`69ecbd2a-5f5f-4d8a-b1d1-072d35e5bdb7`) and `kokoro-tts` (`9581a7f3-7f23-486c-ba17-bbb7ffd52c14`). Presence does not establish working authenticated voice.

## Account and authentication boundary

The requested account is now **verified by a narrowly scoped, read-only query on the matched production writer**:

| Field | Observed value |
| --- | --- |
| Email | `shawmakesmagic@gmail.com` |
| User ID | `6ab2bc3e-ab92-463f-9d51-28f6b82b902d` |
| Organization ID | `aca85df9-20ec-4447-ad7a-084e89a800fc` |
| Organization | Shaw's Organization |
| Credit balance at observation | `1000.926282` USD |
| Organization `agent_sandboxes` rows | Empty result, including terminal/deleted statuses; query scoped to this organization, newest 30 maximum |

The connection reported `transaction_read_only=on` and `pg_is_in_recovery=false`. Connect and statement timeouts were bounded at five seconds; pager-off account lookup completed in 2.3 seconds. No credentials, encrypted fields, API keys, chat contents or other accounts were selected. This administrative read establishes account/database facts, not successful product login, agent provisioning, Gmail authorization or live voice.

Earlier direct TLS and SSH query failures did not prove an absent account. Follow-up isolated two concrete transport/client observations:

- SSH marker execution succeeded in 1.8 seconds; the matched container reports PostgreSQL 18.4. `pg_isready -h 127.0.0.1 -t 5` returned accepting connections in 1.1 seconds. Deployment remains `07b7fc8f-b792-4292-aba1-9634c4e9394d`, `SUCCESS`, not stopped.
- A nominally hanging `SELECT 1` had actually returned `1` and entered psql's `(END)` pager inside Railway CLI 4.6.0's PTY. Explicit `psql --no-psqlrc --no-password -P pager=off -At` resolved that hang. Passwords were referenced through existing container environment variables and never printed or placed literally in command arguments.
- A fresh credential-free public transport probe connected to the configured Railway TCP proxy, received PostgreSQL SSLRequest response `S`, then failed normal certificate validation with code 19, `self-signed certificate in certificate chain`. No unverified-TLS connection or authentication fallback was attempted. This identifies the current public certificate trust failure; it does not retroactively prove that every earlier closed connection had the same cause. The successful account read used the existing authenticated Railway SSH path to the matched database service.


An unauthenticated request to canonical `/api/v1/user` with JSON headers returned `401 authentication_required`. Earlier default-client probes returned 403; neither diagnoses the user's reported authentication error without its exact endpoint and response.

AlphaPhone signs in on its own screens (since 2026-10-14). Native code verifies an email code or a Google Custom Tab return with Steward (`/steward/auth/email/code/verify` or `/steward/auth/oauth/exchange`), then mints a 30-day `eliza_mobile_` key through `/api/v1/app-auth/connect`, `/mobile/token` and `/mobile/ack` (client `ai.elizaresearch.alphaphone`). It then reads `/api/v1/user` identity with that key (docs/architecture.md, "Eliza Cloud sign-in ownership"). Before that change Alpha used `/api/auth/cli-session` browser approval, which mints a 90-day organization API key retrieved once by polling. That flow remains only as a test-mocks diagnostic fallback for one release. Pending browser approval must be completed normally, not bypassed with administrative credentials. The legacy `/api/eliza-app/user/me` route instead accepts an Eliza App JWT with issuer `eliza-app`, audience `eliza-app-users`, and seven-day duration. These credential types are not interchangeable.

## Funding and agent reuse

Credits belong to `organizations.credit_balance`, linked by `users.organization_id`. Inspected source uses numeric(16,6) and no unlimited-credit flag was found. Do not implement "unlimited" as infinity or an undocumented direct SQL balance edit. The exact organization above is verified and its existing balance is sufficient to begin the requested tests; no account creation or balance change is needed now. Define an explicit internal-testing funding policy before any later administrative grant. Any authorized credit allocation should use the existing credit service, preserve its ledger transaction, and invalidate balance caches.

For any later authorized internal credit grant, the source-backed entry point is `creditsService.addCredits({organizationId, amount, description, metadata})` in `shared/src/lib/services/credits.ts`. It returns the ledger transaction and new balance and normally calls `invalidateCreditCaches`; do not replace it with an SQL balance edit or forge a Stripe payment. A proposed bounded alternative to unlimited credits is a 30-day test allocation with a documented ceiling and reviewed replenishment threshold; this is a proposal, not an implemented recurring grant or policy. No grant was executed.

List `/api/v1/eliza/agents` after authenticated identity validation. The database currently has no agent-sandbox row for this organization, so the phone should exercise the normal empty-account creation path after login, then verify its actual readiness and chat response. Agent creation normally reuses the organization's existing nonterminal agent; `forceCreate` opts out. Prefer reuse, and require explicit creation/provisioning when no suitable agent exists. Dedicated provisioning has separate price and credit gates.

Gmail additionally requires the user's Google OAuth grant. Cloud voice requires a selected Cloud account and explicit transcription/playback actions. Device-local audio capture/save can work without Cloud and does not prove STT, TTS, Gmail, or hosted-agent acceptance.

## Source references

Inspected checkout: `~/v3`, commit `6c6fddb6f65e2a88c7852810f1cacc06b4012511` (source contract; not asserted as the deployed API revision).

- `packages/cloud/api/wrangler.toml`: production Worker routes and Hyperdrive binding.
- `packages/cloud/api/auth/cli-session/[sessionId]/complete/route.ts`, corresponding poll route, and `shared/src/lib/services/cli-auth-session-completion.ts`: approval, key lifetime, single-use retrieval.
- `packages/cloud/shared/src/lib/auth/workers-hono-auth.ts`: API-key versus Steward-session authentication.
- `packages/cloud/shared/src/lib/services/eliza-app/session-service.ts`: distinct Eliza App JWT.
- `packages/cloud/shared/src/db/schemas/{users,organizations,agent-sandboxes}.ts`: ownership and billing identities.
- `packages/cloud/shared/src/lib/services/credits.ts`: ledger-backed credit increases and cache invalidation.
- `packages/cloud/api/v1/eliza/agents/route.ts`: organization-scoped listing, reuse, creation, and provisioning gates.

Next acceptance sequence: finish browser login; verify identity and organization; inspect existing agents; apply a defined authorized funding policy if needed; verify a real agent conversation; approve Google access and read a selected Gmail message; explicitly transcribe a recording and play Cloud speech. The administrative account/organization/balance lookup is complete; those product login and live-service checks remain incomplete.

## Google connector token-exchange failure: scoped diagnosis

Observed existing browser URL: `https://cloud.eliza.app/cloud/connectors?tab=connections&google_error=Token%20exchange%20failed%3A%20401`. This is separate from the earlier unspecified “Invalid or expired session” report. No new OAuth attempt was made during this investigation.

In the inspected `~/v3` source, `packages/cloud/shared/src/lib/services/oauth/providers/oauth2.ts:448–452` emits exactly `Token exchange failed: <status>` after a failed authorization-code POST to the provider token endpoint. Google’s registry endpoint is `https://oauth2.googleapis.com/token`, using `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. `api/v1/oauth/generic-callback.ts:181–192` URL-encodes the thrown message into `google_error`. That path has already validated cached OAuth state and required nonempty client credentials; missing credentials and expired/mismatched state have different error strings. It does not establish successful Google identity lookup or connection persistence.

This source evidence localizes the observed 401 to the **Google code-exchange boundary**, rather than Cloud account credits, a phone bearer session, the pending organization-key grant or Gmail read API authorization. It does not identify the exact Google error code. An incorrect/mismatched/rotated OAuth client secret is a plausible hypothesis: [Google documents `invalid_client`](https://developers.google.com/identity/protocols/oauth2/web-server) as an incorrect client secret. Do not change secrets or replay an authorization code on that hypothesis. The source consumes cached state before exchange; a replay would instead fail state validation and obscure the original failure.

Environment scope matters: `getCloudAwareEnv()` reads request-local Worker `c.env` string bindings before `process.env`. Local `.env` files or Railway configuration cannot establish which credentials the deployed Worker used. The inspected configuration sets `NEXT_PUBLIC_APP_URL=https://cloud.eliza.app`, and the generic callback derives `/api/v1/oauth/google/callback` from that value for both initiation and exchange. Source defaults its final landing to `/cloud/settings?tab=connections`, whereas the observed URL is `/cloud/connectors`; deployed revision/frontend redirect differences have not been verified. The production Worker previously identified is `eliza-cloud-api-prod`.

### Historical-log access attempt and exact remaining evidence

On 2026-09-30, known Wrangler cache metadata at `~/Library/Preferences/.wrangler/config/default.toml` showed an OAuth access credential expiry of `08:39:35.017Z`. No environment `CLOUDFLARE_API_TOKEN` was present. A bounded read-only Cloudflare accounts request with the cached credential returned **HTTP403, Cloudflare error9109**. The repository Wrangler executable is a dangling dependency symlink, so the installed CLI could not run. No token values, refresh credential, callback code, raw provider body or other customers’ logs were printed. No credential was refreshed or minted, no pending grant consumed, and no Cloud/Worker configuration changed.

Therefore historical Worker logs were **not retrieved**; this is an authentication/access boundary, not evidence that logs do not exist. Cloudflare provides a [historical Workers Observability query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/) when logs are enabled and retained. A properly authenticated operator can filter `eliza-cloud-api-prod` for the exact message `[OAuth2] Token exchange failed for google` in a bounded window around the original callback. The UI’s last-opened time around `2026-09-30T06:15Z` is only a search hint, not a known request time. Return only the provider JSON `error` enum (for example `invalid_client`), numeric HTTP status, timestamp and deployed Worker revision/request correlation if available; do not export raw bodies, tokens, code/state parameters, identities or unrelated logs. The source already logs a bounded provider response on this failure path. That original provider classification and deployment binding version are the missing evidence needed before attributing this to a particular secret/client/redirect configuration.

### Authorized normal Cloudflare refresh and narrower remaining boundary

A subsequent explicitly authorized **normal refresh of the existing Wrangler grant** succeeded. The repository’s Wrangler dependency has no runnable entry in its Bun store, so the request followed Cloudflare’s official [`workers-auth` refresh implementation](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-auth/src/token-exchange.ts), using Wrangler’s existing public client ID and saved refresh credential. The initial Python transport received a non-JSON403; Node’s normal fetch transport then returned200. Returned scopes exactly matched the prior grant and lifetime was3600 seconds. The rotated access/refresh credentials were atomically saved to the existing owner-only Wrangler cache; no scope expansion, new login, API-key creation, Eliza grant consumption or credential output occurred.

With the refreshed credential, the production Worker’s read-only settings request returned200 and confirmed `observability.enabled=true` and `observability.logs.enabled=true`. However, a bounded historical key-discovery query covering `2026-09-30T05:45Z–06:45Z`, restricted by the exact Google token-exchange failure text, returned **403 / code10000 Authentication error**. The [current Observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/keys/) documents `Workers Observability Write` as an accepted permission even for this read/query operation. The renewed credential demonstrably accesses the account/Worker settings, but the telemetry endpoint still rejects it; permission enforcement is the likely narrower boundary, not an expired session. No extra permissions were requested, no live tail was started and no historical log values were received. Logging enabled does not prove this particular original event remains retained. The Google error enum and exact failed deployment binding remain unverified.

### Read-only diagnostic refresh at2026-09-30T12:26Z

The known Wrangler cache remains present, but its access credential expiry is
`2026-09-30T10:29:52.834Z`; no environment Cloudflare API token is configured.
Only expiry and scope metadata were inspected. The saved scopes include
`workers_tail:read`; the prior authenticated historical telemetry query was
still403/code10000 after a successful same-scope refresh. Refreshing that grant
again would not itself establish permission to retrieve historical telemetry.
No refresh, scope expansion, live tail, OAuth replay, pending Eliza CLI poll or
account mutation was performed in this refresh.

The current source still emits the exact browser-observed message only after
Google's token exchange fails (`oauth/providers/oauth2.ts:448–452`). We still do
not have Google's original JSON `error` enum or failed deployment revision.
Concrete next evidence is an operator-authorized, narrowly filtered historical
log record, if retained, or a future normal Google reconnect observed with a
permitted live tail. A live tail cannot reconstruct the old event. Such a new
reconnect would be a new transaction and must not be described as the original
failure. Worker binding version/client-ID metadata may help correlate a proven
`invalid_client`, but no secret should be changed based only on HTTP401.
The pending organization-key grant is a separate product-login boundary; it
neither explains Google's401 nor grants Cloudflare historical-log permission.


## Live browser login revalidation — October 3

A fresh normal Google sign-in selected the user-requested shawmakesmagic@gmail.com account and successfully completed the Cloud callback. The browser proceeded through “Connecting to the Eliza app” to `https://cloud.eliza.app/join`, showing “Start your Dedicated Eliza”, an existing balance of $9,999.00, and a price of $0.24/day ($0.01/hour), minimum start $0.72. This supersedes the earlier unresolved browser-login state for this observed session; it does not establish phone token enrollment or Gmail authorization.

No Start Dedicated action was submitted. Explicit bounded approval for one agent for up to24hours was requested because provisioning incurs ongoing hosting charges. The setup tab is retained for that decision. No API credential was extracted, no Google Gmail scope was granted, and no test email was sent. Cloud chat/voice, account-agent reuse or provisioning, phone login, and Gmail remain separately unverified.

## October 23: integration completion probes

Read-only production probes while preparing `codex/finish-integrations`:

| Probe | Observed result | What it establishes |
| --- | --- | --- |
| `GET /api/v1/subscriptions/plans` | HTTP 200 | The public catalog is reachable; no authenticated entitlement or quota acceptance |
| `GET /api/v1/maps/capabilities` without credentials | HTTP 401 | Authentication is required; coverage and route availability remain unverified |
| `GET /api/v1/app-auth/mobile/config` with `clientId=ai.elizaresearch.alphaphone`, `environment=production`, and the exact HTTPS callback | HTTP 200, matching registration and S256 | Alpha mobile registration is deployed |
| `GET /steward/auth/providers?tenantId=elizacloud` | HTTP 200; email and Google offered | Provider discovery is available; no sign-in attempted |
| `GET https://eliza.app/.well-known/assetlinks.json` | HTTP 404 | The verified App Link readiness gate is not satisfied |

The connected Pixel 10a had system-installed version code 6,
`0.1.0-cloud-0296e2c929-e240ddab7`, and showed Cloud signed out. This is an older
Cloud-profile image, not device acceptance for current main or this change.
No account credentials, provider writes, calls, messages, installation or flashing
were performed. No Cloud/Maps/signing environment references were configured in
this execution environment.

Completion still requires the release owner’s certificate binding at the App Link
host, a designated test account and safe provider targets, deployed Maps coverage,
and separate signed-artifact/device acceptance. Do not weaken the readiness gate
or present the public registration response as a completed login.
