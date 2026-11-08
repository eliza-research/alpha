import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {deferred} from '../../legacy/core/source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const sources = [driver, 'test/fixtures/browser-daily-stores.mjs', 'apps/app/src/browser/journal-retention.ts',
  'apps/app/src/browser/daily.ts', 'apps/app/src/browser/calendar.ts', 'apps/app/src/browser/calendar-store.ts',
  'apps/app/src/browser/reminder-store.ts', 'apps/app/src/browser/domain-document.ts',
  'apps/app/src/browser/calendar-deletions.ts', 'apps/app/src/browser/reminder-deletions.ts',
  '.eliza/client-features/packages/contracts/src/deletion-window.ts', 'specs/quint/legacy/core/source-support.mjs'];
const model = 'BrowserDeletionPoll';
const pollers = [1, 2];

async function seed(kind, modules) {
  if (kind === 'calendar') {
    const calendar = new modules.BrowserCalendar(), document = modules.calendarDocument;
    const start = Date.UTC(2030, 0, 1, 9);
    assert.equal((await calendar.save({creationId: crypto.randomUUID(), calendarId: 'local',
      title: 'Synthetic event', begin: start, end: start + 3600000})).status, 'saved');
    const state = JSON.parse(await document.readRaw()), row = state.events[0];
    const result = await calendar.executeAgent({operationId: 'fixture-delete',
      operation: {type: 'calendar_delete', target: {sourceId: 'local', sourceRevision: state.sourceRevision,
        eventId: row.id, revision: row.revision}}, journalIdentity: {scope: 'fixture-scope', proposalId: 'fixture-proposal'}});
    assert.equal(result.status, 'queued');
    return {document, poll: () => calendar.settleDeletions()};
  }
  const daily = new modules.BrowserDaily({});
  await daily.scheduleReminder({id: 'r1', title: 'Synthetic reminder', at: Date.now() + 86400000});
  const target = await daily.selectedReminder({id: 'r1'});
  await daily.stageDeletion(target, 'agent:test', 'fixture-delete', JSON.stringify(['a'.repeat(64), 1]));
  return {document: modules.reminderDocument, poll: () => daily.settleDeletions()};
}

async function scenario(modules, resetDocuments, kind, name, drive) {
  const {documents} = resetDocuments();
  const baseNow = 1000;
  let now = baseNow;
  const old = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', {configurable: true, value: () => now});
  try {
    const {document, poll} = await seed(kind, modules);
    const baseline = documents.writes;
    const owner = new AsyncLocalStorage();
    const state = new Map(pollers.map(id => [id, {phase: 'idle', entered: deferred(), resume: deferred()}]));
    const edit = documents.edit.bind(documents);
    documents.edit = async (...args) => {
      const request = owner.getStore();
      assert.ok(request, 'Every subsequent edit comes from a real poll');
      request.entered.resolve();
      await request.resume.promise;
      return edit(...args);
    };
    async function observe() {
      const rows = Object.values(JSON.parse(await document.readRaw()).deletions);
      assert.equal(rows.length, 1);
      return {'state.row': rows[0].phase, 'state.expired': now > baseNow,
        'state.commits': documents.writes - baseline,
        'state.phase': qmap(pollers.map(id => [id, state.get(id).phase]))};
    }
    const trace = {name: kind + '-' + name, init: {name: 'init'}, expect: await observe(), steps: []};
    async function step(label, name, ...args) {
      trace.steps.push({label, action: {name, args}, expect: await observe()});
    }
    await drive({
      async expire() {
        now += 10000;
        await step('the real monotonic deadline elapses', 'expire');
      },
      async inspect(id) {
        const request = state.get(id);
        request.result = owner.run(request, poll).then(() => ({}), error => ({error}));
        request.phase = await Promise.race([
          request.entered.promise.then(() => 'waiting'),
          request.result.then(result => {assert.ifError(result.error); return 'done';}),
        ]);
        await step('a read either joins the real edit boundary or returns', 'inspect', id);
      },
      async settle(id, failure) {
        const request = state.get(id);
        assert.equal(request.phase, 'waiting');
        if (failure) request.resume.reject(failure);
        else request.resume.resolve();
        const outcome = await request.result;
        assert.equal(outcome.error, failure);
        request.phase = outcome.error ? 'failed' : 'done';
        await step('document admission completes with its actual revision', failure ? 'rejectEdit' : 'settle', id);
      },
    });
    return trace;
  } finally {
    if (old) Object.defineProperty(performance, 'now', old);
    else delete performance.now;
  }
}

export async function runBrowserDeletionPollRefinement(extraSources = []) {
  const inputs = [...sources, ...extraSources], driverHashes = captureInputs(inputs);
  const globalNames = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'CustomEvent',
    'localStorage', 'getComputedStyle', 'BroadcastChannel', '__alphaTest'];
  const globals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const traces = [];
  try {
    const {modules, resetDocuments, installBrowserDailyFixtures} = await import('../../../../test/fixtures/browser-daily-stores.mjs');
    installBrowserDailyFixtures();
    for (const kind of ['calendar', 'reminder']) {
      const run = (name, drive) => scenario(modules, resetDocuments, kind, name, drive);
      traces.push(await run('skip-unexpired-and-admit-expired', async f => {
        await f.inspect(1); await f.expire(); await f.inspect(2); await f.settle(2);
      }));
      traces.push(await run('stale-reader-after-successful-competitor', async f => {
        await f.expire(); await f.inspect(1); await f.inspect(2); await f.settle(2); await f.settle(1);
      }));
      traces.push(await run('failed-editor-leaves-row-for-competitor', async f => {
        await f.expire(); await f.inspect(1); await f.inspect(2);
        await f.settle(1, Error('Fixture document write refused')); await f.settle(2);
      }));
    }
  } finally {
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  const receipt = await checkTraces({model, traces, sources: inputs, driverHashes, scope: 'bounded-orchestration',
    assumptions: [
      'Real browser Calendar and Reminder settlement methods, domain documents and pinned deletion deadlines.',
      'A controlled document port holds entry into the serialized edit, compares raw bytes and records CAS revisions. Each case begins with one queued owned row and two one-use pollers.',
      'Owner changes, corrupt data, partial device effects and native Calendar writes are separate projections.',
    ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Multiple rows, ownership changes and installed Web Locks behavior',
      reason: 'The source schedules check one queued deletion and overlapping renderer polls under a controlled serialized document port.'},
  ]};
}
