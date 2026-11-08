#!/usr/bin/env node
import {VOICE_HOST_MANIFEST, voiceHostProblems} from './voice-host.mjs';
import {HOST_DESCRIPTOR, generateAlphaAndroidHost, readHostDescriptor} from './android-host.mjs';
import {HOST_TEMPLATES, referencePath} from './gradle-verification.mjs';
import {preparePatchedNative} from './prepare-patched-native.mjs';
import {readAgentBundleDependencies} from './agent-bundle-dependencies.mjs';
// Generates the third-party notices shipped in the web bundle and in every APK payload.
//
//   node scripts/generate-licenses.mjs                    write apps/app/public/licenses/*
//   node scripts/generate-licenses.mjs --check            fail when outputs are stale or an input is broken
//   node scripts/generate-licenses.mjs --refresh-android  re-resolve the Gradle release/debug runtime
//                                                         classpath into licenses/android-runtime-classpath.json
//
//   node scripts/generate-licenses.mjs --packaged-runtime  also list Bun and every npm package bundled
//                                                         into the staged agent (from its hash-bound
//                                                         inventory, verified in the prepared source)
//                                                         and workflow worker (its dependencies.json)
//
// Runtime enumeration is explicit: a staged runtime in a development checkout never changes the
// committed notices. A PACKAGED distribution build regenerates them after staging with
// --packaged-runtime (resident-android.yml). Without a flag, --check and generate() use the mode
// the shipped notices were generated in, and --check also lists the staged runtime when present.
//
// Licence policy (docs/decisions.md P-09, scripts/licence-policy.mjs): generation never fails on
// what a licence is. Every entry has {name, version, license, source, text, flags}, plus
// `obligations` ([{flag, note}]) when flagged and `textSource: "spdx-canonical"` when the package
// ships no licence file and the canonical text of its declared licence is used instead. Copyleft,
// unknown, unverified and text-less entries are flagged and printed as
// `LICENCE FLAG <flag>: <package>@<version> (<spdx>)` warnings; the exit status stays 0.
// Generation fails only on broken input: a package that is not installed or whose manifest
// cannot be read, a pinned licence copy or core that drifted from its recorded hash, a stale
// Android classpath snapshot, a malformed font licence record. A flag is not legal review.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {
  COMMERCIAL_FONT, HELD_OUTSIDE_REPOSITORY, NO_FONT_LICENCE, UNKNOWN, UNVERIFIED, canonicalId, classifyLicence, flagSummary, licenceFlagLines, obligationNote,
} from './licence-policy.mjs';

export {COMMERCIAL_FONT, HELD_OUTSIDE_REPOSITORY, NO_FONT_LICENCE, UNKNOWN, UNVERIFIED};
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_DIR = 'apps/app/public/licenses';
export const JSON_OUTPUT = `${OUTPUT_DIR}/third-party-notices.json`;
export const TEXT_OUTPUT = `${OUTPUT_DIR}/THIRD_PARTY_NOTICES.txt`;
export const ALLOWLIST = 'licenses/unverified-allowlist.json';
export const RUNTIME_ALLOWLIST = 'licenses/packaged-runtime-allowlist.json';
/** Recorded embedding licences for fonts whose own metadata names none (owner decision A-21). */
export const FONT_LICENSES = 'licenses/font-licenses.json';
export const ANDROID_CLASSPATH = 'licenses/android-runtime-classpath.json';

/** SPDX identifiers the SBOM writes as a CycloneDX licence id. Not a gate: see scripts/licence-policy.mjs. */
export const KNOWN_LICENSES = new Set([
  '0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT', 'MPL-2.0', 'OFL-1.1', 'ODbL-1.0', 'Zlib',
  'GPL-2.0-only WITH Font-exception-2.0',
  // Permissive licenses of libraries statically linked into the tesseract.js-core WebAssembly cores.
  'IJG', 'libpng-2.0', 'libtiff', 'SunPro',
]);

/** Maven group prefixes found on the resolved Android runtime classpath. Anything else is listed as UNKNOWN and flagged. */
export const MAVEN_FAMILIES = [
  {prefix: 'androidx.', name: 'AndroidX (Android Jetpack) libraries, including CameraX', license: 'Apache-2.0', source: 'https://android.googlesource.com/platform/frameworks/support/'},
  {prefix: 'org.jetbrains.kotlinx', name: 'Kotlin coroutines', license: 'Apache-2.0', source: 'https://github.com/Kotlin/kotlinx.coroutines'},
  {prefix: 'org.jetbrains.kotlin', name: 'Kotlin standard library', license: 'Apache-2.0', source: 'https://github.com/JetBrains/kotlin'},
  {prefix: 'org.jetbrains', exact: true, name: 'JetBrains Java annotations', license: 'Apache-2.0', source: 'https://github.com/JetBrains/java-annotations'},
  {prefix: 'com.squareup.okhttp3', exact: true, name: 'OkHttp HTTP and WebSocket client', license: 'Apache-2.0', source: 'https://square.github.io/okhttp/'},
  {prefix: 'com.squareup.okio', exact: true, name: 'Okio I/O library', license: 'Apache-2.0', source: 'https://square.github.io/okio/'},
  {prefix: 'com.google.guava', name: 'Guava and ListenableFuture', license: 'Apache-2.0', source: 'https://github.com/google/guava'},
  {prefix: 'com.google.auto.value', name: 'AutoValue annotations', license: 'Apache-2.0', source: 'https://github.com/google/auto'},
  {prefix: 'org.jspecify', name: 'JSpecify annotations', license: 'Apache-2.0', source: 'https://github.com/jspecify/jspecify'},
  {prefix: 'org.apache.cordova', name: 'Apache Cordova Android framework (Capacitor compatibility layer)', license: 'Apache-2.0', source: 'https://github.com/apache/cordova-android'},
  // Exact Media3 transitive artifacts reviewed against their published POMs.
  // Checker qualifiers also carry their own MIT copyright/licence in the JAR.
  {prefix: 'com.google.code.findbugs', exact:true, artifact:'jsr305', versions:['3.0.2'], name:'JSR-305 annotations', license:'Apache-2.0', source:'https://repo.maven.apache.org/maven2/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.pom'},
  {prefix: 'com.google.errorprone', exact:true, artifact:'error_prone_annotations', versions:['2.28.0'], name:'Error Prone annotations', license:'Apache-2.0', source:'https://github.com/google/error-prone'},
  {prefix: 'com.google.j2objc', exact:true, artifact:'j2objc-annotations', versions:['3.0.0'], name:'J2ObjC annotations', license:'Apache-2.0', source:'https://github.com/google/j2objc'},
  {prefix: 'org.checkerframework', exact:true, artifact:'checker-qual', versions:['3.43.0'], name:'Checker Framework qualifiers', license:'MIT', licenseFile:'licenses/checker-qual-3.43.0-LICENSE.txt', source:'https://github.com/typetools/checker-framework'},
];
export function mavenFamily(group,artifact,version){
 return MAVEN_FAMILIES.find(f => (f.exact ? group === f.prefix : group.startsWith(f.prefix))&&(!f.artifact||f.artifact===artifact)&&(!f.versions||f.versions.includes(version)));
}

/** pdf.js ships decoders, fonts and CMaps beside the viewer; each has its own license file. */
const PDFJS_COMPONENTS = [
  {name: 'pdf.js standard fonts: Foxit', license: 'BSD-3-Clause', file: 'standard_fonts/LICENSE_FOXIT', source: 'https://pdfium.googlesource.com/pdfium/'},
  {name: 'pdf.js standard fonts: Liberation', license: 'GPL-2.0-only WITH Font-exception-2.0', file: 'standard_fonts/LICENSE_LIBERATION', source: 'https://github.com/liberationfonts'},
  {name: 'pdf.js CMaps (Adobe)', license: 'BSD-3-Clause', file: 'cmaps/LICENSE', source: 'https://github.com/adobe-type-tools/cmap-resources'},
  {name: 'pdf.js JBIG2 decoder (PDFium)', license: 'BSD-3-Clause AND Apache-2.0', files: ['wasm/LICENSE_JBIG2', 'wasm/LICENSE_PDFJS_JBIG2'], source: 'https://pdfium.googlesource.com/pdfium/'},
  {name: 'pdf.js OpenJPEG decoder', license: 'BSD-2-Clause', files: ['wasm/LICENSE_OPENJPEG', 'wasm/LICENSE_PDFJS_OPENJPEG'], source: 'https://github.com/uclouvain/openjpeg'},
  {name: 'pdf.js qcms colour management', license: 'MIT', files: ['wasm/LICENSE_QCMS', 'wasm/LICENSE_PDFJS_QCMS'], source: 'https://github.com/FirefoxGraphics/qcms'},
  {name: 'pdf.js QuickJS sandbox', license: UNVERIFIED, files: [], source: 'https://github.com/mozilla/pdf.js.quickjs'},
];

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;

// ---------------------------------------------------------------- helpers

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
export const readJson = (root, rel) => JSON.parse(read(root, rel));
export const exists = (root, rel) => fs.existsSync(path.join(root, rel));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const normalizeText = text => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');

/**
 * True when an installed package holds only TypeScript declarations and package metadata, so
 * no code from it can reach any bundle. A runtime dependency that declares @types/node (and with
 * it undici-types) as a regular dependency makes npm record them as production.
 */
const METADATA_FILE = /^(package\.json|readme(\..*)?|license(\..*)?|licence(\..*)?|changelog(\..*)?|notice(\..*)?|.*\.md)$/i;
export function declarationOnlyPackage(dir) {
  let files = 0;
  const walk = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) { if (entry.name === 'node_modules') continue; if (!walk(child)) return false; continue; }
      if (!entry.isFile()) return false;
      if (/\.d\.[cm]?ts$/.test(entry.name)) { files++; continue; }
      if (current === dir && METADATA_FILE.test(entry.name)) continue;
      return false;
    }
    return true;
  };
  if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
  return walk(dir) && files > 0;
}

/**
 * Production packages in package-lock: not dev, not optional platform binaries, not links, and
 * not declaration-only type packages (which ship no code).
 */
export function productionLockPackages(lock, root = ROOT) {
  const out = [];
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    if (!key || meta.dev || meta.optional || meta.devOptional || meta.link) continue;
    if (!key.startsWith('node_modules/')) continue;
    if (declarationOnlyPackage(path.join(root, key))) continue;
    const name = meta.name || key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.push({key, name, version: meta.version, license: meta.license, resolved: meta.resolved});
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function licenseFilesText(dir) {
  if (!fs.existsSync(dir)) return '';
  const names = fs.readdirSync(dir).filter(name => LICENSE_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile()).sort();
  return names.map(name => normalizeText(fs.readFileSync(path.join(dir, name), 'utf8'))).join('\n\n');
}

/** Canonical licence texts held in licenses/<SPDX id>.txt, for packages that ship no licence file. */
export function loadTemplates(root) {
  const text = id => normalizeText(read(root, `licenses/${id}.txt`));
  return {
    mit: text('MIT'), isc: text('ISC'), apache: text('Apache-2.0'), ofl: text('OFL-1.1'),
    /** Canonical text for every identifier of an expression, or '' when any one is not held. */
    canonical(expression) {
      const {identifiers} = classifyLicence(expression);
      if (!identifiers.length) return '';
      const ids = [...new Set(identifiers.map(canonicalId))];
      // The LGPL is a set of additional permissions on top of the GPL of the same version, so both texts go together.
      for (const id of [...ids]) if (/^LGPL-3\.0$/.test(id) && !ids.includes('GPL-3.0')) ids.push('GPL-3.0');
      if (ids.some(id => !/^[A-Za-z0-9.+-]+$/.test(id) || !exists(root, `licenses/${id}.txt`))) return '';
      return ids.map(id => (ids.length > 1 ? `${id}:\n\n` : '') + text(id)).join('\n\n');
    },
  };
}

/** Identify a licence from the text of a licence file. Returns '' when it is not one of these. */
export function detectLicenceFromText(text) {
  const t = String(text).replace(/\s+/g, ' ');
  if (/GNU AFFERO GENERAL PUBLIC LICENSE Version 3/i.test(t)) return 'AGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE Version 3/i.test(t)) return 'LGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE Version 2\.1/i.test(t)) return 'LGPL-2.1';
  if (/GNU GENERAL PUBLIC LICENSE Version 3/i.test(t)) return 'GPL-3.0';
  if (/GNU GENERAL PUBLIC LICENSE Version 2/i.test(t)) return 'GPL-2.0';
  if (/Mozilla Public License,? Version 2\.0/i.test(t)) return 'MPL-2.0';
  if (/Apache License,? Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/Blue Oak Model License/i.test(t)) return 'BlueOak-1.0.0';
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted/i.test(t))
    return /provided that the above copyright notice/i.test(t) ? 'ISC' : '0BSD';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense';
  if (/CC0 1\.0 Universal/i.test(t)) return 'CC0-1.0';
  return '';
}

/** True when `text` holds the body of the copyleft licence `id`, not just a sentence naming it. */
function holdsLicenceBody(text, id) {
  const t = String(text).replace(/\s+/g, ' ');
  const title = /^AGPL-3/.test(id) ? /GNU AFFERO GENERAL PUBLIC LICENSE Version 3/i
    : /^LGPL-3/.test(id) ? /GNU LESSER GENERAL PUBLIC LICENSE Version 3/i
      : /^LGPL-2\.1/.test(id) ? /GNU LESSER GENERAL PUBLIC LICENSE Version 2\.1/i
        : /^GPL-3/.test(id) ? /GNU GENERAL PUBLIC LICENSE Version 3/i
          : /^GPL-2/.test(id) ? /GNU GENERAL PUBLIC LICENSE Version 2/i
            : /^MPL-2/.test(id) ? /Mozilla Public License,? Version 2\.0/i : null;
  return !title || (title.test(t) && t.length > 4000);
}

/** Terms that are plainly not an open-source licence: rights reserved with no recognised licence, or a use restriction. */
export function restrictedTerms(text) {
  const t = String(text).replace(/\s+/g, ' ');
  if (/\bnon-?commercial\b/i.test(t)) return 'The package\'s own licence file limits use to non-commercial use.';
  if (/\ball rights reserved\b/i.test(t) && !detectLicenceFromText(t)) return 'The package\'s own licence file reserves all rights and grants no recognised open-source licence.';
  return '';
}

/** A licence named under a "License" heading of the package README, or ''. */
function readmeLicence(dir) {
  if (!fs.existsSync(dir)) return '';
  const name = fs.readdirSync(dir).find(entry => /^readme(\.(md|markdown|txt))?$/i.test(entry));
  if (!name) return '';
  const readme = fs.readFileSync(path.join(dir, name), 'utf8');
  const section = /^#{1,6}\s*licen[cs]e\b[^\n]*\n([\s\S]{0,400})/im.exec(readme)?.[1] ?? '';
  const found = /\b(MIT|ISC|Apache[- ]2\.0|BSD-[23]-Clause|MPL-2\.0|Unlicense|CC0-1\.0|0BSD|(?:A|L)?GPL-[23]\.[01](?:-only|-or-later)?)\b/.exec(section)?.[1] ?? '';
  return found.replace(/^Apache 2\.0$/, 'Apache-2.0');
}

function repositoryUrl(manifest) {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (typeof repository !== 'string' || !repository.trim()) return '';
  return repository.trim().replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/').replace(/\.git$/, '');
}

export function manifestLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses.length)
    return manifest.licenses.map(item => (typeof item === 'string' ? item : item?.type)).filter(Boolean).join(' OR ');
  return '';
}

/**
 * Licence, text and flags for one package. Never fails on what the licence is: an undeclared
 * licence is identified from the package's own licence file or README (and flagged unverified),
 * or recorded as UNKNOWN; a missing licence file is replaced by the canonical text of the
 * declared licence (textSource "spdx-canonical") and flagged.
 * @param {{declared?: string, text?: string, dir?: string, manifest?: object, templates: object, shippedBy?: string}} input
 */
export function packageNotice({declared = '', text = '', dir = '', manifest = {}, templates, shippedBy = 'npm package'}) {
  const flags = [];
  let reason = '', textSource;
  const stated = typeof declared === 'string' ? declared.trim() : '';
  let license = /^(SEE LICEN[CS]E IN\b|UNLICENSED$)/i.test(stated) ? '' : stated;
  if (!license) {
    const fromText = text ? detectLicenceFromText(text) : '';
    const fromReadme = fromText || !dir ? '' : readmeLicence(dir);
    const manifestSays = stated ? `The package manifest says "${stated}" instead of naming a licence.` : 'The package manifest declares no licence.';
    if (fromText) { license = fromText; flags.push('unverified'); reason = `${manifestSays} ${fromText} was identified from the text of the package's own licence file.`; }
    else if (fromReadme) { license = fromReadme; flags.push('unverified'); reason = `${manifestSays} ${fromReadme} is the licence named in the package's README.`; }
    else license = stated || UNKNOWN;
  }
  // "UNLICENSED" is npm's word for proprietary; a licence file can also say so in its own terms.
  const restricted = /^UNLICENSED$/i.test(stated) ? 'The package manifest says "UNLICENSED", which npm uses for packages that grant no licence.'
    : classifyLicence(license).flags.includes('unknown-licence') && text ? restrictedTerms(text) : '';
  if (restricted) { flags.push('non-open-source-terms'); reason = restricted; }
  // A copyleft package whose licence file only names the licence still ships the licence text itself.
  const named = text ? (classifyLicence(license).chosen ?? []).map(canonicalId).filter(id => !holdsLicenceBody(text, id)) : [];
  if (named.length) {
    flags.push('licence-text-missing-from-package');
    const canonical = templates.canonical(named.join(' AND '));
    if (canonical) {
      textSource = 'package-and-spdx-canonical';
      text = `${text}\n\nThe package's licence file names ${named.join(' and ')} without including the licence text. The canonical text follows.\n\n${canonical}`;
    }
  }
  if (!text) {
    flags.push('licence-text-missing-from-package');
    const canonical = license === UNKNOWN ? '' : templates.canonical(license);
    const author = packageAuthor(manifest);
    if (canonical) {
      textSource = 'spdx-canonical';
      text = `The ${shippedBy} ships no license file. Its package.json declares the ${license} License${author ? `; author: ${author}` : ''}. The standard ${license} terms follow.\n\n${canonical}`;
    } else if (license === UNKNOWN) text = `The ${shippedBy} ships no licence file and no licence could be established for it.`;
    else text = `The ${shippedBy} ships no licence file. It declares ${license}${author ? `; author: ${author}` : ''}. No canonical text for that licence is held in licenses/.`;
  }
  return {license, text, textSource, repository: repositoryUrl(manifest), _flags: flags, _reason: reason};
}

function readManifest(dir, label, errors) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('not an object');
    return manifest;
  } catch (error) { errors.push(`${label}: unreadable or corrupted package.json (${error.message})`); return null; }
}

function packageAuthor(pkg) {
  const a = pkg.author;
  if (!a) return '';
  return typeof a === 'string' ? a : [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- font metadata

const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function sfntNameTable(buf) {
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) === 'name') {
      const offset = buf.readUInt32BE(rec + 8), length = buf.readUInt32BE(rec + 12);
      return buf.subarray(offset, offset + length);
    }
  }
  return null;
}

function woff2NameTable(buf) {
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  let pos = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[pos++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid WOFF2 UIntBase128');
  };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = buf.toString('latin1', pos, pos + 4); pos += 4; }
    const transform = (flags >> 6) & 3;
    const origLength = base128();
    const transformed = (tag === 'glyf' || tag === 'loca') ? transform === 0 : transform !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({tag, length});
  }
  if (buf.toString('latin1', 4, 8) === 'ttcf') throw new Error('WOFF2 collections are not supported');
  const data = brotliDecompressSync(buf.subarray(pos, pos + compressedLength));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === 'name') return data.subarray(offset, offset + table.length);
    offset += table.length;
  }
  return null;
}

/** Read the OpenType name table of a TTF/OTF/WOFF2 file. */
export function fontNames(buf) {
  const sig = buf.toString('latin1', 0, 4);
  const table = sig === 'wOF2' ? woff2NameTable(buf) : (sig === '\0\x01\0\0' || sig === 'OTTO' || sig === 'true') ? sfntNameTable(buf) : null;
  if (!table) throw new Error('Unsupported or unreadable font container');
  const count = table.readUInt16BE(2), stringOffset = table.readUInt16BE(4);
  const pick = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = table.readUInt16BE(r), encoding = table.readUInt16BE(r + 2), language = table.readUInt16BE(r + 4);
    const id = table.readUInt16BE(r + 6), length = table.readUInt16BE(r + 8), offset = table.readUInt16BE(r + 10);
    const raw = table.subarray(stringOffset + offset, stringOffset + offset + length);
    let rank, value;
    if (platform === 3 && encoding === 1) {
      rank = language === 0x409 ? 0 : 1;
      value = Buffer.from(raw).swap16().toString('utf16le');
    } else if (platform === 1 && encoding === 0) { rank = 2; value = raw.toString('latin1'); } else continue;
    if (!pick[id] || pick[id].rank > rank) pick[id] = {rank, value};
  }
  const get = id => pick[id]?.value?.trim() || '';
  return {copyright: get(0), family: get(16) || get(1), fullName: get(4), version: get(5), manufacturer: get(8), licenseDescription: get(13), licenseUrl: get(14)};
}

export function fontLicense(names) {
  const haystack = `${names.licenseDescription}\n${names.licenseUrl}`;
  if (/SIL Open Font License,? Version 1\.1|scripts\.sil\.org\/(cms\/scripts\/page\.php\?.*id=)?OFL|openfontlicense\.org/i.test(haystack)) return 'OFL-1.1';
  return NO_FONT_LICENCE;
}

export function listFonts(root) {
  const out = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(root, rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'licenses') walk(child); } else if (/\.(woff2|ttf|otf)$/i.test(entry.name)) out.push(child);
    }
  };
  walk('apps/app/public');
  return out;
}

// ---------------------------------------------------------------- collectors

function npmEntries(root, templates, errors) {
  const lock = readJson(root, 'package-lock.json');
  const entries = [];
  for (const pkg of productionLockPackages(lock, root)) {
    const dir = path.join(root, pkg.key);
    if (!fs.existsSync(path.join(dir, 'package.json'))) { errors.push(`${pkg.name}@${pkg.version}: not installed at ${pkg.key}; run npm ci`); continue; }
    const manifest = readManifest(dir, `${pkg.name}@${pkg.version}`, errors);
    if (!manifest) continue;
    if (manifest.version !== pkg.version) errors.push(`${pkg.name}: installed ${manifest.version} differs from package-lock ${pkg.version}`);
    const notice = packageNotice({declared: pkg.license || manifestLicense(manifest), text: licenseFilesText(dir), dir, manifest, templates});
    entries.push({name: pkg.name, version: pkg.version, source: pkg.resolved || `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`, ...notice});
  }
  return entries;
}

function pdfjsEntries(root, errors) {
  const dir = 'node_modules/pdfjs-dist';
  if (!exists(root, `${dir}/package.json`)) return [];
  const version = readJson(root, `${dir}/package.json`).version;
  return PDFJS_COMPONENTS.map(component => {
    const files = component.files || [component.file];
    for (const file of files) if (!exists(root, `${dir}/${file}`)) errors.push(`${component.name}: missing ${dir}/${file}`);
    const text = files.filter(file => exists(root, `${dir}/${file}`)).map(file => normalizeText(read(root, `${dir}/${file}`))).join('\n\n');
    return {name: component.name, version: `bundled with pdfjs-dist ${version}`, license: component.license, source: component.source,
      text: text || 'pdfjs-dist ships this component without a license file.', _flags: text ? [] : ['licence-text-missing-from-package']};
  });
}

function ocrDataEntries(root) {
  const eng = readJson(root, 'node_modules/@tesseract.js-data/eng/package.json');
  return [{name: 'Tesseract English trained data (tessdata 4.0.0_best_int)', version: `bundled with @tesseract.js-data/eng ${eng.version}`, license: 'Apache-2.0',
    source: 'https://github.com/naptha/tessdata', text: normalizeText(read(root, 'licenses/tessdata-APACHE-2.0.txt'))}];
}

/**
 * tesseract.js-core ships WebAssembly cores that statically link Tesseract, Leptonica and image/math
 * libraries. Its own LICENSE covers only the wrapper, so each linked library is listed from license
 * copies pinned in licenses/tesseract-core/sources.json to the exact cores that ship.
 */
export const TESSERACT_CORE_SOURCES = 'licenses/tesseract-core/sources.json';
function tesseractCoreEntries(root, errors) {
  if (!exists(root, TESSERACT_CORE_SOURCES)) { errors.push(`${TESSERACT_CORE_SOURCES} missing`); return []; }
  const pinned = readJson(root, TESSERACT_CORE_SOURCES);
  const dir = `node_modules/${pinned.package}`;
  if (!exists(root, `${dir}/package.json`)) { errors.push(`${pinned.package}: not installed; run npm ci`); return []; }
  const installed = readJson(root, `${dir}/package.json`).version;
  if (installed !== pinned.version)
    errors.push(`${pinned.package} ${installed} differs from ${TESSERACT_CORE_SOURCES} (${pinned.version}); re-review its statically linked libraries`);
  for (const [file, digest] of Object.entries(pinned.cores)) {
    if (!exists(root, `${dir}/${file}`)) errors.push(`${dir}/${file}: missing`);
    else if (sha256(fs.readFileSync(path.join(root, dir, file))) !== digest)
      errors.push(`${dir}/${file} differs from the core pinned in ${TESSERACT_CORE_SOURCES}; re-review its statically linked libraries`);
  }
  return pinned.components.map(component => {
    const texts = component.files.map(file => {
      const rel = `licenses/tesseract-core/${file.path}`;
      if (!exists(root, rel)) { errors.push(`${rel}: missing`); return ''; }
      const bytes = fs.readFileSync(path.join(root, rel));
      if (sha256(bytes) !== file.sha256) errors.push(`${rel} does not match its sha256 in ${TESSERACT_CORE_SOURCES}`);
      return normalizeText(bytes.toString('utf8'));
    }).filter(Boolean);
    return {name: `${component.name} (linked into ${pinned.package} WebAssembly)`, version: `${component.version}; bundled with ${pinned.package} ${pinned.version}`,
      license: component.license, source: component.source, text: [component.preface, ...texts].filter(Boolean).join('\n\n')};
  });
}

function fontEntries(root, templates, errors) {
  const entries = [];
  const groups = new Map();
  for (const rel of listFonts(root)) {
    const bytes = fs.readFileSync(path.join(root, rel));
    let names;
    try { names = fontNames(bytes); } catch (error) { errors.push(`${rel}: cannot read font metadata (${error.message})`); continue; }
    const license = fontLicense(names);
    const key = [names.family, names.version, names.copyright, license].join('\0');
    if (!groups.has(key)) groups.set(key, {names, license, files: []});
    groups.get(key).files.push({rel: rel.replace(/^apps\/app\/public\//, ''), sha256: sha256(bytes)});
  }
  const licensed = exists(root, FONT_LICENSES) ? readJson(root, FONT_LICENSES).entries : [];
  const usedRecords = new Set();
  for (const {names, license: stated, files} of groups.values()) {
    const fileList = files.map(file => `${file.rel} (sha256 ${file.sha256})`).join('\n');
    const name = `${names.family} typeface`;
    let license = stated;
    let body = license === 'OFL-1.1' ? `${names.copyright}\n\n${templates.ofl}` :
      `The font file states: "${names.copyright || 'no copyright notice'}". It names no license${names.manufacturer ? `; manufacturer: ${names.manufacturer}` : ''}.`;
    // A recorded embedding licence covers exactly the reviewed bytes: every shipped file of the face.
    const record = license === NO_FONT_LICENCE ? licensed.find(item => item.name === name && files.every(file => item.sha256?.includes(file.sha256))) : null;
    let heldOutside = false;
    if (record) {
      usedRecords.add(record);
      // Two record states. A full record names licensor, licensee, scope and where the signed licence is held.
      // "held-outside-repository" records only what the owner stated: who holds it and on what basis. It
      // carries no licence name, number, scope or terms, and the entry says so and stays flagged.
      heldOutside = record.evidence === HELD_OUTSIDE_REPOSITORY;
      const missing = (heldOutside ? ['holder', 'basis', 'recordedOn'] : ['licensor', 'licensee', 'scope', 'evidence', 'recordedOn']).filter(field => typeof record[field] !== 'string' || !record[field].trim());
      if (record.license !== COMMERCIAL_FONT) errors.push(`${FONT_LICENSES}: ${name} must use license ${COMMERCIAL_FONT}`);
      else if (heldOutside && !missing.length) {
        license = COMMERCIAL_FONT;
        body = [
          names.copyright,
          'Proprietary typeface. It is not open-source software and is not redistributable under an open-source licence.',
          `Licence holder: ${record.holder}. Basis: ${record.basis}. Recorded ${record.recordedOn}.`,
          record.reference ? `Reference to the licence document: ${record.reference}.` : 'Evidence: held outside this repository. The licence document is not in this repository and no reference to it is recorded here; no licence name, number, date, scope or terms are recorded.',
        ].join('\n\n');
      }
      else if (missing.length) errors.push(`${FONT_LICENSES}: ${name} is missing ${missing.join(', ')}`);
      else if (!/\bapp\b/i.test(record.scope) || !/\bweb\b/i.test(record.scope)) errors.push(`${FONT_LICENSES}: ${name} scope must cover app and web embedding`);
      else {
        license = COMMERCIAL_FONT;
        body = `${names.copyright}\n\nUsed under a commercial licence from ${record.licensor} to ${record.licensee}. Scope: ${record.scope}. Evidence: ${record.evidence} (recorded ${record.recordedOn}).`;
      }
    }
    entries.push({name, version: names.version.replace(/^Version\s+/i, ''), license,
      source: `Files shipped in the web bundle:\n${fileList}`, text: body, _unverifiedKey: files.map(file => file.sha256),
      ...(heldOutside && license === COMMERCIAL_FONT ? {_flags: ['proprietary-licence-held-outside-repo'], _reason: `${record.holder}: ${record.basis}.`} : {})});
  }
  for (const item of licensed) if (!usedRecords.has(item)) errors.push(`${FONT_LICENSES}: stale entry ${item.name}; no shipped font matches its name and sha256 list`);
  const pkg = readJson(root, 'package.json');
  const fontsource = Object.keys({...pkg.dependencies, ...pkg.devDependencies}).filter(name => name.startsWith('@fontsource/')).sort();
  for (const name of fontsource) {
    const dir = `node_modules/${name}`;
    if (!exists(root, `${dir}/package.json`)) { errors.push(`${name}: not installed; run npm ci`); continue; }
    const manifest = readManifest(path.join(root, dir), name, errors);
    if (!manifest) continue;
    const notice = packageNotice({declared: manifestLicense(manifest), text: licenseFilesText(path.join(root, dir)), dir: path.join(root, dir), manifest, templates});
    entries.push({name, version: manifest.version, source: `https://www.npmjs.com/package/${name}/v/${manifest.version}`, ...notice});
  }
  return entries;
}

function elizaEntry(root) {
  const lock = readJson(root, 'upstream.lock.json');
  const version = exists(root, 'vendor/eliza/package.json') ? readJson(root, 'vendor/eliza/package.json').version : 'pinned';
  return {name: 'elizaOS', version: `${version} (${lock.commit})`, license: 'MIT', source: `${lock.url.replace(/\.git$/, '')}/tree/${lock.commit}`,
    text: normalizeText(read(root, 'vendor/eliza/LICENSE'))};
}

/** Parse `gradle dependencies` tree output into sorted unique resolved group:artifact:version. */
export function parseGradleTree(output) {
  const coords = new Set();
  for (const line of output.split('\n')) {
    const match = line.match(/[+\\]--- ([^\s:]+):([^\s:]+)(?::([^\s]+))?(?: -> ([^\s]+))?(?: \((\*|c|n)\))?\s*$/);
    if (!match || match[1] === 'project') continue;
    if (match[5] === 'c' || match[5] === 'n') continue;
    const version = match[4] || match[3];
    if (!version) continue;
    coords.add(`${match[1]}:${match[2]}:${version}`);
  }
  return [...coords].sort();
}

/**
 * Fingerprint only inputs that can change the resolved runtime classpath: the host descriptor's
 * dependencies and app modules, the pinned generator toolchain and template, and each linked
 * module's own declarations. Native plugin descriptors stay pinned; shared auth's
 * one patchable descriptor contributes its authenticated staged bytes under its canonical label.
 */
export function androidDependencyFingerprint(root) {
  const {profile} = readHostDescriptor(root);
  const modules = profile.modules.filter(module => module.appDependency !== false)
    .map(module => [module.name, referencePath(module.source)]).sort(([a], [b]) => a.localeCompare(b));
  const toolchain = readJson(root, `${HOST_TEMPLATES}/toolchain.json`);
  const template = read(root, `${HOST_TEMPLATES}/app.gradle`).split('\n').map(line => line.trim()).filter(line => /\b(implementation|add)\b.*(module|dependency)/.test(line));
  const declared = [
    `${HOST_DESCRIPTOR}:\n${JSON.stringify({dependencies: profile.dependencies, modules})}`,
    `${HOST_TEMPLATES}/toolchain.json:\n${JSON.stringify({androidGradlePlugin: toolchain.androidGradlePlugin, kotlin: toolchain.kotlin, versions: toolchain.versions})}`,
    `${HOST_TEMPLATES}/app.gradle:\n${template.join('\n')}`,
  ];
  const files = modules.map(([, directory]) => path.posix.join(directory, 'build.gradle'));
  const authDescriptor = 'packages/auth/android/build.gradle', authFile = `vendor/eliza/${authDescriptor}`;
  const patchManifest = 'patches/eliza/native-manifest.json';
  const patches = exists(root, patchManifest) ? readJson(root, patchManifest).patches : [];
  const patchedDescriptors = new Map();
  if (files.includes(authFile) && patches?.some(patch => patch.targets?.some(target => target.path === authDescriptor))) {
    const staged = preparePatchedNative({root});
    patchedDescriptors.set(authFile, fs.readFileSync(path.join(staged.root, authDescriptor), 'utf8'));
  }
  const readDescriptor = file => patchedDescriptors.get(file) ?? read(root, file);
  // A module that applies a shared script (`ext.<dir> = file('…')` then `apply from: new File(ext.<dir>, '<file>')`) declares its dependencies there.
  for (const file of [...files]) {
    if (!exists(root, file)) continue;
    const text = readDescriptor(file);
    for (const [, variable, applied] of text.matchAll(/apply from:\s*new File\(ext\.(\w+),\s*'([^']+)'\)/g)) {
      const dir = text.match(new RegExp(`ext\\.${variable}\\s*=\\s*file\\('([^']+)'\\)`))?.[1];
      if (dir) files.push(path.posix.join(path.posix.dirname(file), dir, applied));
    }
  }
  // The shared paradee-voice library (:local-speech) declares its build in the pinned consumer script.
  const paradeeConsumer = 'vendor/eliza/plugins/plugin-local-inference/native/android/consumer.gradle';
  if (exists(root, paradeeConsumer) && !files.includes(paradeeConsumer)) files.push(paradeeConsumer);
  const lines = [...declared];
  for (const file of [...new Set(files)].sort()) {
    if (!exists(root, file)) { lines.push(`${file}: missing`); continue; }
    const relevant = readDescriptor(file).split('\n').map(line => line.trim())
      .filter(line => /^(implementation|api|runtimeOnly)\b/.test(line) || /Version\s*=/.test(line) || /^include\b|projectDir\s*=/.test(line));
    lines.push(`${file}:\n${relevant.join('\n')}`);
  }
  return sha256(lines.join('\n'));
}

export function refreshAndroidClasspath(root, env) {
  const configurations = ['standaloneReleaseRuntimeClasspath', 'launcherReleaseRuntimeClasspath', 'standaloneDebugRuntimeClasspath', 'launcherDebugRuntimeClasspath'];
  generateAlphaAndroidHost(root);
  const coords = new Set();
  for (const configuration of configurations) {
    const output = execFileSync('./gradlew', ['-q', ':app:dependencies', '--configuration', configuration], {cwd: path.join(root, 'android'), env, encoding: 'utf8', maxBuffer: 64 << 20});
    const parsed = parseGradleTree(output);
    if (!parsed.length) throw new Error(`Gradle returned no dependencies for ${configuration}`);
    for (const coord of parsed) coords.add(coord);
  }
  const snapshot = {configurations, inputFingerprint: androidDependencyFingerprint(root), coordinates: [...coords].sort()};
  fs.writeFileSync(path.join(root, ANDROID_CLASSPATH), JSON.stringify(snapshot, null, 2) + '\n');
  return snapshot;
}

function androidEntries(root, templates, errors) {
  if (!exists(root, ANDROID_CLASSPATH)) { errors.push(`${ANDROID_CLASSPATH} missing; run node scripts/generate-licenses.mjs --refresh-android`); return []; }
  const snapshot = readJson(root, ANDROID_CLASSPATH);
  if (snapshot.inputFingerprint !== androidDependencyFingerprint(root))
    errors.push(`${ANDROID_CLASSPATH} is stale: Android dependency declarations changed; run node scripts/generate-licenses.mjs --refresh-android`);
  const families = new Map();
  const unknown = [];
  for (const coord of snapshot.coordinates) {
    const [group,artifact,version] = coord.split(':');
    const family = mavenFamily(group,artifact,version);
    if (!family) { unknown.push(coord); continue; }
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(coord);
  }
  return [
    ...[...families].map(([family, coords]) => ({name: family.name, version: coords.join('\n'), license: family.license, source: family.source, text: family.licenseFile?read(root,family.licenseFile):templates.canonical(family.license)})),
    // A Maven group with no recorded licence is listed and flagged, never dropped.
    ...unknown.map(coord => {
      const [group, artifact, version] = coord.split(':');
      return {name: `Android dependency ${group}:${artifact}`, version, license: UNKNOWN, source: `https://mvnrepository.com/artifact/${group}/${artifact}/${version}`,
        text: `No licence is recorded for the Maven group ${group} in MAVEN_FAMILIES (scripts/generate-licenses.mjs). The artifact's own POM and licence file are not read by this generator.`,
        _flags: ['licence-text-missing-from-package']};
    }),
  ];
}

/**
 * On-device speech: libelizainference with the shared paradee-voice library (Paradee-8M TTS, misaki
 * G2P with eSpeak NG out-of-lexicon fallback, the ASR slot (Phonon-2), Silero VAD), read from
 * the Android voice host record (schema in scripts/voice-host.mjs, documented in docs/fused-speech.md).
 * No other speech inference engine ships in any build. Every component, model, data file and notice
 * the record names is listed; copyleft (eSpeak NG GPL-3.0-or-later) and unverified licences are
 * flagged, never dropped and never blocking.
 */
export const VOICE_HOST = VOICE_HOST_MANIFEST;
export {voiceHostProblems};
/** Every recorded bundle file ships (the record has no open rows). */
export const pinnedVoiceModels = record => (Array.isArray(record?.models) ? record.models : []);

/** One line per ABI: its recorded engine libraries. */
export function voiceHostLibraryLines(record) {
  return record.abis.flatMap(item => item.libraries.map(library => `${item.abi}/${library.name} (sha256 ${library.sha256}; ${library.bytes} bytes)`));
}

function voiceHostEntries(root, templates, errors) {
  if (!exists(root, VOICE_HOST)) return [];
  const record = readJson(root, VOICE_HOST);
  const problems = voiceHostProblems(record);
  if (problems.length) { errors.push(...problems); return []; }
  const abis = record.abis.map(item => item.abi).join(', ');
  const libraries = voiceHostLibraryLines(record).join('\n');
  const state = record.qualified ? 'qualified' : 'recorded bytes, not yet device-qualified';
  // The record carries no licence files of its own: canonical texts stand in and are flagged.
  const licenceText = license => {
    const canonical = license && license !== UNVERIFIED ? templates.canonical(license) : '';
    return canonical ? {text: canonical, textSource: 'spdx-canonical', _flags: ['licence-text-missing-from-package']} : {text: ''};
  };
  // The record spells an unestablished licence "UNVERIFIED"; it is listed and flagged as unverified.
  const licence = value => !value || value === 'UNVERIFIED' ? UNVERIFIED : value;
  const components = record.components.map(component => ({
    name: component.name, version: `elizaOS llama.cpp fork ${record.forkPin} (eliza ${record.pin}); ABIs ${abis}; ${state}`,
    license: licence(component.license), source: `${component.source}\nRecorded libraries:\n${libraries}`, ...licenceText(licence(component.license)),
  }));
  // eSpeak NG data files and notices are grouped under one entry each; models are listed one by one.
  const grouped = new Map();
  for (const model of pinnedVoiceModels(record)) {
    const key = model.role === 'g2p-data' ? 'eSpeak NG 1.52.0 English data (voice bundle, tts/paradee/espeak-ng-data)' : model.role === 'notice' ? null : `${model.name} (${model.role})`;
    if (key === null) continue;
    const entry = grouped.get(key) ?? {name: key, versions: [], license: licence(model.license), source: model.url ?? model.source, model};
    entry.versions.push(`${model.path} sha256 ${model.sha256} (${model.bytes} bytes)`);
    grouped.set(key, entry);
  }
  // A model whose licence requires attribution (Phonon-2, CC-BY-4.0) ships its attribution, the
  // upstream NOTICE and the upstream licence text verbatim; its training-data terms are flagged.
  const attributed = entry => {
    const {model} = entry;
    if (!model.attribution && !model.noticeFiles) return licenceText(entry.license);
    const files = Array.isArray(model.noticeFiles) ? model.noticeFiles : [];
    const missing = files.filter(file => !exists(root, file));
    if (missing.length) errors.push(`${VOICE_HOST}: ${model.path} notice file missing: ${missing.join(', ')}`);
    const text = [model.attribution ?? '', ...files.filter(file => exists(root, file)).map(file => normalizeText(read(root, file)))].filter(Boolean).join('\n\n');
    // The weights' own licence is recorded; the training-data terms their NOTICE names are not
    // established here, so they are flagged unverified (a record, never a build failure).
    return {text, _flags: model.licenseFlags?.length ? ['unverified'] : [], ...(model.licenseFlags?.length ? {_reason: `${model.license} weights; attribution, NOTICE and licence text are in this entry. ${model.licenseFlags.join(' ')}`} : {})};
  };
  const models = [...grouped.values()].map(entry => ({name: entry.name, version: entry.versions.join('; '), license: entry.license, source: entry.source, ...attributed(entry)}));
  return [...components, ...models];
}

export const AGENT_ASSETS = 'android/app/src/main/assets/agent';

/** True when a resident runtime is staged into the APK assets (runtimePackaging PACKAGED). */
export function packagedRuntimePresent(root = ROOT, agentDir = path.join(root, AGENT_ASSETS)) {
  return fs.existsSync(path.join(agentDir, 'agent-bundle.js')) && fs.existsSync(path.join(agentDir, 'android-agent-runtime-provenance.json'));
}

function runtimePackageEntry(dir, bundle, templates, errors) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) { errors.push(`${bundle}: ${dir} is not in the prepared runtime source; run npm run agent:prepare`); return null; }
  const manifest = readManifest(dir, `${bundle}: ${dir}`, errors);
  if (!manifest) return null;
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') { errors.push(`${bundle}: ${dir}/package.json has no name and version`); return null; }
  const notice = packageNotice({declared: manifestLicense(manifest), text: licenseFilesText(dir), dir, manifest, templates});
  return {name: manifest.name, version: manifest.version, source: `https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`, ...notice, _bundles: [bundle]};
}

function bunEntry(provenance, templates) {
  const {version, revision} = provenance.bun ?? {};
  return {name: BUN_ENTRY, version: `${version} (oven-sh/bun ${revision})`, license: UNVERIFIED,
    source: `https://github.com/oven-sh/bun/tree/${revision}`, _flags: ['copyleft-weak'],
    text: [
      `Bun ${version}, built from oven-sh/bun revision ${revision}, is packaged as libeliza_bun.so for ${(provenance.bun?.architectures ?? []).join(' and ')} and runs the on-device agent.`,
      'Bun is distributed under the MIT License:',
      templates.mit,
      'Bun statically links JavaScriptCore from WebKit (Oven fork, https://github.com/oven-sh/WebKit). JavaScriptCore is licensed under the GNU Lesser General Public License, version 2 or later (LGPL-2.0-or-later and LGPL-2.1-or-later portions), with BSD-licensed portions. Under the LGPL you may obtain, modify and relink the corresponding JavaScriptCore source.',
      `Corresponding source: Bun ${revision} at https://github.com/oven-sh/bun/tree/${revision}; its pinned WebKit revision is recorded in that tree (cmake/tools/SetupWebKit.cmake) and is available at https://github.com/oven-sh/WebKit.`,
      'Source offer: before distribution the distributor must confirm a written offer, valid for at least three years, to provide the complete corresponding source of these LGPL components on request. Other statically linked Bun dependencies (for example BoringSSL, libuv, zlib, mimalloc, c-ares, libdeflate, lol-html, zstd, brotli and libarchive) are listed in Bun\'s LICENSE.md at that revision.',
    ].join('\n\n')};
}

/**
 * Bun, every npm package bundled into the agent and every package in the
 * workflow-worker artifact, when a resident runtime is staged. Without one, the
 * notices carry only the umbrella payload entry.
 */
export function runtimeEntries(root, templates, errors, {agentDir = path.join(root, AGENT_ASSETS), sourceDir} = {}) {
  if (!packagedRuntimePresent(root, agentDir)) return [];
  const provenance = JSON.parse(fs.readFileSync(path.join(agentDir, 'android-agent-runtime-provenance.json'), 'utf8'));
  if (!provenance.bun?.version || !provenance.bun?.revision) errors.push(`${agentDir}/android-agent-runtime-provenance.json: no Bun version and revision`);
  const entries = [bunEntry(provenance, templates)];
  if (!sourceDir) {
    try {
      const base = JSON.parse(fs.readFileSync(path.join(agentDir, 'alpha-source.json'), 'utf8')).base;
      sourceDir = process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR || path.join(root, 'artifacts', `local-agent-resident-${base}`);
    } catch { errors.push(`${agentDir}/alpha-source.json is missing or unreadable`); return entries; }
  }
  const byId = new Map();
  const add = entry => {
    if (!entry) return;
    const key = `${entry.name}@${entry.version}`;
    const existing = byId.get(key);
    if (existing) existing._bundles = [...new Set([...existing._bundles, ...entry._bundles])];
    else byId.set(key, entry);
  };
  try {
    for (const {directory} of readAgentBundleDependencies(sourceDir, agentDir))
      add(runtimePackageEntry(path.join(sourceDir, directory), 'agent bundle', templates, errors));
  } catch (error) { errors.push(error.message); }
  const workerDir = path.join(agentDir, 'workflow-worker');
  if (fs.existsSync(path.join(workerDir, 'dependencies.json'))) {
    for (const dep of JSON.parse(fs.readFileSync(path.join(workerDir, 'dependencies.json'), 'utf8'))) {
      const notices = (dep.notices ?? []).map(file => path.join(workerDir, file));
      const missing = notices.filter(file => !fs.existsSync(file));
      if (missing.length) errors.push(`workflow-worker ${dep.name}@${dep.version}: missing notice ${missing.map(file => path.relative(workerDir, file)).join(', ')}`);
      let license = typeof dep.license === 'string' ? dep.license : '';
      const shippedDir = path.join(workerDir, dep.sourcePath ?? '');
      let manifest = {};
      if (dep.sourcePath && fs.existsSync(path.join(shippedDir, 'package.json'))) manifest = readManifest(shippedDir, `workflow-worker ${dep.name}@${dep.version}`, errors) ?? {};
      if (!license) license = manifestLicense(manifest);
      const text = notices.filter(file => fs.existsSync(file)).map(file => normalizeText(fs.readFileSync(file, 'utf8'))).join('\n\n');
      // No recorded notice file: the canonical terms of the declared licence are used and the entry is flagged.
      const notice = packageNotice({declared: license, text, dir: dep.sourcePath ? shippedDir : '', manifest, templates, shippedBy: 'workflow-worker artifact'});
      add({name: dep.name, version: dep.version, source: `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`, ...notice, _bundles: ['workflow worker']});
    }
  } else errors.push(`${workerDir}/dependencies.json is missing from the staged runtime`);
  // The compiled native Google host is a third bundled surface. Its input map is
  // recorded by the normal producer; inspect the real package roots, not guessed names.
  const workerManifest = path.join(workerDir, 'manifest.json');
  if (fs.existsSync(workerManifest)) {
    const host = JSON.parse(fs.readFileSync(workerManifest, 'utf8')).nativeGoogleHost;
    if (host) {
      if (!host.inputs || typeof host.inputs !== 'object' || Array.isArray(host.inputs)) errors.push('native Google host: missing input map');
      else {
        const packages = new Set();
        for (const input of Object.keys(host.inputs)) {
          if (path.isAbsolute(input) || input.split('/').some(part => !part || part === '..' || part === '.')) { errors.push('native Google host: invalid input path'); continue; }
          let dir = path.dirname(input);
          while (dir !== '.' && dir !== path.dirname(dir)) {
            const parent = path.dirname(dir);
            if (path.basename(parent) === 'node_modules' || (path.basename(parent).startsWith('@') && path.basename(path.dirname(parent)) === 'node_modules')) { packages.add(dir); break; }
            dir = parent;
          }
        }
        for (const dir of [...packages].sort()) add(runtimePackageEntry(path.join(root, dir), 'native Google host', templates, errors));
      }
    }
  }
  for (const entry of byId.values()) {
    entry.text = `Bundled in the on-device ${entry._bundles.join(' and ')}.\n\n${entry.text}`;
    entries.push(entry);
  }
  return entries;
}

export const BUN_ENTRY = 'Bun JavaScript runtime (libeliza_bun.so)';

/** True when the shipped notices were generated with --packaged-runtime (they list Bun). */
export function shippedPackagedRuntime(root = ROOT) {
  if (!exists(root, JSON_OUTPUT)) return false;
  try { return readJson(root, JSON_OUTPUT).some(entry => entry?.name === BUN_ENTRY); } catch { return false; }
}

function payloadEntries(packaged) {
  return [
    {name: 'On-device elizaOS agent runtime payload', version: 'pinned upstream runtime when present in the APK payload', license: UNVERIFIED,
      source: 'scripts/stage-local-agent-runtime.mjs',
      text: packaged
        ? 'The staged on-device agent payload is present. Bun and every npm package bundled into the agent and the workflow worker are listed as separate entries. The remaining payload files (musl loader, libstdc++ and libgcc_s runtime libraries, PGlite WebAssembly and data, PostgreSQL extensions and models) are not enumerated here.'
        : 'The on-device agent payload (Bun runtime and the bundled elizaOS agent with its dependencies) is staged from pinned upstream source and may be included in standard Android builds. These notices were generated without the staged runtime, so its Bun and dependency notices are not listed. A PACKAGED distribution build regenerates them after staging with node scripts/generate-licenses.mjs --packaged-runtime (resident-android.yml); an APK built without that step does not carry them.'},
  ];
}

function mapDataEntries(root) {
  return [{name: 'OpenStreetMap data', version: 'regional extract served by the configured Maps endpoint', license: 'ODbL-1.0', source: 'https://www.openstreetmap.org/copyright',
    text: `Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0. Map tiles, search and routes are produced from OpenStreetMap data by the configured Maps service; the Planetiler OpenMapTiles profile used to build tiles carries its own attribution metadata.\n\n${normalizeText(read(root, 'licenses/ODbL-1.0.txt'))}`}];
}

// ---------------------------------------------------------------- assembly

/**
 * Attach the recorded reason to each unverified or proprietary entry. The two reason files do
 * not gate anything: an item with no recorded reason is still listed and flagged.
 */
function applyReasons(root, entries, warnings, packagedRuntime) {
  const allowlist = exists(root, ALLOWLIST) ? readJson(root, ALLOWLIST) : {entries: []};
  // Items that exist only in a staged runtime have their reasons in their own list, read only then.
  if (packagedRuntime && exists(root, RUNTIME_ALLOWLIST))
    allowlist.entries = [...allowlist.entries, ...readJson(root, RUNTIME_ALLOWLIST).entries];
  const used = new Set();
  for (const entry of entries) {
    if (entry.license !== UNVERIFIED && entry.license !== NO_FONT_LICENCE) continue;
    const keys = entry._unverifiedKey || [];
    // File-backed entries (fonts) are matched per exact file hash, so a swapped file is not covered by an old reason.
    const match = allowlist.entries.find(item => item.name === entry.name && (keys.length ? keys.includes(item.sha256) : !item.sha256));
    if (!match || typeof match.reason !== 'string' || match.reason.trim().length < 20) { warnings.push(`${entry.name} ${entry.version}: ${entry.license}, with no reason recorded in ${ALLOWLIST}`); continue; }
    used.add(match);
    entry._reason = match.reason.trim();
  }
  // An entry that names the record it `requires` (for example the voice-host qualification) is stale only once that record exists.
  for (const item of allowlist.entries) if (!used.has(item) && (!item.requires || exists(root, item.requires))) warnings.push(`${ALLOWLIST}: stale entry ${item.name}${item.sha256 ? ` (${item.sha256})` : ''}`);
}

export function collectNotices(root = ROOT, {packagedRuntime = shippedPackagedRuntime(root)} = {}) {
  const errors = [], warnings = [];
  if (packagedRuntime && !packagedRuntimePresent(root))
    errors.push(`--packaged-runtime needs a staged runtime in ${AGENT_ASSETS}; run npm run agent:stage-android first`);
  const templates = loadTemplates(root);
  const entries = [
    ...npmEntries(root, templates, errors),
    ...pdfjsEntries(root, errors),
    ...ocrDataEntries(root),
    ...tesseractCoreEntries(root, errors),
    ...fontEntries(root, templates, errors),
    elizaEntry(root),
    ...androidEntries(root, templates, errors),
    ...voiceHostEntries(root, templates, errors),
    ...payloadEntries(packagedRuntime),
    ...(packagedRuntime ? runtimeEntries(root, templates, errors) : []),
    ...mapDataEntries(root),
  ];
  applyReasons(root, entries, warnings, packagedRuntime);
  const clean = entries.map(finishEntry).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  return {entries: clean, errors, warnings};
}

/** Public form of an entry: classify its licence, order its flags and state what each obliges. */
export function finishEntry(entry) {
  const {flags: classified, chosen} = classifyLicence(entry.license);
  const flags = flagSummaryOrder([...(entry._flags ?? []), ...classified]);
  const text = normalizeText(entry.text ?? '') || 'No licence text is available for this entry.';
  if (!normalizeText(entry.text ?? '') && !flags.includes('licence-text-missing-from-package')) flags.splice(0, flags.length, ...flagSummaryOrder([...flags, 'licence-text-missing-from-package']));
  const context = {license: entry.license, source: entry.source, repository: entry.repository, reason: entry._reason, textSource: entry.textSource, chosen};
  return {
    name: entry.name, version: entry.version, license: entry.license, source: entry.source, text,
    ...(entry.textSource ? {textSource: entry.textSource} : {}),
    flags,
    ...(flags.length ? {obligations: flags.map(flag => ({flag, note: obligationNote(flag, context)}))} : {}),
  };
}

const flagSummaryOrder = flags => flagSummary([{flags}]).map(group => group.flag);

export function renderJson(entries) {
  return JSON.stringify(entries, null, 2) + '\n';
}

const display = entry => `${entry.name}@${entry.version.split('\n')[0]} (${entry.license})`;

export function renderText(entries) {
  const flagged = entries.filter(entry => entry.flags?.length);
  const summary = flagSummary(entries).flatMap(group => [`${group.flag} (${group.entries.length}):`, ...group.entries.map(entry => `  - ${display(entry)}`)]);
  const header = [
    'Alpha Phone third-party notices',
    '',
    'This product includes the third-party software, fonts, models and data listed below.',
    'Generated by scripts/generate-licenses.mjs from package-lock.json, bundled font files,',
    'the resolved Android runtime classpath, the qualified voice-host record and elizaOS.',
    `Entries: ${entries.length}. Flagged entries: ${flagged.length}.`,
    '',
    'FLAGGED ENTRIES',
    'A flag records what was found about an entry: a copyleft licence, a licence that is unknown or',
    'unverified, a package that ships no licence file, or a proprietary item with no recorded licence.',
    'Each flagged entry below states what its flags oblige. A flag is not legal review and not a clearance.',
    '',
    ...(summary.length ? summary : ['None.']),
  ].join('\n');
  const blocks = entries.map(entry => [
    '='.repeat(78),
    `${entry.name}`,
    `Version: ${entry.version.replace(/\n/g, '\n         ')}`,
    `License: ${entry.license}`,
    `Source: ${entry.source.replace(/\n/g, '\n        ')}`,
    ...(entry.textSource ? [`License text: ${entry.textSource === 'spdx-canonical' ? 'canonical SPDX text (the package ships no licence file)' : entry.textSource === 'package-and-spdx-canonical' ? 'the package\'s licence file followed by the canonical SPDX text it names' : entry.textSource}`] : []),
    ...(entry.flags?.length ? [`Flags: ${entry.flags.join(', ')}`, ...entry.obligations.map(item => `Obligation (${item.flag}): ${item.note}`)] : []),
    '',
    entry.text,
  ].join('\n'));
  return `${header}\n\n${blocks.join('\n\n')}\n`;
}

export function generate(root = ROOT, options = {}) {
  const {entries, errors, warnings} = collectNotices(root, options);
  return {entries, errors, warnings, flagLines: licenceFlagLines(entries), json: renderJson(entries), text: renderText(entries)};
}

async function main(argv) {
  const check = argv.includes('--check');
  if (argv.includes('--refresh-android')) {
    const {androidEnv} = await import('./toolchain.mjs');
    const snapshot = refreshAndroidClasspath(ROOT, androidEnv());
    console.log(`Resolved ${snapshot.coordinates.length} Android runtime coordinates into ${ANDROID_CLASSPATH}`);
  }
  // Writing defaults to the committed (no runtime) form; --check follows the shipped form.
  const packagedRuntime = argv.includes('--packaged-runtime') || (check && shippedPackagedRuntime(ROOT));
  const {entries, errors, warnings, flagLines, json, text} = generate(ROOT, {packagedRuntime});
  const summarize = (rows, label) => {
    const bundled = rows.filter(entry => /^Bundled in the on-device /.test(entry.text));
    const bun = rows.find(entry => entry.name === BUN_ENTRY);
    console.log(`${label}: ${bun ? `${bun.name} ${bun.version}` : 'Bun MISSING'}; ${bundled.length} bundled agent/workflow-worker npm packages.`);
  };
  if (packagedRuntime) summarize(entries, 'PACKAGED runtime notices');
  else if (check && packagedRuntimePresent(ROOT)) {
    // List what a PACKAGED distribution of this staged runtime would ship, without
    // comparing it to the committed (no runtime) notices.
    const staged = collectNotices(ROOT, {packagedRuntime: true});
    summarize(staged.entries, 'Staged runtime (not in the committed notices; use --packaged-runtime for a distribution)');
    for (const error of staged.errors) console.warn(`Staged runtime notice problem: ${error}`);
  }
  // Flags are warnings. Only broken input (errors) stops generation.
  for (const line of flagLines) console.warn(line);
  for (const warning of warnings) console.warn(`LICENCE NOTE ${warning}`);
  if (flagLines.length) {
    const counts = flagSummary(entries).map(group => `${group.flag} ${group.entries.length}`).join(', ');
    console.warn(`Licence flags: ${entries.filter(entry => entry.flags.length).length} of ${entries.length} entries flagged (${counts}). Flagged entries are included with their licence texts; a flag is not a failure and not legal review.`);
  }
  if (errors.length) {
    console.error(`Third-party notice generation failed on broken input:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  const outputs = [[JSON_OUTPUT, json], [TEXT_OUTPUT, text]];
  if (check) {
    const stale = outputs.filter(([file, content]) => !exists(ROOT, file) || read(ROOT, file) !== content).map(([file]) => file);
    if (stale.length) {
      console.error(`Third-party notices are stale: ${stale.join(', ')}. Run node scripts/generate-licenses.mjs`);
      process.exit(1);
    }
    console.log(`Third-party notices are complete and current (${entries.length} entries).`);
    return;
  }
  fs.mkdirSync(path.join(ROOT, OUTPUT_DIR), {recursive: true});
  for (const [file, content] of outputs) fs.writeFileSync(path.join(ROOT, file), content);
  console.log(`Wrote ${entries.length} entries to ${JSON_OUTPUT} and ${TEXT_OUTPUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
