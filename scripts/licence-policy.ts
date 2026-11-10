import fs from 'node:fs';
import path from 'node:path';

/**
 * Licence policy (owner decision P-09, 2026-10-10): an open-source dependency licence never
 * stops a build and is never a release blocker. Every licence text and notice still ships, and
 * anything copyleft, unknown or unverified is FLAGGED, with what it obliges, in the notices
 * (JSON and text), in the build output (`LICENCE FLAG <flag>: <package>@<version> (<spdx>)`)
 * and in the machine-readable inventories (verify-apks `licenceFlags`, the SBOM).
 *
 * A flag is a statement of what was found. It is not legal review and not a clearance.
 *
 * One kind of item is outside that decision: a bundled proprietary font. It is not open-source
 * software, so it keeps one separately named check, `unresolved-font-licence`, which is always
 * run and recorded. The Denton typeface is recorded in licenses/font-licenses.json on the
 * owner's statement that the licence is held outside this repository; it is flagged
 * `proprietary-licence-held-outside-repo` and the check reports it resolved-by-owner-statement.
 * A font with no record at all is flagged `proprietary-no-licence-recorded` and reported
 * unresolved; whether an unresolved font withholds `distributable` is the single switch below.
 */

/**
 * false (default, owner decision 2026-10-10 under P-09 / A-21: "flag only"): the check is still
 *        run, recorded on every APK row (`fontLicenceCheck`) and printed as a LICENCE FLAG
 *        warning, but an unresolved font does not withhold `distributable` and is not a
 *        release blocker.
 * true:  strict: a release whose packaged payload carries a proprietary font with no record
 *        in licenses/font-licenses.json is recorded distributable:false and the check is a
 *        named release blocker in every gate. A font recorded on the owner's statement
 *        (resolved-by-owner-statement) is reported, not blocked, under either setting.
 * Change it only on the owner's word.
 */
export const UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION = false;

/**
 * The written offer for the complete corresponding source of Bun's LGPL components
 * (JavaScriptCore). It is legal text only the owner supplies: `{"offer": "<who to contact, how,
 * for how long>"}`. When it is present the Bun notice ships it; when it is absent the notice
 * names only the source addresses and the licence review reports SOURCE_OFFER_MISSING.
 */
export const SOURCE_OFFER_FILE = 'licenses/source-offer.json';
export const SOURCE_OFFER_MISSING = 'written source offer for Bun LGPL components not recorded';

/** The recorded offer text, null when none is recorded; a malformed record throws. */
export function readSourceOffer(root: any) {
  const file = path.join(root, SOURCE_OFFER_FILE);
  if (!fs.existsSync(file)) return null;
  const offer = JSON.parse(fs.readFileSync(file, 'utf8'))?.offer;
  if (typeof offer !== 'string' || !offer.trim()) throw new Error(`${SOURCE_OFFER_FILE} has no "offer" text`);
  return offer.trim();
}

export const UNKNOWN = 'UNKNOWN';
export const UNVERIFIED = 'license unverified';
export const COMMERCIAL_FONT = 'LicenseRef-Commercial-Font';
/** Licence value of a bundled font that states no open licence and has no recorded one. */
export const NO_FONT_LICENCE = 'proprietary, no licence recorded';
/** font-licenses.json `evidence` state: the owner states the licence is held; its document is not in this repository. */
export const HELD_OUTSIDE_REPOSITORY = 'held-outside-repository';

export const FLAGS = [
  'copyleft-strong', 'network-copyleft', 'copyleft-weak', 'share-alike-data', 'unknown-licence', 'non-open-source-terms',
  'licence-text-missing-from-package', 'unverified', 'permissive-not-previously-listed', 'proprietary-licence-held-outside-repo', 'proprietary-no-licence-recorded',
];

/**
 * Permissive identifiers this project listed before P-09 (no flag), and further permissive
 * identifiers recognised from the SPDX list that were never on that list (flagged
 * permissive-not-previously-listed, so a licence nobody here has looked at stays visible).
 * Anything in neither set is flagged unknown-licence.
 */
export const PERMISSIVE = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'IJG', 'ISC', 'libpng-2.0', 'libtiff', 'MIT', 'OFL-1.1', 'SunPro', 'Zlib']);
export const PERMISSIVE_NOT_PREVIOUSLY_LISTED = new Set([
  'Artistic-2.0', 'BlueOak-1.0.0', 'BSD-3-Clause-Clear', 'BSL-1.0', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'MIT-0', 'PSF-2.0',
  'Python-2.0', 'Unicode-3.0', 'Unicode-DFS-2016', 'Unlicense', 'WTFPL', 'X11',
]);

const base = (id: any) => id.replace(/\+$/, '').replace(/-(only|or-later)$/, '');

/** Flags for one SPDX identifier (without any WITH exception). */
export function identifierFlags(id: any) {
  const name = base(String(id).trim());
  if (!name) return ['unknown-licence'];
  if (PERMISSIVE.has(name)) return [];
  if (PERMISSIVE_NOT_PREVIOUSLY_LISTED.has(name)) return ['permissive-not-previously-listed'];
  if (/^AGPL-/.test(name)) return ['copyleft-strong', 'network-copyleft'];
  if (/^(GPL|EUPL|OSL|SSPL)-/.test(name)) return name.startsWith('SSPL') ? ['unknown-licence'] : ['copyleft-strong'];
  if (/^(LGPL|MPL|EPL|CDDL|CPL)-/.test(name)) return ['copyleft-weak'];
  if (/^(ODbL|CC-BY-SA|CDLA-Sharing)-/.test(name)) return ['share-alike-data'];
  return ['unknown-licence'];
}

/**
 * Parse an SPDX expression into its alternatives: a list (OR) of identifier lists (AND).
 * Returns null when the expression is not SPDX syntax.
 */
export function licenceAlternatives(expression: any) {
  if (typeof expression !== 'string' || !expression.trim()) return null;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const cross = (a: any, b: any) => a.flatMap((x: any) => b.map((y: any) => [...x, ...y]));
  const atom = (): string[][] => {
    const token = tokens[pos++];
    if (token === '(') { const inner = or(); if (tokens[pos++] !== ')') throw new Error('unbalanced'); return inner; }
    if (!token || token === ')' || /^(AND|OR|WITH)$/i.test(token) || !/^[A-Za-z0-9.+-]+$/.test(token)) throw new Error('identifier expected');
    let id = token;
    if (/^WITH$/i.test(tokens[pos] ?? '')) { pos++; const exception = tokens[pos++]; if (!exception || !/^[A-Za-z0-9.-]+$/.test(exception)) throw new Error('exception expected'); id = `${token} WITH ${exception}`; }
    return [[id]];
  };
  const and = (): string[][] => { let left = atom(); while (/^AND$/i.test(tokens[pos] ?? '')) { pos++; left = cross(left, atom()); } return left; };
  const or = (): string[][] => { let left = and(); while (/^OR$/i.test(tokens[pos] ?? '')) { pos++; left = [...left, ...and()]; } return left; };
  try { const out = or(); return pos === tokens.length ? out : null; } catch { return null; }
}

const ordered = (flags: any) => FLAGS.filter((flag: any) => flags.includes(flag));
const SEVERITY: Record<string,number> = {'unknown-licence': 100, 'copyleft-strong': 40, 'network-copyleft': 20, 'copyleft-weak': 10, 'share-alike-data': 5, 'permissive-not-previously-listed': 1};

/**
 * Flags for a declared licence expression. With alternatives (OR) the least encumbered
 * alternative is the one the product relies on, so its flags are the ones reported.
 * @returns {{flags: string[], chosen: string[] | null, identifiers: string[]}}
 */
export function classifyLicence(expression: any) {
  if (expression === COMMERCIAL_FONT) return {flags: [], chosen: [COMMERCIAL_FONT], identifiers: [COMMERCIAL_FONT]};
  if (expression === UNVERIFIED) return {flags: ['unverified'], chosen: null, identifiers: []};
  if (expression === NO_FONT_LICENCE) return {flags: ['proprietary-no-licence-recorded'], chosen: null, identifiers: []};
  const alternatives = licenceAlternatives(expression);
  if (!alternatives || expression === UNKNOWN) return {flags: ['unknown-licence'], chosen: null, identifiers: []};
  const scored = alternatives.map((ids: any) => {
    const flags = ordered([...new Set(ids.flatMap((id: any) => identifierFlags(id.split(/ WITH /i)[0])))]);
    return {ids, flags, score: flags.reduce((sum: any, flag: any) => sum + (SEVERITY[flag] ?? 0), 0)};
  }).sort((a: any, b: any) => a.score - b.score);
  return {flags: scored[0].flags, chosen: scored[0].ids, identifiers: [...new Set(alternatives.flat())]};
}

/** Canonical-text file name stem for an identifier: GPL-3.0-or-later -> GPL-3.0. */
export const canonicalId = (id: any) => base(String(id).split(/ WITH /i)[0].trim());

const family = (identifiers: any, pattern: any) => identifiers.map((id: any) => id.split(/ WITH /i)[0]).filter((id: any) => pattern.test(id));

/**
 * One plain-words note per flag. `entry` gives {license, source, repository?, reason?, chosen?}.
 * These say what the licence asks for and where the source is. They are not legal advice.
 */
export function obligationNote(flag: any, entry: any) {
  const where = `Corresponding source: ${String(entry.source ?? 'not recorded').split('\n')[0]}${entry.repository ? ` (repository: ${entry.repository})` : ''}.`;
  const ids = entry.chosen ?? [];
  const exception = ids.filter((id: any) => / WITH /i.test(id)).map((id: any) => id.split(/ WITH /i)[1]);
  const withException = exception.length ? ` It is declared with the exception ${exception.join(', ')}, which narrows these conditions.` : '';
  switch (flag) {
    case 'copyleft-strong': {
      const names = family(ids, /^(A?GPL|EUPL|OSL)-/).join(', ') || entry.license;
      return `${names} is a strong copyleft licence. Its licence text and the copyright notices ship with the app in this entry. Anyone who receives the app must be able to get the complete corresponding source of this component at this exact version. ${where} The licence also sets conditions on distributing a larger work that contains the component; that has not been assessed here.${withException}`;
    }
    case 'network-copyleft':
      return `${family(ids, /^AGPL-/).join(', ') || entry.license}: the source offer extends to network use. People who use this component over a network must be offered its corresponding source, not only people who receive a copy. ${where}`;
    case 'copyleft-weak': {
      const lgpl = family(ids, /^LGPL-/), file = family(ids, /^(MPL|EPL|CDDL|CPL)-/);
      const parts: any[] = [];
      if (lgpl.length || !file.length) parts.push(`${lgpl.join(', ') || 'LGPL components'}: the licence text and copyright notices ship with the app in this entry, the corresponding source of the library must be available, and the user must be able to replace the library with a modified version of it.`);
      if (file.length) parts.push(`${file.join(', ')}: file-level copyleft. The licence text ships with the app in this entry, and the source of the covered files, including any changes to them, must be available under the same licence.`);
      return `${parts.join(' ')} ${where}`;
    }
    case 'share-alike-data':
      return `${entry.license} is a share-alike licence for data or content. Attribution must be shown, and a database or work derived from it that is shared publicly must be offered under the same licence. ${where}`;
    case 'unknown-licence':
      return entry.license === UNKNOWN
        ? `No open-source licence could be identified from the package manifest, its licence files or its README. Nothing recorded here shows that use or redistribution is permitted. ${where}`
        : `The declared licence "${entry.license}" is not an identifier this inventory recognises, so nothing recorded here establishes what it permits or obliges. ${where}`;
    case 'non-open-source-terms':
      return `${entry.reason ? `${entry.reason.trim()} ` : ''}These are not open-source terms, so the open-source licence policy does not cover this item. The terms shipped in this entry are the package's own; whether this product's use fits them has not been assessed here. ${where}`;
    case 'licence-text-missing-from-package':
      return entry.textSource === 'spdx-canonical'
        ? 'The package ships no licence file. The canonical text of its declared licence is included instead; it carries no copyright line from the package beyond the author named in its manifest.'
        : entry.textSource === 'package-and-spdx-canonical'
          ? 'The package ships a licence file that names its licence without including the licence text. The package\'s file is included, followed by the canonical text of the declared licence.'
          : 'The package ships no licence file, and no canonical text for its licence is held in licenses/. The licence text itself is therefore not in this entry.';
    case 'permissive-not-previously-listed':
      return `${(entry.chosen ?? []).filter((id: any) => PERMISSIVE_NOT_PREVIOUSLY_LISTED.has(canonicalId(id))).join(', ') || entry.license} is a permissive licence recognised from the SPDX list that was not on this project's earlier accepted list. It asks that its licence text and copyright notices stay with copies, which this entry does.`;
    case 'unverified':
      return `${entry.reason ? `${entry.reason.trim()} ` : ''}The licence has not been verified from shipped metadata. This flag is a record of that, not a clearance.`;
    case 'proprietary-licence-held-outside-repo':
      return `${entry.reason ? `${entry.reason.trim()} ` : ''}This is a proprietary item, not open-source software, and it is not redistributable under this repository's MIT licence or any open-source licence. The licence document is not in this repository and has not been seen here: no licence name, number, date, scope or terms are recorded. The open-source licence policy does not cover it; the separately named check unresolved-font-licence reports it as resolved-by-owner-statement.`;
    case 'proprietary-no-licence-recorded':
      return `${entry.reason ? `${entry.reason.trim()} ` : ''}This is a proprietary item, not open-source software, and no licence to embed or redistribute it is recorded (licenses/font-licenses.json is where one is recorded). The open-source licence policy does not cover it; it is reported by the separately named check unresolved-font-licence.`;
    default:
      return '';
  }
}

/** `LICENCE FLAG <flag>: <package>@<version> (<spdx>)` lines for notice entries. */
export function licenceFlagLines(entries: any) {
  const lines: any[] = [];
  for (const entry of Array.isArray(entries) ? entries : [])
    for (const flag of Array.isArray(entry?.flags) ? entry.flags : [])
      lines.push(`LICENCE FLAG ${flag}: ${entry.name}@${String(entry.version).split('\n')[0]} (${entry.license})`);
  return lines;
}

/** Compact machine-readable flag list for release records. */
export function licenceFlagRecords(entries: any) {
  return (Array.isArray(entries) ? entries : []).filter((entry: any) => Array.isArray(entry?.flags) && entry.flags.length)
    .map((entry: any) => ({name: entry.name, version: String(entry.version).split('\n')[0], license: entry.license, flags: [...entry.flags]}));
}

/** Flagged entries grouped by flag, in FLAGS order. */
export function flagSummary(entries: any) {
  const groups: any[] = [];
  for (const flag of FLAGS) {
    const members = entries.filter((entry: any) => entry.flags?.includes(flag));
    if (members.length) groups.push({flag, entries: members});
  }
  return groups;
}
