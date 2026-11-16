import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureReplayClosure} from '../observed-replay.mjs';
import {checkTraces} from '../check-traces.mjs';
import {buildCalendarAdapter, calendarAdapterFixture} from './calendar-adapter-fixture.mjs';

const call = (name, ...args) => ({name, args});

async function replay(compiled, retirement) {
  const f = calendarAdapterFixture(compiled);
  const journal = new Map();
  const provider = [{id: 'fixture-event', calendarId: 'local', title: 'Existing fixture event',
    begin: new Date(2027, 0, 15, 15).getTime(), end: new Date(2027, 0, 15, 16).getTime()}];
  Object.assign(f.handlers, {
    list: () => ({status: 'ready', calendars: [{id: 'local', local: true, writable: true}], events: provider}),
    requestAccess: () => ({status: 'granted'}),
    prepareAgentSource: () => ({status: 'unavailable'}),
    pendingCreations: () => ({status: 'ready', creations: [...journal.values()]}),
    acknowledgeCreation: ({creationId}) => {
      assert.equal(journal.get(creationId)?.status, 'saved', 'Only the exact saved receipt may be acknowledged');
      journal.delete(creationId);
      return {status: 'acknowledged'};
    },
  });
  const preserve = ({creationId, calendarId, title, begin, end}) => {
    assert.ok(creationId);
    assert.equal(journal.size, 0, 'No duplicate write is admitted');
    const row = {id: 'new-fixture-event', calendarId, title, begin, end};
    const receipt = {status: 'saved', creationId, id: row.id};
    journal.set(creationId, receipt);
    provider.push(row);
    return receipt;
  };
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  const observe = () => {
    const view = f.render();
    return {
      's.form': f.calendar.form ? 'new' : 'none',
      's.saving': !!shell.calendarSaving,
      's.draftEpoch': f.probe.creations().draftEpoch,
      's.pendingShown': !!view.creationRecovery,
      's.recoveryFailed': !!f.probe.creations().failed,
      's.savedReceipts': journal.size,
      's.events': provider.length,
    };
  };
  const trace = {name: retirement, expect: observe(), steps: []};
  const record = (label, action) => trace.steps.push({label, action, expect: observe()});
  const openDraft = async () => {
    await f.render().newEvent();
    f.api.set({form: {...f.calendar.form, title: 'Synthetic draft'}});
  };
  const begin = async () => {
    f.hold('pendingCreations');
    const submitted = f.render().f.save();
    await f.idle();
    assert.equal(f.waiting('pendingCreations'), 1, 'The actual save must reach its receipt read');
    return {submitted};
  };

  try {
    await openDraft();
    record('Open the first draft', call('newForm', false));
    const first = await begin();
    record('First save waits on the journal', call('startSave'));
    f.hold('save');
    await f.settle('pendingCreations');
    assert.equal(f.waiting('save'), 1, 'The first write passed the empty journal');
    record('Empty journal admits the first provider write', call('readReceipts', true));

    // A real write can finish after its editor has moved on. This leaves a saved
    // receipt in the synthetic native journal with no published recovery notice.
    await openDraft();
    const secondDraft = f.calendar.form;
    record('New editor overtakes the dispatched write', call('newForm', false));
    await f.settle('save', preserve);
    await first.submitted;
    assert.equal(f.calendar.form, secondDraft);
    assert.equal(f.count('acknowledgeCreation'), 0);
    assert.equal(f.render().creationRecovery, false);
    record('The old write leaves an unacknowledged receipt', call('createSaved'));

    const second = await begin();
    record('The second save waits on the saved receipt', call('startSave'));
    if (retirement === 'new-draft') {
      await openDraft();
      record('New event advances the adapter draft epoch', call('newForm', false));
    } else if (retirement === 'replaced-form') {
      const original = f.calendar.form;
      f.render().f.toggleAllDay();
      assert.notEqual(f.calendar.form, original, 'The editor replaced the form object');
      assert.equal(f.calendar.form.creationId, original.creationId, 'The edit kept the draft identity');
      record('A field update only retires the submitted form object', call('replaceForm'));
    } else {
      // Shell close supplies a null form. The adapter never receives a new-event intent.
      f.api.set({form: null});
      record('Close retires the submitted form identity', call('closeForm'));
    }
    const currentForm = f.calendar.form;
    await f.settle('pendingCreations');
    await second.submitted;
    assert.equal(f.calendar.form, currentForm, 'A stale save cannot replace the current editor');
    assert.equal(f.count('save'), 1, 'The stale save never dispatches a provider write');
    assert.equal(f.count('acknowledgeCreation'), 0, 'A stale save does not acknowledge another receipt');
    assert.equal(f.render().creationRecovery, retirement !== 'new-draft');
    record('The native reply settles without reviving the retired save', call('readReceipts', true));

    await f.render().checkCreations();
    assert.equal(f.count('acknowledgeCreation'), 1, 'An explicit current recovery acknowledges once');
    assert.equal(f.count('save'), 1, 'Receipt recovery never initiates another write');
    assert.equal(f.render().creationRecovery, false);
    record('Current recovery acknowledges exactly the saved receipt', call('checkCreations', true));
    return trace;
  } finally {
    shell.componentWillUnmount();
    await f.idle();
  }
}

export async function checkCalendarDeviceWrites(owner) {
  const driverHashes = captureReplayClosure([fileURLToPath(import.meta.url), owner]);
  const compiled = await buildCalendarAdapter();
  const sources = compiled.sources.filter(path => path !== '<stdin>');
  const traces = [];
  for (const retirement of ['new-draft', 'closed-form', 'replaced-form']) traces.push(await replay(compiled, retirement));
  return checkTraces({model: 'CalendarDeviceWrites', id: 'CalendarDeviceWrites-draft-ownership',
    traces, sources: [...sources, fileURLToPath(import.meta.url), owner], driverHashes, scope: 'bounded-component',
    assumptions: [
      'The existing Calendar shell fixture bundles the whole product adapter. The host calendar store, permissions, native receipt transitions, and shell state are controlled synthetic ports.',
      'The scoped replay covers ordinary event creation and current recovery across replacing a field, closing the editor, or opening a new draft. CalendarProvider, options writes, edit/delete, and Android owner authentication are separate evidence.',
    ]});
}
