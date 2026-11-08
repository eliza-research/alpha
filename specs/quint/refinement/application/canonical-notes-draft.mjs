import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces, qmap, qset} from '../check-traces.mjs';
import {root, captureSources, boundInputs, trace, checkpoint, call, tick} from './support.mjs';
import {createCanonicalNotesFixture} from './canonical-notes-controller.mjs';

const driver = fileURLToPath(import.meta.url);
const textValues = ['', 'Note 1', 'Body', 'First', 'Second', ' '];
const emptyData = {title: 0, body: 0, separator: '', format: 0, color: 'yellow'};
const emptyDraft = {present: false, token: 0, id: 0, base: 0, version: 0, data: emptyData, framing: 'fields'};
const formatOf = value => {
  if (value === undefined) return 0;
  const index = formats.findIndex(format => JSON.stringify(format) === JSON.stringify(value));
  assert.notEqual(index, -1, 'Rich metadata must retain an exact represented identity');
  return index;
};
const formats = [undefined, {kind: 'list', data: {}}, {kind: 'list', data: {items: [{t: 'Body', done: false}]}},
  {kind: 'text', data: {pinned: true}}, {kind: 'voice', data: {lines: [{s: 'me', at: 0, t: 'Body'}]}}, {kind: 'voice', data: {}}, {kind: 'link', data: {}}, {kind: 'link', data: {clips: ['Body']}}];
const textOf = value => {const index = textValues.indexOf(value); assert.notEqual(index, -1, 'All source text has an explicit equality class'); return index;};
const idOf = id => id === 'note-one' ? 1 : id === 'note-two' ? 2 : 0;

async function compile(extraSources) {
  const source = '.eliza/client-features/plugins/plugin-notes/src/client/notes-editor.ts';
  const built = await build({absWorkingDir: root, stdin: {resolveDir: root, contents: `
    export {NotesEditor,__quintInspectSaved} from './${source}';
    export {CanonicalNotesController,CANONICAL_NOTES_INVALIDATED_EVENT} from './apps/app/src/prototype/canonical-notes-controller.ts';
    export {projectNoteForModel} from './.eliza/client-features/plugins/plugin-notes/src/types.ts';
  `}, bundle: true, format: 'cjs', platform: 'node', write: false, metafile: true,
    plugins: [{name: 'observe-owned-save-snapshot', setup(builder) {
      builder.onLoad({filter: /\/notes-editor\.ts$/}, args => {
        const code = readFileSync(args.path, 'utf8'), marker = '    this.saving = true;';
        assert.equal(code.split(marker).length, 2, 'One exact save-capture seam');
        return {loader: 'ts', contents: 'const __quintSaveCaptures = new WeakMap<object, unknown>();\n' +
          code.replace(marker, marker + '\n    __quintSaveCaptures.set(this, captured);') +
          '\nexport function __quintInspectSaved(editor: object) { return structuredClone(__quintSaveCaptures.get(editor) ?? null); }'};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')),
    driver, 'specs/quint/refinement/application/canonical-notes-controller.mjs',
    'specs/quint/refinement/application/support.mjs', ...extraSources];
  captureSources(sources);
  const module = {exports: {}};
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return {exports: module.exports, sources};
}

async function fixture(module) {
  const f = await createCanonicalNotesFixture(module), tokens = new Map();
  let review = false, committed = {id: 0, token: 0, revision: 0};
  const tokenOf = token => {if (!token) return 0; if (!tokens.has(token)) tokens.set(token, tokens.size + 1); return tokens.get(token);};
  const editor = new module.exports.NotesEditor(f.controller, {
    changed() {}, review() {review = true;},
    committed(target, token) {committed = {id: idOf(target.id), token: tokenOf(token), revision: target.revision};},
  });
  f.refresh(); await f.reply(1, 1);
  const dataOf = value => ({title: textOf(value.title), body: textOf(value.body), separator: value.separator === '\n' || value.bodySeparator === '\n' ? 'lf' : '',
    format: formatOf(value.format), color: value.color});
  const draftOf = value => value ? {present: true, token: tokenOf(value.token), id: idOf(value.id), base: value.baseRevision,
    version: value.version, data: dataOf(value), framing: value.framing} : emptyDraft;
  function observe() {
    const draft = draftOf(editor.draft), captured = draftOf(module.exports.__quintInspectSaved(editor));
    const notes = f.controller.snapshot?.notes ?? [];
    return {'s.current': f.controller.current, 's.revision': f.controller.revision ?? -1,
      's.known': qset(notes.map(note => idOf(note.id))),
      's.records': qmap([1, 2].map(id => {const note = notes.find(note => idOf(note.id) === id);
        return [id, note ? dataOf({...module.exports.projectNoteForModel(note), format: note.format}) : emptyData];})),
      's.draft': draft, 's.captured': captured, 's.saving': editor.saving, 's.queued': editor.queuedVersion ?? -1,
      's.nextToken': tokens.size, 's.review': review, 's.committedId': committed.id, 's.committedToken': committed.token,
      's.committedRevision': committed.revision, SelectionId: idOf(editor.selection()?.id), HasAuthoredContent: editor.hasAuthoredContent};
  }
  const pending = [];
  function save() {pending.push(editor.save());}
  function edit({title, body, format, color}) {
    const patch = {...(title === undefined ? {} : {title: textValues[title]}), ...(body === undefined ? {} : {body: textValues[body]}),
      ...(format === undefined ? {} : {format: formats[format]}), ...(color === undefined ? {} : {color})};
    const before = editor.draft;
    editor.edit(patch);
    return call('edit', {...dataOf(before), ...(title === undefined ? {} : {title}), ...(body === undefined ? {} : {body}),
      ...(format === undefined ? {} : {format}), ...(color === undefined ? {} : {color})});
  }
  const record = (id, data) => ({id: id === 1 ? 'note-one' : 'note-two', title: textValues[data.title],
    body: (data.separator === 'lf' ? '\n' : '') + textValues[data.body], color: data.color,
    ...(data.format ? {format: formats[data.format]} : {}), createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z'});
  async function reply(id, revision, data, success = true) {
    const request = f.requests.at(-1);
    if (!success) {await f.reply(request.id, revision, [1], false); return;}
    const updated = record(id, data), notes = (f.controller.snapshot?.notes ?? []).filter(note => idOf(note.id) !== id).concat(updated);
    await f.replyWith(request.id, {requestId: 'save-result', success: true,
      result: {success: true, text: 'Saved', state: {revision, notes}, data: {note: updated}}});
  }
  async function snapshot(revision, ids, data) {
    f.refresh(); const notes = ids.map(id => record(id, data[id]));
    await f.replyWith(f.requests.at(-1).id, {success: true, data: {revision, notes}});
    return call('snapshot', revision, qset(ids), qmap([1, 2].map(id => [id, ids.includes(id) ? data[id] : emptyData])));
  }
  return {...f, editor, observe, save, edit, reply, snapshot, tokenOf, pending};
}

export async function checkCanonicalNotesDraft(extraSources = []) {
  const module = await compile(extraSources), traces = [];
  for (const scenario of ['save', 'same-version-queue', 'late-edit', 'queued-edit', 'queued-clear', 'failed-newer-queue', 'close-held', 'replace-held', 'failed-save', 'owner-held',
    'empty-text', 'empty-list', 'empty-voice', 'empty-link', 'rich-list', 'rich-voice', 'rich-link', 'new-fields', 'new-edit-held', 'metadata-only', 'whitespace', 'color-save', 'verbatim-lf', 'empty-existing', 'external-clean', 'external-dirty', 'external-delete', 'invalid-patch', 'missing-note']) {
    const f = await fixture(module), t = trace(scenario, f.observe());
    const step = (label, action) => checkpoint(t, label, action, f.observe());
    try {
      const empty = scenario.startsWith('empty-') && scenario !== 'empty-existing' || ['rich-list', 'rich-voice', 'rich-link', 'new-fields', 'new-edit-held', 'metadata-only', 'whitespace'].includes(scenario);
      if (empty) {
        const format = scenario.endsWith('list') ? 1 : scenario.endsWith('voice') ? 5 : scenario.endsWith('link') ? 6 : 0;
        f.editor.begin(format === 1 ? 'list' : format === 5 ? 'voice' : format === 6 ? 'link' : 'text'); step('begin actual new draft', call('begin', format));
        const rich = scenario === 'rich-list' ? 2 : scenario === 'rich-voice' ? 4 : scenario === 'rich-link' ? 7 : 0;
        if (rich) step('authored rich content without plain text', f.edit({format: rich}));
        if (scenario === 'metadata-only') step('metadata alone is not authored text', f.edit({format: 3}));
        if (['new-fields', 'new-edit-held'].includes(scenario)) {step('title before body', f.edit({title: 3})); step('body adds one framing separator', f.edit({body: 2}));}
        if (scenario === 'whitespace') step('whitespace-only fields', f.edit({title: 5, body: 5}));
        f.save(); await tick(); step('request save', call('save'));
        if (rich || ['new-fields', 'new-edit-held'].includes(scenario)) {
          const data = ['new-fields', 'new-edit-held'].includes(scenario) ? {title: 3, body: 2, separator: 'lf', format: 0, color: 'yellow'} : {title: 0, body: 0, separator: '', format: rich, color: 'yellow'};
          if (rich) assert.deepEqual(f.requests.at(-1).body.params.format, formats[rich]);
          else assert.equal(f.requests.at(-1).body.params.content, 'First\nBody');
          if (scenario === 'new-edit-held') step('newer edit during first canonical save', f.edit({body: 4}));
          await f.reply(2, 2, data); step('canonical identity names the new draft', call('saveReply', 2, 2, data));
        }
      } else {
        f.editor.open('note-one'); step('open canonical record', call('open', 1));
        if (scenario === 'verbatim-lf') {
          const existing = {...emptyData, title: 1, body: 2, separator: 'lf'};
          step('canonical framing LF remains in the record', await f.snapshot(1, [1], {1: existing}));
          f.editor.reconcile(); step('clean editor follows exact separator', call('reconcile'));
          step('edit preserves the authored separator', f.edit({title: 3}));
          f.save(); await tick(); step('capture framed content', call('save'));
          assert.equal(f.requests.at(-1).body.params.content, 'First\nBody');
          const next = {...existing, title: 3}; await f.reply(1, 2, next);
          step('framed canonical result', call('saveReply', 1, 2, next));
        } else if (scenario === 'invalid-patch') {
          assert.throws(() => f.editor.edit({title: 42}));
          step('invalid typed patch is rejected unchanged', {...call('edit', {...emptyData, title: 99}), reject: true});
        } else if (scenario === 'missing-note') {
          assert.throws(() => f.editor.open('note-two'));
          step('absent canonical identity cannot open', {...call('open', 2), reject: true});
        } else if (scenario.startsWith('external-')) {
          if (scenario === 'external-dirty') step('keep dirty local input', f.edit({title: 3}));
          const next = {...emptyData, title: 4, body: 2};
          step('receive newer canonical snapshot', await f.snapshot(2, scenario === 'external-delete' ? [] : [1], {1: next}));
          f.editor.reconcile(); step('reconcile clean or dirty editor', call('reconcile'));
        } else {
          step('edit actual draft fields', f.edit(scenario === 'empty-existing' ? {title: 0, body: 0} : scenario === 'color-save' ? {color: 'green'} : {title: 3}));
          f.save(); await tick(); step('capture and begin save', call('save'));
          if (scenario !== 'empty-existing') {
            if (scenario === 'same-version-queue') {f.save(); await tick(); step('repeat save without a new edit', call('save'));}
            if (['late-edit', 'queued-edit', 'queued-clear', 'failed-newer-queue'].includes(scenario)) {
              step('type newer content while save is pending', f.edit(scenario === 'queued-clear' ? {title: 0, body: 0} : {body: 4}));
              if (scenario !== 'late-edit') {f.save(); await tick(); step('queue newer edit version', call('save'));}
            }
            if (['close-held', 'replace-held'].includes(scenario)) {f.editor.close(); step('close captured draft', call('close'));}
            if (scenario === 'replace-held') {
              f.editor.begin(); step('new token replaces the old draft', call('begin', 0));
              step('type into new draft', f.edit({title: 4})); f.save(); await tick(); step('new token cannot steal old completion', call('save'));
            }
            if (scenario === 'owner-held') {f.loseOwner(); step('owner revoked before reply', call('loseOwner'));}
            const failed = ['failed-save', 'failed-newer-queue', 'owner-held'].includes(scenario), data = scenario === 'color-save' ? {...emptyData, title: 1, body: 2, color: 'green'} : {...emptyData, title: 3, body: 2};
            await f.reply(1, 2, data, !failed); step('settle captured save', failed ? call('saveFailed') : call('saveReply', 1, 2, data));
            if (scenario === 'queued-edit') {
              const next = {...data, body: 4}; await f.reply(1, 3, next); step('second save confirms latest body', call('saveReply', 1, 3, next));
            }
          }
        }
      }
      traces.push(t);
    } finally {f.cleanup(); await tick();}
  }
  return checkTraces(boundInputs({model: 'CanonicalNotesDraft', sources: module.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual NotesEditor and CanonicalNotesController execute with controlled valid canonical transport replies. A read-only build-time WeakMap retains the actual local save capture.',
    'Two note identities, five draft tokens, four edit versions and explicit text/format equality classes bound the model. Reply and finally/queued-save completion are one settled macrostep.',
    'This model covers open/begin/edit/save/reconcile/close and selection. Delete/restore continuations, arbitrary rich JSON, byte-level text framing and the CanonicalNotesUi composition remain separate obligations.'] }));
}
