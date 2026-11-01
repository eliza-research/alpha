// MVP-43 / A-21: the Denton typeface is proprietary, so the open-source licence policy (P-09) does not
// cover it. Owner statement, 2026-10-10: the licence is held, outside this repository. It is recorded in
// licenses/font-licenses.json with evidence "held-outside-repository" (no licence name, number, scope or
// terms: none were supplied), stays flagged proprietary-licence-held-outside-repo, and the separately
// named check unresolved-font-licence reports it resolved-by-owner-statement. A font with no record is
// still reported unresolved, by notice and by file hash. Whether an unresolved font withholds
// `distributable` is the single constant UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION; both settings are
// exercised here. None of this is evidence that the licence document was seen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ALLOWLIST, COMMERCIAL_FONT, FONT_LICENSES, HELD_OUTSIDE_REPOSITORY, NO_FONT_LICENCE, ROOT, UNVERIFIED, collectNotices, fontLicense, fontNames, sha256} from '../scripts/generate-licenses.mjs';
import {FONT_BLOCKER, FONT_BLOCKER_REFERENCE, FONT_FLAG, FONT_HELD_FLAG, RESOLVED_BY_OWNER_STATEMENT, fontLicenceCheck, fontLicenceFindings, fontLicenceLine, fontLicenseBlockers, readOwnerStatedFontHashes, readUnverifiedFontHashes} from '../scripts/font-license-blockers.mjs';
import {UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION, classifyLicence} from '../scripts/licence-policy.mjs';
import {releaseBlockers} from '../scripts/release-blockers.mjs';

const DENTON = 'apps/app/public/denton-300.woff2';
const dentonBytes = fs.readFileSync(path.join(ROOT, DENTON));
const dentonSha = sha256(dentonBytes);
const committedNotices = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/app/public/licenses/third-party-notices.json'), 'utf8'));
const committedRecord = JSON.parse(fs.readFileSync(path.join(ROOT, FONT_LICENSES), 'utf8')).entries;
const denton = committedNotices.find(entry => entry.name === 'Denton typeface');
const others = committedNotices.filter(entry => entry !== denton);
// The same face as notices would list it with no record at all, and as payloads built before P-09 listed it.
const unrecorded = {...denton, license: NO_FONT_LICENCE, flags: [FONT_FLAG], obligations: [{flag: FONT_FLAG, note: 'no licence recorded'}]};
const legacy = {name: denton.name, version: denton.version, license: UNVERIFIED, source: denton.source, text: denton.text};
const otherFont = Buffer.from('a different font file');
const RELEASE = {mode: 'release', distributable: true, testMocks: false, bundleAudit: 'passed', signed: true, runtime: 'PACKAGED', runtimeNotices: true,
  releaseAdmission: {failures: [], blockers: [], signerMatches: true}, voiceHost: {packaged: true, asr: true, differences: [], qualified: true}, licenceFlags: []};

function payload(t, {notices, files = {}}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-font-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'licenses'));
  if (notices) fs.writeFileSync(path.join(dir, 'licenses/third-party-notices.json'), JSON.stringify(notices));
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
    fs.writeFileSync(path.join(dir, name), bytes);
  }
  return dir;
}

test('the record states exactly what the owner said, and nothing else', () => {
  assert.deepEqual(committedRecord, [{name: 'Denton typeface', sha256: [dentonSha], license: COMMERCIAL_FONT, evidence: HELD_OUTSIDE_REPOSITORY,
    holder: 'Alpha Compute (owner statement, 2026-10-10)', basis: 'owner states the licence is held; the licence document is kept outside this repository', recordedOn: '2026-10-10'}]);
  // No licence name, number, licensor, licensee, scope, terms or document reference was supplied, so none is recorded.
  for (const field of ['licensor', 'licensee', 'scope', 'reference', 'licenceName', 'licenceNumber', 'terms', 'url']) assert.equal(field in committedRecord[0], false, field);
  assert.deepEqual(readOwnerStatedFontHashes(), [{name: 'Denton typeface', sha256: dentonSha, basis: committedRecord[0].basis}]);
  assert.deepEqual(readUnverifiedFontHashes(), [], 'Denton is no longer listed as an unrecorded font');
  assert.ok(fs.existsSync(path.join(ROOT, DENTON)), 'the font is not removed');
});

test('Denton stays listed and flagged proprietary; it is never presented as open source or as a seen licence', () => {
  assert.equal(denton.license, COMMERCIAL_FONT);
  assert.deepEqual(classifyLicence(denton.license).flags, []);
  assert.deepEqual(denton.flags, [FONT_HELD_FLAG]);
  assert.equal(FONT_HELD_FLAG, 'proprietary-licence-held-outside-repo');
  assert.ok(denton.source.includes(`denton-300.woff2 (sha256 ${dentonSha})`));
  assert.match(denton.text, /All rights reserved/i);
  assert.match(denton.text, /Proprietary typeface\. It is not open-source software and is not redistributable under an open-source licence\./);
  assert.match(denton.text, /Licence holder: Alpha Compute \(owner statement, 2026-10-10\)\. Basis: owner states the licence is held; the licence document is kept outside this repository\. Recorded 2026-10-10\./);
  assert.match(denton.text, /Evidence: held outside this repository\. The licence document is not in this repository and no reference to it is recorded here; no licence name, number, date, scope or terms are recorded\./);
  const note = denton.obligations[0].note;
  assert.match(note, /proprietary item, not open-source software, and it is not redistributable under this repository's MIT licence or any open-source licence/);
  assert.match(note, /has not been seen here/);
  assert.match(note, /resolved-by-owner-statement/);
  assert.doesNotMatch(denton.text + note, /licensed under|licence number|valid until/i);
  const text = fs.readFileSync(path.join(ROOT, 'apps/app/public/licenses/THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.match(text.split('='.repeat(78))[0], /proprietary-licence-held-outside-repo \(1\):\n  - Denton typeface@[^\n]+ \(LicenseRef-Commercial-Font\)/);
  // It is the only proprietary font, and nothing in the committed notices is an unrecorded font.
  assert.deepEqual(committedNotices.filter(entry => entry.flags.includes(FONT_HELD_FLAG)).map(entry => entry.name), ['Denton typeface']);
  assert.deepEqual(committedNotices.filter(entry => entry.flags.includes(FONT_FLAG)), []);
});

test('the shipped public directory reports Denton as resolved by owner statement, not as unresolved', () => {
  const check = fontLicenceCheck(path.join(ROOT, 'apps/app/public'));
  assert.equal(check.check, FONT_BLOCKER);
  assert.equal(check.status, RESOLVED_BY_OWNER_STATEMENT);
  assert.deepEqual([check.items, check.blockers], [[], []]);
  assert.deepEqual(check.resolved, ['unresolved-font-licence: resolved-by-owner-statement: Denton typeface (denton-300.woff2) is proprietary; the owner states the licence is held and its document is kept outside this repository (licenses/font-licenses.json, owner decision A-21)']);
  assert.deepEqual(fontLicenseBlockers(path.join(ROOT, 'apps/app/public')), []);
  const [doc, anchor] = FONT_BLOCKER_REFERENCE.split('#');
  const heading = fs.readFileSync(path.join(ROOT, doc), 'utf8').split('\n').find(line => line.startsWith('## ') && line.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-') === anchor);
  assert.ok(heading, `${doc} has the section the check points at`);
});

test('the check follows the packaged bytes: recorded bytes are resolved, any other proprietary font is unresolved', t => {
  const names = result => [result.unresolved.map(row => [row.name, row.files]), result.resolved.map(row => [row.name, row.files])];
  // Recorded bytes, with the committed notices.
  assert.deepEqual(names(fontLicenceFindings(payload(t, {notices: committedNotices, files: {'denton-300.woff2': dentonBytes}}))), [[], [['Denton typeface', ['denton-300.woff2']]]]);
  // Recorded bytes are recognised by hash wherever the file sits, with stale, legacy or missing notices.
  for (const notices of [others, null, [...others, legacy], [...others, unrecorded]])
    assert.deepEqual(names(fontLicenceFindings(payload(t, {notices, files: {'assets/renamed.woff2': dentonBytes, 'denton-300.woff2': dentonBytes}}))), [[], [['Denton typeface', ['assets/renamed.woff2', 'denton-300.woff2']]]]);
  // A different file under the recorded name is not covered by the owner's statement: the notice vouches only for the listed hash.
  const swapped = fontLicenceFindings(payload(t, {notices: committedNotices, files: {'denton-300.woff2': otherFont}}));
  assert.deepEqual(names(swapped), [[['Denton typeface', ['denton-300.woff2']]], []]);
  assert.match(swapped.unresolved[0].message, /^unresolved-font-licence: Denton typeface \(denton-300\.woff2\) has no recorded licence; record its licence in licenses\/font-licenses\.json or replace it \(owner decision A-21/);
  // A font the notices call unrecorded is unresolved, by its notice alone or with its bytes; so is a legacy marking.
  const stranger = {...unrecorded, name: 'Stranger typeface', source: `Files shipped in the web bundle:\nfonts/stranger.woff2 (sha256 ${sha256(otherFont)})`};
  for (const files of [{}, {'fonts/stranger.woff2': otherFont}])
    assert.deepEqual(names(fontLicenceFindings(payload(t, {notices: [...committedNotices, stranger], files: {'denton-300.woff2': dentonBytes, ...files}}))), [[['Stranger typeface', ['fonts/stranger.woff2']]], [['Denton typeface', ['denton-300.woff2']]]]);
  assert.deepEqual(names(fontLicenceFindings(payload(t, {notices: [...others, {...legacy, name: 'Stranger typeface'}]}), {ownerStatedFonts: []})), [[['Stranger typeface', ['denton-300.woff2']]], []]);
  // Without the owner's record the Denton bytes are an unrecorded font again, by notice or by a hash list.
  assert.deepEqual(names(fontLicenceFindings(payload(t, {notices: [...others, unrecorded], files: {'denton-300.woff2': dentonBytes}}), {ownerStatedFonts: []})), [[['Denton typeface', ['denton-300.woff2']]], []]);
  assert.deepEqual(names(fontLicenceFindings(payload(t, {notices: null, files: {'x/y.woff2': dentonBytes}}), {ownerStatedFonts: [], unverifiedFonts: [{name: 'Denton typeface', sha256: dentonSha}]})), [[['Denton typeface', ['x/y.woff2']]], []]);
  // No proprietary font at all: nothing to report. Other flagged items (models, runtimes, copyleft packages) are not font items.
  const clean = fontLicenceCheck(payload(t, {notices: others, files: {'fonts/other.woff2': otherFont}}));
  assert.deepEqual([clean.status, clean.items, clean.resolved], ['clear', [], []]);
  assert.ok(others.some(entry => entry.license === UNVERIFIED) && others.some(entry => entry.flags.includes('copyleft-strong')));
});

test('the one constant decides whether an unresolved font withholds distribution: both settings', t => {
  assert.equal(UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION, false, 'owner decision 2026-10-10: flag only; making the check strict again is a deliberate change of this constant');
  // What verify-apks computes for `distributable`, with the same inputs it uses.
  const distributable = check => check.blockers.length === 0;
  const recorded = payload(t, {notices: committedNotices, files: {'denton-300.woff2': dentonBytes}});
  const swapped = payload(t, {notices: committedNotices, files: {'denton-300.woff2': otherFont}});
  const message = fontLicenceFindings(swapped).unresolved[0].message;
  const resolvedMessage = fontLicenceFindings(recorded).resolved[0].message;

  // Denton as recorded: reported under both settings, blocking under neither.
  for (const blocksDistribution of [true, false]) {
    const check = fontLicenceCheck(recorded, {blocksDistribution});
    assert.deepEqual(check, {check: FONT_BLOCKER, status: RESOLVED_BY_OWNER_STATEMENT, blocksDistribution, items: [], resolved: [resolvedMessage], blockers: []});
    assert.equal(distributable(check), true);
    assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: check.blockers}, {fontLicenceBlocks: blocksDistribution}), []);
    assert.equal(fontLicenceLine(resolvedMessage, blocksDistribution), `LICENCE FLAG (reported, not blocking) ${resolvedMessage}`);
  }

  // An unrecorded font, strict (true): recorded, printed as a release blocker, withholds distributable, blocks every gate.
  const strict = fontLicenceCheck(swapped, {blocksDistribution: true});
  assert.deepEqual(strict, {check: FONT_BLOCKER, status: 'unresolved', blocksDistribution: true, items: [message], resolved: [], blockers: [message]});
  assert.equal(distributable(strict), false);
  assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: strict.blockers}, {fontLicenceBlocks: true}), [message]);
  assert.equal(fontLicenceLine(message, true), `RELEASE BLOCKER ${message}`);

  // An unrecorded font, flag only (false, the default): still run, recorded and printed; nothing withheld or blocked.
  const reporting = fontLicenceCheck(swapped, {blocksDistribution: false});
  assert.deepEqual(reporting, {check: FONT_BLOCKER, status: 'unresolved', blocksDistribution: false, items: [message], resolved: [], blockers: []});
  assert.equal(distributable(reporting), true);
  assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: reporting.blockers}, {fontLicenceBlocks: false}), []);
  assert.equal(fontLicenceLine(message, false), `LICENCE FLAG (reported, not blocking) ${message}`);
  // A row recorded while the check blocked is not a blocker once the constant is false, and the reverse holds.
  assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: [message]}, {fontLicenceBlocks: false}), []);
  assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: [message]}, {fontLicenceBlocks: true}), [message]);
  // Either way the check must have been run and recorded.
  for (const fontLicenceBlocks of [true, false]) assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: undefined}, {fontLicenceBlocks}), ['font licence check was not recorded']);
  // The defaults follow the constant.
  assert.equal(fontLicenceCheck(swapped).blocksDistribution, UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION);
  assert.deepEqual(releaseBlockers({...RELEASE, licenceBlockers: [message]}), UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION ? [message] : []);
});

test('the bundle audit prints licence flags and the font check as flag lines, never as a release blocker', t => {
  const files = {'index.html': '<!doctype html>', 'build-flags.json': JSON.stringify({testMocks: false})};
  const audit = dir => spawnSync(process.execPath, [path.join(ROOT, 'scripts/audit-production-bundle.mjs'), dir], {encoding: 'utf8'});
  const run = audit(payload(t, {notices: committedNotices, files: {...files, 'denton-300.woff2': dentonBytes}}));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^PASS /m);
  assert.match(run.stderr, /^LICENCE FLAG proprietary-licence-held-outside-repo: Denton typeface@[^\n]+ \(LicenseRef-Commercial-Font\)$/m);
  assert.match(run.stderr, /^LICENCE FLAG \(reported, not blocking\) unresolved-font-licence: resolved-by-owner-statement: Denton typeface \(denton-300\.woff2\) is proprietary; the owner states the licence is held/m);
  assert.match(run.stderr, /^LICENCE FLAG copyleft-strong: pdf\.js standard fonts: Liberation@/m);
  assert.match(run.stderr, /^LICENCE FLAG unverified: pdf\.js QuickJS sandbox@/m);
  assert.doesNotMatch(run.stderr, /RELEASE BLOCKER/);
  // An unrecorded font is printed too, and still does not fail a developer build.
  const swapped = audit(payload(t, {notices: committedNotices, files: {...files, 'denton-300.woff2': otherFont}}));
  assert.equal(swapped.status, 0, swapped.stderr);
  assert.match(swapped.stderr, new RegExp(`^${UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION ? 'RELEASE BLOCKER' : 'LICENCE FLAG \\(reported, not blocking\\)'} unresolved-font-licence: Denton typeface \\(denton-300\\.woff2\\) has no recorded licence`, 'm'));
});

test('verify-apks records licence flags and the font check, and only an unresolved font can withhold distributable', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/verify-apks.mjs'), 'utf8');
  // The font check is recorded in full; only its `blockers` (empty while the constant is false) reach `distributable`.
  assert.match(source, /fontCheck = fontLicenceCheck\(payload\.public\);/);
  assert.match(source, /const licenceBlockers = fontCheck\.blockers;/);
  assert.match(source, /fontLicenceCheck: \{ check: fontCheck\.check, status: fontCheck\.status, blocksDistribution: fontCheck\.blocksDistribution, items: fontCheck\.items, resolved: fontCheck\.resolved \},/);
  assert.match(source, /row\.runtimeNotices === true &&\n\s+row\.voiceHost\.packaged === true && row\.voiceHost\.qualified === true &&\n\s+row\.licenceBlockers\.length === 0;/);
  // Flags are recorded per APK and printed; they are not part of the distributable expression or of any failure.
  assert.match(source, /licenceFlags = licenceFlagRecords\(entries\);/);
  assert.match(source, /for \(const line of flagLines\) console\.warn\(line\);/);
  const distributable = /row\.distributable = ([\s\S]*?);\n/.exec(source)[1];
  assert.doesNotMatch(distributable, /licenceFlags|fontLicenceCheck/);
  assert.doesNotMatch(source, /problems\.push\([^)]*licence/i);
  assert.doesNotMatch(source, /failures\.push\([^)]*licence/i);
  assert.match(source, /console\.warn\(fontLicenceLine\(item, blocks\)\)/);
});

function scratchRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-font-licenses-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of ['node_modules', 'vendor', 'android']) fs.symlinkSync(path.join(ROOT, name), path.join(dir, name));
  fs.mkdirSync(path.join(dir, 'apps/app'), {recursive: true});
  fs.symlinkSync(path.join(ROOT, 'apps/app/public'), path.join(dir, 'apps/app/public'));
  for (const name of ['package.json', 'package-lock.json', 'upstream.lock.json']) fs.copyFileSync(path.join(ROOT, name), path.join(dir, name));
  for (const name of ['licenses', 'config']) fs.cpSync(path.join(ROOT, name), path.join(dir, name), {recursive: true});
  // Match the declared Android dependency inputs while keeping derived native staging inside this fixture.
  fs.cpSync(path.join(ROOT, 'patches/eliza'), path.join(dir, 'patches/eliza'), {recursive: true});
  // The reviewed ASR model pins are listed in the notices, so their recorded reasons are not stale.
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts/host-speech-assets.json'), path.join(dir, 'scripts/host-speech-assets.json'));
  return dir;
}

test('font licence records are data only, bound to the exact font bytes, in both record states', t => {
  const dir = scratchRoot(t);
  const allowlist = JSON.parse(fs.readFileSync(path.join(dir, ALLOWLIST), 'utf8'));
  const write = (entries, extraReasons = []) => {
    fs.writeFileSync(path.join(dir, FONT_LICENSES), JSON.stringify({entries}));
    fs.writeFileSync(path.join(dir, ALLOWLIST), JSON.stringify({...allowlist, entries: [...allowlist.entries, ...extraReasons]}));
  };
  const entryOf = result => result.entries.find(item => item.name === 'Denton typeface');
  const stated = committedRecord[0];

  // Owner statement: generation is clean, the entry is the committed one.
  write([stated]);
  let result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual([result.errors, result.warnings], [[], []]);
  assert.deepEqual(entryOf(result), denton);
  // A reference to the licence document, when the owner supplies one, is printed; the entry stays proprietary and flagged.
  write([{...stated, reference: 'licence register entry EXAMPLE-REF'}]);
  result = collectNotices(dir, {packagedRuntime: false});
  assert.match(entryOf(result).text, /Reference to the licence document: licence register entry EXAMPLE-REF\./);
  assert.doesNotMatch(entryOf(result).text, /no reference to it is recorded/);
  assert.deepEqual(entryOf(result).flags, [FONT_HELD_FLAG]);
  // An owner-statement record with a missing fact is refused, never filled in.
  for (const field of ['holder', 'basis', 'recordedOn']) {
    write([{...stated, [field]: ''}]);
    assert.ok(collectNotices(dir, {packagedRuntime: false}).errors.some(error => error.includes(`is missing ${field}`)), field);
  }

  // No record, or a record for other bytes: the face is an unrecorded proprietary font again, flagged, not an error of licence category.
  write([]);
  result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual([result.errors, entryOf(result).license, entryOf(result).flags], [[], NO_FONT_LICENCE, [FONT_FLAG]]);
  assert.match(entryOf(result).obligations[0].note, /no licence to embed or redistribute it is recorded/);
  write([{...stated, sha256: ['0'.repeat(64)]}]);
  result = collectNotices(dir, {packagedRuntime: false});
  assert.ok(result.errors.some(error => error.includes(`${FONT_LICENSES}: stale entry Denton typeface`)));
  assert.deepEqual(entryOf(result).flags, [FONT_FLAG], 'a record for other bytes does not cover the face');
  // A reason recorded for an unrecorded font is printed with it; one left behind for a recorded font is reported as stale.
  const reason = {name: 'Denton typeface', sha256: dentonSha, reason: 'Example reason text for an unrecorded font file.'};
  write([], [reason]);
  assert.match(entryOf(collectNotices(dir, {packagedRuntime: false})).obligations[0].note, /^Example reason text for an unrecorded font file\./);
  write([stated], [reason]);
  assert.ok(collectNotices(dir, {packagedRuntime: false}).warnings.some(warning => warning.includes('stale entry Denton typeface')));

  // Full record (licensor, licensee, scope, evidence): the entry is unflagged.
  const full = {name: 'Denton typeface', sha256: [dentonSha], license: COMMERCIAL_FONT, licensor: 'Example Foundry', licensee: 'Example Licensee',
    scope: 'app embedding and web embedding', evidence: 'licence reference EXAMPLE-1', recordedOn: '2026-10-10'};
  write([full]);
  result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual(result.errors, []);
  assert.equal(entryOf(result).license, COMMERCIAL_FONT);
  assert.match(entryOf(result).text, /Used under a commercial licence from Example Foundry to Example Licensee\. Scope: app embedding and web embedding\. Evidence: licence reference EXAMPLE-1/);
  assert.deepEqual([entryOf(result).flags, entryOf(result).obligations], [[], undefined]);
  write([{...full, evidence: ''}]);
  assert.ok(collectNotices(dir, {packagedRuntime: false}).errors.some(error => error.includes('is missing evidence')));
  write([{...full, scope: 'app embedding'}]);
  assert.ok(collectNotices(dir, {packagedRuntime: false}).errors.some(error => error.includes('scope must cover app and web embedding')));
  for (const record of [full, stated]) {
    write([{...record, license: 'MIT'}]);
    assert.ok(collectNotices(dir, {packagedRuntime: false}).errors.some(error => error.includes(`must use license ${COMMERCIAL_FONT}`)), 'a proprietary font is never recorded under an open-source identifier');
  }
});

test('choice (b): Denton is loaded by one rule, and upright Fraunces is not bundled yet', () => {
  const sources = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), {withFileTypes: true})) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'fixtures') walk(rel); } else if (/\.(css|html|tsx?|jsx?|mjs)$/.test(entry.name)) sources.push(rel);
    }
  };
  walk('apps/app/src');
  sources.push('apps/app/index.html', 'config/alpha-product.json');
  const text = Object.fromEntries(sources.map(file => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]));
  const referencing = sources.filter(file => /denton/i.test(text[file])).sort();
  assert.deepEqual(referencing, ['apps/app/src/prototype/phone.css', 'apps/app/src/prototype/prototype.css', 'apps/app/src/prototype/scan-dialog.css', 'apps/app/src/prototype/template.html', 'config/alpha-product.json'], 'update docs/dependency-audit.md when Denton is referenced elsewhere');
  const css = text['apps/app/src/prototype/prototype.css'];
  // The only rule that loads the file; removing it (and the file) drops every stack to its next family.
  assert.deepEqual(css.match(/@font-face\{[^}]*Denton[^}]*\}/g), ["@font-face{font-family:'Denton';src:url(/denton-300.woff2) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}"]);
  assert.equal(Object.values(text).join('\n').match(/denton-300\.woff2/g).length, 1, 'no preload or second URL for the file');
  // Every stack that names Denton continues to an open or system face.
  const stacks = Object.values(text).join('\n').match(/font-family:[^;}"]*Denton[^;}"]*/g).map(stack => stack.replace(/['\s]/g, '')).filter(stack => stack !== 'font-family:Denton');
  const shapes = {};
  for (const stack of stacks) shapes[stack] = (shapes[stack] ?? 0) + 1;
  assert.deepEqual(Object.keys(shapes).sort(), ['font-family:Denton,Fraunces,Georgia,serif', 'font-family:Denton,Georgia,serif']);
  assert.equal(shapes['font-family:Denton,Georgia,serif'], 1, 'one sample card skips Fraunces and falls back to Georgia');

  // Fraunces is bundled and OFL-licensed, but only as italics. The upright .serif text would
  // render in Fraunces Italic if Denton were simply removed; the patch must add an upright face.
  const fraunces = [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'Fraunces'[^}]*\}/g)].map(match => ({
    style: /font-style:\s*(\w+)/.exec(match[0])[1], weight: /font-weight:\s*(\d+)/.exec(match[0])[1], file: /url\(\/([^)]+)\)/.exec(match[0])[1],
  }));
  assert.deepEqual(fraunces.map(face => `${face.style} ${face.weight}`), ['italic 300', 'italic 400']);
  for (const face of fraunces) {
    const names = fontNames(fs.readFileSync(path.join(ROOT, 'apps/app/public', face.file)));
    assert.equal(names.family, 'Fraunces');
    assert.match(names.fullName, /Italic/);
    assert.equal(fontLicense(names), 'OFL-1.1');
  }
  assert.match(css, /\.serif\{font-family:'Denton','Fraunces',Georgia,serif;font-weight:300;/);
  assert.equal(committedNotices.find(entry => entry.name === 'Fraunces typeface').license, 'OFL-1.1');
  // An OFL upright face is already installed for the patch (declared devDependency).
  const upright = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource/fraunces/files/fraunces-latin-300-normal.woff2'));
  assert.equal(fontLicense(fontNames(upright)), 'OFL-1.1');
});
