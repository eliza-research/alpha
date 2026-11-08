// Back-reference from a saved reminder or event to the voice note its draft came from, and the
// Maps "Back to event" identity. Pure rules; the rendered flows are in test/browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {addNoteOrigin, findNoteOrigin, noteOriginFor, noteOriginTitle, noteOriginIndex, noteOriginKey, noteOriginLimit, noteOriginOf, recordNoteRevision, removeNoteOrigin, resolveNoteLink, resolveNoteOrigin, voiceNoteChanged, voiceNoteContentRevision} from '../apps/app/src/runtime/note-origin.ts';
import {recordingRevision} from '../apps/app/src/prototype/summary-source.ts';
import {mapsEventOriginFor, mapsEventOriginOf, mapsEventReturnOffered, mapsEventStillThere} from '../apps/app/src/runtime/maps-event-return.ts';
import {encodeCalendarForm, decodeCalendarForm, calendarEditFields, snapshotCalendarForm} from '../apps/app/src/runtime/calendar-form-draft.ts';

const revision = 'a'.repeat(64);
const note = {id: 'n1', kind: 'voice', title: 'Venue meeting', body: 'Transcript', audio: {audioId: 'audio-1'}};
const origin = noteOriginFor(note, revision);
const empty = () => noteOriginIndex(null);

test('an origin is the note id, its recording and the reviewed revision only; the title is never stored', () => {
  assert.deepEqual(origin, {version: 1, noteId: 'n1', audioId: 'audio-1', revision});
  assert.equal(JSON.stringify(origin).includes('Venue meeting'), false, 'the note title is note content and is not carried');
  assert.equal(noteOriginTitle(note), 'Venue meeting');
  assert.equal(noteOriginTitle({...note, title: 'Renamed later'}), 'Renamed later', 'the shown title is the current one');
  assert.equal(noteOriginTitle({...note, title: ''}), 'Voice note');
  assert.equal(noteOriginTitle({...note, title: 'Line\nbreak'}), 'Line break');
  assert.equal(noteOriginTitle({...note, title: 'x'.repeat(300)}).length, 120);
  assert.equal(noteOriginFor({id: 'n1', title: 'Text note'}, revision), undefined, 'a note without a recording has no origin');
  assert.equal(noteOriginFor(note, 'not-a-hash'), undefined);
  for (const bad of [null, {}, {...origin, version: 2}, {...origin, noteId: ''}, {...origin, audioId: 7}, {...origin, revision: 'A'.repeat(64)}, {...origin, noteId: 'a\u0000b'}]) assert.equal(noteOriginOf(bad), undefined);
  assert.deepEqual(noteOriginOf({...origin, title: 'Private title', body: 'leaked content', extra: 1}), origin, 'a title and unknown fields are dropped, never stored');
  const withTitle = addNoteOrigin(noteOriginIndex(null), 'event', 'e9', {...origin, title: 'Private title'}, 1);
  assert.equal(JSON.stringify(withTitle).includes('Private title'), false, 'the stored index holds no title');
  assert.equal(JSON.stringify(noteOriginIndex({version: 1, links: {'event:e9': {...origin, title: 'Private title', savedAt: 1}}})).includes('Private title'), false, 'a title in an older stored link is dropped on read');
});

test('links are keyed by the saved record; a record keeps the note it was created from', () => {
  let index = addNoteOrigin(empty(), 'reminder', 'r1', origin, 10);
  index = addNoteOrigin(index, 'event', 'e1', origin, 11);
  assert.deepEqual(findNoteOrigin(index, 'reminder', 'r1'), origin);
  assert.deepEqual(findNoteOrigin(index, 'event', 'e1'), origin);
  assert.equal(findNoteOrigin(index, 'event', 'r1'), undefined, 'a reminder id never resolves as an event');
  assert.equal(findNoteOrigin(index, 'reminder', 'e1'), undefined);
  assert.equal(findNoteOrigin(index, 'event', 'e2'), undefined);
  const other = noteOriginFor({...note, id: 'n2', audio: {audioId: 'audio-2'}, title: 'Other'}, revision);
  assert.equal(addNoteOrigin(index, 'event', 'e1', other, 12), index, 'a second hand-off cannot relink an existing record');
  assert.deepEqual(findNoteOrigin(index, 'event', 'e1'), origin);
  assert.throws(() => addNoteOrigin(index, 'event', 'e3', {...origin, revision: 'x'}, 12), /Invalid note link/);
  assert.throws(() => addNoteOrigin(index, 'event', '', origin, 12), /Invalid note link/);
  index = removeNoteOrigin(index, 'event', 'e1');
  assert.equal(findNoteOrigin(index, 'event', 'e1'), undefined);
  assert.deepEqual(findNoteOrigin(index, 'reminder', 'r1'), origin, 'removing one link leaves the others');
  assert.equal(removeNoteOrigin(index, 'event', 'missing'), index);
});

test('a repeating event has one link for the series', () => {
  assert.equal(noteOriginKey('event', 'abc:occ:1700000000000'), 'event:abc');
  assert.equal(noteOriginKey('reminder', 'abc:occ:1'), 'reminder:abc:occ:1');
  const index = addNoteOrigin(empty(), 'event', 'abc:occ:1700000000000', origin, 1);
  assert.deepEqual(findNoteOrigin(index, 'event', 'abc'), origin);
  assert.deepEqual(findNoteOrigin(index, 'event', 'abc:occ:1700086400000'), origin);
});

test('the index is bounded and a malformed index is refused, never partly trusted', () => {
  let index = empty();
  for (let i = 0; i <= noteOriginLimit; i++) index = addNoteOrigin(index, 'reminder', 'r' + i, origin, i);
  assert.equal(Object.keys(index.links).length, noteOriginLimit);
  assert.equal(findNoteOrigin(index, 'reminder', 'r0'), undefined, 'the oldest link makes room');
  assert.deepEqual(findNoteOrigin(index, 'reminder', 'r' + noteOriginLimit), origin);
  assert.deepEqual(noteOriginIndex(JSON.parse(JSON.stringify(index))), index);
  for (const bad of [[], {version: 2, links: {}}, {version: 1}, {version: 1, links: []}, {version: 1, links: {}, extra: 1}, {version: 1, links: {'note:x': {...origin, savedAt: 1}}}, {version: 1, links: {'event:x': {...origin}}}, {version: 1, links: {'event:x': {...origin, revision: 'bad', savedAt: 1}}}])
    assert.throws(() => noteOriginIndex(bad), /need recovery/);
});

test('opening the note fails closed when it was deleted, replaced or duplicated', () => {
  assert.equal(resolveNoteOrigin(origin, [note]).status, 'found');
  assert.equal(resolveNoteOrigin(origin, [{...note, body: 'Edited later'}]).status, 'found', 'an edited note is still the same note');
  assert.equal(resolveNoteOrigin(origin, []).status, 'missing');
  assert.equal(resolveNoteOrigin(origin, undefined).status, 'missing', 'an unread Notes list is missing, not found');
  assert.equal(resolveNoteOrigin(origin, [{...note, id: 'n2'}]).status, 'missing');
  assert.equal(resolveNoteOrigin(origin, [{...note, audio: {audioId: 'audio-9'}}]).status, 'missing', 'the same id with another recording is a different note');
  assert.equal(resolveNoteOrigin(origin, [{id: 'n1', kind: 'text', title: 'Venue meeting'}]).status, 'missing');
  assert.equal(resolveNoteOrigin(origin, [note, {...note}]).status, 'missing', 'an ambiguous id opens nothing');
  assert.equal(resolveNoteOrigin({...origin, revision: 'x'}, [note]).status, 'missing');
});

test('a retained Calendar draft keeps a valid origin and refuses a malformed one', () => {
  const form = {id: null, creationId: '0b0e7d1c-1111-4111-8111-111111111111', title: 'Book the venue', notes: 'Book the venue', where: '', off: 1, t: 9, d: 1, video: false, who: [], cal: 'native:local', repeat: 'none', alert: null, origin};
  const restored = decodeCalendarForm(encodeCalendarForm(form)).form;
  assert.deepEqual(restored.origin, origin);
  assert.deepEqual(snapshotCalendarForm(form).origin, origin);
  assert.equal(decodeCalendarForm(encodeCalendarForm({...form, origin: undefined})).form.origin, undefined);
  assert.throws(() => encodeCalendarForm({...form, origin: {...origin, extra: 'authority'}}), /needs recovery/);
  assert.throws(() => encodeCalendarForm({...form, origin: {...origin, title: 'Private title'}}), /needs recovery/, 'a draft link carries no note title');
  assert.throws(() => encodeCalendarForm({...form, origin: {...origin, revision: 'x'}}), /needs recovery/);
  assert.equal('origin' in calendarEditFields(form).form, false, 'an edit of a saved record never carries or changes a link');
});

test('Maps offers "Back to event" only for the event it was opened from, while Calendar is beneath it', () => {
  const row = {id: 'calendar:e1:1000', alphaCalendarId: 'e1', nativeEvent: {id: 'e1', begin: 1000}, off: 2, title: 'Harbour meeting', where: '1 Harbour Way'};
  const from = mapsEventOriginFor(row, 2);
  assert.deepEqual(from, {version: 1, id: 'e1', begin: 1000, rowId: 'calendar:e1:1000', day: 2, title: 'Harbour meeting'});
  assert.equal('where' in from, false, 'no location or search text is carried');
  assert.equal(mapsEventOriginFor({id: 'reminder:1', alphaReminderId: 'r1', off: 0}, 0), undefined, 'reminders and fixtures are not events');
  assert.equal(mapsEventOriginFor(row, undefined).day, 2);
  assert.deepEqual(mapsEventReturnOffered(from, ['calendar'], false), from);
  assert.deepEqual(mapsEventReturnOffered(from, ['notes', 'calendar'], false), from);
  assert.equal(mapsEventReturnOffered(from, [], false), undefined, 'opened from the launcher or after Home: no control');
  assert.equal(mapsEventReturnOffered(from, ['calendar', 'notes'], false), undefined);
  assert.equal(mapsEventReturnOffered(from, undefined, false), undefined);
  assert.equal(mapsEventReturnOffered(from, ['calendar'], true), undefined, 'not offered during guidance');
  assert.equal(mapsEventReturnOffered(null, ['calendar'], false), undefined);
  assert.equal(mapsEventReturnOffered({...from, begin: 'soon'}, ['calendar'], false), undefined);
  assert.equal(mapsEventOriginOf({...from, rowId: ''}), undefined);
  assert.equal(mapsEventStillThere(from, [{id: 'e1', begin: 1000}, {id: 'e2', begin: 1000}]), true);
  assert.equal(mapsEventStillThere(from, [{id: 'e2', begin: 1000}]), false, 'deleted');
  assert.equal(mapsEventStillThere(from, [{id: 'e1', begin: 2000}]), false, 'moved');
  assert.equal(mapsEventStillThere(from, [{id: 'e1', begin: 1000}, {id: 'e1', begin: 1000}]), false, 'ambiguous');
  assert.equal(mapsEventStillThere(from, undefined), false);
  assert.equal(mapsEventStillThere({...from, id: 71}, [{id: 71, begin: 1000}]), false);
  assert.equal(mapsEventStillThere(mapsEventOriginFor({...row, alphaCalendarId: 71, nativeEvent: {id: 71, begin: 1000}}, 2), [{id: 71, begin: 1000}]), true, 'numeric provider ids compare by value');
});

test('a voice-note link reports an edit only when the note content changed', async () => {
  const voice = {...note, lines: [{s: 'me', at: 0, t: 'Transcript'}], summary: ['Venue booked'], actions: [{t: 'Book the venue', done: false}], pinned: false};
  const revision = await voiceNoteContentRevision(voice);
  assert.match(revision, /^[a-f0-9]{64}$/);
  assert.ok(noteOriginFor(voice, revision), 'a content revision is a valid link revision');
  for (const flags of [{pinned: true}, {onCal: true}, {actions: [{t: 'Book the venue', done: true}]}, {when: 'Yesterday'}])
    assert.equal(await voiceNoteChanged({...voice, ...flags}, revision), false, JSON.stringify(flags));
  for (const edit of [{lines: [{s: 'me', at: 0, t: 'Edited transcript'}]}, {body: 'Edited'}, {title: 'Renamed'}, {summary: ['Venue cancelled']}, {actions: [{t: 'Cancel the venue', done: false}]}, {audio: {audioId: 'audio-1', transcript: 'Other'}}])
    assert.equal(await voiceNoteChanged({...voice, ...edit}, revision), true, JSON.stringify(edit));
  // A link made before content revisions hashed the whole record: unchanged stays unchanged, any change may be an edit.
  const whole = await recordingRevision(voice);
  assert.equal(await voiceNoteChanged(voice, whole), false);
  assert.equal(await voiceNoteChanged({...voice, pinned: true}, whole), true);
});

test('an event link to an agent note opens it while Previous notes is selected', async () => {
  const source = readFileSync('apps/app/src/prototype/note-origin-adapter.ts', 'utf8');
  const start = source.indexOf(' /** A canonical Notes record link'), end = source.lastIndexOf('\n}');
  const linked = {id: 'agent-1', title: 'Venue plan', body: 'Book it', format: null};
  const link = {version: 2, noteId: 'agent-1', revision: await recordNoteRevision(linked)};
  const run = async ({refuse = false, port = true} = {}) => {
    const toasts = [], opened = [], selected = [];
    const binding = {current: true, notes: () => [linked], select: id => selected.push(id)};
    const shell = {notesSourceMode: 'legacy', canonicalNotesUi: null, notesReady: undefined,
      api: () => ({notesSourceOptions: [{id: 'canonical', choose() { if (refuse) return; shell.notesSourceMode = 'canonical'; shell.notesReady = Promise.resolve().then(() => { if (port) shell.canonicalNotesUi = binding; }); }}]})};
    const api = {isActive: () => true, get: () => ({open: 'e1'}), toast: text => toasts.push(text), open: (...args) => opened.push(args)};
    const canonicalOrigin = new Function('shell', 'resolveNoteLink', 'noteOriginTitle', 'recordNoteRevision', 'document',
      'let opening=false;' + stripTypeScriptTypes(source.slice(start, end), {mode:'strip'}) + ';return canonicalOrigin;')(shell, resolveNoteLink, noteOriginTitle, recordNoteRevision, {hidden: false});
    const out = canonicalOrigin({ev: {}}, link, api, 'e1');
    assert.equal(out.ev.originLabel, 'From a note in Notes');
    await out.ev.openOrigin();
    return {toasts, opened, selected, shell};
  };
  const ok = await run();
  assert.equal(ok.shell.notesSourceMode, 'canonical', 'Notes is chosen first, as the Older notes path does');
  assert.deepEqual(ok.opened, [['notes', {}]]);
  assert.deepEqual(ok.selected, ['agent-1']);
  assert.deepEqual(ok.toasts, []);
  const refused = await run({refuse: true});
  assert.deepEqual([refused.opened, refused.toasts], [[], []], 'a refused switch already said why and opens nothing');
  const missing = await run({port: false});
  assert.deepEqual(missing.toasts, ['Notes is unavailable for this agent connection. Nothing was opened.'], 'a real missing binding still says so');
});
