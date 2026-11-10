import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as audit from '../scripts/audit-production-bundle.ts';

const badge = (text, quote = '"') => `<span style=${quote}width: 30px; height: 30px; border-radius: 15px; background: #fff; font-weight: 700${quote}>${text}</span>`;

test('initials badges are found in raw markup and JSON-escaped bundle strings, not in ordinary text', () => {
  assert.deepEqual(avatarInitials(badge('MC') + badge('+2')), ['MC', '+2']);
  assert.deepEqual(avatarInitials(JSON.stringify(badge('QX'))), ['QX']);
  assert.deepEqual(avatarInitials('<span class="time">PM</span><span style="border-radius: 15px">Calendar</span>'), []);
  assert.deepEqual(avatarInitials(badge('{{e.initials}}')), [], 'data-bound initials are allowed');
});

const {auditWebBundle, avatarInitials} = audit;

test('every hard-coded initials badge fails the audit, including the former MC, JP and +2 allowance', t => {
  assert.equal('PENDING_AVATAR_INITIALS' in audit, false, 'the pending allowance is gone');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-initials-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dir, 'build-flags.json'), JSON.stringify({testMocks: false}));
  fs.writeFileSync(path.join(dir, 'app.js'), `const t=${JSON.stringify(badge('MC') + badge('JP') + badge('+2'))};`);
  const former = auditWebBundle(dir);
  assert.equal(former.ok, false);
  assert.deepEqual(former.findings.map(row => row.rule), ['MC', 'JP', '+2'].map(initials => `hard-coded avatar initials "${initials}"`));
  assert.equal('pendingAvatarInitials' in former, false);
  for (const initials of ['MC', 'JP', '+2']) {
    fs.writeFileSync(path.join(dir, 'app.js'), badge(initials));
    assert.deepEqual(auditWebBundle(dir).findings, [{file: 'app.js', rule: `hard-coded avatar initials "${initials}"`}], initials);
  }
  fs.writeFileSync(path.join(dir, 'app.js'), `const t=${JSON.stringify(badge('SW'))};`);
  const failed = auditWebBundle(dir);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.findings.map(row => row.rule), ['hard-coded avatar initials "SW"']);
});
