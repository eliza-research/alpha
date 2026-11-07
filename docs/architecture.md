# Architecture and ownership

## October 27 shared application direction

The owner now requires one upstream mobile application for Alpha and Eliza.
This supersedes the earlier separate-renderer ownership policy as the migration
target. Reusable views, plugins, agent/context/action handling, native adapters
and Pixel 10a / Android 17 image support belong upstream. Alpha should select the
common native profile and provide theme, character and product registration.
Its package ID, signing identity, callback registration and installed storage
names remain compatibility inputs, not a separate behavioral implementation.

The sections below describe current implementation and safety boundaries until
each component has moved. Preserve user data, source authorization, cancellation
and durable effect receipts. Consume reviewed upstream commits through the pin;
do not edit the vendor checkout. The [unification audit](unification-audit-2026-10-27.md)
records the migration order and the gaps that prevent a completion claim.

### Shell host pieces and their upstream targets

The shared mobile shell (`@elizaos/ui/mobile-shell`) renders Home, its app grid, the view
registry and navigation from `config/alpha-product.json`. Apps (the installed-app drawer) and
Home edit mode are Alpha's own (`prototype/apps-drawer.tsx`, `prototype/home-shell.ts`) over the
shell's launcher join: the shell's All apps drawer lists product views beside installed apps,
while Alpha lists installed Android apps only (view refresh 2026-11, PLAN section 5). Upstream
target: a drawer filter and Home edit hooks in the shared shell. App info is
`AlphaSystemPlugin.openAppInfo` (ElizaSystem under Alpha's plugin class). A view whose registration carries a
lazy loader renders through `MobileViewHost`; Alpha contributes none today. Notes, live and mock
alike, is Alpha's own Notes template (`prototype/template.html`, `model.js`): live agent notes are
bound to it by `prototype/canonical-notes-ui.ts` over the shared Notes client, controller and
editor (owner decision, 2026-10-30). Gesture zones are the shell's
`resolveMobileShellSwipe`, and the launcher shade and empty-Home pull policy is
`@elizaos/capacitor-system/shade`; Alpha keeps only its wording and Home selector
(`prototype/system-shade.ts`). Colours, fonts and backgrounds are the record's theme, including
its `palette` of fixed product colours; the prototype files hold no colour literals
(`test/theme-palette.test.mjs`). Persisted view ids migrate once through the shell's launcher
(`migrateLauncherViewIds`, run by `createMobileShellLauncher`).

What the prototype renderer (`prototype/model.js`, `prototype/template.html`) still hosts, and
where each moves:

| Host piece | Today | Upstream target |
| --- | --- | --- |
| Status bar band (clock, radios, battery, ongoing chip) | template status row fed by `renderVals` and `AlphaDevice`/`System` facts | a mobile-shell status chrome part fed by `@elizaos/capacitor-system/settings` facts |
| Lock screen and secure surface | template lock layer, `unlock()` | a mobile-shell lock surface over the shared navigation state; device credentials stay Android's |
| Chat overlay, pill, composer, sheet and full detents | template conversation layers, `chat-overlay-motion-adapter.ts`, `usePullGesture` binding in `main.tsx` | `@elizaos/ui` shell chat sheet driven by `navigateMobileShell`'s assistant detent |
| Development stand-in shade | template shade layer behind `ELIZA_DEV_ALLOW_TEST_MOCKS` | stays a development surface; product builds use Android's shade |
| Domain views (Notes, Calendar, Messages, Phone, Contacts, Maps, Browser, Camera, Photos, Files, Wallet, Workflows, Settings) | template views with adapters; live Notes binds the shared Notes client in `canonical-notes-ui.ts` | each plugin's shared view, registered as a `MobileViewHost` loader by its own workstream; Notes keeps Alpha's own Notes design (owner decision, 2026-10-30) |

Alpha Phone is an independent Android product. `apps/app` owns its renderer,
navigation, presentation, capability policy and storage configuration. Shared
runtime, browser features, native plugins and OS tooling come from the exact
revision in `upstream.lock.json` and `vendor/eliza`.

## Cloud deployment configuration

`config/cloud-deployment.json` owns the public production and staging API, web,
services origins, tenant identifiers, entitlement audiences and optional public service names. A deployment
without a name displays its API hostname until its public metadata loads. Names
do not change credential authority or its storage namespace. `entitlementAudience`
selects the signed plan contract the client verifies; its default is
`cloud-subscription`. The Eliza records explicitly retain `eliza-alpha-phone`
for compatibility with the deployed signer. Eliza Cloud remains the default. Run
`node scripts/cloud-deployment.mjs` after changing it; renderer and Android builds
reject stale generated TypeScript or Java. The current configuration accepts
canonical HTTPS origins on the default port, without base paths or credentials.

Alpha retains its own package/client ID and `/alphaphone/auth/callback` return
path. The configured deployment must register that client, approve its callback
and publish the app's signing certificate in its web host's assetlinks document.
`ELIZAOS_APP_LINK_HOST`, when enabled, must equal the configured production web
host. The staging return uses the configured staging web host in test-mocks
builds only. Changing the backend does not import another product's identity.

Cloud credentials, pending sign-in state, acknowledgments and the local agent's
provider binding are scoped to a fingerprint of both deployment records.
Changing an authority, tenant or entitlement audience requires a fresh sign-in; credentials from the
old configuration are never implicitly adopted. Local notes keep their existing
storage names. The development browser bridge scopes its private profile by the
same fingerprint. These source checks do not prove authenticated login or device
acceptance against a configured deployment.

## October 12 approved runtime and distribution policy

[Owner decisions](decisions.md#october-12-owner-decisions) and the
[implementation plan](implementation-plan.md) govern pending changes. Only a local
resident agent is allowed; no hosted-agent connection, creation, pairing or fallback.
Eliza Cloud supplies text inference, subscriptions, Gmail, optional owner-scoped Google Calendar OAuth/API access and shared Maps services. See the [October 15 decision](decisions.md#october-15-google-calendar-service-decision); native Calendar permissions and local agent execution remain separate.
The default `native` profile requires on-device STT/TTS through native Eliza
inference/llama.cpp integration. The October 18 explicit Cloud QA profile below is
a scoped exception, not native-speech qualification.

AOSP targets Pixel 10a / Android 17. Phone, Contacts and SMS are AOSP-only and need
an image capability distinct from the launcher flavor. Wallet is outside MVP.
The isolated always-on listener is an AOSP MVP requirement and the narrowly scoped
exception to nonprivileged packaging; the main app stays nonprivileged. Shared
engine/JNI work goes upstream; product policy remains in Alpha.

Subscription authorization is asynchronously refreshed and cached, with server-side
bounded quotas on existing service requests. Local speech has no billing dependency.
Photos offers full permitted library access to the local agent; resets erase Alpha
private state without implying remote/provider or device-wide media deletion.
No app-data backup/import/export/transfer feature is planned.

Reset Alpha data uses a native disclosure followed by fresh Android device-credential
confirmation. The renderer cannot supply reset authority. Before dispatch, Alpha
persists a device-protected request and retries it before runtime callbacks or upkeep
on a subsequent launch. Android's own `clearApplicationUserData()` scopes deletion
to this package/user, force-stops package processes, cancels its jobs/alarms and
notifications, clears private app data and its UID Keystore namespace. Alpha does
not enumerate or delete shared media, another app's storage, remote Gmail/Cloud
data or subscriptions. It does not report a returned request as completed deletion.
The pending marker covers interruption before dispatch; it is itself app data and
is not a guarantee of atomic filesystem deletion or recovery from power loss midway
through Android's clear operation. Installed self-clear acceptance must be observed
externally on a disposable package/user, since the reset kills its own instrumentation.
The separate AOSP listener uses the reset contract below; native image qualification
remains required before shipping it. The coordinator, native review, authorization and
recovery surface are the shared `plugin-native-system` `reset` package (`DataReset`,
`DataResetPlugin`, `DataResetRecoveryActivity`); Alpha registers only its installed names
(`AlphaReset`, `reset-alpha` marker, `:reset_recovery` process), copy and the bounded
Cloud key revocation before dispatch (`AlphaDataReset`). Settings and tile system facts
(switch states, transport, battery), the allowlisted Android settings handoffs, the
launcher's shade request and Android role wording are likewise the shared ElizaSystem
bridge (`SystemFacts`, `SystemSettingsPages`, `SystemShade`) and
`@elizaos/capacitor-system/settings`; Alpha keeps its row and tile labels, theme and the
existing `AlphaDevice` method names its renderer calls. The Quick Settings assistant tile is
the shared `AssistantEntryTile` (inactive action tile, unlock before opening); Alpha keeps
the `AlphaQuickSettingsTile` component name, its assist entry, wording and icon.

Production Notes and vault migration controls are disabled, including their native
entry points. Damaged-data notices retain saved bytes and drafts without backup or
per-store reset controls; fitting Notes edits still recover through the existing
merge path. Explicit test-mocks builds retain migration fixtures. Ordinary Files,
Gmail attachments and PDF file creation remain available.


## Source boundaries

| Path | Responsibility |
| --- | --- |
| `apps/app/src` | Alpha UI, product policy and adapters to shared features |
| `android` | Product identity, Activity, permissions, resources and standalone/HOME packaging. `android/consumer-host.json` is the descriptor the pinned upstream consumer-host generator turns into the git-ignored Gradle host; `android/app/product.gradle` holds Gradle-time product admission |
| `android/sense` | Product identity wrappers for the upstream Sense listener; shared implementation and SystemUI policy live in `vendor/eliza/packages/app/platforms/android/sense` and `vendor/eliza/packages/os/android/sense` ([ADR 0001](adr/0001-privileged-listener.md)); never in the standalone or launcher APK |
| `app.config.json` | Package ID, display name, version and orientation |
| `config/alpha-product.json` | Versioned product record of the shared mobile shell (`@elizaos/ui/mobile-shell`, schema `elizaos.mobile-product` v1): identity, theme and stylesheet aliases, icons, view order and labels, older view ids migrated once, and installed storage names (the launcher favorites record with its `alpha:` prefix and `alpha-apps` default policy, and the other names the app keeps reading). Home, the app grid, the view registry and navigation state (open view, Back stack, drawer and the assistant's pill, composer, sheet or full detent) render from the upstream shell with this record; runtime code such as agent navigation reads the React-free `@elizaos/ui/mobile-shell/core` entry |
| `backend` | Development runtime composition, character and permitted model/actions |
| `vendor/eliza` | Pinned shared platform source; never modified by consumer builds |
| `scripts` | Consumer build orchestration and product acceptance scenarios |
| `design` | Requirements and visual references, not executable instructions |

Maps, Files and Notes implementations are copied from authenticated upstream
source into a generated cache outside the submodule. Gradle includes the shared
password manager directly from the reviewed pin. The secure store and notification ledger use explicit
reviewed patches in `patches/eliza/native-manifest.json`: admission authenticates the pin,
patch digest, target before/after hashes and complete staged module inventory. Gradle
compiles the generated copy under `.eliza/patched-native`, never a modified submodule.
No source patch is applied during client, worker or resident-runtime builds. Photo edits, capture publication, the opt-in notification mirror and the delivery-receipt
ledger for Alpha's own workflow and approval notices (`NoticeDelivery`, configured by
`WorkflowNoticeDelivery`) also use shared native modules. Alpha wrappers retain installed storage names, media paths and Android components.
The workflow notice tap routes, tap capture, owner fence, approval coordination, journal recovery and poster are the
shared `NoticeRoutes`, `NoticeTapInbox`, `NoticeOwner`, `NoticeCoordinator`, `NoticeRecovery` and `HostNoticePoster`;
the renderer bridge itself (own rows, channel settings, cross-app policy and history, tap pending/consume with the
question excerpt, `postWorkflow`/`workflowReceipt`, all behind `ForegroundNoticeGate` on a bounded `NoticeWorker`) is the
shared Capacitor `NotificationsHostPlugin`. `WorkflowNoticeTaps`, `WorkflowNoticeDelivery`, `WorkflowNoticePoster` and
`AlphaNotificationsPlugin` only supply the deployed slot names, channels, icon, tag prefix, launch actions, the
`alpha-notification-access` mirror, Alpha's own notice kinds and the canonical Eliza notification tap. The renderer's notice owner fence, tap resolution, approval notice identity and owner-return
revalidation are the shared `@elizaos/contracts/notice-routes`. Typed workflows use the shared
`@elizaos/contracts/phone-workflow` normalizer, and their reviewed local-time triggers run on the resident agent's
durable task scheduler only while the phone is on (a missed occurrence is recorded, never run late, and its
receipt offers an explicit Run now through the workflow's reviewed run confirmation); there is no Alpha scheduler. The receipt-checked workflow route client (exact-version activation and runs, approval
receipts, metadata, removal and restore, typed saves, and reconciliation by submission or mutation identity) is
the shared `@elizaos/contracts/workflow-client`; `runtime/workflow-protocol.ts` only adds the phone-step review read,
the digest result routes and the test-mocks development enrollment labels, and always supplies the local transport.
Modules named `hosted-*` are not Cloud-only and none is dead: `hosted-digests`, `hosted-background`,
`hosted-digest-ui`, `hosted-live-source-ui`, `hosted-notice-question` and `hosted-result-notices`, with the native
`Hosted*` classes and `SourceRenewalNotices`, carry the resident digest schedule, its retained results, the
content-free result and source-renewal notices and their Ask taps. The agent half is upstream
(`plugin-workflow` `services/hosted-digest.ts`). They belong to the brief and overview path, keep their installed
channel, tag, action and storage names, and are moved only with that path, not removed because of their names.
Browser policy helpers are staged from the same authenticated pin. Gradle writes shared
library outputs under the host build directory, outside the immutable vendor checkout.
Product wrappers inject presentation, device configuration and installed storage identities. Resident
runtime preparation also uses the locked upstream source without patch replay.
Resident Java staging reads the exact locked upstream source, which now contains
the reviewed IPC startup recovery pair. Its generated-source receipt binds original
and generated hashes across host identity/resource/environment configuration; CI
requires both recovery files and refuses resident patches. The retired patch and
source equivalence are recorded in `patches/eliza/resident-ipc-recovery.md`.
The vendor checkout and prepared resident runtime stay unchanged.

The Android Gradle setup itself is generated: the upstream consumer-host generator
owns toolchain, SDK levels, variants, build types, signing and version policy, test-mocks
source sets and admission wiring, and stages the resident runtime classes into Alpha's
package from the descriptor's installed identities (socket namespaces, notification
resources, environment hook). Upstream build orchestration collects the four APKs.
Alpha keeps only data and its product admission and APK verification. The APK inspection
itself (aapt/unzip facts, dex markers, signer digests, backup/cleartext/export/test-only/
source-map/version checks) is upstream `artifact-inspection/apk-distribution.mjs`; Alpha's
`scripts/apk.mjs` supplies `DISTRIBUTION_POLICY` as data (exported-component allowlist,
development hooks, removed speech runtimes) plus the Quick Settings tile and per-flavor
permission checks.

Generic behavior belongs upstream with configurable host inputs. Product names,
package IDs, storage namespaces, view allowlists and approval policy stay here.
Do not import another product's UI or turn Alpha-specific restrictions into
universal platform defaults. Use existing upstream schedulers, credential
providers and stores rather than introducing competing implementations.

`base/` is retired; the original app baseline remains recorded in
[its provenance file](eliza-app-baseline-provenance.json). There is one product renderer
in `apps/app`. The remaining `backend` files compose a development host from shared
runtime packages; the product character, allowed views and proposal-only behavior
stay here. Product build admission and acceptance campaigns also stay in `scripts`.
Moving those directories intact would move product policy into the shared platform.

## October 18 explicit Cloud QA profile

The owner-approved `cloud` profile retains the genuine Android-resident Bun agent,
PGlite history, orchestration and approvals while routing text inference to Cerebras
and embeddings/STT/TTS through authenticated Eliza Cloud; speech output is Cartesia.
It excludes local models and native inference/speech payloads. The profile is
explicit in staging, renderer and Gradle configuration, with matching package
provenance checks; test mocks and unpackaged residents are forbidden. Cloud voice
requires visible upload/plan disclosure and an explicit start, and remains bound to
the current account. The `native` default and its native/AOSP qualification gates
remain unchanged. This configuration does not prove native speech or release acceptance.
See the [profile selection notes](../README.md#explicit-cloud-qa-profile--october-18).

Both profiles are declared once upstream (`packages/app/src/runtime/native-runtime-profile.ts`
at the pin). The resident boot selects one with `ELIZA_RUNTIME_PROFILE`; the shared profile
writes the text, embedding and agent-speech routing and selects the shared powered-on
scheduling policy (`ELIZA_MISSED_SCHEDULED_OCCURRENCES=record`, P-10). A scheduled workflow
or prompt-automation occurrence that passed while the agent was not running (phone off or
resident stopped) and is reached more than 30 minutes late (P-75) is recorded once as missed and
never replayed; the workflow history labels it "Missed — not run", and a missed one-time
prompt stays listed, disabled, for an explicit Run now. A delay while the resident was running
(Doze, a busy scheduler) still runs the occurrence late, since Doze is a separate constraint.
Phone typed schedules and resident digests admit with the same 30-minute window, measured from
the scheduled time alone. Alpha's admitted host module declares
only its Cloud API base (`backend/native-cloud-runtime.ts`). Current-turn screen and
selection identifiers travel only in `metadata.clientDevice.context` under the shared
`client-turn-observation` contract; the older instruction envelope remains for unnegotiated
development peers and for reading history stored by older builds.

## Chat controls and notices

Chat controls use the remaining native system-bar inset, converted into the scaled
renderer canvas, with space above the navigation buttons. Standalone Android fits
its WebView inside the bars and supplies zero remaining inset. Floating controls,
expanded text input and voice controls share the same clearance; their measured
height bounds top notices, including when a draft grows or the keyboard opens.
Routine saves, toggles and draft restoration stay quiet. In the chat, draft conflicts
and voice recovery appear above the conversation's composer; on the floating dock a
draft-storage problem stays attached above the input bar, never over or below it.
Transient errors and Undo appear at the top of the phone. Modal feedback takes space above the form instead of floating
over its fields. Cloud voice retains its pre-start upload and plan disclosure.

## Build surfaces

The web build (`npm run build` → `web-dist/`) is a development and preview surface and
the payload packaged into the APKs; it is not a standalone product distribution. The
product ships as the standalone and launcher APKs.

One build-time switch, the upstream name `ELIZA_DEV_ALLOW_TEST_MOCKS`, gates every mock,
fixture and developer surface. It is off unless set to exactly `1`. The renderer reads
it only through `apps/app/src/build-flags.ts` (`testMocksEnabled`, and
`devSurfacesEnabled` for development-server-only surfaces); Vite folds it to a constant
and, when off, replaces the prototype fixture module with an empty module. Android
receives it as `-PELIZA_DEV_ALLOW_TEST_MOCKS=1`, exposes
`BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS`, and attaches the `src/testMocks` source set
(development agent and voice plugins, synthetic autofill, loopback cleartext config,
fixture-package visibility) to debug variants only when on. Development behavior keys
on that field, not on `BuildConfig.DEBUG`. The switch is on for `npm run dev`,
Playwright and explicit test-mocks builds, and off for `npm run build`,
`npm run android:sync` and `npm run android:build`. No `ALPHA_*` switch or widened
`ELIZA_` env prefix is used.

## Runtime and permissions

The primary agent runs on Android. Local orchestration, durable state and tool
approvals are separate from model inference: hosted inference requires explicit
configuration and outbound-context policy. Production builds do not accept remote pairing or hosted-agent provisioning, discovery, adoption or restore. Cloud sign-in authorizes
billed inference for the resident agent; it does not select a hosted agent. Existing
remote credentials and history are retained without automatically reconnecting.
Remote browser transports are available only with the explicit test-mocks switch and remain non-product development infrastructure.
The production AlphaConnection boundary admits exact managed-service origin and path/method pairs for identity, balance, self-revocation and owner Gmail. Dedicated hosts and agent/provisioning paths on the Cloud API origin are refused before network dispatch. Native resident inference remains on its separately admitted provider route; the Eliza Cloud Maps data routes (`GET /api/v1/maps/capabilities` and body-only `POST /api/v1/maps/{geocode,reverse,places/search,places/details,routes}`, #412) are admitted exactly, and other new service APIs require explicit route review. GPS, the active route and guidance stay on the phone. Debug host forwarding (the DevelopmentAgent bridge, present only in test-mocks
builds) is development infrastructure, not evidence of a resident runtime or
production authentication.

The route set, transport bounds, delegation-return admission and request registry behind AlphaConnection, and the provider slot binding, launch order (provider admission, then the native profile's embedding route) and attach admission behind the resident Agent bridge, are the shared `plugin-native-agent` `connection` and `runtime` policies. Renderer secure-slot admission (native-only namespaces, the compare-and-exchange allow-list and the credential slots) is the shared `SecureSlotPolicy`, and the last-intent-wins credential fence that orders Cloud sign-in, renderer credential writes and resident rebinds is the shared `CredentialIntentFence`, guarded by the resident lifecycle lock. Alpha supplies its plugin names, Cloud hosts (`CloudDeployment`), link scheme, slot names (`RendererCredentialSlots`) and the packaged `config/owner-routes.json`; the Capacitor plugins keep the Android plumbing and the resident lifecycle locks.

### Eliza Cloud sign-in ownership (in-app, 2026-10-14)

October 27: the native client below is the shared elizaOS library `packages/auth/android`
(`ai.eliza.auth.cloud`: `CloudSignInPlugin`, `CloudSignInFlow`, `CloudEmailCode`, `CloudSmsCode`,
`CloudSignInReadiness`, `CloudSignInRoutes`, `CloudKeyRevocation`), consumed from the pin.
`AlphaCloudSignInPlugin` only registers Alpha: its App Auth client, callback path, deployments,
product name, Steward app client for native Google, installed slot and preference names, the
Keystore credential store and the resident credential-intent fence. The subscription entitlement
client is likewise `@elizaos/cloud-sdk/subscription-entitlement`; Alpha binds only its copy.
The account UI leads with the monthly subscription, verified plan allowance and
access end date. It does not show a credit balance or top-up action. Alpha's copy
adapter presents legacy credit-only accounts as having no active subscription,
without changing the shared account admission policy. Grant access dates are not
renewal promises; pricing and paid subscription changes stay in Cloud's billing flow.


Native sign-in stays on Alpha's own screens. Email remains available when the optional Google
readiness probe fails or times out; its native request reports any service configuration failure.
There is no automatic Eliza Cloud website sign-in fallback.

- **Readiness (`CloudSignInReadiness`, `CloudSignInPlugin.status`)**: readiness reports email, SMS and optional native Google separately, checked with a few short requests and cached (6 hours when a method is ready,
  10 minutes when none is; any error, timeout or unexpected answer is "not ready"):
  - `GET /api/v1/app-auth/mobile/config` confirms the registration for client
    `ai.elizaresearch.alphaphone`, this environment and the return URL; without it no method is ready;
  - `GET /steward/auth/providers` offers email (or SMS) without a captcha for `email_otp` (`sms_otp`),
    and the email code route exists (an empty-object POST is refused as invalid, not as unknown; no
    email is sent);
  - Alpha selects the shared client's browser Google mode for AOSP. Google is offered only when
    Steward offers it, its authorize endpoint admits the exact callback, an external HTTPS browser
    is installed (a Custom Tabs browser is preferred), and Android and the callback host's asset
    links verify this package and signing certificate. Google Play services are not required. The
    shared native mode remains available to other hosts and uses `googleNative`.
  A refusal from Cloud during an in-app sign-in clears the cache so the next
  attempt re-checks. The renderer waits at most 6 seconds, then offers email alone. A late result cannot
  change the already opened attempt.
- **Native (`CloudSignInPlugin` registered by `AlphaCloudSignInPlugin`, `CloudSignInFlow`, `CloudEmailCode`)** holds the Steward
  session, codes and PKCE verifiers and makes every sign-in request, using fixed URLs on the Cloud API
  origin (`CloudSignInRoutes`; the renderer transport admits none of them):
  - Email: the six-digit code endpoints of elizaOS/eliza #36260, kept in one adapter
    (`CloudEmailCode`, `config/cloud-email-code.json`): `POST /steward/auth/email/code/send`, then
    the code typed into Alpha goes to `POST /steward/auth/email/code/verify` with a PKCE verifier.
    No magic link is requested. Five wrong codes end an attempt; one code send per 30 seconds per
    phone, or longer when Cloud asks.
    A second verification uses `/steward/auth/mfa/{totp,sms}/complete`. SMS codes use the
    tenant-bound `/steward/auth/sms/{send,verify}` (`CloudSmsCode`) under the same send cooldown.
  - Google: an external browser (a Custom Tab when available, otherwise the default browser)
    opens Steward's Google authorize endpoint with fresh state and S256 PKCE,
    `prompt=select_account` and `mfa=exchange`. Google credentials stay in that browser;
    Alpha's privileged WebView never hosts Google. The native client keeps the verifier in the
    encrypted, single-use, ten-minute pending record (`cloud-signin:v1:pending`, a native-only slot)
    and returns through the verified App Link `https://eliza.app/alphaphone/auth/callback`.
    Returns follow the shared
    callback contract
    (Alpha's vectors `test/fixtures/alphaphone-auth-callback-contract.json`, run through the shared
    parser; the shared client's own synthetic vectors are elizaOS/eliza
    `packages/auth/android/test/fixtures/app-auth-callback-contract.json`):
    Success is exactly `{code,state}` in the fragment; an error is exactly `{error,state}` (error
    from a fixed allowlist) in the query or fragment; anything else on the callback, including the
    parameterless hand-off from Cloud's fallback page, carries no result. The state is compared in
    constant time before anything is burned: a mismatching return is ignored and cannot cancel a
    sign-in; the matching return burns the record before the code goes to
    `POST /steward/auth/oauth/exchange`. A return without a result reports a retry message but keeps
    the record until it expires or the owner starts again (or cancels). Completing a return also
    requires the original live attempt and credential intent; a process restart or closed browser
    therefore requires an explicit new sign-in and cannot revive old credential authority.
  - Every path then runs the shared tail. The Steward session goes to
    `POST /api/v1/app-auth/connect` (`mobile_pkce`, a second independent state and PKCE pair), then
    `POST /mobile/token`. Native writes an ack receipt and then the `eliza_mobile_` key to
    `cloud:<environment>` (AlphaCredentialStore, Keystore AES-GCM, credential-intent rule) and
    acknowledges with `POST /mobile/ack`, retried at most three times and resumed on the next start.
    A key it replaced is then revoked once, best effort (`CloudKeyRevocation`). Finally native
    revokes the Steward session with `POST /steward/auth/logout`; the refresh token is never stored.
  - The `cloud:<environment>` slot is renderer-readable, like the hand-off's key: the renderer
    reads the key to send it as its Bearer. So this client stays on Cloud's default 30-day key
    lifetime. Plugin results carry no secret.
- **Renderer (`cloud-sign-in.ts`, `cloud-sign-in-ui.tsx`, `CloudProtocol.signInWith*`,
  `connection-ui.tsx` `beginSignIn`)** shows the screens. Plugin results are only
  `{status, environment, expiresAt, accountCreated, previousSignIn?}`. One sign-in runs at a time
  (`login-active`). It then runs the unchanged identity, entitlement, redeem and resident-binding
  path on the stored key, and says so when `accountCreated` is true.
- **Cloud sign-in hand-off (`CloudProtocol.login`, `/api/auth/cli-session`, the `cli-login` page)**:
  the explicit browser development profile and a **Browser sign-in (diagnostic)** button
  in test-mocks builds only; it is not the native readiness fallback. Product bundles fold it away
  (`cloudSignInHandOffAvailable`), refuse it before any request, and their route policies
  (`managed-service-routes.ts`, `ConnectionRoutes.managedService`) do not admit `cli-session`; the
  production bundle audit denies its routes and copy.
- **Cloud (elizaOS/eliza `packages/cloud`, `packages/auth`, `packages/app`)** owns the accounts:
  - Steward links Google and email to the existing user by verified email.
  - Mobile App Auth mints the key, valid for 30 days.
  - For in-app sign-in, Cloud must register `ai.elizaresearch.alphaphone` in
    `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON`, allowlist the return URL for tenant `elizacloud`, serve
    `/.well-known/assetlinks.json` on `eliza.app` with the release certificate
    (`scripts/render-assetlinks.mjs`), and deploy the email code routes. The APK must be built with
    `ELIZAOS_APP_LINK_HOST=eliza.app` so it declares the return App Link. `staging.eliza.app`
    serves the same with the debug certificate added.
  - The callback fallback page (`/alphaphone/auth/callback` when Android did not hand the link to
    Alpha) forwards no code: it only brings Alpha forward without parameters.
- **Test-mocks only:** the staging return host (`src/testMocks/AndroidManifest.xml`), the
  development Cloud bridge's email sign-in, and the diagnostic button.

Third-party web content runs in an isolated native browser surface; it must not
receive the application's Capacitor bridge. Origin, context revision, consent,
sensitive fields and cancellation remain bound to each action. The native tab
lifecycle (tab model, persistent and private profiles, pop-ups, app links, clearing,
find, reviewed reading and attested login fields) is upstream
`BrowserTabHostPlugin` in `plugin-native-browser-surface`, and the renderer's tab
events and document revisions are its `BrowserTabSession` (`./tab-host`).
`AlphaBrowserPlugin` supplies only the Capacitor name, Alpha's installed browser
identity (`AlphaBrowserStores.IDENTITY`) and its speech route; `browser-adapter.ts`
binds the session model to Alpha's view. Credentials use
Android Keystore-backed storage in the no-backup directory. The renderer bridge
and background consumers use upstream `JsonCredentialSlots` through
`AlphaCredentialStore`, sharing one process-wide lock and compare-and-exchange.
Alpha owns the installed alias, directory, per-slot byte limits and renderer
namespace restrictions. Saved passwords use the separate authentication-bound vault of
the shared password plugin; see [password-provider-setup.md](password-provider-setup.md). The ciphertext frame, hashed filename and slot AAD remain
unchanged; writers in separate Android processes are outside this contract. Renderer preferences
hold nonsecret selections and identifiers. Backup remains disabled by the reset-only policy; no app-data transfer is planned.

Standalone and launcher APKs share `ai.elizaresearch.alphaphone` and replace one
another. Only the launcher variant declares HOME. Release outputs require
controlled signing through the upstream `ELIZAOS_KEYSTORE_PATH`,
`ELIZAOS_KEYSTORE_PASSWORD`, `ELIZAOS_KEY_ALIAS` and `ELIZAOS_KEY_PASSWORD` values;
without all four the build emits unsigned release APKs. System installation alone does not grant protected roles or
permissions. OS staging admits the product APK separately from Eliza's full app;
release provisioning owns default roles, signing, update compatibility and
recovery policy.

Image staging, APK release records and update tooling are shared `packages/os` modules that
Alpha binds with its policy only. `image-apk-admission.mjs` admits the launcher APK and the
reviewed source overrides for `scripts/stage-aosp.mjs`; `apk-release-record.mjs` names a
release row's blockers for `scripts/release-blockers.mjs` (Alpha supplies the release-signer
admission and the font-licence switch; open-source licence flags never block, P-09) and holds
the in-place update checks `scripts/pilot-update.mjs` uses; `aosp-ota-update.mjs` owns the
operator update, fallback, stock-recovery and known-good retention commands. The read-only
update-channel client is upstream and registered off in Alpha. Alpha's remaining staging code is
its product policy (descriptor, listener, provisioning, capability and Pixel 10a/Cuttlefish
bindings). The shared mobile agent build excludes the browser wallet-connector graph (wagmi,
RainbowKit, `@metamask/*`) from the Android resident bundle.

Phone, Contacts and SMS exist only on the Alpha AOSP image (decision P-36). The image
capability is decided natively by the shared plugin-native-messages `ImageCapability`, which
`AlphaImageCapability` feeds with Alpha's build flags and provisioning resource: the release
launcher build without test mocks, installed from a system partition (`FLAG_SYSTEM`), with the `<package>.aosp_image`
system feature that `scripts/stage-aosp.mjs` declares in the image product (see the release
tooling paragraph below). The launcher
flavor, test mocks, URLs and saved state never establish it. Only then does `MainActivity`
register `AlphaTelephonyPlugin` (read-only contacts through the shared `ContactsCatalog`, role
and SIM status, dialer and SMS handoffs, SMS/MMS provider reads and reviewed native sends); the
renderer reads its presence from the injected plugin headers (`apps/app/src/runtime/aosp-image.ts`,
using the shared `detectTelephonyProfile`). Standalone APKs declare no contacts or
phone-state permission.

Since the October 27 consolidation the telephony behaviour is shared upstream and Alpha keeps
only identity: `AlphaTelephonyPlugin` subclasses `TelephonyPlugin` (plugin-native-messages);
`AlphaTelephony` supplies the installed journal slot, legacy plaintext journal, retired-ID
namespace, callback actions, data scheme, extras and receiver; the renderer client is
`@elizaos/contracts/native-telephony` and the send contract `@elizaos/contracts/sms-send`.
The launcher declares the dialer-role components (`AlphaInCallService`, `AlphaCallActivity`,
`AlphaDialPadActivity`, shared from plugin-native-phone; `USE_FULL_SCREEN_INTENT` lets the ringing-call
notice open the call screen over the lock screen) and the SMS-role components
(`AlphaSmsDeliverReceiver`, `AlphaMmsWapPushReceiver`, `AlphaMmsResultReceiver`,
`AlphaRespondViaMessageService`, `AlphaSmsComposeActivity` and the shared `MmsFileProvider`)
disabled. `AlphaTelephonyRoles` enables them only while `AlphaImageCapability` verifies the image,
so Android can offer the roles nowhere else and the owner still chooses them in Android's dialog.
As SMS role holder Alpha stores incoming SMS and MMS before notifying (one notice per conversation,
titled with the contact name when Contacts access is granted), keeps read state (opening a conversation
marks its shown received messages read through the shared `markThreadRead`), and every outgoing text,
quick replies included, is a reviewed, journaled send that Alpha also writes to the provider, because
Android writes no sent rows for the default SMS app. Telecom owns emergency routing; the
system emergency dialer does not depend on Alpha. Gmail is available in both distributions through Eliza Cloud, with
read access first and one incremental change grant (`apps/app/src/runtime/gmail-grants.ts`).

Native reminders use the shared `plugin-native-reminders` engine and bridge. The browser
build's reminder store applies the same engine's Done and Snooze decisions through the
shared `@elizaos/macosreminders/occurrence` module: a one-off Done completes the reminder,
and a repeat records the finished occurrence and advances to its next civil occurrence
in the saved zone. Alpha keeps only storage, delivery state and revisions. The device-local
write-ahead journals for reminder creations and selected-reminder actions (cancel, complete,
snooze, edit), their readback match, refusal retirement, reviewed outcome checks and the
overdue, undated to-do, reopen and refusal-message decisions are `plugin-assistant`'s
`reminder-journal.ts` (`@elizaos/plugin-assistant/device-reminder-journal`).
`apps/app/src/runtime/reminder-creations.ts` and `reminder-deletions.ts` bind it to Alpha's
installed slots (`reminder-creations:v1:device`, `reminder-deletions:v1:device`) and browser
documents through `reminder-journal-store.ts`; reconciliation reads rows and receipts only.
The reviewed deletion Undo window (ten seconds on a monotonic clock, delayed provider
deletion, immediate suspension of reminder delivery, owner fences and no replay of an unknown
outcome) is `@elizaos/capacitor-action-journal`'s `actionjournal.deletion` package, with the
renderer contract in `@elizaos/contracts/deletion-window` and the notice in `@elizaos/ui`'s
`DeferredDeletionNotice`. Alpha's `NativeDeletionCoordinator`, `AlphaDeletionsPlugin` and
`runtime/deletion-undo.tsx` bind its ports, slot names and theme (`docs/deletion-undo.md`).

The Clock hand-off contract is shared: `plugin-assistant`'s `clock-handoff.ts` (exported
from `device-clock-review`) owns handoff validation, the capability policy, review text and
receipt binding, and `apps/app/src/runtime/clock-contract.ts` only binds Alpha's brand name
and existing import names. The shared `plugin-native-system` `clock.ClockHandoff` builds the
Android Clock intents and starts the resolved external handler (a launched Activity is never
a receipt), and `clock.ClockDays` admits repeat days; Alpha's `DailyAppsPlugin.clockHandoff`
and `ClockAgentReview` only bind them, and Alpha keeps no Clock intent copy. Upstream
offers `clock.handoff.v1`, `clock.handoff.v2` (repeat days) and `clock.alarms.v1` (alarms
owned by the host app) in `packages/agent/src/api/device-action-routes.ts` at the pin. Alpha
negotiates through the shared `clockHandoffCapabilities` policy: `clock.handoff.v1` on Android
when the agent offers it, `clock.handoff.v2` only when the native surface also reports
`clockRepeatDaysVersion` of at least 1, and never `clock.alarms.v1`, because Android Clock
owns alarms (P-17, A-11). As upstream defines, an explicit empty repeat-days list is a
one-time alarm; the shared dispatch validator omits `days`, so Clock never receives an empty
`EXTRA_DAYS`. The upstream Eliza Android host still advertises its owned `clock.alarms.v1`
store: `packages/app`'s `SlotClockPlugin` builds `ClockHostClient` with `AlarmMetadata`, and
the same client built without it advertises only `clock.handoff.v1,clock.handoff.v2`. Moving
Eliza to the shared handoff policy, and what happens to alarms already saved in `ElizaAlarms`,
is an open owner decision (#681 item 5); until then the two brands advertise different Clock
capabilities. The seam is upstream: `clock.ClockProfile` (`HANDOFF_ONLY` or `OWNED_ALARMS`)
selects the Eliza host's capabilities in `SlotClockPlugin.CLOCK_PROFILE`, and
`ClockProfile.SavedAlarms` names the saved-alarm paths (keep, read-only, hand off to Clock).

Other shared system pieces Alpha only binds: the Cloud key revocation that runs before a
confirmed data reset (`CloudKeyRevocation.resetStep` in `packages/auth`, bounded to 8 seconds,
bound in `AlphaDataReset`), the privacy-bounded problem log (`plugin-native-system`
`crash.CrashLog` and `@elizaos/capacitor-system/crash-log`, bound by `AlphaDevicePlugin` and
`runtime/crash-log.ts`, which adds only Alpha's Cloud inference records), and the startup
permission walkthrough policy (`packages/ui` `permissions/permission-walkthrough.ts`, bound by
`startup-permission-flow.ts` and `startup-permission-progress.ts` under Alpha's installed
storage names).

Device-local Notes recovery is shared too: unsaved-edit drafts and their conflict merge
(`notes-draft.ts`), the capacity-aware vault and the owner Trash actions
(`notes-trash-actions.ts`: write-ahead move, restore, delete forever, empty Trash and the
confirmed deletion after a full Trash) live in `plugin-notes/src/client`, as do the
selected-note text serializer (`note-share-text.ts`), the voice-note recording deletion
journal, its interrupted permanent-deletion plan, renderer lease, cross-view claims and
deletion lock (`notes-recording-deletion.ts`), the recording effects of approved, expired,
permanent and interrupted deletions (`notes-recording-effects.ts`) and the reviewed
recording summary proposal (`notes-recording-summary.ts`). Alpha keeps its installed slot,
document, lock and claim names, the native recording store (`AlphaNoteAudio`), the editor
deletion and restore flows, and presentation. The renderer
lease must stay equal to `NotesDeletionLease.LEASE_MS` used by the Android native passes.
Both Notes sources render through Alpha's own Notes view. Agent notes use the shared
`plugin-notes/src/client` controller and editor (canonical records, `expectedRevision`, restore-only
Trash, review and reload) bound by `canonical-notes-ui.ts`; the device-local Older notes collection
keeps its own store, Trash and recorder. The shared `NotesWorkspace` component is not rendered.
Both sources share the view refresh layout (design/view-refresh-2026-11/PLAN.md section 3): a header
with Record (`notes-record`) and New note only, a folder chip row (All, folders, +, and Recently deleted
while it has items), a one-column list with a Pinned section, and Back · Checklist · Share · ⋯ on a note.
Folders are one device slot (`notes-folders:v1:device`, `runtime/notes-folders.ts`); a note names its
folder by `folderId` (agent notes in their format data), and a reference to a deleted folder reads as no
folder. Record opens the unlimited Notes recorder (`prototype/note-recorder.ts` over
`AlphaNoteRecorder`, segments transcribed while recording). In Older notes Done saves the audio and
transcript; in agent notes it saves the transcript and length only, since agent notes keep no audio
(owner decision, 2026-10-30). Record replaces agent notes' earlier dictate-new waveform. Agent notes'
restore-only Trash is their Recently deleted folder; Older notes keep 30 days (decision N2) with Delete
now and Empty. Previous notes (`notes-source-legacy`) stays a quiet text action under the list.
Notes ports are shared too: `plugin-notes/src/client` owns the document port and its browser
implementation (`note-documents.ts`; Alpha's `runtime/browser-note-documents.ts` only registers
it as `AlphaNoteDocuments` with the `Alpha scan` PDF file name), the deletion-receipt rule that
retires a From note link (`note-deleted-origins.ts`; Alpha's `browser/deleted-note-origins.ts`
only supplies its deletion documents as the receipts port) and the reviewed Calendar/reminder
draft (`note-schedule-draft.ts`, the note editor's Review reminder and Review event in `canonical-notes-ui.ts`). One
Notes file remains Alpha's because it binds Alpha storage rather than Notes rules:
`runtime/notes-trash.ts` (the Trash slot `notes-trash:v1:device` and browser document under the
shared Trash policy). The Trash storage step itself
(validate in and out, compare-and-exchange, confirm by readback) is now shared as
`createNotesTrashStore` and `compareExchangeNotesTrashPort` in `plugin-notes/src/client`
(elizaOS/eliza#38104, develop d2578cb4); once the pin includes it, `notes-trash.ts` keeps only its two slot
ports and its slot names. Note-origin links name either an Older notes voice recording (version 1) or a canonical
Notes record (version 2, a SHA-256 of its authored fields) and share one index
(`note-origins:v1:device`); `canonical-notes-ui.ts` binds the draft actions, so a canonical
note's Calendar draft or reminder draft keeps a From note link that opens that exact record.

`AlphaNoteAudioPlugin` is installed-data compatibility, not a second recording engine. Storage,
receipts, owner fences, the two-step trash/restore/purge and the legacy metadata migration are
the shared `RecordingStore` (elizaOS `plugin-native-media`); the renderer settles permanent
deletions with the shared `notes-recording-deletion.ts` and `notes-recording-effects.ts` plan,
and the plugin's native backstop (`finishPermanentDeletions`, `sweepExpiredTrash`) settles the
same receipts through `RecordingStore` while Alpha is closed. What stays in Alpha are the identities an installed phone already holds and
that must keep resolving: the `note-audio` no-backup folder, the `note-audio-metadata:v1:` and
`notes-trash:v1:device` / `notes-records:v1:device` / `notes-audio-deletions:v1:device` slot
names in `AlphaCredentialStore`, the `alpha-notes-trash-backstop` WorkManager name, the
`AlphaNoteAudio` Capacitor name, and `MediaPlayer` playback of a saved clip. Renaming any of
these would orphan existing recordings or their deletion receipts. A shared notes-audio host
would only rename these: no Eliza Android host uses `RecordingStore` for device-local voice
notes today, so the plugin stays as the product's binding to the shared store.

Selected documents, attachments and PDFs follow the same split. `plugin-native-media` owns the
selected-document registry and its bridge contract (`SelectedDocuments`,
`SelectedDocumentCalls`), the folder tree (`DocumentFolderTree`), the temporary viewer copy
(`ReviewedFileHandoff`), verified export (`DocumentExport`, `DocumentDestinations`) and isolated
PDF rendering (`IsolatedPdfRenderService`, `IsolatedPdfViewerActivity`, `PdfPageLimits`).
Alpha keeps the installed identities: `DailyApps` method names and the `selected-documents`
registry, `AlphaFiles`' `alpha-files-tree`, the `<package>.mailattachments` provider and its
`mail-attachments` cache path, and the `.IsolatedPdfService` (`:isolated_pdf`) and
`.AlphaMailPdfActivity` components, which are thin subclasses that only add Alpha's colours,
messages and the development-only watchdog fixture.

`AlphaNoteAudioPlugin` is installed-data compatibility, not a second recording engine. Storage,
receipts, owner fences, the two-step trash/restore/purge and the legacy metadata migration are
the shared `RecordingStore` (elizaOS `plugin-native-media`); the renderer settles permanent
deletions with the shared `notes-recording-deletion.ts` and `notes-recording-effects.ts` plan,
and the plugin's native backstop (`finishPermanentDeletions`, `sweepExpiredTrash`) settles the
same receipts through `RecordingStore` while Alpha is closed. What stays in Alpha are the identities an installed phone already holds and
that must keep resolving: the `note-audio` no-backup folder, the `note-audio-metadata:v1:` and
`notes-trash:v1:device` / `notes-records:v1:device` / `notes-audio-deletions:v1:device` slot
names in `AlphaCredentialStore`, the `alpha-notes-trash-backstop` WorkManager name, the
`AlphaNoteAudio` Capacitor name, and `MediaPlayer` playback of a saved clip. Renaming any of
these would orphan existing recordings or their deletion receipts. A shared notes-audio host
would only rename these: no Eliza Android host uses `RecordingStore` for device-local voice
notes today, so the plugin stays as the product's binding to the shared store.

`AlphaReminders` supplies the product's existing encrypted store, preference and
channel names, receiver/Activity identities and intent routes. `DailyApps` keeps
its public Capacitor name and inherits the reminder methods. Reminder test access
lives only in the instrumentation source set; it delegates to the shared engine
rather than keeping a second implementation.

## Changing shared code

1. Implement and test reusable behavior in a dedicated Eliza branch and submit
   a PR against `develop`.
2. Publish a retrievable reviewed revision. Update the submodule and lock
   together; preserve the current source-admission checks.
3. Run `npm run verify` and `npm run android:build` for both distributions.
4. Exercise the changed native/renderer contract, including installed-data and
   identity preservation where relevant.

APK builds, emulator bridge/HOME tests, full AOSP image boot, real integrations,
and physical-device/user acceptance are separate gates. See
[mvp-current-status.md](mvp-current-status.md) for their current limits. A source
pin rollback does not by itself establish APK or OS rollback compatibility.

The AOSP telephony contract additionally requires the canonical production image admission
(`ImageCapability.provisioned`, through `AlphaImageCapabilities`): release launcher, system install
and the product-partition RRO.
The feature XML is an additional telephony contract marker, never an alternative admission path.
Contacts uses AlphaContacts, the shared AOSP-profile address book (`AddressBookPlugin` over
`ContactsCatalog` in plugin-native-contacts) under Alpha's plugin name and image admission, and its
native capability response. The Messages session (foreground-only provider rows, observer, read
marking) and receipt labels are the shared `@elizaos/contracts/native-telephony-session`. On the image the Phone view is admitted
(`prototype/phone-adapter.ts`): recent calls come from the shared profile's bounded, unlocked,
foreground-only `listRecentCalls` (READ_CALL_LOG, launcher manifest only, asked for only from the
owner's control), and every dial, from the view or the agent's reviewed `phone.dial.v1` device action
(`@elizaos/contracts/phone-dial`, advertised only with the profile), is a handoff to the system dial
screen that never reports a call. The dialer role surfaces stay native (shared call screen and dial
pad). The on-device `contacts.lookup.v1` dial target is not negotiated until the review has an owner
number picker. Telephony contact reads recheck permission, unlock and lifecycle state
before and after asynchronous provider reads.

### SMS/MMS on the image (#421)

Text messaging has no account or OAuth grant: identity is the device's active subscriptions and
Android roles. Only the launcher manifest declares `READ_SMS`, `SEND_SMS` and the SMS-role
`RECEIVE_*` permissions (all hard-restricted, so an ordinary sideloaded install cannot hold them)
and the non-exported `AlphaSmsSendReceiver`;
the standalone manifest removes them and `scripts/apk.mjs` checks the packaged permissions per flavor.
`AlphaTelephonyPlugin` adds, behind the same image capability and unlocked-foreground check:

- `listThreads`/`listMessages`: bounded pages (50 rows, 2000 characters per body, 20 addresses) from
  the Telephony SMS, MMS and conversation providers with `READ_SMS`, cancelled and fenced like Contacts.
  IDs are `thread:<row>`, `sms:<row>`, `mms:<row>`. Direction is incoming/outgoing; status is
  received/read or pending/sent/failed/delivered. "delivered" requires the provider's complete delivery
  report and is never claimed for MMS. Drafts and attachment bytes are not read (`SmsRecords`).
- `observeMessages`: a ContentObserver on the SMS, MMS and conversation URIs while Alpha is unlocked in
  the foreground, coalesced to one content-free `messagesChanged` notice per 750 ms; the renderer
  re-reads a bounded page. Pause, lock and screen-off unregister it.
- `sendSms`/`smsSendResult`: a reviewed native send when `status.sendMode` is `direct` (`SEND_SMS` held,
  directly or through the SMS role, and the SIM list readable). Alpha's own native dialog shows the exact
  recipients, SIM, part count and text; conditions are rechecked at the Send decision. The result follows
  the shared `sms.send.v1` contract (elizaOS/eliza#36178): the operation ID is the idempotency key and a
  repeat only reads `SmsSendJournal`; the binding hash covers recipients, text and SIM. The journal is
  written before the first `SmsManager` call (`createForSubscriptionId`, `divideMessage`, one immutable,
  package-explicit sent and delivery PendingIntent per part). "sent" comes only from `RESULT_OK` sent
  callbacks and "delivered" only from delivery reports whose provider row reads complete; an interrupted
  dispatch or callbacks lost to a restart read "unknown". Nothing is ever resent automatically, and the
  body is not stored. The journal keeps 200 records; when full it drops the oldest (closed first) and
  keeps a tombstone of each dropped operation ID, which is then refused rather than sent again; evidence
  is awaited for at most seven days. Otherwise `composeSms` remains the handoff fallback and never reports a send.

Delivery outcome is read from the provider row the platform writes for a non-default SMS app's send
(matched by address, Alpha as creator, a date after the journal entry and body hash), because an
immutable delivery PendingIntent cannot carry the status-report PDU. Each part's report overwrites the
one row of a multipart message, so multipart delivery stays "unknown" and only single-part messages can
read "delivered". Android writes no sent rows for the default SMS app, so while Alpha holds the SMS
role the shared core stores each recipient's text in the provider outbox just before that recipient's
platform call and moves it to sent or failed from its sent callbacks; delivery is not claimed for these
rows. The journal,
provider reads, dispatch and delivery reconciliation described here are the shared
plugin-native-messages implementation (`SmsSendJournal`, `SmsProviderReader`, `SmsTelephony`);
Alpha's earlier copies are deleted. MMS notifications are downloaded and stored by the shared
`MmsWapPushReceiver`/`MmsResultReceiver` only while Alpha holds the SMS role. Outgoing group
messages and pictures are one reviewed MMS (`sendMms`/`mmsSendResult`, the shared `mms.send.v1`
contract): offered only while `status.mmsSend` holds (direct sends, the SMS role and the launcher's
`MmsFileProvider`), shown again in the native dialog with recipients, SIM and picture previews,
journaled before `sendMultimediaMessage`, stored as Alpha's own outbox row and settled from the
carrier's M-Send.conf. MMS delivery is never claimed. JVM and renderer tests cover the journal, mapping and contract;
grants on the image, real provider rows, carrier delivery reports and owned SMS/MMS endpoints remain
image/device qualification for #421.

### Reset and the image listener

Before dispatching Android's package-data clear, a pending Alpha reset asks the
same-signed image listener to erase its consent/settings through its existing
signature-protected control provider. Missing listeners are allowed; an installed
listener with a signer/permission mismatch, failed write, missing provider or
ambiguous acknowledgement keeps the reset marker and stops Alpha until retry.
The listener serializes revocation with consent writes and rejects permission
callbacks whose consent request predates reset. It invalidates queued recognition,
clears its settings durably and
requests microphone-service stop. A successful retry may clear a previous storage
failure, but never grants consent or resumes listening. Device-wide files and
other applications are outside this contract.

Focused JVM tests cover durable revocation, invalidated recognition tickets,
failed-write retry and admission before app initialization. These are source-level
checks; actual microphone release, provider IPC, process interruption and both
image distributions still require native qualification for #409/#424.
Because the reset fails closed, an installed listener that cannot acknowledge it
(signer mismatch, LISTENER_CONTROL not granted, missing provider) keeps every Alpha
main-process launch stopping before initialization. Before stopping, a main process
started for an activity (or for a reason Android does not report; `ApplicationStartInfo`
on API 35+) opens `ResetRecoveryActivity`; one started for a job, alarm, broadcast,
push, provider or bound service stops without taking the screen from the app in front.
The recovery activity runs in its own `:reset_recovery` process, which installs
none of Alpha's content providers (no WorkManager or startup initializers) and starts
no agent, renderer or notification code. It states that the reset has not finished
and Alpha's local data was not deleted, and offers Try reset again (always a fresh
listener-then-Android attempt), the listener's settings, Phone and Android Settings.
Automatic attempts at launch are bounded (three per minute; unreadable attempt state
defers them until the user retries), so Android relaunching HOME no longer repeats
listener IPC silently. The marker and all Alpha data stay until the listener
acknowledges and Android accepts the package clear; a new confirmed reset starts a
fresh budget, and a late failure after Android finished cannot recreate reset state.
Settings > Clear storage is not a recovery path for this state: it would clear Alpha
without revoking listener consent. JVM tests cover the relaunch sequence, recovery-
process admission, bounded attempts, acknowledged-then-refused interruption and
package-scoped clearing; Android actually resuming the recovery task instead of
relaunching HOME, the background-start exemption it relies on, and both image
distributions still require native qualification.
A consent permission request pending while ConsentActivity is recreated
(for example on rotation) is restored only within the same process, so a request made
before a restart can never match the listener's fresh reset generation.

### Shared Pixel 10a source and product

Eliza owns the Pixel 10a/stallion source inventory, strict source verification,
hardware configuration, product composition, Sense listener and SystemUI lease.
Alpha imports these through its reviewed pin. Its thin adapters supply the
installed package/component identities, signing descriptors and explicit build-host
patch envelope. The immutable inventory still binds the `vendor/alphaphone`
AOSP path for both products; that compatibility path is not the launcher brand.

Both Pixel 10a main apps remain nonprivileged. Only the separately admitted
Sense APK receives the two reviewed privileges. Each Sense APK has its own
speech module and packages the complete admitted libelizainference runtime;
the main app's speech module links to its host-owned runtime. This keeps the
separate process independent without duplicate runtime selection in either APK.

Release signing, the version/hash compatibility record, the operator OTA update
client with interrupted-update, fallback and stock-recovery tooling, the system
Clock requirement and the read-only image checks are shared Pixel 10a tooling too.
Alpha keeps their inputs: its release descriptor, update channel, qualification
gates and APK release signer under `android/`.

Source reuse does not transfer image, signing or device qualification. Alpha's
runtime provenance, image capability and listener acceptance gates remain active,
and `releaseQualified` remains false.
