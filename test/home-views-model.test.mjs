import {test} from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../apps/app/src/prototype/home-cards.ts');

// Values built inside a vm context have that context's prototypes: compare them as plain data.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);

test('Home agenda: the shared selection, made again only when the inputs change or an item ends', () => {
  const at = (hour, day = 7) => new Date(2026, 9, day, hour).getTime(), now = at(12);
  const events = [
    {id: 'late', title: 'Late', nativeEvent: {begin: at(18), end: at(19)}},
    {id: 'past', title: 'Past', nativeEvent: {begin: at(8), end: at(9)}},
    {id: 'running', title: 'Running', nativeEvent: {begin: at(11), end: at(13)}},
    {id: 'app', title: 'App calendar', alphaCalendarId: 'local', nativeEvent: {begin: at(11, 7) + 60000, end: at(14)}},
    {id: 'done', title: 'Done', reminderStatus: 'completed', reminderAt: at(15)},
    {id: 'remind', title: 'Remind', alphaReminderId: 'r1', reminderAt: at(16)},
    {id: 'allday', title: 'All day', nativeEvent: {allDay: true, begin: Date.UTC(2026, 9, 8), end: Date.UTC(2026, 9, 9)}},
    {id: 'broken', title: 'Broken', nativeEvent: {begin: NaN, end: NaN}},
  ];
  const overdue = [{id: 'o1', title: 'Pay rent', at: at(10), off: 0}];
  // The card's choice stated directly: the shared selection over freshly built candidates.
  const fresh = (list, rows, shown, when) => { const pick = H.selectHomeAgenda(H.homeAgendaCandidates(list, rows, shown), when); return [pick.agenda?.item.id, pick.following?.item.id]; };
  const ids = pick => [pick.agenda?.event.id, pick.following?.event.id];
  const agenda = H.createHomeAgenda();
  const first = agenda({events, overdue: [], calendarShown: true, now});
  same(ids(first), ['running', undefined]);
  assert.equal(first.agenda.event, events[2], 'the host record is returned unchanged');
  assert.equal(first.agenda.item, events[2]);
  // Same inputs and no item ended: the same choice object, nothing rebuilt.
  assert.equal(agenda({events, overdue: [], calendarShown: true, now: now + 1000}), first);
  assert.equal(agenda({events, overdue: [], calendarShown: true, now: at(13) - 1}), first);
  // Every instant gives the shared selection's answer, across each item's end and a clock set back.
  for (const when of [at(13), at(13) + 1, at(14), at(14) + 1, at(15), at(16), at(16) + 1, at(19) + 1, at(12), at(8), at(23, 8), at(0, 9), at(1, 9)]) {
    same(ids(agenda({events, overdue: [], calendarShown: true, now: when})), fresh(events, [], true, when), String(new Date(when)));
  }
  assert.equal(agenda({events, overdue: [], calendarShown: true, now: at(13)}).agenda.event.id, 'running', 'an event is shown through its end');
  assert.equal(agenda({events, overdue: [], calendarShown: true, now: at(13) + 1}).agenda.event.id, 'app');
  // A hidden or unread app calendar leaves its events out; reminders stay.
  same(ids(agenda({events, overdue: [], calendarShown: false, now: at(13) + 1})), ['remind', undefined]);
  // An overdue reminder is first; the next item that is not overdue follows it.
  const due = agenda({events, overdue, calendarShown: true, now});
  same([...ids(due), due.agenda.event.overdue], ['o1', 'running', true]);
  same(ids(due), fresh(events, overdue, true, now));
  assert.equal(agenda({events, overdue: overdue.map(row => ({...row})), calendarShown: true, now}), due, 'equal overdue rows in a new array reuse the choice');
  assert.notEqual(agenda({events, overdue: [{...overdue[0], title: 'Pay the rent'}], calendarShown: true, now}), due);
  // A new event list is read again.
  same(ids(agenda({events: events.slice(0, 2), overdue: [], calendarShown: true, now})), ['late', undefined]);
  same(ids(agenda({events: [], overdue: [], calendarShown: true, now})), [undefined, undefined]);
  // An all-day event sits at local midnight of its UTC date.
  const allDay = H.homeAgendaCandidates([events[6]], [], true)[0];
  same([allDay.begin, allDay.end, allDay.allDay], [new Date(2026, 9, 8).getTime(), new Date(2026, 9, 9).getTime(), true]);

});

test('the storage access probe runs at most once per interval, not on every render', () => {
  let now = 0, probes = 0, blocked = false;
  const check = H.createStorageAccessCheck(() => { probes++; if (blocked) throw new Error('blocked'); }, 5000, () => now);
  for (let index = 0; index < 200; index++) { now += 10; assert.equal(check(), true); }
  assert.equal(probes, 1);
  blocked = true; now = 5010;
  assert.equal(check(), false);
  assert.equal(check(), false);
  assert.equal(probes, 2);
  blocked = false; now += 5000;
  assert.equal(check(), true);
  assert.equal(probes, 3);
  // A clock that moved backwards does not freeze an old answer.
  blocked = true; now = 100;
  assert.equal(check(), false);
});
