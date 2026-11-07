# #669 Release-signed native Google sign-in client in Steward (H-12)

Owner prep, 2026-10-28. Prerequisite: release identities enrolled (key ceremony, H-08/H-09). None is
enrolled today (`android/release-signer.json` `signerSha256` is `"unset"`), so the release SHA-1 does
not exist yet. Nothing here creates an OAuth client, changes Steward or signs anything in.

## What was prepared

| File | Purpose |
| --- | --- |
| [`scripts/owner/google-native-client.mjs`](../../scripts/owner/google-native-client.mjs) | After enrollment: from the public `alphaphone_app.x509.pem`, checks it is the enrolled certificate (SHA-256 equals `signerSha256`), not a debug certificate, prints its SHA-1, and compares the SHA-1 configured on the Google Android OAuth client and the `STEWARD_GOOGLE_NATIVE_CLIENT_IDS` value. Public data only |
| [`test/owner-google-native-client.test.mjs`](../../test/owner-google-native-client.test.mjs) | Tests with a throwaway self-signed certificate |

Why a certificate is needed: `android/release-signer.json` stores only the SHA-256, and a SHA-1 cannot
be derived from it. `node scripts/enroll-release-keys.mjs --fingerprints ... --certificates DIR`
prints the SHA-1 once; nothing committed records it. Record it in the H-12 evidence below.

## Read-only findings (2026-10-28)

`node scripts/cloud-readiness.mjs registration` and `probe` (both environments, unauthenticated):

| Gate | Production (`elizacloud`) | Staging (`elizacloud-staging`) |
| --- | --- | --- |
| email sign-in | pass (email offered without captcha; code route present) | pass |
| native Google | pass: `googleNative` advertised | **FAIL**: not advertised (no Android client for any app client of this tenant) |
| browser return | pass: allowlist admits `https://eliza.app/alphaphone/auth/callback` | pass: admits `https://staging.eliza.app/alphaphone/auth/callback` |

Production advertises `googleNative`, but per H-12 the Android clients behind it predate any release
key, so they are bound to a non-release certificate SHA-1 (which one is not visible without
operator access). A release-signed build will therefore be refused by Google until a client for the
release SHA-1 exists, even though the probe passes. The probe cannot see which SHA-1 a client uses.

Steward values (from `registration`): app client `alpha-phone`; package `ai.elizaresearch.alphaphone`;
callbacks above; tenants `elizacloud` / `elizacloud-staging`.

## Operator runbook: Android OAuth client and `STEWARD_GOOGLE_NATIVE_CLIENT_IDS`

Who: Cloud operator with access to the Google Cloud project holding Steward's Google **web** client
(the audience Steward verifies), and Steward deployment/tenant admin.

1. After H-09, get the release SHA-1:
   `node scripts/enroll-release-keys.mjs --fingerprints CEREMONY/fingerprints.json --certificates CEREMONY`
   (dry run prints "SHA-1 for the Google Android OAuth client"), or
   `node scripts/owner/google-native-client.mjs --certificate CEREMONY/alphaphone_app.x509.pem`.
   The certificate is public; the private key is never needed or read.
2. In that Google Cloud project: APIs and Services, Credentials, Create credentials, OAuth client ID,
   type **Android**; package name `ai.elizaresearch.alphaphone`; SHA-1 certificate fingerprint = the
   release SHA-1. Use the same project as the web client, or Google issues tokens whose audience
   Steward does not accept.
3. Note the new client ID (`NNN-xxxx.apps.googleusercontent.com`, a public identifier).
4. Merge it into `STEWARD_GOOGLE_NATIVE_CLIENT_IDS` under `alpha-phone`, keeping every other app
   client's keys, for example `{"alpha-phone": ["<release client id>", "<existing ids to keep, if any>"], ...}`.
   Whether to keep the pre-release clients is the decision below.
5. Confirm tenant app client `alpha-phone` allows Google; keep the redirect allowlists (both admit
   Alpha's return URL today) and the email and code routes.
6. Deploy Steward; then check:
   `node scripts/owner/google-native-client.mjs --certificate CEREMONY/alphaphone_app.x509.pem --configured-sha1 <SHA-1 shown on the Android client> --client-id <client id> --steward-client-ids <file holding the STEWARD_GOOGLE_NATIVE_CLIENT_IDS JSON>`
   (exit 0), and `node scripts/cloud-readiness.mjs probe` (email sign-in, native Google and browser
   return gates pass).
7. Staging (optional, decision 2): add an Android client for the **debug** signer that signs test-mocks
   builds (SHA-1 from `apksigner verify --print-certs` on that APK, or `keytool -list -v` of the debug
   keystore run by the developer) to the staging Steward under `alpha-phone`. Never add a debug client
   to production.

## Decisions for the owner

| Question | Options | Default / recommendation | What each choice changes |
| --- | --- | --- | --- |
| 1. Keep the pre-release Android clients in production `alpha-phone`? | A. Remove them once the release client works. B. Keep them. | **A** (H-12 says the existing clients predate any release key) | A: only release-signed builds can use native Google in production; developer-signed builds fall back to email. B: any build signed by those older certificates can obtain Google sign-in for Alpha's package in production. |
| 2. Enable native Google on staging? | A. Add a debug-signer Android client to staging. B. Leave staging email-only. | Documented as optional ("if staging Google sign-in is wanted") | A: test-mocks builds can exercise Continue with Google against staging; the staging `native Google` gate passes. B: staging stays at FAIL for that gate, which is expected and harmless. |

## Device acceptance checklist (real-integration evidence, recorded separately)

Only on a **release-signed** build (signer equals `android/release-signer.json`) built with
`ELIZAOS_APP_LINK_HOST=eliza.app`, installed on a test phone with a Google test account (H-27):

- [ ] `apksigner verify --print-certs` on the installed APK shows the release SHA-256.
- [ ] Probe gates email sign-in, native Google and browser return pass on the same day.
- [ ] Continue with Google shows the native account chooser (not the hosted Eliza login page).
- [ ] Choosing the test account returns to Alpha signed in; the account and plan appear.
- [ ] Sign out, then sign in with Google again: works without a stale session.
- [ ] Cancel in the chooser: Alpha stays signed out with a clear message, no hosted fallback page.
- [ ] Email code sign-in still works on the same build.
- [ ] Record date, build versionCode, device model, Android version and outcomes (no account
      identifiers, tokens or codes) as device evidence; it is not proof for staging or other builds.

## Exact remaining human steps

1. H-08/H-09: run the key ceremony and enroll (prerequisite, key custody issue).
2. Operator: steps 1-6 of the runbook above for production; step 7 for staging if decision 2 is A.
3. Owner: decisions 1 and 2.
4. Tester: the device acceptance checklist on a release-signed build.

## Draft decision entries

- **P-NN — H-12 (#669):** Production Steward `STEWARD_GOOGLE_NATIVE_CLIENT_IDS.alpha-phone` lists only
  the Android OAuth client for package `ai.elizaresearch.alphaphone` and the release certificate
  SHA-1 `<SHA-1>` (option 1A). Staging native Google: `<enabled with a debug-signer client | email only>`.
  Policy, not evidence.
