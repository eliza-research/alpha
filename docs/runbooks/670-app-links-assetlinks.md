# #670 App Links `assetlinks.json` entry for the enrolled release certificate on eliza.app (H-13)

Owner prep, 2026-10-28. Prerequisite: release identities enrolled (H-09); none is enrolled yet.
Only the Cloud operator can change `ELIZA_ANDROID_ASSET_LINKS_JSON`. Nothing was published here.

## What was prepared

| File | Purpose |
| --- | --- |
| [`scripts/owner/app-links-evidence.mjs`](../../scripts/owner/app-links-evidence.mjs) | Reads a saved `adb shell pm get-app-links ai.elizaresearch.alphaphone` output; passes only for `eliza.app: verified` and an installed signature equal to the enrolled release certificate (`approved` is an override, not server verification) |
| [`test/owner-app-links-evidence.test.mjs`](../../test/owner-app-links-evidence.test.mjs) | Synthetic `pm get-app-links` samples |
| Evidence template | Below |

## Read-only findings (2026-10-28)

`node scripts/render-assetlinks.mjs --check https://eliza.app/.well-known/assetlinks.json` **exits 1**:
`android/release-signer.json signerSha256 is "unset"`. The published document (HTTP 200,
`application/json`, no redirect) holds exactly one statement, for `ai.elizaresearch.alphaphone`,
`delegate_permission/common.handle_all_urls`, with two fingerprints:

| Fingerprint (SHA-256) | What this repository knows about it |
| --- | --- |
| `22:42:99:4D:2D:23:7F:98:D0:19:27:99:91:57:06:7D:F4:E2:49:5A:8F:98:04:51:AC:3D:E5:D4:06:42:58:4A` | The **debug signer** of this project's development builds (`debugSignerSha256` in `docs/evidence/merge-build-*.json`, "unscoped legacy signer"); published by 2026-10-24, when it was observed to match an installed development build (`docs/native-google-sign-in-deployment.md`) |
| `ED:BF:CA:CB:1D:A6:89:00:8B:F4:E7:D6:75:17:6C:30:2D:EC:F8:31:61:A8:77:EB:8B:1D:E4:FF:AE:04:45:ED` | The `signer` of candidate resident artifacts in `docs/security/resident-artifact-review-*-2026-10-25.json`; not a release certificate |

Staging (`https://staging.eliza.app/.well-known/assetlinks.json`) lists one certificate,
`B1:DE:6A:3E:D3:00:39:95:74:80:7F:0C:6F:63:C0:21:2B:62:63:E7:EC:28:AE:A2:25:3C:EB:20:B1:70:F4:7E`,
which appears in no other record in this repository (presumably the operator's test-mocks debug signer).

Implication: production `eliza.app` today verifies Alpha's package for a **debug** certificate. Any
APK with package `ai.elizaresearch.alphaphone` signed by that debug key gets verified handling of
`https://eliza.app/alphaphone/auth/callback` (and the delegation filter) on a phone where the real
app is not installed. PKCE limits what an intercepted authorization code is worth, but production
should list only the release certificate (decision 1).

Other prepared checks:

- `npm run human:status` reports H-13 `external` with the Verify line ("the `--check` command
  exits 0, then `adb shell pm get-app-links ...` reports `eliza.app` verified on an installed release
  build"); H-09 `open` (12 of 12 release digests unset); H-10 `open` with
  "ELIZAOS_APP_LINK_HOST unset" for this environment.
- `ELIZAOS_APP_LINK_HOST` for release: `android/app/product.gradle` emits the HTTPS autoVerify filter
  only when it is set, and refuses any value other than `config/cloud-deployment.json`
  `production.web` (`eliza.app`). **Nothing requires it on a release:** `scripts/verify-apks.mjs`
  records `appLinks` per APK but does not include it in `distributable`, so a release-signed APK built
  without `ELIZAOS_APP_LINK_HOST=eliza.app` would be marked distributable and would have no verified
  return. Check the `appLinks` row (`present: true`, hosts `["eliza.app"]`) of every release in
  `artifacts/apk-manifest.json` before distribution (see decision 2).
- Hosted fallback page `https://eliza.app/alphaphone/auth/callback` answers 200 (probe "callback
  page" gate), so Alpha's `ELIZA_NATIVE_AUTH_CALLBACKS_JSON` entry is in place.

## Operator steps (after H-09)

1. `node scripts/render-assetlinks.mjs --cloud-config --published https://eliza.app/.well-known/assetlinks.json`
   prints the full `ELIZA_ANDROID_ASSET_LINKS_JSON` value with Alpha's entry carrying the release
   fingerprint and every other app's entry kept unchanged. Add `--keep-fingerprint HEX` only for a
   certificate decision 1 keeps. One entry per package: a malformed value or a duplicate package
   publishes `[]` for **every** app.
2. Set the printed value as the GitHub variable of the Cloud production environment; deploy.
3. `node scripts/render-assetlinks.mjs --check https://eliza.app/.well-known/assetlinks.json` must
   exit 0; `node scripts/cloud-readiness.mjs probe` App Links gate must pass.
4. Staging keeps the debug signer of test-mocks builds (`node scripts/cloud-readiness.mjs probe --environment staging --signer <SHA-256>`
   names a specific build's certificate).
5. Keep Alpha's `ELIZA_NATIVE_AUTH_CALLBACKS_JSON` entry (printed by `cloud-readiness.mjs registration`).
6. On an installed release build built with `ELIZAOS_APP_LINK_HOST=eliza.app`:
   `adb shell pm get-app-links ai.elizaresearch.alphaphone > pm-get-app-links.txt`, then
   `node scripts/owner/app-links-evidence.mjs pm-get-app-links.txt` must exit 0. If the state is not
   `verified`, re-trigger with `adb shell pm verify-app-links --re-verify ai.elizaresearch.alphaphone`
   and wait; never force it with `pm set-app-links`.

## Decisions for the owner

| Question | Options | Default / recommendation | What each choice changes |
| --- | --- | --- | --- |
| 1. Which certificates stay in production `assetlinks.json`? | A. Release certificate only. B. Release plus the debug signer `22:42:99:...`. C. Release plus both current entries. | **A**. H-13 leaves it to the operator; release-only matches `render-assetlinks.mjs` refusing debug certificates. | A: development builds lose verified `eliza.app` returns in production (they use staging, which lists its own debug signer). B/C: those signers keep verified handling of Alpha's production callback. |
| 2. Should a release without the App Link filter be blocked? | A. Add an `appLinks.present` requirement to the release distributable rule (an app change, separate PR). B. Keep it a manual check. | Not decided anywhere; recommendation A | A: a release built without `ELIZAOS_APP_LINK_HOST=eliza.app` is refused by `verify-apks`. B: rely on the H-10 instruction and this runbook. |

## Evidence template (fill after the steps; commit under `docs/evidence/`)

```json
{
  "schema": 1,
  "kind": "app-links-release-verification",
  "recordedAt": "<ISO date-time>",
  "releaseSignerSha256": "<android/release-signer.json signerSha256>",
  "published": {
    "url": "https://eliza.app/.well-known/assetlinks.json",
    "command": "node scripts/render-assetlinks.mjs --check https://eliza.app/.well-known/assetlinks.json",
    "exitCode": 0,
    "fingerprintsListedForAlpha": ["<colon SHA-256>"]
  },
  "probe": { "command": "node scripts/cloud-readiness.mjs probe", "appLinksGate": "pass" },
  "device": {
    "evidenceClass": "device (installed release build)",
    "build": { "versionCode": 0, "versionName": "<name>", "appLinkHost": "eliza.app", "apkSha256": "<sha256 of the installed APK>" },
    "deviceModel": "<model>", "androidVersion": "<version>",
    "command": "adb shell pm get-app-links ai.elizaresearch.alphaphone",
    "checker": "node scripts/owner/app-links-evidence.mjs pm-get-app-links.txt",
    "elizaAppState": "verified",
    "signatureMatchesRelease": true
  },
  "notProven": "A sign-in, delegation return or any other build or device"
}
```

## Exact remaining human steps

1. H-08/H-09 release identities (prerequisite).
2. Owner: decisions 1 and 2.
3. Operator: steps 1-5; tester: step 6 on an installed release build; commit the evidence file.

## Draft decision entries

- **P-NN — H-13 (#670):** Production `https://eliza.app/.well-known/assetlinks.json` grants
  `ai.elizaresearch.alphaphone` to the enrolled release certificate only (`<SHA-256>`); the debug
  signer `22:42:99:4D:...` and `ED:BF:CA:CB:...` are removed; staging lists the test-mocks debug
  signer. Policy, not evidence.
