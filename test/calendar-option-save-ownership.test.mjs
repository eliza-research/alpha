import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCalendarAdapter, calendarAdapterFixture} from '../specs/quint/refinement/application/calendar-adapter-fixture.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

let compiled;
test.before(async () => { compiled = await buildCalendarAdapter(); });

async function fixture() {
  const f = calendarAdapterFixture(compiled);
  const journal = new Map(), events = [], committed = [];
  const shell = new f.Shell();
  shell.calendarFormCommitted = form => committed.push(form);
  let providerWrite;
  Object.assign(f.handlers, {
    list: () => ({status: 'ready', calendars: [{id: 'local', local: true, writable: true}], events}),
    requestAccess: () => ({status: 'granted'}),
    prepareAgentSource: () => ({status: 'unavailable'}),
    pendingCreations: () => ({status: 'ready', creations: [...journal.values()]}),
    saveOptions: args => {
      assert.equal(providerWrite, undefined, 'A recovery never repeats the provider insert');
      providerWrite = args;
      const eventId = 'options-event';
      const receipt = {status: 'saved', id: eventId, creationId: args.creationId};
      journal.set(args.creationId, receipt);
      events.push({...args.event, calendarId: args.calendarId, id: eventId});
      return receipt;
    },
    readOptions: ({id}) => {
      const {allDay, timeZone, rrule} = events.find(event => event.id === id);
      return {status: 'ready', allDay, timeZone, rrule};
    },
    acknowledgeCreation: ({creationId}) => {
      assert.equal(journal.get(creationId)?.status, 'saved', 'The acknowledgement must name the exact receipt');
      journal.delete(creationId);
      return {status: 'acknowledged'};
    },
  });
  const newDraft = async (title, allDay = false) => {
    await f.render().newEvent();
    const form = {...f.calendar.form, title, allDay};
    f.api.set({form});
    return form;
  };
  shell.componentDidMount();
  await f.idle();
  const submit = () => f.render().f.save();
  const close = async () => { shell.componentWillUnmount(); await f.idle(); };
  return {...f, committed, journal, newDraft, submit, close};
}

const options = {timeout: scaledTimeout(20000)};

test('a held options readback cannot consume a newer draft or acknowledge the retired save', options, async () => {
  const f = await fixture();
  try {
    const first = await f.newDraft('Earlier fixture', true);
    f.hold('readOptions');
    const submitting = f.submit();
    await f.idle();
    assert.equal(f.waiting('readOptions'), 1);
    assert.equal(f.journal.has(first.creationId), true);
    const later = await f.newDraft('Current fixture');
    await f.settle('readOptions');
    await submitting;

    assert.equal(f.calendar.form, later, 'The current form must survive a matching old readback');
    assert.deepEqual(f.committed, []);
    assert.equal(f.count('acknowledgeCreation'), 0);
    assert.equal(f.journal.has(first.creationId), true);
    assert.equal(f.toasts.includes('Saved'), false);

    await f.render().checkCreations();
    assert.equal(f.count('acknowledgeCreation'), 1);
    assert.equal(f.journal.size, 0);
    assert.equal(f.count('saveOptions'), 1);
    assert.equal(f.calendar.form, later);
  } finally {
    await f.close();
  }
});

test('an options acknowledgement may settle after a new draft without refreshing or announcing the past save', options, async () => {
  const f = await fixture();
  try {
    const first = await f.newDraft('Earlier fixture', true);
    f.hold('acknowledgeCreation');
    const submitting = f.submit();
    await f.idle();
    assert.equal(f.waiting('acknowledgeCreation'), 1);
    assert.deepEqual(f.committed, [first]);
    assert.equal(f.calendar.form, null);
    const beforeList = f.count('list');
    const later = await f.newDraft('Current fixture');

    await f.settle('acknowledgeCreation');
    await submitting;
    assert.equal(f.journal.size, 0, 'Already-dispatched acknowledgement remains owned by its receipt');
    assert.equal(f.count('list'), beforeList);
    assert.equal(f.calendar.form, later);
    assert.equal(f.calendar.open, null);
    assert.equal(f.toasts.includes('Saved'), false);
  } finally {
    await f.close();
  }
});

test('a held post-save options refresh cannot navigate or announce after a newer draft takes over', options, async () => {
  const f = await fixture();
  try {
    const first = await f.newDraft('Earlier fixture', true);
    f.hold('list');
    const submitting = f.submit();
    await f.idle();
    assert.equal(f.waiting('list'), 1);
    assert.deepEqual(f.committed, [first]);
    assert.equal(f.journal.size, 0);
    const later = await f.newDraft('Current fixture');

    await f.settle('list');
    await submitting;
    assert.equal(f.calendar.form, later);
    assert.equal(f.calendar.open, null);
    assert.equal(f.toasts.includes('Saved'), false);
  } finally {
    await f.close();
  }
});

test('the current option editor still commits, acknowledges, and opens its saved event', options, async () => {
  const f = await fixture();
  try {
    const current = await f.newDraft('Current fixture', true);
    await f.submit();
    assert.deepEqual(f.committed, [current]);
    assert.equal(f.journal.size, 0);
    assert.equal(f.count('saveOptions'), 1);
    assert.equal(f.count('acknowledgeCreation'), 1);
    assert.equal(f.calendar.form, null);
    assert.equal(f.calendar.events.find(event => event.id === f.calendar.open)?.alphaCalendarId, 'options-event');
    assert.equal(f.toasts.filter(value => value === 'Saved').length, 1);
  } finally {
    await f.close();
  }
});
