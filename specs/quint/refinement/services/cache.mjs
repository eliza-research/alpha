import assert from 'node:assert/strict';
import {ServiceReadCache} from '../../../../apps/app/src/runtime/service-read-cache.ts';
import {NoticeOwnerCoordinator} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, casStore, deferred, until} from './support.mjs';

export async function cacheRefinement() {
  const sources = ['apps/app/src/runtime/service-read-cache.ts', '.eliza/client-features/packages/contracts/src/notice-routes.ts', 'specs/quint/refinement/services/cache.mjs', 'specs/quint/refinement/services/support.mjs'];
  const driverHashes = captureInputs(sources);
  const traces = [];
  for (const advance of [0, 30 * 86400000 - 1, 30 * 86400000]) {
    let now = 10000000000;
    const disk = casStore();
    const cache = new ServiceReadCache('owner-A', disk.store, () => now);
    const trace = {name: `cache persisted age ${advance}`, expect: {'s.cachePresent': disk.read() !== null, 's.epoch': cache.epoch}, steps: []};
    await cache.put('mail', {id: 'message-A'});
    trace.steps.push({label: 'real put commits CAS document', action: [action('beginCacheWrite'), action('cacheWriteReply')], expect: {'s.cachePresent': disk.read()?.entries.length === 1}});
    now += advance;
    const restored = new ServiceReadCache('owner-A', disk.store, () => now);
    const value = await restored.get('mail');
    const expiry = advance >= 30 * 86400000 ? [action('expireCache'), action('expireCache')] : [];
    trace.steps.push({label: 'new instance reads retained document with real expiry', action: value ? action('readCache') : expiry, expect: {'s.cacheVisible': value !== null}});
    traces.push(trace);
  }
  {
    const disk = casStore(), blockedRead = deferred();
    const originalRead = disk.store.read;
    let held = true, entered = false;
    disk.store.read = async () => { if (held) { entered = true; await blockedRead.promise; } return originalRead(); };
    const cache = new ServiceReadCache('owner-A', disk.store, () => 10000000000);
    const trace = {name: 'clear invalidates an entered asynchronous write', expect: {'s.cachePresent': disk.read() !== null}, steps: []};
    const pending = cache.put('mail', {id: 'late'});
    await until(() => entered, 'cache store read');
    trace.steps.push({label: 'put has entered storage read', action: action('beginCacheWrite'), expect: {'s.cachePresent': disk.read() !== null}});
    const clearing = cache.clear();
    trace.steps.push({label: 'clear increments real write epoch immediately', action: action('clearCache'), expect: {'s.epoch': cache.epoch, 's.cacheVisible': false}});
    held = false; blockedRead.resolve(); await Promise.all([pending, clearing]);
    trace.steps.push({label: 'late put cannot repopulate cleared storage', action: action('cacheWriteReply'), expect: {'s.cachePresent': disk.read() !== null}});
    assert.equal(await cache.get('mail'), null);
    assert.equal(disk.events.filter(event => event.kind === 'cas' && event.next !== null).length, 0);
    traces.push(trace);
  }
  {
    let queue = Promise.resolve(), fail = false, pending = 0;
    const coordinator = new NoticeOwnerCoordinator({
      transition: async () => { pending++; try { if (fail) throw Error('storage unavailable'); return {}; } finally { pending--; } },
      enqueue: work => { queue = queue.then(work); }, available: () => true, restore: async () => {},
    });
    const owner = id => ({identity: id, owner: {origin: 'https://fixture.invalid', ownerId: id, agentId: 'agent'}, hasSession: true});
    coordinator.update(owner('A')); await queue;
    const trace = {name: 'notice owner transition retries after failed native fence', expect: {'s.retry': coordinator.retryNeeded}, steps: []};
    fail = true; coordinator.update(owner('B')); await queue;
    trace.steps.push({label: 'real failed transition marks retry for current generation', action: [action('switchOwner'), action('transitionReply', false)], expect: {'s.retry': coordinator.retryNeeded, 's.epoch': coordinator.generation - 1}});
    fail = false; coordinator.update(owner('B')); await queue;
    trace.steps.push({label: 'same identity update retries transition', action: action('transitionReply', true), expect: {'s.retry': coordinator.retryNeeded}});
    assert.equal(pending, 0);
    traces.push(trace);
  }
  return checkTraces({model: 'NoticesAndCaches', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['Cache age maps the exact 30-day boundary to two abstract expiry ticks.', 'This adapter covers cache CAS and owner transition retry. Native posting, delivery claims, tap consumption and acknowledgement need a separate native ledger adapter.']});
}
