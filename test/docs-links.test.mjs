// Every product script path and npm script named in README.md and docs/ must exist.
// Paths that are relative to the pinned upstream checkout (for example
// `packages/os/browser/scripts/...` written as `scripts/...` beside a vendor path)
// are accepted only when that file really exists under vendor/eliza and the same
// document names the upstream directory that holds it, so a deleted product script
// cannot pass merely because some upstream package has a file at the same suffix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
// docs/market-research holds research and proposals that name tools which do not
// exist yet; it is not an operating instruction and is excluded from these checks.
const excluded = /^docs\/market-research\//;
function markdown(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return markdown(relative);
    return entry.name.endsWith('.md') ? [relative] : [];
  });
}
const docs = ['README.md', ...markdown('docs')].filter(file => !excluded.test(file)).sort();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

let vendorFiles;
function listVendorFiles() {
  if (vendorFiles === undefined) {
    const listed = spawnSync('git', ['-C', path.join(root, 'vendor/eliza'), 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    vendorFiles = listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : [];
  }
  return vendorFiles;
}

/** True when `reference` names a file or directory below an upstream package directory that `text` also names. */
export function vendorRelativeInContext(reference, text, files) {
  const target = reference.replace(/\/$/, '');
  return files.some(file => {
    const segments = file.split('/');
    return segments.some((_, index) => {
      const rest = segments.slice(index).join('/');
      if (rest !== target && !rest.startsWith(`${target}/`)) return false;
      // A bare `scripts/...` that matches only the upstream root is too ambiguous to accept:
      // a deleted product script would pass whenever the document mentions vendor/eliza.
      const prefix = segments.slice(0, index).join('/');
      return prefix !== '' && text.includes(`${prefix}/`);
    });
  });
}

export function scriptReferences(text) {
  // A preceding word, dot, slash or hyphen means a longer path such as packages/app/scripts/...
  return [...text.matchAll(/(?<![\w./-])((?:\.\.\/)*scripts\/[A-Za-z0-9_./-]*[A-Za-z0-9_/])/g)]
    .map(match => ({ reference: match[1].replace(/^(?:\.\.\/)+/, ''), index: match.index }));
}

export function npmScriptReferences(text) {
  return [...text.matchAll(/\bnpm run ([A-Za-z0-9][A-Za-z0-9:_.-]*[A-Za-z0-9_])/g)].map(match => ({ name: match[1], index: match.index }));
}

test('reference extraction ignores longer vendor paths and keeps product paths', () => {
  const found = scriptReferences('Use `scripts/qualify-head.mjs`, [speech](../scripts/local-speech/README.md) and `packages/app/scripts/mobile/context.ts`.').map(item => item.reference);
  assert.deepEqual(found, ['scripts/qualify-head.mjs', 'scripts/local-speech/README.md']);
  assert.deepEqual(npmScriptReferences('Run `npm run verify` then npm run android:build -- --x.').map(item => item.name), ['verify', 'android:build']);
});

test('an upstream-relative script path needs its upstream directory named in the same document', () => {
  const files = ['packages/os/browser/scripts/chromium-component.mjs', 'packages/app/scripts/mobile/context.ts', 'scripts/release.mjs'];
  assert.equal(vendorRelativeInContext('scripts/chromium-component.mjs', 'See `packages/os/browser/README.md`.', files), true);
  assert.equal(vendorRelativeInContext('scripts/chromium-component.mjs', 'Run `scripts/chromium-component.mjs`.', files), false);
  assert.equal(vendorRelativeInContext('scripts/mobile', 'Upstream `packages/app/app.config.ts`.', files), true);
  assert.equal(vendorRelativeInContext('scripts/mobile/con', 'Upstream `packages/app/app.config.ts`.', files), false);
  assert.equal(vendorRelativeInContext('scripts/release.mjs', 'Run it here.', files), false);
  assert.equal(vendorRelativeInContext('scripts/release.mjs', 'In `vendor/eliza`, run it.', files), false);
});

// Stale references in documents this check does not yet own. Each entry must still be
// stale; remove it as soon as the document is corrected.
const knownStale = new Map([
  // Dated snapshots stay as written; the removed speech toolchain is replaced by docs/fused-speech.md.
  ['docs/mvp-audit-2026-10-11.md|scripts/local-speech/requalify-runtime.py', 'dated audit snapshot; the earlier speech toolchain was removed for the fused libelizainference engine'],
  ['docs/mvp-audit-2026-10-11.md|scripts/test-real-workflow.mjs', 'dated audit snapshot; the helper was removed with its deleted instrumented test'],
  ['docs/mvp-audit-2026-10-11.md|scripts/test-real-workflow-cancel.mjs', 'dated audit snapshot; the helper was removed with its deleted instrumented test'],
]);

test('every scripts/... path in README.md and docs/ exists in this repository or the pinned upstream', () => {
  const failures = [], stillStale = new Set();
  for (const file of docs) {
    const text = read(file);
    for (const { reference, index } of scriptReferences(text)) {
      if (fs.existsSync(path.join(root, reference))) continue;
      if (vendorRelativeInContext(reference, text, listVendorFiles())) continue;
      if (knownStale.has(`${file}|${reference}`)) { stillStale.add(`${file}|${reference}`); continue; }
      failures.push(`${file}:${lineOf(text, index)}: ${reference}`);
    }
  }
  assert.deepEqual(failures, [], 'Replace or remove references to scripts that no longer exist');
  assert.deepEqual([...knownStale.keys()].filter(key => !stillStale.has(key)), [], 'remove corrected entries from knownStale');
});

test('every `npm run X` in README.md and docs/ names a root package.json script', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const failures = [];
  for (const file of docs) {
    const text = read(file);
    for (const { name, index } of npmScriptReferences(text)) if (!Object.hasOwn(scripts, name)) failures.push(`${file}:${lineOf(text, index)}: npm run ${name}`);
  }
  assert.deepEqual(failures, []);
});

// Wording retired by the October 1 resident-agent decision and the October 8 removal
// of the aggregate smoke runners. Historical records describe those events in prose.
const retired = [
  [/[\w-]+-smoke\.mjs/, 'removed smoke runner'],
  [/\bandroid:smoke\b/, 'removed npm script'],
  [/smoke lane/i, 'removed CI lane'],
  [/qualify-stock-video/, 'removed CI qualification step'],
  [/Cloud-only execution/i, 'superseded by the Android-resident agent'],
  [/signed enclave deployment/i, 'enclave hosting is not the architecture'],
  [/AlphaPhotos\.describe/, 'no such native method'],
];

test('README.md and docs/ contain no retired runner or superseded architecture wording', () => {
  const failures = [];
  for (const file of docs) {
    const text = read(file);
    for (const [pattern, reason] of retired) {
      const match = pattern.exec(text);
      if (match) failures.push(`${file}:${lineOf(text, match.index)}: "${match[0]}" (${reason})`);
    }
  }
  assert.deepEqual(failures, []);
});
