# #665 Subscription catalog, plan request limits and Maps allowance (H-02, H-03, H-04)

Owner prep, 2026-10-28. Requirements and reference only: nothing here is a decision, a deployed
setting or evidence that Maps or plan admission works. The owner makes the three selections; the
Cloud operator applies them (#666 for H-15, #667 for H-16).

## What was prepared

| File | Purpose |
| --- | --- |
| [`drafts/665-recorded-catalog-v1.json`](drafts/665-recorded-catalog-v1.json) | The production catalog as published on 2026-10-28 (unauthenticated GET), recorded so a later read can be compared field by field |
| [`drafts/665-plan-rate-limits.draft.json`](drafts/665-plan-rate-limits.draft.json) | `ELIZA_CLOUD_PLAN_RATE_LIMITS` in the upstream schema, every number a `<...>` placeholder |
| [`drafts/665-maps-request-allowances.draft.json`](drafts/665-maps-request-allowances.draft.json) | `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` in the upstream schema, placeholders only |
| [`scripts/owner/subscription-limits.mjs`](../../scripts/owner/subscription-limits.mjs) | Read-only: `catalog` compares the live catalog with the record; `rate-limits` and `maps-allowances` validate a filled draft with the pinned upstream parser rules and print the one-line operator value |
| [`test/owner-subscription-limits.test.mjs`](../../test/owner-subscription-limits.test.mjs) | Stubbed tests for the comparison and both validators |

Schemas were read at the pin in `upstream.lock.json` (`1f2a922f86e2a1f3d6cd62e097145492bd49ebfc`):
`packages/cloud/shared/src/lib/services/plan-request-limiter.ts` (`parsePlanRequestLimitConfig`),
`packages/cloud/shared/src/lib/services/maps-request-policy.ts` (`mapsRequestAllowance`) and
`packages/cloud/api/src/maps-request-allowance-controller.ts` (Maps admission).

## Read-only findings (2026-10-28)

`node scripts/owner/subscription-limits.mjs catalog`:

- **Production** `GET https://api.eliza.app/api/v1/subscriptions/plans`: HTTP 200, catalog `v1`,
  identical to H-02's text. Plus (`plus_monthly`) USD 30.00 a month, USD 25.00 allowance, no
  rollover, 120/200/60/10 per minute; Pro (`pro_monthly`) USD 100.00, USD 90.00, no rollover,
  300/600/120/30 (completions/embeddings/standard/strict). Both also publish resource ceilings
  (5 characters, 5 sandboxes, 1 container, 5 GiB, 25 apps; 10 API keys Plus, 25 Pro), which H-02
  does not mention.
- **Staging** `GET https://api-staging.eliza.app/api/v1/subscriptions/plans`: **HTTP 503
  `service_unavailable`** ("Subscription plans are temporarily unavailable"). Staging cannot serve
  the catalog today, so the staging QA in `docs/cloud-subscription-qa.md` and the #666 benchmark
  will need the operator to look at this first.

Upstream behaviour that shapes the choices:

1. `ELIZA_CLOUD_PLAN_RATE_LIMITS` unset means the limiter is off. `placeholder` enables unselected
   test numbers (default plan: burst 10 at 0.5/s, sustained 600 per hour) and is for tests only.
2. Plan resolution: a request uses its plan key's buckets only while the plan window has not ended;
   **a cache miss, an ended window and a billing outage all use `plans.default`**. So `default` is
   both "what a new or uncached request gets" and "what a lapsed account gets during an outage".
3. Buckets are per Worker isolate: a caller spread over N isolates gets up to N buckets. They bound
   bursts; the organization Durable Object window (`completionsRpm` from the catalog) stays the
   global inference cap. Maps has only these buckets plus the per-credential route limit.
4. Maps uses a plan's `maps` buckets when given, otherwise the plan's own numbers, so choosing the
   plan numbers also chooses Maps rates unless `maps` is set.
5. **Maps admission refuses every request with `maps_allowance_unconfigured` unless
   `ELIZA_CLOUD_PLAN_RATE_LIMITS` parses with `selected: true`**, even when the Maps allowance is
   selected. H-03 is therefore a hard prerequisite of Maps, not only of inference limits.
6. **`ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` has no default fallback.** A plan key not listed answers
   `maps_allowance_unconfigured`. Both `plus_monthly` and `pro_monthly` must be listed, and any
   future catalog key (or a grant-code plan key) must be added when it appears.
7. Maps windows start at UTC epoch multiples of `windowSeconds`; a 30-day window does not align
   with the billing period or the calendar month. A changed window length refuses until the
   current window ends; usage carries across a policy change.

## Decisions for the owner

### H-02 Confirm or replace catalog v1

| Option | What it changes |
| --- | --- |
| **A. Confirm v1 as published** (documented default: these are the server's values) | Nothing deploys. Record a P- entry; the readiness check above becomes the H-02 verify. The pilot plan terms (H-26) use Plus/Pro as published. |
| B. Replace prices or allowances | Cloud must publish a new catalog version (`v2`); plan-change quotes and grant codes carry the catalog version, so existing subscribers stay on `v1` until migrated. Re-record with `catalog --recorded`. Alpha shows no prices, so no app change. |
| C. Change per-minute limits only | Same as B (they are catalog fields), and they also move the global inference cap the buckets sit under. |

Implications of v1 numbers: the USD 25 / USD 90 allowances are inference funds (usd_micros in the
entitlement `plan_allowance`); Maps never draws on them (P-56). No rollover means unused allowance
is lost at period end. The per-minute numbers are the organization-wide caps; H-03 only shapes
bursts beneath them.

### H-03 Plan request limits (`ELIZA_CLOUD_PLAN_RATE_LIMITS`)

Recommendation: record numbers derived from the v1 per-minute caps so the buckets never refuse a
request the global window would admit, and choose `default` deliberately because it also governs
cache misses and outages. These are options with their arithmetic, not selected values.

| Option | default | plus_monthly | pro_monthly | Effect |
| --- | --- | --- | --- | --- |
| **A. Aligned to v1 caps** (recommended) | burst 10 @ 1/s, sustained 60 @ 1/s | burst 20 @ 2/s, sustained 120 @ 2/s | burst 50 @ 5/s, sustained 300 @ 5/s | Sustained equals `completionsRpm`; burst lets a 10-20 s spike through. A cache miss or outage gets half of Plus. |
| B. Conservative pilot | burst 5 @ 0.5/s, sustained 30 @ 0.5/s | burst 10 @ 1/s, sustained 60 @ 1/s | burst 20 @ 2/s, sustained 150 @ 2.5/s | Half of the caps; protects provider cost during the pilot; more `429 rate_limited` with `retryAfterSeconds` visible in Alpha. |
| C. Upstream placeholder numbers | burst 10 @ 0.5/s, sustained 600 @ 1/6 per s (for every plan) | same | same | Not a decision upstream ("unselected test values"); listed only to show what `placeholder` does. Not recommended. |

For Maps, either omit `maps` (Maps then uses the plan numbers above) or add per plan, for example
`maps: { burst: 5 @ 0.2/s, sustained: 60 @ 1/60 per s }` so a misbehaving client cannot exhaust a
day's Maps allowance in a minute. Validate the filled file with
`node scripts/owner/subscription-limits.mjs rate-limits FILE`.

### H-04 Maps request allowance (`ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES`)

A Maps "request" is one admitted search, geocode, reverse, details or route call. A typical trip
is one search, one details and one to three route calls (reroute only on the user's request), so
about 3-5 requests. With the self-hosted reference stack the marginal provider cost per request is
close to zero; the cost is the fixed hosting chosen in H-05.

| Option | plus_monthly | pro_monthly | Effect |
| --- | --- | --- | --- |
| **A. Daily windows** (recommended: aligns to UTC days, easy to explain) | 200 / 86400 s | 1000 / 86400 s | About 40 and 200 trips a day. Resets at 00:00 UTC. |
| B. 30-day windows | 3000 / 2592000 s | 15000 / 2592000 s | Fewer refusals for bursty users, but windows start at UTC epoch multiples of 30 days, not the billing date; harder to explain. |
| C. Closed until Maps is provisioned | 0 / 86400 s | 0 / 86400 s | Valid closed allowance: requests are refused as allowance exhausted instead of `maps_allowance_unconfigured`. Useful to deploy the setting before H-16 without serving Maps. |

Validate with `node scripts/owner/subscription-limits.mjs maps-allowances FILE --rate-limits LIMITS_FILE`.

## Exact remaining human steps

1. Owner: choose H-02 (A, B or C), H-03 and H-04 options or other numbers.
2. Owner: fill copies of the two drafts (`selected: true`), run both validators, and record three
   dated P- entries in `docs/decisions.md` (drafts below).
3. Cloud operator: set the printed one-line values per environment (#666 step H-15 for the rate
   limits, #667 step H-16 for the Maps allowance). Staging first.
4. Operator: investigate the staging catalog 503 before staging QA.
5. Evidence: `node scripts/owner/subscription-limits.mjs catalog` exits 0 for production (it does
   today); an authenticated Maps request on a signed-in phone returns a result or a typed refusal,
   not `maps_allowance_unconfigured` (real-integration evidence, recorded separately).

## Draft decision entries

Not committed to `docs/decisions.md`; the owner edits the numbers and the P- number.

- **P-NN — H-02 (#665):** Confirm Eliza Cloud subscription catalog `v1` as published on
  2026-10-28: Plus `plus_monthly` USD 30 a month with a USD 25 period allowance, Pro `pro_monthly`
  USD 100 with USD 90, no rollover, per-minute limits 120/200/60/10 (Plus) and 300/600/120/30
  (Pro). Recorded copy: `docs/runbooks/drafts/665-recorded-catalog-v1.json`. Policy, not evidence.
- **P-NN — H-03 (#665):** `ELIZA_CLOUD_PLAN_RATE_LIMITS` selected as `{...one-line value...}`
  (option A/B), `selected: true`. `default` applies to cache misses, ended plan windows and billing
  outages. Applied by the Cloud operator under H-15.
- **P-NN — H-04 (#665, P-56):** `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` selected as
  `{"selected":true,"plans":{"plus_monthly":{...},"pro_monthly":{...}}}`. Every catalog plan key
  is listed (no fallback). No per-request charge. Applied under H-16.
