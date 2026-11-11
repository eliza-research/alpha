import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../check-traces.mjs';
import {captureSources, boundInputs, call, tick} from './support.mjs';
import {compileCanonicalNotesUi, createCanonicalNotesUiFixture} from './canonical-notes-feedback.mjs';

const driver = fileURLToPath(import.meta.url);
const texts = ['', 'Title', 'Body', 'Edited', 'Second', 'New', 'New note'];
const textOf = value => {const index = texts.indexOf(value); assert.notEqual(index, -1, 'Text needs an explicit equality class'); return index;};
const folders = ['', 'folder-one', 'folder-two'];
const folderOf = value => {if (value === undefined) return 0; const index = folders.indexOf(value); assert.notEqual(index, -1); return index;};
const noData = {kind: 'none', title: 0, body: 0, hasPinned: false, pinned: false,
  hasFolder: false, folder: 0, voiceContent: false, linkUrl: false, handles: false};
const noDraft = {present: false, id: 0, token: 0, base: 0, data: noData};
const localHandles = ['audio', 'documentSource', 'webSource'];
const note = (id = 1, format, title = 'Title', body = '\nBody') => ({id: id === 1 ? 'note-one' : 'note-two', title, body, color: 'yellow',
  ...(format ? {format} : {}), createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z'});
const state = (notes, revision = 1, trash = []) => ({revision, notes, trash: trash.map(note => ({note, deletedAt: '2026-11-08T00:00:00Z'}))});

const observationPlugin = {name: 'read-canonical-view-callbacks', setup(builder) {
  builder.onLoad({filter: /\/canonical-notes-ui\.ts$/}, args => {
    let code = readFileSync(args.path, 'utf8');
    for (const [anchor, replacement] of [
      ['this.baseRows=snapshot.notes.map(note=>this.row(note,snapshot.revision));',
        'this.baseRows=snapshot.notes.map(note=>this.row(note,snapshot.revision));__ports.observe("base",snapshot,this);'],
      ['this.rowsValue=rows;this.hooks.paint();', 'this.rowsValue=rows;this.hooks.paint();__ports.observe("paint",draft??null,this);'],
      ['resume=>this.idleWaiters.push(resume)', 'resume=>{this.idleWaiters.push(resume);__ports.observe("wait",resume,this);}'],
      ['this.idleWaiters=[];for(const resume', 'this.idleWaiters=[];__ports.observe("drain",null,this);for(const resume'],
      ['this.openValue=null;this.trashValue=[];}', 'this.openValue=null;this.trashValue=[];__ports.observe("retire",null,this);}'],
    ]) {
      assert.equal(code.split(anchor).length, 2, 'One exact read-only observer seam for ' + anchor);
      code = code.replace(anchor, replacement);
    }
    return {loader: 'ts', contents: code};
  });
}};

async function fixture(compiled) {
  const tokens = new Map(), waiters = new Map(), steps = [];
  let f;
  const tokenOf = token => {if (!token) return 0; if (!tokens.has(token)) tokens.set(token, tokens.size + 1); return tokens.get(token);};
  const idOf = id => !id ? 0 : id.startsWith('draft-') ? 2 + tokenOf(id.slice(6)) : id === 'note-one' ? 1 : id === 'note-two' ? 2 : assert.fail('Unknown record id');
  const waiterOf = callback => {if (!waiters.has(callback)) waiters.set(callback, waiters.size + 1); return waiters.get(callback);};
  function dataOf(value, title, body) {
    const data = value?.data ?? {};
    return {kind: value?.kind ?? 'none', title: textOf(title), body: textOf(body),
      hasPinned: Object.hasOwn(data, 'pinned'), pinned: !!data.pinned,
      hasFolder: Object.hasOwn(data, 'folderId'), folder: folderOf(data.folderId),
      voiceContent: ['lines', 'summary', 'actions'].some(key => Array.isArray(data[key]) && data[key].length > 0),
      linkUrl: typeof data.url === 'string' && data.url !== '', handles: localHandles.some(key => Object.hasOwn(data, key))};
  }
  const draftOf = value => value ? {present: true, id: idOf(value.id), token: tokenOf(value.token), base: value.baseRevision,
    data: dataOf(value.format, value.title, value.body)} : noDraft;
  const rowOf = row => ({id: idOf(row.id), kind: row.kind, title: textOf(row.title), body: textOf(row.body),
    revision: row.canonicalRevision, pinned: !!row.pinned, folder: folderOf(row.folderId),
    handles: localHandles.some(key => Object.hasOwn(row, key))});
  const observe = ui => ({'s.current': ui.current, 's.baseRows': ui.baseRows.map(rowOf), 's.rows': ui.rowsValue.map(rowOf),
    's.open': idOf(ui.openValue), 's.blank': idOf(ui.blankCreationValue), 's.trash': ui.trashValue.map(row => idOf(row.id)),
    's.draft': draftOf(ui.editor.draft), 's.waiters': ui.idleWaiters.map(waiterOf),
    PublicRows: ui.list.map(rowOf), PublicOpen: idOf(ui.open)});
  function record(event, payload, ui) {
    let action;
    if (event === 'base') action = call('published', payload.notes.map(value => {
      const parts = f.projectNoteForModel(value);
      return {id: idOf(value.id), data: dataOf(value.format, parts.title, parts.body)};
    }), (payload.trash ?? []).map(value => idOf(value.note.id)), payload.revision);
    if (event === 'paint') action = call('painted', draftOf(payload));
    if (event === 'wait') action = call('wait', waiterOf(payload));
    if (event === 'drain') action = call('drained', ui.current);
    if (event === 'retire') action = call('retired');
    if (event === 'owner') action = call('loseOwner');
    assert.ok(action, event);
    steps.push({label: 'actual ' + event + ' callback', action, expect: observe(ui),
      source: {phase: ui.phase, pending: ui.pending, editing: ui.editing, dirty: ui.dirty,
        requests: f?.requests.map(request => ({method: request.method, capability: request.body?.capability ?? null, settled: request.settled})) ?? []}});
  }
  f = await createCanonicalNotesUiFixture(compiled, record);
  const initial = observe(f.ui);
  return {...f, steps, initial, observe: () => observe(f.ui),
    ownerLost() {f.loseOwner(); record('owner', null, f.ui);}};
}

export async function checkCanonicalNotesView(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const compiled = await compileCanonicalNotesUi([driver, ...extraSources], [observationPlugin]), traces = [];
  const cases = ['text', 'list', 'empty-voice', 'rich-voice', 'empty-link', 'rich-link', 'local-handles',
    'forged-view-fields', 'pin-folder', 'open-second', 'edit-title', 'new-text', 'new-list', 'new-folder',
    'clean-refresh', 'dirty-refresh', 'clean-removal', 'dirty-removal', 'save-new-id', 'save-newer-edit',
    'convert-to-text', 'clear-format-preserves-base', 'owner-loss', 'retire', 'wait-navigation',
    'wait-two-navigations', 'wait-queued-save', 'retire-waiting', 'failed-save-waiting', 'blank-new-delete'];
  for (const name of cases) {
    const f = await fixture(compiled);
    try {
      let format;
      if (name === 'list') format = {kind: 'list', data: {items: []}};
      if (name.includes('voice')) format = {kind: 'voice', data: name === 'rich-voice' ? {lines: [{t: 'Body', at: 0, s: 'me'}]} : {}};
      if (name.includes('link')) format = {kind: 'link', data: name === 'rich-link' ? {url: 'https://example.invalid/'} : {}};
      if (name === 'local-handles') format = {kind: 'text', data: {audio: 'local', documentSource: {uri: 'local'}, webSource: 'local'}};
      if (name === 'forged-view-fields') format = {kind: 'text', data: {id: 'forged', title: 'Forged', body: 'Forged', kind: 'voice', canonicalRevision: 999}};
      if (['pin-folder', 'clear-format-preserves-base', 'convert-to-text'].includes(name)) format = {kind: 'voice', data: {pinned: true, folderId: 'folder-one', lines: [{t: 'Body', at: 0, s: 'me'}]}};
      const first = note(1, format), second = note(2, undefined, 'Second');
      f.run('refresh'); await f.resolveRequest(state(name === 'save-new-id' ? [first] : [first, second]));
      if (['local-handles', 'forged-view-fields'].includes(name)) await f.ui.leave('note-one');
      if (['new-text', 'new-list', 'new-folder', 'save-new-id', 'blank-new-delete'].includes(name)) {
        await f.ui.create(name === 'new-list' ? 'list' : 'text', name === 'new-folder' ? 'folder-two' : null);
        if (name === 'save-new-id') {
          f.ui.editor.edit({title: 'New'}); f.run('update', f.ui.open, {title: 'New'}); await tick();
          const saved = note(2, undefined, 'New', ''); await f.resolveRequest(state([first, saved], 2), saved);
        }
        if (name === 'blank-new-delete') await f.ui.remove(f.ui.open, f.api);
      } else if (!['text', 'list', 'empty-voice', 'rich-voice', 'empty-link', 'rich-link', 'local-handles', 'forged-view-fields', 'pin-folder'].includes(name)) {
        await f.ui.leave(name === 'open-second' ? 'note-two' : 'note-one');
        if (['edit-title', 'dirty-refresh', 'dirty-removal'].includes(name)) f.ui.editor.edit({title: 'Edited'});
        if (name.endsWith('refresh') || name.endsWith('removal')) {
          f.run('refresh'); await f.resolveRequest(state(name.endsWith('removal') ? [second] : [note(1, undefined, 'New'), second], 2));
        }
        if (name === 'convert-to-text') f.ui.editor.edit({format: {kind: 'text', data: {}}});
        if (name === 'clear-format-preserves-base') f.ui.editor.edit({format: {kind: 'voice', data: {}}});
        if (name === 'owner-loss') f.ownerLost();
        if (name === 'retire') f.ui.retire();
        if (name === 'save-newer-edit' || name.includes('waiting') || name.startsWith('wait-')) {
          f.run('update', 'note-one', {title: 'Edited'}); await tick();
          if (name === 'save-newer-edit' || name === 'wait-queued-save') {f.run('update', 'note-one', {body: 'New'}); await tick();}
          if (name !== 'save-newer-edit') {
            f.run('leave', 'note-two'); await tick();
            if (name === 'wait-two-navigations') {f.run('leave', null); await tick();}
          }
          if (name === 'retire-waiting') f.ui.retire();
          const saved = note(1, undefined, 'Edited');
          await f.resolveRequest(state([saved, second], 2), saved, name !== 'failed-save-waiting');
          if (name === 'wait-queued-save' || name === 'save-newer-edit') {
            const newest = note(1, undefined, 'Edited', '\nNew');
            await f.resolveRequest(state([newest, second], 3), newest);
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      f.steps.push({label: 'settled source projection', action: null, expect: f.observe()});
      traces.push({name, init: call('init'), expect: f.initial, steps: f.steps.slice()});
    } finally {await f.close();}
  }
  return checkTraces(boundInputs({model: 'CanonicalNotesView', sources: compiled.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual CanonicalNotesUi, NotesEditor, NotesController and wire codecs execute. Read-only build-time observers report accepted base publication, draft paint, waiter admission, phase drain and retirement. No production state is altered by observers.',
    'Editor draft callbacks and accepted controller snapshots are inputs to this view projection. Their source-transition protocols are covered separately by CanonicalNotesDraft, CanonicalNotesMutation and CanonicalNotesController.',
    'Two canonical identities, five draft tokens, eight waiter identities and explicit text/rich metadata classes bound the campaign. Rows retain identity/order/kind/title/body/revision/pin/folder and local-handle omission. Arbitrary metadata bytes, dates, link domain and voice-array normalization remain payload obligations.',
    'The waiter list is observed directly at admission and drain. The eight-attempt settle loop and competing navigation intent policy are exercised in selected schedules but not proven universally. Recorder, dictation, folder-store and Calendar handoff remain separate protocols.'] }));
}
