// docs/operational-handoff.md (MVP-51) indexes the operator's documents and files. Every
// repository path it links or names in code spans must exist, and each required section must
// be present, so the index cannot silently point at a moved or deleted file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const file = 'docs/operational-handoff.md';
const text = fs.readFileSync(path.join(root, file), 'utf8');
const SECTIONS = ['Upstream references', 'Build and provisioning', 'Dependency and licence inventory', 'Service guide', 'Privacy and retention', 'Release manifests', 'Backup and export', 'Rollback'];

/** Markdown link targets relative to docs/, without anchors; external links are skipped. */
function linkTargets(markdown) {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(match => match[1])
    .filter(target => !/^[a-z]+:/i.test(target) && !target.startsWith('#'))
    .map(target => ({ target, file: path.normalize(path.join('docs', target.split('#')[0])) }));
}

/** Code spans that name a repository path (a known top-level directory or file). */
function codePaths(markdown) {
  return [...markdown.matchAll(/`((?:docs|scripts|android|apps|test)\/[^`\s]*|upstream\.lock\.json)`/g)]
    .map(match => match[1].replace(/\/$/, ''))
    .filter(reference => !reference.includes('<'));
}

test('the hand-off index has every required section', () => {
  for (const heading of SECTIONS) assert.ok(text.includes(`\n## ${heading}\n`), `missing section "## ${heading}"`);
});

test('every linked repository path in the hand-off index exists', () => {
  const links = linkTargets(text);
  assert.ok(links.length > 20, 'expected the index to link its sources');
  const missing = links.filter(link => !fs.existsSync(path.join(root, link.file))).map(link => link.target);
  assert.deepEqual(missing, []);
});

test('every repository path named in a code span exists', () => {
  const missing = codePaths(text).filter(reference => !fs.existsSync(path.join(root, reference)));
  assert.deepEqual(missing, []);
});

test('backup is stated as decided out of scope and rollback as not offered', () => {
  const section = heading => text.slice(text.indexOf(`\n## ${heading}\n`)).split('\n## ')[1];
  assert.match(section('Backup and export'), /Decided by P-25 \(A-19/);
  assert.match(section('Backup and export'), /no app-data backup/);
  assert.match(section('Rollback'), /^Rollback\n\nNot offered\./);
  assert.match(section('Rollback'), /A-06/);
});

test('current status links the hand-off index', () => {
  assert.match(fs.readFileSync(path.join(root, 'docs/mvp-current-status.md'), 'utf8'), /\]\(operational-handoff\.md\)/);
});
