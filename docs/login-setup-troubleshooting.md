# Login/setup diagnosis — October 31, 2026

Read-only checks of the attached Pixel 10a found installed version
`0.1.0-cloud-554962c-v12` (version code 12). Its public APK code uses
`https://api.eliza.app` and `https://eliza.app`, but its manifest declares only
`alphacompute.ai` for the HTTPS authentication return. Android reports that host
as verified. Native Google readiness checks `eliza.app`, so Google cannot be
offered on that installed build. No app was installed, no account was opened,
and no code or message was sent during this diagnosis.

The phone had validated Wi-Fi, resolved `api.eliza.app`, and reached its TCP port
443. The reported “Alpha could not reach Eliza Cloud” message maps to a native
DNS, connection-refused or no-route exception. No corresponding exception was
retained in the inspected app logs, so the original connection failure is not
attributed to the App Link mismatch. Successful DNS/TCP checks do not establish
successful HTTPS authentication. Workstation public HTTP checks separately
returned Cloudflare 403/1010 (`browser_signature_banned`); these were not retried
or bypassed and do not establish the phone's HTTP response.

This change makes normal Android builds declare the configured Cloud callback
host automatically and requires its exact sign-in return in APK verification.
Mismatched overrides still fail; Android and the provider's certificate binding
must still verify the link. Opening or retrying sign-in refreshes cached provider
readiness. Native failures now distinguish DNS, connection, timeout and TLS with
short recovery instructions and no raw network details.

Google, email and text-message choices remain gated by the native host's actual
provider readiness. The browser development bridge offers email only. Simulated
provider tests are not real sign-in acceptance: Google needs a verified return
for the installed signer; email and SMS need a successful code delivery,
verification, mobile-key exchange and resident binding against the real service.
The installed v12 app remains unchanged by these source fixes.

## Build limits

`npm run android:build:local` reached resident preparation, then stopped in the
pinned `@elizaos/plugin-elizacloud` build: its default-condition Node import could
not resolve `dist/lib/config-env`. The vendor checkout was not edited. The plain
`npm run android:build` then stopped at preflight because the previously staged
resident payload does not match the current prepared source. No new standalone
or launcher APK was produced.

`npm run android:verify` inspected all four existing standalone/launcher debug
and release APKs. All four failed native-patch provenance against this checkout.
Those older files are not validation of this change. New APKs, verified App
Links, real provider sign-in and device acceptance remain separate checks.

## Source validation — November 1, 2026

- 44 production browser cases passed for the sign-in gate, first run, saved
  credentials and startup recovery. The separate native-port simulation passed
  24 sign-in cases, including Google, email, SMS, unknown readiness and network
  failure recovery. These are synthetic integrations, not real authentication.
- 23 focused sign-in/network/App Link unit checks passed. TypeScript checking,
  the production web build, production bundle audit and `git diff --check` passed.
- The full repository verification was run. After supplying the installed JDK 21
  path, it reported 1,845 passing, two failing and five skipped tests. The Calendar
  failure was a SIGKILL of its `git status` subprocess and passed on isolated
  rerun. The other failure was the native voice latency source assertion; separate
  edits to `AlphaVoiceCloudPlugin.java` appeared during this task and were retained.
  Full-workspace verification is therefore not recorded as passing.
