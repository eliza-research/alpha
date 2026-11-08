import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qset} from '../check-traces.mjs';
import {bundledSource, deferred, tick, captureSources, boundInputs, trace, checkpoint, call} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const product = 'apps/app/src/prototype/canonical-notes-controller.ts';

export async function createCanonicalNotesFixture(module, hooks = {}) {
  let owner = true, bindingOwned = true, phase = 'none', failure = 'none', publishedCurrent = true, publishedMonotonic = true, lastRevision = -1;
  const requests = [], promises = new Map(), aborts = new Map(), listeners = new Set();
  const events = new EventTarget();
  const add = events.addEventListener.bind(events), remove = events.removeEventListener.bind(events);
  events.addEventListener = (name, listener, ...args) => {listeners.add(listener); add(name, listener, ...args);};
  events.removeEventListener = (name, listener, ...args) => {listeners.delete(listener); remove(name, listener, ...args);};
  const port = {sessionId: 'session-one', identity: {ownerId: 'owner-one', agentId: 'agent', sessionId: 'session-one', origin: 'https://fixture.invalid'},
    current: () => owner,
    request(path, method, body, signal) {
      const task = deferred(), request = {id: requests.length + 1, path, method, body, signal, task, settled: false};
      requests.push(request); return task.promise;
    }};
  const controller = new module.exports.CanonicalNotesController(port, {
    phase(value) {phase = value; hooks.phase?.(value);}, failed(error, operation) {failure = operation; hooks.failed?.(error, operation);},
    snapshot(value) {publishedCurrent &&= controller.current; publishedMonotonic &&= value.revision >= lastRevision; lastRevision = value.revision; hooks.snapshot?.(value);},
  });
  const note = id => ({id: id === 1 ? 'note-one' : 'note-two', title: `Note ${id}`, body: 'Body', color: 'yellow', createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z'});
  const idOf = note => note.id === 'note-one' ? 1 : 2;
  function observe() {
    const newestRead = requests.findLast(request => request.method === 'GET');
    if (controller.read && !promises.has(controller.read)) promises.set(controller.read, newestRead.id);
    if (controller.readAbort && !aborts.has(controller.readAbort)) aborts.set(controller.readAbort, newestRead.id);
    const cache = controller.state.value?.snapshot;
    return {'s.owner': owner && bindingOwned, 's.retired': controller.state.signal.aborted, 's.revision': cache?.revision ?? -1,
      's.notes': qset((cache?.notes ?? []).map(idOf)), 's.readId': promises.get(controller.read) ?? 0,
      's.readAbortId': aborts.get(controller.readAbort) ?? 0,
      's.reads': qset(requests.filter(request => request.method === 'GET' && !request.settled).map(request => request.id)),
      's.readCalls': qset(requests.filter(request => request.method === 'GET').map(request => request.id)),
      's.aborted': qset(requests.filter(request => request.method === 'GET' && request.signal.aborted).map(request => request.id)),
      's.writeId': controller.writing ? requests.findLast(request => request.method === 'POST').id : 0,
      's.seq': requests.length, 's.invalidated': controller.invalidated, 's.phase': phase, 's.failure': failure,
      's.publishedCurrent': publishedCurrent, 's.publishedMonotonic': publishedMonotonic, 's.listening': listeners.size > 0,
      VisibleRevision: controller.revision ?? -1, VisibleNotes: qset((controller.snapshot?.notes ?? []).map(idOf)),
      ReadActive: !!controller.read, Writing: controller.pending};
  }
  const pending = [];
  const hold = promise => {pending.push(promise.catch(error => error));};
  function refresh() {hold(controller.refresh());}
  function interact() {hold(controller.interact('get-notes'));}
  async function reply(id, revision, ids = [1], success = true) {
    const request = requests[id - 1]; assert.ok(request && !request.settled);
    request.settled = true;
    const state = {revision, notes: ids.map(note)};
    if (!success) request.task.reject(Error('Injected transport failure'));
    else request.task.resolve(request.method === 'GET' ? {success: true, data: state}
      : {requestId: `request-${id}`, success: true, result: {success: true, text: 'Confirmed', state}});
    await tick(); await tick();
  }
  function event(same, revision) {
    const value = new Event(module.exports.CANONICAL_NOTES_INVALIDATED_EVENT);
    value.detail = {sessionId: same ? 'session-one' : 'other-session', ...(revision < 0 ? {} : {revision})};
    events.dispatchEvent(value);
  }
  return {controller, observe, refresh, interact, reply, event, events, requests,
    async replyWith(id, envelope) {
      const request = requests[id - 1]; assert.ok(request && !request.settled);
      request.settled = true; request.task.resolve(envelope); await tick(); await tick();
    }, loseOwner() {owner = false;}, changeBinding() {bindingOwned = false; port.identity.ownerId = 'other-owner';},
    cleanup() {controller.retire(); for (const request of requests) if (!request.settled) {request.settled = true; request.task.reject(Error('Fixture teardown'));}}};
}

export async function checkCanonicalNotesController(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const module = await bundledSource(product), traces = [];
  for (const scenario of ['read-coalesce', 'write-aborts-read', 'late-aborted-read', 'read-failure', 'write-failure', 'stale-read',
    'invalidated-write', 'retire-read', 'retire-write', 'owner-read', 'owner-write', 'binding-read', 'negative-before-first-read', 'events']) {
    const f = await createCanonicalNotesFixture(module), t = trace(scenario, f.observe());
    const step = (label, action) => checkpoint(t, label, action, f.observe());
    try {
      if (scenario === 'negative-before-first-read') {
        f.controller.invalidate(-1); step('a direct negative revision starts the first read', call('invalidate', 0));
        await f.reply(1, 1); step('first read accepted', call('readReply', 1, 1, qset([1]), true));
      } else if (scenario === 'events') {
        f.controller.listen(f.events); step('attach actual authenticated event handler', call('listen'));
        f.controller.listen(f.events); step('reattach replaces the prior handler', call('listen'));
        f.event(false, 2); step('other-session event ignored', call('event', false, 2));
        f.event(true, -1); step('same-session event begins a read', call('event', true, -1));
        await f.reply(1, 1); step('read snapshot accepted', call('readReply', 1, 1, qset([1]), true));
        f.event(true, 1); step('already accepted revision needs no read', call('event', true, 1));
        f.controller.invalidate(-1); step('a direct negative revision is older than the accepted snapshot', call('invalidate', 0));
        f.controller.retire(); step('retirement removes handler', call('retire'));
        f.event(true, 2); step('retired listener receives nothing', call('event', true, 2));
      } else {
        const writing = ['write-failure', 'invalidated-write', 'retire-write', 'owner-write'].includes(scenario);
        if (writing) f.interact(); else f.refresh();
        step('actual request reaches controlled transport', call(writing ? 'interact' : 'refresh'));
        if (writing) {f.interact(); step('second interaction is refused while writing', {...call('interact'), reject: true});}
        if (scenario === 'read-coalesce') {
          f.refresh(); step('second refresh reuses current read', call('refresh'));
          f.controller.invalidate(2); step('invalidation coalesces', call('invalidate', 2));
        }
        if (scenario === 'write-aborts-read' || scenario === 'late-aborted-read') {
          f.interact(); step('interaction aborts read without waiting for transport', call('interact'));
          const ids = scenario === 'late-aborted-read' ? [2, 1] : [1, 2];
          for (const id of ids) {
            await f.reply(id, id === 1 ? 0 : 1, [2]);
            step('transport settles request ' + id, id === 1 ? call('readReply', id, 0, qset([2]), true) : call('writeReply', 1, qset([2]), true));
          }
        } else {
          if (scenario === 'invalidated-write') {
            f.controller.invalidate(2); step('change while writing is deferred', call('invalidate', 2));
            f.refresh(); step('explicit refresh during write requests later reload', call('refresh'));
          }
          if (scenario.startsWith('retire')) {f.controller.retire(); step('retire before completion', call('retire'));}
          if (scenario.startsWith('owner')) {
            f.loseOwner(); step('live port loses its bound owner', call('loseOwner'));
            f.refresh(); step('fresh read is refused for the obsolete owner', {...call('refresh'), reject: true});
          }
          if (scenario === 'binding-read') {f.changeBinding(); step('changed identity is refused even while port current remains true', call('loseOwner'));}
          const success = !scenario.endsWith('failure');
          await f.reply(1, 1, [1], success);
          step('controlled transport completes', writing ? call('writeReply', 1, qset([1]), success) : call('readReply', 1, 1, qset([1]), success));
          if (scenario === 'stale-read') {
            f.refresh(); step('explicit later reload', call('refresh'));
            await f.reply(2, 0, [2]); step('older revision refused', call('readReply', 2, 0, qset([2]), true));
          }
        }
      }
      traces.push(t);
    } finally {f.cleanup(); await tick();}
  }
  return checkTraces(boundInputs({model: 'CanonicalNotesController', sources: [...module.sources, driver, ...extraSources],
    traces, scope: 'bounded-component', assumptions: [
      'Actual current CanonicalNotesController, shared NotesController, snapshot state and wire codec execute with controlled AppRecordPort completion order.',
      'All controller fields and retained pending transport identities are observed. Opaque note and promise identities use finite equality classes. Six requests and two note identities bound the model.',
      'The representative valid POST capability is get-notes. Domain mutation effects, NotesEditor, CanonicalNotesUi, record payload semantics, server durability and all possible interleavings require separate coverage.'] }));
}
