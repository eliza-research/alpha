# Eliza Cloud subscription entitlement and plan gate (issue #410)

Status: proposal. This file describes the Alpha phone's side and what the Eliza Cloud server
must provide. The Cloud server work belongs to the Eliza Cloud repository and is not done here.
No price, plan allowance, entitlement lifetime or burst/sustained limit is chosen in this file.
Those values come from measured provider cost and pilot traffic, and the owner selects them.

Alpha source: `apps/app/src/runtime/subscription-entitlement.ts`, `cloud-protocol.ts`
(`subscriptionEntitlement`, `subscriptionEntitlementKeys`, `openSubscriptionManagement`) and
`connection-ui.tsx` (`admitCloudResident`). Tests: `test/subscription-entitlement.test.mjs` and
`test/browser/native-cloud-subscription.spec.ts`.

## Principles (policy P-26)

- Cloud billing uses subscription allowances or organization credits, with server-side admission.
  Alpha supports the owner's credit-funded inference setup; the phone shows no balance, top-up
  or per-token meter and never grants credits.
- An assistant turn never waits on a billing service. Cloud authorises each inference or Maps
  request from its own cached quota or token bucket.
- Every Alpha Phone signs in to Eliza Cloud. Admission accepts a valid active/trialing plan or
  Cloud's explicit organization-credit billing mode (owner request, October23). The check runs
  at admission and in the background; a turn never does.
- The on-device agent ALWAYS runs (owner directive 2026-10-13: "there should NEVER be no agent
  connected"). Plan state decides only whether Eliza Cloud inference (and other Cloud managed
  services) is bound into it. Without an admissible plan, offline or signed out, the agent runs
  with Cloud inference unbound and answers chat and assistant requests honestly (a plan is needed,
  or Cloud is unreachable) with Redeem code / Choose a plan actions. Local tools, scheduling,
  approvals, notices and on-device speech keep working. Cloud is never a replacement agent (decision P-43).
- Once a plan was verified on the phone recently, local apps, on-device speech and local tools do
  not depend on an online billing check (offline grace, section 4).
- Nothing is purchased automatically: no overage purchase, upgrade or retry that spends money.

## 1. Entitlement read

`GET https://api.eliza.app/api/v1/subscription/entitlement`
with `Authorization: Bearer <the phone's Cloud CLI key>` and `Accept: application/json`.

- `200 {"entitlement": "<compact JWS>"}` returns the current entitlement. The JWS is at most
  8192 characters.
- `401` means the sign-in is invalid. The phone shows the sign-in action.
- `404`, `405` or `501` means the route is not deployed. The phone then reads the subscription
  section of `GET /api/v1/billing/limits` (section 4).
- Any other status, or a transport failure, is a billing outage (section 4).
- A verified signed `plan.status:"none"` also reads the same authenticated billing snapshot.
  Only its explicit `organization-credits` mode admits credit-funded inference. A missing,
  ambiguous or active-plan snapshot cannot replace signed no-subscription authority. Canceled,
  invalid, expired or account-mismatched entitlements never take this credit path. No balance
  check or entitlement request is added to assistant turns; Cloud still enforces each request.
  Credit mode uses the existing periodic snapshot refresh and stops on revoked authentication.
  If a verified `none` cannot confirm credit mode, its inactive state is retained even during a
  snapshot outage; a cached admission cannot turn that result into offline grace.

The phone reads the entitlement when the resident agent is admitted, then refreshes it in the
background. It never reads it once per turn.

### JWS header

`{"alg":"ES256","typ":"eliza-entitlement+jwt","kid":"<key id>"}`. The phone refuses any other
`alg` or `typ`, and any header that carries `crit`.

### Claims

| Claim | Required | Meaning |
|---|---|---|
| `iss` | yes | Exactly the Cloud API origin, `https://api.eliza.app` |
| `aud` | yes | `eliza-alpha-phone`, either as a string or inside an array |
| `sub` | yes | Cloud user id. It must equal `GET /api/v1/user` `data.id` |
| `org` | when the user has one | It must equal `data.organization_id`. When the user has none, omit it |
| `jti` | yes | Entitlement id, used for idempotent accounting and audit |
| `iat`, `exp` | yes | Times in epoch seconds. The phone allows at most 60 minutes from `iat` to `exp` (an engineering ceiling, not a billing value) and a clock skew of 60 seconds |
| `nbf` | no | Epoch seconds |
| `rfa` | no | Suggested refresh time in epoch seconds, between `iat` and `exp`. Without it, the phone refreshes after 75% of the lifetime |
| `plan` | yes | `{id, name, status}` with `status` one of `active`, `trialing`, `past_due`, `canceled`, `none` |
| `ver` | no | Claim-set version, a positive integer. Absent means v1. Versions only add claims; a breaking change needs a new `typ` |
| `allowance` | no | v1: `{unit: "requests"|"tokens", period: "day"|"week"|"month", limit?: int, used?: int, resetsAt?: epoch seconds}`. The phone shows only the numbers that are present. Cloud does not issue it |
| `plan_allowance` | no (v2) | `{unit: "usd_micros", granted: int, remaining: int, periodStart, resetsAt: epoch seconds}`: Cloud's allowance for the current billing period in its own unit, millionths of a US dollar. `remaining` excludes amounts reserved for requests in flight. The phone shows the share left ("49% of this billing period's plan allowance is left"), never an amount of money. An unknown unit or an inconsistent row is not shown, and the plan state stays valid. It has its own name because v1 phones refuse an `allowance` claim in any other unit |
| `services` | no | The managed services covered, e.g. `["inference","maps"]` |

The phone verifies the signature before it trusts any claim.

## 2. Verification keys

`GET https://api.eliza.app/api/v1/subscription/entitlement-keys` (no authentication) returns
`{"keys":[JWK,...]}`, at most 16 keys. Each key is a public EC P-256 key with `kid`, `x` and `y`,
and never `d`. The phone caches the keys per issuer for one hour. It fetches them again when an
entitlement names an unknown `kid`, which makes key rotation safe.

## 3. Enforcement and usage (server only)

- Inference (`/api/v1` OpenAI-compatible, used by the resident agent through
  `ELIZAOS_CLOUD_BASE_URL`) and Maps check the caller's quota against a server-side cache or
  token bucket. These checks must not add a synchronous request to the billing service on each
  call.
- Usage is sent asynchronously, keyed by request id, so accounting stays idempotent.
- Revocation takes effect on the server immediately. The phone shows it on its next refresh.
- The phone does not send the entitlement with inference requests. At the pinned revision, the
  upstream `@elizaos/plugin-elizacloud` OpenAI client adds only `Idempotency-Key` and the
  native-application slot headers (`applyNativeApplicationInferenceHeaders` in
  `@elizaos/cloud-sdk`). It has no hook for an entitlement. If Cloud later wants the token on
  each request, that hook must be added upstream first. Cloud can key usage records on the
  `Idempotency-Key` that the client already sends when it has an operation id.

### Refusal bodies

The transports return the status, the JSON body and, for an error response, the `Retry-After`
header (seconds or an IMF-fixdate) as `retryAfter`, for every route the phone admits. A retry
time in the body wins. The Android transport always sees the header; the browser transport sees
it when Cloud exposes it to CORS (elizaOS/eliza PR #36255), and the development bridge does not
forward it. Cloud's `/api/v1/messages` keeps the Anthropic body
`{"type":"error","error":{"type":"rate_limit_error"}}` with its wait only in `Retry-After`. The
phone does not call that route (the resident agent uses the OpenAI-style routes), but it reads
`rate_limit_error` as a rate limit with the header wait. Cloud bodies carry the time:

| Situation | Status | Body |
|---|---|---|
| Burst or sustained rate limit | 429 | `{"error":"rate_limited","retryAfterSeconds":N}` (or `retryAfterMs`, or `retryAt` as ISO time) |
| Period allowance used up | 429 | `{"error":{"code":"allowance_exhausted","resetsAt":"<ISO>"}}` |
| No active plan | 402 | `{"error":"subscription_required"}` |

On a direct HTTP refusal the phone reads these bodies and tells the owner when to retry. It never
retries the message or buys anything.

The resident agent's reply path is narrower. At the pinned upstream revision the agent reports a
refused turn as `failureKind` / `terminalFailure.kind` from upstream `CHAT_FAILURE_KINDS`
(`packages/contracts/src/contracts/chat.ts`). A live `rate_limited` failure may include
`terminalFailure.rateLimit` with the provider's bounded `retryAfterMs`. Alpha reads that wait
without adding an entitlement request or automatically retrying the message. On that path:

| Upstream reply | Phone copy |
|---|---|
| `insufficient_credits` (how upstream reports a Cloud 402 today) | Neutral: Eliza Cloud declined the request for the account's billing; check the account in Settings. It does not claim a plan is missing, because the kind does not say whether the plan is missing or its usage is spent |
| `insufficient_credits` with `code` `allowance_exhausted` or `subscription_required` | The specific allowance or no-plan copy |
| `rate_limited` with `rateLimit.retryAfterMs` | Rate-limit copy with the provider wait rounded up for display |
| `rate_limited` without a live wait | Rate-limit copy with "wait a moment"; no invented countdown |
| any other kind | "The agent could not complete this response." |

At pin `968348d792d3`, upstream removes the relative `rateLimit` wait from idempotent replays
and conversation history. Alpha therefore does not restart a stale countdown on replay. Direct
HTTP refusals continue to support retry and reset times; the resident contract does not yet
carry allowance reset timestamps. Controlled parser tests are not live Cloud latency evidence.

## 4. Phone behaviour by condition

Cloud side: elizaOS/eliza PR #36125 (`POST /api/v1/subscription/redeem`, the entitlement and key
routes, refusal bodies with `retryAfterSeconds`, 402 `allowance_exhausted` with `resetsAt`), PR
#36186 (plan burst and sustained buckets) and the format v2 `plan_allowance` claim with Maps plan
buckets (elizaOS/eliza PR #36255).

| Condition | Phone result | Cloud inference bound (the agent runs in every row) |
|---|---|---|
| No saved sign-in (first run, signed out) | Sign-in dialog; no local-only bypass; it cannot be dismissed. The agent runs behind it | no |
| Valid entitlement, plan `active` or `trialing` | Plan name and the Cloud allowance | yes |
| Valid entitlement, plan `past_due` | Plan name, "Payment is past due" warning and "Manage plan in Eliza Cloud" | yes |
| Valid entitlement, plan `canceled`, or `none` without explicit organization-credit mode | Non-blocking plan notice beside the running agent (Redeem code, Choose a plan); the plan panel shows "<plan> has ended" or "No active plan" with Check plan again | no |
| Verified entitlement `none` plus authenticated snapshot `organization-credits` | Eliza Cloud credits; no plan or balance is invented, and the canonical snapshot refreshes periodically | yes, every request still checked by Cloud |
| Route absent (404/405/501) | `GET /api/v1/billing/limits`, `data.v2.subscription`: `trialing`/`active` bind, `grace`/`past_due`/`unpaid` bind with the warning, `canceled`/`incomplete_expired` need a plan; `not_applicable` with reason `no_organization_subscription` uses credit mode (other reasons remain inactive) | as mapped |
| Route absent and the billing snapshot is absent or reports no known state | Plan notice; "Plan status unavailable" with Check plan again, Redeem code and Choose a plan | no |
| Billing outage (5xx, timeout) after identity succeeded | Bound when this sign-in had an admitting plan verified within the last 7 days ("Plan status unavailable"); otherwise the plan notice with a retry | as stated |
| Cloud unreachable at start (identity or plan read fails in transport) | "Cloud cannot be reached" notice, closable. With a plan verified for this sign-in within 7 days the stored binding is kept (Cloud decides each request once reachable); otherwise it is removed | kept / no |
| Bad signature, unknown key or bad claims | Reported as unavailable (`invalid`), never trusted; plan notice with a retry | no |
| Entitlement issued for another account, at admission | An error asking the owner to sign in again | no |
| Plan reported `canceled`, or `none` without confirmed credit mode, by a background refresh or return to the app | Cloud inference is unbound (native restarts the process without the provider; history kept); the plan notice is shown | unbound |
| Entitlement issued for another account, during background refresh | Refresh stops, the account is re-admitted: Cloud inference unbound, the Cloud account detached and the same sign-in error shown | unbound |
| A verified entitlement lapses while refreshes fail | "Plan status is out of date" (`expired`), kept on every later failed refresh until a check succeeds | unchanged; Cloud decides |
| Sign-in rejected (401), at admission | Sign-in dialog | no |
| Sign-in rejected (401), during background refresh | Same as an account mismatch during refresh: unbound, sign-in shown | unbound |
| Plan becomes admissible (redeem, return to the app, Check plan again) | Bound into the running agent: attached when the process already matches, otherwise a clean restart that keeps history | yes |
| Cloud sign-in key expires within 14 days (`expiresAt` of the in-app sign-in key, 30-day TTL) | Warning in the account panel and Settings, with "Approve this phone again" (the in-app sign-in screen) | unchanged |

The 7-day offline grace is an engineering bound for offline use, not a billing decision: Cloud
refuses every AI request without a plan. The record behind it (`alpha.connection.plan-admission.v1`)
holds the environment, local credential generation id, user and organization ids, plan name and
status, and the verification time; no credential. A failed background refresh does not renew that
verification time, even while the previous entitlement remains valid. A reported plan window
that has ended cannot retain a Cloud binding under this grace. The resident keeps running.

Background refresh happens at `rfa`, or after 75% of the lifetime. After a failure it retries
after 30 s, then doubles the wait up to 5 minutes. It also runs when the owner returns to the app, at most once per minute for automatic
returns. Explicit retries and the first return from plan management bypass that throttle.
A resident billing refusal requests a background plan refresh, also at most once per minute;
it never retries the failed turn.
It stops whenever the Cloud account is detached (every sign-out, expiry, account change or
re-admission path), on a plan with no access, or on a rejected sign-in or account mismatch.
Admitted billing snapshots refresh every five minutes until a signed entitlement is available.

## 5. Subscription codes

`POST /api/v1/subscription/redeem` with the phone's Cloud CLI key and
`{"code": "<normalized>", "idempotencyKey": "<UUID>"}`.

- The phone normalizes like Cloud (trim, upper case, remove spaces and hyphens, O→0, I/L→1) and
  refuses text that cannot be a 16–64 character code locally, with the same generic copy.
- Each owner submission gets a fresh idempotency key. Only a transport failure (the request may
  have arrived) is retried, once, with the same key; Cloud answers a replay with the original grant.
- `400` (unknown, expired, disabled, used up or malformed): "This code could not be redeemed."
  `409 subscription_grant_already_redeemed`: already received. `429`: "Too many attempts. Try
  again in …" from `retryAfterSeconds`. `403`: account copy. Anything else: try again later.
- A replay whose grant has been revoked is refused, never reported as redeemed.
- A failed submission keeps the code in the input with its accessible error so the owner can
  correct it; a successful submission clears it. The code is never logged, persisted, put in
  an error or echoed.
- The account panel uses Cloud's `effectiveUntil` for the active plan window. A grant end is
  used only when no paid plan takes precedence and Cloud supplies no effective end.
- On success the phone reads the entitlement again and admits the agent when the plan allows.
  When a paid plan takes precedence, the copy says so.

The native transport and the renderer allowlist admit exactly this POST (body required, no query),
and `GET /api/v1/billing/limits`. The credit balance route is no longer admitted.

## 6. Plan management

"Choose a plan" (needs plan) and "Manage plan in Eliza Cloud" (past due, Settings) open exactly
`https://cloud.eliza.app/cloud/billing` (staging QA: `https://cloud-staging.eliza.app/cloud/billing`)
in the system browser. The phone creates no checkout, upgrade or purchase, and checks the plan
again when the owner returns.

Settings › Eliza Cloud account & plan shows the account, plan, the plan's end when Cloud reported
it (billing snapshot period end or redeemed grant end), the sign-in expiry, and Redeem code,
Manage plan and Sign out. Reset Alpha data asks Cloud to revoke this phone's key
(`DELETE /api/v1/api-keys/current`, one attempt, 3 s timeouts, 8 s overall deadline) after the
reset is recorded; a failure never blocks the local reset.

## Deployed production observations (2026-10-26)

Unauthenticated, read-only GET requests to `https://api.eliza.app`, recorded with
`node scripts/cloud-subscription-latency.mjs` in
[subscription-latency-deployed-public-2026-10-26.json](evidence/subscription-latency-deployed-public-2026-10-26.json).
No account, key, code or subscription was used or changed.

- `GET /api/v1/subscription/entitlement-keys` returns one ES256 P-256 key,
  `kid` `entitlement-production-2026-10`, so production publishes an entitlement signing key.
- `GET /api/v1/subscription/entitlement` without a key returns `401 authentication_required`.
- `GET /api/v1/subscriptions/plans` returns catalog `v1`: Plus USD 30/month with a USD 25 period
  allowance, Pro USD 100/month with USD 90; no rollover; completions/embeddings/standard/strict
  per-minute limits 120/200/60/10 (Plus) and 300/600/120/30 (Pro). These are server-published
  values, not an owner decision recorded here and not evidence of the cost/pilot basis. The
  catalog has no Maps request allowance field, so P-56's separate Maps allowance is not visible
  in it.
- Sequential p50/p95 from one desktop client (30 samples each): entitlement keys 43/145 ms,
  unauthenticated entitlement 47/122 ms, plan catalog 63/2299 ms (first request 4.1 s). The phone
  does not read the plan catalog; it caches signing keys for an hour.
- The public subscription routes share a Redis-backed budget of 100 requests per client window
  (`x-ratelimit-limit: 100`, `Retry-After` on 429); the entitlement route reports 600. A probe
  of more than about 100 requests is refused; the script stays inside it.

This is public-route latency only. It is not authenticated admission, plan-bucket, exhausted,
expired, revoked or billing-outage latency, and not Android audio.

## Gates that remain open

- Production publishes the entitlement signing key and plan catalog (above). Staging deployment,
  key rotation and the grant-code pepper are not verified here.
- No real-account end-to-end run (sign-in, redeem a real staging code, plan gate, agent admission)
  has been made; docs/cloud-subscription-qa.md lists the commands.
- Deployed p50/p95 is measured only for public routes (above). The normal, cache-miss, exhausted,
  expired and billing-outage conditions need an authenticated account against the deployed Cloud;
  the local lower bound is in [the 2026-10-15 audit](evidence/subscription-acceptance-audit-2026-10-15.md).
- Cloud publishes catalog `v1` prices, allowances and per-minute limits (above), but no owner
  decision recording them under P-26 and no measured provider-cost or pilot-traffic basis exists
  here. The owner confirms or replaces them.
- Live resident rate-limit waits and period-allowance reset times in chat terminal failures
  (elizaOS/eliza#36549, in the current pin) are supported; neither has met a real refusal.
- No real Cloud account, Android device or AOSP image was used for acceptance.
