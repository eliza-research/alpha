import assert from 'node:assert/strict';
import test from 'node:test';

const globals = ['alphaTriggerDevice', 'document', 'window', 'localStorage'];
const descriptors = () => Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

test('TriggerCursor import and cases restore globals before the next PGlite source campaign', {timeout: 120000}, async t => {
  const previous = descriptors();
  const fixture = await import('../specs/quint/refinement/services/trigger-cursor-replay.mjs');
  assert.deepEqual(descriptors(), previous, 'import must not leave a synthetic browser installed');
  for (const name of ['runTriggerCursorCase1', 'runTriggerCursorCase2', 'runTriggerCursorCase3']) {
    await fixture[name](t);
    assert.deepEqual(descriptors(), previous, name + ' must restore exact previous property descriptors');
  }
  const marker = new Error('Deliberate source assertion failure');
  t.mock.method(assert, 'deepEqual', () => { throw marker; });
  try {
    await assert.rejects(fixture.runTriggerCursorCase1(t), error => error === marker);
  } finally { t.mock.restoreAll(); }
  assert.deepEqual(descriptors(), previous, 'a failed source assertion must also restore globals');

  const {loadTaskService} = await import('../specs/quint/refinement/services/task-service/module.mjs');
  const sql = await loadTaskService();
  const database = await sql.createIsolatedTestDatabase('quint-trigger-cursor-isolation', [], {postgresUrl: null});
  try { assert.ok(database.runtime, 'the next real PGlite campaign initializes in the Node environment'); }
  finally { await database.cleanup(); }
});
