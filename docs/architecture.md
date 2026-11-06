# Architecture and ownership

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
Android builds declare the configured production web host by default.
`ELIZAOS_APP_LINK_HOST`, when supplied, must equal that host. APK verification
requires the exact sign-in return filter. The staging return uses the configured staging web host in test-mocks
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
remains required before shipping it.

Production Notes and vault migration controls are disabled, including their native
entry points. Damaged-data notices retain saved bytes and drafts without backup or
per-store reset controls; fitting Notes edits still recover through the existing
merge path. Explicit test-mocks builds retain migration fixtures. Ordinary Files,
Gmail attachments and PDF file creation remain available.


## Source boundaries

| Path | Responsibility |
| --- | --- |
| `apps/app/src` | Alpha UI, product policy and adapters to shared features |
| `android` | Product identity, Activity, permissions, resources and standalone/HOME packaging |
| `android/sense`, `android/aosp/listener` | AOSP-image-only privileged, network-less always-on listener and its image configuration ([ADR 0001](adr/0001-privileged-listener.md)); never in the standalone or launcher APK |
| `app.config.json` | Package ID, display name, version and orientation |
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

## Chat controls and notices

Chat controls use the remaining native system-bar inset, converted into the scaled
renderer canvas, with space above the navigation buttons. Standalone Android fits
its WebView inside the bars and supplies zero remaining inset. Floating controls,
expanded text input and voice controls share the same clearance; their measured
height bounds top notices, including when a draft grows or the keyboard opens.
Routine saves, toggles and draft restoration stay quiet. Draft conflicts and voice
recovery appear at the top of the chat, while transient errors and Undo appear at
the top of the phone. Modal feedback takes space above the form instead of floating
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

### Eliza Cloud sign-in ownership (in-app, 2026-10-14)

Native sign-in stays on Alpha's own screens. Email remains available when the optional Google
readiness probe fails or times out; its native request reports any service configuration failure.
There is no automatic Eliza Cloud website sign-in fallback.

- **Readiness (`CloudSignInReadiness`, `AlphaCloudSignInPlugin.status`)**: readiness reports email and optional Google separately, checked with a few short requests and cached (6 hours when ready,
  10 minutes when not; any error, timeout or unexpected answer is "not ready"):
  - `GET /api/v1/app-auth/mobile/config` confirms the registration for client
    `ai.elizaresearch.alphaphone`, this environment and the return URL;
  - For Google only, Steward's authorize route redirects to Google for the return URL (the tenant
    redirect allowlist admits it; nothing is followed);
  - For Google only, `/.well-known/assetlinks.json` on the return host grants `handle_all_urls`
    to this package and the certificate this APK is signed with;
  - `GET /steward/auth/providers` offers email without a captcha for `email_otp`, and the email code
    route exists (an empty-object POST is refused as invalid, not as unknown; no email is sent).
  Google is offered on top only when Steward offers it and Android reports the return host verified
  for this package. Opening or retrying sign-in explicitly refreshes readiness rather than
  retaining a failed network probe for ten minutes; concurrent probes are coalesced.
  The renderer waits at most 6 seconds, then offers email alone. A late result cannot
  change the already opened attempt.
- **Native (`AlphaCloudSignInPlugin`, `CloudSignInFlow`, `CloudEmailCode`)** holds the Steward
  session, codes and PKCE verifiers and makes every sign-in request, using fixed URLs on the Cloud API
  origin (`ConnectionRoutes.signInRoute`; the renderer transport admits none of them):
  - Email: the six-digit code endpoints of elizaOS/eliza #36260, kept in one adapter
    (`CloudEmailCode`, `config/cloud-email-code.json`): `POST /steward/auth/email/code/send`, then
    the code typed into Alpha goes to `POST /steward/auth/email/code/verify` with a PKCE verifier.
    No magic link is requested. Five wrong codes end an attempt; one code send a minute per phone.
    A second verification uses `/steward/auth/mfa/{totp,sms}/complete`.
  - Google: Alpha creates a PKCE verifier and state, keeps them in memory and in an encrypted,
    single-use, ten-minute pending record (`cloud-signin:v1:pending`, a native-only slot), and opens
    `{api}/steward/auth/oauth/google/authorize?...&prompt=select_account` in a Custom Tab (never a
    WebView). Steward returns to the verified App Link `https://eliza.app/alphaphone/auth/callback`.
  - Returns follow the shared callback contract
    (`test/fixtures/alphaphone-auth-callback-contract.json`, the same file in elizaOS/eliza):
    success is exactly `{code,state}` in the fragment; an error is exactly `{error,state}` (error
    from a fixed allowlist) in the query or fragment; anything else on the callback, including the
    parameterless hand-off from Cloud's fallback page, carries no result. The state is compared in
    constant time before anything is burned: a mismatching return is ignored and cannot cancel a
    sign-in; the matching return burns the record before the code goes to
    `POST /steward/auth/oauth/exchange`. A return without a result, or coming back from the browser
    without a return, ends the waiting step with a retry message but keeps the record until it
    expires or the owner starts again (or cancels), so a late return still completes.
  - Both paths then run the shared tail. The Steward session goes to
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
  in test-mocks builds only; it is not the native readiness fallback.
- **Cloud (elizaOS/eliza `packages/cloud`, `packages/auth`, `packages/app`)** owns the accounts:
  - Steward links Google and email to the existing user by verified email.
  - Mobile App Auth mints the key, valid for 30 days.
  - For in-app sign-in, Cloud must register `ai.elizaresearch.alphaphone` in
    `ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON`, allowlist the return URL for tenant `elizacloud`, serve
    `/.well-known/assetlinks.json` on `eliza.app` with the release certificate
    (`scripts/render-assetlinks.mjs`), and deploy the email code routes. The APK automatically
    declares the configured return App Link (`eliza.app` by default). `staging.eliza.app`
    serves the same with the debug certificate added.
  - The callback fallback page (`/alphaphone/auth/callback` when Android did not hand the link to
    Alpha) forwards no code: it only brings Alpha forward without parameters.
- **Test-mocks only:** the staging return host (`src/testMocks/AndroidManifest.xml`), the
  development Cloud bridge's email sign-in, and the diagnostic button.

The production signed-out page opens the method choices directly. Setup keeps form labels,
verification destinations and actionable errors; it has no explanatory or collapsible sections.
Native transport failures distinguish DNS, connection, timeout and TLS without exposing
exception text or credentials. See [the October 31 diagnosis](login-setup-troubleshooting.md)
for the installed-build mismatch and the remaining real-service checks.

Third-party web content runs in an isolated native browser surface; it must not
receive the application's Capacitor bridge. Origin, context revision, consent,
sensitive fields and cancellation remain bound to each action. Credentials use
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

Phone, Contacts and SMS exist only on the Alpha AOSP image (decision P-36). The image
capability is decided natively by `AlphaImageCapability`: the launcher build without test
mocks, installed from a system partition (`FLAG_SYSTEM`), with the `<package>.aosp_image`
system feature that `scripts/stage-aosp.mjs` declares in the image product. The launcher
flavor, test mocks, URLs and saved state never establish it. Only then does `MainActivity`
register `AlphaTelephonyPlugin` (read-only contacts through upstream `ContactsReader`, role
and SIM status, dialer and SMS handoffs, SMS/MMS provider reads and reviewed native sends); the
renderer reads its presence from the injected plugin headers (`apps/app/src/runtime/aosp-image.ts`). Standalone APKs declare no contacts or
phone-state permission. Gmail is available in both distributions through Eliza Cloud, with
read access first and one incremental change grant (`apps/app/src/runtime/gmail-grants.ts`).

Native reminders use the shared `plugin-native-reminders` engine and bridge.
The Clock hand-off contract is Alpha's: `apps/app/src/runtime/clock-contract.ts` owns the
operation and result shapes and the validation of an agent's request, and
`ClockHandoff.java` builds the Android Clock intents from it. Upstream offers
`clock.handoff.v1`, `clock.handoff.v2` (repeat days) and `clock.alarms.v1` (alarms owned by
the host app) in `packages/agent/src/api/device-action-routes.ts` at the pin. Alpha
advertises `clock.handoff.v1`, adds `clock.handoff.v2` only on Android when the agent offers
it and the native surface reports `clockRepeatDaysVersion` of at least 1, and never
advertises `clock.alarms.v1`, because Alpha does not own alarms (A-11). Alpha's one
restriction on top of upstream's shape, that a repeat-days list is never empty, is stated
in `clock-contract.ts`.

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
(`AlphaImageCapabilities`): release launcher, system install and the product-partition RRO.
The feature XML is an additional telephony contract marker, never an alternative admission path.
Contacts uses the bounded AlphaContacts adapter and its native capability response; Phone and SMS
views remain deferred. Telephony contact reads recheck permission, unlock and lifecycle state
before and after asynchronous provider reads.

### SMS/MMS on the image (#421)

Text messaging has no account or OAuth grant: identity is the device's active subscriptions and
Android roles. Only the launcher manifest declares `READ_SMS` and `SEND_SMS` (both hard-restricted,
so an ordinary sideloaded install cannot hold them) and the non-exported `AlphaSmsSendReceiver`;
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
read "delivered". The Messages
view, agent `sms_send` proposals and the `sms.send.v1` device capability stay unavailable until the
shared contract is in the reviewed pin. JVM and renderer tests cover the journal, mapping and contract;
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
