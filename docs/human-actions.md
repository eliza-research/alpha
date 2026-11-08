# Human actions for the Alpha MVP

This is the single ordered checklist of what only a person can do for the MVP in
[the PRD](prd.md) (AP-01 to AP-15) and the umbrella issues #381, #377, #410, #412, #400 and
#399: the selections approved policy leaves to the owner, keys, accounts and console settings,
hardware, and acceptance runs. Each step names its seam, the file, setting, script or runbook
where the software already waits for it, and how to verify it. No step here is closed by
writing more code in this repository.

`npm run human:status` (`scripts/human-actions.mjs`) reads this page, the repository records and
this checkout's `artifacts/apk-manifest.json`, and prints each step as `done`, `open`,
`not needed` or `external` (recorded outside this repository: use its Verify line). It reads
files only.

Rules for every step:

- Never paste a secret into chat, an issue, a pull request, a commit or a test report: private
  keys, passphrases, keystore and token PINs, client secrets, API keys, grant codes, recovery
  codes or account passwords. Evidence records scope and outcome, never credentials.
- Policy approval is not evidence ([decisions](decisions.md)), and the evidence classes stay
  separate: an APK build, an emulator HOME-role test, a full AOSP image boot, real integrations,
  and device or user acceptance. None proves another.
- Shaw is the accountable release, support and rollback owner, and Alpha Compute holds signing
  and update authority (P-16). "Cloud operator" below means a person with administrative access
  to the Eliza Cloud deployment (its GitHub environments, Workers configuration and Steward tenant
  administration).
- Alpha's own Cloud values are printed by `node scripts/cloud-readiness.mjs registration`, and
  `node scripts/cloud-readiness.mjs probe` checks a deployment with the same unauthenticated
  requests the phone makes. Cloud answers every protected `/api/` path that carries no
  credential with 401 before routing, so the Maps and Google connector routes cannot be checked
  that way: the probe lists them as needing an account. The probe of October 27 (Pacific time)
  is recorded in [cloud-readiness-2026-10-27.json](evidence/cloud-readiness-2026-10-27.json).

## Order at a glance

| Step | Action | Who | State on 2026-10-27 |
| --- | --- | --- | --- |
| [H-01](#h-01-choose-release-key-custody) | Choose release key custody | Owner | Open |
| [H-02](#h-02-confirm-or-replace-the-subscription-catalog) | Confirm or replace the subscription catalog | Owner | Open: server values only |
| [H-03](#h-03-select-the-plan-request-limits) | Select the plan request limits | Owner | Open |
| [H-04](#h-04-select-the-maps-request-allowance) | Select the Maps request allowance | Owner | Open |
| [H-05](#h-05-choose-maps-coverage-and-its-operator) | Choose Maps coverage and its operator | Owner | Open |
| [H-06](#h-06-decide-whether-the-resident-runtime-may-ship-metamasksdk) | Decide on `@metamask/sdk` in the resident runtime | Owner | Moot after repin (confirm with a staged runtime) |
| [H-07](#h-07-name-the-pilot-roles-and-cohort) | Name the pilot roles and cohort | Owner | Open |
| [H-08](#h-08-run-the-release-key-ceremony) | Run the release key ceremony | Custodian and witness | Open |
| [H-09](#h-09-enroll-the-public-release-identities) | Enroll the public release identities | Release owner | Open: every digest unset |
| [H-10](#h-10-build-and-sign-the-distributable-release-apks) | Build and sign the distributable release APKs | Release owner | Open |
| [H-11](#h-11-keep-alphas-app-auth-registration-active) | Keep Alpha's App Auth registration active | Cloud operator | Observed active (both environments) |
| [H-12](#h-12-steward-sign-in-and-the-native-google-client) | Steward sign-in and the native Google client | Cloud operator | Production gates pass; staging lacks native Google; release SHA-1 after H-09 |
| [H-13](#h-13-app-links-association-on-the-cloud-web-host) | App Links association on the Cloud web host | Cloud operator | No enrolled release certificate listed |
| [H-14](#h-14-keep-the-service-terms-and-privacy-text-approved) | Keep the service Terms and Privacy text approved | Service operator | Observed published |
| [H-15](#h-15-subscription-operations) | Subscription operations | Cloud operator | Signing keys published; limits unset |
| [H-16](#h-16-provision-the-maps-service) | Provision the Maps service | Cloud operator | Not checkable without an account; production strong revocation is off at the pin |
| [H-17](#h-17-google-connector-for-gmail-and-calendar) | Google connector for Gmail and Calendar | Cloud operator | Owner account worked in development; production verification open |
| [H-18](#h-18-admit-the-on-device-voice-host) | Admit the on-device voice host | Named reviewer | Open: `qualified: false` |
| [H-19](#h-19-embedding-host-libraries-only-when-reported) | Embedding host libraries, only when reported | Reviewer | Script-supplied at this pin |
| [H-20](#h-20-qualify-the-always-on-listener) | Qualify the always-on listener | Reviewer and device operator | Open: G1 to G6 |
| [H-21](#h-21-stage-and-build-the-production-image) | Stage and build the production image | Image host operator | Open (source admitted) |
| [H-22](#h-22-sign-the-image-and-ota-and-retain-a-known-good-release) | Sign the image and OTA; retain a known-good release | Release owner | Open |
| [H-23](#h-23-boot-the-release-candidate-on-cuttlefish) | Boot the release candidate on Cuttlefish | Image host operator | Development evidence only |
| [H-24](#h-24-install-the-release-image-on-pixel-10a-units) | Install the release image on Pixel 10a units | Device operator | Development evidence only |
| [H-25](#h-25-run-the-update-and-recovery-drills) | Run the update and recovery drills | Release owner | Not run |
| [H-26](#h-26-eliza-cloud-pilot-accounts-and-plans) | Eliza Cloud pilot accounts and plans | Owner | Open |
| [H-27](#h-27-google-test-account-and-an-authorized-live-send) | Google test account and an authorized live send | Owner | Open |
| [H-28](#h-28-telephony-test-resources) | Telephony test resources | Owner | Open |
| [H-29](#h-29-password-test-resources) | Password test resources | Owner | Open |
| [H-30](#h-30-development-inference-key-host-and-test-mocks-only) | Development inference key (host and test-mocks only) | Developer | Per machine |
| [H-31](#h-31-dispatch-hosted-ci-and-run-emulator-campaigns) | Dispatch hosted CI and run emulator campaigns | Owner | Not dispatched |
| [H-32](#h-32-provision-the-units-and-run-the-pilot-journeys) | Provision the units and run the pilot journeys | Device operator | Not run |
| [H-33](#h-33-voice-latency-soak-and-accessibility-on-device) | Voice latency, soak and accessibility on device | Device operator | Not run |
| [H-34](#h-34-reviewer-reproduction-and-target-user-acceptance) | Reviewer reproduction and target-user acceptance | Reviewer and owner | Not run |
| [H-35](#h-35-review-the-flagged-licence-obligations) | Review the flagged licence obligations | Owner or counsel | Open (non-blocking, P-09) |
| [H-36](#h-36-required-checks-ruleset-owners-choice) | Required checks ruleset (owner's choice) | Repository owner | Not installed |
| [H-37](#h-37-confirm-or-override-the-default-product-choices) | Confirm or override the default product choices | Owner | Defaults applied; owner confirmation open |
| [H-38](#h-38-owner-per-view-approval-and-seeker-review) | Owner per-view approval and Seeker review | Owner | Open: no MVP row approved |

Dependencies: H-01 gates H-08; H-08 gates H-09; H-09 gates H-10, the release SHA-1 in H-12,
H-13 and H-22; H-18 gates a distributable H-10; H-10, H-18 and H-20 gate production staging
(H-21); H-03 and H-04 gate every Maps request (Cloud refuses Maps with
`maps_allowance_unconfigured` until both are set, and in production also until strong credential
revocation is rolled out, H-16); H-07 and H-26 to H-29 gate the pilot (H-32 to
H-34). A release is recorded as the last release (H-32) only after it is distributed: from then
on that versionCode is refused and every later build must advance it.

## Owner selections

These are the values approved policy deliberately leaves open. None reopens a decision in
[decisions](decisions.md); each is recorded there as a dated `P-` entry when made.

### H-01 Choose release key custody

- Who: Shaw for Alpha Compute.
- Do: choose where the release keys live after the offline ceremony: encrypted key files used in
  an ephemeral signing job, an HSM, or a managed key service with a PKCS#11 interface. P-16
  requires managed or hardware-backed signing distinct from developer keys; it does not name the
  service. Name the ceremony custodian and witness and the two places the encrypted backups are
  kept.
- Seam: both signing tools accept either form. APKs: `scripts/sign-release-apks.mjs` (`--keys-dir`
  or `--pkcs11-config` with `--key-label`) or Gradle's `ELIZAOS_KEYSTORE_*`. Image and OTA:
  `scripts/sign-aosp-release.mjs` (key files, or the four managed options `--pkcs11-config`,
  `--avb-signing-helper`, `--payload-signer` and `--payload-signer-signature-size`). The key list
  is `android/signing/alpha-key-manifest.json`.
- Verify: the choice is recorded in decisions.md; nothing in the repository holds key material.
- Unblocks: H-08 and every release-signed step (#400, AP-02, AP-14).

### H-02 Confirm or replace the subscription catalog

- Who: owner.
- Do: production Cloud publishes catalog `v1`: Plus USD 30 a month with a USD 25 period
  allowance, Pro USD 100 with USD 90, no rollover, and per-minute limits 120/200/60/10 (Plus) and
  300/600/120/30 (Pro) for completions, embeddings, standard and strict requests. These are
  server-published values, not an owner decision: P-26 chose subscription billing without
  numbers. Confirm or replace them from provider cost and pilot traffic.
- Seam: Cloud's plan catalog. Alpha reads plan state from signed entitlements and shows no
  prices of its own ([entitlement contract](eliza-cloud-subscription-entitlement-contract.md)).
- Verify: `GET https://api.eliza.app/api/v1/subscriptions/plans` returns the recorded values.
- Unblocks: #410 completion and the pilot plan terms (H-26).

### H-03 Select the plan request limits

- Who: owner, from the same cost and pilot evidence.
- Do: choose the per-plan burst and sustained request buckets for `ELIZA_CLOUD_PLAN_RATE_LIMITS`.
  Upstream ships no numbers ("not selected yet"; its `placeholder` mode is for tests only), and the
  setting is off while unset.
- Seam: the Cloud Worker setting, applied in H-15. Alpha already reads `429 rate_limited` with
  `retryAfterSeconds` and shows the retry time.
- Verify: the selection is recorded in decisions.md and H-15 applies it.
- Unblocks: Maps admission (with H-04) and #410.

### H-04 Select the Maps request allowance

- Who: owner.
- Do: choose `{requests, windowSeconds}` per plan for `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES`
  (`{"selected": true, "plans": {...}}`). P-56 makes Maps a separate allowance with no per-request
  charge and leaves the numbers unset until cost and pilot evidence exist; upstream provides no
  defaults, and zero is a valid closed allowance.
- Seam: the Cloud Worker setting, applied in H-16.
- Verify: an authenticated Maps request returns a result or a typed refusal, not
  `maps_allowance_unconfigured`.
- Unblocks: every Maps search and route for a production user (#412).

### H-05 Choose Maps coverage and its operator

- Who: owner with the Cloud operator.
- Do: choose the regions served, who operates the geocoder and the router (at the current pin a
  Nominatim geocoder and a GraphHopper router on OpenStreetMap extracts; the backends are Cloud
  settings, so this choice changes no app code), the dataset refresh cadence and the monitoring.
  P-28 placed Maps in Eliza Cloud and allowed OpenStreetMap components; the regional development
  gateway is not the production coverage promise, and no region has been chosen.
- Seam: the Cloud Maps settings in H-16; the OpenStreetMap data licence in H-35.
- Verify: the choice is recorded in decisions.md.
- Unblocks: H-16 and journey J04.

### H-06 Decide whether the resident runtime may ship `@metamask/sdk`

- Who: owner.
- Do: the [dependency audit](dependency-audit.md#licence-flags-p-09) flags `@metamask/sdk` 0.33.1
  in the resident runtime: its licence grants non-commercial use only, with a monthly-user limit.
  P-09 covers open-source licences only, so whether the product may ship it is open. The audit
  names the alternative: removing it from the agent bundle is an upstream elizaOS change. In the
  pinned lock only `@wagmi/connectors` requires it (through `wagmi`, a dependency of the shared
  `packages/ui`), a wallet-connector closure; Wallet is outside the MVP (P-38).
- Seam: the notices flag it `non-open-source-terms`; nothing blocks a build (P-09).
- Update: the shared mobile agent build now excludes the wallet-connector graph (wagmi,
  RainbowKit, `@metamask/*`) from the Android resident bundle. Once the pin carries it and a
  staged runtime's inventory passes `test/wallet-disabled.test.mjs`, the package is not shipped
  and no decision is needed.
- Verify: the decision is recorded in decisions.md.
- Unblocks: licence clearance for distribution.

### H-07 Name the pilot roles and cohort

- Who: owner.
- Do: name the operator, a reviewer who is not the operator, the support owner and the rollback
  owner (Shaw), choose the four target users, and obtain four Pixel 10a (`stallion`) units with
  their SKU and hardware revision recorded.
- Seam: [pilot runbook](pilot-acceptance-runbook.md) entry conditions and per-unit table.
- Verify: the per-unit table names each unit alias, SKU and assigned operator.
- Unblocks: H-24 and H-32 to H-34.

## Release identity

### H-08 Run the release key ceremony

- Who: the custodian and witness from H-01.
- Do: follow the offline ceremony in `vendor/eliza/packages/os/android/signing/README.md` with
  Alpha's key list:
  `node vendor/eliza/packages/os/scripts/android/generate-release-keys.ts --manifest android/signing/alpha-key-manifest.json --output /media/USB1/<new directory> --passphrase-file /dev/shm/ceremony/pass --organization "<legal entity>"`.
  It writes the eleven image keys and the Alpha application key `alphaphone_app` (standalone,
  launcher and Sense listener APKs share it), encrypted, with a public `fingerprints.json`. Make
  both backups; import keys into the HSM or service when H-01 chose one, keeping the offline
  backup authoritative.
- Seam: `android/signing/alpha-key-manifest.json`; upstream refuses an output inside any Git
  working tree.
- Verify: every private file ends in `.enc`, and both people sign the printed `fingerprints.json`.
- Unblocks: H-09.

### H-09 Enroll the public release identities

- Who: release owner, in a reviewed change.
- Do: `node scripts/enroll-release-keys.mjs --fingerprints <ceremony>/fingerprints.json --certificates <ceremony>`
  (a dry run), then the same with `--write`, and commit the three records together. It refuses a
  test-key ceremony, a debug or reused certificate and any change to a recorded digest (key
  rotation needs `--replace` and its own review). It prints the application certificate's SHA-1
  for H-12 and its colon-form SHA-256 for H-13. It reads only public files: copy
  `fingerprints.json`, the `*.x509.pem` certificates, `avb_pkmd.bin` and
  `apex_payload.avbpubkey` from the ceremony media to the machine that runs it. Leave the
  encrypted private files on the ceremony media.
- Seam: `android/release-signer.json` (`signerSha256`), `android/aosp/pixel10a-product.json`
  (platform, image, APEX payload and AVB digests) and `android/aosp/pixel10a-ota-channel.json`
  (OTA certificate and AVB key).
- Verify: `npm run human:status` shows H-09 done after the full ceremony is recorded. The
  signing job requires the payload digest when it re-signs an APEX and leaves presigned APEXes
  unchanged.
- Unblocks: H-10, H-12, H-13, H-21, H-22.

### H-10 Build and sign the distributable release APKs

- Who: release owner, on the release build host.
- Do: stage the inputs `npm run android:build:inputs` lists as a person's (H-18, and H-19 when
  reported), then build with `ELIZAOS_VERSION_CODE` above the last recorded release,
  `ELIZAOS_VERSION_NAME` and `ELIZAOS_APP_LINK_HOST=eliza.app` set: `npm run android:build:local`.
  Sign either in Gradle (`ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`,
  `ELIZAOS_KEY_ALIAS`, `ELIZAOS_KEY_PASSWORD` for a keystore holding the `alphaphone_app` key) or,
  with those unset, afterwards with `node scripts/sign-release-apks.mjs --keys-dir /dev/shm/keys`
  (the ceremony layout the upstream `decrypt-release-keys.ts` writes into tmpfs for one job, for
  example with `--only alphaphone_app`; wipe it after signing) or
  `--pkcs11-config <file> --key-label <label>` (a PIN only through `ELIZAOS_PKCS11_PIN`). Sign the
  prepared Sense listener APK with the same certificate (`--apk <file> --out <file>`). Do not
  record `lastRelease` yet: the release that is recorded is refused from then on (H-32).
- Seam: `scripts/verify-apks.mjs` marks a release `distributable: true` only when it is signed by
  the recorded certificate with an advancing versionCode, packages the resident runtime and its
  notices, and carries a qualified voice host; `sign-release-apks.mjs` runs it again after signing.
- Verify: both release rows of `artifacts/apk-manifest.json` read `distributable: true`, and
  `npm run human:status` on that checkout shows H-10 done.
- Unblocks: device verification in H-13, production staging (H-21) and the pilot (H-32).

## Eliza Cloud configuration

Production and staging are configured separately; staging serves only test-mocks builds, which
are debug-signed. `node scripts/cloud-readiness.mjs registration --environment staging` prints the
staging values.

### H-11 Keep Alpha's App Auth registration active

- Who: Cloud operator.
- Do: keep Alpha's entry in `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON` and its approved `apps` row,
  and after any registry change run the "Mobile App Auth Registration Admin" workflow (repair,
  then diagnose) for client `ai.elizaresearch.alphaphone`. The registration that answered 503 on
  October 24 ([diagnosis](evidence/cloud-native-auth-diagnosis-2026-10-24.md)) answered for both
  environments, with S256, on October 27.
- Seam: `node scripts/cloud-readiness.mjs registration` prints the entry.
- Verify: `node scripts/cloud-readiness.mjs probe` reports the registration gate passed.
- Unblocks: in-app sign-in (AP-03).

### H-12 Steward sign-in and the native Google client

- Who: Cloud operator, with access to the Google Cloud project that holds Steward's Google web
  client.
- Do: Google binds an Android OAuth client to one package and signing certificate SHA-1, and
  Steward advertises native Google (`googleNative`) only for an app client listed in
  `STEWARD_GOOGLE_NATIVE_CLIENT_IDS`. After H-09, create an Android OAuth client for package
  `ai.elizaresearch.alphaphone` with the release certificate SHA-1 and add its client ID under
  `alpha-phone` (the clients that exist today were created before any release key existed).
  Staging advertises no native Google: add an Android client for the debug signer used for
  test-mocks builds to the staging Steward if staging Google sign-in is wanted. Keep the tenant
  redirect allowlists (both admit Alpha's return URL today) and the email and code routes.
- Seam: `node scripts/cloud-readiness.mjs registration` prints the Steward values;
  `node scripts/enroll-release-keys.mjs` prints the SHA-1.
- Verify: the probe's email sign-in, native Google and browser return gates; then Continue with
  Google on a release-signed build (real-integration evidence).
- Unblocks: Google sign-in on release builds (AP-03).

### H-13 App Links association on the Cloud web host

- Who: Cloud operator, after H-09.
- Do: Cloud serves `https://eliza.app/.well-known/assetlinks.json` only from
  `ELIZA_ANDROID_ASSET_LINKS_JSON`, one entry per app; a malformed value or a second entry for
  the same package publishes `[]` for every app. Today it grants Alpha's package to two
  certificates, neither of them an enrolled release certificate (none is enrolled yet). Run
  `node scripts/render-assetlinks.mjs --cloud-config --published https://eliza.app/.well-known/assetlinks.json`,
  set the printed value, deploy, and run
  `node scripts/render-assetlinks.mjs --check https://eliza.app/.well-known/assetlinks.json`.
  Whether the certificates listed today stay listed in production is the operator's choice
  (`--keep-fingerprint` keeps one; staging lists the debug signer). Keep Alpha's
  `ELIZA_NATIVE_AUTH_CALLBACKS_JSON` entry: the hosted fallback page answers today.
- Seam: `scripts/render-assetlinks.mjs`; builds declare the verified filters only with
  `ELIZAOS_APP_LINK_HOST=eliza.app` (H-10).
- Verify: the `--check` command exits 0, then `adb shell pm get-app-links ai.elizaresearch.alphaphone`
  reports `eliza.app` verified on an installed release build.
- Unblocks: verified returns for the browser sign-in fallback and the Cloud delegation filter.

### H-14 Keep the service Terms and Privacy text approved

- Who: the Eliza Cloud service operator.
- Do: keep `CLOUD_PUBLIC_SERVICE_JSON` holding the operator's approved Terms of Service and
  Privacy Policy; the sign-in screen shows exactly that text. Both environments published it on
  October 27. Any Alpha-specific terms would be a new owner decision; none is planned.
- Seam: `GET /api/public/service`, parsed by `apps/app/src/runtime/cloud-service-info.ts`.
- Verify: the probe's service documents gate.
- Unblocks: sign-in disclosure (AP-03).

### H-15 Subscription operations

- Who: Cloud operator.
- Do: apply H-03 in `ELIZA_CLOUD_PLAN_RATE_LIMITS`; keep `ELIZA_SUBSCRIPTION_GRANT_CODE_PEPPER`
  and the migrations through `0547_subscription_grant_calendar_terms` for grant codes; rotate
  entitlement keys only by the documented `NEXT`, then sign, then `PREVIOUS` procedure. Deployed
  admission latency under the normal, cache-miss, exhausted, expired and billing-outage conditions
  is not measured yet, and no harness for it exists at the pin: upstream has only the local
  lower-bound harness `packages/cloud/scripts/plan-request-limit-latency.ts` (in-process PGlite,
  recorded in the [October 15 audit](evidence/subscription-acceptance-audit-2026-10-15.md)). A
  deployed measurement makes real, counted requests, so it runs only with the operator's
  confirmation, with one prepared account per condition from H-26; the billing-outage condition
  can only be produced on the operator's side.
  The Cloud contract is in the upstream `packages/cloud/api/README.md` (Subscription grant codes
  and entitlements).
- Seam: Alpha verifies ES256 entitlements for audience `eliza-alpha-phone`
  (`config/cloud-deployment.json`); [Cloud subscription QA](cloud-subscription-qa.md) has the
  staging end-to-end checklist.
- Verify: the probe's entitlement keys gate (production `entitlement-production-2026-10` and
  staging `entitlement-staging-2026-10` on October 27); a deployed latency report once a harness
  exists.
- Unblocks: #410 completion.

### H-16 Provision the Maps service

- Who: Cloud operator, after H-04 and H-05.
- Do: per environment set what the upstream `packages/cloud/api/README.md` Maps section lists:
  `ELIZA_MAPS_GEOCODER_URL` (HTTPS Nominatim 4.3 or later with the region extracts),
  `ELIZA_MAPS_ROUTER_URL` (HTTPS GraphHopper with the same extracts and the `car`, `foot` and
  `bike` profiles; optional `ELIZA_MAPS_ROUTER_API_KEY`; `ELIZA_MAPS_ROUTE_ALTERNATIVES=false`
  when alternatives are unavailable), `ELIZA_MAPS_COVERAGE_JSON`, `ELIZA_MAPS_DATASET_REVISION`
  and `ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES` (H-04), with `ELIZA_CLOUD_PLAN_RATE_LIMITS` selected
  (H-03). The same section requires strong credential revocation and the organization Durable
  Object binding: Cloud refuses every Maps request with `maps_allowance_unconfigured` while
  `INFERENCE_STRONG_REVOCATION_ENABLED` is not `"true"`. The pinned `packages/cloud/api/wrangler.toml`
  has it on for staging and off for production, behind the staged production canary that file
  describes (staging soak, writer audit, a 5% canary, then the ramp); production Maps waits for
  that rollout. Own the dataset refresh, monitoring (including Durable Object storage for the
  replay records), capacity and the ODbL attribution and share-alike duties.
- Seam: the upstream `packages/cloud/api/README.md` Maps section; Alpha's Maps client reads
  coverage, attribution and typed refusals and has no fallback provider.
- Verify: with a signed-in plan, `GET /api/v1/maps/capabilities` returns the chosen regions and
  dataset revision, and a search and a route inside a region succeed on a signed-in phone (H-32)
  rather than answering `maps_allowance_unconfigured`. The probe cannot check this: it lists the
  Maps row as needing an account.
- Unblocks: J04 and #412.

### H-17 Google connector for Gmail and Calendar

- Who: Cloud operator, with the Google Cloud project of Cloud's connector client.
- Do: keep the connector client (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Worker) and
  a consent screen listing the scopes Cloud maps Alpha's requests to (Gmail read and triage,
  modify, send, drafts and mailbox; Calendar read and write). Google requires app verification for
  sensitive and restricted scopes before general use, and restricted Gmail scopes also need its
  periodic security assessment; until then use Testing status with listed test users, whose
  refresh tokens expire after seven days. Use of Gmail data must follow Google's API Services User
  Data Policy.
- Seam: Alpha requests capabilities, never raw scopes, through
  `/api/v1/eliza/google/connect/initiate` (`apps/app/src/runtime/cloud-protocol.ts`). Inbox read
  state stays unavailable until the deployed `inbox-v1/capabilities` advertises `readState`. The
  probe lists these routes as needing an account.
- Verify: the runbook's Gmail OAuth row with the H-27 account. A live send with the owner's
  account succeeded through a development host on October 16
  ([record](evidence/gmail-prompt-send-20261016.json)); that is not device or production evidence.
- Unblocks: AP-09 real-integration and device acceptance.

## Qualification by named reviewers

### H-18 Admit the on-device voice host

- Who: a named reviewer, with an operator for the device runs.
- Do: build and stage the voice outputs at the pin (`node scripts/build-pinned-voice.mjs`, then
  `node scripts/android-stage-voice-models.mjs --from <outputs> --from <models>`), run the upstream
  qualification (`vendor/eliza/packages/app/scripts/paradee-voice/qualify`) on both ABIs, then the
  installed-app streaming and cancellation and physical capture and playback checks. Record device
  execution and user acceptance in `android/voice-host/qualified-voice-host.json` and only then set
  `qualified: true` (the schema refuses it otherwise). Clef is not in the pin, so voice turns end on
  the long-gap fallback; admitting a Clef model is a separate reviewed step under #423.
- Seam: [fused speech](fused-speech.md); `npm run android:build:inputs` lists both voice inputs.
- Verify: `npm run human:status` shows H-18 done.
- Unblocks: a distributable release (H-10), AP-06, #397, #413.

### H-19 Embedding host libraries, only when reported

- Who: the reviewer who qualified the libraries, or one with an ARM64 device.
- Do: nothing while `npm run android:build:inputs` reports the embedding host as script-supplied
  (`remapBuildPath: true` in `android/embedding-host/build-toolchain.json`). If a rebuild stops
  reproducing the reviewed bytes, either stage them with
  `node scripts/stage-embedding-host.mjs --receipt <QUALIFICATION.json>` or qualify a candidate
  from `node scripts/build-embedding-host.mjs --candidate` with ARM64 execution evidence.
- Seam: `android/embedding-host/qualified-host.json`.
- Verify: `npm run android:build:inputs` reports the embedding host libraries ready.
- Unblocks: the strict build (H-10).

### H-20 Qualify the always-on listener

- Who: reviewer and device operator.
- Do: run gates G1 to G6 of the [listener ADR](adr/0001-privileged-listener.md) on the image and a
  Pixel 10a: image build with privapp enforcement, boot and grants
  (`node scripts/verify-aosp-listener.mjs --serial <serial> --user 0`), the system indicator and
  Listening chip, press-and-hold power invocation, coexistence, and stop reliability with the
  24-hour power run, then record the evidence in `android/sense/qualified-listener.json`. G7, a
  dedicated SELinux domain, is optional hardening evaluated after G1 and G2.
- Seam: `scripts/listener-qualification.mjs`; verify-apks copies the record into each listener row.
- Verify: `npm run human:status` shows H-20 done.
- Unblocks: AOSP always-on listening (P-40, #424) and production staging (H-21).

## Pixel 10a image

The [Pixel 10a staging and release signing](pixel10a-staging.md) guide owns the commands; the
distinct gates are recorded in `android/aosp/pixel10a-qualification-gates.json`
(`scripts/pixel10a-gates.mjs`). Source admission passed on October 26.

### H-21 Stage and build the production image

- Who: image host operator.
- Do: on the Linux image host with the admitted stallion source and factory archive, apply the
  Soong patch, run `npm run aosp:stage -- --target pixel10a --production` with the distributable
  launcher (H-10), its reviewed descriptor, the qualified listener APK and descriptor (H-20), and
  build `alpha_stallion_phone-cp2a-user`.
- Seam: `android/aosp/pixel10a-product.json`; staging refuses while any digest is unset.
- Verify: staging writes `physical-product.json` with the descriptor hash; the build record keeps
  the unsigned target-files SHA-256.
- Unblocks: H-22 and H-23.

### H-22 Sign the image and OTA and retain a known-good release

- Who: release owner.
- Do: `node scripts/sign-aosp-release.mjs --target-files <zip> --target-files-sha256 <hex> --keys-dir <dir> --releasetools <otatools/bin> --apk-manifest <apk-manifest.json> --out <new dir>`,
  adding the managed options when H-01 chose a token. The signing job requires mode 0600 for
  every file it reads from the key directory, public certificates and `avb_pkmd.bin` included,
  while the upstream `decrypt-release-keys.ts` writes the public files with the default mode: run
  `chmod 600` on the decrypted files before signing, and wipe the directory afterwards. Keep the
  signed release and its `release-record.json` as the known-good recovery release, and record it
  in the channel's `recovery.knownGoodRelease`.
- Seam: `android/aosp/pixel10a-ota-channel.json`; `node scripts/aosp-release-record.mjs` writes
  the compatibility record on its own.
- Verify: `npm run human:status` shows a recorded known-good release.
- Unblocks: H-24 and H-25.

### H-23 Boot the release candidate on Cuttlefish

- Who: image host operator.
- Do: build the Cuttlefish product from the same candidate, boot it and run
  `node scripts/verify-cuttlefish-launcher.mjs` (system Alpha APK as HOME, recovery HOME,
  enforcing SELinux). Record a release-level entry in the `cuttlefishBoot` gate.
- Seam: `android/aosp/product.json`; the 2026-10-25 observation is development evidence only.
- Verify: `npm run human:status` shows the gate passed.
- Unblocks: image integration evidence (#399, #377).

### H-24 Install the release image on Pixel 10a units

- Who: device operator, with the unit owner's consent to each flash or reset.
- Do: flash the signed image, enroll `avb_pkmd.bin` with `fastboot flash avb_custom_key`, decide
  the bootloader lock with the release owner, and check boot, enforcing SELinux and Alpha HOME.
  Record the `physicalDevice` gate with the per-unit checks of the runbook.
- Seam: [pilot runbook](pilot-acceptance-runbook.md).
- Verify: `npm run human:status` shows the gate passed.
- Unblocks: H-25 and H-32.

### H-25 Run the update and recovery drills

- Who: release owner.
- Do: on a Pixel 10a run the signed update, interrupted update, compatible rollback and stock
  recovery drills with the update and recovery tools the staging guide names, then record each
  result in the channel's `drills` and the `signedUpdateRecovery` gate. For APK-only updates,
  `scripts/pilot-update.mjs` checks an in-place update; a lower versionCode is refused.
- Seam: `android/aosp/pixel10a-ota-channel.json` (`drills`, `downgradeAllowed: false`) and the
  [Pixel 10a staging guide](pixel10a-staging.md).
- Verify: `npm run human:status` shows every drill passed.
- Unblocks: distribution (#400).

## Accounts and test resources

### H-26 Eliza Cloud pilot accounts and plans

- Who: owner.
- Do: give each pilot unit a designated Eliza Cloud account with a plan, bought or granted.
  Grant codes are minted by the Cloud operator with
  `packages/cloud/scripts/admin/mint-subscription-grant-codes.ts` (upstream; for example
  `--duration-months <n>`), and the owner chooses the term. Prepare one account per condition for
  the H-15 latency harness. Production phones accept inference only through the signed-in Cloud
  plan; they refuse a direct provider key.
- Seam: Redeem code in Alpha's plan gate and Settings.
- Verify: Settings › Eliza Cloud account & plan shows the plan on each unit.
- Unblocks: H-32 and #410 acceptance.

### H-27 Google test account and an authorized live send

- Who: owner.
- Do: provide a designated Google account with synthetic mail and calendars, and before any live
  send state in writing the exact recipient and message.
- Seam: the runbook's Gmail OAuth row.
- Verify: grant and revoke readback with receipt IDs.
- Unblocks: AP-09 acceptance.

### H-28 Telephony test resources

- Who: owner.
- Do: provide an active SIM for each image unit and owned endpoints (numbers the team controls)
  for calls, SMS and MMS. Do not place emergency calls in tests.
- Seam: the Phone, SMS and Contacts work in [architecture](architecture.md#smsmms-on-the-image-421)
  (#421); delivery reports come only from the carrier.
- Verify: provider rows, delivery reports and role readback on a unit.
- Unblocks: AP-08 acceptance.

### H-29 Password test resources

- Who: owner.
- Do: provide a test vault with synthetic credentials only, a designated test website, and
  optionally Proton Pass, on a release-signed build.
- Seam: [password provider setup](password-provider-setup.md).
- Verify: the runbook's password provider row.
- Unblocks: AP-10 password acceptance.

### H-30 Development inference key (host and test-mocks only)

- Who: each developer or operator who runs a development host or the resident instrumentation.
- Do: keep a Cerebras key in the owner-only file `~/.config/alphaphone/cerebras-key` (mode 0600).
  It serves `scripts/start-local-agent.mjs` and `scripts/android-resident-instrumentation.mjs`;
  product phones refuse direct keys.
- Seam: [local agent development](local-agent-development.md).
- Verify: the scripts refuse a group- or world-readable file.
- Unblocks: development and emulator campaigns only.

## Hosted CI and emulator campaigns

### H-31 Dispatch hosted CI and run emulator campaigns

- Who: owner, or a person the owner asks (hosted minutes follow the
  [CI cost policy](ci-cost-policy.md)).
- Do: dispatch `resident-android.yml` (jobs `native` and `recovery-ui`), `android-emulator.yml`
  (suites `instrumentation` and `browser-reading`; `fused-speech` and `all` refuse until hosted
  voice staging exists) and `digest-restart.yml` on the candidate, and run the emulator campaigns
  in [verification](verification.md) and the [core loop audit](core-loop-audit.md) on the
  distributable build, including the resident redaction instrumentation on a disposable emulator
  (`node scripts/android-resident-instrumentation.mjs`, which reads the H-30 key file).
- Seam: the workflows under `.github/workflows`; `scripts/ci/emulator-suite.mjs`.
- Verify: results committed with the commit they ran on.
- Unblocks: emulator-class evidence for AP-01, AP-02, AP-04, AP-05, AP-11, AP-12 and AP-15.

## Physical acceptance

### H-32 Provision the units and run the pilot journeys

- Who: device operator, with the release owner.
- Do: `node scripts/provision-unit.mjs --serial <serial> --alias unit-a --apk-manifest <apk-manifest.json>`
  per unit (the operator makes the Home choice), then every journey of the
  [pilot runbook](pilot-acceptance-runbook.md), the upgrade from earlier mock state, the resident
  redaction probes on a designated unit, and in-place updates with `scripts/pilot-update.mjs`.
  Once the release is installed on the units, the release owner records it as the last release:
  `node scripts/record-release.mjs --apk-manifest <apk-manifest.json>` (a dry run), then the same
  with `--write`, committed in a reviewed change.
- Seam: the runbook's per-unit record; `lastRelease` in `android/release-signer.json`.
- Verify: four complete unit records, and `lastRelease` names the provisioned release.
- Unblocks: H-34.

### H-33 Voice latency, soak and accessibility on device

- Who: device operator.
- Do: collect at least 50 voice trials per cohort (20 warm, 5 cold) from release builds of a
  clean tree, aggregate them with `node scripts/aggregate-voice-latency.mjs <exports> --out summary.json`,
  confirm the audible start with a physical loopback measurement, and run the battery and thermal
  soak plus TalkBack, large text, rotation and repeated Home on every retained view.
- Seam: the runbook's Performance and stability section.
- Verify: the aggregator exits 0 on device evidence.
- Unblocks: AP-06 latency (#395) and AP-15.

### H-34 Reviewer reproduction and target-user acceptance

- Who: the reviewer and the owner.
- Do: an independent reviewer reproduces the setup and a complete journey from the guides, records
  an unedited five-minute demonstration without private content, and the target users and
  stakeholders record acceptance of the exact release. Record the `userAcceptance` gate last.
- Seam: the runbook's Handoff and exit section.
- Verify: `npm run human:status` shows the gate passed.
- Unblocks: MVP completion (#381, #377, #378).

## Licence and repository administration

### H-35 Review the flagged licence obligations

- Who: owner or counsel.
- Do: review the flags the notices carry (P-09 makes them non-blocking, not reviewed): strong and
  network copyleft (`ffmpeg-static` GPL-3.0, `ua-parser-js` AGPL-3.0), weak copyleft
  (`rpc-websockets` LGPL-3.0, Bun's JavaScriptCore), eSpeak NG (GPL-3.0-or-later) statically linked
  into the speech engine, Phonon-2's CC-BY-4.0 attribution and the training-data terms its NOTICE
  names, the OpenStreetMap ODbL duties of H-16, and H-06. Optionally add a reference to the Denton
  licence document in `licenses/font-licenses.json` (a reference only, never the document).
- Seam: [dependency audit](dependency-audit.md), `apps/app/public/licenses/THIRD_PARTY_NOTICES.txt`.
- Verify: the review outcome is recorded in decisions.md.
- Unblocks: distribution with reviewed licence obligations.

### H-36 Required checks ruleset (owner's choice)

- Who: repository owner.
- Do: the "Main required checks" ruleset (MVP-46) is not installed. Read back on October 28, the
  default branch enforced no required status check: it carried the organization's "Require review
  before merge" ruleset and classic protection that only blocks force pushes and deletion. Whether
  and when to require the checks is the repository owner's choice: install
  `scripts/ci/required-checks-ruleset.json` (the read-back prints the command) and confirm it with
  `node scripts/ci/read-required-checks.mjs`, which needs a `gh` login.
- Seam: `scripts/ci/required-checks-ruleset.json`.
- Verify: `node scripts/ci/read-required-checks.mjs` reports the installed ruleset.
- Unblocks: enforced checks on main.

## Product defaults and owner review

### H-37 Confirm or override the default product choices

- Who: owner.
- Do: two product choices were taken by default on October 28 so implementation could continue;
  confirm or override each. (1) The membership sheet in Settings is titled "Membership & credits",
  as on NubsCarson's collector commit `7a44d7038` ("Preserve approved membership entry and
  canonical sync product behavior"). (2) Notes are stored as canonical Eliza records (#621), and
  the older Notes-storage specifications are rewritten for canonical records rather than retired.
  An override changes the membership sheet title or the Notes storage contract before the pilot
  build (H-10); neither choice reopens an approved P- decision.
- Seam: the HUMAN decision issue that records both defaults, and a dated `P-` entry in
  [decisions](decisions.md) once confirmed or overridden.
- Verify: decisions.md records a dated entry for the membership sheet title and for Notes storage.
- Unblocks: the final Settings copy and the Notes storage contract for the pilot build.

### H-38 Owner per-view approval and Seeker review

- Who: owner, with the device operator for the installed build.
- Do: review every MVP row of the [app QA and approval checklist](app-qa-checklist.md) in the order
  it gives (latest preview, deployed backend and prompt proof, installed build on the Seeker, then
  your own approval), including gesture navigation and smoothness on the current Android build, and
  mark `userApproval` approved only for rows you have personally accepted. Agents and tests never
  set this field; implemented and tested are separate columns.
- Seam: `docs/app-qa-checklist.json` (`items[].userApproval`, `items[].seeker`) and its
  [page](app-qa-checklist.md); `npm run human:status` counts the MVP rows still pending.
- Verify: every MVP row in docs/app-qa-checklist.json records userApproval approved.
- Unblocks: the final personal visual review and Seeker acceptance items of #381, and H-34.

## Retired items

These appeared in earlier owner-action lists and are no longer human steps:

- Entering a pilot Cerebras key on phones: production builds refuse direct keys; pilot units use
  the signed-in Cloud plan (H-26).
- Decisions A-19 (backup and export) and A-23 (Maps provider): resolved by P-25 (no app-data
  backup or export; confirmed Reset Alpha data) and P-28 (Maps in Eliza Cloud). What remains of
  Maps is H-04, H-05 and H-16.
- Publishing `assetlinks.json` on a separate domain: Alpha's return host is the Cloud web host
  (H-13).
- The HTTPS regional Maps gateway (`VITE_MAPS_BASE_URL`): a prototype adapter in test-mocks builds
  only.
- A private remote host for pairing: P-22 retired hosted agents and pairing.
- The Google code-exchange 401 of September 30: a live Gmail send with the owner's account
  succeeded on October 16; production Google readiness is H-17.
