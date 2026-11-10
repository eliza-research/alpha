# Google Maps through Eliza Cloud and Pixel acceptance

Updated November 10, 2026 for AP-10 / P-64 and issue #667. Production Maps uses
Google Maps Platform through Eliza Cloud. Alpha renders Cloud-proxied roadmap
tiles with MapLibre and keeps GPS and navigation on the phone. The phone signs
in to Eliza Cloud and needs an active or trialing Plus or Pro subscription.
Google's server key belongs to Cloud. Maps does not require the phone's optional
Gmail/Calendar Google connection.

These instructions were checked against Eliza source
`268733c01f239b352396abefb1b9a112a3cb65a6`. They describe operator setup and
acceptance work. Source checks and synthetic browser tests do not establish a
live deployment or Pixel acceptance. The earlier self-hosted OSM/Nominatim/
GraphHopper setup is superseded for production.

1. **Prepare the Google Cloud project.**

   In the Google Cloud Console, select the Maps project, attach billing, and enable
   **Places API (New)**, **Geocoding API**, **Routes API**, and **Map Tiles API**.
   Create a server API key and restrict it to these four APIs. Cloudflare Workers
   do not provide one fixed egress address for a normal IP application restriction.
   This integration uses server REST calls, so Android package/SHA-1 and browser
   referrer restrictions do not authenticate those calls. Set Google project API
   quotas and billing alerts for the pilot, and keep the key in Cloud's secret
   store. Use separate staging and production keys. [Google setup](https://developers.google.com/maps/documentation/tile/get-api-key)
   [Key restrictions](https://developers.google.com/maps/api-security-best-practices)

2. **Configure the API Worker for each environment.**

   Set the following in the Cloudflare Worker settings, or the operator's existing
   protected deployment binding process. Preserve these settings across subsequent
   Cloud releases and verify the deployed binding names after each release. A
   source-only change to Alpha does not install Cloud bindings.

   | Environment | API origin used by Alpha | API Worker |
   | --- | --- | --- |
   | Staging | `https://api-staging.eliza.app` | `eliza-cloud-api-staging` |
   | Production / default Pixel APK | `https://api.eliza.app` | `eliza-cloud-api-prod` |

   | Binding | Value for the Google pilot |
   | --- | --- |
   | `GOOGLE_MAPS_API_KEY` | Secret containing that environment's restricted server key |
   | `ELIZA_MAPS_PROVIDER` | `google` |
   | `ELIZA_MAPS_TILES` | `true` |
   | `ELIZA_MAPS_LANGUAGE` | `en-US` for this pilot |
   | `ELIZA_MAPS_REGION` | `US` for this pilot |
   | `ELIZA_MAPS_TRAFFIC` | `live` to retain traffic-aware driving, or `none` if the operator deliberately disables it |
   | `ELIZA_MAPS_TRANSIT` | `true` to retain scheduled transit |
   | `ELIZA_MAPS_ROUTE_ALTERNATIVES` | `true` |

   Leave `ELIZA_MAPS_PROVIDER_ID`, `ELIZA_MAPS_ATTRIBUTION`,
   `ELIZA_MAPS_DATASET_REVISION` and `ELIZA_MAPS_COVERAGE_JSON` unset to use
   `eliza-cloud-google`, `Google Maps`, `google-maps-platform-live` and the
   provider's world bounds `[-180,-85.0511,180,85.0511]`. Region metadata follows
   Google service availability and does not guarantee a route for every request.
   Google results must retain the matching Google basemap and attribution.
   The OSM geocoder/router URLs, extract revisions and GraphHopper secrets are
   unused by this provider. [Pinned provider configuration](https://github.com/elizaOS/eliza/blob/268733c01f239b352396abefb1b9a112a3cb65a6/packages/cloud/shared/src/lib/services/maps/provider-registry.ts)

3. **Configure the Maps allowance on the Worker that owns admission.**

   The settings belong on different Workers in staging and production.

   | Environment | Worker that owns `InferenceAdmissionGate` | Required API binding |
   | --- | --- | --- |
   | Staging | `eliza-cloud-admission-staging` | `INFERENCE_ADMISSION_GATES`, class `InferenceAdmissionGate`, script `eliza-cloud-admission-staging` |
   | Production | `eliza-cloud-api-prod` | `INFERENCE_ADMISSION_GATES`, local class `InferenceAdmissionGate` |

   Set `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` to this JSON string on the admission
   owner. These are the recorded Plus 1,000 / Pro 5,000 daily request values.

   ```json
   {"selected":true,"plans":{"plus_monthly":{"requests":1000,"windowSeconds":86400},"pro_monthly":{"requests":5000,"windowSeconds":86400}}}
   ```

   Set `ELIZA_CLOUD_MAPS_PLAN_RATE_LIMITS` to this JSON string on the same owner.
   It matches the committed staging Maps policy at the checked revision.

   ```json
   {"selected":true,"plans":{"default":{"burst":{"capacity":10,"refillPerSecond":1},"sustained":{"capacity":60,"refillPerSecond":1}},"plus_monthly":{"burst":{"capacity":20,"refillPerSecond":2},"sustained":{"capacity":120,"refillPerSecond":2}},"pro_monthly":{"burst":{"capacity":50,"refillPerSecond":5},"sustained":{"capacity":300,"refillPerSecond":5}}}}
   ```

   Staging already commits both values in
   `packages/cloud/admission-worker/wrangler.toml`. Keep them on the admission
   Worker. The staging contract deliberately rejects copies on the API Worker,
   because those copies do not control its external gate. Production's local gate
   reads the values on `eliza-cloud-api-prod`.

   The dedicated Maps rate setting takes precedence over the older
   `ELIZA_CLOUD_PLAN_RATE_LIMITS` fallback. Keep the chosen inference policy as-is.
   Do not use `placeholder` or `selected:false`. The current Maps admission code
   accepts subscription IDs `plus_monthly` and `pro_monthly`; inference rate-tier
   overrides do not replace the subscribed plan. Confirm the pilot account's
   organization has an active or trialing one of these plans. [Admission code](https://github.com/elizaOS/eliza/blob/268733c01f239b352396abefb1b9a112a3cb65a6/packages/cloud/api/src/lib/maps-request-admission.ts)
   [Staging ownership contract](https://github.com/elizaOS/eliza/blob/268733c01f239b352396abefb1b9a112a3cb65a6/packages/cloud/admission-worker/verify-staging-contract.ts)

   This revision enforces credential revocation through the bound organization
   gate. `INFERENCE_STRONG_REVOCATION_ENABLED` is no longer the activation switch.
   Preserve the existing Durable Object namespace, API-to-admission binding, and
   staging `INFERENCE_RECOVERY_SERVICE` binding to `eliza-cloud-api-staging`.
   Deploy through the Cloud team's accepted release process. Do not recreate,
   transfer, rename or clear the admission namespace for this Maps rollout.

   Every admitted search, details, geocode, reverse-geocode, route or tile call
   costs one Maps request. An initial screen commonly requests 12–20 tiles, with
   more on pan/zoom. Capabilities and viewport copyright reads are entitled
   metadata and consume no allowance. Daily windows reset at 00:00 UTC. These
   request units are separate from inference funds. Provider errors, cancellation
   after admission and lost acknowledgements remain consumed. [Maps service contract](https://github.com/elizaOS/eliza/blob/268733c01f239b352396abefb1b9a112a3cb65a6/packages/cloud/api/README.md#maps)

4. **Deploy the reviewed Cloud cache fix before the Google pilot.**

   Deploy the API from the reviewed commit `268733c01f239b352396abefb1b9a112a3cb65a6`
   or a release that includes its changes. Google tile fetches use the `no-store`
   fetch cache mode; both authenticated tile response formats carry
   `Cache-Control: no-store`. Incomplete viewport copyright
   is refused. The phone also uses the reviewed renderer that withholds imagery outside
   its attributed area and keeps small navigation movements inside an already
   attributed margin. Read back both tile response formats after deployment.
   Alpha source pinning alone does not deploy the Cloud API.
   [Upstream Google rollout change](https://github.com/elizaOS/eliza/pull/39231)
   [Worker fetch cache mode](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
   Google's upstream policy and every third-party data credit remain applicable. [Tile caching rules](https://developers.google.com/maps/documentation/tile/policies#pre-fetching_caching_or_storage_of_content)

   The Cloud operator should record the deployed API commit/version and admission
   Worker version separately. The Google API secret stays on the API Worker;
   the external staging gate needs only its admission settings and existing
   recovery binding.

5. **Verify the real integration with a signed-in plan account.**

   Use the existing private operator harness, or `npm run dev:cloud` with
   `ALPHA_CLOUD_ENVIRONMENT=staging`, for staging service checks. Keep credentials
   in that harness's private store. Record HTTP status, bounded error code,
   provider identity, source/deployment version and pass/fail, without recording
   credentials, account identifiers, search text or coordinates in public evidence.

   | Request | Expected result |
   | --- | --- |
   | `GET /api/v1/maps/capabilities` | HTTP 200, `providerId: "eliza-cloud-google"`, `sources.data: "Google Maps"`, `capabilities.map: true`, and `tiles.urlTemplate: "/api/v1/maps/tiles/{z}/{x}/{y}"` |
   | `POST /api/v1/maps/places/search` with `{"query":"Ferry Building, San Francisco","limit":3}` | HTTP 200 with actual `places`, provider identity and attribution |
   | `POST /api/v1/maps/places/details` with `{"id":"<id from that search>"}` | HTTP 200 with the matching place and current available details |
   | `POST /api/v1/maps/routes` with `{"from":{"latitude":37.7749,"longitude":-122.4194},"to":{"latitude":37.7955,"longitude":-122.3937},"mode":"walk"}` | HTTP 200 with actual geometry, distance, duration, steps and attribution, or an honest typed `no_route` |
   | `GET /api/v1/maps/tiles/12/655/1583` with `Accept: image/png` | HTTP 200 with decodable image bytes and `Cache-Control: no-store` |
   | The same tile with `Accept: application/json` and a new request ID | HTTP 200, `encoding: "base64"`, supported `contentType`, valid image data, and `Cache-Control: no-store` |
   | `POST /api/v1/maps/tiles/viewport` with `{"zoom":12,"north":37.84,"south":37.70,"east":-122.35,"west":-122.52}` | HTTP 200 with the viewport's complete `copyright` string |

   Send a fresh `Idempotency-Key` for every non-metadata request, including each
   tile and the two tile-format checks above. Capabilities and viewport do not
   need one. Do not replay an admitted ID after timeout or lost acknowledgement.
   These checks use real provider requests and consume the selected allowance.
   The default flag-off Android build uses the production deployment registration;
   a browser staging result does not establish a Pixel result.

   | Refusal | Operator action |
   | --- | --- |
   | HTTP 401 / `authentication_required` | Restore the environment's Eliza Cloud sign-in. An unauthenticated probe cannot verify Maps availability. |
   | HTTP 403 / `subscription_required` | Check the account's organization and active/trialing Plus or Pro plan. |
   | HTTP 503 / `maps_not_configured` | Check API Worker provider selection, server key, enabled Google APIs and tiles flag. |
   | HTTP 503 / `maps_allowance_unconfigured` | Check both selected JSON strings on the actual admission owner, supported plan ID and gate binding. |
   | HTTP 429 / `rate_limited` | Honor `Retry-After`; compare the dedicated Maps bucket setting and any per-credential limit. |
   | HTTP 429 / `allowance_exhausted` | Honor the supplied reset time; check how much tile browsing consumed. |
   | HTTP 503 / `maps_admission_unknown` | Inspect admission transport/version health; create no automatic replay of the admitted ID. |
   | HTTP 502 / `provider_invalid_response`, HTTP 503 / `provider_unavailable` | Check Google billing/API permissions/quotas and API Worker egress. Retain the failure result. |

6. **Run the Pixel check on the reviewed APK.**

   Complete `npm run verify` and `npm run android:build:local` with admitted native
   inputs and inspect standalone and launcher outputs with
   `npm run android:verify`. For the explicit Cloud speech QA profile, follow
   the separate build chain in the repository README. Record the profile and
   exact signed APK digest used on the Pixel. A developer APK built with
   `--allow-unpackaged-runtime` is non-distributable.

   Install the intended variant through the existing owner-controlled update
   process. Both variants use `ai.alphacompute.alphaphone` and replace each other;
   the previous `ai.elizaresearch.alphaphone` identity is a separate app. Confirm
   the current package, signing and sign-in callback registration before testing.
   Sign in through Alpha with the provisioned production plan account, open Maps,
   and verify actual Google imagery, search, place details and a route. Grant
   location only when requested. Start and stop navigation on a safe walking route.

   Verify visible Google branding, full copyright where it fits, and the readable
   in-map **Data sources** control on small or enlarged-text layouts. Pan, zoom,
   rotate, change text size, use TalkBack, and reopen the map. Verify the credit
   stays reachable above sheets and navigation controls. Confirm failures show an
   honest unavailable state. A Google result must never appear over the
   OpenFreeMap fallback.

   Alpha uses the unmodified `GoogleMaps_Logo_DarkGray.svg` from Google's
   attribution asset archive in `apps/app/src/maps/google-maps-attribution.svg`.
   It remains visible while the complete viewport copyright is displayed beside
   it or in **Data sources**. [Official attribution assets](https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip)
   [Attribution placement and size](https://developers.google.com/maps/documentation/tile/policies#display_google_maps_attribution)

   Check the content gates through the ordinary Maps controls. Google-derived
   place results cannot enter the permanent local coordinate store or the app's
   Share flow. Google-derived routes cannot enter route sharing or either local
   or Cloud navigation TTS. The corresponding controls are unavailable for that
   provider content. User-entered pins and manually saved places retain Save,
   rename and Share, even when Google supplies the basemap. Verify those manual
   paths separately and confirm that viewing Google results does not write them
   into the saved-place namespace. [Google content and attribution requirements](https://developers.google.com/maps/documentation/places/web-service/policies)

   Existing Google-derived saved rows remain readable and removable, with rename,
   sharing and directions unavailable. Other provider-backed saved rows remain
   mapless with those actions unavailable when their source cannot be verified
   against the current provider. Restricted saved rows also
   stay out of route-origin choices. Check this after a provider outage or
   provider change, including a deployment with a custom Google provider ID.

   Record the APK digest, Cloud API and admission versions, runtime profile,
   device/Android build, connectivity, checked journeys and pass/fail. Keep APK
   build, emulator HOME-role behavior, full AOSP boot, real Cloud integration,
   Pixel acceptance and owner approval as separate evidence entries. Record
   rollout completion only after the operator's real integration checks and the
   owner's Pixel results are recorded.

The Maps-screen safeguards cover its saved-place writes, shares and navigation
speech. Approved selected-Maps reads into the general assistant remain available.
That separate assistant path needs provider-aware speech and retention qualification
under the operator's Google agreement before Google-derived spoken answers or
persistent assistant memories are accepted for the pilot. The visual Maps checks
above do not qualify that path.

## Controlled browser evidence

The production browser regression uses intercepted native HTTP responses, a synthetic
place and a generated white PNG. It exercises the production renderer, Google branding,
complete Data sources disclosure in results and active guidance, portrait and landscape
hit targets, 150% and 200%
attribution text, missing/invalid imagery, and failed copyright retrieval. The
[recorded walkthrough](../evidence/google-maps-rollout.mp4) shows that controlled
browser path at one-third speed for readability. It establishes no live Google service result or installed Pixel behavior.
