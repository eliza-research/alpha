import assert from 'node:assert/strict';
import test from 'node:test';
import {firstSendDraftMigrationFixture, migrationText, replacementText} from './fixtures/first-send-draft-migration.mjs';
import {checkFirstSendDraftMigration} from '../specs/quint/refinement/application/first-send-draft-migration.mjs';

async function heldSource() {
  const f = await firstSendDraftMigrationFixture();
  await f.start();
  await f.advance('destination');
  assert.equal(f.observe().phase, 'source');
  return f;
}

test('the first-send migration refines Quint slot custody through source CAS', async () => {
  const receipt = await checkFirstSendDraftMigration();
  assert.equal(receipt.traces, 11);
});

test('a current draft migration clears only the confirmed source copy', async () => {
  const f = await heldSource();
  await f.drain();
  assert.equal(f.observe().source.text, '');
  assert.equal(f.observe().destination.text, migrationText);
  assert.equal(f.observe().attempts, 1);
});

for (const change of ['rebind', 'retire', 'replace destination']) {
  test(`first-send draft migration keeps the source if the held read outlives ${change}`, async () => {
    const f = await heldSource();
    if (change === 'replace destination') f.replaceDestination(replacementText);
    else f[change]();
    await f.drain();
    assert.equal(f.observe().attempts, 0);
    assert.equal(f.observe().source.text, migrationText);
  });
}
