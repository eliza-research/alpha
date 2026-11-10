/**
 * The one licence check that is not covered by the open-source licence policy (P-09): proprietary
 * fonts in a built web payload (web-dist or an APK's assets/public). Check name: unresolved-font-licence.
 *
 * It sorts every proprietary font it finds into one of two lists:
 *
 * - resolved-by-owner-statement: the font's bytes are the bytes recorded in
 *   licenses/font-licenses.json with evidence "held-outside-repository" (today the Denton
 *   typeface, decision A-21), or the payload's own notices flag the typeface
 *   `proprietary-licence-held-outside-repo` and the listed file still has the listed hash.
 *   Reported, never blocking. It says the owner states the licence is held; no document was seen.
 * - unresolved: the payload's notices flag a typeface `proprietary-no-licence-recorded` (or carry
 *   the earlier "license unverified" marking), a listed font file no longer has the hash its
 *   notice lists, or a file has the bytes of a font listed by hash in
 *   licenses/unverified-allowlist.json. A different or swapped font file is therefore still
 *   reported as unrecorded, and stale notices or a renamed file cannot hide it.
 *
 * The check is always run, always recorded and always printed as a LICENCE FLAG line. Whether an
 * unresolved font also withholds `distributable` and blocks release gates is the single constant
 * UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION in scripts/licence-policy.ts (default false).
 * Developer builds are never failed by it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {HELD_OUTSIDE_REPOSITORY, NO_FONT_LICENCE, UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION, UNVERIFIED} from './licence-policy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;
export const FONT_BLOCKER = 'unresolved-font-licence';
/** Flag of a font with no record at all. */
export const FONT_FLAG = 'proprietary-no-licence-recorded';
/** Flag of a font recorded on the owner's statement that the licence is held outside the repository. */
export const FONT_HELD_FLAG = 'proprietary-licence-held-outside-repo';
export const RESOLVED_BY_OWNER_STATEMENT = 'resolved-by-owner-statement';
export const FONT_BLOCKER_REFERENCE = 'licenses/font-licenses.json';

function walk(root: any, directory: any = root, out: any[] = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(root, file, out);
    else if (entry.isFile() && FONT_FILE.test(entry.name)) out.push(path.relative(root, file).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Fonts listed by hash with no licence record: a payload file with these bytes is unresolved. */
export function readUnverifiedFontHashes(root: any = ROOT) {
  const file = path.join(root, 'licenses/unverified-allowlist.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).entries.filter((entry: any) => entry.sha256).map((entry: any) => ({name: entry.name, sha256: entry.sha256}));
}

/** Fonts recorded on the owner's statement (evidence "held-outside-repository"), one row per recorded hash. */
export function readOwnerStatedFontHashes(root: any = ROOT) {
  const file = path.join(root, 'licenses/font-licenses.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).entries.filter((entry: any) => entry.evidence === HELD_OUTSIDE_REPOSITORY)
    .flatMap((entry: any) => (entry.sha256 ?? []).map((sha256: any) => ({name: entry.name, sha256, basis: entry.basis})));
}

const typeface = (entry: any) => typeof entry?.name === 'string' && entry.name.endsWith(' typeface');
const hasFlag = (entry: any, flag: any) => Array.isArray(entry.flags) && entry.flags.includes(flag);
const listedFiles = (entry: any) => [...String(entry.source ?? '').matchAll(/^(\S+) \(sha256 ([0-9a-f]{64})\)$/gm)].map((match: any) => ({file: match[1], sha256: match[2]}));

/**
 * @param {string} publicDir built web payload root
 * @param {{unverifiedFonts?: Array<{name: string, sha256: string}>, ownerStatedFonts?: Array<{name: string, sha256: string}>}} [options]
 * @returns {{unresolved: Array<{name: string, files: string[], message: string}>, resolved: Array<{name: string, files: string[], message: string}>}}
 */
export function fontLicenceFindings(publicDir: any, {unverifiedFonts = readUnverifiedFontHashes(), ownerStatedFonts = readOwnerStatedFontHashes()}: any = {}) {
  const unresolved = new Map(), resolved = new Map();
  const add = (map: any, name: any, file: any = undefined) => { if (!map.has(name)) map.set(name, new Set()); if (file) map.get(name).add(file); };
  const digests = new Map();
  if (fs.existsSync(publicDir)) for (const file of walk(publicDir)) digests.set(file, createHash('sha256').update(fs.readFileSync(path.join(publicDir, file))).digest('hex'));
  const stated = new Map(ownerStatedFonts.map((font: any) => [font.sha256, font.name]));
  // The bytes decide first: a recorded hash is resolved, a listed-unrecorded hash is unresolved, wherever the file sits.
  for (const [file, digest] of digests) {
    if (stated.has(digest)) add(resolved, stated.get(digest), file);
    for (const font of unverifiedFonts) if (font.sha256 === digest) add(unresolved, font.name, file);
  }
  let notices: any[] = [];
  try { notices = JSON.parse(fs.readFileSync(path.join(publicDir, 'licenses', 'third-party-notices.json'), 'utf8')); } catch { /* a payload without readable notices is judged by its bytes */ }
  for (const entry of Array.isArray(notices) ? notices : []) {
    if (!typeface(entry)) continue;
    const held = hasFlag(entry, FONT_HELD_FLAG);
    const unrecorded = hasFlag(entry, FONT_FLAG) || entry.license === NO_FONT_LICENCE || entry.license === UNVERIFIED;
    if (!held && !unrecorded) continue;
    const files = listedFiles(entry);
    const present = files.filter((item: any) => digests.has(item.file));
    if (held) {
      // The notice vouches only for the bytes it lists: a swapped file under the same name is unrecorded.
      for (const item of present) if (digests.get(item.file) === item.sha256) add(resolved, entry.name, item.file); else add(unresolved, entry.name, item.file);
      if (!present.length && !resolved.has(entry.name)) { add(resolved, entry.name); for (const item of files) add(resolved, entry.name, item.file); }
      continue;
    }
    // Notices that still call the face unrecorded are overridden only by bytes the owner's record covers.
    const open = present.filter((item: any) => !stated.has(digests.get(item.file)));
    for (const item of open) add(unresolved, entry.name, item.file);
    if (!present.length) { add(unresolved, entry.name); for (const item of files) add(unresolved, entry.name, item.file); }
  }
  const rows = (map: any, text: any) => [...map].sort(([a]: any, [b]: any) => a.localeCompare(b)).map(([name, files]: any) => {
    const list = [...files].sort();
    return {name, files: list, message: text(name, list.length ? ` (${list.join(', ')})` : '')};
  });
  return {
    unresolved: rows(unresolved, (name: any, files: any) => `${FONT_BLOCKER}: ${name}${files} has no recorded licence; record its licence in licenses/font-licenses.json or replace it (owner decision A-21, ${FONT_BLOCKER_REFERENCE})`),
    resolved: rows(resolved, (name: any, files: any) => `${FONT_BLOCKER}: ${RESOLVED_BY_OWNER_STATEMENT}: ${name}${files} is proprietary; the owner states the licence is held and its document is kept outside this repository (licenses/font-licenses.json, owner decision A-21)`),
  };
}

/** Unresolved fonts only, in the shape callers have always used. */
export function fontLicenseBlockers(publicDir: any, options: any) {
  return fontLicenceFindings(publicDir, options).unresolved.map((row: any) => ({blocker: FONT_BLOCKER, flag: FONT_FLAG, ...row}));
}

/**
 * The record verify-apks writes for one APK payload.
 * `items` (unresolved) and `resolved` are always reported. `blockers` are the unresolved items
 * only while the check blocks distribution. status: "unresolved" when any font is unrecorded,
 * else "resolved-by-owner-statement" when a font is covered by the owner's statement, else "clear".
 * @param {string} publicDir
 * @param {{blocksDistribution?: boolean, unverifiedFonts?: Array<{name: string, sha256: string}>, ownerStatedFonts?: Array<{name: string, sha256: string}>}} [options]
 */
export function fontLicenceCheck(publicDir: any, {blocksDistribution = UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION, ...options}: any = {}) {
  const findings = fontLicenceFindings(publicDir, options);
  const items = findings.unresolved.map((row: any) => row.message), resolved = findings.resolved.map((row: any) => row.message);
  return {check: FONT_BLOCKER, status: items.length ? 'unresolved' : resolved.length ? RESOLVED_BY_OWNER_STATEMENT : 'clear', blocksDistribution, items, resolved, blockers: blocksDistribution ? items : []};
}

/** How a font item is printed: a blocker only for an unresolved font while the constant says so. */
export const fontLicenceLine = (message: any, blocksDistribution: any = UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION) =>
  `${blocksDistribution && !message.startsWith(`${FONT_BLOCKER}: ${RESOLVED_BY_OWNER_STATEMENT}: `) ? 'RELEASE BLOCKER' : 'LICENCE FLAG (reported, not blocking)'} ${message}`;
