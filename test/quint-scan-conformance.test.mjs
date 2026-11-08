import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('scan export preserves explicitly saved drafts through later autosaves', () => {
  const result = spawnSync(process.execPath, ['--import=tsx', 'specs/quint/services/scan-source-conformance.mjs'], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
