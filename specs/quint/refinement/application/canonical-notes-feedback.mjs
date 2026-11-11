import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {root, captureSources, boundInputs, deferred, tick, call as actionCall} from './support.mjs';
import {checkTraces} from '../check-traces.mjs';

const driver = fileURLToPath(import.meta.url);
const source = 'apps/app/src/prototype/canonical-notes-ui.ts';

export async function compileCanonicalNotesUi(extraSources = [], observationPlugins = []) {
  const compiled = await build({absWorkingDir: root, stdin: {resolveDir: root, contents: `export {CanonicalNotesUi} from './${source}'; export {projectNoteForModel} from './.eliza/client-features/plugins/plugin-notes/src/types.ts';`},
    bundle: true, format: 'cjs', platform: 'node', write: false, metafile: true,
    plugins: [...observationPlugins, {name: 'canonical-view-ports', setup(builder) {
      builder.onResolve({filter: /^\.\.\/runtime\/connection-ui$/}, () => ({path: 'copy', namespace: 'ports'}));
      builder.onResolve({filter: /^\.\.\/daily$/}, () => ({path: 'daily', namespace: 'ports'}));
      builder.onResolve({filter: /^\.\.\/runtime\/text-share$/}, () => ({path: 'clipboard', namespace: 'ports'}));
      builder.onLoad({filter: /.*/, namespace: 'ports'}, args => ({loader: 'js', contents: args.path === 'copy'
        ? `export const agentPendingText=()=>{throw Error('Global connection copy is outside this view fixture')}; export const agentAvailabilityNotice=agentPendingText; export const connectionController={open:agentPendingText};`
        : args.path === 'clipboard' ? `export const copySelectedText=__ports.copyText;` : `export const DailyApps=__ports.daily;`}));
    }}]});
  const sources = [...Object.keys(compiled.metafile.inputs).filter(path => !path.startsWith('<') && !path.startsWith('ports:')),
    driver, 'specs/quint/refinement/application/support.mjs', ...extraSources];
  captureSources(sources);
  return {code: compiled.outputFiles[0].text, sources};
}

export async function createCanonicalNotesUiFixture(compiled, onViewObservation = () => {}, copyText = () => {throw Error('Clipboard is outside the feedback fixture');}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget(); Object.defineProperty(globalThis, 'window', {configurable: true, writable: true, value: events});
  const requests = [], toasts = [], commands = [];
  let current = true, reviews = 0;
  const daily = {perform() {throw Error('Native actions are outside the feedback fixture');}};
  const module = {exports: {}};
  new Function('require', 'module', 'exports', '__ports', compiled.code)(createRequire(import.meta.url), module, module.exports, {daily, observe: onViewObservation, copyText});
  const identity = {ownerId: 'owner-one', agentId: 'agent', sessionId: 'session-one', origin: 'https://fixture.invalid'};
  const port = {sessionId: identity.sessionId, identity, current: () => current,
    request(path, method, body, signal) {const task = deferred(); requests.push({path, method, body, signal, task, settled: false}); return task.promise;}};
  const committed = [];
  const ui = new module.exports.CanonicalNotesUi(port, {paint() {}, review() {reviews++;}, committed(id) {committed.push(id);}});
  const tokens = new Map();
  const tokenOf = token => {if (!token) return 0; if (!tokens.has(token)) tokens.set(token, tokens.size + 1); return tokens.get(token);};
  const idOf = id => !id ? 0 : String(id).startsWith('draft-') ? 3 : id === 'note-one' ? 1 : id === 'note-two' ? 2 : assert.fail('Unrepresented note identity');
  const observe = () => ({phase: ui.phase, review: ui.reviewPending || 'none', failure: ui.failure || 'none',
    waiters: ui.idleWaiters.length, baseRows: ui.baseRows.map(row => idOf(row.id)), rows: ui.rowsValue.map(row => idOf(row.id)),
    open: idOf(ui.openValue), blank: idOf(ui.blankCreationValue), trash: ui.trashValue.map(row => idOf(row.id)),
    current: ui.current, pending: ui.pending, revision: ui.controller.revision ?? -1,
    editing: ui.editing, dirty: ui.dirty, authored: ui.editor.hasAuthoredContent,
    editorId: idOf(ui.editor.draft?.id), token: tokenOf(ui.editor.draft?.token), version: ui.editor.draft?.version ?? 0,
    publicRows: ui.list.map(row => idOf(row.id)), publicOpen: idOf(ui.open), reviews, commits: committed.map(idOf),
    requests: requests.map(request => ({path: request.path, method: request.method, capability: request.body?.capability ?? null, settled: request.settled, aborted: request.signal.aborted})),
    commands: commands.map(command => ({name: command.name, settled: command.settled, result: command.result})), toasts: toasts.length});
  function run(name, ...args) {
    const command = {name, settled: false, result: null}; commands.push(command);
    const result = Promise.resolve(ui[name](...args));
    command.promise = result.then(value => {command.settled = true; command.result = value ?? null; return value;}, error => {command.settled = true; command.result = 'rejected'; throw error;});
    command.promise.catch(() => {}); return command;
  }
  async function resolveRequest(state, target, success = true) {
    const request = requests.find(request => !request.settled); assert.ok(request, 'A source request must be pending');
    request.settled = true;
    if (!success) request.task.reject(Error('Injected canonical view request failure'));
    else request.task.resolve(request.method === 'GET' ? {success: true, data: state}
      : {requestId: 'canonical-view-request', success: true, result: {success: true, text: 'Confirmed', state, ...(target ? {data: {note: target}} : {})}});
    await tick(); await tick();
  }
  const viewState = {folder: 'deleted'};
  const api = {toast(message, options) {toasts.push({message, options});}, isActive: () => current, ic: {},
    set(patch) {Object.assign(viewState, patch);}, get() {return viewState;}};
  const feedbackSteps = [], prefix = [];
  let uncertain = false;
  const feedback = () => ({'s.phase': ui.phase, 's.review': ui.reviewPending || 'none',
    's.failure': ui.failure || 'none', 's.uncertain': uncertain});
  const initial = feedback();
  function record(action) {
    const actions = [...prefix.splice(0), action];
    for (const item of actions) {
      if (item.name === 'failed' && item.args[0] === 'interact') uncertain = true;
      if (item.name === 'committed' || item.name === 'discard' || item.name === 'retryConfirmed') uncertain = false;
    }
    feedbackSteps.push({label: 'actual ' + action.name + ' callback', action: actions.length === 1 ? action : actions,
      expect: feedback(), source: observe()});
  }
  const originalPhase = ui.controller.hooks.phase;
  ui.controller.hooks.phase = value => {originalPhase(value); record(actionCall('phase', value));};
  const originalFailed = ui.controller.hooks.failed;
  ui.controller.hooks.failed = (error, operation) => {originalFailed(error, operation); record(actionCall('failed', operation));};
  const originalSnapshot = ui.controller.hooks.snapshot;
  ui.controller.hooks.snapshot = (snapshot, reason) => {
    originalSnapshot(snapshot, reason);
    if (reason === 'read') record(actionCall('readSnapshot', ui.dirty, ui.current, ui.pending));
  };
  const originalReview = ui.needsReview.bind(ui);
  ui.needsReview = () => {originalReview(); record(actionCall('changeReview'));};
  const originalCommitted = ui.editor.hooks.committed;
  ui.editor.hooks.committed = (target, token) => {originalCommitted(target, token); record(actionCall('committed'));};
  const originalConfirmed = ui.draftConfirmed.bind(ui);
  ui.draftConfirmed = () => {originalConfirmed(); record(actionCall('retryConfirmed'));};
  const originalDiscard = ui.discardDraftAndReload.bind(ui);
  ui.discardDraftAndReload = () => {prefix.push(actionCall('discard')); return originalDiscard();};
  return {ui, projectNoteForModel: module.exports.projectNoteForModel, observe, feedback, initial, feedbackSteps, run, resolveRequest, api, requests,
    restore() {
      ui.decorate({none: false}, api, viewState).trashRows[0].ask();
      ui.decorate({none: false}, api, viewState).trashAskRecover();
    },
    loseOwner() {current = false;}, async close() {
      ui.retire(); for (const request of requests) if (!request.settled) {request.settled = true; request.task.reject(Error('Fixture teardown'));}
      await tick(); if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    }};
}

export async function checkCanonicalNotesFeedback(extraSources = []) {
  const compiled = await compileCanonicalNotesUi(extraSources), traces = [];
  const note = {id: 'note-one', title: 'Note', body: '\nBody', color: 'yellow', createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z'};
  const state = (revision = 1, notes = [note], trash = []) => ({revision, notes, trash});
  for (const scenario of ['initial-read', 'initial-read-failure', 'read-recovery', 'dirty-read-recovery', 'dirty-new-revision',
    'uncertain-delete', 'uncertain-restore', 'uncertain-update', 'discard-success', 'discard-failure',
    'commit-after-uncertain', 'card-after-uncertain', 'local-invalid-update', 'owner-read', 'retire-read', 'retire-uncertain',
    'retry-save', 'retry-confirmed', 'retry-conflict', 'retry-read-failure']) {
    const f = await createCanonicalNotesUiFixture(compiled);
    try {
      f.run('refresh');
      if (scenario === 'retire-read' || scenario === 'owner-read') {
        if (scenario === 'retire-read') f.ui.retire(); else f.loseOwner();
        await f.resolveRequest(state());
      } else {
        const firstFailure = ['initial-read-failure', 'read-recovery'].includes(scenario);
        const firstState = scenario === 'uncertain-restore' ? state(1, [], [{note, deletedAt: '2026-11-08T00:00:00Z'}]) : state();
        await f.resolveRequest(firstState, undefined, !firstFailure);
        if (scenario === 'read-recovery') {f.run('refresh'); await f.resolveRequest(state());}
        if (['dirty-read-recovery', 'dirty-new-revision'].includes(scenario)) {
          await f.ui.leave('note-one'); f.ui.editor.edit({body: 'Dirty source text'});
          f.run('refresh'); await f.resolveRequest(state(scenario === 'dirty-new-revision' ? 2 : 1), undefined, scenario === 'dirty-new-revision');
          if (scenario === 'dirty-read-recovery') {f.run('refresh'); await f.resolveRequest(state());}
        }
        const uncertain = ['uncertain-delete', 'uncertain-restore', 'uncertain-update', 'discard-success', 'discard-failure',
          'commit-after-uncertain', 'card-after-uncertain', 'retire-uncertain'].includes(scenario);
        if (uncertain) {
          if (scenario === 'uncertain-restore') f.restore();
          else if (['uncertain-update', 'discard-success', 'discard-failure'].includes(scenario)) f.run('update', 'note-one', {body: 'Dirty source text'});
          else f.run('remove', 'note-one', f.api);
          await tick(); await f.resolveRequest(state(), undefined, false);
          if (['uncertain-delete', 'uncertain-restore', 'uncertain-update'].includes(scenario)) {
            f.run('refresh'); await f.resolveRequest(state(), undefined, false);
            f.run('refresh'); await f.resolveRequest(state(2));
          }
          if (scenario.startsWith('discard-')) {
            f.run('discardDraftAndReload'); await tick();
            await f.resolveRequest(state(2), undefined, scenario === 'discard-success');
          }
          if (scenario === 'commit-after-uncertain') {
            f.run('update', 'note-one', {body: 'Confirmed source text'}); await tick();
            const updated = {...note, body: '\nConfirmed source text'}; await f.resolveRequest(state(2, [updated]), updated);
          }
          if (scenario === 'card-after-uncertain') {
            f.run('saveCard', 'Created card', f.api); await tick();
            const created = {...note, id: 'note-two', title: 'Created card', body: ''};
            await f.resolveRequest(state(2, [note, created]), created);
          }
          if (scenario === 'retire-uncertain') f.ui.retire();
        }
        if (scenario.startsWith('retry-')) {
          // Try again (retryDraft): one read, then a save only on top of the record the draft started from.
          const other = {...note, id: 'note-two', title: 'Other', body: ''}, mine = {...note, body: '\nDirty source text'};
          if (scenario === 'retry-confirmed') {
            // The update's reply was lost although it was saved; the read finds the draft's words.
            f.run('update', 'note-one', {body: 'Dirty source text'}); await tick(); await f.resolveRequest(state(), undefined, false);
            f.run('retryDraft', f.api); await tick(); await f.resolveRequest(state(2, [mine]));
            assert.deepEqual([f.ui.phase, f.ui.dirty, f.ui.editor.draft?.id], ['ready', false, 'note-one']);
          } else {
            await f.ui.leave('note-one'); f.ui.editor.edit({body: 'Dirty source text'});
            const elsewhere = scenario === 'retry-conflict' ? [{...note, body: '\nChanged elsewhere'}] : [note, other];
            f.run('refresh'); await f.resolveRequest(state(2, elsewhere));
            assert.equal(f.ui.phase, 'review');
            const posts = () => f.requests.filter(request => request.method === 'POST').length, before = posts();
            const retry = f.run('retryDraft', f.api); await tick();
            await f.resolveRequest(state(2, elsewhere), undefined, scenario !== 'retry-read-failure');
            if (scenario === 'retry-save') {
              assert.equal(posts(), before + 1, 'the untouched record is saved on top of the newer collection');
              await f.resolveRequest(state(3, [mine, other]), mine);
              assert.deepEqual([await retry.promise, f.ui.phase, f.ui.dirty], [true, 'ready', false]);
            } else {
              assert.deepEqual([await retry.promise, posts(), f.ui.phase, f.ui.editor.draft?.body], [false, before, 'review', 'Dirty source text'],
                'a record changed elsewhere, or an unread collection, is never written over and the draft stays');
            }
          }
        }
        if (scenario === 'local-invalid-update') {f.run('update', 'missing', {body: 'Invalid target'}); await tick();}
      }
      f.feedbackSteps.push({label: 'settled source view feedback', action: null, expect: f.feedback(), source: f.observe()});
      traces.push({name: scenario, init: actionCall('init'), expect: f.initial, steps: f.feedbackSteps.slice()});
    } finally {await f.close();}
  }
  return checkTraces(boundInputs({model: 'CanonicalNotesFeedback', sources: compiled.sources, traces, scope: 'bounded-component',
    assumptions: [
      'Actual CanonicalNotesUi, editor, controller and wire codecs execute against deferred AppRecordPort calls. The adapter records each actual feedback handler after it runs.',
      'The three source fields and an independent interaction-failure history latch are compared after controller phase/failure/snapshot, editor commit, local review and explicit discard events.',
      'Record content, collection rendering, queued navigation, native dictation/recording and Calendar handoff are separate obligations. Global connection-copy functions and DailyApps are controlled unused ports in this campaign.'] }));
}
