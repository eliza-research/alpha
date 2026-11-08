# Maps implementation and provider decision

Latest implementation checkpoint: a configurable, real Monaco regional OSM provider, MapLibre map plane, local search and GraphHopper drive/walk/bicycle routes are now implemented. Local backend and headless rendered flow checks pass; configured Android build59 passed both regional instrumentation methods in both distribution variants, with actual map/route screenshots inspected. Build60 also passed controlled emulator GPS foreground guidance, off-route, arrival and watch cleanup in both variants. Permissions, service interruption, physical navigation and production hosting remain separate acceptance work. The default build remains unconfigured. See [regional validation and reproduction](maps-regional-validation.md) for exact evidence, coverage, configuration and remaining navigation/provider limits. The earlier hosted-provider evaluation below remains planning context, not the only available implementation path.

Status: researched September 30, 2026; provider-independent source integrated September 30, pending APK/emulator verification. No provider account, API key, quota, or live provider connection is confirmed. This document is a plan, not evidence that Maps works.

## Product and design contract

The authoritative interface is https://alpha-phone-prototype.pages.dev/. Keep the prototype search field, category chips, pin treatment, bottom sheets, place detail, mode choices, navigation banner, recenter button, typography, theme colors, and agent composer. Replace the invented geographic content and backing operations, not the interface with another product's maps UI.

The map plane itself must become geographically correct. Exact reproduction of the prototype's fictitious streets conflicts with this requirement; preserve its cartographic style and surrounding layout while showing actual geography. Attribution remains visible and accessible even where the prototype omitted it.

## Current source findings

- `apps/app/src/prototype/model.js`, Maps module beginning near line 2601, contains SVG streets, fixed places, sample addresses/telephone numbers, static travel times, and simulated navigation progression. These are design-reference data, not usable provider results.
- `apps/app/src/prototype/template.html`, Maps surface beginning near line 1657, separates the map plane from search, overlays, sheets, details, and navigation controls. This is the mounting seam for a real map renderer.
- `apps/app/src/prototype/native-adapter.ts` currently redirects submitted search and route start to an Android maps handler. `DailyAppsPlugin.java` builds `ACTION_VIEW geo:0,0?q=...`. This is a fallback, not completion of the in-app flows.
- Pinned `vendor/eliza/plugins/plugin-native-location` exposes Android framework `LocationManager` reads/watches without Play Services. It reports approximate versus precise permission, errors, timestamps, and accuracy. It is not yet included in AlphaPhone Gradle dependencies or MainActivity registration. The plugin manifest declares foreground fine/coarse location only.
- `plugin-native-location` has no per-request cancel method for `getCurrentPosition`; it cancels reads on plugin destruction. The staged wrapper uses a cancellable watch for a one-shot fix instead. Its watch events have no watch ID, so AlphaPhone must own one active location session at a time and remove its own listeners during replacement/exit.
- Pinned `vendor/eliza/plugins/plugin-maps` has provider-neutral search/place/route contracts, service/store interfaces, attribution handling, bounded transport, and explicit managed/local connection configuration. A concrete Google adapter supports server API-key or managed gateway credentials. Reuse those contracts/services where compatible; never import its independent page UI or modify the vendor checkout.

## Provider decision

Use MapLibre plus Geoapify as the first hosted candidate, subject to provisioning an actual account/key and validating the deployment terms. This is the lowest-cost integrated hosted option evaluated, not a claim that it is universally cheapest.

| Candidate | Current cost/conditions | Decision |
| --- | --- | --- |
| Geoapify + MapLibre | Free tier permits commercial production with attribution; 3,000 credits/day and 5 requests/second. Next published tier is $59/month for 10,000 credits/day. | Preferred initial hosted candidate: tiles, search, places and routes in one provider. |
| MapTiler + a route provider | Free plan covers noncommercial usage and commercial R&D; commercial production needs an appropriate subscription. Proxying and bulk downloads have additional restrictions. | Viable styled-map option; more integration/provider decisions. |
| Existing Google maps adapter | Requires an actual provisioned credential or gateway. Places displayed on maps must use Google Maps with required attribution. | Consider only if an existing managed connection is verified; do not combine its place results with a MapLibre basemap. |
| Self-hosted OSM stack | Photon search, Valhalla routing, Protomaps tile distribution require hosting, data preparation, updates and operations. No hosted-provider account is intrinsically required. | Long-term privacy/offline option; a regional deployment could be bounded, but it is not zero engineering or hosting cost. |

Primary sources: [Geoapify pricing](https://www.geoapify.com/pricing/), [MapTiler terms](https://www.maptiler.com/terms/cloud/), [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies?hl=en), [MapLibre documentation](https://maplibre.org/maplibre-gl-js/docs/), [Photon](https://github.com/komoot/photon), [Valhalla](https://github.com/valhalla/valhalla), [Protomaps deployment](https://docs.protomaps.com/deploy/).

MapLibre is a renderer, not a search/routing service. Its native Android distribution uses BSD-2-Clause; OSM-derived data and style assets have their own attribution/license requirements. Geoapify supports compatible vector tiles and layer customization. See [MapLibre Android licensing](https://maplibre.org/maplibre-native/android/examples/) and [Geoapify style customization](https://apidocs.geoapify.com/how-to/maps/change-map-style/).

### Account and credential findings

Only variable names were inspected: the process environment and `.env*` files at the project root, `apps/app`, project parent, and home root yielded no maps-provider names. No secret values were printed. This limited check is not an exhaustive account inventory and does not establish that no Cloud-managed connection exists. No account was created and no spending was authorized or initiated by this research.

A prospective Geoapify credential must be provisioned explicitly. Naming a new configuration field is not evidence that a key exists. The renderer should receive a connection identifier, provider identity, status and capabilities, not a server API key. Avoid installing a shared unrestricted secret in an APK. Client-visible tile keys, if chosen under provider terms, need provider-supported restrictions and quotas; origin restrictions on a Capacitor localhost origin do not uniquely authenticate our app.

## Runtime boundaries

- **AOSP/native:** foreground coarse/fine permission, actual location fixes, timestamp/accuracy, cancellation, external dial/share/navigation fallbacks. AOSP does not supply a guaranteed complete global map/search/route backend. Android's `Geocoder` may be absent and does not guarantee availability or accuracy: [Android Geocoder](https://developer.android.google.cn/reference/android/location/Geocoder).
- **AlphaPhone:** exact UI, empty/loading/error/denied/unconfigured states, query cancellation, selected-place/route state, route mode changes, saved-place persistence, map styling, explicit agent context and approvals.
- **Provider/gateway:** actual tiles, geocoding, POIs and route geometry/instructions; provider identity, capability discovery, deadlines, byte limits, quotas and normalized failures. Production URLs must be pinned and HTTPS. Do not accept arbitrary renderer-supplied fetch targets.
- **Agent:** request scoped to the active view, selected place/route and explicit origin. Do not include full contact lists, location history or a fresh device coordinate merely because Maps is open. Mutating saved places and starting navigation uses the existing explicit proposal approval mechanism.

## Detailed flows

1. **Open Maps:** mount the styled geographical plane. If no provider is configured, show the existing shell with an explicit connection-needed state and no fake places, map, ETA or routes. Saved-place management and manual-coordinate origins can still work. Do not prompt for location on page open.
2. **Search:** the existing search field owns a query generation. Submit or a provider-permitted autocomplete request returns real results. Replace only the matching generation; cancellation/back/new query makes older responses ineligible. Show no-results distinctly from provider failure, unconfigured, rate-limited and offline.
3. **Category search:** require an actual selected area or explicit location. Fetch supported categories from provider capabilities. Never silently substitute the prototype's nearby coffee/restaurant list.
4. **Place detail:** select by provider ID plus place ID. Fetch validated coordinates/address and only available phone, website, hours or other attributes. Missing fields remain absent/unknown. Dial and website actions require actual validated data. Save/unsave writes a durable local record and readback confirms success.
5. **Origin selection:** user can enter a place/coordinate or request current location. Explain the OS approximate-location result through accuracy, not invented precision. Denial, disabled location, cancellation and timeout keep manual origin usable.
6. **Route preview:** both endpoints must be actual coordinates; current location is never implied. Provider-supported mode returns geometry, distance, duration, instructions, attribution and retrieval time. Changing endpoints/mode invalidates the previous plan. A stale route is visibly stale and cannot be presented as a newly fetched result.
7. **Start/stop navigation:** start is an explicit action. Foreground position fixes drive progress, next instruction, off-route detection and arrival. A timer must never move the user's position. Stop/leave releases watches and voice playback. Background navigation requires separate Android service/notification work and remains outside the first foreground slice.
8. **Voice guidance:** speak actual maneuver text using native TTS only after start and voice enablement; mute cancels queued speech. No text-to-speech completion is treated as evidence of arrival.
9. **Share:** preview the actual place/route and recipient/action. Existing sharesheet/draft flow handles the external step. Sharing ETA uses a timestamped actual estimate, not the prototype's static travel time. No automatic message is sent.
10. **Saved places:** bounded local storage with schema validation, provider provenance, stable IDs and explicit write errors. Do not overwrite corrupt storage with an empty array. Persist coordinates deliberately saved by the user; store no implicit location history. Refetch provider details subject to retention/license constraints before describing old cached fields as current.
11. **Agent:** every detail/route/error state can open the composer without losing selection. Context revision changes on query/place/origin/mode changes. Old proposals cannot execute against a different destination.
12. **Exit/recreation:** abort pending provider operations, stop location watches and remove listeners. Restore deliberately saved places; do not resume location tracking/navigation automatically after recreation.

Geoapify supports drive, walk, bicycle, transit and separately approximated transit modes. Its documented traffic options are free-flow and approximated traffic. These must not be labeled live traffic or verified transit timetables. Coverage, usable transit schedules and freshness need live checks in the target region. [Routing API](https://apidocs.geoapify.com/docs/routing/)

## Development versus production and offline limits

| Resource | Development | Production |
| --- | --- | --- |
| Geoapify | Own configured key; hard client request budget; public test destinations; quota/error handling. No borrowed demo key. | Account, quota, attribution, credential restrictions and gateway operation verified. Free tier is permissible within limits, not an SLA guarantee. |
| OSM public tiles | Only policy-compliant interactive requests; no scripted map-scraping, bulk prefetch or offline packs. | Do not assume community infrastructure is an unlimited product backend. Use an appropriate hosted or self-hosted service. |
| Public Nominatim | Not a default generated search backend; no autocomplete. Deliberate developer adoption requires compliance with the global one-request/second application limit and other rules. | Not suitable as our generic production search service. Use a contracted provider or owned deployment. |
| Provider test fixtures | Deterministic failure/cancellation checks may use an explicitly labeled controlled fixture. | Fixtures never substitute for real-provider acceptance evidence. |
| Offline | Saved places and clearly dated route data can be shown according to permitted retention. | Downloadable basemaps need rights plus region/size/version controls; offline search/routing additionally needs indexes/graphs. |

See [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) and [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/). MapLibre's [Android offline API](https://maplibre.org/maplibre-native/android/api/-map-libre%20-native%20-android/org.maplibre.android.offline/index.html) can retain map resources, but does not grant provider download rights or implement offline geocoding/routing. Geoapify downloadable-pack/redistribution permission was not confirmed; do not infer it from general caching statements.

Geoapify says API request bodies, headers, IP addresses and timestamps are retained for operational purposes, generally no longer than 24 hours for successful requests. An app proxy may hide the handset IP from the provider, but coordinates/queries still reach it. Keep provider disclosure near location/search controls and avoid unnecessary data in requests. [Geoapify privacy policy](https://www.geoapify.com/privacy-policy/)

## Staged implementation boundary

Provider-independent groundwork now lives in `apps/app/src/maps`, with the production prototype adapter in `apps/app/src/prototype/maps-adapter.ts`. It provides explicit unconfigured search/route states, manual coordinate selection, real foreground location access, and saved-place create/rename/remove/persistence. Native registration/dependency wiring is coordinated by the root task. The prototype map plane is deliberately empty until an actual map provider/renderer exists; it does not show sample streets or pins. A configured provider, real map renderer, route tracking and approved agent Maps mutations remain separate work. `MapsInstrumentedTest` contains a real UI persistence/unconfigured test and a separately gated native injected-location/watch-cleanup test; neither has been run for this source yet.

## Acceptance gates

- Verify both Android distribution variants compile and contain the location implementation in release dex; merged manifests contain only intended foreground permissions.
- Real permission UI: approximate, precise, deny/retry; GPS disabled, no-fix timeout; navigation away during permission and pending watch setup does not start/resume a watch later.
- Real provider: public place search/detail, nonempty actual geometry and valid endpoints, supported mode changes, missing details, zero results, quota/auth/offline failures, stale response cancellation.
- Real saved place: create, duplicate handling, rename/unsave, process recreation, storage failure/corruption, no unrelated record deletion.
- Foreground route: explicitly injected emulator fixes move route progress; off-route recalculation is bounded; Stop/Back/destroy clears watches. No emulator route test establishes on-road safety or real-device GPS behavior.
- Agent: selected actual place/route context; reject stale destination approval; no coordinates in unrelated views; no implicit external send.
- CUA phone screenshots: map base, search results, empty/error, place detail, each supported route mode, navigation, permission error and both themes preserve the reference UI. Test real map pan/pinch/controls, not only bridge calls.
- Separate evidence ledger for source/typecheck, APK build, emulator integration, live provider, full AOSP boot and physical-device/user acceptance. Do not mark handoff-only Maps complete.

## Maps observation boundary (September 30 source)

The agent observation now uses a process-local random `maps_<UUID>` identity and numeric revision with `map-place` or `map-search` kind. No query, label, coordinates, saved-place/provider/account identity or coordinate-derived hash enters this context. The local registry rejects forged IDs, old revisions and Maps identities attached to another view. Closing the selection, leaving Maps, changing the Maps connection or changing the agent session revokes it. Renaming changes the revision. This is awareness of the selected screen object, not permission to read location or execute navigation. Full geographic disclosure and approved Maps mutations are not implemented.

`node scripts/test-maps-context-browser.mjs` passed against a dedicated local Vite production renderer: actual Maps selection, rename, search, leave, coordinate/label/query exclusion, and stale/forged/cross-view rejection. Start Vite on `127.0.0.1:5188` first; set `ALPHA_BROWSER_MODULES` to an installed Playwright node_modules directory. This checks rendered web flow and the actual outgoing-context serializer; it does not claim native GPS, provider HTTP or Android acceptance.

The root task's authenticated current-runtime check of `GET /api/views/maps` returned HTTP 404; sanitized evidence is `test-results/prototype-build39/maps-backend-capability.json`. Upstream plugin source alone does not establish a deployed Maps route or registered provider. Consequently there is no connected-runtime search adapter or Google Places/MapLibre composition in this release. Recheck authenticated view metadata, provider generation and actual search response before enabling an adapter.

## Optional foreground-location instrumentation

`MapsInstrumentedTest.explicitRecenterUsesInjectedNativeLocationAndStopsWatch` is explicitly gated: without both instrumentation arguments `mapsLatitude` and `mapsLongitude`, it is skipped and is not location acceptance. The test grants foreground location only to its own target package, taps Recenter, verifies the supplied coordinate and accuracy label, and checks that the native watch collection is empty after the one-shot fix and does not resume on re-entry.

With exclusive ownership of the selected emulator, install matching target/test APKs, enable the emulator's location service, and inject `adb -s <serial> emu geo fix <longitude> <latitude>` repeatedly while the test waits for its fresh fix. Then run the normal AndroidJUnitRunner with `-e class ai.elizaresearch.alphaphone.MapsInstrumentedTest#explicitRecenterUsesInjectedNativeLocationAndStopsWatch -e mapsLatitude <latitude> -e mapsLongitude <longitude>`. Use the installed variant's actual instrumentation component from `adb -s <serial> shell pm list instrumentation`; do not guess or target a second emulator. Stop only the owned injection process afterward. Run both standalone and launcher variants separately. Approximate/denied permission, GPS-off, no-fix timeout and physical-device location remain separate acceptance cases.

## October 27 shared Maps ownership and provider seam (#412)

Maps behaviour now lives upstream in plugin-maps; Alpha supplies platform ports and its template.

- `plugins/plugin-maps/src/client/maps-screen.ts` (`MapsScreenController`) owns the phone Maps screen: search and coordinate pins, place detail, saved places and renaming, directions with an explicit origin, provider-limited modes, foreground guidance from fresh precise fixes, explicit reroute, arrival, screen-off sessions, voice, sharing, the Calendar hand-off and Back, the maps-app hand-off without a provider, and the agent's `MapsNavigationSurface`. `apps/app/src/prototype/maps-adapter.ts` only binds that controller's view to Alpha's template and supplies native location, local speech, the screen-off service, share sheet, Calendar return and the launcher check for agent requests. Accessible names and test selectors are unchanged; the template gains only the location disclosure line.
- Upstream also renders the same controller as a React view (`@elizaos/plugin-maps/screen`, `MapsScreen`, created with `createMapsScreen`), themed through `--maps-*` custom properties and host icon paths, with the same accessible names. Alpha keeps its template binding until the shared mobile shell mounts upstream views with Alpha's theme; then the template's Maps markup and this adapter's bindings can be deleted, leaving Alpha's theme tokens and platform ports.
- The device Cloud Maps provider, session binding, `DeviceMapsNavigation` agent binding, agent-navigation offer, screen-off session, guidance and fix freshness rules are upstream client modules; `apps/app/src/maps/*` re-export them. Alpha keeps its storage namespace (`alpha.maps.saved-places.v1`), bridge names and Cloud session composition.
- Eliza Cloud chooses its provider from settings (`ELIZA_MAPS_PROVIDER`, `ELIZA_MAPS_GEOCODER`, `ELIZA_MAPS_ROUTER`, with Nominatim, GraphHopper and Valhalla backends). Capabilities report sources and a location disclosure (who receives search text and coordinates; Cloud records only operation and result code). The agent's Cloud adapter binds attribution and modes from capabilities, so an operator's provider choice does not require a plugin release. Agents can reverse geocode through `MAPS` place with coordinates, and `MAPS_COVERAGE` states what Cloud reports it serves (regions and dataset revision, travel modes and alternatives, no live traffic, transit schedules or offline use, and who receives search text and coordinates), which answers Maps' "Explain Maps coverage" suggestion.
- A self-hostable reference provider (Nominatim, GraphHopper 10.2, Caddy with TLS, an access key and no request logs) is in upstream `packages/cloud/infra/cloud/maps`.

Still for people (A-23): choose and license the production provider and region coverage, host and operate it (DNS, TLS, capacity, updates), review the GraphHopper jar digest, set the Cloud settings and Maps allowance per environment, then qualify live routes, Calendar-to-Maps and physical navigation as separate evidence. The checks for this change are source-level: the plugin-maps controller, view and Cloud adapter suites, the Cloud Maps route, registry and admission suites, Alpha's Maps contract scripts and Maps browser specs on a development server with fixture providers. They are not APK, emulator, deployment, device or road acceptance.
