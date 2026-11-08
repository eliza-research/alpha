# Dependency and artifact supply chain

## Reviewed native Android APK npm closure (2026-10-25)

The exact signed ARM64 APK `d3f1fd7792071e0ac76484e437e9a15cd1aa082e75f236ea8c4e4b8e5bdd5e10`
was built from product `4fd8228` / SDK `a95cd4d`. Its normalized packaged npm input
is the same 603 versions as the preserved `77c65e` review, so the dated registry
result is reused without a query: one moderate UUID finding, no high or critical
npm finding. Current affected UUID/Zod bodies and Zod 4.6.6 aliases were checked;
existing exception objects and deadlines remain unchanged. See the
[exact artifact review](security/resident-artifact-review-d3f1fd7792071e0a-2026-10-25.json).

Bun itself changed from the musl binary to native Android binary `f2970336…`,
using Android's linker. The npm dispositions do not prove this binary's builtin,
ELF, FFI/JNI or device security/behavior. External Undici implementation remains
outside the npm absence conclusion. All earlier artifact records and functional
qualification states are preserved; no device or full-app result transfers.


## Current source-only input rebind (2026-10-26)

SDK `349235fd384f0c0694b8ad9b3f96fec493f33440` at fixed build-source product `19bd44c31b97903212e1b00935c5c715d0a17602` changes shared prepared-navigation reply handling only. The raw Bun lock and normalized3,694-package advisory input are unchanged from0f. The dated findings, exception objects and deadlines remain unchanged; no new registry query or security clearance is claimed. Installed877a/d7/0f and its Notes reply mismatch remain separate. See [source identity evidence](evidence/source-metadata-19bd-349-20261026.json).

## Historical 737 source-only input rebind (2026-10-25)

SDK `737c4d578f69659a6881afe8ff06e3379cbc713c` at build-source product `c8801829f4f3ff9c1fed6f700473460852820a65`
has byte-identical Bun lock and normalized 3,694-package input versus the prior
`a95cd4d28eb2bcd5fe5527e98058c167ff480557` source. The dated October 25 registry result and all124 findings,
104 exception objects,103 maintenance records and existing deadlines stay unchanged.
No registry query, new waiver, remediation or renewal occurred. See [current source
scope](evidence/source-metadata-c880-737-20261025.json).

The installed `d3f1fd7792071e0ac76484e437e9a15cd1aa082e75f236ea8c4e4b8e5bdd5e10`
artifact remains bound to4fd/a95. Its packaged npm review and older receipts are
preserved. They do not qualify a737 bundle/APK, Bun builtins, native FFI, Notes
navigation, provider responses, hardware audio or Seeker. Current-source artifact
qualification remains false while the normal producer and acceptance are pending.

## Historical a95 source-only input rebind (2026-10-25)

SDK `a95cd4d28eb2bcd5fe5527e98058c167ff480557` at product `4fd822874850a68c3d82675630593e4c63be943d`
uses exactly the prior full Bun lock bytes and normalized 3,694-version registry
input. The dated October 25 registry result and 124 source findings are reused;
no registry query or exception deadline renewal occurred. The source snapshot and
disposition source binding now name this pin. See [identity and qualification
scope](evidence/source-metadata-4fd-a95-20261025.json).

The artifact review below stays bound to APK `77c65ebe29c011f7d8f211a3a5dcfb2a79d1909cc74ecf0e40a0f4a68377f0cb`,
product `a424de9`, SDK `f4142d3`. Native Android Bun changes the binary/platform
contract. Its new APK closure, packaged advisory review, app-UID behavior and
full device acceptance remain pending; source-input identity transfers none of
those results. No shipped high/critical waiver or Bun builtin assurance is added.


## Historical f414 source and artifact projection (2026-10-25)

SDK `f4142d3a92d6b5b49ef6c6a666155218b8b75b07` at product
`a424de923b4b19aa0d86a7e23ef30598f6704d94` has the same Bun lock bytes and
normalized 3,694-version registry input as the October 25 snapshot at SDK `4e561dc`.
The 124 existing full-lock findings are reused as dated source-review evidence;
no fresh registry query or remediation is claimed. See
[source identity and pending gates](evidence/source-metadata-a424-f414-20261025.json).

The current snapshot and disposition binding now name this SDK and exact signed
APK `77c65ebe29c011f7d8f211a3a5dcfb2a79d1909cc74ecf0e40a0f4a68377f0cb`.
Its [artifact review](security/resident-artifact-review-77c65ebe29c011f7-2026-10-25.json)
verifies the same 603-version packaged npm input: one moderate UUID finding and
no shipped high or critical npm finding. UUID affected-function aliases remain
unused by the reviewed v4-only consumers, and Zod wrappers resolve to 4.6.6.
Bun external Undici implementation remains outside this npm closure conclusion.
The old artifact review is preserved; no exception object or deadline is renewed.
Owning offline audit checks pass for this binding. Functional provider/navigation,
voice hardware and physical-device acceptance remain separate pending gates.


Covers inventory items MVP-45 (dependency findings), the licence flags of decision P-09, the
software part of MVP-43 (Denton typeface rights) and the read-back tooling for MVP-46
(required checks). Everything here is source and test evidence. It is not an APK build,
emulator, device or legal result.

## Commands

```sh
node scripts/dependency-audit.mjs            # network: npm audit against package-lock.json, compared with the dispositions
node scripts/dependency-audit.mjs --write    # network: also rewrite docs/dependency-audit.snapshot.json
node scripts/dependency-audit.mjs --offline  # the committed snapshot only
node --test test/dependency-audit.test.mjs   # offline; part of npm test
node scripts/generate-sbom.mjs               # offline: artifacts/sbom/alphaphone.cdx.json (source pins)
node scripts/generate-sbom.mjs --packaged-runtime --apks artifacts   # offline: the release-candidate document; npm run android:build writes it
node scripts/gradle-verification.mjs --check # offline; part of npm test (npm run android:deps:check)
node scripts/gradle-verification.mjs --write # network, full Gradle build: rewrite the verification metadata (npm run android:deps:write-verification)
node scripts/ci/read-required-checks.mjs     # network, read-only: enforced rules on main vs the intended ruleset
```

The audit reads the registry advisory database for the lockfile (`npm audit --json
--package-lock-only`). It installs nothing and changes no dependency.

## npm advisories (MVP-45)

Audited 2026-10-10 with npm 11.18.0. Before triage `npm audit` reported 3 moderate and 1
high finding, which reduce to two advisories. No finding is in a production dependency: all
four packages are `dev` in `package-lock.json`, so none is in the web bundle or an APK
(`productionLockPackages` in `scripts/generate-licenses.mjs` and the SBOM list only
non-dev packages).

| Advisory | Severity | Package and exact path | Ships? | Vulnerable code reachable? | Disposition |
| --- | --- | --- | --- | --- | --- |
| GHSA-68fv-2mgg-jv7q, event-loop denial of service through indexed source-map section offsets | high | `source-map-js` 1.2.1 via `vite > postcss > source-map-js` and `@vitejs/plugin-react > vite > postcss > source-map-js` | No. Build tool only. | Only at build time: PostCSS parses a source map that accompanies CSS it processes. Production builds set `sourcemap: false`. A hostile map in a CSS dependency could hang a developer or CI build; it cannot affect a user. | **Fixed.** Lockfile-only bump to 1.2.2, inside PostCSS's declared `^1.2.1`. |
| GHSA-w5hq-g745-h8pq, uuid missing buffer bounds check in v3/v5/v6 when `buf` is provided | moderate | `uuid` 7.0.3 via `@capacitor/cli > xcode > uuid` | No. CLI tool only. | No. `xcode` calls only `uuid.v4()` with no arguments (`lib/pbxProject.js`). | **Exception until 2027-02-08** (re-reviewed 2026-10-11). |
| same advisory, reported on the parent | moderate | `xcode` 3.0.1 via `@capacitor/cli > xcode` | No | No. `@capacitor/cli` loads `xcode` only in its iOS `migrate uiscene` task. There is no iOS project; the only CLI use is `cap sync android`. | Same exception. |
| same advisory, reported on the direct dependency | moderate | `@capacitor/cli` 8.5.2 (direct devDependency) | No | No, as above. | Same exception. |

Why the uuid finding is an exception and not a fix:

- Every `xcode` release depends on `uuid ^7`, and the newest `@capacitor/cli` (8.5.3) still
  depends on `xcode ^3.0.1`. No release inside the existing ranges removes the path.
- npm's proposed fix is a downgrade to `@capacitor/cli` 8.4.3. That splits the CLI from the
  pinned `@capacitor/core` and `@capacitor/android` 8.5.2.
- An `overrides` entry forcing `uuid >= 11.1.1` is a four-major jump beneath a package that
  declares `^7`, for code that is never called.

Remove the exception when `@capacitor/cli` drops `xcode` or `xcode` moves to `uuid >=
11.1.1`, and take that release together with the matching `@capacitor/core` and
`@capacitor/android`.

### How the record is enforced

- `docs/dependency-audit.snapshot.json` is the normalised audit, bound to the SHA-256 of
  `package-lock.json`. Each finding carries its root advisory and every dependency chain
  that reaches it.
- `docs/dependency-audit.dispositions.json` is the reviewed record: `fixes` and
  time-bounded `exceptions` (at most 120 days from review).
- `test/dependency-audit.test.mjs` runs offline in `npm test` and fails when:
  - `package-lock.json` changed since the snapshot (re-run the audit with `--write`);
  - the snapshot holds an advisory, package or dependency path with no recorded exception,
    a dev-only exception now reaches a production path, or a severity rose;
  - an exception passed its `reviewBy` date, lacks its justification, or no longer applies;
  - a recorded fix regressed in the lockfile.

Any change to `package-lock.json` therefore needs a fresh `node scripts/dependency-audit.mjs
--write` in the same change. The first date on which the test fails by itself is 2027-02-09,
when the uuid exception expires. It was re-reviewed on 2026-10-11: the registry still has no
`@capacitor/cli` release without `xcode` (latest 8.5.3; 8.5.4 nightly and 9.0.0-alpha.8 are
prereleases), `xcode` 3.0.1 is still the newest and depends on `uuid ^7.0.3`, the installed
`xcode` still calls only `uuid.v4()` without a buffer, and `@capacitor/cli` loads it only from
`dist/tasks/migrate-uiscene.js`. The review date moved by 120 days, the maximum.

`source-map-js` 1.2.2 was exercised with PostCSS 8.5.28 (generate, then consume a previous
map) in an isolated install. `npm run verify` in the working tree used the shared
`node_modules`, which still held 1.2.1; a clean `npm ci` installs 1.2.2.

The pinned platform (`vendor/eliza`, `upstream.lock.json`) is outside the root audit and was
not changed. Its own dependencies are resolved by the upstream workspace when the agent runtime
is prepared; they are not in this repository's lockfile. The resident audit below covers them.

### Resident runtime advisories

About 550 npm packages reach the APK inside the agent bundle and the workflow worker. The
root audit does not see them. `node scripts/dependency-audit.mjs --resident` builds its input
as `name@version` and queries the npm bulk advisory endpoint:

- by default from the pinned upstream lock (`vendor/eliza/bun.lock`): every registry package
  version of the upstream workspace, a superset of what ships;
- with `--notices <third-party-notices.json>`, from the npm entries of
  `generate-licenses.mjs --packaged-runtime` notices, exactly what one staged payload ships.

Run `node scripts/dependency-audit.mjs --resident --notices <third-party-notices.json>`
without `--write` to audit a fresh staged payload. This subset audit requires each finding
to have an applicable, unexpired reviewed **shipped** exception; shipped high or critical
findings require an upstream fix. Exceptions for packages absent from the subset are
checked by the separate full-lock audit, not reported as stale by the subset audit.
The full-lock audit retains its stale-exception checks and canonical snapshot.
A packaged audit does not establish device or release qualification.

The result is stored under `resident` in `docs/dependency-audit.snapshot.json`, bound to the
`upstream.lock.json` commit and to a hash of the input. Its dispositions go under `resident`
in `docs/dependency-audit.dispositions.json` with the commit they were reviewed at, using the
same exception fields and 120-day limit. `test/dependency-audit.test.mjs` fails offline when
the upstream commit or the upstream lock changes without a refreshed resident snapshot
(`node scripts/dependency-audit.mjs --resident --write`).

Audited 2026-10-12 at upstream `13c98575987a`, from the upstream lock (3689 package
versions): 103 advisory findings in 34 packages, 3 critical, 42 high, 43 moderate and 15 low.
The critical ones are `handlebars` 4.7.9 (GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f) and
`shell-quote` 1.10.0 (GHSA-pqg4-j6r4-53mv); the high ones include `undici`, `axios`,
`node-forge`, `@modelcontextprotocol/sdk`, `sharp`, `pacote` and `basic-ftp`.

The reachability review is in
[security/vulnerability-review-2026-10-12.md](security/vulnerability-review-2026-10-12.md),
with the prioritized fix plan. A payload staged at the pin ships 550 npm package versions;
auditing exactly those (`--resident --notices`) leaves 5 findings: `handlebars` 4.7.9 (two
critical, one moderate), `uuid` 8.3.2 and 9.0.1 (moderate) and `@ai-sdk/provider-utils` 4.0.26
(low). The other 98 are in packages the mobile agent bundle does not include. Dispositions
under `resident` in `docs/dependency-audit.dispositions.json`: 86 time-bounded exceptions (the
98 non-shipping findings, plus `uuid`, which ships but is not reachable, and the low
`provider-utils` finding, short-dated until its upstream fix) and `pendingUpstreamFixes` for the
three shipped `handlebars` advisories, which deliberately have no exception. `--resident`
therefore still exits 1 until upstream moves `handlebars` to 4.7.10 and the pin follows.
`test/dependency-audit.test.mjs` fails on any other undispositioned resident advisory, on a
pending fix that is also excepted, and on an exception for a shipped high or critical
advisory. This is source and registry evidence plus a staged payload on a development
machine; no APK was built.

Re-audited 2026-10-13 at upstream `bc71e21f3b` (plan step A-3, after elizaOS/eliza#36124 moved
`handlebars` to 4.7.10 and `@ai-sdk/openai` to 3.0.118): 3687 package versions, 99 findings,
1 critical (`shell-quote`, not shipped), 42 high, 42 moderate and 14 low. The three `handlebars`
advisories and GHSA-866g-f22w-33x8 (`@ai-sdk/provider-utils` 4.0.26) are gone; their pending fix
and their exception were removed, and the other 85 exceptions are unchanged, because every
remaining finding resolves to the same package versions as at `13c98575987a`.
`node scripts/dependency-audit.mjs --resident` now exits 0. The shipped-set evidence is still the
payload staged at `13c98575987a`; the payload was not re-staged at `bc71e21f3b`, so the
packaged-notices audit (A-4) at this pin has not run.

### Scheduled advisory audit

`.github/workflows/dependency-audit.yml` runs weekly (Mondays 06:17 UTC) and on manual
dispatch, with `contents: read`, SHA-pinned actions and no secrets. It runs
`node scripts/dependency-audit.mjs` against the registry, which fails on any advisory path
without a reviewed disposition, and then the resident audit on the pinned upstream lock
(fetched by commit). It is not a required check and never runs on a pull request or push
(`test/ci-required-checks.test.mjs`). Since the pin `bc71e21f3b` the resident step has no
pending fix and passes while every finding keeps an unexpired disposition.

## Release SBOM

Before this change nothing produced a machine-readable inventory with versions and hashes.
`third-party-notices.json` lists names, versions and licence texts for attribution, without
hashes; `licenses/android-runtime-classpath.json` lists Gradle coordinates only.

`node scripts/generate-sbom.mjs` writes a CycloneDX 1.6 JSON document to
`artifacts/sbom/alphaphone.cdx.json` (ignored by git; attach it to a release). It runs
offline, has no timestamp, and derives its serial number from its content, so the same
commit always yields the same bytes (`test/sbom.test.mjs`).

| Component group | Source of truth | Hash recorded |
| --- | --- | --- |
| npm production packages (web bundle, and the same bundle inside each APK) | `package-lock.json` | registry tarball SHA-512 |
| Bundled font files | `apps/app/public` | SHA-256 of the committed bytes |
| OCR WebAssembly cores | `licenses/tesseract-core/sources.json` | SHA-256 |
| Android runtime classpath (71 coordinates) | `licenses/android-runtime-classpath.json` | SHA-256 from `android/gradle/verification-metadata.xml`: the archive for 60 coordinates, the metadata file for the 11 that publish no archive |
| ARM64 embedding host libraries and embedding model | `android/embedding-host/qualified-host.json` | SHA-256 of the reviewed bytes (a pin; the libraries are not in Git) |
| libelizainference voice-host libraries per ABI and GGUF speech models (when qualified) | `android/voice-host/qualified-voice-host.json` ([fused speech](fused-speech.md)) | SHA-256 and bytes |
| elizaOS | `upstream.lock.json` | git commit |
| Staged resident runtime, with `--packaged-runtime` only: Bun, every bundled agent and workflow-worker npm package, every staged payload file (musl loader, C++ runtime libraries, PGlite) | the staged `assets/agent` payload, its `android-agent-runtime-provenance.json` and `generate-licenses.mjs --packaged-runtime` | SHA-256 of each staged file, checked against the provenance; a bundled package carries the hash of the bundle or the staged `package.json` that holds it |

### Release-candidate document

The default document needs no build. Two options, both offline, extend it on the machine
that built a candidate; `npm run android:build` passes them itself and writes
`artifacts/sbom/alphaphone.cdx.json` beside the APKs it has just verified:

- `--packaged-runtime` reads the staged resident runtime: every staged file under
  `android/app/src/main/assets/agent` and `android/app/src/main/jniLibs` by SHA-256, Bun,
  and every npm package bundled into the agent and the workflow worker with its version
  and licence (the same list as `generate-licenses.mjs --packaged-runtime`). A bundled
  package has no hash of its own: its bytes are inside the bundle files, which are hashed.
  A staged embedding host library or model that differs from its pin is an error.
- `--apks <dir>` reads `apk-manifest.json` from `scripts/verify-apks.mjs` and lists each
  APK with its SHA-256, signer and the `distributable` verdict recorded there. It refuses an
  APK that is missing or no longer matches. A debug APK is always listed as not
  distributable.

Measured on a development machine on 2026-10-11 at elizaOS `13c98575987a` (developer
inputs: an unqualified local speech runtime and an unreviewed local rebuild of the
embedding host, so the four APKs are not distributable): 1,878 components, of which 71
Gradle coordinates, 1,154 staged files, Bun, 550 bundled packages and 4 APKs. That run is
an inventory of one local build, not a release.

What the document still does not do, stated in the document itself:

- It lists an APK by its hash. It does not unpack one; `scripts/verify-apks.mjs` and
  `scripts/verify-packaged-runtime.py` inspect APK contents.
- The engine library, the JNI host and the embedding model carry no licence in this
  inventory ("not recorded", flagged `unverified`).
- Gradle plugin and build-tool artifacts are verified by Gradle but are not SBOM
  components: the SBOM lists what ships.

## Gradle dependency verification

`android/gradle/verification-metadata.xml` holds a SHA-256 for every artifact the Android
build resolves: 514 components and 902 artifacts, covering the 71 shipped coordinates, the
Android Gradle plugin, Kotlin, lint, R8 and the instrumentation libraries. While the file
exists Gradle fails any build of the `android/` project that resolves an artifact not
listed or with a different checksum, so the existing build steps enforce it and no step
was added to any workflow. Metadata files are verified too (`verify-metadata` true).
Signatures are not used and no key server, trusted artifact or trusted key is configured.

It was generated on 2026-10-11 by `npm run android:deps:write-verification`, which runs the
tasks every script uses (the four APKs, both instrumentation APKs, `:app:lint` and the
notification fixture; `VERIFIED_TASKS` in `scripts/gradle-verification.mjs`) with
`--write-verification-metadata sha256`. `aapt2` is the only host-specific artifact; its
Linux and Windows archives were fetched from Google's Maven repository and hashed by the
same command. A second, ordinary strict build then passed with verification enforced on
macOS. No hosted Linux build has run with this file: the first Android foundation run
after it merges is that evidence, and a failure there names the artifact to add.

Review of sources. The root scripts (`settings.gradle` and `build.gradle`, generated into
`android/` from the pinned upstream consumer-host templates by `npm run android:host`)
declare `google()`, `mavenCentral()` and `gradlePluginPortal()` only. The build also
includes the generated app script, Alpha's `android/app/product.gradle` and the modules
`android/consumer-host.json` names, each with a `build.gradle` of its own (the notification fixture, Capacitor from `node_modules` and the plugins from the pinned
upstream checkout), and some of those declare repositories too: the same named ones, Maven
Central by URL (`https://repo.maven.apache.org/maven2`, four upstream plugins) and the
plugin portal by URL (`https://plugins.gradle.org/m2/`, Capacitor's build script). The
check reads every one of those scripts (`buildScripts` in `scripts/gradle-verification.mjs`)
and fails on any other repository, on a `maven { }` block without a literal reviewed URL,
on `flatDir`, `mavenLocal()` and the like, and on an included script it cannot read. The
four upstream plugins take a mirror in place of Maven Central when the root project
defines `mavenCentralMirrorUrl`; nothing in this repository defines it and the check
fails if the host descriptor, the pinned generator or its templates, or a build script here
names it. Someone running Gradle by
hand can still pass that property, which is why the checksum, not the repository list, is
the enforcement.

The 130 publisher groups are listed in `android/gradle/verification-reviewed-groups.json`;
they are Android, Google, JetBrains, Apache and the transitive libraries of the Android
Gradle plugin, lint and the AndroidX test stack, and none was unfamiliar. A component in a
group not on that list fails the check. This was an engineering reading of the list, not a
security sign-off, and the metadata does not record which repository served an artifact.

Enforcement was seen to refuse, in review on 2026-10-11 on the same macOS machine: with the
recorded checksum of the Android Gradle plugin jar changed, `./gradlew --offline help`
failed with "Dependency verification failed for configuration 'classpath'" before any
task ran. Gradle verifies when it reads an artifact file: `:app:dependencies`, which
`generate-licenses.mjs` uses to list the runtime classpath and which resolves no artifact,
passed with a metadata checksum changed, so that command is not a verification point. One
checksum per artifact is accepted; a second value (`also-trust`) fails the check.

Two checks of the recorded values themselves, made in review on 2026-10-11 from the same
macOS machine: all 900 entries Gradle generated match the files in that machine's Gradle
cache, and the 71 shipped coordinates were fetched again directly from their repositories
(61 from Google's Maven repository, 10 from Maven Central) and each hashed to the recorded
SHA-256, as did the three `aapt2` archives. The remaining components (plugins, lint, build
tools and test libraries) were not fetched a second time.

Not covered: the two side projects built with their own Gradle root
(`android/private-peer-fixture`, and the calendar consumer fixture of
`scripts/test-native-calendar-consumer.mjs`) have no verification metadata. Neither ships.

Both branches of the 2026-10-13 merge had generated a metadata file independently; the merge
keeps the one described above (with `scripts/gradle-verification.mjs` and its reviewed groups).
The `:local-speech` project it was generated with has since been removed (P-42), so its entries
for that project are unused; Gradle accepts unused entries, and the next
`npm run android:deps:write-verification` drops them.

## Licence flags (P-09)

Owner decision [P-09](decisions.md#october-10-owner-product-decision) (2026-10-10): an
open-source dependency licence never stops a build and is never a release blocker. Every
licence text and notice still ships, and anything copyleft, unknown or unverified is
flagged with what it obliges. "Included and flagged" is all that is claimed here. It is not
legal review, and nothing here shows that an obligation a flag names has been met.

`scripts/licence-policy.mjs` holds the flags, the classification of licence expressions and
the obligation notes. `scripts/generate-licenses.mjs` applies them.

| Flag | Given to | What the entry's obligation note says |
| --- | --- | --- |
| `copyleft-strong` | GPL, AGPL (also EUPL, OSL) | The licence text and copyright notices ship in the entry; the complete corresponding source must be available at that exact version, at the stated source URL; conditions on a larger work that contains the component are not assessed. |
| `network-copyleft` | AGPL | The source offer extends to people who use the component over a network. |
| `copyleft-weak` | LGPL, MPL, EPL (also CDDL, CPL) | LGPL: text and notices ship, source must be available, and the user must be able to replace the library. MPL and EPL: source of the covered files, with changes, stays available under the same licence. |
| `share-alike-data` | ODbL, CC-BY-SA | Attribution, and a derived database shared publicly keeps the same licence. |
| `unknown-licence` | No licence found, or an identifier that is not recognised | Nothing recorded shows that use is permitted. `license` is `UNKNOWN` when nothing was declared or found. |
| `non-open-source-terms` | A licence file that reserves all rights or limits use, or a manifest that says `UNLICENSED` | These are not open-source terms; P-09 does not cover the item. |
| `licence-text-missing-from-package` | A package with no licence file, or a copyleft package whose file only names its licence | The canonical text held in `licenses/<SPDX id>.txt` is used (`textSource: "spdx-canonical"`) or appended (`"package-and-spdx-canonical"`). |
| `unverified` | Items whose licence is not established from shipped metadata, and packages whose licence was identified from their licence file or README because the manifest declares none | The recorded reason. |
| `permissive-not-previously-listed` | A permissive licence recognised from the SPDX list that was not on the project's earlier accepted list (for example BlueOak-1.0.0, Unlicense) | Its text and notices stay with copies. |
| `proprietary-licence-held-outside-repo` | A bundled proprietary font recorded on the owner's statement that the licence is held outside the repository (Denton) | Proprietary, not open source, not redistributable under an open-source licence; the licence document was not seen; `unresolved-font-licence` reports it resolved-by-owner-statement. |
| `proprietary-no-licence-recorded` | A bundled font that states no open licence and has no record in `licenses/font-licenses.json` (none today) | Proprietary; no licence recorded; reported unresolved by `unresolved-font-licence`. |

With alternatives (`A OR B`) the least encumbered alternative is the one reported. OFL-1.1
fonts are listed without a flag: they ship unmodified.

Where the flags appear:

- `third-party-notices.json`: every entry has `flags`; a flagged entry has `obligations`
  (`[{flag, note}]`).
- `THIRD_PARTY_NOTICES.txt`: a summary before the first entry lists every flagged package
  under each of its flags, and each flagged entry has `Flags:` and `Obligation (...)` lines.
- Build output: `LICENCE FLAG <flag>: <package>@<version> (<licence>)` on standard error
  from `generate-licenses.mjs`, `audit-production-bundle.mjs`, `verify-apks.mjs` and
  `generate-sbom.mjs`. They are warnings; the exit status is not affected.
- `apk-manifest.json`: verify-apks records `licenceFlags` on each APK row from that APK's
  packaged notices. `scripts/release-blockers.mjs` does not read it.
- SBOM: every component has `alphaphone:licence-expression` and `alphaphone:licence-flags`.
- Settings, Open source licenses: a flagged entry shows its flags and obligation notes.

Generation still fails on broken input: a package that is not installed, a `package.json`
that cannot be read, a pinned licence copy or OCR core that no longer matches its recorded
hash, a stale Android classpath snapshot, a malformed font licence record.

### Run on the staged resident runtime

On 2026-10-10, at upstream pin `40dbe96bd1`, the runtime was prepared, the workflow worker
built and the payload staged (`npm run agent:prepare`, `agent:build-workflow-worker`,
`agent:stage-android`), and `node scripts/generate-licenses.mjs --packaged-runtime` ran on
it. Before P-09 this command stopped on 24 entries. Result: exit 0, 660 entries, of which
550 are npm packages bundled into the agent or the workflow worker (518 package directories
named by the agent bundle and 53 workflow-worker dependencies, 550 distinct name and version
pairs, none missing), no entry without text, 66 entries flagged. This is notice generation
on a staged payload on a development machine. No APK was built from it, and the packaged
notices were not committed: the committed notices are the form without a staged runtime
(109 entries, 15 flagged), which `test/licenses.test.mjs` checks byte for byte.

| Flag | Entries (660 total) |
| --- | --- |
| `copyleft-strong` | 3 |
| `network-copyleft` | 1 |
| `copyleft-weak` | 3 |
| `share-alike-data` | 1 |
| `unknown-licence` | 1 |
| `non-open-source-terms` | 1 |
| `licence-text-missing-from-package` | 35 |
| `unverified` | 24 |
| `permissive-not-previously-listed` | 2 |
| `proprietary-no-licence-recorded` | 1 |

That run predates the Denton record below: Denton was then the one
`proprietary-no-licence-recorded` entry. With the record it is the one
`proprietary-licence-held-outside-repo` entry instead; the totals do not change. The run
was not repeated after the record was added.

An entry can carry more than one flag, so the column adds up to more than 66.

The 24 entries that used to stop the command, as they are now listed:

| Package | Licence | Flags |
| --- | --- | --- |
| `ffmpeg-static` 5.3.0 | GPL-3.0-or-later | `copyleft-strong` |
| `ua-parser-js` 2.0.10 | AGPL-3.0-or-later | `copyleft-strong`, `network-copyleft` |
| `rpc-websockets` 9.3.10 | LGPL-3.0-only | `copyleft-weak`, `licence-text-missing-from-package` (its licence file only names the LGPL; the LGPL and GPL texts are appended) |
| `sax` 1.6.1 | BlueOak-1.0.0 | `permissive-not-previously-listed` |
| `@metamask/sdk` 0.33.1 | UNKNOWN | `unknown-licence`, `non-open-source-terms` |
| `exif-parser` 0.1.12 | MIT, identified from its licence file | `unverified` |
| `text-encoding-utf-8` 1.0.2 | Unlicense, identified from its licence file | `unverified`, `permissive-not-previously-listed` |
| `@lit-labs/ssr-dom-shim` 1.6.0 | BSD-3-Clause | `licence-text-missing-from-package` (canonical text used) |
| 16 `@smthrs/*` 0.35.0 packages (agents, components, db, driver, engine, errors, graph, memory, observability, react-reconciler, sandbox, scheduler, scorers, time-travel, tool-context, vcs) | MIT, identified from each package's licence file | `unverified` |

`@metamask/sdk` is not open source. Its licence file (ConsenSys Software Inc., "All rights
reserved") grants a licence for non-commercial use only, with a limit on monthly active
users. P-09 rests on the dependencies being open source, so it does not cover this package.
It is listed with its own terms, flagged, and not blocked; whether the product may ship it
is an open question for the owner, and removing it from the agent bundle would be an
upstream elizaOS change. It was not assessed here.

That upstream change exists: the shared mobile agent build
(`packages/agent/scripts/mobile-wallet-connectors.ts`) resolves wagmi, RainbowKit and every
`@metamask/*` specifier to the mobile stub, so the wallet-connector closure, including
`@metamask/sdk`, is not bundled. An Android mobile bundle built from that change contained no
MetaMask SDK source. The licence inventory above predates it; regenerate the notices from a
runtime staged at that pin (`npm run agent:stage-android`, then the licence generator) and
`test/wallet-disabled.test.mjs` asserts the staged inventory lists no `@metamask/*`, wagmi or
`@rainbow-me/*` package.

Bun is flagged `copyleft-weak` as well as `unverified` because it statically links
JavaScriptCore (LGPL). The other copyleft entries (`mediabunny`, MPL-2.0; the pdf.js
Liberation fonts, GPL-2.0-only with the font exception) are in the committed notices too.

## Denton typeface (MVP-43)

`apps/app/public/denton-300.woff2` (SHA-256 `7e9341445b0bf2ec7f75e4a5d4dd4a677e9d2341f67ddcf766db92a21f310e05`)
is a commercial face imported from the design prototype. Its metadata says "All rights
reserved" and names no licence. It is proprietary, not open-source software, so the
open-source part of decision P-09 does not cover it.

Decision A-21 is closed. On 2026-10-10 the owner stated that Alpha Compute owns the Denton
font and that the licence is not in this repository, and that the font check is flag-only
([P-09](decisions.md#october-10-owner-product-decision)). The font was not replaced.

What is recorded is that statement, in `licenses/font-licenses.json`:

```json
{"name": "Denton typeface", "sha256": ["7e93…0e05"], "license": "LicenseRef-Commercial-Font",
 "evidence": "held-outside-repository", "holder": "Alpha Compute (owner statement, 2026-10-10)",
 "basis": "owner states the licence is held; the licence document is kept outside this repository",
 "recordedOn": "2026-10-10"}
```

No licence document, name, number, date, scope or terms is in the repository, and none was
seen in this work. The record has no field for them and none was invented. Consequences:

- The notice entry has the licence `LicenseRef-Commercial-Font`, says the face is
  proprietary and not redistributable under an open-source licence, prints the holder, the
  basis and "Evidence: held outside this repository", and is flagged
  `proprietary-licence-held-outside-repo`. It prints as a `LICENCE FLAG` line.
- The SBOM component carries the same licence and flag, `alphaphone:open-source` `false`
  and `alphaphone:licence-evidence`.
- The record covers only the listed bytes. Another font file, or a changed Denton file, is
  not covered by it.

The one follow-up that would complete the record: a reference to the licence document
(where it is held or its register entry; never the document itself, and no secrets) in a
`reference` field of the record. The notice then prints it. This is optional and blocks
nothing.

### Where Denton is referenced

| Place | Reference |
| --- | --- |
| `apps/app/src/prototype/prototype.css` line 7 | The only `@font-face` for `Denton`; the only URL for the file |
| `apps/app/src/prototype/prototype.css` line 8 | `.serif{font-family:'Denton','Fraunces',Georgia,serif;font-weight:300}`; `.serif` is used 89 times in `template.html` |
| `apps/app/src/prototype/phone.css` | Content-question dialog headings use the existing Denton font; no additional font file is loaded. |
| `apps/app/src/prototype/scan-dialog.css` | Shared document and media-review headings use the same existing Denton font. |
| `apps/app/src/prototype/template.html` | 36 inline `Denton, Fraunces, Georgia, serif` stacks, and one `Denton, Georgia, serif` (line 1275) |
| `apps/app/src/prototype/asset-manifest.json` | Source URL, size and hash of the file |
| `licenses/font-licenses.json` | The owner-statement record for "Denton typeface", by exact hash |
| `apps/app/public/licenses/` | Generated notice entry flagged `proprietary-licence-held-outside-repo` |
| `scripts/generate-licenses.mjs` | Reads every font under `apps/app/public`; no Denton-specific code |
| `config/alpha-product.json` | The product theme's display stack (Denton/Fraunces/Georgia), read by the shared mobile shell's Home and All apps |
| `scripts/prototype-capture.mjs` line 111 | Records `document.fonts.check('300 30px Denton')` in capture output |
| `test/licenses.test.mjs`, `test/font-license.test.mjs` | Use Denton as the proprietary-font example |

There is no preload link. `apps/app/index.html`, the Vite configuration, the bundle audit
denylist and the Android project do not name Denton. `design-assets/` and `design/` hold
reference copies that are not built into the product.

### Fraunces is not yet a complete fallback

Fraunces is bundled and licensed under OFL-1.1 (verified from the font files' own name
tables and listed in the notices), but only as two **italic** faces, weights 300 and 400
(`apps/app/public/fonts/25bae1ffe157fa448306.ttf`, `c3c6d103fb2c49381256.ttf`). They exist
for the italic alpha mark, which Denton cannot draw.

Rendered in headless Chromium with the Denton rule removed, the upright `.serif` stack
resolves to Fraunces Italic: 40px sample text measured 451.5px, identical to explicit
Fraunces Italic, against 426.7px in Denton. With no upright face declared, the browser
uses the italic one. An upright Fraunces 300 (`@fontsource/fraunces`, already a
devDependency, OFL-1.1) measured 484.6px, 13.6% wider than Denton, so headings need a
layout recheck either way.

For this reason there is no build-time switch. A switch would also make the committed
notices disagree with the packaged bytes, and the notices are checked byte for byte
against `apps/app/public`.

### If the font is ever replaced

Replacing Denton with Fraunces was the alternative under A-21. It was not chosen. The facts
above about Fraunces stand if it is revisited: an upright Fraunces 300 face would have to be
added (`apps/app/public/fonts/`, `prototype.css`, `asset-manifest.json`), line 7 of
`prototype.css` and the font file removed, the Denton record deleted from
`licenses/font-licenses.json`, the notices regenerated, and heading layout and the visual
baselines rechecked.

### The font check

`scripts/font-license-blockers.mjs` runs the one separately named licence check,
`unresolved-font-licence`, on a built payload. It sorts proprietary fonts into two lists:

- Resolved by owner statement: a file with the bytes recorded in `licenses/font-licenses.json`
  under evidence `held-outside-repository`, wherever it sits and whatever the notices say; or
  a typeface the payload's notices flag `proprietary-licence-held-outside-repo`, when the
  listed file still has the listed hash.
- Unresolved: a typeface the notices flag `proprietary-no-licence-recorded` (or carry the
  earlier `license unverified` marking), a listed font file whose bytes no longer match the
  hash its notice lists, or a file with the bytes of a font listed by hash in
  `licenses/unverified-allowlist.json`. A different or swapped font file is therefore
  reported as unrecorded.

Open-source licence flags are never part of this check.

Whether an unresolved font blocks is one constant, `UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION`
in `scripts/licence-policy.mjs`. Its default is `false` (the owner's "flag only"). Setting it
to `true` makes the check strict again.

| | `false` (default) | `true` |
| --- | --- | --- |
| Check runs and is recorded on each APK row (`fontLicenceCheck`: `status`, `items`, `resolved`) | yes | yes |
| Denton as recorded: `LICENCE FLAG (reported, not blocking) unresolved-font-licence: resolved-by-owner-statement: …` | printed, not blocking | printed, not blocking |
| A font with no record: line printed | `LICENCE FLAG (reported, not blocking) unresolved-font-licence: …` | `RELEASE BLOCKER unresolved-font-licence: …` |
| A font with no record: row `licenceBlockers` | empty | the unresolved items |
| A font with no record: release `distributable` | not affected | `false` |
| A font with no record: `scripts/release-blockers.mjs` (provisioning, pilot update, AOSP staging, head qualification) | does not name it | names it and refuses the release |

- `scripts/verify-apks.mjs` never fails verification because of the check, under either
  setting.
- `scripts/audit-production-bundle.mjs` prints the same lines for `web-dist` and still
  passes.

Both settings are covered by unit tests of the shared functions
(`test/font-license.test.mjs`) and the verify-apks wiring by source assertions; neither has
been run against built APKs in this change.

Two other entries of the committed notices are `license unverified` (the resident runtime
payload and the pdf.js QuickJS sandbox; the retired speech engines' entries were removed with
those engines under P-42). Once the voice-host record exists, the elizaOS voice sources fused
into libelizainference and any model without a verified licence are also `unverified`. They are flagged `unverified`, are not
fonts and are not reported by this check. Under P-09 they block nothing; they have not been
reviewed.

## Required checks (MVP-46)

`scripts/ci/read-required-checks.mjs` reads the active rules for the default branch, every
ruleset and classic branch protection with `gh api --method GET`, and diffs the enforced
status checks, their integration binding, the up-to-date policy, enforcement, target and
bypass actors against `scripts/ci/required-checks-ruleset.json`. It changes nothing. It
exits 0 on a match, 1 on differences and 2 when the state cannot be read.

Read-back on 2026-10-10: only "Default branch baseline" is active (`deletion`,
`non_fast_forward`, `pull_request`). "Main required checks" is not installed, so none of
"Repository verification", "Browser MVP result" and "Android foundation result" is
required. Installing it is the owner's step ([ci-cost-policy.md](ci-cost-policy.md)). A
matching read-back is configuration evidence only; MVP-46 also needs a controlled pull
request showing that a missing or failing check blocks the merge.

## October 21 resident pin and registry refresh

SDK `3d6f68a129702a1a2779cc087c93a80ba0f2332e` changes Android service
lifecycle code and its tests from `5c36344786274ce1a0b0e2ebcb560bc2da6ac0ab`.
The upstream `bun.lock` and every package manifest are byte-identical. The existing
`node scripts/dependency-audit.mjs --resident --write` command queried the registry
on 2026-10-21 for the same 3691 versions (normalized input SHA-256
`e988789dc9267ab121df8114f3dd79d88a69c7de34545ec9024cba42f80bf85e`).
The fresh result is 113 findings: 1 critical, 48 high, 49 moderate and 15 low;
15 finding rows covering 12 advisory IDs are new since the October 20 snapshot.
Old exception review dates and deadlines remain unchanged.

The existing packaged notices collector was also run read-only against the freshly
staged SDK 3d runtime and worker: 674 entries, zero errors or warnings.
`@modelcontextprotocol/sdk`, `follow-redirects` and `vite` are absent; the nine new
advisory IDs for those packages have short-lived non-shipping exceptions.
Hono 4.13.9 and markdown-it 14.3.2 are present. Their new advisories
GHSA-5r4p-p66f-jhc7, GHSA-gfr2-rv44-r23c and GHSA-vfgh-jcmw-g37q remain
unexcepted in `pendingUpstreamFixes`, pending upstream remediation or actual
vulnerable-path review. In particular, the shipped high markdown-it finding cannot
receive an exception. The dedicated resident audit therefore remains red; the
offline repository test permits these explicitly recorded pending findings using
its existing policy. No assertions or audit rules were relaxed.

This is registry and staged package inventory evidence, not an audited APK,
installed runtime, release qualification or physical-device result. Historical
review sections above retain their original pins and evidence limits.

The complete 674-entry collector result (including its empty errors/warnings arrays),
serialized as two-space JSON with a trailing newline, has SHA-256
`5fa9162fe4bbadc998e6427db89a27b7b1542baed3d0305a470e0390559627ec`.
The previous SDK5c record had no pending upstream fixes; none was dropped. Its
98 advisory rows remain in the fresh 113-row result; all 84 retained exceptions
and their deadlines are byte-for-byte unchanged. Only the newly reported shipped
Hono and markdown-it advisories add pending fixes.

## SDK 5c1d source refresh (2026-10-21)

The official resident full-lock audit at SDK `5c1d7e4440e69e09241cad833f5626ebb886ba1a`
queried the registry again and returned the same 113 findings across 3691 versions,
with normalized input `e988789dc9267ab121df8114f3dd79d88a69c7de34545ec9024cba42f80bf85e`.
All existing exceptions, pending findings and deadlines are retained unchanged.
Their earlier staged-package evidence remains scoped to the recorded SDK 3d payload;
new preparation/staging and its exact packaged notices audit have not run.
The dedicated full-lock audit remains red on the three documented pending findings.
No new packaged-runtime, APK or device acceptance is inferred from the refreshed pin.

## Resident dependency repair source candidate (2026-10-21)

SDK `cadacd7afa697851bd08f5574e7b2b00c9d3a446` normally merges the reviewed
Hono/markdown-it dependency repair with SDK5c1d's native fixes. The official
`node scripts/dependency-audit.mjs --resident --write` queried the registry for
3691 package versions and reports110 findings:1 critical, 47 high, 48 moderate, 14 low.
The only removed rows are GHSA-5r4p-p66f-jhc7 (Hono), GHSA-gfr2-rv44-r23c and
GHSA-vfgh-jcmw-g37q (markdown-it). All 110 retained finding rows are byte-identical
to the previous snapshot. Their 93 exceptions and original review/deadline objects
are unchanged. The three resolved rows are removed from pendingUpstreamFixes;
no exception or audit rule was added or relaxed.

This is fresh full-lock registry evidence. Historical staged inventory evidence
above does not establish the new candidate's shipped package versions. Exact-pin
dependency installation, normal runtime/worker preparation, packaged subset audit,
and both APK/runtime qualification remain required. Source-only generated notices
are attribution data and do not prove that a repaired dependency is packaged.

## PGlite snapshot source admission (2026-10-21)

SDK `405cc18f3b11f0b56e3f807e25c78ce357263b1f` changes the PGlite snapshot reader and its tests after CAD.
Its `bun.lock` and every package manifest are unchanged from CAD. Existing advisory
exception objects, deadlines and historical staged-set evidence remain unchanged.
The actual official `node scripts/dependency-audit.mjs --resident --write` queried
the registry at this new pin and returned exactly the same110 finding rows across
3691 package versions (1 critical,47 high,48 moderate,14 low). The resident snapshot
and disposition pin were refreshed after this comparison; no exception was added
or renewed. No new provider call or packaged-subset result is claimed. Fresh
exact-pin preparation and package verification remain required.

### Local SDK public-read/usage source admission — 2026-10-21

An actual `node scripts/dependency-audit.mjs --resident --write` refresh at `3e4c3c447e813080777aa4f6dcd4a6ee494f6fc5` returned the same 3691 package versions and 110 finding rows (1 critical, 47 high, 48 moderate, 14 low) as405. The normalized lock input and all 93 exception objects, original dates/deadlines and pending rows are unchanged. Re-review updates only the current source binding/description; no exception is renewed. Prior source receipt/dispositions are preserved in Git history and external exact-preimage review artifacts. This is source-registry evidence; no new prepared runtime, packaged-subset audit, provider or device result is claimed. See [source admission evidence](evidence/sdk-public-reads-usage-source-20261021.json).


### Development-tool source audit — October21, SDK bdacc0709c

Normal root and resident registry audits were refreshed after Alpha Vite8.3.3 and the reviewed SDK development-tool update ([Eliza #37226](https://github.com/elizaOS/eliza/pull/37226)). The root audit retains its three reviewed moderate findings. The new resident lock input has3691 package versions and104 findings:1 critical,45 high,44 moderate,14 low. This removes12 rows from the immediately preceding fresh116-row audit: the six newly reported Storybook/Vite rows plus six older Vite rows. Compared with the historical110-row snapshot, every retained104 row is identical. Three stale Vite exceptions were removed; the90 remaining exception objects and original dates/deadlines were preserved exactly. No new exception was added or renewed.

The Bun lock and normalized input hash changed. The old raw/normalized input equality receipt is historical and is not reused. This is a full-source-lock registry audit, a superset of the mobile payload; it does not establish a freshly staged runtime, packaged-subset audit, APK, provider response or device acceptance. Fresh normal runtime preparation and installed qualification remain required. See [source admission](evidence/sdk-dev-tool-source-admission-20261021.json).

### October 27 test dependency refresh

The shared Notes consumer changes the npm lockfile, so the audit was regenerated. The fresh audit identified Undici 8.11.2 under the development-only jsdom dependency. The lockfile now resolves 8.12.3 within jsdom's existing `^8.11.2` range. The upstream patched threshold is 8.12.2 for [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472), and [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c). The new audit contains the same three moderate findings covered by the existing Capacitor/xcode/uuid disposition and no high or critical findings. No exception or review deadline was expanded.
The shared installed-app launcher receives Alpha's existing Denton/Fraunces/Georgia
font stack from the product theme in `config/alpha-product.json`. This adds no font file
or download: `prototype.css` remains the sole Denton loading rule. The owner-stated
commercial license record and the open/system fallback stack are unchanged.
