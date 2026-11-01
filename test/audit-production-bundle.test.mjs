// Production bundle denylist entries for the simulated password provider and the Maps
// emulator gateway (LOOP-E, J04). Fixture bundles only; the flag-off web-dist audit runs
// separately as npm run audit:bundle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {auditWebBundle, DENYLIST} from '../scripts/audit-production-bundle.mjs';

const script = path.resolve('scripts/audit-production-bundle.mjs');
const MARKERS = ['demo-only-password', 'Development password provider', 'Add development provider', 'Proton Pass · development', '10.0.2.2:47850', '127.0.0.1:47850'];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fixture(t, chunk, flags = {testMocks: false}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-denylist-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Alpha Phone</title>');
  fs.writeFileSync(path.join(dir, 'build-flags.json'), JSON.stringify(flags));
  fs.writeFileSync(path.join(dir, 'assets', 'index.js'), chunk);
  return dir;
}

test('the denylist names the development password provider and the emulator Maps gateway', () => {
  for (const marker of MARKERS) assert.ok(DENYLIST.includes(marker), marker);
});

test('each new marker fails a flag-off fixture bundle on its own', t => {
  for (const marker of MARKERS) {
    const result = auditWebBundle(fixture(t, `const v=${JSON.stringify(marker)};`));
    assert.equal(result.ok, false, marker);
    assert.deepEqual(result.findings, [{file: 'assets/index.js', rule: marker}], marker);
  }
});

test('a leaked provider dialog and gateway fail through the CLI; a recorded test-mocks bundle stays exempt', t => {
  // The shape the simulated provider and regional provider take when their flags stop folding away.
  const leaked = "heading.textContent='Add development provider';button('Proton Pass · development');" +
    "result.textContent='Password: demo-only-password';const g={nativeGateway:'http://10.0.2.2:47850'};";
  const run = spawnSync(process.execPath, [script, fixture(t, leaked)], {encoding: 'utf8'});
  assert.equal(run.status, 1);
  for (const marker of ['Add development provider', 'Proton Pass · development', 'demo-only-password', '10.0.2.2:47850'])
    assert.match(run.stderr, new RegExp(`DENY assets/index\\.js: ${escape(marker)}`));
  assert.equal(auditWebBundle(fixture(t, leaked, {testMocks: true}), {testMocks: true}).ok, true);
  const clean = spawnSync(process.execPath, [script, fixture(t, "const g={nativeGateway:''};const label='Choose password provider';")], {encoding: 'utf8'});
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /^PASS /);
});

test('owner-provided key labels are allowed while the legacy developer provider dialog stays excluded', t => {
  const product=auditWebBundle(fixture(t, 'const labels=["Cerebras API key","Cartesia API key (optional)","Save and use own keys"];'));
  assert.equal(product.ok,true);
  const legacy='A new key takes effect after the agent restarts.';
  const leaked=auditWebBundle(fixture(t, JSON.stringify(legacy)));
  assert.equal(leaked.ok,false);
  assert.deepEqual(leaked.findings,[{file:'assets/index.js',rule:legacy}]);
});
