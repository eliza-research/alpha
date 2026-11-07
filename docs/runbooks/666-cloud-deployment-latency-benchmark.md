# #666 Cloud subscription, sign-in and entitlement operations; deployed admission-latency benchmark (H-11, H-14, H-15)

Owner prep, 2026-10-28. The probe below is unauthenticated deployment-configuration evidence only:
not a sign-in, plan admission, latency measurement or device result. The benchmark was **reviewed,
not executed**: it makes real, billed or counted requests and needs the operator's confirmation and
prepared accounts.

## What was prepared

| File | Purpose |
| --- | --- |
| [`evidence/cloud-readiness-2026-10-28.json`](evidence/cloud-readiness-2026-10-28.json) | Fresh probe record, both environments (draft; the owner may move it to `docs/evidence/`) |
| [`drafts/666-latency-config.staging.template.json`](drafts/666-latency-config.staging.template.json) | Benchmark config template for staging; keys named by environment variable only |
| [`drafts/666-latency-report.schema.json`](drafts/666-latency-report.schema.json) | JSON Schema for the committed report: the harness's `results.json` plus provenance, no credential fields |
| [`scripts/owner/latency-report.mjs`](../../scripts/owner/latency-report.mjs) | `config` (pre-run check, request budget), `check` (schema + credential scan of a report), `wrap` (adds provenance, then checks). Local files only |
| [`test/owner-latency-report.test.mjs`](../../test/owner-latency-report.test.mjs) | Synthetic tests: template refusal, literal-key refusal, schema, redaction without echoing values |

## Read-only findings: probe, 2026-10-29 03:59 UTC (2026-10-28 local)

`node scripts/cloud-readiness.mjs probe [--environment staging] --json` at origin/main `94676c82`, re-run at `f4ebce3b` (2026-10-28 22:15 local) with identical outcomes:

| Gate | Production | Staging |
| --- | --- | --- |
| registration (H-11) | pass: `ai.elizaresearch.alphaphone` registered for `https://eliza.app/alphaphone/auth/callback`, S256 | pass (`https://staging.eliza.app/...`) |
| email sign-in (H-12) | pass | pass |
| native Google (H-12) | pass | **FAIL**: `googleNative` not advertised (#669) |
| browser return (H-12) | pass | pass |
| App Links (H-13) | **FAIL**: release signer `unset`; two non-release certificates listed (#670) | pass (one debug certificate, test-mocks builds) |
| callback page (H-13) | pass | pass |
| service documents (H-14) | pass: Terms and Privacy published by Eliza Cloud | pass |
| entitlement keys (H-15) | pass: `entitlement-production-2026-10` | pass: `entitlement-staging-2026-10` |
| Maps route (H-16), Google connector (H-17) | needs an account (not requested) | needs an account |

Every outcome equals the 2026-10-27 record. The three gates this issue owns (registration,
service documents, entitlement keys) pass in both environments. Both environments exit 1 because
of the #669/#670 gates. Supplementary: the staging subscription catalog answers **HTTP 503
`service_unavailable`** (see #665); production answers 200 with catalog v1.

Not checkable without operator access, so not claimed: whether `ELIZA_CLOUD_PLAN_RATE_LIMITS` is
set, whether `ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER` is set, which migration is applied, and the
Steward/Cloud registry contents.

## Inconsistency in `docs/human-actions.md` H-15 (not edited here)

1. H-15 says "no harness for it exists at the pin: upstream has only the local lower-bound harness
   `plan-request-limit-latency.ts`". The deployed harness
   `packages/cloud/scripts/plan-admission-deployed-latency.ts` (and its test) **exists at the
   current pin `1f2a922f`**, and the pinned `packages/cloud/api/README.md` documents it. The issue
   text says it is "now on develop"; it is also at the pin.
2. H-15's Verify line ("a deployed latency report once a harness exists") should name the harness
   and the report schema above.
3. Condition names differ: H-15 lists normal, cache-miss, exhausted, expired, billing-outage (the
   harness's names); the issue lists admitted, cache-miss, exhausted, ended window, billing outage.
   Use the harness's names.

Suggested replacement text for whoever owns `docs/human-actions.md`: "Deployed admission latency is
measured with the pinned `packages/cloud/scripts/plan-admission-deployed-latency.ts` (conditions
normal, cache-miss, exhausted, expired, billing-outage) only with the operator's confirmation; the
committed report follows `docs/runbooks/drafts/666-latency-report.schema.json` and passes
`node scripts/owner/latency-report.mjs check`."

## Read-only review of the harness (pin `1f2a922f`, not executed)

What it does: an unauthenticated baseline (`GET /api/v1/subscription/entitlement-keys`), then per
configured condition and service sequential requests on the existing routes: a one-token
`POST /api/v1/chat/completions` (`max_tokens: 1`) and `POST /api/v1/maps/geocode` (`limit: 1`),
each with `Authorization: Bearer <key from the named env var>` and a fresh `Idempotency-Key`. It
records client time to headers, status, a classified outcome and Server-Timing `gateway_auth` /
`gateway_preforward`; it reports p50/p95/mean and "added over baseline". It refuses to start
without `--confirm-real-requests`. Output: `<eliza checkout>/test-results/plan-admission-deployed-latency/results.json`.

Safe properties confirmed by reading: keys are read only from environment variables named in the
config and are never written to the result or printed; response bodies are read up to 64 KiB for
classification and discarded; `redirect: "error"`; 30 s per-request deadline; a lost request is an
`unavailable` sample, not a crash; the config must use exact `https` origins.

Points the operator must plan for:

1. **What is billed or counted.** `normal` sends warmup + iterations requests per service
   (53 with the defaults) and `cache-miss` iterations per service (50): all admitted, so billed
   against the inference allowance and, for Maps, consuming the Maps allowance and leaving one
   durable replay record per admitted request (never expired upstream). `exhausted` and `expired`
   requests are refused but still pass the per-credential limiter.
2. **Cache-miss needs `iterations x services` fresh keys, each used once.** With the defaults and
   inference only that is 50 keys; the v1 catalog caps API keys per organization at 10 (Plus) and
   25 (Pro). Either spread the fresh keys over several prepared organizations, or run cache-miss as
   a separate config with `iterations: 10` (minimum 5) and only that condition. Keys must not have
   been used before the run and should be created just before it.
3. **Billing outage** cannot be produced in the shared deployment. It needs a separate deployment
   (`conditions["billing-outage"].apiBase`) whose billing store the operator has made unavailable;
   `latency-report.mjs config` refuses a billing-outage condition pointing at the shared API.
4. **Maps** cannot be measured until H-03, H-04 and H-16 are applied: today every Maps request is
   `maps_allowance_unconfigured` (503), which the harness counts as a mismatch. The template
   therefore lists `services: ["inference"]`; add `"maps"` and `maps.query` (a place inside the
   chosen coverage) after #667.
5. **Baseline meaning.** The baseline route is public and may be edge-cached, so "added over
   baseline" includes Worker routing as well as admission. Read `gatewayAuth` and
   `gatewayPreforward` as the admission figures.
6. **Credential type.** The phone uses a mobile API key (`eliza_mobile_` prefix) from the native
   sign-in; prepare each condition's key the same way, or note the difference in the report, since
   auth caching may differ by key type.
7. **All-or-nothing.** A missing environment variable throws before any result is written; a
   mismatch still writes the result and exits 1. Do not drop mismatches.
8. **Where to run.** Run from a separate eliza checkout at the pin (not `vendor/eliza`, which must
   not be modified, and the harness writes `test-results/` into the checkout it runs from).
   `node` 24 runs the `.ts` directly.

## Per-condition account setup (staging first)

| Condition | Account to prepare (H-26 accounts) | How to produce the state | Expected outcomes |
| --- | --- | --- | --- |
| normal | One organization on `plus_monthly` (active), allowance remaining, one API key in `BENCH_NORMAL_KEY` | Fresh period or enough allowance for ~53 one-token completions | `admitted` |
| cache-miss | One or more organizations on an active plan; `iterations x services` never-used keys, comma-separated in `BENCH_FRESH_KEYS` | Create the keys immediately before the run; respect the per-organization API key ceiling (finding 2) | `admitted` |
| exhausted | Organization whose plan bucket or period allowance is used up, key in `BENCH_EXHAUSTED_KEY` | Spend the period allowance before the run, or (staging only) set that plan's buckets very low; for Maps, use up the Maps window | `rate-limited` or `allowance-exhausted` |
| expired | Organization whose plan window has ended (cancelled at period end, or a bounded grant code past `endsAt`), key in `BENCH_EXPIRED_KEY` | A grant minted with `--duration-days 1` (staging mint workflow) and redeemed at least a day earlier, or a cancelled subscription past its period end | `subscription-required` or `billing-refused` |
| billing-outage | Organization with an active plan on the operator's outage deployment, key in `BENCH_OUTAGE_KEY` | Operator-side only: billing store made unavailable on a non-shared deployment | `admitted`, `cache-warming` or `unavailable` |

## Exact remaining human steps

1. **H-15 (operator):** apply the #665 H-03 value in `ELIZA_CLOUD_PLAN_RATE_LIMITS` (staging, then
   production); keep `ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER` and migrations through
   `0547_subscription_grant_calendar_terms`; keep `ELIZA_ENTITLEMENT_*`; rotate only by
   `NEXT` -> sign -> `PREVIOUS` (clear `PREVIOUS` after 30 minutes).
2. **H-11 (operator):** keep Alpha's entry in `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON` and its `apps`
   row; after any registry change run "Mobile App Auth Registration Admin" (repair, then diagnose)
   for `ai.elizaresearch.alphaphone`. `node scripts/cloud-readiness.mjs registration` prints it.
3. **H-14 (operator):** keep `CLOUD_PUBLIC_SERVICE_JSON` (passing today).
4. **Operator:** fix the staging subscription catalog 503.
5. **Benchmark (operator confirmation required):** prepare the accounts in the table; fill a copy of
   the template; `node scripts/owner/latency-report.mjs config FILE` must print "ready" and the
   request budget the operator confirms; export the key variables in the operator's shell only;
   run `node packages/cloud/scripts/plan-admission-deployed-latency.ts --config FILE --confirm-real-requests`
   from a separate eliza checkout at the pin; then
   `node scripts/owner/latency-report.mjs wrap results.json --environment staging --upstream-revision "$(jq -r .commit upstream.lock.json)" --confirmed-by "Cloud operator" --confirmed-at <ISO> --billing-outage "<how>" --out docs/evidence/plan-admission-latency-staging-<date>.json`
   and commit only a report that `check` passes. Never commit the config with filled values if it
   contains anything but variable names, and never paste keys into chat, issues or commits.
6. Re-run `node scripts/cloud-readiness.mjs probe` after any change and record it.

## Draft decision entries

- **P-NN — H-15 benchmark scope (#666):** The deployed admission benchmark runs on staging with the
  five harness conditions (billing outage on an operator-only outage deployment); a production run
  is limited to normal and cache-miss and needs a separate operator confirmation. Reports follow
  `docs/runbooks/drafts/666-latency-report.schema.json`. Policy, not evidence.
