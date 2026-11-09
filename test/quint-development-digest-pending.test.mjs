import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const probe = fileURLToPath(new URL('../specs/quint/refinement/services/development-digest-pending-probe.mjs', import.meta.url));

test('as-built development digest storage refuses exact dispatch and legacy normalization', () => {
  const run = spawnSync(process.execPath, ['--import=tsx', probe, 'baseline'], {encoding: 'utf8', timeout: 10000});
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr);
  const rows = JSON.parse(run.stdout);
  assert.deepEqual(rows.map(row => row.phase), ['review', 'legacy']);
  for (const row of rows) {
    assert.match(row.error, /awaiting recovery/);
    assert.equal(row.current, row.before);
    assert.equal(row.reachedHost, false);
    assert.equal(row.commits, 1);
  }
});
