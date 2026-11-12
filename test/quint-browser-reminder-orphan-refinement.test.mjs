import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';
import {action, sourceModule} from '../specs/quint/refinement/services/support.mjs';
import {withObservedReminderClock} from './fixtures/browser-reminder-clock.mjs';

const model = 'BrowserReminderOrphan';
const fixture = 'test/fixtures/browser-daily-stores.mjs';
const recovery = 'apps/app/src/browser/deletion-recovery.ts';
const browser = 'apps/app/src/browser/';
const prepared = '.eliza/client-features/';
const sources = [fileURLToPath(import.meta.url), fixture, recovery,
  'test/fixtures/browser-reminder-clock.mjs', 'specs/quint/refinement/services/support.mjs', 'upstream.lock.json',
  ...['daily.ts', 'clock.ts', 'reminder-store.ts', 'reminder-deletions.ts', 'domain-document.ts',
    'journal-retention.ts', 'revision.ts', 'preference-documents.ts'].map(path => browser+path),
  ...['packages/contracts/src/deletion-window.ts', 'plugins/plugin-native-reminders/src/occurrence.ts',
    'plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts',
    'plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts'].map(path => prepared+path),
];
const key = 'alpha.browser.reminders.v1', marker = '__proto__';
const sourceRevision = 'a'.repeat(64), originalRevision = 'b'.repeat(64), bindingHash = 'c'.repeat(64);
const wall = Date.UTC(2030, 0, 1, 9), minute = 60000;
const atMinute = offset => wall + offset*minute;
const offset = at => (at-wall)/minute;

function idClasses(original) {
  const identities = new Map([[original, 1]]);
  return value => {
    assert.equal(typeof value, 'string');
    if (!identities.has(value)) identities.set(value, identities.size+1);
    return identities.get(value);
  };
}

async function scenario(modules, resetDocuments, browserDeletionRecovery, name, options, drive) {
  const {BrowserDaily, BrowserClock, reminderDocument: store} = modules;
  const harness = resetDocuments(), {documents} = harness;
  const {kind = 'reminder', status = 'scheduled', orphan = true, legacy = false} = options;
  const id = kind === 'alarm' ? 'alarm_fixture' : 'fixture';
  const firstAt = atMinute(status === 'permission-denied' ? 2 : -1);
  const row = {id, title: 'original', body: 'Fixture', at: firstAt, dueAt: firstAt,
    mode: 'inexact', status, createdAt: atMinute(-2), occurrenceId: 'fixture-original',
    revision: originalRevision, history: [], ...(status === 'posted' ? {postedAt: atMinute(-1)} : {}),
    ...(orphan ? {pendingDeletion: marker} : {})};
  // Exact legacy orphan shape: JSON retained the row marker but not the map prototype.
  const raw = JSON.stringify({sourceRevision, reminders: [row], ...(orphan ? {deletions: {}} : {})});
  localStorage.removeItem(key);
  if (legacy) localStorage.setItem(key, raw);
  else await documents.compareExchange(key, undefined, JSON.stringify({version: 1, legacy: null, value: raw}));
  let daily = new BrowserDaily({}), now = 0, clockProbe;
  Object.defineProperty(Date, 'now', {configurable: true, writable: true, value: () => atMinute(now)});
  const revision = idClasses(originalRevision), occurrence = idClasses('fixture-original');
  const operations = new Map();

  async function observe() {
    const captured = await store.capture(), data = JSON.parse(captured.raw);
    const saved = data.reminders.find(reminder => reminder.id === id);
    const peer = data.reminders.find(reminder => reminder.id === 'peer' || reminder.id === 'operation-3');
    assert.equal(data.sourceRevision, sourceRevision);
    assert.equal(captured.legacy, legacy ? raw : null, 'migration preserves exact legacy storage');
    assert.equal(captured.legacyChanged, false);
    assert.ok(saved.pendingDeletion === undefined || saved.pendingDeletion === marker);
    const own = Object.hasOwn(data.deletions ?? {}, marker);
    const receipts = Object.keys(data.receipts ?? {}).map(value => {
      assert.match(value, /^operation-[1-3]$/);
      return Number(value.at(-1));
    });
    return {
      's.row': {kind: saved.id.startsWith('alarm_') ? 'alarm' : 'reminder',
        marker: saved.pendingDeletion === marker, status: saved.status, at: offset(saved.at), due: offset(saved.dueAt),
        revision: revision(saved.revision), occurrence: occurrence(saved.occurrenceId), title: saved.title,
        snoozed: saved.snoozedAt !== undefined, history: saved.history?.length ?? 0},
      's.peer': {status: peer?.status ?? 'none', at: peer ? offset(peer.at) : 0},
      's.journal': own ? data.deletions[marker].phase : 'none',
      's.claim': Object.hasOwn(data.deleteClaims ?? {}, marker),
      's.legacy': captured.legacy !== null, 's.canonical': captured.snapshot !== undefined,
      's.now': now, 's.notifications': harness.notifications, 's.receipts': qset(receipts),
      's.clock': {listed: clockProbe?.clock.rows.some(alarm => alarm.id === id) ?? false,
        pendingLock: (clockProbe?.queued() ?? 0) > 0, owned: clockProbe?.clock.owns ?? false,
        sounds: clockProbe?.sounds.length ?? 0},
    };
  }
  const trace = {name, init: action('initFor', kind, status, orphan, legacy), expect: await observe(), steps: []};
  const record = async (label, step, observations = {}) => trace.steps.push({label, action: step,
    expect: {...await observe(), ...observations}});
  const reject = (name, ...args) => ({...action(name, ...args), reject: true});
  const selected = () => daily.selectedReminder({id});
  const currentRaw = async () => (await store.capture()).raw;
  async function unchanged(work) {
    const before = await currentRaw();
    const value = await work();
    assert.equal(await currentRaw(), before, 'operation preserves exact durable domain bytes');
    return value;
  }
  async function reviewed(id, operation, transition, refused) {
    const input = {operationId: 'operation-'+id, bindingHash, operation};
    if (refused) {
      await unchanged(() => assert.rejects(daily.operateReminder(input), refused));
      await record('exact source rejects the requested reviewed mutation', {...transition, reject: true});
      return;
    }
    const reply = await daily.operateReminder(input);
    assert.equal(reply.status, 'succeeded');
    assert.deepEqual(await daily.reminderOperationReceipt(input), reply);
    operations.set(id, {input, reply});
    await record('actual reviewed mutation persists its result and operation receipt', transition);
  }
  const peerCreation = () => ({type: 'reminder_create', fields: {title: 'Unrelated reminder', body: '',
    schedule: {at: atMinute(now+1), dueAt: atMinute(now+1), alertMinutes: 0, recurrence: null}}});
  const api = {
    selected,
    async load() {
      assert.equal(await store.readRaw(), raw);
      await record('current BrowserDomainDocument imports exact historical bytes', action('load'));
    },
    async inspect({recover = false, reload = false} = {}) {
      if (reload) daily = new BrowserDaily({});
      const result = await unchanged(async () => {
        const target = await selected(), selection = await daily.deletionSelection(target);
        assert.equal(selection.row.id, id);
        const pending = await daily.pendingDeletions(), receipt = await daily.deletionReceipt(marker);
        if (recover) {
          const attempted = {operationId: marker, attemptId: 'fixture-attempt', phase: 'applying', status: 'unknown',
            record: {operation: {type: 'reminder_cancel', target}}};
          assert.equal(browserDeletionRecovery(attempted, receipt.entry, receipt.row), null);
        }
        return {PendingReview: pending.some(entry => entry.id === marker),
          ReceiptHasEntry: receipt.entry !== null, ReceiptHasRow: receipt.row?.id === id};
      });
      await record(reload ? 'fresh store consumer reads the same receipt and row authority' :
        'selection, pending list and deletion receipt are read-only', action('inspect'), result);
    },
    async list() {
      const result = await daily.listReminders();
      await record('actual list reconciles eligible due rows and exposes non-cancelled reminders', action('list'),
        {InReminderList: result.reminders.some(reminder => reminder.id === id)});
    },
    async settle() {
      await unchanged(() => daily.settleDeletions());
      await record('current polling has no expiry authority to settle', action('settle'));
    },
    async advance() {
      now++;
      await record('fixture wall clock advances while deletion continuity remains open', action('advance'));
    },
    async notifications(on) {
      harness.notifications = on;
      await record('fixture notification permission changes', action('setNotifications', on));
    },
    async stage(refused = false) {
      const target = await selected();
      if (refused) await unchanged(() => assert.rejects(daily.stageDeletion(target, 'agent:test', marker, 'fixture-binding'), /already pending|already used/));
      else {
        const result = await daily.stageDeletion(target, 'agent:test', marker, 'fixture-binding');
        assert.equal(result.phase, 'queued');
      }
      await record(refused ? 'a marker blocks another reviewed stage' : 'current stage writes a real own-key deletion and claim',
        refused ? reject('stage') : action('stage'));
    },
    async undo(refused = false) {
      if (refused) await unchanged(() => assert.rejects(daily.undoDeletion(marker), /owner changed/));
      else assert.equal((await daily.undoDeletion(marker)).phase, 'undone');
      await record(refused ? 'Undo refuses an orphan with no own record' : 'reviewed Undo releases a genuinely paired marker',
        refused ? reject('undo') : action('undo'));
    },
    async dismiss() {
      await unchanged(() => assert.rejects(daily.dismissDeletion(marker), /Uncertain deletion is unavailable/));
      await record('missing receipt also refuses uncertain-outcome dismissal', reject('dismiss'));
    },
    async read(target, stale = false) {
      target ??= await selected();
      const call = () => daily.operateReminder({operationId: 'reader', bindingHash,
        operation: {type: 'reminder_read_selected', target}});
      if (stale) await unchanged(() => assert.rejects(call(), /Reminder changed/));
      else assert.equal((await unchanged(call)).result.reminderId, id);
      await record(stale ? 'an old selected revision is refused' : 'current selected read works without a new receipt',
        stale ? reject('readSelected', revision(target.revision)) : action('readSelected', revision(target.revision)));
    },
    async edit(id, reschedule = false, refused) {
      const target = await selected();
      const fields = {title: 'edited', body: 'Fixture', ...(reschedule ? {schedule: {at: atMinute(now+2), recurrence: null}} : {})};
      await reviewed(id, {type: 'reminder_update', target, fields},
        action('edit', id, revision(target.revision), reschedule), refused);
    },
    async replay(id) {
      const {input, reply} = operations.get(id);
      assert.deepEqual(await unchanged(() => daily.operateReminder(input)), reply);
      await record('exact replay returns its saved result without changing row bytes', action('replay', id));
    },
    async reviewedDecision(id, kind) {
      const target = await selected();
      await reviewed(id, {type: kind === 'done' ? 'reminder_complete' : 'reminder_snooze', target},
        action('reviewedDecision', id, revision(target.revision), kind));
    },
    async decision(kind, previous, refusal) {
      const target = previous ?? await selected();
      const call = () => daily.reminderDecision({id, occurrenceId: target.occurrenceId, action: kind});
      if (refusal === 'paired') await unchanged(() => assert.rejects(call(), /Undo or finish/));
      else if (refusal === 'stale') assert.deepEqual(await unchanged(call), {status: 'stale'});
      else assert.ok(['scheduled', 'permission-denied', 'completed', 'unchanged'].includes((await call()).status));
      const args = [kind, occurrence(target.occurrenceId)];
      await record('current occurrence decision uses actual store mutation admission',
        refusal ? reject('decision', ...args) : action('decision', ...args));
    },
    async replace(refused = false) {
      const call = () => daily.scheduleReminder({id, title: 'replacement', at: atMinute(now+2)});
      if (refused) await unchanged(() => assert.rejects(call(), /Undo or finish/));
      else assert.equal((await call()).id, id);
      await record('explicit same-identity schedule follows actual whole-row replacement admission',
        refused ? reject('scheduleReplacement') : action('scheduleReplacement'));
    },
    async createSame() {
      const input = {operationId: id, bindingHash, operation: peerCreation()};
      await unchanged(() => assert.rejects(daily.operateReminder(input), /creation identity already exists/));
      await record('reviewed creation cannot replace the marked identity', reject('createSame'));
    },
    async directCancel() {
      const target = await selected();
      const input = {operationId: 'cancel', bindingHash, operation: {type: 'reminder_cancel', target}};
      await unchanged(() => assert.rejects(daily.operateReminder(input), /reviewed deletion window/));
      await record('ordinary Reminder cancellation cannot bypass the reviewed window', reject('directCancel'));
    },
    async createPeer(isReviewed = false) {
      if (isReviewed) await reviewed(3, peerCreation(), action('createPeer', true));
      else {
        assert.equal((await daily.scheduleReminder({id: 'peer', title: 'Unrelated reminder', at: atMinute(now+1)})).id, 'peer');
        await record('an unrelated reminder can still be scheduled', action('createPeer', false));
      }
    },
    async alarmDecision(kind, bulk, refused = false) {
      const target = await selected();
      const call = () => bulk ? daily.clockHandoff({action: kind, reviewed: true, snoozeMinutes: 5}) :
        daily.clockDecision({id, action: kind, revision: target.revision, minutes: 5});
      if (refused) await unchanged(() => assert.rejects(call(), /Undo or finish/));
      else assert.equal((await call()).status, bulk ? 'opened' : 'applied');
      const args = [kind, revision(target.revision), bulk];
      await record('Clock decisions preserve the marker when the store admits the mutation',
        refused ? reject('alarmDecision', ...args) : action('alarmDecision', ...args));
    },
    async withClock(work) {
      await withObservedReminderClock(BrowserClock, daily, async clock => {
        clockProbe = clock;
        await work();
      });
    },
    async pollClock() {
      await clockProbe.poll();
      await record('real Clock projects the row and tests ringing eligibility', action('pollClock'));
    },
    async grantClock(rings) {
      if (rings) {
        void clockProbe.grant();
        await clockProbe.waitForSound();
      } else await clockProbe.grantWithoutSound();
      await record('real lock callback rereads the source before using synthetic audio', action('grantClock'));
    },
  };
  await drive(api);
  return trace;
}

async function checkBrowserReminderOrphan(extraSources = []) {
  const inputs = [...sources, ...extraSources], driverHashes = captureInputs(inputs);
  const globals = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'CustomEvent',
    'localStorage', 'getComputedStyle', 'BroadcastChannel', '__alphaTest']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const date = Object.getOwnPropertyDescriptor(Date, 'now'), elapsed = Object.getOwnPropertyDescriptor(performance, 'now');
  const traces = [];
  let previousLegacy;
  try {
    const {modules, resetDocuments, installBrowserDailyFixtures} = await import('./fixtures/browser-daily-stores.mjs');
    installBrowserDailyFixtures?.();
    previousLegacy = localStorage.getItem(key);
    Object.defineProperty(performance, 'now', {configurable: true, value: () => 100});
    const {browserDeletionRecovery} = await sourceModule(recovery);
    const run = async (name, options, drive) => traces.push(await scenario(modules, resetDocuments,
      browserDeletionRecovery, name, options, drive));

    await run('legacy-import-has-a-visible-row-but-no-deletion-authority', {legacy: true}, async api => {
      await api.load(); await api.list(); await api.inspect({recover: true}); await api.read();
      await api.settle(); await api.stage(true); await api.undo(true); await api.dismiss();
      await api.createSame(); await api.directCancel(); await api.createPeer(true); await api.advance(); await api.list(); await api.inspect({recover: true, reload: true});
    });
    await run('orphan-edits-reviewed-snooze-done-and-explicit-replacement', {}, async api => {
      const original = await api.selected();
      await api.edit(1); await api.replay(1); await api.read(original, true);
      await api.edit(2, true); await api.decision('snooze', original, 'stale');
      await api.reviewedDecision(3, 'snooze'); await api.decision('done'); await api.inspect({recover: true});
      await api.replace(); await api.inspect(); await api.advance(); await api.advance(); await api.list();
    });
    await run('orphan-prevents-revival-when-notifications-return', {status: 'permission-denied'}, async api => {
      await api.notifications(false); await api.list(); await api.notifications(true); await api.list();
      await api.decision('snooze'); await api.list(); await api.inspect({recover: true});
    });
    await run('explicit-clock-cancel-retains-orphan-and-does-not-create-a-deletion-receipt',
      {kind: 'alarm', status: 'posted'}, async api => {
        await api.alarmDecision('cancel', false); await api.list(); await api.inspect({recover: true});
      });
    await run('reviewed-clock-handoff-can-snooze-an-orphaned-posted-alarm',
      {kind: 'alarm', status: 'posted'}, async api => {
        await api.alarmDecision('snooze', true); await api.list(); await api.inspect({recover: true});
      });
    await run('genuine-pair-guards-edits-decisions-and-replacement-until-undo',
      {kind: 'alarm', status: 'posted', orphan: false}, async api => {
        await api.stage(); await api.inspect(); await api.edit(1, false, /Undo or finish/);
        await api.decision('done', undefined, 'paired'); await api.replace(true);
        await api.alarmDecision('cancel', false, true); await api.alarmDecision('dismiss', true, true);
        await api.createPeer(); await api.settle(); await api.undo(); await api.inspect(); await api.edit(1);
      });
    await run('posted-legacy-orphan-remains-visible-without-a-ringing-lock',
      {kind: 'alarm', status: 'posted'}, async api => {
        await api.withClock(async () => { await api.pollClock(); await api.inspect({recover: true}); });
      });
    await run('clock-lock-rechecks-a-new-pair-and-undo-restores-normal-ringing',
      {kind: 'alarm', status: 'posted', orphan: false}, async api => {
        await api.withClock(async () => {
          await api.pollClock(); await api.stage(); await api.grantClock(false);
          await api.pollClock(); await api.inspect(); await api.undo(); await api.pollClock(); await api.grantClock(true);
        });
      });
  } finally {
    if (previousLegacy !== undefined) {
      if (previousLegacy === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previousLegacy);
    }
    Object.defineProperty(Date, 'now', date);
    if (elapsed) Object.defineProperty(performance, 'now', elapsed);
    else delete performance.now;
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }

  const receipt = await checkTraces({model, traces, sources: inputs, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual BrowserDaily, reminder store, domain migration and Clock execute over a controlled document CAS/notification port and jsdom. The source campaign loads the exact persisted orphan shape left by the historical prototype-key staging bug.',
    'One legacy v1 one-off reminder or alarm, one unrelated row, and at most one own reviewed deletion. Wall minutes are relative classes. Opaque row and occurrence IDs preserve equality and replacement order.',
    'Deletion continuity stays within the current review window. Clock lock callbacks and synthetic audio are controlled. Real IndexedDB/Web Locks concurrency, rendering, deletion expiry and any new orphan recovery policy remain separate.',
  ]});
  return {receipt, obligations: [
    {model, obligation: 'Explicit orphan review and recovery across durable deletion authorities',
      reason: 'The orphan carries no matching own receipt. Existing ordinary mutations can keep it, and explicit same-ID scheduling can replace the row. No automatic deletion or recovery is established.'},
    {model, obligation: 'Device notification delivery and installed browser concurrency',
      reason: 'Actual store and Clock logic run over controlled document, time, permission and audio ports. Browser transaction races, background sound and reviewed expiry need separate evidence.'},
  ]};
}

test('actual Reminder storage and Clock refine persisted orphan marker behavior', async () => {
  const {receipt} = await checkBrowserReminderOrphan([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.checkpoints, 70);
  assert.ok(receipt.observedFields.includes('ReceiptHasEntry'));
});
