# Alpha browser sign-in registration

Alpha owns the package, callback paths and browser return namespace. The shared
Pages handler accepts an optional `browserSignIn` object on a protected native
callback registration. A registration without that object has no browser-start
route. This file describes public configuration preparation; it does not record
a deployment or successful sign-in.

`scripts/cloud-deployment-policy.mjs` declares the installed paths and the
production/staging API origins and tenant IDs. Run:

```sh
node scripts/cloud-deployment.mjs
node scripts/cloud-deployment.mjs --check
node scripts/cloud-readiness.mjs registration --environment production --json
node scripts/cloud-readiness.mjs registration --environment staging --json
```

The generated `config/pages-native-auth-callbacks.generated.json` contains one
array for each Pages environment. It is public data, with no credentials. An
operator merges the corresponding array's Alpha entry into that environment's
protected `ELIZA_NATIVE_AUTH_CALLBACKS_JSON`, preserving other applications'
entries, and deploys the reviewed shared Pages handler. Do not use this file as a
replacement for the full multi-application registry or configure production with
the staging entry. No command above changes a deployed environment.

The registration preserves:

| Input | Production | Staging |
| --- | --- | --- |
| Callback | `https://eliza.app/alphaphone/auth/callback` | `https://staging.eliza.app/alphaphone/auth/callback` |
| Android package | `ai.elizaresearch.alphaphone` | `ai.elizaresearch.alphaphone` |
| Browser start path | `/alphaphone/auth/browser-start` | `/alphaphone/auth/browser-start` |
| Loopback return path | `/__alpha-browser-cloud/signin-return` | `/__alpha-browser-cloud/signin-return` |
| Session storage key | `alpha-browser-sign-in:v1` | `alpha-browser-sign-in:v1` |
| API origin | `https://api.eliza.app` | `https://api-staging.eliza.app` |
| Tenant | `elizacloud` | `elizacloud-staging` |

The configuration selects a fixed callback and OAuth authority; a browser request
cannot supply either. Keep the shared same-tab pending state, short expiry,
loopback-origin/port checks, exact state and S256 PKCE binding, bounded form and
response parsing, fragment-only code return, URL scrubbing and nonce/hash CSP.
The Android fallback does not forward an authorization code into an unverified
app intent. Invalid registry data must fail closed. Native App Auth approval,
Steward redirect registration and release-certificate App Links remain separate
requirements in [the App Links runbook](670-app-links-assetlinks.md).

After deployment, check the approved callback page and browser-start route in
each configured environment, then exercise sign-in, expired/mismatched state,
cancellation and account switching using the actual consumer. A generated file,
passing fixture or unauthenticated readiness probe does not prove owner sign-in
or installed-device acceptance.
