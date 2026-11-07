import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Quint native traces agree with real listener, reset and audio-focus policies', () => {
  const result = spawnSync(process.execPath, ['specs/quint/native/conformance.mjs'], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /conformance|assertions|states/i);
});
