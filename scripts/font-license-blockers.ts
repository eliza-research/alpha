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
import {regularFiles} from './regular-files.ts';
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

interface FontHash {
  name: string;
  sha256: string;
}
interface FontOptions {
  unverifiedFonts?: readonly FontHash[];
  ownerStatedFonts?: readonly FontHash[];
}
interface FontNotice {
  name: string;
  flags?: string[];
  source?: string;
  license?: string;
}
type FontFiles = Map<string, Set<string>>;

/** Fonts listed by hash with no licence record: a payload file with these bytes is unresolved. */
export function readUnverifiedFontHashes(root = ROOT) {
  const file = path.join(root, 'licenses/unverified-allowlist.json');
  if (!fs.existsSync(file)) return [];
  const {entries}: {entries: {name: string; sha256?: string}[]} = JSON.parse(fs.readFileSync(file, 'utf8'));
  return entries.flatMap(entry => entry.sha256 ? [{name: entry.name, sha256: entry.sha256}] : []);
}

/** Fonts recorded on the owner's statement (evidence "held-outside-repository"), one row per recorded hash. */
export function readOwnerStatedFontHashes(root = ROOT) {
  const file = path.join(root, 'licenses/font-licenses.json');
  if (!fs.existsSync(file)) return [];
  const {entries}: {entries: {name: string; evidence: string; sha256?: string[]; basis?: string}[]} = JSON.parse(fs.readFileSync(file, 'utf8'));
  return entries.filter(entry => entry.evidence === HELD_OUTSIDE_REPOSITORY)
    .flatMap(entry => (entry.sha256 ?? []).map(sha256 => ({name: entry.name, sha256, basis: entry.basis})));
}

const typeface = (entry: Partial<FontNotice> | null): entry is FontNotice => typeof entry?.name === 'string' && entry.name.endsWith(' typeface');
const hasFlag = (entry: FontNotice, flag: string) => Array.isArray(entry.flags) && entry.flags.includes(flag);
const listedFiles = (entry: FontNotice) => [...String(entry.source ?? '').matchAll(/^(\S+) \(sha256 ([0-9a-f]{64})\)$/gm)].map(match => ({file: match[1], sha256: match[2]}));

export function fontLicenceFindings(publicDir: string, {
  unverifiedFonts = readUnverifiedFontHashes(), ownerStatedFonts = readOwnerStatedFontHashes(),
}: FontOptions = {}) {
  const unresolved: FontFiles = new Map();
  const resolved: FontFiles = new Map();
  const add = (map: FontFiles, name: string, file?: string) => {
    let files = map.get(name);
    if (!files) map.set(name, files = new Set());
    if (file) files.add(file);
  };
  const digests = new Map<string, string>();
  for (const file of [...regularFiles(publicDir)].filter(file => FONT_FILE.test(file)).sort()) {
    const name = path.relative(publicDir, file).split(path.sep).join('/');
    digests.set(name, createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  }
  const stated = new Map(ownerStatedFonts.map(font => [font.sha256, font.name]));
  // The bytes decide first: a recorded hash is resolved, a listed-unrecorded hash is unresolved, wherever the file sits.
  for (const [file, digest] of digests) {
    const name = stated.get(digest);
    if (name !== undefined) add(resolved, name, file);
    for (const font of unverifiedFonts) if (font.sha256 === digest) add(unresolved, font.name, file);
  }
  let notices: (Partial<FontNotice> | null)[] = [];
  try { notices = JSON.parse(fs.readFileSync(path.join(publicDir, 'licenses', 'third-party-notices.json'), 'utf8')); } catch { /* a payload without readable notices is judged by its bytes */ }
  for (const entry of Array.isArray(notices) ? notices : []) {
    if (!typeface(entry)) continue;
    const held = hasFlag(entry, FONT_HELD_FLAG);
    const unrecorded = hasFlag(entry, FONT_FLAG) || entry.license === NO_FONT_LICENCE || entry.license === UNVERIFIED;
    if (!held && !unrecorded) continue;
    const files = listedFiles(entry);
    const present = files.filter(item => digests.has(item.file));
    if (held) {
      // The notice vouches only for the bytes it lists: a swapped file under the same name is unrecorded.
      for (const item of present) if (digests.get(item.file) === item.sha256) add(resolved, entry.name, item.file); else add(unresolved, entry.name, item.file);
      if (!present.length && !resolved.has(entry.name)) { add(resolved, entry.name); for (const item of files) add(resolved, entry.name, item.file); }
      continue;
    }
    // Notices that still call the face unrecorded are overridden only by bytes the owner's record covers.
    const open = present.filter(item => !stated.has(digests.get(item.file) ?? ''));
    for (const item of open) add(unresolved, entry.name, item.file);
    if (!present.length) { add(unresolved, entry.name); for (const item of files) add(unresolved, entry.name, item.file); }
  }
  const rows = (map: FontFiles, text: (name: string, files: string) => string) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([name, files]) => {
    const list = [...files].sort();
    return {name, files: list, message: text(name, list.length ? ` (${list.join(', ')})` : '')};
  });
  return {
    unresolved: rows(unresolved, (name, files) => `${FONT_BLOCKER}: ${name}${files} has no recorded licence; record its licence in licenses/font-licenses.json or replace it (owner decision A-21, ${FONT_BLOCKER_REFERENCE})`),
    resolved: rows(resolved, (name, files) => `${FONT_BLOCKER}: ${RESOLVED_BY_OWNER_STATEMENT}: ${name}${files} is proprietary; the owner states the licence is held and its document is kept outside this repository (licenses/font-licenses.json, owner decision A-21)`),
  };
}

/** Unresolved fonts only, in the shape callers have always used. */
export function fontLicenseBlockers(publicDir: string, options?: FontOptions) {
  return fontLicenceFindings(publicDir, options).unresolved.map(row => ({blocker: FONT_BLOCKER, flag: FONT_FLAG, ...row}));
}

/**
 * The record verify-apks writes for one APK payload.
 * `items` (unresolved) and `resolved` are always reported. `blockers` are the unresolved items
 * only while the check blocks distribution. status: "unresolved" when any font is unrecorded,
 * else "resolved-by-owner-statement" when a font is covered by the owner's statement, else "clear".
 * @param {string} publicDir
 * @param {{blocksDistribution?: boolean, unverifiedFonts?: Array<{name: string, sha256: string}>, ownerStatedFonts?: Array<{name: string, sha256: string}>}} [options]
 */
export function fontLicenceCheck(publicDir: string, {blocksDistribution = UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION, ...options}: FontOptions & {blocksDistribution?: boolean} = {}) {
  const findings = fontLicenceFindings(publicDir, options);
  const items = findings.unresolved.map(row => row.message), resolved = findings.resolved.map(row => row.message);
  return {check: FONT_BLOCKER, status: items.length ? 'unresolved' : resolved.length ? RESOLVED_BY_OWNER_STATEMENT : 'clear', blocksDistribution, items, resolved, blockers: blocksDistribution ? items : []};
}

/** How a font item is printed: a blocker only for an unresolved font while the constant says so. */
export const fontLicenceLine = (message: string, blocksDistribution: boolean = UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION) =>
  `${blocksDistribution && !message.startsWith(`${FONT_BLOCKER}: ${RESOLVED_BY_OWNER_STATEMENT}: `) ? 'RELEASE BLOCKER' : 'LICENCE FLAG (reported, not blocking)'} ${message}`;
