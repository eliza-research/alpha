import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  ROOT, JSON_OUTPUT, TEXT_OUTPUT, ALLOWLIST, NO_FONT_LICENCE, UNKNOWN, UNVERIFIED, generate, collectNotices, detectLicenceFromText, loadTemplates, packageNotice,
} from '../scripts/generate-licenses.mjs';
import {FLAGS, classifyLicence, licenceFlagLines, licenceFlagRecords, obligationNote} from '../scripts/licence-policy.mjs';
import {releaseBlockers} from '../scripts/release-blockers.mjs';

const fresh = generate(ROOT, {packagedRuntime: false});
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

// Policy P-09: a licence never fails generation. Copyleft, unknown, unverified and text-less
// entries are flagged; only broken input is an error. These checks are source evidence, not legal review.
test('notice generation is complete: no broken input, and every entry has a licence, a source, a text and flags', () => {
  assert.deepEqual(fresh.errors, []);
  assert.deepEqual(fresh.warnings, []);
  for (const entry of fresh.entries) {
    for (const field of ['name', 'version', 'license', 'source', 'text']) assert.ok(typeof entry[field] === 'string' && entry[field].trim(), `${entry.name}: ${field}`);
    assert.ok(Array.isArray(entry.flags), entry.name);
    for (const flag of entry.flags) assert.ok(FLAGS.includes(flag), `${entry.name}: ${flag}`);
    // A flagged entry says what each flag obliges; an unflagged one carries no obligations.
    assert.deepEqual((entry.obligations ?? []).map(item => item.flag), entry.flags, entry.name);
    for (const item of entry.obligations ?? []) assert.ok(item.note.length > 40, `${entry.name}: ${item.flag}`);
    assert.deepEqual(entry.flags, classifyLicence(entry.license).flags.concat(entry.flags.filter(flag => !classifyLicence(entry.license).flags.includes(flag))).sort((a, b) => FLAGS.indexOf(a) - FLAGS.indexOf(b)), `${entry.name}: flags cover its licence`);
  }
});

test('the committed notices flag what the product ships today, in the JSON and at the top of the text', () => {
  const flagged = Object.fromEntries(fresh.entries.filter(entry => entry.flags.length).map(entry => [entry.name, entry.flags]));
  assert.deepEqual(flagged['pdf.js standard fonts: Liberation'], ['copyleft-strong']);
  assert.deepEqual(flagged.mediabunny, ['copyleft-weak']);
  assert.deepEqual(flagged['OpenStreetMap data'], ['share-alike-data']);
  assert.deepEqual(flagged['pdf.js QuickJS sandbox'], ['licence-text-missing-from-package', 'unverified']);
  assert.deepEqual(flagged['Denton typeface'], ['proprietary-licence-held-outside-repo']);
  // Packages that ship no licence file carry the canonical text of their declared licence.
  const tr46 = fresh.entries.find(entry => entry.name === 'tr46');
  assert.deepEqual([tr46.license, tr46.textSource, tr46.flags], ['MIT', 'spdx-canonical', ['licence-text-missing-from-package']]);
  assert.match(tr46.text, /ships no license file[\s\S]*Permission is hereby granted, free of charge/);
  assert.equal(fresh.entries.filter(entry => entry.textSource).every(entry => entry.textSource === 'spdx-canonical' && entry.flags.includes('licence-text-missing-from-package')), true);
  assert.equal(fresh.entries.find(entry => entry.name === 'react').textSource, undefined);
  // Text: a summary before the first entry lists every flagged package under each of its flags.
  const [header] = fresh.text.split('='.repeat(78));
  assert.match(header, new RegExp(`Entries: ${fresh.entries.length}\\. Flagged entries: ${Object.keys(flagged).length}\\.`));
  assert.match(header, /not legal review/);
  for (const entry of fresh.entries) for (const flag of entry.flags) {
    const section = header.slice(header.indexOf(`\n${flag} (`));
    assert.ok(section.split(/\n(?=\S)/)[0].includes(`  - ${entry.name}@${entry.version.split('\n')[0]} (${entry.license})`) || section.includes(`  - ${entry.name}@`), `${flag}: ${entry.name}`);
  }
  assert.match(fresh.text, /\nmediabunny\nVersion: [^\n]+\nLicense: MPL-2\.0\nSource: [^\n]+\nFlags: copyleft-weak\nObligation \(copyleft-weak\): MPL-2\.0: file-level copyleft\./);
  assert.match(fresh.text, /License text: canonical SPDX text \(the package ships no licence file\)\nFlags: licence-text-missing-from-package\n/);
  // Build output: one line per flag and entry.
  assert.deepEqual(fresh.flagLines, licenceFlagLines(fresh.entries));
  assert.ok(fresh.flagLines.includes('LICENCE FLAG copyleft-weak: mediabunny@' + fresh.entries.find(entry => entry.name === 'mediabunny').version + ' (MPL-2.0)'));
  assert.ok(fresh.flagLines.every(line => /^LICENCE FLAG [a-z-]+: .+@.+ \(.+\)$/.test(line)));
});

test('the generator exits 0 with flagged entries and prints them as LICENCE FLAG warnings', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/generate-licenses.mjs'), '--check'], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /^LICENCE FLAG copyleft-strong: pdf\.js standard fonts: Liberation@bundled with pdfjs-dist [^ ]+ \(GPL-2\.0-only WITH Font-exception-2\.0\)$/m);
  assert.match(run.stderr, /^LICENCE FLAG proprietary-licence-held-outside-repo: Denton typeface@[^\n]+ \(LicenseRef-Commercial-Font\)$/m);
  assert.match(run.stderr, /^Licence flags: \d+ of \d+ entries flagged .*not a failure and not legal review\.$/m);
  assert.match(run.stdout, /Third-party notices are complete and current/);
});

test('licence expressions are classified: copyleft, network copyleft, alternatives and unknown identifiers', () => {
  const flags = expression => classifyLicence(expression).flags;
  for (const permissive of ['MIT', 'Apache-2.0', '(MIT OR Apache-2.0)', 'BSD-3-Clause AND Apache-2.0', 'MIT AND ISC AND BSD-2-Clause AND SunPro', 'OFL-1.1', '0BSD']) assert.deepEqual(flags(permissive), [], permissive);
  // Permissive, but never on this project's earlier accepted list: visible, not silent.
  for (const unlisted of ['BlueOak-1.0.0', 'Unlicense', 'CC0-1.0', 'MIT AND Python-2.0']) assert.deepEqual(flags(unlisted), ['permissive-not-previously-listed'], unlisted);
  assert.deepEqual(flags('(BlueOak-1.0.0 OR MIT)'), []);
  assert.deepEqual(flags('GPL-3.0-or-later'), ['copyleft-strong']);
  assert.deepEqual(flags('GPL-2.0-only WITH Font-exception-2.0'), ['copyleft-strong']);
  assert.deepEqual(flags('AGPL-3.0-or-later'), ['copyleft-strong', 'network-copyleft']);
  for (const weak of ['LGPL-3.0-only', 'LGPL-2.1+', 'MPL-2.0', 'EPL-2.0', 'MIT AND LGPL-3.0-only']) assert.deepEqual(flags(weak), ['copyleft-weak'], weak);
  assert.deepEqual(flags('ODbL-1.0'), ['share-alike-data']);
  // With alternatives the least encumbered one is relied on; an AND keeps every flag.
  assert.deepEqual(flags('(MIT OR GPL-3.0-only)'), []);
  assert.deepEqual(flags('(LGPL-3.0-only OR AGPL-3.0-only)'), ['copyleft-weak']);
  assert.deepEqual(flags('GPL-2.0-only AND MPL-2.0'), ['copyleft-strong', 'copyleft-weak']);
  // Anything not recognised is unknown, never silently permissive: source-available and custom terms included.
  for (const unknown of ['SSPL-1.0', 'SEE LICENSE IN LICENSE.md', 'UNLICENSED', 'Custom', '', undefined, UNKNOWN, 'MIT AND Proprietary', '(MIT']) assert.deepEqual(flags(unknown), ['unknown-licence'], String(unknown));
  assert.deepEqual(flags('MIT OR Proprietary'), []);
  assert.deepEqual(flags(UNVERIFIED), ['unverified']);
  assert.deepEqual(flags(NO_FONT_LICENCE), ['proprietary-no-licence-recorded']);
  // Obligations are stated in plain words and say where the source is.
  const source = 'https://www.npmjs.com/package/x/v/1.0.0';
  const note = (flag, license, extra = {}) => obligationNote(flag, {license, source, chosen: classifyLicence(license).chosen, ...extra});
  assert.match(note('copyleft-strong', 'GPL-3.0-or-later'), /GPL-3\.0-or-later is a strong copyleft licence\. Its licence text and the copyright notices ship with the app.*complete corresponding source.*exact version\. Corresponding source: https:\/\/www\.npmjs\.com\/package\/x\/v\/1\.0\.0\./);
  assert.match(note('network-copyleft', 'AGPL-3.0-or-later'), /source offer extends to network use/);
  assert.match(note('copyleft-weak', 'LGPL-3.0-only', {repository: 'https://github.com/x/x'}), /LGPL-3\.0-only: .*the user must be able to replace the library.*Corresponding source: .*\(repository: https:\/\/github\.com\/x\/x\)\./);
  assert.match(note('copyleft-strong', 'GPL-2.0-only WITH Font-exception-2.0'), /declared with the exception Font-exception-2\.0/);
  assert.match(note('unknown-licence', UNKNOWN), /No open-source licence could be identified/);
  assert.match(note('unknown-licence', 'SSPL-1.0'), /"SSPL-1\.0" is not an identifier this inventory recognises/);
  for (const flag of FLAGS) assert.ok(note(flag, 'MIT').length > 40, flag);
});

test('a package without a licence file gets the canonical text and a flag; an undeclared licence is identified or UNKNOWN', t => {
  const templates = loadTemplates(ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-package-notice-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bsd = packageNotice({declared: 'BSD-3-Clause', manifest: {author: {name: 'Example Author'}, repository: {url: 'git+https://github.com/example/shim.git'}}, templates});
  assert.deepEqual([bsd.license, bsd.textSource, bsd._flags, bsd.repository], ['BSD-3-Clause', 'spdx-canonical', ['licence-text-missing-from-package'], 'https://github.com/example/shim']);
  assert.match(bsd.text, /ships no license file\. Its package\.json declares the BSD-3-Clause License; author: Example Author\.[\s\S]*Neither the name of the copyright holder/);
  for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'Unlicense', 'GPL-3.0-or-later', 'LGPL-3.0-only', 'AGPL-3.0-or-later'])
    assert.equal(detectLicenceFromText(templates.canonical(id)), id.replace(/-(only|or-later)$/, ''), `canonical ${id} text is held and recognised`);
  assert.match(templates.canonical('(MIT AND Zlib)') + templates.canonical('MIT AND ISC'), /^MIT:\n\nMIT License[\s\S]*ISC:\n\nISC License/, 'every identifier of an expression, or nothing');
  // A licence with no canonical text held: still an entry, flagged, with no invented text.
  const odd = packageNotice({declared: 'Artistic-2.0', manifest: {}, templates});
  assert.deepEqual([odd.license, odd.textSource, odd._flags], ['Artistic-2.0', undefined, ['licence-text-missing-from-package']]);
  assert.match(odd.text, /No canonical text for that licence is held/);
  // Copyleft with its own licence file: the package's text, no text flag (the copyleft flag comes from classification).
  const gplText = templates.canonical('GPL-3.0-or-later');
  const gpl = packageNotice({declared: 'GPL-3.0-or-later', text: gplText, manifest: {}, templates});
  assert.deepEqual([gpl.license, gpl.text, gpl.textSource, gpl._flags], ['GPL-3.0-or-later', gplText, undefined, []]);
  // Copyleft whose licence file only names the licence: the canonical text is added, so the text itself ships.
  const named = packageNotice({declared: 'LGPL-3.0-only', text: 'Licensed under the LGPLv3. See the website for the text.', manifest: {}, templates});
  assert.deepEqual([named.textSource, named._flags], ['package-and-spdx-canonical', ['licence-text-missing-from-package']]);
  assert.match(named.text, /^Licensed under the LGPLv3\.[\s\S]*GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3[\s\S]*GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  // Undeclared: the package's own licence file names it, then its README, else UNKNOWN.
  const mit = packageNotice({declared: null, text: templates.mit, manifest: {}, templates});
  assert.deepEqual([mit.license, mit._flags], ['MIT', ['unverified']]);
  assert.match(mit._reason, /manifest declares no licence\. MIT was identified from the text of the package's own licence file/);
  const see = packageNotice({declared: 'SEE LICENSE IN ./LICENSE', text: 'Custom terms: ask us first.', manifest: {}, templates});
  assert.deepEqual([see.license, see._flags, classifyLicence(see.license).flags], ['SEE LICENSE IN ./LICENSE', [], ['unknown-licence']]);
  const closed = packageNotice({declared: 'UNLICENSED', text: 'Copyright Example. All rights reserved.', manifest: {}, templates});
  assert.deepEqual([closed.license, closed._flags, classifyLicence(closed.license).flags], ['UNLICENSED', ['non-open-source-terms'], ['unknown-licence']]);
  fs.writeFileSync(path.join(dir, 'README.md'), '# thing\n\n## License\n\nISC\n');
  const readme = packageNotice({declared: '', dir, manifest: {}, templates});
  assert.deepEqual([readme.license, readme.textSource, readme._flags], ['ISC', 'spdx-canonical', ['unverified', 'licence-text-missing-from-package']]);
  assert.match(readme._reason, /ISC is the licence named in the package's README/);
  fs.writeFileSync(path.join(dir, 'README.md'), '# thing\n\nNo licence section here. MIT is mentioned only in passing.\n');
  const unknown = packageNotice({declared: '', dir, manifest: {}, templates});
  assert.deepEqual([unknown.license, unknown.textSource, unknown._flags], [UNKNOWN, undefined, ['licence-text-missing-from-package']]);
  assert.match(unknown.text, /no licence could be established/);
});

test('checked-in notices are byte-identical to a fresh generation', () => {
  const shipped = generate(ROOT);
  assert.deepEqual(shipped.errors, []);
  assert.equal(fs.readFileSync(path.join(ROOT, JSON_OUTPUT), 'utf8'), shipped.json, `${JSON_OUTPUT} is stale; run node scripts/generate-licenses.mjs`);
  assert.equal(fs.readFileSync(path.join(ROOT, TEXT_OUTPUT), 'utf8'), shipped.text, `${TEXT_OUTPUT} is stale; run node scripts/generate-licenses.mjs`);
});

test('generation fails when the shipped OCR cores or their pinned license copies change', t => {
  const dir = scratchRoot(t);
  const file = path.join(dir, 'licenses/tesseract-core/sources.json');
  const pinned = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.appendFileSync(path.join(dir, 'licenses/tesseract-core/leptonica-license.txt'), '\nmodified');
  assert.ok(collectNotices(dir, {packagedRuntime: false}).errors.some(error => error.includes('leptonica-license.txt does not match')));
  fs.writeFileSync(file, JSON.stringify({...pinned, version: '0.0.0', cores: {...pinned.cores, 'tesseract-core-lstm.wasm.js': '0'.repeat(64)}}));
  const errors = collectNotices(dir, {packagedRuntime: false}).errors;
  assert.ok(errors.some(error => error.includes('differs from licenses/tesseract-core/sources.json (0.0.0)')));
  assert.ok(errors.some(error => error.includes('tesseract-core-lstm.wasm.js differs from the core pinned')));
});

test('an item with no recorded reason is still listed and flagged; reason files gate nothing', t => {
  const dir = scratchRoot(t);
  const file = path.join(dir, ALLOWLIST);
  const allowlist = JSON.parse(fs.readFileSync(file, 'utf8'));
  const quickjs = result => result.entries.find(entry => entry.name === 'pdf.js QuickJS sandbox');
  fs.writeFileSync(file, JSON.stringify({...allowlist, entries: allowlist.entries.filter(entry => entry.name !== 'pdf.js QuickJS sandbox')}));
  let result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some(warning => warning.startsWith('pdf.js QuickJS sandbox') && warning.includes('no reason recorded')));
  assert.deepEqual([quickjs(result).license, quickjs(result).flags.includes('unverified')], [UNVERIFIED, true]);
  const unverified = item => item.obligations.find(obligation => obligation.flag === 'unverified').note;
  assert.match(unverified(quickjs(fresh)), /^pdfjs-dist ships quickjs-eval\.js\/\.wasm without a license file/);
  assert.doesNotMatch(unverified(quickjs(result)), /quickjs-eval/);
  fs.writeFileSync(file, JSON.stringify({...allowlist, entries: [...allowlist.entries, {name: 'Removed font', reason: 'no longer shipped anywhere in the product'}]}));
  result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some(warning => warning.includes('stale entry Removed font')));
  // A bundled font with no licence record is listed as proprietary with no licence recorded, flagged, and not an error.
  fs.writeFileSync(path.join(dir, 'licenses/font-licenses.json'), JSON.stringify({entries: []}));
  result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual(result.errors, []);
  const denton = result.entries.find(entry => entry.name === 'Denton typeface');
  assert.deepEqual([denton.license, denton.flags], [NO_FONT_LICENCE, ['proprietary-no-licence-recorded']]);
  assert.match(denton.text, /The font file states: ".*All rights reserved.*"\. It names no license/i);
  assert.match(denton.obligations[0].note, /proprietary item, not open-source software, and no licence to embed or redistribute it is recorded/);
});

test('a production dependency with a copyleft or unknown licence is listed and flagged, never an error', t => {
  const dir = scratchRoot(t);
  const before = collectNotices(dir, {packagedRuntime: false}).entries.length;
  const altered = structuredClone(lock);
  altered.packages['node_modules/react'].license = 'SSPL-1.0';
  altered.packages['node_modules/react-dom'].license = 'AGPL-3.0-or-later';
  altered.packages['node_modules/scheduler'].license = 'LGPL-3.0-only';
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(altered));
  const result = collectNotices(dir, {packagedRuntime: false});
  assert.deepEqual(result.errors, []);
  assert.equal(result.entries.length, before, 'no entry is dropped');
  const entry = name => result.entries.find(item => item.name === name);
  assert.deepEqual([entry('react').license, entry('react').flags], ['SSPL-1.0', ['unknown-licence']]);
  assert.match(entry('react').text, /MIT License/, 'the package\'s own licence file still ships');
  // The installed file is MIT text, so the text of the newly declared licence is added from licenses/.
  assert.deepEqual([entry('react-dom').flags, entry('react-dom').textSource], [['copyleft-strong', 'network-copyleft', 'licence-text-missing-from-package'], 'package-and-spdx-canonical']);
  assert.match(entry('react-dom').text, /MIT License[\s\S]*GNU AFFERO GENERAL PUBLIC LICENSE/);
  const repository = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/react-dom/package.json'), 'utf8')).repository.url.replace(/\.git$/, '');
  assert.ok(entry('react-dom').obligations[0].note.includes(`Corresponding source: ${entry('react-dom').source} (repository: ${repository}).`), entry('react-dom').obligations[0].note);
  assert.match(entry('react-dom').source, /react-dom-\d+\.\d+\.\d+\.tgz$/, 'the source is the package at its exact version');
  assert.match(entry('react-dom').obligations[1].note, /network use/);
  assert.deepEqual(entry('scheduler').flags, ['copyleft-weak', 'licence-text-missing-from-package']);
  assert.match(entry('scheduler').obligations[0].note, /replace the library/);
  // None of it reaches a release gate: flags in a release row are a record only.
  const row = {mode: 'release', distributable: true, testMocks: false, bundleAudit: 'passed', signed: true, runtime: 'PACKAGED', runtimeNotices: true,
    releaseAdmission: {failures: [], blockers: [], signerMatches: true}, voiceHost: {packaged: true, asr: true, differences: [], qualified: true},
    licenceFlags: licenceFlagRecords(result.entries), licenceBlockers: []};
  assert.ok(row.licenceFlags.some(item => item.name === 'react-dom' && item.flags.includes('copyleft-strong')));
  assert.deepEqual(releaseBlockers(row), []);
  // Even a licence line written into the blocker field is not a blocker: only the named font check is read from it.
  assert.deepEqual(releaseBlockers({...row, licenceBlockers: licenceFlagLines(result.entries)}), []);
});

test('broken input still fails: a corrupted or missing package manifest is an error, not a flag', t => {
  const dir = scratchRoot(t, {ownNodeModules: true});
  const altered = structuredClone(lock);
  altered.packages['node_modules/broken-manifest'] = {version: '1.0.0', license: 'MIT'};
  altered.packages['node_modules/not-installed'] = {version: '2.0.0', license: 'MIT'};
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(altered));
  fs.mkdirSync(path.join(dir, 'node_modules/broken-manifest'));
  fs.writeFileSync(path.join(dir, 'node_modules/broken-manifest/package.json'), '{"name": "broken-manifest", "version": ');
  fs.writeFileSync(path.join(dir, 'node_modules/broken-manifest/index.js'), 'module.exports = 1;');
  const result = collectNotices(dir, {packagedRuntime: false});
  assert.ok(result.errors.some(error => /^broken-manifest@1\.0\.0: unreadable or corrupted package\.json/.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some(error => error === 'not-installed@2.0.0: not installed at node_modules/not-installed; run npm ci'));
  assert.equal(result.errors.length, 2);
});

test('the notices carry no entries for the removed speech runtimes or models', () => {
  // Spelled in pieces so the repository-wide search (test/llama-cpp-only.test.mjs) stays clean.
  const banned = new RegExp(['on' + 'nx', 'sher' + 'pa', 'k2' + 'fsa', 'pi' + 'per-voices'].join('|'), 'i');
  assert.deepEqual(fresh.entries.filter(entry => banned.test(`${entry.name}\n${entry.version}\n${entry.source}`)).map(entry => entry.name), []);
});
test('Paradee notices preserve the eSpeak license and exclude the retired speech runtime', () => {
  const {entries} = fresh;
  const espeak = entries.find(row => row.name.startsWith('eSpeak NG'));
  assert.equal(espeak.license, 'GPL-3.0-or-later');
  assert.match(espeak.text, /GNU GENERAL PUBLIC LICENSE/);
  assert.equal(entries.some(row => /^Sherpa-O/.test(row.name)), false);
});

function scratchRoot(t, {ownNodeModules = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-licenses-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of ['vendor', 'android']) fs.symlinkSync(path.join(ROOT, name), path.join(dir, name));
  if (ownNodeModules) {
    // A writable node_modules whose entries point at the installed packages, so a test can add one.
    const installed = fs.realpathSync(path.join(ROOT, 'node_modules'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    for (const name of fs.readdirSync(installed)) fs.symlinkSync(path.join(installed, name), path.join(dir, 'node_modules', name));
  } else fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'apps/app'), {recursive: true});
  fs.symlinkSync(path.join(ROOT, 'apps/app/public'), path.join(dir, 'apps/app/public'));
  for (const name of ['package.json', 'package-lock.json', 'upstream.lock.json']) fs.copyFileSync(path.join(ROOT, name), path.join(dir, name));
  fs.cpSync(path.join(ROOT, 'licenses'), path.join(dir, 'licenses'), {recursive: true});
  // The classpath fingerprint binds the actual patched auth descriptor; stage it privately from the same authored inputs.
  fs.cpSync(path.join(ROOT, 'patches/eliza'), path.join(dir, 'patches/eliza'), {recursive: true});
  return dir;
}
