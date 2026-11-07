# #661 Release key custody, ceremony and enrollment (H-01, H-08, H-09)

Owner preparation for [issue #661](https://github.com/eliza-research/alphaphone/issues/661). This
runbook collects what the custodian, witness and release owner need for
[human actions](../human-actions.md) H-01, H-08 and H-09 in one place. It is not evidence and
changes no record. No agent has seen, generated or handled any release key material; nobody
should paste keys, passphrases or PINs into an issue, PR, chat or commit.

Sources: [human actions](../human-actions.md) H-01/H-08/H-09, the pinned upstream
`vendor/eliza/packages/os/android/signing/README.md` (the offline ceremony), P-16 in
[decisions](../decisions.md), `android/signing/alpha-key-manifest.json`,
`scripts/enroll-release-keys.mjs`, `scripts/sign-release-apks.mjs`,
`scripts/sign-aosp-release.mjs` and [Pixel 10a staging](../pixel10a-staging.md) (managed signing).
Added for the 2026-10-29 custody decision: the draft CI job
[drafts/661-release-signing.workflow.yml](drafts/661-release-signing.workflow.yml) (not enabled),
`scripts/owner/release-signing-readiness.mjs` (read-only) and its test.

## Read-only state on 2026-10-28 (main 94676c82, Eliza pin 1f2a922f)

- `npm run human:status`:
  - H-01 `external` (recorded outside the repository; verify: the choice is in decisions.md and
    nothing in the repository holds key material).
  - H-08 `external` (verify: every private file ends in `.enc`; both people sign `fingerprints.json`).
  - H-09 `open`: **12 of 12 release digests unset** (`android/release-signer.json signerSha256`;
    `pixel10a-product.json` `signer.platformCertificateSha256`, `signer.releaseCertificates.{shared,
    media, networkstack, sdk_sandbox, bluetooth, nfc, apex}`, `avb.publicKeySha256`;
    `pixel10a-ota-channel.json` `otaCertificateSha256`, `avbPublicKeySha256`).
- `android/signing/alpha-key-manifest.json` lists 12 keys: the eleven image keys (`releasekey`,
  `platform`, `shared`, `media`, `networkstack`, `sdk_sandbox`, `bluetooth`, `nfc`, `apex`,
  `apex_payload`, `avb`) plus `alphaphone_app`. It holds names and parameters only.
- Existing tests, run locally on this branch (offline, throwaway keys only):
  - `node --test test/enroll-release-keys.test.mjs`: 6/6 pass, including "a test-key ceremony from
    the pinned generator is refused, also when its testKeys flag is edited" and "reused, debug,
    mismatched, missing and unexpected keys are refused before anything is written".
  - `node --test test/sign-release-apks.test.mjs test/aosp-release-signing.test.mjs test/human-actions.test.mjs test/pixel10a-gates.test.mjs`:
    all pass (39 tests together with the enrollment file).
  - Upstream ceremony toolchain at the pin, `node --test scripts/__tests__/release-key-ceremony.node.test.ts`
    from `vendor/eliza/packages/os`: 6/6 pass (AVB encoding vectors, encrypted-at-rest keys, product
    `--manifest`, unsafe output and weak passphrase refusals).

These are unit tests with throwaway keys. They show the refusals work; they are not a ceremony.

Re-checked 2026-10-29 on this branch:
- `node scripts/owner/release-signing-readiness.mjs --remote`, which makes GET requests only:
  - draft safety rules hold, and no enabled workflow reads a release secret;
  - H-09 is not enrolled;
  - the `avb` key manifest label is still `hsm`;
  - the `release` environment exists with reviewer `lalalune`, branch `main` only, and
    `can_admins_bypass: true`;
  - it holds **0 secrets** (all 14 expected names missing), and there are no repository-level
    `ALPHA_RELEASE_*` secrets.
- Repository settings probe (GET): the repository is **public**, the default workflow token is
  `read`, `allowed_actions: all`, `sha_pinning_required: false`, and fork pull requests from all
  external contributors need approval.

## Decisions for the owner

### D1 (H-01). Where do the release keys live after the ceremony? DECIDED 2026-10-29

**Owner decision (2026-10-29):** the release keys are stored as **GitHub Actions secrets** and
used by a **CI signing job**. The owner accepts the risk. The owner runs the offline ceremony
(H-08) on their own machine and uploads the encrypted key files and the passphrase with
`gh secret set`. No agent generates, sees or uploads any key, passphrase or secret value. The
procedure is in [CI signing path](#ci-signing-path-github-actions-secrets) below, and the job
is drafted, not enabled, in
[drafts/661-release-signing.workflow.yml](drafts/661-release-signing.workflow.yml).

This is a variant of option A (encrypted key files decrypted into tmpfs for one ephemeral job).
Here the ephemeral machine is a GitHub-hosted runner, and the encrypted files and the
passphrase come from environment secrets. The alternatives below are kept as a record of
what was considered:

| Option | Status | Why it matters later |
| --- | --- | --- |
| A. Encrypted key files, ephemeral signing job | **Chosen, with GitHub Actions as the job host** | APKs: `sign-release-apks.mjs --keys-dir`, tested against a real apksigner. Image/OTA: `sign-aosp-release.mjs --keys-dir`, tested only with mocked releasetools. |
| B. HSM over PKCS#11 | Not chosen | Moving to B later still works: both signing tools accept `--pkcs11-config`. signapk opens the token without a PIN, and the AVB helper and OTA payload signer still have to be written. |
| C. Managed key service over PKCS#11 | Not chosen | Same tool path as B. |

What this choice changes, and what the owner accepts with it:

1. **P-16 wording.** P-16 asks for "managed or hardware-backed release signing, distinct from
   developer keys". GitHub-encrypted secrets are managed storage. They are not hardware-backed,
   and the decrypted keys sit in plaintext in runner RAM (`/dev/shm`) for one step. The P-57 entry
   below records this as accepted.
2. **The two-person passphrase split collapses in CI.** H-08 has two people each type half of the
   passphrase. The CI job needs the whole passphrase as one secret, so whoever can approve a run
   in the `release` environment can effectively sign. The offline backups keep the split.
3. **The repository is public.** Workflow logs and artifacts are public, and so is anything
   printed. GitHub masks the exact secret strings, but it cannot mask decrypted key bytes. The
   draft never prints, cats or uploads the key directory, and
   `test/owner-release-signing-readiness.test.mjs` fails if a change to the draft starts doing so.
4. **No branch protection on `main`** (deferred, #658/#679). The workflow file runs from `main`, so
   anyone with write access can change it there. What protects the secrets is the `release`
   environment's required reviewer. **Before approving a run, the approver must check that the
   workflow file at that commit is the reviewed one.**
5. **Secret limits.** GitHub caps each secret at 48 KB and each repository at 100. The layout
   below uses 14 environment secrets. One per private key keeps every value small: measured with
   throwaway 2048-bit test keys, the base64 private files are 1.8 to 2.5 KB and the public bundle
   is 14 KB. 4096-bit keys roughly double that, which is still far under the limit.
6. **Key manifest label.** `alpha-key-manifest.json` marks `avb` as `storage: "hsm"`, but under
   this decision AVB is `offline-encrypted` like every other key. Fix the label **before** the
   ceremony, in the same reviewed change as the P-57 entry. The generator copies the manifest's
   `reviewedAt` into `fingerprints.json`. The allowed values are `offline-encrypted`, `hsm` and
   `cloud-hsm`. Proposed diff (not applied):
   ```diff
   -      "storage": "hsm",
   +      "storage": "offline-encrypted",
   ```
   and bump `reviewedAt`.

Also decide and record: the **custodian**, the **witness**, the **two offline backup locations**,
and the **legal entity** string for `--organization`.

### D2. How do unsigned inputs reach the CI signing job?

The release APKs are built on the release build host, which has the staged on-device voice
outputs (H-18). The unsigned target-files come from the image host (H-21). Neither of these
uploads a workflow artifact. The draft job therefore takes an **HTTPS URL plus a SHA-256** that
the owner types into the dispatch form. It refuses the input before touching any secret if the
digest does not match. The tarball holds no secret: it contains only unsigned APKs and build
records, or the unsigned target-files and otatools.

| Option | What it changes |
| --- | --- |
| (a) URL + SHA-256, any host the owner controls (documented default in the draft) | Can carry any size of input. The digest makes the host irrelevant to integrity. The URL appears in the public run's inputs, so use a short-lived link if the unsigned build should not be public. |
| (b) A GitHub prerelease asset on this repository | No other host is needed. The unsigned build becomes public, and each asset is capped at 2 GB, which a target-files zip may exceed. A draft release would need `contents: write` in the signing job, so do not do that. |
| (c) Build in CI | Not possible today: CI has no H-18 voice outputs and no AOSP tree. |

### D3. Environment `release` hardening

The `release` environment already exists. Read-only probe on 2026-10-28: required reviewer
`lalalune`, deployment branches `main` only, `prevent_self_review: false`,
`can_admins_bypass: true`, no secrets and no variables. No repository-level secrets exist.
Default: keep the existing environment, since the draft names it. Recommendation: set
**"Allow administrators to bypass" off**, so that an admin cannot skip the reviewer gate on a
job that holds every release key. With one maintainer, self-review has to stay allowed.
Optional: set "Require actions to be pinned to a full-length commit SHA" in the repository's
Actions settings. The probe shows `sha_pinning_required: false` and `allowed_actions: all`.
All of these are settings changes the owner makes in the GitHub UI.

### D4. Does the application key ever rotate?

`alphaphone_app` is `rotatable: "only through an APK signature scheme v3 rotation lineage"`. The
image keys cannot be rotated on fielded devices without a wipe. Default: no rotation is planned.
If the CI secrets are ever suspected to be exposed, the response is: delete the environment
secrets, set the passphrase secret to a fresh random value, and plan a v3 rotation for the
application key. The image keys cannot be rotated on units already in the field.

## Draft decision entries

These entries are not committed to `docs/decisions.md`. The owner completes them and adds them
in one reviewed change, together with the manifest label fix from D1.

```markdown
- **P-57 — H-01 / A-06 ([#661](https://github.com/eliza-research/alphaphone/issues/661)), decided 2026-10-29 by Shaw for Alpha Compute:**
  Release keys come from the offline encrypted ceremony (H-08). They are stored as GitHub Actions
  secrets of the `release` environment (one base64 secret per encrypted private key file, one for
  the public files, one for the passphrase), uploaded by the owner with `gh secret set`. A CI job
  (`.github/workflows/release-signing.yml`, workflow_dispatch from main only, required reviewer)
  decrypts only the keys it needs into tmpfs for one step and shreds them. This is accepted as
  P-16's "managed ... distinct from developer keys" for the pilot. It is not hardware-backed, and the
  passphrase split does not hold inside CI; the owner accepts both. The offline encrypted backups at
  <site 1> and <site 2> stay authoritative.
  Ceremony custodian: <name/role>. Witness: <name/role>. Legal entity for certificates: <entity>.
  No key material, passphrase or secret value is recorded in this repository. This records custody
  policy only; it is not evidence that any key exists or that any release was signed.
```

P-57 was the next free number on main at 94676c82. Renumber it if another entry lands first.

## H-08 Ceremony (custodian + witness, offline)

Follow upstream `vendor/eliza/packages/os/android/signing/README.md` section 1 exactly; the steps
below bind it to Alpha's key list.

Materials: an air-gapped laptop booted from a verified live image with networking disabled; two
new encrypted USB drives; tamper-evident bags; a printer for `fingerprints.json`.

1. Copy this repository at a reviewed commit (with `vendor/eliza` at the `upstream.lock.json`
   pin) onto the laptop. Node 24 and OpenSSL 3. Run the toolchain check:
   `(cd vendor/eliza/packages/os && node --test scripts/__tests__/release-key-ceremony.node.test.ts)`.
2. Each person types half of the passphrase (at least 20 characters in total) into tmpfs:
   ```sh
   umask 077; mkdir -p /dev/shm/ceremony
   cat > /dev/shm/ceremony/pass   # both halves on one line, then Ctrl-D
   ```
3. Generate into a **new directory outside any Git working tree** (the generator refuses otherwise):
   ```sh
   node vendor/eliza/packages/os/scripts/android/generate-release-keys.ts \
     --manifest android/signing/alpha-key-manifest.json \
     --output /media/USB1/<new directory> \
     --passphrase-file /dev/shm/ceremony/pass --organization "<legal entity>"
   ```
   Never pass `--test-keys`: enrollment refuses its output (`testKeys:true`, `OU=TEST ONLY`).
4. Check every private file ends in `.enc` (`<name>.pk8.enc`, `<name>.pem.enc`) and that no
   plaintext `.pk8` or private `.pem` exists. Print `fingerprints.json`; both people sign it.
5. Copy the directory to the second drive. Seal each drive and each passphrase half separately and
   store them at the two recorded locations.
6. (H-01 decided CI secrets.) The owner uploads them from one copy of the encrypted bundle after H-09.
   See [CI signing path](#ci-signing-path-github-actions-secrets). The offline bundle stays authoritative.
7. `shred` `/dev/shm/ceremony` and power off.

Evidence kept off-repo: the signed `fingerprints.json` printout, the bag seal numbers, date and
both names. The repository receives only the H-09 enrollment commit.

## H-09 Enrollment (release owner, reviewed change)

1. Copy **only public files** from the ceremony media to the working machine: `fingerprints.json`,
   every `*.x509.pem`, and `avb_pkmd.bin`. Never the `.enc` files.
2. Dry run (writes nothing):
   ```sh
   node scripts/enroll-release-keys.mjs --fingerprints <copy>/fingerprints.json --certificates <copy>
   ```
   It refuses: a test-key ceremony, a key list different from `alpha-key-manifest.json`, one
   certificate under two names, a debug signing certificate (debug rows of
   `artifacts/apk-manifest.json` and any `--debug-fingerprint`), certificates that do not hash to
   `fingerprints.json`, and any change to an already recorded digest (without `--replace`).
3. Note the two printed application identities (public values, safe to share with the Cloud
   operator): the **SHA-1** for the Google Android OAuth client of `ai.elizaresearch.alphaphone`
   (H-12) and the **colon SHA-256** for `ELIZA_ANDROID_ASSET_LINKS_JSON` (H-13).
4. Write: the same command with `--write`. Review the diff (only digest lines change) and commit
   the three records together: `android/release-signer.json`, `android/aosp/pixel10a-product.json`,
   `android/aosp/pixel10a-ota-channel.json`.
5. **Separately** set `signer.platformCertificateSha256` in `android/aosp/product.json` (the
   Cuttlefish product) to the same `platform` certificate SHA-256: `enroll-release-keys.mjs` does
   not write that file, and Cuttlefish production staging (H-23) refuses while it is `UNSET`.
   `node scripts/owner/production-staging-preflight.mjs` lists it as `H-09 (manual)`.
6. `npm run human:status` must show H-09 `done`.

## CI signing path (GitHub Actions secrets)

The owner does every step in this section. No agent runs any of it, and nobody pastes a value
from it into an issue, PR, chat or commit.

### 1. Prerequisites

- H-08 is done, and H-09 is enrolled and merged to `main` (`npm run human:status` shows H-09 `done`).
  The draft job refuses to run while `android/release-signer.json` is unset.
- D3 is applied in the `release` environment (bypass off).
- `gh` is authenticated as the owner on an **online** machine. This is the first point where the
  encrypted private files leave the air gap, which the D1 decision accepts. Use one backup drive
  or a third copy, never the only one.

### 2. Upload (secrets go to the `release` environment, never to repository level)

From a shell on the online machine, with the ceremony directory mounted read-only at `$C`:

```sh
R=eliza-research/alphaphone; E=release
cd "$C"
# Passphrase: gh prompts and reads it without echo; it is never written to disk or shell history.
gh secret set ALPHA_RELEASE_KEY_PASSPHRASE -R "$R" --env "$E"
# Public files (certificates, AVB public keys, fingerprints.json) as one base64 tarball.
tar -czf - --sort=name --owner=0 --group=0 --numeric-owner \
    fingerprints.json *.x509.pem *.pub.pem *.avbpubkey avb_pkmd.bin \
  | base64 -w0 | gh secret set ALPHA_RELEASE_PUBLIC_BUNDLE -R "$R" --env "$E"
# One secret per ENCRYPTED private file (.enc only; never a plaintext .pk8 or .pem).
for n in releasekey platform shared media networkstack sdk_sandbox bluetooth nfc apex alphaphone_app; do
  base64 -w0 "$n.pk8.enc" | gh secret set "ALPHA_RELEASE_KEY_$(echo "$n" | tr a-z A-Z)" -R "$R" --env "$E"
done
for n in apex_payload avb; do
  base64 -w0 "$n.pem.enc" | gh secret set "ALPHA_RELEASE_KEY_$(echo "$n" | tr a-z A-Z)" -R "$R" --env "$E"
done
```

The names are fixed by `scripts/owner/release-signing-readiness.mjs` (`expectedSecrets`) and by
the draft workflow. `test/owner-release-signing-readiness.test.mjs` rebuilds the ceremony layout
from values produced exactly this way, using a throwaway `--test-keys` ceremony, runs both draft
decrypt steps, and checks three things: the right keys come out, every image-key file is 0600,
and nothing is left in tmpfs.

### 3. Check (read-only, names only)

```sh
GH_BIN=gh node scripts/owner/release-signing-readiness.mjs --remote
```

It must report all 14 names present in `release` and none at repository level. GitHub never
returns secret values, and this script never asks for them.

### 4. Enable the workflow (reviewed PR)

Copy `docs/runbooks/drafts/661-release-signing.workflow.yml` to
`.github/workflows/release-signing.yml` in a reviewed PR and merge it to `main`. The readiness
test will then report the enabled workflow. Update its assertion in the same PR, from "no
enabled readers" to "exactly this file".

### 5. Run

1. APKs (H-10, see [#662](662-release-apk-build.md)): pack the unsigned release build on the
   release build host:
   `tar -cf unsigned-release.tar -C artifacts standalone-release-unsigned.apk launcher-release-unsigned.apk build-config.json apk-manifest.json [sense-listener-unsigned.apk]`.
   Compute `sha256sum`, host the tarball per D2, then dispatch with `target=apks`. Approve the
   environment gate only after checking the workflow file at the run's commit.
2. Download `signed-release-apks-<run>` into the same build tree's `artifacts/`. Remove the
   unsigned files, then run `node scripts/verify-apks.mjs` and
   `node scripts/generate-sbom.mjs ...` there (as `sign-release-apks.mjs` would without
   `--no-verify`). Both release rows must read `distributable: true`.
3. Image/OTA (H-22, see [#672](672-pixel10a-production-image.md)): tar
   `unsigned-target_files.zip`, `otatools/` and optionally `apk-manifest.json`. Dispatch with
   `target=image`, `target_files_sha256` from the build record, and the tarball's own SHA-256.
   The image job is drafted with less certainty: disk space on a hosted runner for target-files
   plus otatools is unchecked, and the releasetools path has only run against mocks.

A successful run is signing evidence only. It is not an install, a boot, a drill or a release.

## Remaining human steps

1. Owner: complete P-57 above (custodian, witness, backup sites, legal entity), fix the `avb`
   storage label in `alpha-key-manifest.json`, and land both in one reviewed change (H-01).
2. Owner: apply D3 to the `release` environment (bypass off) and choose D2 (input transport).
3. Custodian and witness: run the H-08 ceremony offline, with the corrected manifest.
4. Release owner: run the H-09 dry run, then `--write`, commit the three records, and add the
   `product.json` platform digest in a reviewed change.
5. Owner: upload the 14 secrets (CI signing path, step 2), run the `--remote` check, and enable
   the workflow in a reviewed PR.
6. Cloud operator (after step 4): H-12 (Android OAuth client with the printed SHA-1) and H-13
   (assetlinks with the printed SHA-256).
