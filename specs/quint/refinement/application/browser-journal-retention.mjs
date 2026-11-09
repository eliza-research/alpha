import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {action, sourceModule} from '../services/support.mjs';

const model = 'BrowserJournalRetention';
const browser = 'apps/app/src/browser/';
const contracts = '.eliza/client-features/';
const retention = browser + 'journal-retention.ts';
const fixture = 'test/fixtures/browser-daily-stores.mjs';
const sources = [fileURLToPath(import.meta.url), fixture, 'specs/quint/refinement/services/support.mjs', retention,
  ...['calendar.ts', 'daily.ts', 'calendar-store.ts', 'reminder-store.ts', 'domain-document.ts',
    'calendar-deletions.ts', 'reminder-deletions.ts'].map(name => browser + name),
  contracts + 'packages/contracts/src/deletion-window.ts',
  ...['calendar-contract.ts', 'reminder-contract.ts'].map(name => contracts + 'plugins/plugin-assistant/src/services/device-actions/' + name)];
const wall = Date.UTC(2030, 0, 1, 9), day = 86400000, age = 30 * day, hour = 3600000;
const terminal = ['deleted', 'undone', 'conflict'];
const phases = ['queued', 'paused', 'dispatching', 'unknown', 'permission-required', 'owner-changed'];
const list = count => Array.from({length: count}, (_, index) => index);
const row = (definite, at) => ({acknowledged: definite, ...(at === undefined ? {} : {at})});
const deletion = (id, phase, createdElapsed) => ({id, phase, deadline: {createdElapsed}});

function recorder(name, initial, {creation = false} = {}) {
  const ids = new Map();
  const id = key => {
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    return ids.get(key);
  };
  const observe = (data, now = wall) => {
    const receipts = Object.entries((creation ? data.creations : data.receipts) ?? {}).map(([key, value]) => ({
      id: id(key), at: value.at ?? 0, dated: value.at !== undefined, definite: creation ? value.acknowledged : true,
    }));
    const deletions = Object.entries(data.deletions ?? {}).map(([key, value]) => {
      assert.equal(key, value.id);
      return {id: id(key), elapsed: value.deadline.createdElapsed, phase: value.phase};
    });
    return {'s.receipts': receipts, 's.deletions': deletions, 's.claims': qset(Object.keys(data.deleteClaims ?? {}).map(id)), 's.now': now};
  };
  const expect = observe(initial);
  const trace = {name, init: action('initFor', expect['s.receipts'], expect['s.deletions'], expect['s.claims']), expect, steps: []};
  const record = (label, action, data, now) => trace.steps.push({label, action, expect: observe(data, now)});
  return {trace, record, id};
}

function directTraces({retireJournal, trimDeletionJournal}) {
  const traces = [];
  const creationTrace = (name, creations) => {
    const data = {creations};
    const trace = recorder(name, data, {creation: true});
    retireJournal(data.creations, row => row.acknowledged, wall);
    trace.record('actual receipt retention', action('retireReceipts'), data);
    traces.push(trace.trace);
    return {data, ...trace};
  };
  for (const count of [199, 200, 201]) {
    // Reverse names make accidental lexical sorting at the equal timestamp visible.
    const keys = list(count).map(index => `legacy-${count - index}`);
    const creations = Object.fromEntries(keys.map(key => [key, row(true)]));
    const {data} = creationTrace(`exact receipt count ${count} with stable legacy order`, creations);
    assert.deepEqual(Object.keys(data.creations), keys.slice(Math.max(0, count - 200)));
    assert.ok(Object.values(data.creations).every(value => !Object.hasOwn(value, 'at')));
  }
  {
    const creations = Object.fromEntries(list(200).map(index => [`legacy-${index}`, row(true)]));
    creations.expired = row(true, wall - age - 1);
    const {data} = creationTrace('age and count remove different entries from the same cohort', creations);
    assert.equal(Object.keys(data.creations).length, 199);
    assert.equal(Object.hasOwn(data.creations, 'legacy-0'), false);
    assert.equal(Object.hasOwn(data.creations, 'expired'), false);
  }
  {
    const creations = Object.fromEntries(list(199).map(index => [`legacy-${index}`, row(true)]));
    creations.zero = row(true, 0);
    creations.newer = row(true, wall);
    const {data} = creationTrace('dated zero ties in ordering but remains subject to age', creations);
    assert.equal(Object.keys(data.creations).length, 199);
    assert.equal(Object.hasOwn(data.creations, 'legacy-0'), false);
    assert.equal(Object.hasOwn(data.creations, 'zero'), false);
  }
  {
    const {data, record} = creationTrace('strict thirty days and pending older rows', {
      expired: row(true, wall - age - 1), boundary: row(true, wall - age), inside: row(true, wall - age + 1),
      pending: row(false, wall - age - 1), legacy: row(true), future: row(true, wall + 1),
    });
    assert.deepEqual(Object.keys(data.creations), ['boundary', 'inside', 'pending', 'legacy', 'future']);
    record('one millisecond crosses the boundary', action('advanceClock'), data, wall + 1);
    retireJournal(data.creations, row => row.acknowledged, wall + 1);
    record('actual subsequent retention now removes the boundary row', action('retireReceipts'), data, wall + 1);
    assert.deepEqual(Object.keys(data.creations), ['inside', 'pending', 'legacy', 'future']);
  }
  for (const [count, tied] of [[126, false], [127, false], [128, false], [128, true]]) {
    const terminalKeys = list(count).map(index => index === 1 ? 'constructor' : `settled-${count - index}`);
    const pendingKeys = phases.map(phase => `pending-${phase}`);
    const deletions = Object.fromEntries([
      ...terminalKeys.map((key, index) => [key, deletion(key, terminal[index % terminal.length], !tied && index === 1 ? 0 : 1)]),
      ...pendingKeys.map((key, index) => [key, deletion(key, phases[index], 0)]),
    ]);
    const data = {deletions, deleteClaims: Object.fromEntries([...terminalKeys, ...pendingKeys, 'missing', 'toString', '__proto__'].map(key => [key, 'review']))};
    const trace = recorder(`exact settled deletion count ${count}, ${tied ? 'tied order' : 'elapsed order'} and dangling claims`, data);
    trimDeletionJournal(data);
    trace.record('actual terminal eviction and own-claim intersection', action('trimDeletions'), data);
    const evicted = count < 128 ? null : tied ? terminalKeys[0] : 'constructor';
    const kept = [...terminalKeys.filter(key => key !== evicted), ...pendingKeys];
    assert.deepEqual(Object.keys(data.deletions), kept);
    assert.deepEqual(Object.keys(data.deleteClaims), kept);
    traces.push(trace.trace);
  }
  {
    const data = {deleteClaims: Object.fromEntries(['missing', 'constructor'].map(key => [key, 'review']))};
    const trace = recorder('legacy document missing both journal maps', data);
    retireJournal(undefined, () => true, wall);
    trace.record('absent receipts are unchanged', action('retireReceipts'), data);
    trimDeletionJournal(data);
    trace.record('no deletion map means every own replay claim is dangling', action('trimDeletions'), data);
    assert.deepEqual(data.deleteClaims, {});
    traces.push(trace.trace);
  }
  return traces;
}

const read = async store => JSON.parse(await store.readRaw());
const sourceRevision = 'a'.repeat(64), revision = 'b'.repeat(64);
const calendarInput = creationId => ({creationId, separateCreation: true, calendarId: 'local',
  title: 'Reviewed event', begin: wall + day, end: wall + day + hour});
const calendarRow = {id: 'reviewed', calendarId: 'local', title: 'Reviewed event', body: '', location: '',
  begin: wall + day, end: wall + day + hour, revision, timeZone: 'UTC', repeat: 'none'};
const initialCalendar = () => ({sourceRevision, events: []});
const initialReminder = () => ({sourceRevision, reminders: []});

async function calendarCreationTrace(modules, resetDocuments) {
  const {documents} = resetDocuments();
  const {BrowserCalendar, calendarDocument: store} = modules, calendar = new BrowserCalendar();
  const pendingId = '00000000-0000-4000-8000-000000000001';
  const firstId = '00000000-0000-4000-8000-000000000002';
  const nextId = '00000000-0000-4000-8000-000000000003';
  await store.edit(initialCalendar, data => {
    data.creations = Object.fromEntries(list(201).map(index => [`legacy-${index}`, row(true)]));
    data.creations[pendingId] = {...row(false, wall - age - 1), result: {status: 'saved', id: 'earlier', calendarId: 'local', creationId: pendingId}};
  });
  const trace = recorder('Calendar trims acknowledged rows before saving and keeps pending creation', await read(store), {creation: true});
  assert.equal((await calendar.save(calendarInput(firstId))).status, 'saved');
  const after = await read(store);
  trace.record('Calendar save trims and appends an unacknowledged receipt', [action('retireReceipts'), action('appendReceipt', trace.id(firstId), false)], after);
  assert.equal(Object.values(after.creations).filter(value => value.acknowledged).length, 200);
  assert.equal(Object.hasOwn(after.creations, pendingId), true);
  const writes = documents.writes, inherited = Object.getOwnPropertyDescriptor(Object.prototype, 'acknowledged');
  try {
    await assert.rejects(calendar.acknowledgeCreation({creationId: '__proto__'}), /Creation receipt unavailable/);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'acknowledged'), inherited);
    assert.equal(documents.writes, writes);
  } finally {
    if (inherited) Object.defineProperty(Object.prototype, 'acknowledged', inherited);
    else delete Object.prototype.acknowledged;
  }
  trace.record('an inherited key cannot acknowledge an absent creation', {...action('acknowledge', trace.id('__proto__')), reject: true}, await read(store));
  assert.equal((await calendar.acknowledgeCreation({creationId: pendingId})).status, 'acknowledged');
  trace.record('acknowledgement changes definiteness without changing its original date', action('acknowledge', trace.id(pendingId)), await read(store));
  assert.equal((await calendar.save(calendarInput(nextId))).status, 'saved');
  const last = await read(store);
  trace.record('next actual save retires the newly definite expired creation', [action('retireReceipts'), action('appendReceipt', trace.id(nextId), false)], last);
  assert.equal(Object.hasOwn(last.creations, pendingId), false);
  assert.equal(Object.hasOwn(last.creations, firstId), true);
  return trace.trace;
}

async function reminderReceiptTrace(modules, resetDocuments) {
  const {documents} = resetDocuments(), {BrowserDaily, reminderDocument: store} = modules;
  const daily = new BrowserDaily({}), id = '__proto__';
  await daily.scheduleReminder({id: 'reviewed', title: 'Reviewed reminder', at: wall + day});
  await store.edit(initialReminder, data => {data.receipts = Object.fromEntries(list(200).map(index => [`legacy-${index}`, {binding: 'older', result: {}}]));});
  const trace = recorder('Reminder can append the 201st definite receipt for a prototype-shaped identity', await read(store));
  const request = {operationId: id, bindingHash: revision,
    operation: {type: 'reminder_update', target: await daily.selectedReminder({id: 'reviewed'}), fields: {title: 'Updated reminder', body: ''}}};
  assert.equal((await daily.operateReminder(request)).status, 'succeeded');
  const after = await read(store);
  trace.record('Reminder mutation trims before appending its timed receipt', [action('retireReceipts'), action('appendReceipt', trace.id(id), true)], after);
  assert.equal(Object.keys(after.receipts).length, 201);
  assert.equal(Object.hasOwn(after.receipts, id), true);
  const writes = documents.writes;
  assert.equal((await daily.reminderOperationReceipt(request)).status, 'succeeded');
  assert.equal(documents.writes, writes);
  trace.record('receipt recovery reads without evicting or adding rows', null, await read(store));
  return trace.trace;
}

async function calendarAgentReceiptTrace(modules, resetDocuments) {
  const {documents} = resetDocuments(), {BrowserCalendar, calendarDocument: store} = modules, calendar = new BrowserCalendar();
  await store.edit(initialCalendar, data => {data.receipts = {earlier: {binding: 'legacy', result: {}}};});
  const trace = recorder('Calendar agent receipt persists an own prototype-shaped identity', await read(store));
  const id = '__proto__', request = {operationId: id, operation: {type: 'calendar_create', source: {sourceId: 'local', sourceRevision},
    fields: {title: 'Reviewed event', description: '', location: '', start: new Date(wall + day).toISOString(),
      end: new Date(wall + day + hour).toISOString(), timeZone: 'UTC'}}};
  const response = await calendar.executeAgent(request), after = await read(store);
  assert.equal(response.status, 'applied');
  assert.equal(Object.hasOwn(after.receipts, id), true);
  trace.record('Calendar persists the result by exact operation key', [action('retireReceipts'), action('appendReceipt', trace.id(id), true)], after);
  const writes = documents.writes;
  assert.deepEqual(await calendar.executeAgent(request), response);
  assert.equal(documents.writes, writes);
  trace.record('receipt replay returns the original result without a second create', null, await read(store));
  return trace.trace;
}

async function deletionStageTrace(modules, resetDocuments, kind) {
  const {documents} = resetDocuments();
  const calendar = kind === 'Calendar';
  const store = calendar ? modules.calendarDocument : modules.reminderDocument;
  const client = calendar ? new modules.BrowserCalendar() : new modules.BrowserDaily({});
  if (!calendar) await client.scheduleReminder({id: 'reviewed', title: 'Reviewed reminder', at: wall + day});
  await store.edit(calendar ? initialCalendar : initialReminder, data => {
    if (calendar) data.events.push(calendarRow);
    const rows = list(128).map(index => {
      const key = index === 0 ? 'constructor' : `previous-${index}`;
      return [key, deletion(key, terminal[index % terminal.length], 1)];
    });
    rows.push(['unknown-owner', deletion('unknown-owner', 'unknown', 0)]);
    data.deletions = Object.fromEntries(rows);
    data.deleteClaims = Object.fromEntries(['constructor', 'unknown-owner', 'previous-127', 'toString'].map(key => [key, 'prior-review']));
  });
  const trace = recorder(`${kind} staging trims settled history and preserves a retained replay claim`, await read(store));
  const id = '__proto__', journalIdentity = {scope: 'fixture-scope', proposalId: 'fixture-proposal'};
  const request = {operationId: id, operation: {type: 'calendar_delete', target: {sourceId: 'local', sourceRevision, eventId: calendarRow.id, revision}}, journalIdentity};
  const target = calendar ? null : await client.selectedReminder({id: 'reviewed'});
  const stage = () => calendar ? client.executeAgent(request) : client.stageDeletion(target, 'agent:test', id, 'review-binding');
  const outcome = await stage(), staged = calendar ? outcome.deletion : outcome;
  assert.equal(staged.phase, 'queued');
  const after = await read(store);
  trace.record('actual stage retires settled rows and adds the paired queued claim',
    [action('trimDeletions'), action('appendDeletion', trace.id(id), staged.deadline.createdElapsed, true)], after);
  assert.deepEqual(Object.keys(after.deleteClaims), ['unknown-owner', 'previous-127', id]);
  assert.equal(Object.hasOwn(after.deletions, id), true);
  assert.equal(Object.values(after.deletions).filter(value => terminal.includes(value.phase)).length, 127);
  const writes = documents.writes;
  if (calendar) assert.deepEqual(await stage(), {status: 'unknown'});
  else await assert.rejects(stage, /already used/);
  assert.equal(documents.writes, writes);
  trace.record('the kept operation identity prevents a repeated dispatch', null, await read(store));
  return trace.trace;
}

export async function checkBrowserJournalRetention(extraSources = []) {
  const inputs = [...sources, ...extraSources], driverHashes = captureInputs(inputs);
  const helpers = await sourceModule(retention);
  const traces = directTraces(helpers);
  const globalNames = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'CustomEvent',
    'localStorage', 'getComputedStyle', 'BroadcastChannel', '__alphaTest'];
  const globals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const date = Object.getOwnPropertyDescriptor(Date, 'now'), elapsed = Object.getOwnPropertyDescriptor(performance, 'now');
  try {
    const {modules, resetDocuments, installBrowserDailyFixtures} = await import('../../../../test/fixtures/browser-daily-stores.mjs');
    installBrowserDailyFixtures?.();
    Object.defineProperty(Date, 'now', {...date, value: () => wall});
    Object.defineProperty(performance, 'now', {configurable: true, value: () => 3});
    traces.push(await calendarCreationTrace(modules, resetDocuments));
    traces.push(await calendarAgentReceiptTrace(modules, resetDocuments));
    traces.push(await reminderReceiptTrace(modules, resetDocuments));
    for (const kind of ['Calendar', 'Reminder']) traces.push(await deletionStageTrace(modules, resetDocuments, kind));
  } finally {
    Object.defineProperty(Date, 'now', date);
    if (elapsed) Object.defineProperty(performance, 'now', elapsed);
    else delete performance.now;
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  const receipt = await checkTraces({model, traces, sources: inputs, driverHashes, batchSize: 3, scope: 'bounded-orchestration', assumptions: [
    'Exact receipt and terminal cutoff neighborhoods use ordered concrete entries. Opaque IDs preserve Object.entries identity and enumeration order; explicit clock values preserve age and elapsed comparisons.',
    'Real retain/trim functions execute directly. Real BrowserCalendar, BrowserDaily and BrowserDomainDocument also execute over a controlled document/review/notification port; source binding covers the journal owner files, selected contracts and fixture.',
    'The write checkpoints combine trim and append where the caller commits them together. Deletion settlement, polling, actual providers, malformed documents and arbitrary browser transaction schedules are separate obligations.',
  ]});
  return {receipt, obligations: [
    {model, obligation: 'Arbitrary input histories and installed document concurrency',
      reason: 'The model binds fixed timestamp classes and concrete cutoff neighborhoods. Real Web Locks/IndexedDB, corruption, replay across journal loss and settlement are separate projections.'},
    {model, obligation: 'Review recovery of legacy orphaned Reminder markers',
      reason: 'An older build could persist a prototype-shaped pendingDeletion marker without a deletion record. New writes persist both, but previously orphaned markers require an explicit reviewed recovery path.'},
  ]};
}
