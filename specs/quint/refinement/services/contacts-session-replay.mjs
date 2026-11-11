/** Existing source-executing MBT harness, shared by its original owning tests and the strict services receipt. */
// ContactsSession traces replayed against the Contacts adapter, the view admission set and the
// image admission step. The native Contacts plugin is a held port: each access read and each system
// editor stays in flight until the trace settles it. No address book or Android is involved.
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, settle, sourceModule} from './identity-comms-traces.mjs';

const MODEL = {path: 'specs/quint/services/ContactsSession.qnt', module: 'ContactsSession'};
const SCENARIOS = ['readRowsTest', 'answerAfterLeaveTest', 'supersededReadTest', 'revokedWhileOpenTest', 'editorReturnRereadsTest', 'noAccessTest'];
const WITNESSES = ['RowsKeptWhileLoadingWitness', 'SupersededReadWitness', 'RevokedWhileOpenWitness', 'EditorOverLoadedListWitness'];

const {installContactsAdapter, admitImageContacts, applyImageContacts, isMvpView, DEFERRED_MVP_VIEWS} = await sourceModule(
  ['apps/app/src/prototype/contacts-adapter.ts', 'apps/app/src/prototype/mvp-features.ts', 'apps/app/src/runtime/image-contacts.ts'], {
    'platform-plugins$': 'export const registerPlugin=()=>new Proxy({},{get:(_,name)=>globalThis.__contactsPort[name]});',
    'native-adapter$': 'export const watchReturnToApp=()=>()=>{};',
    'browser/dev-profile$': 'export const browserDevProfile=false;',
    'runtime/aosp-image$': 'export const aospImage=false;export const admittedAospViews=()=>[];',
  });

/** What the page shows of the model state. Load more is offered up to four pages of fifty. */
const project = s => ({loading: s.loading, readable: s.readable, rows: s.rows && s.query === s.rowsQuery,
  more: s.more && s.query === s.rowsQuery && s.limit < 4,
  reads: s.reads.length, editorOpen: s.editorOpen, admitted: s.admitted, viewOpen: s.viewOpen});

function create() {
  const reads = [], editors = [], order = ['notes', 'contacts'], viewState = {q: ''};
  let answer = null;
  const hold = list => () => new Promise((resolve, reject) => list.push({resolve, reject}));
  // This legacy session models the supported read-only host and Android editor handoff. The
  // current adapter probes write access first; this host deterministically remains read-only.
  globalThis.__contactsPort = {status: hold(reads), requestPermissions: async () => ({available: true, readable: true, writable: false}), create: hold(editors), edit: hold(editors),
    list: async options => { assert.ok(answer, 'the list is read only after access is granted'); assert.equal(options.limit, answer.limit); assert.equal(options.query, answer.query); return {contacts: [{id: '1', name: 'Ada'}], more: answer.more}; }};
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener() {}};
  admitImageContacts(true);
  const views = {contacts: {render: state => ({list: state.list})}};
  // The shell reports a deferred view as no view, and returns Home through the view's update path.
  class Shell {
    view = 'home';
    S() { return {view: DEFERRED_MVP_VIEWS.has(this.view) ? null : this.view}; }
    setState() {} vget() { return viewState; } toast() {}
    goHome() { this.view = 'home'; this.componentDidUpdate(); }
  }
  installContactsAdapter(Shell, views);
  const shell = new Shell();
  shell.componentDidMount();
  const page = () => views.contacts.render(viewState, {set: patch => Object.assign(viewState, patch)});
  const visibility = async hidden => { globalThis.document.hidden = hidden; shell.contactsHide(); await settle(); };
  const view = async name => { shell.view = name; shell.componentDidUpdate(); await settle(); };
  return {
    openView: () => view('contacts'), closeView: () => view('home'), hide: () => visibility(true), show: () => visibility(false),
    async admission(admitted) { applyImageContacts(admitted, order, shell, admitImageContacts); await settle(); },
    async refresh() { page().nativeRefresh(); await settle(); },
    async loadMore() { page().nativeLoadMore(); await settle(); },
    async search() { page().onQ({target: {value: viewState.q ? '' : 'a'}}); await settle(); },
    async readCompletes(token, outcome, more, {before}) {
      const [read] = reads.splice(before.reads.indexOf(token), 1);
      answer = outcome === 'rows' && token === before.epoch ? {more, limit: 50 * before.limit, query: before.query ? 'a' : ''} : null;
      if (outcome === 'error') read.reject(Error('unavailable')); else read.resolve({available: true, readable: outcome === 'rows'});
      await settle();
      answer = null;
    },
    async openEditor() { page().addNew(); await settle(); },
    async editorReturned() { editors.shift().resolve({}); await settle(); },
    observe() {
      const model = page();
      assert.equal(order.includes('contacts'), isMvpView('contacts'), 'the view order follows the admission');
      return {loading: model.nativeBusy, readable: !model.nativeAccess, rows: model.list.length > 0, more: model.nativeMore,
        reads: reads.length, editorOpen: editors.length > 0, admitted: isMvpView('contacts'), viewOpen: shell.S().view === 'contacts'};
    },
    close() { shell.componentWillUnmount(); delete globalThis.document; delete globalThis.__contactsPort; },
  };
}


export async function runContactsSessionCase1(t, {canaries=true}={}) {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 60, steps: 25});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 60);
  if(canaries){
  // The comparison is live: a model that blanked the rows when a refresh starts is refused.
  const blanked = state => ({...project(state), rows: project(state).rows && !state.loading});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'readRowsTest'), create, {project: blanked}), /readRowsTest step/);
  }
  for (const action of ['openView', 'closeView', 'hide', 'show', 'admission', 'refresh', 'loadMore', 'search', 'readCompletes', 'openEditor', 'editorReturned']) assert.ok(receipt.actions[action] > 0, action);
  return receipt;
}

export async function runContactsSessionReplay(){return runContactsSessionCase1(undefined,{canaries:false});}
