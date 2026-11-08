# #667 Production Maps provider, coverage and per-environment Cloud Maps (H-05, H-16, H-35 ODbL)

Owner prep, 2026-10-28. Reference config read at the pin `1f2a922f` (`packages/cloud/infra/cloud/maps`,
`packages/cloud/api/README.md` Maps section, `packages/cloud/api/wrangler.toml`). No region,
operator or provider is chosen, nothing was downloaded or deployed, and the browser check below is
test-mocks renderer evidence only: not a deployed service, real coverage or a device.

## What was prepared

| File | Purpose |
| --- | --- |
| [`scripts/owner/maps-coverage.mjs`](../../scripts/owner/maps-coverage.mjs) | `coverage FILE` validates `ELIZA_MAPS_COVERAGE_JSON` with the pinned parser's rules (plus extract bounds and sample points); `checklist` prints the H-16 settings per environment and, given a JSON list of set names, which are missing (names only, never values) |
| [`drafts/667-maps-coverage.example.json`](drafts/667-maps-coverage.example.json) | The upstream Monaco example in the exact shape |
| [`test/owner-maps-coverage.test.mjs`](../../test/owner-maps-coverage.test.mjs) | Parser-rule tests and the names-only checklist |
| [`test/browser/owner-maps-attribution-refusals.spec.ts`](../../test/browser/owner-maps-attribution-refusals.spec.ts) | Test-only renderer check: OpenStreetMap copyright credit visible beside Cloud results, and each typed Cloud refusal shown as its own message with no invented result |

## `ELIZA_MAPS_COVERAGE_JSON` shape (pinned `osm-provider.ts parseCoverageRegions`)

`[{"id": "<^[a-z0-9][a-z0-9_-]{0,63}$, unique>", "name": "<1-100 chars>", "bounds": [west, south, east, north]}]`,
1 to 64 regions, `west < east` and `south < north` (a region across the antimeridian must be split),
bounds inside the served extract. Any invalid value makes every Maps route answer
`503 maps_not_configured` (the value is never logged). Coverage metadata does not consume allowance.

## Decisions for the owner (H-05)

### 1. Regions served

| Option | Data and size (reference stack) | What it changes |
| --- | --- | --- |
| A. Monaco only (the development region) | Geofabrik Monaco extract; fits the default `-Xmx2g` | Proves the path end to end; useless to most pilot users. Alpha says "outside coverage" everywhere else. |
| **B. The pilot cohort's home areas** (recommended once H-07 names the cohort) | One Geofabrik country or US-state extract per area, up to 64 bounding boxes | Coverage matches where pilot users are; a few GB to tens of GB of RAM/disk per region (Nominatim import and GraphHopper graph scale with the extract). |
| C. Continent (for example North America or Europe) | Tens of GB of PBF; Nominatim needs a large-memory host and hundreds of GB of SSD; GraphHopper needs a much larger heap | Broad coverage for a later launch; hours-to-days imports; materially higher hosting cost. |
| D. Planet | The largest option: very large memory and disk, multi-day import | Not proportionate for a pilot. |

Bounding boxes over-claim at their edges when an extract boundary is irregular; choose boxes inside
the extract (`maps-coverage.mjs coverage FILE --extract-bounds W,S,E,N` refuses one that is not).

### 2. Who operates the geocoder and router

| Option | Cost shape | What it changes |
| --- | --- | --- |
| **A. Self-hosted reference stack** (`infra/cloud/maps`: Nominatim 4.4 image, GraphHopper 10.2, Caddy) on operator hosts (documented default at the pin) | Fixed host cost sized by the region (option 1); near-zero per request; operator time for imports, updates, TLS, monitoring | No code change. Request logging is off in Caddy and GraphHopper; the operator must confirm Nominatim's web-server log writes no query (README "Privacy"). Operator records the GraphHopper jar SHA-256. |
| B. Hosted service exposing a Nominatim-compatible geocoder and a GraphHopper-compatible router | Per-request or tiered subscription; must be checked against the vendor's current price list and terms (caching, redistribution, attribution, retention) | Settings only if the vendor's API is compatible with the pinned adapters (verify `nominatim` and `graphhopper` backends against the vendor before choosing); otherwise a new provider kind upstream. Location data reaches that vendor; `ELIZA_MAPS_OPERATOR` and the disclosure must name it. |
| C. Commercial provider with its own data (not OpenStreetMap) | Vendor pricing | Needs a new upstream provider kind with its own attribution; outside the current pin. Its results must not be mixed with another provider's map (README). |

Public OpenStreetMap Foundation Nominatim and tile servers are not an option for production
(their usage policies forbid it; see `docs/maps-implementation-plan.md`).

### 3. Dataset refresh cadence

Search (Nominatim) and routing (GraphHopper) must describe the same data, and
`ELIZA_MAPS_DATASET_REVISION` names one revision; clients treat a new revision as a new dataset.

| Option | What it changes |
| --- | --- |
| **A. Monthly rebuild of both from one dated extract** (recommended for the pilot) | Re-import Nominatim and rebuild the GraphHopper graph from the same Geofabrik extract, then change the revision (for example `geofabrik-<region>-2026-11-01`). Leave `MAPS_REPLICATION_URL` empty so search does not drift from routing. |
| B. Weekly rebuild | Fresher data, four times the rebuild work and downtime planning (run a second stack and switch). |
| C. Nominatim minutely or daily replication plus periodic GraphHopper rebuilds | Freshest search; search and routing then disagree between rebuilds, and the revision no longer describes the search data. Not recommended. |

### 4. Monitoring (operator)

A staging account with an active plan polls `GET /api/v1/maps/capabilities` (regions, revision)
and one search and one route inside a region; alert on `maps_not_configured`,
`provider_unavailable` and `provider_invalid_response`; watch Durable Object storage for the Maps
replay records (one small record per admitted request, never expired upstream; full or unavailable
storage refuses admission); TLS expiry of both hosts; disk and memory of the Nominatim database and
the graph cache; and a periodic check that no backend or proxy logs query text or coordinates.

## H-16 per-environment checklist

`node scripts/owner/maps-coverage.mjs checklist --environment staging|production [--names names.json]`
prints this list; `--names` takes the set names only (for example from `wrangler secret list`).

| Setting | Required | Value comes from |
| --- | --- | --- |
| `ELIZA_MAPS_GEOCODER_URL` | yes | `https://<MAPS_SEARCH_HOST>/` |
| `ELIZA_MAPS_GEOCODER_API_KEY` (secret) | reference stack: yes | its `MAPS_ACCESS_KEY` |
| `ELIZA_MAPS_ROUTER_URL` | yes | `https://<MAPS_ROUTE_HOST>/`, profiles `car`, `foot`, `bike` |
| `ELIZA_MAPS_ROUTER_API_KEY` (secret) | reference stack: yes | its `MAPS_ACCESS_KEY` |
| `ELIZA_MAPS_ROUTER_PROFILES` | no | default `{"drive":"car","walk":"foot","bicycle":"bike"}` |
| `ELIZA_MAPS_ROUTE_ALTERNATIVES` | no | `false` if the router cannot compute alternatives |
| `ELIZA_MAPS_COVERAGE_JSON` | yes | H-05 option 1, validated by `maps-coverage.mjs coverage` |
| `ELIZA_MAPS_DATASET_REVISION` | yes | the extract date, changed on every refresh |
| `ELIZA_MAPS_OPERATOR` | recommended | H-05 option 2; shown in the location disclosure |
| `ELIZA_MAPS_ATTRIBUTION` / `ELIZA_MAPS_PROVIDER_ID` | no | only to override the composed credit / identity |
| `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` | yes | #665 H-04 |
| `ELIZA_CLOUD_PLAN_RATE_LIMITS` (`selected: true`) | yes | #665 H-03; Maps refuses with `maps_allowance_unconfigured` without it |
| `INFERENCE_STRONG_REVOCATION_ENABLED="true"` and the organization Durable Object binding | yes | Staging has it `"true"` at the pin. Production has `"false"` behind the staged canary in the pinned `wrangler.toml`: 7-day staging soak with the revocation probes, writer audit, 5% canary, ramp, then 24 h at 100% before the line changes. |

Order: deploy the Cloud capabilities route before clients; staging before production.

## GraphHopper jar digest (step 2 of the issue)

The image build refuses a jar whose SHA-256 differs from `GRAPHHOPPER_SHA256`. The operator (not an
agent) downloads `graphhopper-web-10.2.jar` from
`https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/10.2/`, compares it with the
checksum files Maven Central publishes beside it and with the GraphHopper release, reviews it,
records `sha256sum graphhopper-web-10.2.jar` in the H-05 decision entry, and sets
`GRAPHHOPPER_SHA256` in the stack's `.env`.

## ODbL attribution checklist (for H-35)

Owner or counsel confirms each; this is a checklist, not legal advice.

1. Produced works (map display, search results, routes) show OpenStreetMap attribution with a link to
   `https://www.openstreetmap.org/copyright`. Alpha: the Maps screen's credit links there in both
   basemap modes (global basemap: "OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap"; regional:
   the region's attribution). Counsel to confirm the wording "Data from OpenStreetMap" meets the
   OSMF attribution guidelines (the guidelines' examples are "© OpenStreetMap contributors").
2. Cloud's own composed attribution (default "© OpenStreetMap contributors (ODbL). Search: Nominatim.
   Routing: GraphHopper." style, or `ELIZA_MAPS_ATTRIBUTION`) is returned in capabilities and on every
   result. Alpha carries it into agent reads of a selected place or route and into shared route text
   (`routeShare` appends `route.attribution`); see the browser-check result below for whether the
   Cloud string itself is visible on screen.
3. Place shares link to `openstreetmap.org` with coordinates only.
4. Share-alike: applies if the operator publicly uses a derivative database (modified or combined OSM
   data). Running unmodified extracts as a service and showing results are produced works
   (attribution only). Any operator-side corrections or merged datasets need a share-alike offer.
5. Saved places store user-chosen coordinates and labels locally; no bulk OSM extract is stored on
   the phone.
6. Software licences: Nominatim GPL-2.0 and GraphHopper Apache-2.0 run unmodified as network
   services; Caddy Apache-2.0; OpenMapTiles schema attribution kept for the basemap.
7. `apps/app/public/licenses/THIRD_PARTY_NOTICES.txt` mentions OpenStreetMap/ODbL (13 lines today);
   the dependency audit classifies ODbL as `share-alike-data`.
8. The dataset revision shown to users is a freshness statement, not live conditions.

## Browser check result (test-mocks renderer)

`ALPHA_BROWSER_TEST_PORT=5641 npx playwright test --project=chromium test/browser/owner-maps-attribution-refusals.spec.ts`
on origin/main `f4ebce3b` (2026-10-28): **8 passed**. Earlier runs on a heavily loaded host
(load average ~40) timed out in `page.goto` before the page loaded; those were host timeouts, not
assertion failures, and the clean run passed every case.

- The Maps credit links to `https://www.openstreetmap.org/copyright` and names OpenStreetMap while a
  Cloud result list is shown.
- `maps_allowance_unconfigured`, `maps_not_configured`, `subscription_required`, `unsupported_region`,
  `rate_limited` (with "Try again in about 42 seconds"), `allowance_exhausted` and
  `provider_unavailable` each render the message from the real `cloudMapsFailure` mapping in the
  Maps status region, and no result row is invented.
- Not checked by this spec: whether the Cloud-composed attribution string itself appears on screen
  (it travels with results into agent reads and shared route text). Evidence class: test-mocks
  browser renderer only, with a synthetic provider; not a deployed service, real coverage or a device.

## Exact remaining human steps

1. Owner with the Cloud operator: choose H-05 regions, operator, refresh cadence and monitoring;
   record the P- entry (draft below) including the GraphHopper jar SHA-256.
2. Operator: provision hosts, DNS, TLS and the stack (or the hosted vendor); confirm Nominatim does
   not log queries.
3. Operator, after #665 H-03/H-04: per environment set the H-16 settings; run
   `maps-coverage.mjs checklist --names` against each environment's names.
4. Operator: complete the production strong-revocation canary before production Maps.
5. Owner or counsel: the ODbL checklist above as part of H-35.
6. Evidence (separately recorded): with a signed-in plan, `GET /api/v1/maps/capabilities` lists the
   chosen regions and revision (real integration); a search and a route inside a region succeed on a
   signed-in phone (device evidence, H-32). The readiness probe cannot check this.

## Draft decision entries

- **P-NN — H-05 (#667, P-28):** Eliza Cloud Maps serves `<regions>` (`ELIZA_MAPS_COVERAGE_JSON`
  `<value>`), operated by `<operator>` on `<self-hosted reference stack | vendor>`, from
  `<extract source>`, rebuilt `<monthly>` with `ELIZA_MAPS_DATASET_REVISION` changed on each
  rebuild; GraphHopper `graphhopper-web-10.2.jar` SHA-256 `<digest>` reviewed by `<role>`;
  monitoring as in `docs/runbooks/667-maps-provider-coverage.md`. Policy, not evidence.
- **P-NN — H-35 ODbL (#667):** OpenStreetMap ODbL duties owned by `<operator>`: attribution as in the
  checklist, no public derivative database without a share-alike offer. Reviewed by `<owner or counsel>`.
