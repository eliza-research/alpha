# #674 Licence review packet and the `@metamask/sdk` decision

Issue: [#674](https://github.com/eliza-research/alphaphone/issues/674) (human actions H-35 and
H-06; requirements AP-02, AP-13; umbrellas #381, #400).

**This is not legal advice.** It is an engineering record of what the notices, the SBOM, the
verify-apks rows, the staged agent bundle and the upstream source show, prepared so the owner or
counsel can review it. A licence flag is a record of what was found, not a clearance. Nothing here
shows that any obligation is met. Only the owner or counsel can make the review and the decisions.

## Owner decision recorded (2026-10-29)

The owner decided H-06: **the resident runtime ships `@metamask/sdk` 0.33.1, and the owner accepts
its terms.** That settles decision 1 below as option (b). It changes this packet as follows:

- The MetaMask stub is dropped from the draft upstream change. Option A now covers only the
  `ffmpeg-static` wrapper, and it is optional.
- The acceptance covers version 0.33.1 only. The probe lists it under "Owner acceptances". If a
  pin update resolves another version, the probe reports `version-not-covered`, and the owner
  decides again.
- The notices keep flagging the package (`unknown-licence`, `non-open-source-terms`). Under P-09
  flags never block. The flag records what was found, and the owner's decision records why it ships.
- The owner now carries the call on whether a commercial phone fits ConsenSys's terms, including
  the non-commercial clause and the monthly-active-user limit. Nothing here assesses that.
- H-35, the review of the copyleft flags, is still open. It is decisions 3 to 8.

## What was prepared

- `scripts/owner/licence-review.mjs`: a read-only probe that builds the review packet. It reads
  files and git objects, writes nothing and contacts no service. Test:
  `test/owner-licence-review.test.mjs`.
- This runbook: the per-package summary, the `@metamask/sdk` dependency path at the current pin,
  a draft upstream change (not applied, no vendor edits), decisions and draft decision entries.

```sh
# Newest archived packaged-runtime notices (default) plus the verify-apks rows in the evidence file
node scripts/owner/licence-review.mjs --apk-manifest docs/evidence/merge-build-final-apks-v17-2026-10-27.json

# After npm run android:build:local: the fresh staged bundle, APK, apk-manifest and SBOM
node scripts/owner/licence-review.mjs \
  --notices apps/app/public/licenses/third-party-notices.json \
  --apk-manifest artifacts/apk-manifest.json --sbom artifacts/sbom/alphaphone.cdx.json \
  --bundle android/app/src/main/assets/agent/agent-bundle.js \
  --apk artifacts/launcher-release-unsigned.apk

# Source chain at the pin, from git objects only (no checkout of vendor/eliza needed)
node scripts/owner/licence-review.mjs --eliza-git-dir .git/modules/vendor/eliza --pin "$(node -p 'require("./upstream.lock.json").commit')"
```

`--json` prints the packet as JSON. Absolute build-host paths found in a bundle are counted,
never printed.

## Evidence used, and what it is

| Input | What it is | What it is not |
| --- | --- | --- |
| `licenses/packaged-runtime/fd5511ca…/third-party-notices.json` (722 entries, 83 flagged) | Archived notices from the strict version 17 APK build at upstream `fd5511ca` | Not the current pin `1f2a922f`; no device or release evidence |
| `docs/evidence/merge-build-final-apks-v17-2026-10-27.json` | verify-apks rows for 4 APKs (standalone and launcher, debug and release), each with `licenceFlags` (83 flagged), `licenceBlockers: []`, Denton `resolved-by-owner-statement` | APK build evidence only |
| A local SBOM (`artifacts/sbom/alphaphone.cdx.json`, 2026-10-24, 1,909 components) | CycloneDX output of `generate-sbom.mjs` on that day's APKs | Older than the current pin; not committed |
| A local staged agent bundle and APKs at upstream `00ee6397` (2026-10-24) | Static reading of `agent-bundle.js` (module headers, `__esm` init graph) and the APK entry list | Never run here. Static analysis is not runtime observation. `00ee6397` is an ancestor of the pin |
| Upstream git objects at the pin `1f2a922f` (2026-10-28) | `bun.lock`, `packages/ui`, `packages/agent/scripts/build-mobile-bundle.ts`, `plugins/plugin-discord` | Source only; nothing built at this pin for this packet |

At `00ee6397`, `fd5511ca` and `1f2a922f` the lockfile resolves the same versions
(`@metamask/sdk` 0.33.1, `ffmpeg-static` 5.3.0, `ua-parser-js` 2.0.10, `rpc-websockets` 9.3.10),
and the three source facts the chains rest on (the `@elizaos/ui` barrel pin in the mobile
bundler, the barrel's wallet re-export and the `plugin-discord` dynamic import) are present at
all three. No packaged-runtime notices exist yet for `1f2a922f`. The next
`npm run android:build:local` makes them, and the probe should be re-run on them.

## How `@metamask/sdk` gets into the resident agent bundle (pin `1f2a922f`)

Lockfile path: `packages/ui` depends on `wagmi` ^2.19.5 and `@rainbow-me/rainbowkit` ^2.2.11.
`wagmi@2.19.5` depends on `@wagmi/connectors@6.2.0`, which depends on `@metamask/sdk@0.33.1`.
Nothing else in `bun.lock` requires `@metamask/sdk`, which matches H-06.

Import path into the Android bundle:

1. `packages/agent/scripts/build-mobile-bundle.ts` pins `@elizaos/ui` to the whole barrel
   `packages/ui/src/index.ts` (`dedupeTargets`) for the mobile bundle.
2. The view plugins the phone uses import from `@elizaos/ui`: `plugin-inbox` (2 files),
   `plugin-notes` (4), `plugin-maps` (4), `plugin-calendar` (11), `plugin-todos` (2) and
   `plugin-agent-orchestrator/ui`.
3. The barrel re-exports `createDefaultWagmiConfig`, `EVMWalletProvider` and
   `LoginFormWithWallets` from `./login/wallet.js` (`index.ts` lines 913 to 918).
4. `login/wallet.tsx` imports `login/EVMProvider.tsx`, which imports RainbowKit and
   `metaMaskWallet` from `@rainbow-me/rainbowkit/wallets`, plus `wagmi`.
5. RainbowKit's MetaMask wallet uses the `metaMask` connector of `@wagmi/connectors`, and
   `@wagmi/connectors/dist/esm/metaMask.js` loads `@metamask/sdk` with a dynamic import. Bun
   bundles dynamic imports too, so the SDK's code is in `agent-bundle.js`.

What runs: in the `00ee6397` bundle, the SDK's module body is initialised only inside the
connector's `getProvider()` (`await Promise.resolve().then(() => init_metamask_sdk())`), that
is, when someone connects a MetaMask wallet in a rendered wallet UI. The agent is headless and
renders no wallet UI. Static init-graph analysis found no eager path to it. **So the SDK ships
(its bytes are distributed in every APK) but is not expected to execute.** Its licence terms
are about distribution and use, so the fact that it ships is what matters.

The same barrel path also brings in `@coinbase/wallet-sdk`, `@base-org/account`, Solana wallet
adapters, `@solana/web3.js` (and with it `rpc-websockets`) and `ua-parser-js` (through
RainbowKit). Wallet is outside the MVP (P-38).

## Is `ffmpeg-static` reachable on the phone?

- **Path:** `packages/agent/src/api/inbox-routes.ts` dynamically imports `@elizaos/plugin-discord`.
  Bun bundles it. `plugin-discord` depends on `prism-media` 1.3.5, whose `FFmpeg.getInfo()` tries
  `require('ffmpeg-static')` first and then `ffmpeg` and `avconv` on `PATH`. (`plugin-video`,
  which also depends on `ffmpeg-static`, is stubbed out of the mobile bundle.)
- **What ships:** only the `ffmpeg-static` JavaScript resolver (about 40 lines, GPL-3.0-or-later
  per its manifest). The package's install script downloads an ffmpeg executable for the *build
  host*. That executable is not staged. No ffmpeg, ffprobe or libav* file is in the local APKs
  (`unzip -Z1` of `standalone-release-unsigned.apk` and `launcher-release-unsigned.apk`: 2,009
  entries, 12 native libraries, none FFmpeg). In the bundle, the resolver returns a path under the
  build machine's `node_modules`, which does not exist on a phone.
- **When it would run:** only if Discord voice is used (prism-media `FFmpeg`). Discord is deferred
  in the MVP (implementation plan). Even then it finds no binary and falls through to `PATH`,
  which has no ffmpeg on Android.
- **Conclusion:** the GPL JavaScript wrapper ships. It is practically unreachable and finds no
  binary if reached. No GPL ffmpeg binary ships (APK-build evidence at `00ee6397`; re-check at the
  current pin with `--apk`).

## Is `ua-parser-js` reachable on the phone?

- **Path:** the `@elizaos/ui` barrel (see above), then `login/EVMProvider.tsx`, then
  `@rainbow-me/rainbowkit` 2.2.11, which depends on `ua-parser-js` ^2.0.9 (resolved 2.0.10).
- **What runs:** RainbowKit's `dist/index.js` calls `UAParser()` while the module initialises.
  In the `00ee6397` bundle that initialisation is lazy. It is not on the eager boot graph (12 boot
  roots, 1,948 of 6,976 modules initialised eagerly), but it is reached once the runtime loads a
  UI-bearing plugin barrel. For example: `plugin-inbox/src/index.ts`, then `InboxSpatialView.tsx`,
  then `ui/src/index.ts`, `ui/src/login/wallet.tsx`, `EVMProvider.tsx`, RainbowKit, and
  `ua-parser-js`. The bundler's own comment says Android imports those barrels and runs their
  module initialisation, and Notes and Inbox are product features.
- **Conclusion:** `ua-parser-js` (AGPL-3.0-or-later) ships and **probably executes on the phone**
  (one `UAParser()` call at RainbowKit module initialisation, its result unused by the agent).
  This comes from static bundle analysis and has not been observed on an emulator or device. The
  AGPL's network clause (section 13) is about modified versions that users interact with
  remotely. The copy here is unmodified and runs locally. That reading is for counsel to confirm.

## Per flagged package

The licence and flags below are from the v17 packaged notices. "Ships" means present in the APK
payload (APK-build evidence). Remediation options are engineering options, not advice.

| Package | Licence (as flagged) | How it is used | Ships? | Obligation the notice names | Remediation options |
| --- | --- | --- | --- | --- | --- |
| `@metamask/sdk` 0.33.1 | ConsenSys proprietary terms, "All rights reserved"; non-commercial use with a monthly-active-user limit. Flags `unknown-licence`, `non-open-source-terms` | MetaMask connector of the `wagmi` and RainbowKit wallet login in the `packages/ui` barrel | Yes, in the agent bundle in every APK. Not expected to execute | P-09 does not cover it. Whether the product's use fits the terms has not been assessed | (1) Drop it from the agent bundle upstream (draft below). (2) Get a commercial licence from ConsenSys. (3) Ship it as is under its terms (owner or counsel must find that the use fits them) |
| `ffmpeg-static` 5.3.0 | GPL-3.0-or-later; `copyleft-strong` | prism-media's FFmpeg resolver in `plugin-discord` voice | The JS resolver only. No binary | Licence text ships. Corresponding source at that version must be available. Effect on the larger work not assessed | (1) Stub `ffmpeg-static` in the Android mobile bundle (draft below; prism-media already tolerates its absence). (2) Accept, with a source offer for the JS |
| `ua-parser-js` 2.0.10 | AGPL-3.0-or-later; `copyleft-strong`, `network-copyleft` | RainbowKit device detection, run at module initialisation | Yes. Probably executes (static analysis) | Licence text ships. Source at that version must be available. Network-use source offer | (1) Barrel split upstream, so the agent bundle no longer contains RainbowKit (draft below). (2) Pin RainbowKit to a release without it, if one exists (not checked). (3) Accept, with a source offer (unmodified, upstream source public) |
| `rpc-websockets` 9.3.10 | LGPL-3.0-only; `copyleft-weak`, `licence-text-missing-from-package` | `@solana/web3.js` websocket client (Solana wallet code in `packages/ui`) | Yes, bundled into one JS file | Text ships (canonical LGPL and GPL appended). Source must be available. The user must be able to replace the library | (1) Barrel split drops it. (2) Accept: the bundle is unminified JS and the source is public. Whether a signed, bundled APK meets "replaceable" is for counsel |
| Bun 1.4.2 (`libeliza_bun.so`) | MIT, with JavaScriptCore statically linked (LGPL-2.0/2.1-or-later); `copyleft-weak`, `unverified` | Runs the resident agent | Yes, a native library | LGPL relink obligation for a statically linked library, and a written source offer valid for at least 3 years. Both are unconfirmed (`packaged-runtime-allowlist.json`) | (1) Publish the Bun `744846f8` and oven-sh/WebKit revisions with build and relink instructions, and add a written offer to the notices. (2) Counsel confirms what "relink" requires for a static build |
| eSpeak NG 1.52.0 (code statically linked into `libelizainference`, and English data in the voice bundle) | GPL-3.0-or-later; `copyleft-strong`, `licence-text-missing-from-package` | Out-of-lexicon G2P fallback for Paradee TTS (P-54) | Yes: `libelizainference.so` and `tts/paradee/espeak-ng-data/*` | Text ships. Complete corresponding source of the component must be available. Static linking makes `libelizainference` a combined work; its effect on the larger work has not been assessed | (1) Offer the complete source of `libelizainference` at the recorded llama.cpp fork `0d9fd4b9` and eliza revisions, under GPL-compatible terms (its other parts are MIT and Apache-2.0). (2) Load eSpeak NG as a separate shared library. (3) Replace it with a non-GPL OOV fallback (product trade-off; P-54) |
| Phonon-2 ASR weights (`asr/phonon-2-fv5.gguf`) | CC-BY-4.0 (from NVIDIA Parakeet-TDT 0.6B v3); `unverified`, `permissive-not-previously-listed` | On-device ASR (P-55) | Yes | Attribution, licence link and an indication of changes (the NOTICE and licence ship). Training-data terms named in the NOTICE: CHiME-6 (CC-BY-SA-4.0) and SPGISpeech (Kensho's terms) | Counsel decides whether the training-data terms reach the distributed weights. Keep the NOTICE visible in Settings |
| OpenStreetMap data (Maps service) | ODbL-1.0; `share-alike-data` | Regional extract served by the configured Maps endpoint | No. Served over the network | Attribution in the app ("© OpenStreetMap contributors"). Any derived database the operator publishes keeps ODbL | The Maps service operator makes sure attribution is shown (H-16) and handles share-alike for any published derived database |
| `url-template` 2.0.8 | Declared "BSD" (not an SPDX id); the text is BSD-3-Clause. `unknown-licence` | Through `googleapis-common` | Yes | Not an open question in substance: BSD-3-Clause text ships | Optional: a recorded licence override so it classifies as BSD-3-Clause |
| Google Play services and Identity client libraries (10 Android artifacts) | No licence in their POMs; `unknown-licence` | Android sign-in (auth, fido, identity-credentials, googleid) | Yes, in both distribution variants | Google's Android SDK terms, not open source. P-09 does not cover them | Not in #674's list. Owner or counsel notes them alongside H-06 |
| Denton typeface | Proprietary; `proprietary-licence-held-outside-repo` | Product display face | Yes | Recorded on the owner's statement (A-21) | Optional `reference` field in `licenses/font-licenses.json` (step 3 of the issue) |
| Also flagged in the committed notices: `mediabunny` (MPL-2.0, renderer) and the pdf.js Liberation fonts (GPL-2.0 with the font exception) | file-level and font copyleft | Renderer | Yes | Text ships; unmodified | None needed beyond the source availability noted in the entries |

## Draft upstream elizaOS change (not applied)

Since the 2026-10-29 decision, the `@metamask/sdk` lines below are kept for the record only and
are **not** part of the proposed change. The package ships by the owner's decision.

These are scoped for review. Nothing in `vendor/eliza` was edited. The change would land
upstream and come in through a pin update, or as an explicit tested patch under
`patches/eliza`.

**Option A, minimal (drops `@metamask/sdk` and the `ffmpeg-static` wrapper from the Android
bundle).** In `packages/agent/scripts/build-mobile-bundle.ts`, `nativeStubs`:

```ts
  // The MetaMask SDK is reached only through @wagmi/connectors' lazy
  // `import("@metamask/sdk")` inside the wallet login UI, which the headless
  // agent never renders. It is proprietary (non-commercial terms), so keep it
  // out of the on-device bundle; getProvider() then fails loudly if ever called.
  "@metamask/sdk": path.join(stubsDir, "null-plugin.ts"),
  // prism-media tries ffmpeg-static first and falls back to PATH; a phone has
  // no ffmpeg-static binary (its install step downloads one for the build host).
  "ffmpeg-static": path.join(stubsDir, "unavailable-module.ts"),
```

`unavailable-module.ts` throws on load (`throw Object.assign(new Error("unavailable in the
mobile runtime"), {code: "MOBILE_CAPABILITY_UNAVAILABLE"})`). prism-media calls the resolver
inside `try`, so it falls through. Acceptance criteria: `plugins-manifest.json` and the
alphaphone agent-bundle inventory no longer list `@metamask/sdk`, `@metamask/sdk-*` or
`ffmpeg-static`; the regenerated packaged notices drop those entries; the mobile bundle smoke
tests and the alphaphone resident tests still pass. Upstream should check that `null-plugin.ts`
satisfies the connector's named import (`MetaMaskSDK`) at bundle time; if not, add a dedicated
stub that exports a throwing `MetaMaskSDK` class.

**Option B, structural (also drops `ua-parser-js`, `rpc-websockets`, RainbowKit, `wagmi`,
`@coinbase/wallet-sdk` and the Solana wallet stack from the agent bundle).** Move the wallet
exports out of the `@elizaos/ui` root barrel (`index.ts` lines 857 to 918:
`EVMProvider`, `wallet.js`, `WalletLogin`, `LoginFormWithWallets`, `LoginConnectOrCreateWallet`)
to a subpath export such as `@elizaos/ui/wallet`, and update the app and cloud importers. Or,
as an Android-only measure, alias `./login/wallet.js` and `./login/EVMProvider.js` to throwing
stubs in the mobile bundler. Option B is a larger upstream change to a shared package. It needs
the upstream owners' agreement and a renderer build check for every app that imports those
names.

Either option is verified in alphaphone the same way: `npm run android:build:local`, then this
probe with `--bundle`, `--notices` and `--apk`, and both distribution variants verified. That is
APK-build evidence. It does not prove anything about emulator, image, device or user acceptance.

## Decisions for the owner

1. **Decided 2026-10-29: ship (b).** The record of the question follows. **May the product ship `@metamask/sdk` 0.33.1 (H-06)?**
   - Options: (a) remove it from the agent bundle with an upstream change; (b) ship it under
     ConsenSys's terms; (c) obtain a commercial licence from ConsenSys.
   - Documented default: none. P-09 does not cover it and H-06 is open. The H-06 text names (a)
     as the alternative. Recommendation (engineering): (a), Option A first. The code ships but is
     not expected to execute, and Wallet is outside the MVP (P-38), so removing it costs nothing
     functionally.
   - What changes: (a) needs an upstream PR and a pin update, then the notices drop the entry;
     (b) needs owner or counsel to find that the non-commercial and monthly-user limits fit a
     commercial phone; (c) costs money and needs a signed licence (record a reference only).
2. **Should any upstream change be made now that `@metamask/sdk` ships?**
   - Options: none; Option A reduced to the `ffmpeg-static` stub; or Option B (barrel split).
     B would also remove `@metamask/sdk` from the agent bundle. If B is chosen, the owner should
     say whether that removal is wanted or the SDK should be kept on purpose.
   - Recommendation (engineering): decide decision 3 for `ua-parser-js` first. B is the only
     option that removes the AGPL code that probably executes. A, with only `ffmpeg-static`,
     removes a GPL wrapper that never finds a binary.
   - What changes: none keeps the notices as they are. A is a small bundler edit. B touches the
     shared `packages/ui` public API and needs the upstream owners to agree.
3. **Review outcome for the copyleft flags (H-35).** For each of `ffmpeg-static`,
   `ua-parser-js`, `rpc-websockets`, Bun/JavaScriptCore and eSpeak NG:
   - Options: accept, with the stated obligations met (source offer and mirror); remediate (the
     options in the table); or ask counsel first.
   - Documented default: P-09 says flag and never block. No review has been recorded.
   - What changes: "accept" needs a source-offer mechanism (decision 4). "Remediate" needs
     engineering work per package.
4. **How is corresponding source offered?**
   - Options: a written offer in `THIRD_PARTY_NOTICES.txt` (valid for at least 3 years); a
     public mirror of the exact revisions (Bun `744846f8`, oven-sh/WebKit, llama.cpp fork
     `0d9fd4b9`, the eliza pin, the npm tarballs); or both.
   - Recommendation: both. Ask counsel what "relink" means for a statically linked Bun.
   - What changes: an engineering task to publish the mirror and add the offer text in
     `generate-licenses.mjs`.
5. **Phonon-2 training-data terms (CHiME-6 CC-BY-SA-4.0, SPGISpeech Kensho terms).**
   - Options: accept, with attribution as shipped; ask counsel; or switch the ASR slot model.
   - What changes: switching affects P-55 and voice quality.
6. **OpenStreetMap ODbL.** Confirm that the Maps service operator shows attribution and handles
   share-alike (H-16). No app change unless attribution turns out to be missing.
7. **Google Play services client libraries (not in #674's list).** Note them as non-open-source
   Google terms alongside H-06, or ask counsel.
8. **Denton reference (optional).** Add a `reference` to the licence document in
   `licenses/font-licenses.json` (a reference only, never the document), or leave the record as
   it is.

## Remaining human steps

1. Owner or counsel reads this packet and the flagged entries in
   `apps/app/public/licenses/THIRD_PARTY_NOTICES.txt` (or the v17 archived notices).
2. Owner decides 2 to 8 above (1 was decided on 2026-10-29).
3. `@metamask/sdk` was decided on 2026-10-29 (ship 0.33.1). No upstream change is needed for it.
   If the owner wants Option A (the `ffmpeg-static` stub only) or Option B, they say so on #674.
   An agent then opens the upstream elizaOS PR. After it merges, the agent bumps the pin, runs
   `npm run android:build:local`, re-runs this probe and verifies both variants. After any pin
   update, check that the probe still reports the MetaMask acceptance as `covered`.
4. Optionally, owner gives the Denton licence reference (not the document) for
   `licenses/font-licenses.json`.
5. Owner records the dated outcome entries in `docs/decisions.md` (drafts below), then closes
   #674, H-35 and H-06.

## Draft decision entries

Drafts only. The owner fills in the outcome. The text is not owner wording.

- **P-?? (draft) — H-06 `@metamask/sdk`, 2026-10-29 (owner):** The resident runtime ships
  `@metamask/sdk` 0.33.1, and the owner accepts its terms (ConsenSys; non-commercial clause and
  monthly-active-user limit). It reaches the agent bundle only through `@wagmi/connectors` 6.2.0,
  via `wagmi` and RainbowKit in the shared `packages/ui` wallet login. It is not expected to
  execute, because the headless agent renders no wallet UI. The notices keep flagging it
  `non-open-source-terms` (P-09: flags never block). The acceptance covers 0.33.1 only, and any
  other version needs a new decision (`scripts/owner/licence-review.mjs` reports
  `version-not-covered`). This entry records the owner's acceptance. It is not a legal review.
- **P-?? (draft) — H-35 licence review, 2026-__-__ (owner / counsel ____):** The flagged
  obligations of `ffmpeg-static`, `ua-parser-js`, `rpc-websockets`, Bun/JavaScriptCore, eSpeak NG,
  Phonon-2 and the OpenStreetMap data were reviewed. Outcome per item: ____. Corresponding source
  is offered by ____. This records the review; it does not change P-09 (flags never block).

## Other observations

- The bundled agent JavaScript contains about 22 absolute build-host path literals (for example
  the build machine's `node_modules` path baked into `ffmpeg-static`'s `__dirname`). This is not
  a licence item. It does put the build machine's directory layout, including a user name, into
  distributed APKs.
- The source-only committed notices list 118 entries. The archived packaged notices list 722.
  Only a packaged build carries the runtime entries that #674 is about.
