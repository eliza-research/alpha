// Owner decisions (2026-10-30) for the investor demo: internal project scope never reaches users as
// copy, and the production bundle audit refuses it if it ever does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditWebBundle, DENYLIST} from '../scripts/audit-production-bundle.mjs';

const SCOPE_COPY = /["'`][^"'`\n]*(?:deferred from the MVP|\bMVP\b)[^"'`\n]*["'`]/;

function sources(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(?:[cm]?js|tsx?|html)$/.test(entry.name) ? [file] : [];
  });
}

test('no app string literal names the MVP or a deferral as user copy', () => {
  const found = [];
  for (const file of sources('apps/app/src'))
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const code = line.replace(/^\s*(?:\/\/|\*|\/\*|<!--).*$/, '');
      if (SCOPE_COPY.test(code)) found.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  assert.deepEqual(found, []);
});

test('the unavailable-app copy is plain and the production audit refuses the retired wording', t => {
  const model = fs.readFileSync('apps/app/src/prototype/model.js', 'utf8');
  for (const copy of ['This app is not available on this phone yet.', 'This action is not available on this phone yet.', 'This workflow is not available on this phone yet.', "I can't set up that workflow on this phone yet."])
    assert.ok(model.includes(copy), copy);
  assert.ok(DENYLIST.includes('deferred from the MVP'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-demo-copy-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Alpha Phone</title>');
  fs.writeFileSync(path.join(dir, 'build-flags.json'), JSON.stringify({testMocks: false}));
  fs.writeFileSync(path.join(dir, 'assets', 'index.js'), 'toast("This app is deferred from the MVP");');
  const result = auditWebBundle(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{file: 'assets/index.js', rule: 'deferred from the MVP'}]);
});
