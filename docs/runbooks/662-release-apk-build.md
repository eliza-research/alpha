# #662 Build and sign the distributable release APKs (H-10)

Owner preparation for [issue #662](https://github.com/eliza-research/alphaphone/issues/662),
[human actions](../human-actions.md) H-10. This is the release owner's procedure on the release
build host. It records no result. Everything it produces is **APK-build evidence only**: not an
emulator HOME-role test, an image boot, a device result or user acceptance.

## Protected app-keystore proof

`release-app-signing.yml` exercises the existing protected PKCS#12 app keystore
using two code-free APK fixtures with dedicated non-Alpha package IDs. Dispatch on
canonical `main` with the reviewed `source_commit` and SHA-256 of
`scripts/ci/build-app-signing-fixtures.py` as `fixture_generator_sha256`. Review the
exact workflow and source commit shown in the run name before approving `release`.
The job accepts no external artifact and exports only the source, certificate and
fixture byte digests. Production APK signing from a trusted build, full signed
verification on the staged build tree, and approval for distribution are separate.

This workflow enrolls only the existing application certificate. It does not change
OS signing keys, OTA trust, `lastRelease`, or voice qualification. The `release`
environment must retain its main-only policy, independent reviewer, blocked
self-review and disabled administrator bypass. No secrets are needed for the
source checks or ordinary pull-request CI.

Before preparing a product APK, run `npm run android:build:inputs` against the
selected source. Native releases need source-matched staged voice bytes and their
recorded qualification. The November 6 explicit Cloud release profile instead
requires genuine Cartesia qualification for each exact signed APK; see the
[launcher update procedure](../launcher-ota.md#publishing) and
[qualified publication workflow](publish-qualified-app-update.md). A closed-fixture
signing proof does not satisfy either voice qualification. The October 28 snapshot
below is historical, not the input status for a later SDK pin.

## Read-only state on 2026-10-28 (main 94676c82, Eliza pin 1f2a922f)

### The pin contains the merged cycle-1 upstream branches

`upstream.lock.json` pins elizaOS/eliza `1f2a922f86e2a1f3d6cd62e097145492bd49ebfc` (2026-10-28
14:04 -07:00). Every cycle-1 upstream pull request is merged into `develop` and its merge commit is
an ancestor of the pin (`git merge-base --is-ancestor <merge> 1f2a922f`):

| PR | Branch | Merge commit | In pin |
| --- | --- | --- | --- |
| [#38051](https://github.com/elizaOS/eliza/pull/38051) | claude/alpha-c1-settings | 98c249ce | yes |
| [#38053](https://github.com/elizaOS/eliza/pull/38053) | claude/alpha-c1-aosp | 7ade77c8 | yes |
| [#38054](https://github.com/elizaOS/eliza/pull/38054) | claude/alpha-c1-cloud | 9eecca02 | yes |
| [#38055](https://github.com/elizaOS/eliza/pull/38055) | claude/alpha-c1-browser | 51cbb9fb | yes |
| [#38056](https://github.com/elizaOS/eliza/pull/38056) | claude/alpha-c1-mail-calendar | 746ca770 | yes |
| [#38057](https://github.com/elizaOS/eliza/pull/38057) | claude/alpha-c1-media | 4264eda7 | yes |
| [#38058](https://github.com/elizaOS/eliza/pull/38058) | claude/alpha-c1-overview | 36361110 | yes |
| [#38059](https://github.com/elizaOS/eliza/pull/38059) | claude/alpha-c1-packaging | 0b2fa450 | yes |
| [#38060](https://github.com/elizaOS/eliza/pull/38060) | claude/alpha-c1-telephony | e87a3a73 | yes |
| [#38061](https://github.com/elizaOS/eliza/pull/38061) | claude/alpha-c1-maps | 7b30463a | yes |
| [#38062](https://github.com/elizaOS/eliza/pull/38062) | claude/alpha-c1-a11y | 8e4a76b6 | yes |
| [#38063](https://github.com/elizaOS/eliza/pull/38063) | claude/alpha-c1-shell | 5ee50559 | yes |
| [#38065](https://github.com/elizaOS/eliza/pull/38065) | claude/alpha-c1-speech | 4ee22a25 | yes |
| [#38066](https://github.com/elizaOS/eliza/pull/38066) | claude/alpha-c1-assistant | 988be865 | yes |
| [#38067](https://github.com/elizaOS/eliza/pull/38067) | claude/alpha-c1-workflows | ea827def | yes |
| [#38068](https://github.com/elizaOS/eliza/pull/38068) | claude/alpha-c1-agent | 860b8f79 | yes |
| [#38069](https://github.com/elizaOS/eliza/pull/38069) | codex/alpha-runtime-compatibility-20261028 | 88ee1c26 | yes |
| [#38070](https://github.com/elizaOS/eliza/pull/38070) | claude/alpha-c1-notes-clock | 89f6107c | yes |
| [#38083](https://github.com/elizaOS/eliza/pull/38083) | claude/shared-host-review-fixes | fa9dfb05 | yes |
| [#38084](https://github.com/elizaOS/eliza/pull/38084) | claude/grace-generic-host | 0d6828a9 | yes |

The cycle-1 PR list is the orchestration's record of upstream PRs; the merge state and commits were
read from GitHub. This prerequisite of the issue is met at this pin; a later repin must re-check it.

### `npm run android:build:inputs`

| State | Input | Supplied by |
| --- | --- | --- |
| ready | pinned upstream checkout (`vendor/eliza` at the pin) | script |
| **PERSON** | on-device voice outputs in `.eliza/paradee-voice/native` (not staged; Gradle `:app:verifyVoiceHost` rejects a distribution build) | H-18: `node scripts/android-stage-voice-models.mjs --from <directory>` ([fused speech](../fused-speech.md)) |
| **PERSON** | on-device voice host qualified (`android/voice-host/qualified-voice-host.json` is `qualified: false`) | H-18 named reviewer |
| script | embedding host libraries (`libelizainference.so`, `libelizavoicejni.so`, `libc++_shared.so`) | `npm run agent:build-embedding-host` (part of `android:build:local`) |
| script | prepared resident runtime source, workflow worker, staged resident payload, embedding model | `android:build:local` chain |
| ready | Gradle dependency verification metadata | committed |
| **PERSON** | release signer (`android/release-signer.json` is `unset`; no `ELIZAOS_KEYSTORE_*` set) | H-08/H-09 (#661), then H-10 signing |

Three person-supplied inputs are missing: the voice outputs, the voice host qualification and the
release signer. The embedding host (H-19) is script-supplied at this pin.

### `npm run human:status` (release rows)

- H-09 `open`: 12 of 12 release digests unset.
- H-10 `open`: no `artifacts/apk-manifest.json` in this checkout; no `lastRelease`; no
  `ELIZAOS_KEYSTORE_*` variable; `ELIZAOS_APP_LINK_HOST` unset.
- H-18 `open`: `qualified: false` (device executed: true, emulator executed: true, user accepted: false).
- H-19 `not needed`: script-supplied while `remapBuildPath` is true.

No agent ran the build chain or Gradle for this issue.

## Decisions for the owner

### D1. Gradle signing or post-build signing? Settled by the 2026-10-29 custody decision

H-01 is decided: the keys live as GitHub Actions secrets, and a CI job signs
([#661 D1](661-release-key-custody-ceremony.md#d1-h-01-where-do-the-release-keys-live-after-the-ceremony-decided-2026-10-29)).
That makes post-build signing the path: build **unsigned** on the release build host, then run
the draft `sign-apks` job
([drafts/661-release-signing.workflow.yml](drafts/661-release-signing.workflow.yml)). The job
decrypts only `alphaphone_app` into tmpfs, runs `sign-release-apks.mjs --keys-dir ... --no-verify`
(the signer check against `android/release-signer.json` still runs), and shreds the key. Gradle
signing (`ELIZAOS_KEYSTORE_*`) is not used. It would need a keystore that the ceremony does not
produce, and the passwords would sit in the build environment for the whole build. The PKCS#11
form is kept only for a later move to custody B or C.

The remaining choice here is the input transport, [#661 D2](661-release-key-custody-ceremony.md#d2-how-do-unsigned-inputs-reach-the-ci-signing-job).

### D2. Version code and name

`ELIZAOS_VERSION_CODE` must exceed `lastRelease.versionCode` (currently `null`, so any positive
integer is admitted). The highest development versionCode recorded in `docs/evidence` is 17.
Recommendation: a code above every development build that pilot units may still have installed
(for example 100), and a `ELIZAOS_VERSION_NAME` that names the Alpha commit and Eliza pin. What it
changes: once H-32 records this release as `lastRelease`, every later build and every
`pilot-update` must advance it; a code that is too low cannot be undone.

### D3. App Links host

Every build declares the verified App Links filters on `eliza.app`, the configured production web
host; `ELIZAOS_APP_LINK_HOST`, if set, must equal it.

## Procedure (release owner, release build host)

Prerequisites: #661 done (H-09 `done`), H-18 admitted, this pin (or a later one re-checked).

1. On a clean checkout of the release commit: `git submodule update --init vendor/eliza`; confirm
   `npm run android:build:inputs` shows the pin `ready`.
2. Stage the person inputs it lists:
   `node scripts/android-stage-voice-models.mjs --from <directory of the recorded voice outputs and models>`
   (H-18; see [fused speech](../fused-speech.md)). Re-run `npm run android:build:inputs`: the only
   remaining `PERSON` row must be the release signer (it does not stop the build).
3. `npm run verify`.
4. Build both distribution variants with the strict chain (never `--allow-unpackaged-runtime`,
   never `ELIZA_DEV_ALLOW_TEST_MOCKS=1`):
   ```sh
   ELIZAOS_VERSION_CODE=<D2> ELIZAOS_VERSION_NAME=<D2> ELIZAOS_APP_LINK_HOST=eliza.app \
     npm run android:build:local
   ```
   (with the four `ELIZAOS_KEYSTORE_*` variables only if D1 chose Gradle signing).
5. Sign in CI (D1), following [#661 CI signing path step 5](661-release-key-custody-ceremony.md#5-run):
   ```sh
   tar -cf unsigned-release.tar -C artifacts standalone-release-unsigned.apk launcher-release-unsigned.apk \
     build-config.json apk-manifest.json            # add sense-listener-unsigned.apk if prepared
   sha256sum unsigned-release.tar                   # typed into the dispatch form with the URL
   ```
   Dispatch `Release signing (draft)` with `target=apks` once it is enabled, and approve the
   `release` gate after checking the workflow file at that commit. Download
   `signed-release-apks-<run>` into `artifacts/` on this same build tree, remove the two
   `*-release-unsigned.apk` files, then run:
   ```sh
   node scripts/verify-apks.mjs
   node scripts/generate-sbom.mjs --out artifacts/sbom/alphaphone.cdx.json --apks artifacts --packaged-runtime
   ```
   (`--packaged-runtime` applies when the resident runtime is staged, as it is for a distributable build.)
   No key ever reaches the build host.
6. Check: both release rows (`standalone`, `launcher`) of `artifacts/apk-manifest.json` read
   `distributable: true`; `node scripts/audit-production-bundle.mjs` passes; `npm run human:status`
   shows H-10 `done`.
7. Do **not** run `scripts/record-release.mjs --write` yet: `lastRelease` is recorded only after
   distribution (H-32).
8. Keep `artifacts/apk-manifest.json`, both APKs, the signed listener APK and the build log as the
   release build record; these feed H-21 (#672).

## Draft decision entries

```markdown
- **P-5x — H-10 ([#662](https://github.com/eliza-research/alphaphone/issues/662)), decided <YYYY-MM-DD> by Shaw:**
  Release APKs are built unsigned on the release build host and signed by the CI release-signing job
  (P-57) with scripts/sign-release-apks.mjs from key files decrypted into tmpfs for one step. The first pilot release uses versionCode <N> and
  versionName <name>; ELIZAOS_APP_LINK_HOST=eliza.app. Policy only, not build evidence.
```

## Remaining human steps

1. Finish #661 (custody, ceremony, enrollment).
2. H-18 reviewer: stage and admit the on-device voice outputs (`qualified: true`).
3. Release owner: choose D2 and the #661 D2 transport, then run the procedure above (build on the
   release build host, sign in CI, verify on the build host).
4. Confirm both `distributable: true` rows and H-10 `done`; hand the manifest and APKs to the image
   host operator for #672.
