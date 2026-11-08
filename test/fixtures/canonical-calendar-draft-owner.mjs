import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapter = 'apps/app/src/prototype/canonical-calendar-drafts.ts';
const codec = 'apps/app/src/runtime/canonical-calendar-draft.ts';
const durable = '.eliza/client-features/packages/ui/src/state/durable-draft.ts';
const own = fileURLToPath(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));

export async function buildCalendarDraftFixture() {
  const ports = new Map([
    ['../runtime/assistant-draft-store', 'export const assistantDraftStore=(binding)=>__port.store(binding);'],
    ['./agent-calendar-adapter', 'export const browserCalendarScope=()=>false;'],
    ['../browser/domain-recovery', 'export const openDomainRecovery=(...args)=>__port.recover(...args);'],
  ]);
  const built = await build({absWorkingDir: root, stdin: {resolveDir: root, sourcefile: 'calendar-draft-entry.ts',
    contents: `export {installCanonicalCalendarDrafts} from './${adapter}';
      export {encodeCanonicalCalendarDraft,decodeCanonicalCalendarDraft} from './${codec}';
      export {compareExchangeDraftStore} from './${durable}';`},
    platform: 'node', bundle: true, format: 'cjs', write: false, metafile: true,
    plugins: [{name: 'calendar-draft-ports', setup(builder) {
      builder.onResolve({filter: /^\.\.?\//}, args => args.importer.endsWith('/canonical-calendar-drafts.ts') && ports.has(args.path)
        ? {path: args.path, namespace: 'fixture-port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'fixture-port'}, args => ({contents: ports.get(args.path)}));
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('fixture-port:') && path !== 'calendar-draft-entry.ts'), own];
  return {code: built.outputFiles[0].text, sources};
}

const binding = owner => JSON.stringify(['canonical-calendar-editor', owner]);
const form = (owner, title) => ({id: null, canonicalOwnerKey: owner, creationId: 'fixture-draft',
  title, notes: '', where: '', off: 0, t: 17, d: 1, zone: 'UTC', who: [], video: false,
  repeat: 'none', alert: null, cal: 'agent:' + 'a'.repeat(64)});
const decodeBinding = raw => raw ? JSON.parse(raw)[1] : '';

export function calendarDraftFixture(compiled) {
  const module = {exports: {}}, port = {}, slots = new Map();
  const heldReads = new Set(), heldWrites = new Set(), reads = new Map(), writes = new Map();
  const recoveries = [], toasts = [];
  let revision = 0;
  new Function('module', 'exports', '__port', 'window', compiled.code)(module, module.exports, port, {confirm: () => true});
  const {installCanonicalCalendarDrafts, encodeCanonicalCalendarDraft, decodeCanonicalCalendarDraft, compareExchangeDraftStore} = module.exports;
  const settle = async () => {await tick(); await tick();};
  const project = text => {
    if (!text) return {owner: '', title: ''};
    const {form} = decodeCanonicalCalendarDraft(text);
    return {owner: form.canonicalOwnerKey, title: form.title};
  };
  port.store = slot => {
    const owner = decodeBinding(slot);
    return compareExchangeDraftStore(slot, {
      async read() {
        if (heldReads.delete(owner)) await new Promise(resolve => {reads.set(owner, resolve);});
        return slots.get(slot) ?? null;
      },
      async compareExchange(expected, value) {
        if (heldWrites.delete(owner)) await new Promise(resolve => {writes.set(owner, resolve);});
        if ((slots.get(slot) ?? null) !== expected) return {status: 'conflict'};
        slots.set(slot, value);
        return {status: 'saved'};
      },
    }, {revision: () => String(++revision), recovery: {slot}});
  };
  port.recover = (...args) => recoveries.push(args);
  class Host {
    live = true;
    calendar = {calendarAuthority: 'canonical', form: null};
    agentCalendar = {state: {ownerKey: null}};
    vget() {return this.calendar;}
    vset(_key, patch) {Object.assign(this.calendar, patch);}
    setState() {}
    toast(message) {toasts.push(message);}
    componentDidMount() {}
    componentDidUpdate() {}
    componentWillUnmount() {this.live = false;}
  }
  const views = {calendar: {render: state => ({renderedForm: state.form?.title ?? ''})}};
  installCanonicalCalendarDrafts(Host, views);
  const host = new Host();
  host.componentDidMount();
  const render = () => views.calendar.render(host.calendar, {set: patch => host.vset('calendar', patch), toast: message => host.toast(message)});
  const release = async (owners, owner) => {
    const resolve = owners.get(owner);
    assert.equal(typeof resolve, 'function', 'Actual held store request');
    owners.delete(owner);
    resolve();
    await settle();
  };
  return {
    host, settle, render, recoveries, toasts,
    update() {host.componentDidUpdate();},
    seed(slotOwner, payloadOwner, title) {
      const slot = binding(slotOwner);
      slots.set(slot, JSON.stringify({version: 1, binding: slot, revision: String(++revision),
        text: encodeCanonicalCalendarDraft(form(payloadOwner, title))}));
    },
    raw(owner) {return slots.get(binding(owner)) ?? null;},
    saved(owner) {return project(JSON.parse(slots.get(binding(owner)) ?? 'null')?.text);},
    setOwner(owner) {host.agentCalendar.state.ownerKey = owner || null;},
    async bind(owner) {this.setOwner(owner); this.update(); await settle();},
    holdRead(owner) {heldReads.add(owner);},
    holdWrite(owner) {heldWrites.add(owner);},
    releaseRead(owner) {return release(reads, owner);},
    releaseWrite(owner) {return release(writes, owner);},
    async edit(owner, title) {host.calendar.form = form(owner, title); this.update(); await settle();},
    async closeForm() {host.calendar.form = null; this.update(); await settle();},
    async resume() {render().resumeFormDraft?.(); this.update(); await settle();},
    async discard() {render().discardFormDraft?.(); await settle();},
    async commit(saved = host.calendar.form) {host.calendarFormCommitted(saved); await settle();},
    async openRecovery() {render().recoverFormDraft?.(); await settle();},
    async close() {host.componentWillUnmount(); await settle();},
    async awaitReadFailure() {
      for (let tries = 0; tries < 150 && host.canonicalDraft.state.opening; tries++)
        await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(host.canonicalDraft.state.opening, false, 'Read retry loop settled');
      assert.equal(host.canonicalDraft.state.error, true, 'Read failed after retries');
    },
    observe() {
      const out = render(), controller = host.canonicalDraft;
      return {owner: host.agentCalendar.state.ownerKey ?? '', bound: decodeBinding(controller.binding),
        text: project(host.canonicalDraftText), form: host.calendar.form?.title ?? '',
        renderedForm: out.renderedForm, resumeOffered: !!out.formDraftAvailable,
        busy: !!out.formDraftBusy, storageError: !!(out.formDraftError || out.formDraftListError),
        recovery: !!controller.recovery(), notices: toasts.length,
        readPending: [...reads.keys()], writePending: [...writes.keys()]};
    },
  };
}
