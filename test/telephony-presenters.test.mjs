// Presentation of Phone and Messages rows and of Home's Messages and Phone cards. Pure formatting
// of rows a test supplies: no device, provider or permission is involved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
const L = await import('../apps/app/src/prototype/locale-time.ts');
const P = await import('../apps/app/src/prototype/telephony-presenters.ts');
L.setLocalePreferences({locale: 'en-US', hourCycle: 'h12'});
const now = new Date(2026, 10, 10, 9, 45).getTime();
const at = (h, m = 0, day = 10) => new Date(2026, 10, day, h, m).getTime();
const names = new Map([[P.numberKey('+14155550132'), 'Priya Nair'], [P.numberKey('6285550177'), 'Daniel Osei']]);

test('shortWhen picks the shortest label that still places the time', () => {
  assert.equal(P.shortWhen(now - 20_000, now), 'now');
  assert.equal(P.shortWhen(now - 2 * 60_000, now), '2m');
  assert.equal(P.shortWhen(at(8, 15), now), '8:15 AM');
  assert.equal(P.shortWhen(at(18, 0, 9), now), 'Mon');
  assert.equal(P.shortWhen(at(18, 0, 1), now), 'Nov 1');
  // A clock set back never yields a negative age label.
  assert.equal(P.shortWhen(now + 5 * 60_000, now), '9:50 AM');
});
test('initials, number keys and display numbers', () => {
  assert.equal(P.initials('Priya Nair'), 'PN');
  assert.equal(P.initials('Tomás'), 'T');
  assert.equal(P.initials('Marta van der Berg'), 'MB');
  assert.equal(P.initials('(510) 555-0164'), '#');
  assert.equal(P.initials(''), '#');
  assert.equal(P.numberKey('+1 (415) 555-0132'), P.numberKey('4155550132'));
  assert.notEqual(P.numberKey('+44 415 555 0132'), P.numberKey('4155550132'));
  assert.notEqual(P.numberKey('+442079460000'), P.numberKey('2079460000'));
  assert.equal(P.numberKey('Bank123'), '');
  assert.equal(P.displayNumber('+14155550132'), '(415) 555-0132');
  assert.equal(P.displayNumber('4155550132'), '(415) 555-0132');
  assert.equal(P.displayNumber('+442079460000'), '+442079460000');
  assert.equal(P.displayNumber('26889'), '26889');
  assert.equal(P.clockLength(84), '1:24');
  assert.equal(P.clockLength(-3), '0:00');
});
test('a thread is titled by contact names, falling back to the number', () => {
  assert.equal(P.threadTitle(['+14155550132'], names), 'Priya Nair');
  assert.equal(P.threadTitle(['+14155550132', '5105550164'], names), 'Priya Nair, (510) 555-0164');
  assert.equal(P.threadTitle([], names), 'Unknown');
});
test('call rows mark calls the owner did not take and withheld numbers cannot be called', () => {
  const row = P.callRow({id: '1', number: '6285550177', cachedName: 'D', date: at(9, 41), type: 'missed', isNew: true}, names, now);
  assert.deepEqual({name: row.name, ini: row.ini, missed: row.missed, out: row.out, when: row.when, canCall: row.canCall}, {name: 'Daniel Osei', ini: 'DO', missed: true, out: false, when: '4m', canCall: true});
  assert.equal(row.label, 'Call Daniel Osei, missed 4m');
  assert.equal(P.callRow({id: '2', number: '', cachedName: null, date: at(8), type: 'incoming', isNew: false}, names, now).canCall, false);
  assert.equal(P.callRow({id: '3', number: '5105550164', cachedName: 'Cached', date: at(8), type: 'outgoing', isNew: false}, names, now).name, 'Cached');
  assert.equal(P.callKind('rejected'), 'missed');
  assert.equal(P.callKind('voicemail'), 'in');
});
test('Messages card: only unread threads, newest first, two rows, and none when nothing is unread', () => {
  const threads = [
    {date: at(9, 2), snippet: 'Your code is 418 207', unread: true, addresses: ['26889']},
    {date: at(8), snippet: 'read already', unread: false, addresses: ['5105550164']},
    {date: at(9, 43), snippet: 'Are we still on for 7?', unread: true, addresses: ['+14155550132']},
    {date: at(7), snippet: 'older', unread: true, addresses: ['6285550177']},
  ];
  assert.deepEqual(P.messagesCard(threads, names, now), {count: '3', status: '2m', label: 'Open Messages, 3 unread',
    rows: [{title: 'Priya Nair', detail: 'Are we still on for 7?'}, {title: '26889', detail: 'Your code is 418 207'}]});
  assert.equal(P.messagesCard(threads.filter(thread => !thread.unread), names, now), null);
  assert.equal(P.messagesCard([], names, now), null);
});
test('Phone card: new missed calls grouped by caller with new voicemail, and where it leads', () => {
  const calls = [
    {number: '6285550177', cachedName: null, date: at(9, 41), type: 'missed', isNew: true},
    {number: '+16285550177', cachedName: null, date: at(9, 38), type: 'missed', isNew: true},
    {number: '5105550164', cachedName: null, date: at(8), type: 'missed', isNew: false},
    {number: '+14155550132', cachedName: null, date: at(8, 15), type: 'outgoing', isNew: true},
  ];
  const voicemail = [{number: '5105550199', cachedName: 'Marta Lindqvist', date: at(9, 12), durationSeconds: 24, isNew: true},
    {number: '5105550164', cachedName: null, date: at(7), durationSeconds: 9, isNew: false}];
  assert.deepEqual(P.phoneCard(calls, voicemail, names, now), {count: '3', status: '4m', label: 'Open Phone, 2 missed calls, 1 voicemail',
    rows: [{title: 'Daniel Osei', detail: 'Missed · 2'}, {title: 'Marta Lindqvist', detail: 'Voicemail · 0:24'}]});
  assert.deepEqual(P.phoneCard([], voicemail, names, now).rows, [{title: 'Marta Lindqvist', detail: 'Voicemail · 0:24'}]);
  assert.equal(P.phoneCard(calls.filter(call => !call.isNew || call.type !== 'missed'), [], names, now), null);
  assert.equal(P.phoneCardTarget(2), 'recents');
  assert.equal(P.phoneCardTarget(0), 'voicemail');
});
test('two withheld missed calls are not merged into one caller', () => {
  const card = P.phoneCard([{number: '', cachedName: null, date: at(9), type: 'missed', isNew: true}, {number: '', cachedName: null, date: at(8), type: 'missed', isNew: true}], [], names, now);
  assert.deepEqual(card.rows, [{title: 'Unknown', detail: 'Missed'}, {title: 'Unknown', detail: 'Missed'}]);
  assert.equal(card.count, '2');
});
