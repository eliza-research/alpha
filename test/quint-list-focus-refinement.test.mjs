import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('removed UI helpers remain explicitly historical after current-main reconciliation', () => {
  const current = JSON.parse(readFileSync(new URL('../specs/quint/application/manifest.json', import.meta.url)));
  const historical = JSON.parse(readFileSync(new URL('../specs/quint/legacy/manifest.json', import.meta.url)));
  for (const name of ['ListFocus', 'FilesTree']) {
    assert.equal(current.some(entry => entry.module === name), false);
    const entry = historical.find(entry => entry.module === name);
    assert.ok(entry);
    assert.deepEqual(entry.sources, []);
    assert.ok(entry.historicalSources.length > 0);
    assert.ok(entry.historicalSources.every(source => /^[a-f0-9]{40}$/.test(source.commit)));
  }
});
