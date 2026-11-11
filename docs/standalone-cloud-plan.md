# Standalone product clouds: review and plan

Date: 2026-11-11. Status: review complete; the first Alpha Phone steps are built (section 7).
No upstream change, deployment or cutover has happened.

Goal: Alpha Phone and Grace each run their own cloud (own domain, Cloudflare account, database,
Google Cloud project, mail sender, Stripe account, app ids), built from upstream Eliza Cloud
packages published to npm, with no dependency on `eliza.app`. Upstream keeps a default deploy
built from the same packages. Adding a product must need no upstream edit. Until the Alpha
cloud is deployed, the shipped Alpha Phone keeps signing in through Eliza Cloud unchanged.

Evidence base: `vendor/eliza` at the pin `a24e5aa6c5`, this repository on
`claude/signin-e2e-20261111`, a shallow clone of `gracefultechnology/grace` at `6a62ceb`, and
the npm registry. Items marked *inferred* were not traced end to end.

## 1. Where things stand

### 1.1 Upstream Eliza Cloud is an application, not a library

| Piece | Path in `elizaOS/eliza` | State |
|---|---|---|
| API worker | `packages/cloud/api` (`@elizaos/cloud-api`) | Private, source only, 798 `route.ts` files, about 221k lines. Cloudflare Worker on Hono. |
| Server library | `packages/cloud/shared` (`@elizaos/cloud-shared`) | Private, 706 `exports` pointing at `.ts`, no build, about 694k lines. Depends on 12 plugins and `@elizaos/auth`. |
| Sign-in service (Steward) | `packages/auth` (`@elizaos/auth`) | Published. Runs as Bun plus Postgres, embedded PGlite, or a Cloudflare container. The most self-hostable piece. |
| Client SDK, routing | `packages/cloud/sdk`, `packages/cloud/routing` | Published. Base URL is injectable; Eliza hosts are only defaults. |
| Agent plugin | `plugins/plugin-elizacloud` | Published. `ELIZAOS_CLOUD_BASE_URL` overrides the host; no allowlist rejects other hosts. |
| Web front end | `packages/app` (Pages project `eliza-app`) and `packages/ui/src/cloud` | Brand, tenant and API worker name are baked in. |
| Speech and admission workers | `packages/cloud/speech-worker`, `admission-worker` | No `package.json`; a `wrangler.toml` plus `src`. |
| Other services | `packages/cloud/services/*` | Private. Railway, Hetzner and Kubernetes deployments for gateways, containers, provisioning. |
| Deploy tooling | `packages/cloud/scripts`, `.github/workflows/cloud-*.yml` | About 88k lines of scripts and 11k lines of workflow that assert the eliza.app identity. |

On npm today: `@elizaos/cloud-sdk`, `@elizaos/cloud-routing`, `@elizaos/auth`,
`@elizaos/plugin-elizacloud`. Not on npm: `@elizaos/cloud-api`, `@elizaos/cloud-shared`,
`@elizaos/cloud-services-common`, `@elizaos/plugin-network`.

The upstream design intent is many apps registered on one Eliza Cloud
(`ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON`, `ELIZA_NATIVE_AUTH_CALLBACKS_JSON`, Steward
`tenant_app_clients`), not many clouds. There is no self-hosting document and no
deployment-config object.

### 1.2 What forces an upstream edit to stand up a second cloud today

1. **`wrangler.toml` is the deployment.** Eight files commit the Cloudflare account id, zones
   and routes, Hyperdrive, KV and R2 ids, worker names used in service and Durable Object
   bindings, and identity vars such as `ELIZA_ENTITLEMENT_AUDIENCE = "eliza-alpha-phone"`.
2. **`plugins/plugin-elizacloud/src/cloud-config/domain-contract.ts`** is a frozen Eliza-only
   map imported by about 40 files. It feeds items 3 and 4.
3. **Credentialed CORS and CSRF are static**: `cloud-shared` `cors/first-party-origin.ts` and
   `auth/browser-origin-policy.ts`. A new product's web origin is not first-party for cookie
   flows. Bearer-key calls from the phone are unaffected.
4. **Pages callbacks**: `packages/cloud/scripts/pages-native-auth-callbacks.ts:46-58` rejects
   any native callback whose origin is not an Eliza contract origin; the Pages project name is
   fixed.
5. **No factory.** `createApp()` takes only a request path. Configuration is ambient: 307
   `getCloudAwareEnv()` call sites and 545 further `process.env` reads in `cloud-shared`.
6. **Routing is tied to the package directory.** Codegen emits relative imports for all routes,
   so a consumer cannot subset or compose without vendoring the tree.
7. **Branding literals**: "Eliza Cloud" in 128 runtime files, six transactional email
   templates (the welcome template has staging links baked in), Maps attribution
   `CLOUD_OPERATOR`, six `topUpUrl` literals, the speech consent URL
   (`speech-relay-coordinator.ts:110`), Steward's default mail footer.
8. **Silent Eliza fallbacks**: about 20 `|| "https://cloud.eliza.app"`, `blob.eliza.app`,
   `noreply@eliza.app`, `login@eliza.app`, `push@eliza.app`, passkey RP `eliza.app`, tenant
   default `elizacloud`. An unset variable on a product cloud points at Eliza without failing.
9. **Catalog and schema assumptions**: plan keys fixed to `plus_monthly` and `pro_monthly`;
   grant-code family defaults to `alpha_phone` in migration 0542; `ENVIRONMENT` must be exactly
   `staging` or `production`; 573 linear migrations with no baseline for a new database.
10. **Topology is wide**: Cloudflare Workers, Pages and containers; Railway Postgres and Redis;
    Hetzner; optional Kubernetes. No minimal profile is defined.

### 1.3 Alpha Phone is already close on the app side

- One policy file, `scripts/cloud-deployment-policy.ts`, feeds the renderer
  (`apps/app/src/runtime/cloud-deployment.generated.ts`), native code (`CloudDeployment.java`),
  Gradle and the manifest app-link host. `npm run verify` fails on drift.
- `test/cloud-deployment.test.mjs` already drives a different deployment through native login,
  request admission, revocation and inference configuration.
- The display name is white-labelled and enforced by `test/white-label-copy.test.mjs`. CSP,
  network security config and CI workflows pin no cloud host.
- Remaining literals outside the policy: the Steward Google client key `alpha-phone`, client id
  and callback path in `AlphaCloudSignInPlugin.java:37-45` and `scripts/cloud-readiness.ts:47`;
  staging ban strings in `scripts/audit-production-bundle.ts:28,66`; two Quint probe pins;
  about 420 host literals in 44 test files; `README.md:246-290`.
- Stored credentials are namespaced by a hash of both environments' authorities
  (`scripts/cloud-deployment.ts:45-51`). Changing any field signs every phone out unless a
  migration is written; the check refuses the change until `STORAGE_NAMESPACES` grows.
- No script here runs a local copy of the upstream cloud; everything talks to hosted Eliza
  Cloud or mocks it.

### 1.4 Grace

- App id `technology.graceful.grace`; pin `7743504b`. Cloud identity is a hand-written preset
  table in `apps/app/host/cloud-environment.ts:28-47` with a host allowlist that accepts only
  eliza.app hosts, plus duplicated literals in `LocalRuntimeService.java`, `AndroidManifest.xml`
  and `apps/app/scripts/verified/apk-policy.ts` (with a Dafny copy). Nothing is generated.
- Hosted registration for Grace is still pending upstream (`401 invalid_client`), which is the
  exact problem this plan removes.
- Grace already owns its Google return domain (`graceful.technology`) and already has
  `apps/app/scripts/run-local-cloud.ts`: embedded Steward, the Cloud API under
  `wrangler --local` with PGlite, a TLS proxy, tenant creation, client registration and seeded
  `apps` rows, all from a `git archive` export of the pin. That is the self-host recipe at
  development scale and the best starting point for both products.
- Grace needs beyond Alpha: Stripe subscriptions (embedded checkout, portal, plan change),
  SMS codes and MFA, Gmail restricted scopes, pilot grant codes, and an optional
  `/api/v1/decisions` route.

## 2. Target design

### 2.1 Upstream packages

| Package | Role |
|---|---|
| `@elizaos/cloud-config` (new) | `defineCloudDeployment()`: one typed object for origins, tenant, brand name and legal links, mail sender, first-party web origins, mobile clients, asset links, native callbacks, entitlement issuer and audience, plan catalog, Maps settings, feature profile. Replaces `domain-contract.ts`; every CORS, CSRF, redirect and email reader takes it from here. No Eliza default: a missing value fails at start. |
| `@elizaos/cloud-shared` (publish) | Built `dist`, trimmed exports, plugin dependencies made optional per feature. |
| `@elizaos/cloud-api` (publish) | Exports `createCloudWorker(deployment, { profile })` returning `{ fetch, scheduled }` and the Durable Object classes. Route profiles: `core` (sign-in, app-auth, account, entitlement, inference, embeddings, speech, Maps, Google connector, delegation, public service) and `full` (everything upstream runs). |
| `@elizaos/auth` (exists) | Steward. Remove Eliza fallbacks; tenant, mail sender, passkey RP and Google clients become required configuration. |
| `@elizaos/cloud-web` (new, small) | Brandable Pages app for the pages a thin product needs: native auth callback and browser-start, `assetlinks.json`, consent return, billing. |
| `@elizaos/cloud-deploy` (new) | CLI: renders `wrangler` config from the deployment plus resource ids, provisions Cloudflare resources, runs migrations (with a baseline for new databases), seeds the tenant and `apps` rows, and runs a readiness probe. |
| `@elizaos/cloud-conformance` (new) | Black-box contract suite any deployment must pass. Extracted from `packages/cloud/e2e` and the product readiness scripts. |

Upstream default deploy: a directory such as `packages/cloud/deployments/eliza` holding
Eliza's `deployment.ts`, resource ids and brand assets, consuming the packages exactly as a
downstream product does. The eliza.app release workflows move there.

### 2.2 A product's thin cloud

```
cloud/
  deployment.ts        defineCloudDeployment({...})  product identity, no secrets
  worker.ts            export default createCloudWorker(deployment, { profile: 'core' })
  resources.json       Cloudflare account, zone and resource ids per environment
  secrets.example      names only
  brand/               email templates, logo, legal links
.github/workflows/cloud-deploy.yml
```

The product repo holds no route code. Its cloud version is the npm version of the upstream
packages, bumped with the same review as the `vendor/eliza` pin. The app's
`scripts/cloud-deployment-policy.ts` and `cloud/deployment.ts` read the same origins, so app
and cloud cannot drift.

### 2.3 Minimal profile (what Alpha Phone actually calls)

- Sign-in: Steward `auth/providers`, email code send and verify, Google authorize and
  exchange, MFA, logout; `app-auth/mobile/{config,token,ack}`, `app-auth/connect`;
  `{web}/alphaphone/auth/{callback,browser-start}`; `{web}/.well-known/assetlinks.json`;
  `/api/public/service`.
- Account: `v1/user`, `v1/billing/limits`, `v1/subscription/{entitlement,entitlement-keys,redeem}`,
  `DELETE v1/api-keys/current`, the billing page.
- Agent: `v1/chat/completions`, `v1/responses`, `v1/models`, `v1/embeddings`.
- Voice: `v1/voice/{stt,tts,session}` plus the speech and admission workers.
- Maps: `v1/maps/*`.
- Google: `v1/eliza/google/*` (accounts, connect, Calendar, Gmail), `v1/oauth/google/callback`.
- Infrastructure: one API worker, Steward (container worker), Pages, Postgres, KV, R2,
  Redis-compatible rate limiting. No Railway gateways, Hetzner or Kubernetes.

## 3. Changes required

### 3.1 Upstream (`elizaOS/eliza`), in dependency order

| # | Change | Notes |
|---|---|---|
| U1 | Introduce `@elizaos/cloud-config` and thread it through `domain-contract.ts` consumers | Eliza's values become one instance. Behaviour-preserving for eliza.app. |
| U2 | CORS, CSRF, redirect validation, Stripe return origins read first-party origins from the deployment | `first-party-origin.ts`, `browser-origin-policy.ts`, `utils/cors.ts`, `security/redirect-validation.ts`, `stripe/create-checkout-session`. |
| U3 | Remove silent Eliza fallbacks; fail closed when identity is unset | App URL, blob host, mail senders, passkey RP, tenant default, `CLOUD_BASE_FALLBACK`, speech consent URL, `topUpUrl`. |
| U4 | Brand from the deployment | Email templates, Maps `CLOUD_OPERATOR`, user-facing "Eliza Cloud" strings, docs links, Steward mail footer. |
| U5 | `createCloudWorker(deployment, { profile })` and route profiles | Router codegen emits per-profile manifests importable from the package. |
| U6 | Build and publish `cloud-shared`, `cloud-services-common`, `plugin-network`, `cloud-api`; add them to `release-cohort.json`; align `cloud-api` to the cohort version | Make heavy plugin dependencies optional by profile. |
| U7 | `@elizaos/cloud-deploy`: wrangler rendering, provisioning, migrations with a baseline, tenant and app seeding | Remove account ids and worker names from committed config for anything but the Eliza deployment directory. |
| U8 | Speech and admission workers as packages with injected names and bindings | Cross-script Durable Object bindings currently name `eliza-cloud-api-*`. |
| U9 | `@elizaos/cloud-web` and removal of the Eliza-origin check in `pages-native-auth-callbacks.ts` | Callback origins validated against the deployment. |
| U10 | Catalog and schema: plan catalog from the deployment; grant-code family without a product default; `ENVIRONMENT` decoupled from deployment name | New migration; existing rows unchanged. |
| U11 | Move the eliza.app deploy into `packages/cloud/deployments/eliza` using the public API | Proves the default deploy and the downstream path are one path. |
| U12 | `@elizaos/cloud-conformance` and a CI job that stands up a second, non-Eliza deployment and greps its bundle for Eliza hosts | The regression guard for all of the above. |

Per AGENTS.md these are upstream pull requests; `vendor/eliza` advances to reviewed commits and
is never edited in place.

### 3.2 Alpha Phone (this repository)

| # | Change | When |
|---|---|---|
| A1 | Local cloud harness: port Grace's `run-local-cloud.ts` approach (pinned export, embedded Steward, `wrangler --local`, PGlite, seeded tenant and `ai.alphacompute.alphaphone` client), behind `ELIZA_DEV_ALLOW_TEST_MOCKS=1` | Now. Needs no upstream change and exposes real identity leaks. |
| A2 | Move product registration constants (Steward client key, client id, callback path) from `AlphaCloudSignInPlugin.java` and `cloud-readiness.ts` into the policy and generator | Now. |
| A3 | Add a third, development-only deployment row (`candidate`) for the Alpha cloud, excluded from the storage fingerprint and from production bundles | Now. Lets the whole integration be written and tested without touching production sign-in. |
| A4 | Derive test host literals, Quint probe pins and audit ban strings from the policy | Now, incrementally. |
| A5 | `cloud/` directory per section 2.2 | When U5 to U7 publish. Until then, a wrangler config in this repo pointing at the pinned source is the interim (*inferred* to work; A1 will confirm). |
| A6 | `cloud-readiness.ts` runs the conformance suite against any deployment | With U12. |
| A7 | Cutover change: production row to the Alpha origins, append the new namespace to `STORAGE_NAMESPACES`, namespace migration, new asset links and app-link host, operator docs | Only at cutover. |

The provider id `elizacloud` and the `eliza_mobile_` key prefix are upstream protocol names,
not deployment identity; they stay.

### 3.3 Grace

| # | Change |
|---|---|
| G1 | Replace the preset table and host allowlist in `cloud-environment.ts` with a generated policy as in Alpha Phone; generate the Java defaults, manifest App Links and `apk-policy` rows (and regenerate the Dafny copy). |
| G2 | Point `run-local-cloud.ts` at the shared harness once A1 and it converge; ideally the harness moves upstream into `@elizaos/cloud-deploy`. |
| G3 | `cloud/` directory with profile `core` plus billing; Stripe account, SMS provider, Gmail restricted-scope verification for Grace's own Google client. |
| G4 | Replace "Eliza Cloud" in user-facing privacy copy with the deployment name. |

### 3.4 Operator setup per product (no code)

Cloudflare account and zones; Postgres; Google Cloud project (web OAuth client for Steward
sign-in, Android OAuth client with package and release SHA-1, Workspace connector client and
consent screen verification, Maps key); mail provider with verified sender domain; Stripe;
model and speech provider keys; entitlement signing key; Steward secrets; release signing
certificate fingerprints for asset links.

## 4. Tests and validation

| Layer | What it proves | Where |
|---|---|---|
| Identity guard | A non-Eliza deployment bundle contains no `eliza.app`, `elizacloud.ai`, `elizacloud` tenant or "Eliza Cloud" | Upstream CI (U12) |
| Fail-closed config | Each required identity field, when unset, stops the worker at start instead of falling back | Upstream unit tests (U3) |
| Published-artifact test | A scratch project installs the packed tarballs, defines a deployment and boots `createCloudWorker` under `wrangler --local` | Upstream release workflow |
| Default-deploy parity | eliza.app built through the public API passes the existing cloud test and certification suites unchanged | Upstream (U11) |
| Conformance suite | Sign-in (email code, Google), app-auth PKCE, entitlement token and keys, inference, embeddings, STT and TTS, Maps, Google connector, key self-revocation | Against local harness, Alpha staging, Alpha production |
| Migration test | A fresh database reaches the current schema from the baseline; an existing Eliza database is unaffected | Upstream |
| App against candidate cloud | Existing flows (`test/cloud-deployment.test.mjs`, sign-in, voice, Maps, Gmail and Calendar suites) pass with the `candidate` row | This repo, test-mocks builds |
| Production unchanged | `npm run verify`, `scripts/audit-production-bundle.ts`, storage fingerprint equal to the current namespace, both distribution variants built | This repo, every change before cutover |
| Device | Release-signed APK: App Link verified for the new host, Google native sign-in, resident agent first reply, voice, Maps | Emulator HOME-role test, then real device; neither proves the other |
| Cutover rehearsal | Upgrade an installed, signed-in build to the cutover build: namespace migration, re-sign-in prompt, old key revoked | Device |

## 5. Phases

1. **Now, no upstream dependency**: A1 to A4. Production sign-in through Eliza Cloud is
   untouched because the production row and the storage fingerprint do not change.
2. **Upstream foundations**: U1 to U4, then U12's guard. Each is behaviour-preserving for
   eliza.app and can merge independently.
3. **Upstream packaging**: U5 to U11. First publish of the server packages.
4. **Alpha cloud staging**: A5 and A6; deploy to a staging domain; conformance green; test-mocks
   builds use it as `candidate`.
5. **Alpha cloud production, dark**: deployed and conformance green while shipped builds still
   use Eliza Cloud.
6. **Cutover**: A7 in one release. Grace follows the same phases from G1.

## 6. Risks and decisions for the owner

- **Accounts do not move by themselves.** Steward users, `eliza_mobile_` keys, subscriptions,
  entitlements (issuer is the API origin) and Cloud-held Gmail and Calendar grants live in
  Eliza Cloud's database. Recommended: users sign in again on the new cloud at cutover and
  reconnect Google; the cutover build revokes the old key first. The alternative, an export
  and import from Eliza Cloud, needs Eliza operator work and moves secrets between databases.
- **Google verification lead time.** A new OAuth client asking for Gmail and Calendar scopes
  needs Google's consent-screen verification; restricted Gmail scopes need a security
  assessment. Start this early; it gates production, not development.
- **Domain.** The app-link host is derived from the production `web` origin, so the domain
  choice fixes the Android manifest, asset links and the Google Android client. Staging can
  proceed on any domain.
- **Scope of the first publish.** Publishing roughly 900k lines of server source as built
  packages is the largest single piece of upstream work. The `core` profile bounds what must
  be clean first; `full` can follow.
- **Interim source builds.** Until U6 lands, a product cloud can only be built from the pinned
  source tree, with the product supplying its own wrangler config. That is acceptable for
  staging; production should wait for U1 to U3 so no unset variable can reach eliza.app.
- **Upstream ownership.** U1 to U12 change shared code used by the live eliza.app deploy and
  need upstream review and release sequencing.

## 7. Built so far (this repository)

- **Local standalone Cloud** (`scripts/local-cloud.ts`, `npm run cloud:local`): exports the
  pinned upstream source outside the checkout, runs Steward and the Cloud API worker with
  Alpha's own tenant (`alphacloud-local`), client registration, entitlement signing key and
  service documents, behind one TLS front door.
- **Contract check** (`cloud:local -- check`): 15 gates, all passing on 2026-11-11 against
  the pin `a24e5aa6c5`: registration, sign-in methods, entitlement keys, service document, a
  real email-code sign-in, app authorization, credential mint and acknowledgement, account
  read, entitlement, self-revocation and its enforcement, and no answer naming an Eliza host.
  This is a local source-build result, not a deployed Cloud, an APK or a device result.
  Inference, speech, Maps, the Google connector and Google sign-in are not exercised yet.
- **Candidate deployment** (`ALPHA_CLOUD_DEPLOYMENT_FILE`): the build and operator tools can
  address another Cloud from one JSON file. It gets its own credential namespace, the committed
  build check fails until authorities are regenerated, and the production bundle audit refuses
  it. Without the variable everything is the shipped Eliza Cloud policy, byte for byte.
- **Policy-derived literals**: the audit's staging host denylist and the Steward app client
  name now come from the policy.

What the local Cloud taught us (inputs to U1 to U3):

- The deployment had to override 15 committed `wrangler.toml` values to stop being Eliza's:
  the app, API and Cloud URLs, tenant, entitlement issuer, audience and key, service name
  and documents, the mobile client registry and reserved app id, the blob host, and the
  assets CDN base. That list is the start of the deployment-config schema.
- Two silent fallbacks reached a client answer: `R2_PUBLIC_HOST` and
  `NEXT_PUBLIC_ASSETS_CDN_URL` both default to `blob.eliza.app`, and a new account's default
  avatar URL named it until both were set.
- Mobile App Auth accepts only `ENVIRONMENT` `staging` or `production`, and upstream's
  reserved first-party client needs an `apps` row even on a product Cloud.
- The install-time build set omits three plugin outputs the Worker bundle imports
  (`plugin-google-workspace`, `plugin-todos`, `plugin-wallet`), and `plugin-elizacloud`'s
  post-build self-check fails at this pin although its output is usable.

Next in this repository: extend the check to inference, speech, Maps and the Google
connector (needs provider keys), then point a test-mocks build at the local Cloud.
