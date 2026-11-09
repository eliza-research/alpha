import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('scan export model preserves the reproduced current explicit-save discrepancy', () => {
  const result = spawnSync(process.execPath, ['specs/quint/services/scan-source-conformance.mjs'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
