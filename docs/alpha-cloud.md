# Alpha Cloud

Alpha Phone's own Cloud: sign-in, AI inference, voice, subscriptions and billing for
`ai.alphacompute.alphaphone`, on Cloudflare under `alphacompute.ai`. It is built from the pinned
upstream source (`vendor/eliza` at `upstream.lock.json`, exported, never edited) and described by
data in this repository. The shipped app still uses Eliza Cloud until the cutover in section 8.

## 1. What the Cloud does, and what it does not

| Need | Upstream piece | Required |
|---|---|---|
| Sign-in: email code, Google | Steward (login Worker + container), `app-auth/mobile/*` | Yes |
| LLM inference | `/api/v1/chat/completions`, `/responses`, `/models` → Cerebras (default `qwen-3.8-27b`, the model the app requests) | Yes |
| Voice | `/api/v1/voice/{stt,tts,session}`. Cartesia when keyed, else Workers AI | Yes (Cartesia optional) |
| Subscriptions and billing | Stripe checkout, plan change, cancel/undo, webhooks, entitlements, grant codes, referrals, credits | Yes |
| Maps | `/api/v1/maps/*` | The app calls it; optional key |
| Gmail and Calendar | `/api/v1/eliza/google/*` | The app calls it; needs Google verification |
| Everything else upstream runs (agents, containers, apps marketplace, Telegram, Twilio, web dashboard) | | Not deployed |

So: inference, voice, Google sign-in, and subscriptions are the core. Two more things are not
optional: a Postgres database for each of Cloud and Steward, a Redis REST store, and an email
sender for sign-in codes. Maps and the Gmail/Calendar connector are features the app already
ships. Without their keys those screens report the service as unavailable; nothing else breaks.

### Topology

```
phone ──https──> api.alphacompute.ai    Cloud API Worker (upstream)   ──Hyperdrive──> Postgres (Cloud)
                 blob.alphacompute.ai   (same Worker: R2 blobs)        ──REST──> Upstash Redis
                 login.alphacompute.ai  Steward Worker + container     ──> Postgres (Steward), Resend
                 cloud.alphacompute.ai  cloud/edge (this repo)         ──service binding──> API
Stripe ──webhook──> api.alphacompute.ai/api/stripe/webhook
```

`cloud.alphacompute.ai` is the app-link host. It serves `/.well-known/assetlinks.json`, the
sign-in and checkout returns (`/alphaphone/auth/callback`, `/alphaphone/billing/return`) and the
browser Google start, all answered by the API from the database registration. Upstream's Pages
dashboard, speech Worker and admission Worker are not deployed: account and plan management is
in the app, and the API Worker hosts both Durable Objects itself. Staging uses `-staging` hosts.

## 2. What is in this repository

| Path | Role |
|---|---|
| `cloud/policy.json` | Public identity per environment: API, web and services origins, tenant, entitlement audience. The same shape as the app's Cloud policy. |
| `cloud/resources.json` | Cloudflare account, zone, worker names and resource ids. Zero ids are placeholders until `provision`. |
| `cloud/edge/worker.ts` | The web-host Worker (about 40 lines). |
| `scripts/cloud-worker.ts` (`bun run cloud:worker`) | The operator tool: `prepare`, `check`, `secrets`, `provision`, `migrate`, `seed`, `deploy`, `tenant`, `smoke`. |
| `scripts/cloud-registration.ts`, `scripts/cloud-seed-registration.ts` | The app's native client as upstream reads it: an `apps` row and a `mobile_app_auth_clients` row (callback, package, release signer fingerprints). |
| `scripts/local-cloud.ts` (`bun run cloud:local`) | The same Cloud on this computer, for development and contract checks. |
| `.github/workflows/cloud-deploy.yml` | Manual, main-only deploy per environment. |
| `apps/app/src/runtime/cloud-plans.ts`, `cloud-plan-ui.tsx` | In-app plans, checkout, plan change, cancellation and referrals. |
| `android/.../AlphaBillingAuthorityPlugin.java`, `BillingAuthorityRoutes.java` | Native account session for plan changes and cancellation. |
| `scripts/update-channel-status.ts` (`bun scripts/update-channel-status.ts`) | Live OTA channel check. |

## 3. Secrets: what to get, and from where

The tool keeps one private env file per environment, outside the checkout (for example
`~/.config/alpha-cloud/staging.env`, mode 600). You add the provider values below; running
`secrets` adds the internal ones (JWT, vault and salt keys, Steward tokens, platform key, the
entitlement signing key, the grant-code pepper) once and never rotates them. Use test or sandbox
keys for staging and live keys for production.

| Name | Where to get it | Notes |
|---|---|---|
| **Cloudflare** (not in the env file) | An AlphaCompute Cloudflare account that owns the `alphacompute.ai` zone, on Workers Paid with Containers | Set `CLOUDFLARE_ACCOUNT_ID` and use a token for that account. Grant Workers Scripts, Routes, KV, R2, Hyperdrive and Containers edit, plus Zone read and DNS edit on `alphacompute.ai`. |
| `DATABASE_URL` | Postgres for Cloud (Neon, Supabase or Railway) | Its own database. Hyperdrive is created from it. |
| `DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256`, `DATABASE_IDENTITY_EXPECTED_AUTHORITY_SHA256` | Reviewed output of `database-identity` for that environment | Migration and registration both verify these receipts against the connection they use. |
| `STEWARD_DATABASE_URL` | A second Postgres database for Steward | Must differ from `DATABASE_URL`. Steward migrates it at start. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis → REST API | Rate limits, auth denylist, speech sessions. |
| `CEREBRAS_API_KEY` | cloud.cerebras.ai → API keys | Serves `qwen-3.8-27b`. `OPENROUTER_API_KEY` (optional) adds other models. |
| `CARTESIA_API_KEY`, `CARTESIA_STT_USD_PER_CREDIT` (optional) | play.cartesia.ai → API keys; price per credit from your plan | Without them STT and TTS use Workers AI. |
| `RESEND_API_KEY` | resend.com, with `alphacompute.ai` verified as a sending domain | Sends sign-in codes from `noreply@alphacompute.ai`. |
| `CLOUD_PUBLIC_SERVICE_TERMS_JSON`, `CLOUD_PUBLIC_SERVICE_PRIVACY_JSON` | Alpha Compute's approved Terms and Privacy text | Each value is one line of JSON with `title`, `revision`, and a nonempty `sections` array. Each section has a `title` and a nonempty `paragraphs` array of plain-text strings. Limit each value to 5120 UTF-8 bytes. The API publishes the documents for the in-app sign-in screen. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application) in an AlphaCompute project | Authorized redirect URIs: `https://login.alphacompute.ai/auth/oauth/google/callback` and `https://api.alphacompute.ai/api/v1/oauth/google/callback` (staging: the `-staging` hosts). Used for sign-in (Steward) and the Gmail/Calendar connector (API). |
| `STEWARD_GOOGLE_NATIVE_CLIENT_IDS` (optional) | An Android OAuth client: package `ai.alphacompute.alphaphone`, SHA-1 of the release certificate | JSON `{"alpha-phone": ["<id>.apps.googleusercontent.com"]}`. Only needed for native Google sign-in; the app uses browser sign-in today. |
| `GOOGLE_MAPS_API_KEY` (optional) | Google Cloud → Maps Platform key restricted to Geocoding, Places and Routes | Without it Maps is unavailable. |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | `sk_test_` for staging, `sk_live_` for production (the tool refuses a mismatch). |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → add endpoint `https://api.alphacompute.ai/api/stripe/webhook` | Events the Cloud handles: `checkout.session.completed`, `customer.subscription.updated`, `.deleted`, `.pending_update_applied`, `.pending_update_expired`, `invoice.created`, `.paid`, `.payment_failed`, `payment_intent.succeeded`, `.payment_failed`, `charge.refunded`, `charge.dispute.funds_reinstated`. |
| `STRIPE_PLUS_PRODUCT_ID`, `STRIPE_PLUS_MONTHLY_PRICE_ID` | Stripe → Products: "Plus", recurring monthly **$30.00 USD**, licensed, no trial | Upstream verifies the exact amount. |
| `STRIPE_PRO_PRODUCT_ID`, `STRIPE_PRO_MONTHLY_PRICE_ID` | Stripe → Products: "Pro", recurring monthly **$100.00 USD** | Plus includes $25 and Pro $90 of AI usage. These amounts are fixed in upstream's catalogue; other prices need an upstream change. |
| `STRIPE_PUBLISHABLE_KEY` (optional) | Stripe → API keys | Not needed for the app's hosted checkout. |

GitHub (for the deploy workflow): create environments `alpha-cloud-staging` and
`alpha-cloud-production` in `eliza-research/alphaphone`, each with secrets `CLOUDFLARE_API_TOKEN`
and `ALPHA_CLOUD_ENV` (the whole completed env file).

## 4. First deployment (per environment)

```bash
bun run cloud:worker -- prepare                       # export, install and build the pin (about 2 GB, once per pin)
bun run cloud:worker -- secrets --environment staging --env-file ~/.config/alpha-cloud/staging.env
# add the provider values, report and verify the database receipts, then rerun `secrets`
bun run cloud:worker -- database-identity --environment staging --env-file ~/.config/alpha-cloud/staging.env
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… bun run cloud:worker -- provision --environment staging --env-file ~/.config/alpha-cloud/staging.env --write
bun run cloud:worker -- check --environment staging   # render and bundle, no network
CLOUDFLARE_API_TOKEN=… bun run cloud:worker -- preflight --environment staging --env-file ~/.config/alpha-cloud/staging.env
bun run cloud:worker -- migrate --environment staging --env-file ~/.config/alpha-cloud/staging.env
bun run cloud:worker -- seed --environment staging --env-file ~/.config/alpha-cloud/staging.env
CLOUDFLARE_API_TOKEN=… bun run cloud:worker -- deploy --environment staging --env-file ~/.config/alpha-cloud/staging.env
bun run cloud:worker -- tenant --environment staging --env-file ~/.config/alpha-cloud/staging.env
bun run cloud:worker -- smoke --environment staging
```

`deploy` uploads each Worker's secrets with its version using `wrangler deploy --secrets-file`.
`secrets --apply` pushes them alone for a rotation. `provision` verifies the account's zone, KV
namespace, Hyperdrive configuration, R2 bucket and proxied DNS for the API and blob hosts.
It creates missing resources and confirms them by readback. If a previous run stopped partway,
rerun with the same account and environment to recover the resources by name. Resolve conflicts
in the account or resource configuration before continuing. With `--write`, commit the updated
`cloud/resources.json`. The login and web hosts are Worker custom domains created on deployment.

`preflight` reads the configured resources from the selected account without changing them. With
`--env-file`, it also checks that Hyperdrive's host, port, database and user match `DATABASE_URL`.
`deploy` repeats these checks with its env file before uploading. Run `preflight` with the frozen
env file before migrating or seeding.
The `smoke` step checks which API environment answered, the Terms and Privacy text,
public entitlement keys, the exact native client and S256 callback binding, the plan catalogue, sign-in
providers, the enrolled release certificate's App Links grant, and the hosted callback page.

Exercise the live integrations after these checks pass.

For each environment, check the target database and role against the operator's database record
before accepting the reported digests into its env file. Use a direct or session-pinned connection
whose migration role can read `pg_catalog.pg_control_system()`. `database-identity` only reports
redacted digests. `migrate` verifies them under the upstream migration lock, and `seed` verifies
them again inside its write transaction. If an interrupted initial migration hits the upstream
compatibility barrier before 0282, resolve it with the database owner before continuing. The tool
requires explicit migration completion before the workflow proceeds.

- In Stripe, send a test webhook and check that it returns 200.
- Run `POST https://api.alphacompute.ai/api/v1/cron/refresh-pricing` with
  `Authorization: Bearer $CRON_SECRET` so inference has prices. Inference fails closed until the
  pricing catalogue exists. (I found no schedule that runs this refresh, so run it after each deploy.)
- Mint launch grant codes with upstream's
  `packages/cloud/scripts/admin/mint-subscription-grant-codes.ts` against `DATABASE_URL`.

## 5. Subscription management in the app

Account → Plan opens the plan manager. Nothing is done on a website.

| Action | Authority | Route |
|---|---|---|
| See plans, current plan, renewal or end date | the phone's key | `GET /api/v1/subscriptions/plans`, `GET /api/v1/billing/limits` |
| Subscribe | the phone's key | `POST /api/v1/subscriptions/checkout` (`presentation: "mobile"`). Stripe's page opens and returns to `/alphaphone/billing/return`; the app confirms with `POST …/checkout/confirm`. |
| Switch plan (upgrade or downgrade) | account session | `…/upgrade|downgrade/review`, then `…/confirm`. An upgrade that needs payment action opens Stripe's invoice page. |
| Cancel at period end, or keep the plan | account session | `…/cancel`, `…/cancel/undo` |
| Share your referral code, enter someone's | the phone's key | `GET /api/v1/referrals`, `POST /api/v1/referrals/apply` |
| Enter a membership code | the phone's key | `POST /api/v1/subscription/redeem` (unchanged) |

Upstream accepts plan changes and cancellation only with a fresh account session. The app asks
"Confirm it's you" and emails a one-time code to the account's own address. The native plugin keeps
the resulting session in memory for at most an hour and checks that it is the phone's account. It
is never stored and never shown to the web view.

## 6. OTA updates

Installed `ai.alphacompute.alphaphone` builds read
`https://github.com/eliza-research/alpha/releases/download/app-stable-alphacompute/alpha-update-stable.json`.
`bun scripts/update-channel-status.ts` checks that channel the way a phone does. As of 2026-11-15 it fails: nothing
has been published there. The only published channel is the legacy package's `app-stable`
(versionCode 75). Version 78 of `ai.alphacompute.alphaphone` was signed on 2026-11-15 (Release
`sign`, run 43700907933) with the current release certificate and delivered only to private QA.

To make OTA work:
1. Qualify the signed v78 (or a later) launcher on a device: its Cloud voice evidence is part of
   the qualification record.
2. Run **Release** with `operation: publish`, `workflow_commit` = the reviewed main commit, and the
   reviewed `alpha-qualified-app-update/v1` JSON. That publishes the APK first, checks the anonymous
   download, then moves the stable pointer on `app-stable-alphacompute`.
3. Run `bun scripts/update-channel-status.ts --download` until every gate passes. Then check a real phone's
   Settings → Update. Channel evidence is not device acceptance.

The version must exceed 75, the retained legacy floor; v78 does. OS (A/B image) OTA is a separate,
disabled path; see the README.

## 7. Local Cloud and validation

```bash
bun run cloud:local -- prepare
ELIZA_DEV_ALLOW_TEST_MOCKS=1 bun run cloud:local -- start      # separate terminal
ELIZA_DEV_ALLOW_TEST_MOCKS=1 bun run cloud:local -- check
```

Validated 2026-11-15 at the main pin `f86b5038f8`, on this computer, not deployed:

- `cloud:worker -- check`: API, login and edge Workers rendered and bundled for both environments
  (`wrangler deploy --dry-run`, no network); no Eliza host in any configuration.
- `cloud:local -- check`: 22 of 22 gates. These cover registration from the database rows, email
  code sign-in, mobile key mint, acknowledgement and revocation, and the account and entitlement
  reads. They also show that the phone key reads the subscription snapshot and referrals; that the
  Steward session is accepted on a session-only billing route while the phone key gets 401 there;
  that asset links are served from the registration; and that the edge forwarding of the callback
  works while an unregistered path is refused.
- Unit tests: `test/cloud-worker.test.mjs`, `test/cloud-plans.test.mjs` (including the native route
  table on a JVM), `test/update-channel-status.test.mjs` and `test/connection-routes.test.mjs`.

Not yet proven: anything deployed; Stripe test-mode checkout end to end; Cerebras and Cartesia
calls (they need the keys); Google sign-in against a real client; the Steward container on
Cloudflare (Eliza runs that Worker with `LOGIN_ENABLED=false` and hosts Steward elsewhere, so
Alpha would be its first production user); the plan manager on a device.

## 8. Cutover (shipped app → Alpha Cloud)

The shipped policy (`scripts/cloud-deployment-policy.ts`) still names Eliza Cloud. Once staging and
production pass `smoke` and a test-mocks build passes sign-in, plans and voice against them
(`ALPHA_CLOUD_DEPLOYMENT_FILE=cloud/policy.json`):

1. Change `SHIPPED_CLOUD_DEPLOYMENT` to `cloud/policy.json`'s rows. The App Link host becomes
   `cloud.alphacompute.ai`.
2. Append the new storage namespace to `STORAGE_NAMESPACES` and add the namespace migration. Users
   sign in again; Eliza Cloud accounts, subscriptions and Google grants do not move by themselves.
3. Build, sign and publish through OTA (section 6).

Changing the policy before the Cloud is live would sign every phone out to a Cloud that does not
answer, so this stays a separate, deliberate release.

## 9. Upstream

- Packaging works from the pin: `prepare` exports `vendor/eliza`, installs with the pinned Bun
  (1.4.2) and runs `build:core`. Two footguns for consumers building outside upstream CI, found here:
  under another Bun, plugin-elizacloud's build emits a broken import, and `@elizaos/agent`'s type
  build exceeds Node's default heap. Fixed upstream: `build:core` now refuses a non-pinned Bun and
  defaults the heap (see the PR linked from this change).
- Native clients are database-only upstream (migration 0574) with no registration command; this
  repository seeds them (`cloud-registration.ts`). The plan catalogue (Plus $30, Pro $100) is fixed
  upstream.
- The server packages (`@elizaos/cloud-api` and others) are publishable but not on npm, so the Cloud
  builds from the pinned checkout. When they publish, `cloud/worker.ts` builds from an install
  (`cloud:worker` already supports `--packages` for the API).
