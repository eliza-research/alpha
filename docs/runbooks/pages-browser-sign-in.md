# Alpha browser sign-in registration

The November 10 owner decision selects `ai.alphacompute.alphaphone` and keeps the
callback URLs in the table below. The public Cloud configuration still rejects
this client, while those URLs belong to the prior client. Do not append a duplicate
callback or change the URL to make registration pass.

The operator must prepare a targeted registry migration. Retain the protected app
UUID, callback, credential lifetime, array order and every unrelated entry. Change
only the selected client ID and its Pages Android package. Preserve the Pages
browser sign-in fields and Grace's registration. Add the release certificate for
the new package to App Links; retain existing associations during review.

Before retiring the previous client, check its unexpired grants, usable or
recoverable credentials, attribution anomalies and in-flight issuance. A zero-count
snapshot alone cannot prevent a concurrent old-client request. The current admin
helper does not provide that issuance fence. Stop if safe retirement is unverified;
do not relabel grant identities or revoke credentials automatically.

The read-only production [owner comparison](https://github.com/elizaOS/eliza/actions/runs/42857226920)
passed. The staging [comparison](https://github.com/elizaOS/eliza/actions/runs/42857233149)
stopped before database checks because a protected organization or owner UUID is
missing or invalid. Resolve that configuration through its owner. Neither run
changed registrations, counted active use or verified live Worker secret values.
After migration, require anonymous client/config, callback and certificate readback,
then genuine sign-in from the exact signed APK.

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
| Android package | `ai.alphacompute.alphaphone` | `ai.alphacompute.alphaphone` |
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
