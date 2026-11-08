import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from './support/strip-types.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { repositoryRoot } from '../scripts/quint-lib.mjs';

async function sourceModule(path) {
  const source = readFileSync(join(repositoryRoot, path), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'strip' })).toString('base64')}`);
}

function modelTrace(module, scenario, stateName = 's', main = module) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-conformance-'));
  try {
    const output = join(directory, 'trace-{test}-{seq}.json');
    const result = spawnSync(process.execPath, [join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js'),
      'test', `specs/quint/application/${module}.qnt`, `--main=${main}`, '--backend=typescript', '--seed=20261107',
      '--max-samples=1', `--match=^${scenario}$`, `--out-itf=${output}`],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const trace = JSON.parse(readFileSync(join(directory, `trace-${scenario}-0.json`), 'utf8'),
      (_key, value) => value && typeof value === 'object' && '#bigint' in value ? Number(value['#bigint']) : value);
    return trace.states.map(state => state[stateName]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('delegation return page agrees with Quint validation, URL scrubbing and link exposure', () => {
  const state = 'A'.repeat(43);
  const cases = [
    ['validCodeTest', `state=${state}&code=example`],
    ['errorReturnTest', `state=${state}&error=arbitrary_provider_error&error_description=details`],
    ['duplicateStateTest', `state=${state}&state=${state}&code=example`],
    ['wrongStateShapeTest', 'state=short&code=example'],
    ['conflictingResultsTest', `state=${state}&code=example&error=denied`],
    ['unsolicitedDescriptionTest', `state=${state}&code=example&error_description=details`],
    ['oversizedCodeTest', `state=${state}&code=${'x'.repeat(4097)}`],
    ['unknownParameterTest', `state=${state}&code=example&unexpected=1`],
  ];
  const html = readFileSync(join(repositoryRoot, 'apps/app/public/delegation-return.html'), 'utf8');
  for (const [scenario, query] of cases) {
    const expected = modelTrace('CallbackLanding', scenario).at(-1);
    const page = new JSDOM(html, { url: `https://alpha.example/delegation-return.html?${query}`, runScripts: 'dangerously' });
    try {
      const link = page.window.document.getElementById('return');
      assert.equal(page.window.location.search, '', scenario);
      assert.equal(link.hidden, expected.link === 'none', scenario);
      if (expected.link !== 'none') {
        const target = new URL(link.href);
        assert.equal(target.protocol, 'alphaphone:', scenario);
        assert.equal(target.hostname, 'cloud-delegation', scenario);
        assert.equal(target.searchParams.get('state'), state, scenario);
        assert.deepEqual([...target.searchParams.keys()], ['state', expected.link === 'code' ? 'code' : 'error'], scenario);
        if (expected.link === 'access_denied') assert.equal(target.searchParams.get('error'), 'access_denied', scenario);
      }
    } finally { page.window.close(); }
  }
});

test('Quint denied-permission restart trace agrees with the real permission flow', async () => {
  const expected = modelTrace('StartupPermissions', 'denialRestartTest');
  const { createStartupPermissionFlow, readStartupPermissionMemory } = await sourceModule('apps/app/src/startup-permission-flow.ts');
  const saved = new Map();
  const store = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  let requests = 0;
  const bridge = { status: async () => ({ granted: false, enabled: false }),
    request: async () => { requests++; }, openSettings: async () => {} };
  const first = createStartupPermissionFlow(bridge, { key: 'camera', store });
  assert.equal(await first.enable(), expected[3].status);
  assert.equal(requests, expected[3].requests);
  assert.equal(readStartupPermissionMemory(store).attempted.camera, expected[3].attempted);
  const restarted = createStartupPermissionFlow(bridge, { key: 'camera', store });
  assert.equal(await restarted.refresh(), expected.at(-1).status);
  await restarted.enable();
  assert.equal(requests, expected.at(-1).requests);
});

test('Quint private-session trace agrees with the real browser snapshot and restore', async () => {
  const expected = modelTrace('BrowserSession', 'privateRestartTest').at(-1);
  const { browsingSnapshot, restoreBrowsing } = await sourceModule('apps/app/src/browser/browsing-session.ts');
  const state = { tabs: [{ id: '1' }, { id: '3', priv: true }], visits: [], cur: '3' };
  const saved = browsingSnapshot(state, id => ({ url: `https://example.test/${id}`, title: id }));
  const restored = restoreBrowsing(saved, { tabs: [{ id: 'new' }], visits: [] }, true);
  assert.deepEqual(restored.tabs.map(tab => Number(tab.id)), expected.normal['#set']);
  assert.deepEqual(expected.privateTabs['#set'], []);
  assert.ok(!saved.tabs.some(tab => tab.id === '3'));
});

test('Quint large-text trace agrees with the real layout policy', async () => {
  const expected = modelTrace('PreferencesAndPresentation', 'largeTextTest').at(-1);
  const { surfaceLayout, keyboardFreeHeight } = await sourceModule('apps/app/src/runtime/canvas-geometry.ts');
  assert.deepEqual(surfaceLayout(expected.width, expected.textScale / 100), { split: false, calendarDays: 1, agenda: true });
  const height = keyboardFreeHeight();
  assert.equal(height(412, 915, false), 915);
  assert.equal(height(412, 300, true), 915);
});

test('Quint draft-conflict trace agrees with real revisioned composer writes', async () => {
  const expected = modelTrace('AssistantConversation', 'draftConflictTest').at(-1);
  const { replaceAssistantDraft } = await sourceModule('apps/app/src/runtime/assistant-draft-record.ts');
  const original = { version: 1, binding: 'owner-one', revision: 'first', text: '' };
  const saved = replaceAssistantDraft(original, original, 'owner-one', expected.savedDraft, () => 'second');
  assert.throws(() => replaceAssistantDraft(saved, original, 'owner-one', expected.draft, () => 'third'), /changed in another view/);
  assert.equal(saved.text, expected.savedDraft);
  assert.throws(() => replaceAssistantDraft(saved, saved, 'owner-two', '', () => 'third'), /needs recovery/);
});

test('all 240 voice-deletion recovery evidence combinations agree with the real planner', async () => {
  const states = modelTrace('PermanentVoiceDeletion', 'decisionTableTest', 'rows', 'PermanentVoiceDeletionContract');
  const rows = states[0]['#set'];
  assert.equal(rows.length, 240);
  const { planInterruptedPermanentDeletion } = await sourceModule('apps/app/src/runtime/permanent-voice-deletion.ts');
  for (const row of rows) {
    const evidence = { note: row.note,
      recording: row.known ? { ownedByNote: row.owned, inAudioTrash: row.inTrash } : null,
      receipt: row.receipt === 'unreadable' ? null : row.receipt, referencedElsewhere: row.referenced };
    assert.equal(planInterruptedPermanentDeletion(evidence), row.plan, JSON.stringify(evidence));
  }
});

test('held draft release matches the real controller with newer typing', async () => {
  const expected = modelTrace('DraftDispatch', 'unsentTextRestoredTest').at(-1);
  const actualText = value => value === 'A+B' ? 'A\nB' : value;
  const { AssistantDraftController } = await sourceModule('apps/app/src/prototype/assistant-draft-controller.ts');
  let text = '';
  let record = { version: 1, binding: 'one', revision: '0', text: 'A' };
  const store = {
    async read() { return record; },
    async save(previous, value) {
      assert.deepEqual(previous, record);
      record = { ...record, revision: String(Number(record.revision) + 1), text: value };
      return record;
    },
  };
  const controller = new AssistantDraftController(async () => store, () => text, value => { text = value; }, () => {});
  await controller.open('one');
  assert.equal(await controller.hold('A'), true);
  text = '';
  controller.edit(text);
  text = 'B';
  controller.edit(text);
  controller.release();
  for (let tick = 0; tick < 10 && record.text !== actualText(expected.savedOne); tick++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(text, actualText(expected.draft));
  assert.equal(record.text, actualText(expected.savedOne));
});
