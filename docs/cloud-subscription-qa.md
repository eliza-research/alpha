# Eliza Cloud sign-in and plan gate: staging QA

Owner requirement (October 2026): every Alpha Phone signs in to Eliza Cloud and holds a plan; a
subscription code grants six months. The phone's behaviour is specified in
[eliza-cloud-subscription-entitlement-contract.md](eliza-cloud-subscription-entitlement-contract.md);
the Cloud side is elizaOS/eliza PR #36125. This page lists the commands for an end-to-end run
against the staging Cloud. Nothing on this page has been run against a real account yet.

## What the staging mechanism is

Staging is reachable only in **test-mocks builds** (`ELIZA_DEV_ALLOW_TEST_MOCKS=1`), the repo's
existing staging switch. Distribution builds fold the staging authority away, and
`scripts/audit-production-bundle.mjs` refuses `api-staging.eliza.app`, `cloud-staging` and the QA
surface strings in a production bundle.

In a test-mocks build, **Subscription gate QA** runs the production sign-in and plan gate (not
the development chooser) against the environment you pick:

| | Staging | Production (test-mocks build) |
|---|---|---|
| API and entitlement issuer | `https://api-staging.eliza.app` | `https://api.eliza.app` |
| Sign-in (once ready) | In-app: email code, or Google in a Custom Tab via `https://api-staging.eliza.app/steward/auth/oauth/google/authorize` | In-app: email code, or Google via `https://api.eliza.app/steward/auth/oauth/google/authorize` |
| Google return (verified App Link) | `https://staging.eliza.app/alphaphone/auth/callback` (test-mocks manifest only) | `https://eliza.app/alphaphone/auth/callback` |
| Key | `eliza_mobile_` from `/api/v1/app-auth/mobile/token`, environment `staging`, client `ai.elizaresearch.alphaphone` | same, environment `production` |
| Hand-off (until the readiness probe passes; afterwards the **Browser sign-in (diagnostic)** button) | `https://staging.eliza.app/auth/cli-login` | `https://eliza.app/auth/cli-login` |
| Choose a plan | `https://cloud-staging.eliza.app/cloud/billing` | `https://cloud.eliza.app/cloud/billing` |
| Secure slot | `cloud:staging` | `cloud:production` |
| After plan admission | Stops with "Plan admitted on staging (subscription gate QA)". The agent is not started: the native resident inference binding reads only `cloud:production`. | Android: binds the resident agent to Cloud inference and starts it, as in a distribution build. Browser: stops after admission. |

The hosts are the repo's configured authorities (`apps/app/src/runtime/cloud-protocol.ts`); that
the staging deployment serves PR #36125 with its entitlement signing keys and grant-code pepper set
is not verified here.

## Staging APK (test-mocks)

Inputs as in the README (pinned `vendor/eliza`, speech AAR, embedding host libraries).
`npm run android:build:inputs` lists anything missing.

```sh
npm ci
node scripts/android-build-preflight.mjs --before-prepare
npm run agent:build-embedding-host
npm run agent:prepare
npm run agent:build-workflow-worker
npm run agent:stage-android
npm run licenses:packaged-runtime
npm run android:build -- --test-mocks      # writes only artifacts/test-mocks/
npm run android:verify                       # distribution APKs, if built in the same tree
adb install -r artifacts/test-mocks/standalone-debug.apk
# or the Home-role variant:
adb install -r artifacts/test-mocks/launcher-debug.apk
```

`npm run android:build:local` runs the same preparation but always ends in a distribution
(flag-off) build, which cannot reach staging; use the sequence above for the QA APK. Never
install a test-mocks APK on a real user's phone.

Google sign-in needs the App Link to be verified for the installed signer. Staging's
`/.well-known/assetlinks.json` lists the debug and release certificates. For another debug keystore,
approve the host by hand:

```sh
adb shell pm set-app-links-user-selection --user cur --package ai.elizaresearch.alphaphone true staging.eliza.app
adb shell pm get-app-links ai.elizaresearch.alphaphone     # shows the verification state per host
```

Email code sign-in does not depend on the App Link, but the readiness probe does: Alpha offers its
in-app screens only after Cloud reports the client registration, the redirect allowlist admits the
return URL, and the return host's `assetlinks.json` lists this APK's package and signing certificate.
Until then the **Sign in** screen shows "Waiting for connection" and checks again by itself. The answer is
cached (6 hours when ready, 10 minutes when not); clearing Alpha's app data resets it.

On the phone: **Settings › Agent connection › Subscription gate QA**, choose **Staging**, then
**Start subscription gate QA**. The app reloads into the gate. **Leave subscription gate QA** at
the bottom of the gate returns to the development chooser.

## Dev UI against staging (browser)

```sh
npm run dev:ui                    # http://127.0.0.1:5317, test mocks on
```

Open `http://127.0.0.1:5317/`, then **Settings › Agent connection › Subscription gate QA ›
Staging › Start subscription gate QA**. Cloud requests go through the development Cloud bridge
(`scripts/browser-cloud-dev-bridge.ts`), which keeps the staging sign-in key on the Mac in
`$ALPHA_BROWSER_CLOUD_PROFILE` (default `~/.local/share/alphaphone/browser-cloud`) and never in
the browser. The bridge runs the in-app email-code sign-in itself (Steward email send and verify,
mobile App Auth connect, token and ack); the page receives only the outcome and a reference.
Google needs the phone's App Link, so the browser offers email only. The bridge also admits the
plan routes (identity, entitlement and keys, billing snapshot, code redemption). The browser run
stops after plan admission.

## End-to-end checklist

Run each on a fresh install (or after **Reset Alpha data**) and record the build, environment and
result. Use a staging account and staging codes minted with
`packages/cloud/scripts/admin/mint-subscription-grant-codes.ts` against the staging database; do
not reuse production codes.

1. First run shows **Sign in** (**Continue with Google**, then one email-or-phone field with
   **Continue**); Back/Escape do not dismiss it.
2. Sign in on Alpha's own **Sign in** screen. No Eliza Cloud web page opens.
   Check each row and record the result:

   | Case | Expected |
   |---|---|
   | Email: valid address, **Continue** | **Check your email** names the address. **Resend code** stays disabled for 60 s. |
   | Email: wrong code | "That code didn’t work. Check it, or resend."; the field is cleared; the step stays. |
   | Email: right code | The sixth digit submits it (there is no Verify button); signed in; the plan gate continues below. |
   | Account with an authenticator app or SMS second step | **Enter your verification code** screen; the right code signs in. |
   | **Continue with Google** | A Custom Tab shows Google's own page (not Eliza's). After consent it returns straight to Alpha and signs in. |
   | Google: close the tab without finishing | No message; Alpha stays on **Sign in**; nothing is stored. |
   | **Cancel sign-in** while waiting | Back to the choice screen; the pending attempt is burned; nothing is stored. |
   | A second sign-in while one runs | Refused ("already in progress"). |
   | A brand-new email or Google account | Signed in, and the account panel says "Signed in. Eliza Cloud created a new account for this sign-in." |
   | Existing account (e.g. the owner's) via Google and via email | Same Cloud user and organization both ways; no "new account" notice. |
   | Airplane mode, then **Continue** | The button reads "Waiting for connection" (no error); the step is sent once the network returns; nothing is stored before then. |
   | Reopen an old return link (copied from history) | Ignored; nothing is stored. |

   With no plan, the gate shows **Choose a plan** with Redeem code, Choose a plan and
   Check plan again; the agent does not start.
3. Redeem an invalid code: one generic answer. Redeem more than five times in 15 minutes: "Too
   many attempts. Try again in …" with Cloud's retry time.
4. Redeem a valid code: "Code redeemed for … It runs until …"; the plan is checked again and the
   gate admits (staging: the QA admission message; production: the agent starts).
5. Redeem the same code again on the same account: "already received" (no second grant).
6. **Choose a plan** opens exactly the billing page above in the system browser; returning to the
   app checks the plan again.
7. Settings › **Eliza Cloud account & plan** shows the account, plan, plan end, sign-in expiry,
   Redeem code, Manage plan and Sign out.
8. Revoke the grant with `revoke-subscription-grants.ts`; on the next return to the app or
   refresh, Cloud AI is unbound, the agent keeps running, and the plan notice offers **Redeem
   code** / **Choose a plan** (the plan panel shows **Choose a plan** or **Your plan has ended**).
   A chat message then gets the agent's honest "AI replies need an Eliza Cloud plan" answer.
9. Airplane mode after a successful admission, then relaunch: the agent runs, a closable "Eliza
   Cloud cannot be reached" notice is shown and the stored binding is kept. Airplane mode on a
   never-admitted sign-in: the agent runs without Cloud AI and the same notice is shown.
10. **Reset Alpha data**: the local reset completes; the old key no longer authenticates
    (`GET /api/v1/user` with it returns 401) when Cloud was reachable.
11. Sign-in key expiry warning: shown within 14 days of the key's `expiresAt` (in-app sign-in
    keys last 30 days) as "Sign-in expires {date}."; **Sign in again** opens the in-app sign-in screen.

## Automated coverage (no real account)

- `test/browser/native-cloud-subscription.spec.ts`: first-run gate, legacy local-only migration,
  every plan state, billing snapshot fallback, outage and offline grace, redeem success, invalid,
  rate-limited, already redeemed and transport replay, plan panel and Settings data, sign-in
  expiry warning (flag-off Android composition, synthetic native ports and ES256 tokens).
- `scripts/test-cloud-subscription.mjs`, `test/subscription-entitlement.test.mjs`: protocol and
  presentation; `test/connection-routes.test.mjs` with `test/fixtures/ConnectionRoutesTest.java`:
  native allowlist, reset revocation target, direct-provider gating.
- `test/browser/native-cloud-signin.spec.ts`: in-app sign-in screens on the flag-off Android
  composition:
  - email code with a wrong code and the resend cooldown;
  - Google;
  - the account-created notice;
  - cancellation, which burns the pending attempt;
  - a second verification step;
  - offline.

  The native sign-in host is synthetic.
- `test/cloud-sign-in-flow.test.mjs` with `test/fixtures/CloudSignInFlowTest.java`:
  - PKCE and state;
  - the exact authorize URL;
  - strict App Link return validation (host, path, port, userinfo, query and fragment,
    duplicated or extra parameters, unknown or expired state);
  - the pending record;
  - the ack retry policy and the route allowlist;
  - source checks: store before ack, pending burned before exchange, nothing logged, legacy flow
    gated.
- `scripts/test-cloud-protocol.mjs`, `test/browser-cloud-dev-bridge.test.mjs`: renderer sign-in
  contract and the development bridge's email sign-in.
- `CloudSignInCallbackInstrumentedTest` (emulator, `-e cloudSignInNative 1`):
  - the return link resolves only to MainActivity;
  - a mismatching or expired return burns the pending record and stores nothing.
- Production lane specs (`*.production.spec.ts`) run the flag-off bundle.

These are an APK-independent renderer and JVM check. They are not an emulator, device, staging or
real-account result. Keep these evidence levels separate:

- an APK build;
- emulator App Link verification (`adb shell pm get-app-links ai.elizaresearch.alphaphone` shows
  `verified` for `eliza.app` only once Cloud serves assetlinks for the installed signer);
- an AOSP image;
- the owner's real-account acceptance on a device.

None of them proves another.
