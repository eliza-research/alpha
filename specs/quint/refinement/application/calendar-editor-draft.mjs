import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const model = {path: 'specs/quint/application/CalendarEditorDraft.qnt', module: 'CalendarEditorDraft', traces: 30, steps: 40,
  witnesses: ['OfferedWitness', 'StaleRefusedWitness', 'LatchWitness', 'ClosedDuringSaveKeepsEditsWitness', 'ConflictWitness',
    'OwnEditsOfferedWitness', 'SavedWitness'],
  goals: {
    staleDiscardedThenSaved: 's.saveResult == "saved" and s.revision == "fresh" and s.form == "edits"',
    restoredFromConflict: 's.alive and s.form == "retained" and s.revision == "stale" and s.synced and not(s.conflict) and s.opened and not(s.offered)',
    replacedOtherCopy: 's.alive and s.savedCopy == "stale" and s.stored == "fresh" and s.synced and not(s.conflict) and not(s.error) and s.revision == "fresh" and s.stage == "idle" and s.opened and not(s.offered)',
    failedSaveRetried: 's.saveResult == "failed" and s.alive and not(s.saving)',
  }};
// The editor's own edges. calendar-editor.ts, calendar-editor-draft.ts and calendar-time.ts in the bundle are the real sources.
const ports = [
  [/assistant-draft-controller$/, 'controller'], [/assistant-draft-store$/, 'store'], [/dev-profile$/, 'profile'],
  [/domain-recovery$/, 'recovery'], [/icon-style$/, 'icons'],
];
const declaration = 'let alive = true, opened = false, offered = false, applying = false, invalid = false, saving = false, saved = false, text = "", revision = identity.revision, recoveryAbort;';

/** `mutate` rewrites the bundled editor, for checks that the replay notices a changed implementation. */
export async function buildCalendarEditor(mutate = code => code, {sharedController = false} = {}) {
  const built = await build({absWorkingDir: root, stdin: {contents: `export {editCalendarEvent} from './apps/app/src/browser/calendar-editor.ts';
export {readCalendarEditorDraft} from './apps/app/src/browser/calendar-editor-draft.ts';`, resolveDir: root, loader: 'ts'},
  bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true, loader: {'.css': 'empty'},
  plugins: [{name: 'calendar-editor-ports', setup(builder) {
    for (const [filter, name] of ports.slice(sharedController ? 1 : 0)) builder.onResolve({filter}, () => ({path: name, namespace: 'editor-port'}));
    builder.onLoad({filter: /.*/, namespace: 'editor-port'}, ({path}) => ({loader: 'js', contents: `module.exports = __ports[${JSON.stringify(path)}];`}));
  }}]});
  const sources = Object.keys(built.metafile.inputs).filter(path => !path.includes(':') && !path.startsWith('node_modules/'));
  for (const needed of ['apps/app/src/browser/calendar-editor.ts', 'apps/app/src/browser/calendar-editor-draft.ts'])
    assert.ok(sources.includes(needed), needed);
  // The draft lifecycle's flags live in its closure; expose them read-only.
  let code = built.outputFiles[0].text;
  assert.ok(code.includes(declaration), 'calendarEditorDraft state declaration');
  code = code.replace(declaration, declaration + ' __ports.probe.draft = () => ({alive, opened, offered, invalid, saving, saved, text, revision});');
  return {code: mutate(code), sources};
}

const turn = () => new Promise(resolve => setImmediate(resolve));
const idle = async () => { for (let index = 0; index < 12; index++) await turn(); };
const identity = {id: 'event-1', revision: 'revision-2'};
const row = {title: 'Team sync', body: 'Agenda', location: 'Room 4', begin: Date.UTC(2027, 0, 15, 10), end: Date.UTC(2027, 0, 15, 11), timeZone: 'UTC'};
const fields = title => ({title, body: 'Agenda', location: 'Room 4', start: '2027-01-15T10:00:00.000', end: '2027-01-15T11:00:00.000',
  zone: 'UTC', allDay: false, repeat: '', alert: 'none', video: false, who: []});
// A retained copy typed against the revision being edited, or against the one before it.
const copies = {none: '', fresh: JSON.stringify({version: 1, id: identity.id, revision: identity.revision, fields: fields('Retained title')}),
  stale: JSON.stringify({version: 1, id: identity.id, revision: 'revision-1', fields: fields('Retained title')})};
const shape = title => title === row.title ? 'baseline' : /^(Retained|Other page) title/.test(title) ? 'retained' : 'edits';
const kind = raw => raw ? (JSON.parse(raw).revision === identity.revision ? 'fresh' : 'stale') : 'none';

/**
 * The real modal editor in a page of its own. The draft controller is a double that keeps the
 * shared controller's contract with the editor: open restores a stored copy into an empty editor
 * or reports a differing one as a conflict, a clear empties the editor only when it succeeds,
 * and every state change is announced. Its answers are the replay's inputs.
 */
function editorFixture(compiled, stored, memory) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://alpha.test/', pretendToBeVisual: true});
  const {window} = dom, {document} = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.Element.prototype.scrollIntoView = () => {};
  const state = {storage: copies[stored], readable: true, commits: [], bindings: [], controller: null};
  class Controller {
    state = {message: '', conflict: false, error: false, savedText: ''};
    constructor(factory, text, restore, changed) { Object.assign(this, {factory, text, restore, changed}); state.controller = this; }
    open(binding) {
      this.active = true; this.binding = binding; this.changed();
      return new Promise(resolve => { this.finishOpen = async () => {
        this.finishOpen = undefined;
        if (!this.active) return resolve();
        try {
          // The editor's own store wrapper checks a stored copy before it is offered.
          const saved = (await (await this.factory(binding)).read())?.text ?? '';
          if (!this.text()) { if (saved) this.restore(saved); }
          else if (saved && saved !== this.text()) this.report({conflict: true, savedText: saved});
          else state.storage = this.text();
        } catch { this.report({error: true}); }
        this.changed(); resolve();
      }; });
    }
    report(patch) { this.state = {...this.state, ...patch}; this.changed(); }
    edit(raw) { if (this.active && !this.state.conflict && !this.state.error) state.storage = raw; }
    consume(expected, current) {
      if (!this.active || this.state.error || this.finishConsume) return Promise.reject(Error('Review local draft storage before sending.'));
      this.changed();
      return new Promise((resolve, reject) => { this.finishConsume = outcome => {
        this.finishConsume = undefined;
        if (!this.active || !current() || outcome !== 'cleared') {
          if (this.active && outcome === 'conflict') this.report({conflict: true, savedText: state.storage});
          if (this.active && outcome === 'error') this.report({error: true});
          return reject(Error('The draft changed. Nothing was sent.'));
        }
        assert.equal(this.text().trim(), expected.trim(), 'the clear is for the text the editor holds');
        state.storage = ''; this.restore(''); resolve();
      }; });
    }
    restoreSaved() { if (!this.state.conflict) return; this.restore(this.state.savedText); this.report({conflict: false, error: false}); }
    keepCurrent() { if (!this.state.conflict) return; state.storage = this.text(); this.report({conflict: false, error: false}); }
    retry() { const binding = this.binding; this.retire(); return this.open(binding); }
    retire(notify = true) { this.active = false; this.state = {message: '', conflict: false, error: false, savedText: ''}; if (notify) this.changed(); }
    recovery() {}
  }
  const exposed = {
    controller: {AssistantDraftController: Controller},
    store: {assistantDraftStore: async binding => {
      state.bindings.push(binding);
      if (memory) return memory;
      return {read: async () => { if (!state.readable) throw Error('Storage unavailable'); return state.storage ? {text: state.storage} : null; }};
    }},
    profile: {browserDevProfile: false}, recovery: {openDomainRecovery() {}}, icons: {iconStyle: () => ({})}, probe: {},
  };
  const module = {exports: {}};
  new Function('module', 'exports', '__ports', 'window', 'document', 'HTMLInputElement', 'getComputedStyle', 'requestAnimationFrame',
    compiled.code)(module, module.exports, exposed, window, document, window.HTMLInputElement, window.getComputedStyle.bind(window), () => 0);
  let result = 'open';
  void module.exports.editCalendarEvent(row, next => new Promise((resolve, reject) => state.commits.push({next, resolve, reject})), [], identity)
    .then(value => { result = value.status; });
  const dialog = document.querySelector('dialog.alpha-calendar-editor');
  const button = label => [...dialog.querySelectorAll('button')].find(item => item.textContent === label);
  // Replace and Discard ask in a review dialog of their own; the owner's answer is given at once.
  const answer = (label, approved) => {
    const review = document.querySelector('dialog.alpha-operation-review');
    assert.ok(review, `${label} asks before it acts`);
    [...review.querySelectorAll('button')].find(item => item.textContent === (approved ? label : 'Cancel')).click();
    assert.equal(document.querySelector('dialog.alpha-operation-review'), null, 'the review closed');
  };
  return {window, document, dialog, state, button, answer, probe: exposed.probe.draft, result: () => result,
    form: dialog.querySelector('.alpha-calendar-fields'), save: button('Save event'),
    input: label => [...dialog.querySelectorAll('label.alpha-calendar-field')].find(item => item.textContent.startsWith(label)).querySelector('input, textarea'),
    status: () => dialog.querySelector('[aria-label="Draft status"]').textContent,
    error: () => dialog.querySelector('[aria-label="Calendar editor save status"]').textContent,
    readDraft: module.exports.readCalendarEditorDraft};
}

async function replay(compiled, trace) {
  const first = trace.steps[0].state;
  const f = editorFixture(compiled, first.stored), controller = () => f.state.controller;
  let typed = 0, stage = 'opening', saves = 0, saveResult = 'none', savedCopy = 'none', staleSave = false, unreviewedSave = false, closes = 0;
  assert.deepEqual(f.state.bindings, [], 'the store opens when the read runs');
  const observe = () => {
    const draft = f.probe(), shared = controller().state;
    return {alive: draft.alive, opened: draft.opened, offered: draft.offered, invalid: draft.invalid, saving: draft.saving, latch: draft.saved,
      conflict: shared.conflict, error: shared.error, text: kind(draft.text), revision: draft.revision === identity.revision ? 'fresh' : 'stale',
      form: shape(f.input('Event title').value), shape: draft.text ? shape(JSON.parse(draft.text).fields.title) : 'baseline', stored: kind(f.state.storage), synced: f.state.storage === draft.text, savedCopy, stage,
      inert: !!f.form.inert, disabled: f.save.disabled, canRestore: !f.button('Restore saved editor').hidden,
      canReplace: !f.button('Replace saved editor').hidden, canDiscard: !f.button('Discard saved editor').hidden,
      canRetry: !f.button('Retry editor storage').hidden, saves, saveResult, staleSave, unreviewedSave};
  };
  sameState(observe(), first, trace, 0);
  try {
    for (let index = 1; index < trace.steps.length; index++) {
      const {action, picks, state} = trace.steps[index], before = trace.steps[index - 1].state, draft = f.probe();
      if (action === 'openDone' || action === 'retryDone') {
        f.state.readable = picks.flag;
        await controller().finishOpen();
        stage = 'idle';
      } else if (action === 'edit') {
        f.input('Event title').value = `Typed ${++typed}`;
        f.input('Event description').value = picks.flag ? 'Agenda' : 'x'.repeat(33000);
        f.input('Event title').dispatchEvent(new f.window.Event(typed % 2 ? 'input' : 'change', {bubbles: true}));
      } else if (action === 'reportConflict') {
        // Another page's copy differs from this editor's text even when it carries the same revision.
        f.state.storage = copies[picks.copy].replace('Retained title', `Other page title ${++typed}`);
        savedCopy = picks.copy;
        controller().report({conflict: true, savedText: f.state.storage});
      } else if (action === 'reportError') controller().report({error: true});
      else if (action === 'restore') {
        if (before.conflict) savedCopy = before.savedCopy;
        f.button('Restore saved editor').click();
      } else if (action === 'replace') { f.button('Replace saved editor').click(); f.answer('Replace saved edits', picks.flag); }
      else if (action === 'discard') {
        f.button('Discard saved editor').click(); f.answer('Discard edits', picks.flag);
        if (picks.flag && !before.error) stage = 'discarding';
      } else if (action === 'discardDone') {
        if (before.alive && picks.outcome === 'conflict') savedCopy = before.stored;
        controller().finishConsume(picks.outcome); stage = 'idle';
      } else if (action === 'retry') { f.button('Retry editor storage').click(); stage = 'retrying'; }
      else if (action === 'save') {
        unreviewedSave ||= draft.revision === identity.revision
          && (!draft.opened || draft.offered || controller().state.conflict || controller().state.error || draft.invalid || draft.saved);
        const commits = f.state.commits.length;
        f.save.click();
        await idle();
        if (f.state.commits.length > commits) { stage = 'committing'; saveResult = 'started'; }
        else { saveResult = 'stale'; assert.match(f.error(), /older event revision/); }
        assert.equal(f.state.commits.length > commits, state.saveResult === 'started', 'an event save started');
      } else if (action === 'commitDone') {
        const commit = f.state.commits.at(-1);
        if (picks.flag) {
          saves++; staleSave ||= f.probe().revision !== identity.revision;
          commit.resolve(); await idle();
          stage = before.alive ? 'clearing' : 'idle';
          if (before.alive) assert.equal(typeof controller().finishConsume, 'function', 'the saved event clears its retained edits');
        } else { commit.reject(Error('The calendar changed.')); await idle(); stage = 'idle'; saveResult = 'failed'; }
      } else if (action === 'clearDone') {
        if (before.alive && picks.outcome === 'conflict') savedCopy = before.stored;
        controller().finishConsume(picks.outcome); await idle(); stage = 'idle';
        if (before.alive) saveResult = picks.outcome === 'cleared' ? 'saved' : 'kept';
      } else if (action === 'close') {
        // Cancel, system Back and a locked screen all close the editor.
        const way = closes++ % 3;
        if (way === 0) f.button('Cancel').click();
        else f.window.dispatchEvent(new f.window.Event(way === 1 ? 'alpha-back' : 'alpha:device-state', {cancelable: true}));
      } else assert.ok(!action, `unknown model action ${action}`);
      await idle();
      sameState(observe(), state, trace, index);
      assert.equal(f.result(), state.alive ? 'open' : state.saveResult === 'saved' ? 'saved' : 'cancelled', `${trace.name} step ${index}: editor result`);
      if (state.alive && state.latch) assert.equal(f.status(), 'Saved');
      else if (state.alive && state.invalid) assert.equal(f.status(), 'Too large');
      else if (state.alive && state.offered) assert.equal(f.status(), 'Unsaved edits');
      // A stored copy is always one the editor's own reader accepts for this event.
      if (f.state.storage) f.readDraft(f.state.storage, identity.id);
    }
    assert.deepEqual([...new Set(f.state.bindings)], [JSON.stringify(['calendar-modal-editor', 'app', identity.id])].slice(0, f.state.bindings.length ? 1 : 0));
  } finally { f.window.close(); }
}

/** Replays CalendarEditorDraft traces against the real modal editor and its draft lifecycle. */
export async function checkCalendarEditorDraft(mutate) {
  const [traces, compiled] = await Promise.all([modelTraces(model), buildCalendarEditor(mutate)]);
  let steps = 0;
  for (const trace of traces) { await replay(compiled, trace); steps += trace.steps.length - 1; }
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

/**
 * The same editor over the shared draft controller and a store kept in memory: edits typed in one
 * editor are offered by the next, restored edits save and clear, and edits typed against an older
 * revision of the event are refused.
 */
export async function checkCalendarEditorWithSharedController() {
  const compiled = await buildCalendarEditor(code => code, {sharedController: true});
  assert.ok(compiled.sources.some(path => path.endsWith('state/durable-draft-controller.ts')), 'shared draft controller');
  let stored = null;
  const memory = {read: async () => stored, save: async (expected, text) => {
    if (expected !== stored) throw Error('Draft changed');
    stored = {text, sending: false};
    return stored;
  }};
  const type = async (f, title) => {
    f.input('Event title').value = title;
    f.input('Event title').dispatchEvent(new f.window.Event('input', {bubbles: true}));
    await idle();
  };
  const first = editorFixture(compiled, 'none', memory);
  await idle();
  assert.equal(first.form.inert, false);
  assert.equal(first.save.disabled, false);
  await type(first, 'Moved sync');
  assert.deepEqual(first.readDraft(stored.text, identity.id).revision, identity.revision);
  first.button('Cancel').click();
  await idle();
  assert.equal(first.result(), 'cancelled');
  assert.equal(JSON.parse(stored.text).fields.title, 'Moved sync', 'closing keeps the retained edits');

  const second = editorFixture(compiled, 'none', memory);
  await idle();
  assert.equal(second.form.inert, true);
  assert.equal(second.save.disabled, true);
  assert.equal(second.status(), 'Unsaved edits');
  assert.equal(second.input('Event title').value, row.title);
  second.button('Restore saved editor').click();
  await idle();
  assert.equal(second.input('Event title').value, 'Moved sync');
  assert.equal(second.form.inert, false);
  second.save.click();
  await idle();
  assert.equal(second.state.commits.length, 1);
  assert.equal(second.state.commits[0].next.title, 'Moved sync');
  second.state.commits[0].resolve();
  await idle();
  assert.equal(second.result(), 'saved');
  assert.equal(stored.text, '', 'the saved event cleared its retained edits');

  stored = {text: copies.stale, sending: false};
  const third = editorFixture(compiled, 'none', memory);
  await idle();
  assert.equal(third.save.disabled, true);
  third.button('Restore saved editor').click();
  await idle();
  assert.equal(third.input('Event title').value, 'Retained title');
  third.save.click();
  await idle();
  assert.match(third.error(), /older event revision/);
  assert.equal(third.state.commits.length, 0);
  assert.equal(stored.text, copies.stale);
  assert.equal(third.result(), 'open');
  third.button('Cancel').click();
  await idle();
  const fourth = editorFixture(compiled, 'none', memory);
  await idle();
  fourth.button('Discard saved editor').click();
  fourth.answer('Discard edits', true);
  await idle();
  assert.equal(stored.text, '');
  assert.equal(fourth.form.inert, false);
  assert.equal(fourth.input('Event title').value, row.title);
  fourth.save.click();
  await idle();
  assert.equal(fourth.state.commits.length, 1, 'the current event saves once the older edits are discarded');
  fourth.state.commits[0].resolve();
  await idle();
  assert.equal(fourth.result(), 'saved');
  for (const f of [first, second, third, fourth]) f.window.close();
  return {sources: compiled.sources};
}
