# Native Google sign-in deployment

Alpha renders its own Cloud sign-in screen. Google account authorization uses the
provider's Custom Tab and returns to Alpha through a verified App Link; it must
not open the hosted Eliza login page. Email codes stay in Alpha and do not depend
on Google redirect or App Link readiness.

## Build and server requirements

Production Android variants declare the configured production web host by default:

```sh
npm run android:build:local
```

`ELIZAOS_APP_LINK_HOST`, when supplied, must equal the configured production web host.
`android/app/product.gradle` deliberately writes a `${appLinkHost}` manifest
placeholder; Android manifest merging resolves it from `manifestPlaceholders`.
Inspect the final APK manifest, not only the generated overlay. Both distributions
must declare HTTPS host `eliza.app` and exact path `/alphaphone/auth/callback`.
The same host also receives the Google connector delegation return filter.

Alpha selects `googleSignInMode("browser")` in the shared native auth client. An installed
external browser must offer Android Custom Tabs; the image's WebView shell is insufficient.
This supports AOSP without Google Play services. PKCE, the pending state, code exchange,
MFA and credential writes stay in the native client. A cancelled, expired or superseded
attempt cannot commit a credential. A process restart during browser sign-in requires a
fresh explicit attempt rather than granting the old return new credential authority.
The pinned shared source is unchanged; the reviewed patch and source hashes are in
`patches/eliza/native-manifest.json`.

The Cloud and Steward deployments must independently satisfy all of these:

- Mobile App Auth registers `ai.elizaresearch.alphaphone`, environment
  `production`, callback `https://eliza.app/alphaphone/auth/callback`, and S256.
  The registered app must be active and approved.
- Steward tenant `elizacloud` includes that exact callback in
  `allowedRedirectUrls`. A global redirect allowlist is insufficient because the
  request explicitly selects the tenant.
- `https://eliza.app/.well-known/assetlinks.json` serves an Android App Links grant
  for this package and the actual installed signing certificate. The API host's
  copy alone is insufficient. Release signing remains governed by
  `android/release-signer.json`; never claim a development signer is a release.
- Android verifies the host for the installed package. Read back with
  `adb shell pm get-app-links ai.elizaresearch.alphaphone`. Do not force a verified
  state through ADB to bypass server association failures.

Cloud's upstream operator configuration is documented in
`vendor/eliza/packages/cloud/api/README.md` under **Alpha Phone in-app sign-in**.
Do not edit the pinned vendor checkout to change deployed configuration.

## Credential-free observations, October 24, 2026

Fresh host probes used the exact authorize parameters from `CloudSignInFlow`
with a fresh random state and S256 challenge. Redirects were not followed, no
Google account was selected, and no credentials or authorization codes were used.

| Check | Observation | Meaning |
| --- | --- | --- |
| Callback-host and API-host asset links | HTTP 200; Alpha package grant for fingerprint `22:42:99:4D:2D:23:7F:98:D0:19:27:99:91:57:06:7D:F4:E2:49:5A:8F:98:04:51:AC:3D:E5:D4:06:42:58:4A` | The public association now matches the installed development signer; supersedes the October 23 HTTP 404 observation |
| Steward providers for `elizacloud` | HTTP 200, Google and email offered | Provider advertisement alone does not establish redirect admission |
| Steward Google authorize with Alpha callback | HTTP 400, `redirect_uri is not allowed for this tenant` | Tenant callback registration still blocks Google before provider authorization |
| Version 7 `pm get-app-links` | No domain entries | This installed build did not declare the needed HTTPS filter |

The app build can fix its missing filter. Tenant registration and active mobile
app admission require the corresponding deployed configuration to be repaired.
Passing these probes still does not prove provider login, callback interception,
MFA, mobile credential exchange, account binding or session persistence. Verify
those through an explicitly initiated sign-in on the physical device.

## Credential-free probe, October 27, 2026

`node scripts/cloud-readiness.mjs probe` (and `--environment staging`) repeats these
observations with the requests the phone makes, once each, and names the owning step in
[human actions](human-actions.md). Recorded in
[cloud-readiness-2026-10-27.json](evidence/cloud-readiness-2026-10-27.json):

| Gate | Production | Staging |
| --- | --- | --- |
| Mobile App Auth registration for `ai.elizaresearch.alphaphone`, S256 | Passed (the October 24 503 is resolved) | Passed |
| Email sign-in (offered without a captcha, code route present) | Passed | Passed |
| Native Google (`googleNative` advertised) | Passed | Not advertised: no `STEWARD_GOOGLE_NATIVE_CLIENT_IDS` client for the staging app client |
| Tenant allowlist admits the return URL | Passed (the October 24 400 is resolved) | Passed |
| `assetlinks.json` grants the release certificate | No release certificate is enrolled; two other certificates are listed | One certificate is listed (staging serves debug-signed test-mocks builds) |
| Hosted callback page, service documents, entitlement keys | Passed | Passed |
| Maps and Google connector routes | Not checkable without an account | Not checkable without an account |

At the time of this historical probe, native Google on a release-signed build needed an Android OAuth client for the release
certificate's SHA-1 under `alpha-phone` in `STEWARD_GOOGLE_NATIVE_CLIENT_IDS` (H-12), and the
release fingerprint in `ELIZA_ANDROID_ASSET_LINKS_JSON` (H-13). Cloud's global auth gate
answers every protected `/api/` path that carries no credential with 401 before routing, so an
unauthenticated request cannot show whether the Maps or Google connector routes are deployed;
the probe lists them without requesting them. These probes are deployment configuration
evidence only: no account signed in and nothing was verified on a device.
