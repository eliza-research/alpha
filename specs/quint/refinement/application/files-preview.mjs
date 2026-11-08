import assert from 'node:assert/strict';
import {checkTraces as check} from '../check-traces.mjs';
import {bundledSource, sourceContext, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
const driver = 'specs/quint/refinement/application/files-preview.mjs';
captureSources([driver]);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources, driver,
  'specs/quint/refinement/application/support.mjs']}));

export async function filesPreview() {
  const source = '.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts', traces = [];
  const rules = await bundledSource('.eliza/client-features/plugins/plugin-files/src/browser/storage-model.ts');
  const contract = await bundledSource('.eliza/client-features/plugins/plugin-files/src/browser/files-agent-contract.ts');
  for (const outcome of ['current', 'retired', 'returned']) {
    let active = true, pending = false;
    const result = deferred(), accepted = [], forgotten = [], state = {};
    const document = Object.assign(new EventTarget(), {hidden: false, querySelector: () => null});
    const entry = {path: 'Owned.txt', name: 'Owned.txt', mimeType: 'text/plain', size: 4, modified: 1, directory: false};
    const storage = {
      async storageState() {return {status: 'ready', access: 'granted', volumes: [{id: 'primary', primary: true, name: 'Internal', free: 1, total: 2}]};},
      async storageCategory() {return {status: 'ready', entries: [], count: 0};},
      async storageTrashList() {return {status: 'ready', items: []};},
      async storageList() {return {status: 'ready', entries: [entry]};},
      async storageWatch() {return {status: 'ready'};},
      async storageUnwatch() {return {status: 'ready'};},
      async addListener() {return {async remove() {}};},
      storageSelect() {pending = true; return result.promise.finally(() => {pending = false;});},
    };
    const api = {ic: {}, get: () => state, set: patch => Object.assign(state, patch), isActive: () => active, toast() {}};
    const view = {render: () => ({}), onLeave() {}};
    const module = sourceContext([source], ['installFilesBrowserAdapter'], {
      ...rules.exports, ...contract.exports, document, window: new EventTarget(),
      queueMicrotask,
    });
    module.installFilesBrowserAdapter(view, async (_module, selected) => { accepted.push(selected.selectionId); }, () => {}, {
      storage, createInlineModal: () => ({ref() {}}), menuFocus() {},
      async forgetSelected(selectionId) { forgotten.push(selectionId); },
    });
    view.render(state, api); await tick(); await tick();
    view.render(state, api).browse.vols[0].go(); await tick(); await tick();
    const observe = () => ({'s.preview': accepted.length ? 1 : 0, 's.active': active, 's.pending': pending, 's.released': forgotten.length > 0});
    const t = trace(`storage-preview-${outcome}`, observe());
    view.render(state, api).fd.items[0].tap();
    checkpoint(t, 'actual storageSelect awaits owned capability', call('beginPreview'), observe());
    if (outcome !== 'current') {
      active = false; view.onLeave(api); checkpoint(t, 'source retires preview owner', call('leave'), observe());
      if (outcome === 'returned') {
        active = true; view.render(state, api); await tick(); await tick();
        checkpoint(t, 'returning to Files retains the new preview epoch', call('enter'), observe());
      }
    }
    result.resolve({status: 'selected', action: 'files', selectionId: 'owned-selected', name: entry.name, mimeType: entry.mimeType});
    await tick(); await tick();
    checkpoint(t, 'actual storage capability completion', call('previewReply'), observe());
    assert.deepEqual(forgotten, outcome === 'current' ? [] : ['owned-selected']); traces.push(t);
  }
  return checkTraces({model: 'FilesPreview', sources: [source, ...rules.sources, ...contract.sources], traces, scope: 'bounded-component', assumptions: [
    'Current installFilesBrowserAdapter listing, storageSelect completion and view-leave handlers execute. Storage and modal UI are controlled ports.',
    'The current preview request keeps the page visible. Old tree-token semantics are historical. The full current per-volume load/filter/watch/mutation state needs FilesBrowserController. Storage access and modal behavior are controlled ports.']});
}
