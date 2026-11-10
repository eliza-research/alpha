# Third-party license sources

`scripts/generate-licenses.ts` builds `apps/app/public/licenses/third-party-notices.json`
(`[{name, version, license, source, text, flags, obligations?, textSource?}]`) and
`THIRD_PARTY_NOTICES.txt` beside it. Vite copies both into `web-dist/licenses/`, so they ship in
the web bundle and in every APK's `assets/public`.

```sh
node scripts/generate-licenses.ts                    # regenerate
node scripts/generate-licenses.ts --check            # fail if stale or an input is broken
node scripts/generate-licenses.ts --packaged-runtime # also list the staged resident runtime (after agent:stage-android)
node scripts/generate-licenses.ts --refresh-android  # re-resolve the Gradle runtime classpath (needs SDK/JDK)
node --test test/licenses.test.mjs test/runtime-licenses.test.mjs test/font-license.test.mjs
```

## Policy: licences are included and flagged, never blocking

Owner decision P-09 (`docs/decisions.md`, 2026-10-10): an open-source dependency licence never
stops a build and is never a release blocker. Every licence text and notice still ships, and
anything copyleft, unknown or unverified is flagged with what it obliges. The policy lives in
`scripts/licence-policy.ts`; `docs/dependency-audit.md` lists the flags and where they appear.

- Generation never fails on what a licence is. It exits 0 and prints each flag as
  `LICENCE FLAG <flag>: <package>@<version> (<licence>)` on standard error.
- A package with no licence file gets the canonical text of its declared licence from
  `<SPDX id>.txt` in this directory, `textSource: "spdx-canonical"` and the flag
  `licence-text-missing-from-package`. A copyleft package whose licence file only names its
  licence gets the canonical text appended (`"package-and-spdx-canonical"`).
- A package that declares no licence is identified from its own licence file or README and
  flagged `unverified`; if that fails, its licence is `UNKNOWN` and it is flagged
  `unknown-licence`. A licence file that reserves all rights or limits use is flagged
  `non-open-source-terms`.
- Generation fails only on broken input: a package that is not installed, an unreadable or
  corrupted `package.json`, a pinned licence copy or core that drifted from its recorded hash,
  a stale Android classpath snapshot, a malformed `font-licenses.json` record.
- A flag is a record of what was found. It is not legal review and not a clearance.

Proprietary fonts are outside the open-source policy. The Denton typeface is one: it is recorded
in `font-licenses.json` on the owner's statement and stays flagged; see below.

Inputs:

- `package-lock.json` production packages (not dev, not optional platform binaries), with the license
  files from `node_modules`.
- Every font file under `apps/app/public`, identified from its OpenType name table, plus the
  declared `@fontsource/*` packages.
- pdf.js decoder, font and CMap license files that ship in `pdfjs-assets/`.
- `tesseract-core/`: license copies for the libraries statically linked into the
  `tesseract.js-core` WebAssembly cores in `ocr/` (Tesseract, Leptonica, libjpeg, libpng, LibTIFF,
  libwebp, GIFLIB, zlib, OpenLibm), pinned by `tesseract-core/sources.json` to the submodule commits
  of the `tesseract.js-core` v7.0.0 tag. Generation fails when the installed package, a shipped core
  or a license copy changes until the pins are updated (a broken input, not a licence category).
- `android-runtime-classpath.json`: the resolved release and debug runtime classpath for both
  distribution variants. Its fingerprint covers the Gradle dependency declarations; generation fails
  when they change until the snapshot is refreshed.
- `android/voice-host/qualified-voice-host.json`, the record of the on-device speech engine:
  `libelizainference` (llama.cpp/ggml; Paradee-8M TTS with misaki G2P and statically linked
  eSpeak NG; the ASR slot; Silero VAD) and every voice bundle file. The schema is in
  `scripts/voice-host.ts` and `docs/fused-speech.md`. Each source component and each model or
  data file is listed with its licence: eSpeak NG (GPL-3.0-or-later) is flagged copyleft, Paradee,
  misaki and the ASR slot model are Apache-2.0, Silero VAD is MIT. The record carries no licence
  files, so canonical SPDX texts stand in and are flagged `licence-text-missing-from-package`;
  the bundle itself ships the eSpeak NG, misaki and spaCy notices. A component with no verified
  licence is listed as `UNVERIFIED` and flagged, with its reason in `unverified-allowlist.json`.
  Phonon-2 (the intended ASR, CC-BY-4.0) is listed and flagged once its files enter the record.
  Until the record exists, no speech entries are generated. No other inference runtime is an input:
  the web build has no in-browser speech engine (`test/llama-cpp-only.test.mjs`).
- `vendor/eliza/LICENSE` at the commit pinned by `upstream.lock.json` (read only).
- `ODbL-1.0.txt` for OpenStreetMap-derived map data served by the configured Maps endpoint.

Canonical texts, named by SPDX identifier and used when a package ships no licence file (or,
for a copyleft licence, a file that only names it): `0BSD.txt`, `Apache-2.0.txt`,
`BSD-2-Clause.txt`, `BSD-3-Clause.txt`, `ISC.txt`, `MIT.txt`, `MPL-2.0.txt`, `Unlicense.txt`,
`GPL-2.0.txt`, `GPL-3.0.txt`, `LGPL-3.0.txt` (used together with `GPL-3.0.txt`, which it
supplements) and `AGPL-3.0.txt`. `OFL-1.1.txt` is the text for OFL fonts and `ODbL-1.0.txt`
for map data. The BSD, 0BSD and Unlicense texts carry no copyright line; the entry names the
author from the package manifest. The GNU texts are the Free Software Foundation's own
(`GPL-3.0.txt` SHA-256 `3972dc97…b36986`, `LGPL-3.0.txt` `da7eabb7…464768`, `GPL-2.0.txt`
`8177f975…880643`; `AGPL-3.0.txt` is the FSF Markdown rendering). A licence with no text here
is still listed and flagged, with a sentence saying its text is not held; add
`<SPDX id>.txt` to supply it. `mediabunny-MPL-2.0.txt` and `tessdata-APACHE-2.0.txt` remain the
sources for the existing mediabunny and OCR notices.

`unverified-allowlist.json` and `packaged-runtime-allowlist.json` (items that exist only in a
staged runtime) record the reason for each item whose licence could not be established from
shipped metadata. They gate nothing: an item is listed and flagged
`unverified` whether or not it has an entry, and the reason is printed as its obligation note.
A missing or stale entry is printed as a `LICENCE NOTE`; an entry with `requires: <path>` names
the record that ships its item and is reported as stale only once that record exists. A reason is not legal sign-off. A font
entry there carries an exact file hash; the `unresolved-font-licence` check reports a payload
file with those bytes as an unresolved font. No font is listed there today.

`font-licenses.json` records the licence of a bundled proprietary font whose own metadata names
none, for exact file hashes. It has two record states:

- Owner statement: `evidence: "held-outside-repository"`, with `holder`, `basis` and
  `recordedOn`, and optionally `reference` (a reference to the licence document, never the
  document or a secret). It records only what the owner stated. The notice entry says the face is
  proprietary, prints the holder and basis, says the licence document is not in the repository,
  and stays flagged `proprietary-licence-held-outside-repo`. The Denton typeface is recorded this
  way (decision A-21, closed by P-09): no licence name, number, scope or terms is recorded
  because none was supplied.
- Full: `licensor`, `licensee`, `scope` (must name app and web embedding), `evidence` (where the
  signed licence is held) and `recordedOn`. The entry is then unflagged.

Either way the licence value is `LicenseRef-Commercial-Font`; a proprietary font is never recorded
under an open-source identifier. A font with no record is listed as `proprietary, no licence
recorded` and flagged `proprietary-no-licence-recorded`. The separately named check
`unresolved-font-licence` reports recorded fonts as resolved-by-owner-statement and unrecorded
ones as unresolved; whether an unresolved font keeps a release `distributable: false` is the
constant `UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION` in `scripts/licence-policy.ts` (default
`false`). See `docs/dependency-audit.md`.

Prototype design images are not part of production builds; their licensing is recorded in
`apps/app/src/prototype/README.md`.
